import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
function imagePath(directory, url) {
  if (typeof url !== 'string' || !/^\/images\/(full|thumbs)\/.+\.(jpg|webp)$/i.test(url)) throw new Error('Invalid legacy image address.');
  const file = path.resolve(directory, '.' + url);
  if (!file.startsWith(path.resolve(directory) + path.sep)) throw new Error('Invalid legacy image path.');
  return file;
}
/** Keep old shared image URLs working without cluttering the public source folders. */
export async function writeImageAliases(directory, aliases) {
  for (const [from, to] of Object.entries(aliases)) {
    if (from === to) continue;
    const source = imagePath(directory, to); const dest = imagePath(directory, from);
    if (await fs.stat(dest).catch(() => null)) throw new Error(`A legacy image address conflicts with a current image: ${from}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(source, dest);
  }
}
export default function imageAliases() {
  return { name: 'preserve-photo-addresses', hooks: { 'astro:build:done': async ({dir}) => {
    const settings = new URL('../../src/data/photo-path-aliases.json', import.meta.url);
    let aliases = {};
    try { aliases = JSON.parse(await fs.readFile(settings,'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
    await writeImageAliases(fileURLToPath(dir), aliases);
  } } };
}
