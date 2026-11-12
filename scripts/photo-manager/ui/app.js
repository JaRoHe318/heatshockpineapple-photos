import { onHomepage, placementChanged, placementForPhoto, withoutDraft } from './editor-state.js';
const $ = selector => document.querySelector(selector);
let photos = [], home, revision, token, selectedId = null, baselineHome, busy = false;
const edits = new Map();
const drafts = new Map();
let importFiles = [];
let editorFrame;
function sizeEditor() {
  const editor = $('#inspector');
  if (!editor) return;
  if (matchMedia('(max-width:760px)').matches) editor.style.removeProperty('--editor-top');
  else editor.style.setProperty('--editor-top', `${Math.max(20,editor.getBoundingClientRect().top)}px`);
}
function scheduleEditorSize() {
  cancelAnimationFrame(editorFrame);
  editorFrame = requestAnimationFrame(sizeEditor);
}
window.addEventListener('resize',scheduleEditorSize);
window.addEventListener('scroll',scheduleEditorSize,{passive:true});
const pending = () => edits.size + drafts.size + (JSON.stringify(home) !== baselineHome ? 1 : 0);
function message(text) { $('#notice').textContent = text; if ($('.editor-status')) $('.editor-status').textContent = text; scheduleEditorSize(); }
function error(text = '') {
  const inline = $('.editor-error');
  $('#error').hidden = !text || Boolean(inline); $('#error').textContent = text;
  if (inline) { inline.hidden = !text; inline.textContent = text; }
}
function photoPending(id) { return Boolean(id) && (drafts.has(id) || edits.has(id) || placementChanged(home, JSON.parse(baselineHome), id)); }
function setBusy(value) {
  busy = value;
  for (const id of ['#save','#add','#preview']) $(id).disabled = value || (id === '#save' && !pending());
  $('#save').textContent = value ? 'Working…' : pending() ? 'Save all changes' : 'All changes saved';
  $('#details-form')?.querySelectorAll('input,textarea').forEach(el => el.disabled = value);
  const photoSave = $('#save-photo');
  if (photoSave) { photoSave.disabled = value || !photoPending(selectedId); photoSave.textContent = value ? 'Working…' : drafts.has(selectedId) ? 'Save import' : 'Save photo'; }
  if ($('.remove-draft')) $('.remove-draft').disabled = value;
}
function updateSave() {
  setBusy(busy);
  if (!busy) message(pending() ? `${edits.size} photo edit${edits.size === 1 ? '' : 's'} · ${drafts.size} new import${drafts.size === 1 ? '' : 's'}${JSON.stringify(home) !== baselineHome ? ' · Homepage selection changed' : ''}. Save to update local website files.` : `${photos.length} photos on this Mac. Select a photo to explore or edit it. Nothing is published automatically.`);
  if (!busy && $('.editor-status')) $('.editor-status').textContent = photoPending(selectedId) ? 'Unsaved changes to this photo.' : 'This photo is saved locally.';
}
async function request(url, data) {
  const response = await fetch(url, data === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json','X-Photo-Manager-Token':token},body:JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The action could not be completed.');
  return result;
}
function adopt(library) {
  photos = library.photos;
  home = structuredClone(library.home);
  revision = library.revision;
  if (library.token) token = library.token;
  baselineHome = JSON.stringify(home);
  edits.clear();
  for (const draft of drafts.values()) URL.revokeObjectURL(draft.src);
  drafts.clear();
  refreshLists(); renderGrid(); updateSave();
  if (selectedId && photos.some(p=>p.id === selectedId)) renderDetails(selectedId);
  else if (selectedId) closeDetails();
}
function collectionNames() { return [...new Set([...photos,...drafts.values()].map(p=>p.collection))].sort((a,b)=>a.localeCompare(b)); }
function options(element, values, label) {
  const old = element.value; element.replaceChildren();
  if (label !== undefined) element.add(new Option(label,''));
  for (const value of values) element.append(new Option(value,value));
  element.value = values.includes(old) ? old : '';
}
function refreshLists() {
  const names = collectionNames();
  options($('#collection'),names,'All collections');
  options($('#collections'),names);
  options($('#albums'),[...new Set([...photos,...drafts.values()].map(p=>p.album).filter(Boolean))].sort());
}
function renderGrid() {
  const query = $('#search').value.trim().toLowerCase();
  const collection = $('#collection').value;
  const view = $('#view').value;
  const all = [...drafts.values(),...photos];
  const filtered = all.filter(p => (!collection || p.collection === collection) && (!query || [p.alt,p.caption,p.album,p.collection,p.exif,p.full,p.filename].filter(Boolean).join(' ').toLowerCase().includes(query)) && (view === 'all' || (view === 'selected' && home.selectedIds.includes(p.id)) || (view === 'hero' && onHomepage(home,p.id,'heroIds')) || (view === 'pending' && drafts.has(p.id))));
  const fragment = document.createDocumentFragment();
  for (const photo of filtered) {
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'photo-tile'; tile.dataset.id = photo.id;
    tile.setAttribute('aria-pressed',String(photo.id === selectedId));
    tile.setAttribute('aria-label', `Edit ${photo.alt || photo.filename}`);
    const wrap = document.createElement('div'); wrap.className = 'thumb-wrap';
    const img = document.createElement('img'); img.src = drafts.has(photo.id) ? photo.src : photo.src.replace(/\.jpe?g$/i,'.webp'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.width = 300; img.height = 225; wrap.append(img);
    if (drafts.has(photo.id) || home.selectedIds.includes(photo.id)) { const badge = document.createElement('span'); badge.className = 'tile-badge'; badge.textContent = drafts.has(photo.id) ? 'NEW · UNSAVED' : '★ SELECTED WORKS'; wrap.append(badge); }
    const caption = document.createElement('div'); caption.className = 'tile-caption';
    const title = document.createElement('strong'); title.textContent = photo.alt || photo.filename;
    const meta = document.createElement('small'); meta.textContent = [photo.collection,photo.album].filter(Boolean).join(' / ');
    caption.append(title,meta);tile.append(wrap,caption);tile.addEventListener('click',()=>renderDetails(photo.id)); fragment.append(tile);
  }
  $('#grid').replaceChildren(fragment); $('#empty').hidden = filtered.length > 0;
  $('#count').textContent = `${filtered.length} OF ${all.length} PHOTOS${drafts.size ? ` · ${drafts.size} UNSAVED` : ''}`;
}
function closeDetails() {
  selectedId = null;
  $('#inspector').replaceChildren();
  const placeholder = document.createElement('div'); placeholder.className = 'inspector-placeholder';
  const title = document.createElement('h2');title.textContent = 'Your photos, in focus.';
  const text = document.createElement('p');text.textContent = 'Select any photo to see it larger and edit its details.'; placeholder.append(title,text);$('#inspector').append(placeholder);renderGrid();error($('#error').textContent);
}
function renderDetails(id) {
  if (busy) return;
  const photo = drafts.get(id) || photos.find(p=>p.id === id); if (!photo) return;
  selectedId = id;
  const fragment = $('#details-template').content.cloneNode(true);
  const form = fragment.querySelector('form');
  const img = fragment.querySelector('.detail-image'); img.src = photo.src; img.alt = photo.alt;
  fragment.querySelector('.filename').textContent = photo.filename || photo.originalPath?.split('/').pop() || decodeURIComponent(photo.full.split('/').pop());
  fragment.querySelector('.specs').textContent = drafts.has(id) ? 'Pending import · Original stays local' : `${photo.width} × ${photo.height}${photo.exif ? ' · ' + photo.exif : ''}`;
  const locations = fragment.querySelector('.file-locations');
  locations.hidden = drafts.has(id);
  if (!drafts.has(id)) {
    for (const [label, file] of [['Original', photo.originalPath || 'Original source not tracked yet'], ['Thumbnail', 'public' + photo.src], ['Full size', 'public' + photo.full]]) {
      const term = document.createElement('dt'); term.textContent = label;
      const value = document.createElement('dd'); value.textContent = file;
      locations.querySelector('dl').append(term, value);
    }
  }
  for (const name of ['alt','caption','collection','album']) form.elements.namedItem(name).value = photo[name] || '';
  form.elements.namedItem('selected').checked = home.selectedIds.includes(id);
  form.elements.namedItem('hero').checked = onHomepage(home,id,'heroIds');
  fragment.querySelector('.close-inspector').addEventListener('click',()=>{closeDetails();$('#search').focus();});
  fragment.querySelector('.photo-preview').addEventListener('click',()=> {
    $('#viewer-image').src = drafts.has(id) ? photo.src : photo.full; $('#viewer-image').alt = photo.alt; $('#viewer-caption').textContent = photo.caption || photo.alt; $('#viewer').showModal();
  });
  const remove = fragment.querySelector('.remove-draft'); remove.hidden = !drafts.has(id);
  remove.addEventListener('click',()=>{URL.revokeObjectURL(photo.src);drafts.delete(id);home=withoutDraft(home,id,[...photos,...drafts.values()].map(p=>p.id));closeDetails();refreshLists();updateSave();});
  form.addEventListener('submit',event=>{event.preventDefault();saveChanges(id);});
  form.addEventListener('input',event=>{
    const field = event.target;
    if (field.type === 'checkbox') return;
    error();
    photo[field.name] = field.value;
    if (!drafts.has(id)) edits.set(id,{id,alt:photo.alt,caption:photo.caption || '',collection:photo.collection,album:photo.album || ''});
    updateSave();
  });
  form.addEventListener('change',event=>{
    const field = event.target;
    if (field.type === 'checkbox') {
      if (field.name === 'selected') home.selectedIds = field.checked ? [...home.selectedIds,id] : home.selectedIds.filter(value=>value!==id);
      else { const current = home.heroIds || [...photos,...drafts.values()].map(p=>p.id);home.heroIds = field.checked ? [...current,id] : current.filter(value=>value!==id); }
    }
    refreshLists();renderGrid();updateSave();
  });
  $('#inspector').replaceChildren(fragment); $('#inspector').scrollTop = 0;
  setBusy(busy);
  $('.editor-status').textContent = photoPending(id) ? 'Unsaved changes to this photo.' : 'This photo is saved locally.';
  error($('#error').textContent);
  sizeEditor();
  $('#grid').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.id === id)));
  // The inspector is an inline panel on desktop, and a focusable sheet on narrow screens.
  if (matchMedia('(max-width:760px)').matches) $('#inspector .close-inspector').focus();
}
for (const selector of ['#search','#collection','#view']) $(selector).addEventListener(selector === '#search' ? 'input' : 'change',renderGrid);
function closeImport() { $('#import-dialog').close(); importFiles=[]; $('#import-form').reset(); $('#file-summary').textContent=''; $('#import-error').hidden=true; }
$('#add').addEventListener('click',()=>$('#import-dialog').showModal());
$('#close-import').addEventListener('click',closeImport);$('#cancel-import').addEventListener('click',closeImport);
function chooseFiles(files) { importFiles = Array.from(files); $('#file-summary').textContent = `${importFiles.length} photo${importFiles.length === 1 ? '' : 's'} chosen · ${(importFiles.reduce((sum,file)=>sum+file.size,0)/1024/1024).toFixed(1)} MB`; }
$('#files').addEventListener('change',event=>chooseFiles(event.target.files));
$('#drop-zone').addEventListener('dragover',event=>{event.preventDefault();$('#drop-zone').classList.add('dragging');});
$('#drop-zone').addEventListener('dragleave',()=>$('#drop-zone').classList.remove('dragging'));
$('#drop-zone').addEventListener('drop',event=>{event.preventDefault();$('#drop-zone').classList.remove('dragging');chooseFiles(event.dataTransfer.files);$('#files').required=false;});
function validGroup(name,optional=false) { return (!name && optional) || (/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u.test(name) && !/^(archive|index)$/i.test(name)); }
$('#import-form').addEventListener('submit',event=>{
  event.preventDefault();
  const fail = text=>{$('#import-error').textContent=text;$('#import-error').hidden=false;};
  if (!importFiles.length || importFiles.length + drafts.size > 20) return fail('Choose between 1 and 20 new photos per save.');
  const collection = $('#import-collection').value.trim();const album = $('#import-album').value.trim();
  if (!validGroup(collection) || !validGroup(album,true)) return fail('Use letters, numbers, spaces, hyphens, or underscores for names. “Archive” and “index” are reserved.');
  if (importFiles.some(file=>! /\.(jpe?g|png|webp)$/i.test(file.name) || file.size>40*1024*1024)) return fail('Use JPEG, PNG, or WebP files up to 40 MB each.');
  if ([...importFiles,...Array.from(drafts.values(),p=>p.file)].reduce((n,f)=>n+f.size,0)>100*1024*1024) return fail('Keep each batch under 100 MB.');
  let first;
  for (const file of importFiles) {
    const id = 'photo_' + crypto.randomUUID();if(!first)first=id;
    drafts.set(id,{id,file,filename:file.name,src:URL.createObjectURL(file),full:'',alt:file.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' '),caption:'',collection,album});
  }
  closeImport();$('#files').required=true;error();refreshLists();renderGrid();updateSave();renderDetails(first);
});
function readBase64(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read '+file.name));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);}); }
async function saveChanges(onlyId = null) {
  if (busy) return;
  error();
  const pendingEdits = onlyId ? (edits.has(onlyId) ? [edits.get(onlyId)] : []) : [...edits.values()];
  const pendingDrafts = onlyId ? (drafts.has(onlyId) ? [drafts.get(onlyId)] : []) : [...drafts.values()];
  for (const photo of [...pendingEdits,...pendingDrafts]) {
    if (!photo.alt.trim() || !validGroup(photo.collection.trim()) || !validGroup((photo.album || '').trim(),true)) {renderDetails(photo.id);error('Add an image description and valid collection/album names before saving.');return;}
  }
  const requestedHome = onlyId ? placementForPhoto(home,JSON.parse(baselineHome),onlyId,photos.map(p=>p.id)) : home;
  if (!requestedHome.selectedIds.length || (requestedHome.heroIds && !requestedHome.heroIds.length)) {error('Keep at least one photo in Selected Works and the featured photo rotation.');return;}
  setBusy(true);message('Preparing photos and saving local website files. Please keep this window open…');
  let saved = false;
  try {
    const imports=[];
    for (const photo of pendingDrafts) imports.push({id:photo.id,filename:photo.filename,data:await readBase64(photo.file),alt:photo.alt,caption:photo.caption,collection:photo.collection,album:photo.album});
    const library = await request('/api/save',{revision,edits:pendingEdits,imports,home:requestedHome});
    if (!onlyId) adopt(library);
    else {
      const draft = drafts.get(onlyId);
      if (draft) URL.revokeObjectURL(draft.src);
      drafts.delete(onlyId); edits.delete(onlyId);
      photos = library.photos.map(photo=>({...photo,...(edits.get(photo.id) || {})}));
      revision = library.revision; baselineHome = JSON.stringify(library.home);
      refreshLists(); renderGrid(); updateSave();
    }
    saved = true;
  } catch(cause) {error(cause.message);message('Your unsaved edits are still in this workspace.');}
  finally {setBusy(false);if(selectedId)renderDetails(selectedId);}
  if (saved) {
    const text = onlyId ? 'Photo saved locally.' : 'All changes saved locally.';
    $('#notice').textContent = text + (pending() ? ' Other changes are still pending.' : ' Preview the website, then publish with GitHub Desktop when ready.');
    if ($('.editor-status')) $('.editor-status').textContent = onlyId || !photoPending(selectedId) ? 'Saved locally.' : 'Unsaved changes to this photo.';
  }
}
$('#save').addEventListener('click',()=>saveChanges());
$('#preview').addEventListener('click',async()=>{
  error();if (pending()) {error('Save your changes first so the preview includes them.');return;}
  setBusy(true);message('Building a fresh website preview…');
  try {const result=await request('/api/preview',{});message('Preview ready. It shows your saved local files.');const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener';link.textContent='Open website preview ↗';link.className='preview-link';$('#notice').append(' ',link);}
  catch(cause){error(cause.message);message('Preview unavailable. Your library is still saved locally.');}
  finally{setBusy(false);}
});
$('#close-viewer').addEventListener('click',()=>$('#viewer').close());
window.addEventListener('beforeunload',event=>{if(pending()){event.preventDefault();event.returnValue='';}});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && !$('#viewer').open && !$('#import-dialog').open && selectedId)closeDetails();});
request('/api/library').then(adopt).catch(cause=>{error(cause.message);message('Could not load the library. Check that the local manager is running, then refresh.');});
