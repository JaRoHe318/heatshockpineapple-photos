import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import exifParser from 'exif-parser';

export const DEFAULT_SELECTED = ['Cities__NYC__IMG_7173','Cities__Seattle__IMG_0522','Cities__SF__IMG_4509','Cities__Chicago__20250711_123627_M6_5292','Street__IMG_0463','Portrait__IMG_2914','Street__20250718_084255_M6_5901','Cities__Boston__IMG_7839'];
const CATALOG = 'src/data/photos.json';
const SETTINGS = 'src/data/photo-settings.json';
const STATE = '.photo-manager/sources.json';
export class LibraryError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function inside(root, rel) {
  if (typeof rel !== 'string' || path.isAbsolute(rel)) throw new LibraryError('Invalid file path.');
  const result = path.resolve(root, rel);
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new LibraryError('Invalid file path.');
  return result;
}
async function readJSON(root, rel, fallback) {
  try { return JSON.parse(await fs.readFile(inside(root, rel), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function writeJSONAtomic(file, value) {
  await fs.writeFile(file + '.tmp', json(value));
  await fs.rename(file + '.tmp', file);
}
export async function loadLibrary(root) {
  const catalog = await readJSON(root, CATALOG);
  const settings = await readJSON(root, SETTINGS, { version: 1, photos: {}, home: { selectedIds: DEFAULT_SELECTED.filter(id => catalog.photos.some(p => p.id === id)), heroIds: null } });
  const state = await readJSON(root, STATE, {});
  const aliases = await readJSON(root, 'src/data/photo-path-aliases.json', {});
  return { photos: catalog.photos, settings, state, aliases, revision: hash(json({ catalog, settings, state, aliases })) };
}
function group(value, fallback = '') {
  const text = String(value ?? fallback).trim().normalize('NFC');
  if (!text || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u.test(text) || /^(archive|index)$/i.test(text)) throw new LibraryError('Use a collection or album name of 1–80 letters, numbers, spaces, hyphens, or underscores. “Archive” and “index” are reserved.');
  return text;
}
function details(input, current) {
  const alt = String(input.alt ?? current.alt ?? '').trim();
  const caption = String(input.caption ?? current.caption ?? '').trim();
  if (!alt || alt.length > 500 || caption.length > 5000) throw new LibraryError('Add an image description (up to 500 characters). Captions can be up to 5,000 characters.');
  return { alt, caption, collection: group(input.collection ?? current.collection), album: input.album === '' || input.album === null ? null : group(input.album ?? current.album ?? '', '') };
}
function normalizeDetails(input, current) {
  const value = details({ ...input, album: input.album === undefined ? (current.album || null) : input.album }, current);
  return value;
}
function matchExistingGroups(values, photos) {
  const collection = photos.find(p => pathKey(p.collection) === pathKey(values.collection))?.collection || values.collection;
  const album = values.album ? photos.find(p => p.collection === collection && p.album && pathKey(p.album) === pathKey(values.album))?.album || values.album : null;
  return { ...values, collection, album };
}
function cameraDetails(buffer) {
  try {
    const { tags } = exifParser.create(buffer).parse();
    return [tags.Model?.replace('Canon EOS ', '').replace(' Mark II', ' II'), tags.FocalLength ? `${tags.FocalLength}mm` : '', tags.FNumber ? `f/${Number(tags.FNumber).toFixed(1).replace(/\.0$/, '')}` : ''].filter(Boolean).join(' · ');
  } catch { return ''; }
}
async function derivatives(buffer, photo, files) {
  const meta = await sharp(buffer, { limitInputPixels: 120000000 }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new LibraryError('Please use exported JPEG, PNG, or WebP images.');
  for (const [base, width, quality] of [[photo.full, 2400, 90], [photo.src, 800, 80]]) {
    for (const format of ['jpg', 'webp']) {
      const pipeline = sharp(buffer, { limitInputPixels: 120000000 }).rotate().resize({ width, withoutEnlargement: true });
      const { data, info } = await (format === 'jpg' ? pipeline.jpeg({ quality, mozjpeg: true }) : pipeline.webp({ quality })).toBuffer({ resolveWithObject: true });
      files.set('public' + base.replace(/\.jpg$/i, '.' + format), data);
      if (base === photo.full && format === 'jpg') { photo.width = info.width; photo.height = info.height; }
    }
  }
}
/** Journal every destination before writing; recover interrupted saves on next startup. */
export async function commitFiles(root, files) {
  const tx = '.photo-manager/transactions/' + crypto.randomUUID();
  const manifest = [];
  for (const [rel, data] of files) {
    const dest = inside(root, rel);
    let previous;
    try { previous = await fs.readFile(dest); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const index = manifest.length;
    await fs.mkdir(inside(root, tx), { recursive: true });
    if (previous) await fs.writeFile(inside(root, `${tx}/${index}.before`), previous);
    if (data !== null) await fs.writeFile(inside(root, `${tx}/${index}.after`), data);
    manifest.push({ rel, existed: previous !== undefined, remove: data === null });
  }
  const manifestPath = inside(root, `${tx}/manifest.json`);
  await writeJSONAtomic(manifestPath, { phase: 'applying', entries: manifest });
  try {
    for (let i = 0; i < manifest.length; i++) {
      const dest = inside(root, manifest[i].rel);
      if (manifest[i].remove) { await fs.rm(dest, { force: true }); continue; }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(inside(root, `${tx}/${i}.after`), dest + '.photo-manager-tmp');
      await fs.rename(dest + '.photo-manager-tmp', dest);
    }
    await writeJSONAtomic(manifestPath, { phase: 'committed', entries: manifest });
  } catch (error) { await rollback(root, tx, manifest); throw error; }
  return tx;
}
async function rollback(root, tx, entries) {
  for (let i = 0; i < entries.length; i++) {
    const dest = inside(root, entries[i].rel);
    if (entries[i].existed) {
      await fs.copyFile(inside(root, `${tx}/${i}.before`), dest + '.photo-manager-tmp');
      await fs.rename(dest + '.photo-manager-tmp', dest);
    } else { await fs.rm(dest, { force: true }); }
    await fs.rm(dest + '.photo-manager-tmp', { force: true });
  }
  await writeJSONAtomic(inside(root, `${tx}/manifest.json`), { phase: 'rolled-back', entries });
}
export async function recoverSaves(root) {
  const base = inside(root, '.photo-manager/transactions');
  const directories = await fs.readdir(base).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const name of directories) {
    const tx = `.photo-manager/transactions/${name}`;
    const manifest = await readJSON(root, `${tx}/manifest.json`, null);
    if (manifest?.phase === 'applying') await rollback(root, tx, manifest.entries);
  }
}
export async function saveLibrary(root, input) {
  const library = await loadLibrary(root);
  if (input.revision !== library.revision) throw new LibraryError('The library changed since you opened it. Reload before saving so newer changes are preserved.', 409);
  if (!Array.isArray(input.edits) || !Array.isArray(input.imports) || input.imports.length > 20) throw new LibraryError('Save up to 20 new photos at a time.');
  const photos = library.photos.map(photo => ({ ...photo }));
  const settings = structuredClone(library.settings);
  const state = structuredClone(library.state);
  const files = new Map();
  const aliases = { ...library.aliases };
  const index = await originalIndex(root);
  const owners = ownersFor(photos, state, index);
  for (const edit of input.edits) {
    const photo = photos.find(p => p.id === edit.id);
    if (!photo) throw new LibraryError('A selected photo is no longer in this library.');
    const values = matchExistingGroups(normalizeDetails(edit, photo), photos);
    const move = values.collection !== photo.collection || values.album !== photo.album;
    Object.assign(photo, values, { category: values.collection });
    if (move) await organizePhoto(root, photo, state, index, owners, aliases, files);
    settings.photos[photo.id] = values;
  }
  const importedIds = new Set(photos.map(photo => photo.id));
  let totalBytes = 0;
  for (const item of input.imports) {
    if (typeof item.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new LibraryError('Invalid image data.');
    const buffer = Buffer.from(item.data, 'base64');
    totalBytes += buffer.length;
    if (buffer.length > 40 * 1024 * 1024 || totalBytes > 100 * 1024 * 1024) throw new LibraryError('Limit imports to 40 MB per image and 100 MB per save.');
    const id = item.id ?? 'photo_' + crypto.randomUUID();
    if (typeof id !== 'string' || !/^photo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new LibraryError('Invalid photo identifier. Re-add this unsaved import.');
    if (importedIds.has(id)) throw new LibraryError('This photo is already in the library. Reload before importing it again.', 409);
    importedIds.add(id);
    const filename = readableFilename(String(item.filename || 'photo.jpg'));
    const values = matchExistingGroups(normalizeDetails(item, { alt: filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '), collection: 'uncategorized', album: null }), photos);
    const locations = await allocateLocations(root, { id, ...values }, filename, owners, aliases);
    const source = locations.source;
    const photo = { id, src: locations.src, full: locations.full, ...values, category: values.collection, exif: cameraDetails(buffer), width: 0, height: 0 };
    await derivatives(buffer, photo, files);
    files.set('originals/' + source, buffer);
    photos.push(photo); settings.photos[id] = values;
    state[id] = { path: source, filename: path.basename(source), hash: hash(buffer) };
  }
  if (input.home) {
    const valid = new Set(photos.map(p => p.id));
    for (const key of ['selectedIds', 'heroIds']) {
      const ids = input.home[key];
      if (key === 'heroIds' && ids === null) continue;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => !valid.has(id)) || new Set(ids).size !== ids.length) throw new LibraryError('Keep at least one valid photo in Selected Works and the homepage rotation.');
    }
    settings.home = input.home;
  }
  // A second revision check catches external edits during image processing.
  if ((await loadLibrary(root)).revision !== library.revision) throw new LibraryError('The library changed during import. Reload and try again.', 409);
  files.set(CATALOG, json({ photos })); files.set(SETTINGS, json(settings)); files.set(STATE, json(state)); files.set(ALIASES, json(aliases));
  await commitFiles(root, files);
  await pruneMovedFolders(root, files);
  return loadLibrary(root);
}

/** Refresh changed sources, retain missing ones, and preserve authored metadata. */
export async function syncOriginals(root) {
  const library = await loadLibrary(root);
  const { glob } = await import('glob');
  const sources = await glob('**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', { cwd: inside(root, 'originals'), follow: false });
  if (!sources.length) throw new LibraryError('No source photos found. The existing catalog was left untouched.');
  const photos = library.photos.map(p => ({ ...p }));
  const state = structuredClone(library.state);
  const aliases = { ...library.aliases };
  const files = new Map(); const seen = new Set(); const warnings = []; const claimed = new Set();
  const sourceIndex = await originalIndex(root);
  const owners = ownersFor(photos, state, sourceIndex);
  const sourcePaths = new Set(sources);
  for (const rel of sources.sort()) {
    const buffer = await fs.readFile(inside(root, 'originals/' + rel));
    const fingerprint = hash(buffer);
    const legacyId = rel.replace(/\.[^/.]+$/, '').split('/').join('__');
    const tracked = Object.keys(state).find(id => state[id].path === rel);
    const renamed = Object.keys(state).find(id => state[id].hash === fingerprint && !sourcePaths.has(state[id].path) && !claimed.has(id));
    const knownId = tracked || renamed || (state[legacyId] ? 'photo_' + crypto.randomUUID() : legacyId);
    if (claimed.has(knownId)) throw new LibraryError(`Two source files map to ${knownId}. Give them different base filenames.`);
    claimed.add(knownId); seen.add(knownId);
    let photo = photos.find(p => p.id === knownId);
    const parts = rel.split('/');
    if (!photo) {
      const base = rel.replace(/\.[^.]+$/, '');
      photo = { id: knownId, src: `/images/thumbs/${base}.jpg`, full: `/images/full/${base}.jpg`, alt: `${parts.slice(0, -1).join(' ') || 'Uncategorized'} photograph`, collection: parts.length > 1 ? parts[0] : 'uncategorized', album: parts.length > 2 ? parts.slice(1, -1).join('/') : null, width: 0, height: 0, exif: '' };
      owners.set(pathKey('originals/' + rel), knownId);
      const locations = await allocateLocations(root, photo, readableFilename(rel), owners, aliases);
      photo.src = locations.src; photo.full = locations.full;
      photos.push(photo);
    }
    Object.assign(photo, library.settings.photos[knownId] || {});
    photo.category = photo.collection;
    const destinations = [photo.src, photo.full].flatMap(p => ['public' + p, 'public' + p.replace(/\.jpg$/i, '.webp')]);
    const missing = (await Promise.all(destinations.map(p => fs.access(inside(root, p)).then(() => false, () => true)))).some(Boolean);
    if (state[knownId]?.hash !== fingerprint || missing) {
      await derivatives(buffer, photo, files); photo.exif = cameraDetails(buffer);
    }
    state[knownId] = { ...state[knownId], path: rel, hash: fingerprint };
  }
  for (const photo of photos) if (!seen.has(photo.id)) warnings.push(`Source missing: ${photo.id}; retained its existing website entry.`);
  for (const photo of photos) if (seen.has(photo.id)) await organizePhoto(root, photo, state, sourceIndex, owners, aliases, files);
  photos.sort((a,b) => a.id.localeCompare(b.id));
  if ((await loadLibrary(root)).revision !== library.revision) throw new LibraryError('Library changed during processing. No files saved.', 409);
  files.set(CATALOG, json({ photos })); files.set(STATE, json(state)); files.set(ALIASES, json(aliases));
  await commitFiles(root, files); await pruneMovedFolders(root, files);
  return { count: photos.length, warnings };
}

/** Single writer lock shared by manager and CLI; stale process locks recover safely. */
export async function withLibraryLock(root, action) {
  const lock = inside(root, '.photo-manager/write.lock');
  await fs.mkdir(path.dirname(lock), { recursive: true });
  let handle;
  try { handle = await fs.open(lock, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await fs.readFile(lock, 'utf8'));
    try { process.kill(pid, 0); throw new LibraryError('Another photo import or save is running. Try again when it finishes.', 409); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await fs.rm(lock); return withLibraryLock(root, action);
  }
  await handle.writeFile(String(process.pid));
  try { await recoverSaves(root); return await action(); }
  finally { await handle.close(); await fs.rm(lock, { force: true }); }
}

const ALIASES = 'src/data/photo-path-aliases.json';
const pathKey = value => value.normalize('NFC').toLocaleLowerCase('en-US');
function photoFiles(photo) {
  return [photo.src, photo.full].flatMap(value => ['public' + value, 'public' + value.replace(/\.jpg$/i, '.webp')]);
}
function readableFilename(filename, id = '') {
  let name = path.basename(filename);
  if (id && name.startsWith(id + '-')) name = name.slice(id.length + 1);
  name = name.replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/^\.+/, '');
  if (!/\.(jpe?g|png|webp)$/i.test(name)) throw new LibraryError('Use JPEG, PNG, or WebP source filenames.');
  return name;
}
async function originalIndex(root) {
  const { glob } = await import('glob');
  const paths = await glob('**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', { cwd: inside(root, 'originals'), follow: false });
  const index = new Map();
  for (const rel of paths) {
    const id = rel.replace(/\.[^/.]+$/, '').split('/').join('__');
    if (index.has(id)) throw new LibraryError(`Source filenames conflict: ${rel}. Give the photos different base names first.`);
    index.set(id, rel);
  }
  return index;
}
async function sourceFor(root, photo, state, index) {
  const rel = state[photo.id]?.path || index.get(photo.id);
  if (!rel || !(await fs.stat(inside(root, 'originals/' + rel)).catch(() => null))?.isFile()) throw new LibraryError(`Cannot organize ${photo.id}: its original is missing. Restore the source file first. No changes saved.`);
  return rel;
}
function ownersFor(photos, state, index) {
  const owners = new Map();
  for (const photo of photos) {
    for (const rel of photoFiles(photo)) owners.set(pathKey(rel), photo.id);
    const source = state[photo.id]?.path || index.get(photo.id);
    if (source) owners.set(pathKey('originals/' + source), photo.id);
  }
  return owners;
}
async function allocateLocations(root, photo, filename, owners, aliases) {
  const folders = [group(photo.collection), ...(photo.album ? photo.album.split('/').map(name => group(name)) : [])].join('/');
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  for (let suffix = 0; suffix < 10000; suffix++) {
    const base = `${stem}${suffix ? '-' + (suffix + 1) : ''}`;
    const locations = { source: `${folders}/${base}${extension}`, src: `/images/thumbs/${folders}/${base}.jpg`, full: `/images/full/${folders}/${base}.jpg` };
    const paths = ['originals/' + locations.source, ...photoFiles(locations)];
    let available = true;
    for (const rel of paths) {
      const owner = owners.get(pathKey(rel));
      const aliasTarget = aliases[rel.replace(/^public/, '')];
      const aliasOwner = aliasTarget ? owners.get(pathKey('public' + aliasTarget)) : undefined;
      if ((owner && owner !== photo.id) || (aliasTarget && aliasOwner !== photo.id) || (!owner && await fs.stat(inside(root, rel)).catch(() => null))) { available = false; break; }
    }
    if (available) {
      for (const rel of paths) owners.set(pathKey(rel), photo.id);
      return locations;
    }
  }
  throw new LibraryError('Too many photos with the same name in this album. Rename the incoming file first.');
}
function rememberAlias(aliases, from, to) {
  if (from === to) return;
  for (const key of Object.keys(aliases)) if (aliases[key] === from) aliases[key] = to;
  delete aliases[to];
  aliases[from] = to;
}
async function moveIntoPlan(root, from, to, files) {
  if (from === to) return;
  const data = files.has(from) ? files.get(from) : await fs.readFile(inside(root, from));
  if (!data) throw new LibraryError(`Cannot move ${from}: another pending move uses it.`);
  files.set(to, data); files.set(from, null);
}
async function organizePhoto(root, photo, state, index, owners, aliases, files) {
  const source = await sourceFor(root, photo, state, index);
  const filename = readableFilename(state[photo.id]?.filename || source, photo.id);
  const locations = await allocateLocations(root, photo, filename, owners, aliases);
  const original = await fs.readFile(inside(root, 'originals/' + source));
  await moveIntoPlan(root, 'originals/' + source, 'originals/' + locations.source, files);
  const oldPaths = photoFiles(photo); const newPaths = photoFiles(locations);
  for (let i = 0; i < oldPaths.length; i++) {
    await moveIntoPlan(root, oldPaths[i], newPaths[i], files);
    rememberAlias(aliases, oldPaths[i].replace(/^public/, ''), newPaths[i].replace(/^public/, ''));
  }
  photo.src = locations.src; photo.full = locations.full;
  state[photo.id] = { path: locations.source, filename: path.basename(locations.source), hash: hash(original) };
}
async function pruneMovedFolders(root, files) {
  const boundaries = ['originals', 'public/images/thumbs', 'public/images/full'].map(rel => inside(root, rel));
  for (const [rel, data] of files) {
    if (data !== null) continue;
    let folder = path.dirname(inside(root, rel));
    while (boundaries.some(base => folder.startsWith(base + path.sep))) {
      try { await fs.rmdir(folder); } catch { break; }
      folder = path.dirname(folder);
    }
  }
}
/** One-time normalization also available after changing organization outside the manager. */
export async function organizeLibrary(root) {
  const library = await loadLibrary(root);
  const photos = structuredClone(library.photos); const state = structuredClone(library.state);
  const aliases = { ...library.aliases }; const files = new Map();
  const index = await originalIndex(root); const owners = ownersFor(photos, state, index);
  for (const photo of photos) await organizePhoto(root, photo, state, index, owners, aliases, files);
  if ((await loadLibrary(root)).revision !== library.revision) throw new LibraryError('Library changed during organization. No files saved.', 409);
  const moved = [...files.values()].filter(value => value === null).length;
  files.set(CATALOG, json({ photos })); files.set(STATE, json(state)); files.set(ALIASES, json(aliases));
  await commitFiles(root, files); await pruneMovedFolders(root, files);
  return { count: photos.length, moved };
}
