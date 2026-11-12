import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { loadLibrary, saveLibrary, syncOriginals, withLibraryLock, recoverSaves, inside, organizeLibrary } from '../scripts/photo-manager/library.mjs';
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hsp-photos-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'src/data'),{recursive:true});
 await fs.writeFile(path.join(root,'src/data/photos.json'),JSON.stringify({photos:[{id:'existing',src:'/images/thumbs/existing.jpg',full:'/images/full/existing.jpg',alt:'An existing photograph',caption:'Keep this caption.',collection:'Street',album:null,width:100,height:80}]}));
 await fs.writeFile(path.join(root,'src/data/photo-settings.json'),JSON.stringify({version:1,photos:{},home:{selectedIds:['existing'],heroIds:null}}));
 await fs.mkdir(path.join(root,'originals'),{recursive:true});
 const bytes=await image('gray');await fs.writeFile(path.join(root,'originals/existing.jpeg'),bytes);
 for(const folder of ['thumbs','full']){await fs.mkdir(path.join(root,'public/images',folder),{recursive:true});for(const ext of ['jpg','webp'])await fs.writeFile(path.join(root,'public/images',folder,'existing.'+ext),bytes);}
 return root;
}

const payload = library => ({revision:library.revision,edits:[],imports:[],home:library.settings.home});
const image = color => sharp({create:{width:120,height:80,channels:3,background:color}}).jpeg().toBuffer();
test('metadata persists independently, stale saves are rejected, and paths are confined',async t=>{
 const root=await fixture(t);const library=await loadLibrary(root);
 const next=await saveLibrary(root,{...payload(library),edits:[{id:'existing',alt:'A meaningful description',caption:'Authored caption',collection:'Cities',album:'Los Angeles'}]});
 assert.equal(next.photos[0].alt,'A meaningful description');assert.equal(next.settings.photos.existing.caption,'Authored caption');
 await assert.rejects(saveLibrary(root,payload(library)),/changed since/);
 assert.throws(()=>inside(root,'../outside'),/Invalid/);
 assert.equal(next.photos[0].album,'Los Angeles');
});
test('valid imports generate all four derivatives, original source, and stable IDs',async t=>{
 const root=await fixture(t);const library=await loadLibrary(root);const buffer=await image('red');
 const next=await saveLibrary(root,{...payload(library),imports:[{filename:'chicago.jpg',data:buffer.toString('base64'),collection:'Cities',album:'Chicago',alt:'Red test image',caption:'My caption'}]});
 const imported=next.photos[1];assert.match(imported.id,/^photo_/);assert.equal(imported.width,120);
 for(const file of [imported.src,imported.full])for(const ext of ['.jpg','.webp'])assert.ok((await fs.stat(path.join(root,'public',file.replace(/^\//,'').replace(/\.jpg$/,ext)))).size>0);
 assert.deepEqual(await fs.readFile(path.join(root,'originals',next.state[imported.id].path)),buffer);
 assert.equal((await sharp(path.join(root,'public',imported.full)).metadata()).exif,undefined);
 await fs.rename(path.join(root,'originals',next.state[imported.id].path),path.join(root,'originals/renamed.jpg'));
 await syncOriginals(root);const renamed=await loadLibrary(root);
 assert.equal(renamed.photos.find(p=>p.id===imported.id).caption,'My caption');assert.equal(renamed.state[imported.id].path,'Cities/Chicago/chicago.jpg');
 await fs.writeFile(path.join(root,'originals',renamed.state[imported.id].path),await image('blue'));
 const previous=await fs.readFile(path.join(root,'public',imported.full));await syncOriginals(root);
 assert.notDeepEqual(await fs.readFile(path.join(root,'public',imported.full)),previous);
});
test('invalid import or corrupt source leaves all existing catalog and generated files untouched',async t=>{
 const root=await fixture(t);const library=await loadLibrary(root);const before=await fs.readFile(path.join(root,'src/data/photos.json'));
 await assert.rejects(saveLibrary(root,{...payload(library),imports:[{filename:'bad.jpg',data:Buffer.from('invalid image').toString('base64'),collection:'Street',album:null,alt:'Test'}]}));
 assert.deepEqual(await fs.readFile(path.join(root,'src/data/photos.json')),before);
 await fs.mkdir(path.join(root,'originals'),{recursive:true});await fs.writeFile(path.join(root,'originals/broken.jpg'),'bad data');
 await assert.rejects(syncOriginals(root));assert.deepEqual(await fs.readFile(path.join(root,'src/data/photos.json')),before);
});
test('missing sources are retained and interrupted transactions recover',async t=>{
 const root=await fixture(t);await fs.mkdir(path.join(root,'originals'),{recursive:true});await fs.writeFile(path.join(root,'originals/new.jpg'),await image('red'));
 await fs.rm(path.join(root,'originals/existing.jpeg'));
 const result=await syncOriginals(root);assert.equal(result.count,2);assert.match(result.warnings[0],/retained/);
 const tx=path.join(root,'.photo-manager/transactions/interrupted');await fs.mkdir(tx,{recursive:true});
 await fs.writeFile(path.join(tx,'0.before'),'original');await fs.writeFile(path.join(root,'recover.txt'),'partial');
 await fs.writeFile(path.join(tx,'manifest.json'),JSON.stringify({phase:'applying',entries:[{rel:'recover.txt',existed:true}]}));
 await recoverSaves(root);assert.equal(await fs.readFile(path.join(root,'recover.txt'),'utf8'),'original');
 await withLibraryLock(root,async()=>{await assert.rejects(withLibraryLock(root,()=>{}),/Another photo import/);});
});

test('organization preserves every photo identity, byte, caption, and homepage selection',async t=>{
 const root=await fixture(t);const before=await loadLibrary(root);
 const source=await fs.readFile(path.join(root,'originals/existing.jpeg'));
 const result=await organizeLibrary(root);assert.equal(result.moved,5);
 const next=await loadLibrary(root);assert.equal(next.photos[0].id,'existing');assert.equal(next.photos[0].caption,'Keep this caption.');
 assert.deepEqual(next.settings,before.settings);assert.deepEqual(await fs.readFile(path.join(root,'originals/Street/existing.jpeg')),source);
 assert.equal(next.photos[0].full,'/images/full/Street/existing.jpg');
 assert.equal(next.aliases['/images/full/existing.jpg'],next.photos[0].full);
 await assert.rejects(fs.stat(path.join(root,'originals/existing.jpeg')), {code:'ENOENT'});
 assert.equal((await organizeLibrary(root)).moved,0);
 assert.equal((await loadLibrary(root)).revision,next.revision);
});
test('same-named imports use readable collision suffixes; album edits move all files and flatten old links',async t=>{
 const root=await fixture(t);let library=await loadLibrary(root);const bytes=(await image('red')).toString('base64');
 const item={filename:'IMG_100.JPG',data:bytes,collection:'Cities',album:'Guatemala',alt:'A test photo'};
 library=await saveLibrary(root,{...payload(library),imports:[item,{...item,filename:'IMG_100.jpeg',collection:'cities',album:'guatemala'}]});
 const [first,second]=library.photos.slice(1);assert.equal(first.full,'/images/full/Cities/Guatemala/IMG_100.jpg');assert.equal(second.full,'/images/full/Cities/Guatemala/IMG_100-2.jpg');
 assert.equal(second.collection,'Cities');assert.equal(second.album,'Guatemala');
 const oldSource=library.state[first.id].path;
 library=await saveLibrary(root,{...payload(library),edits:[{id:first.id,album:'Antigua'}]});
 const moved=library.photos.find(p=>p.id===first.id);assert.equal(moved.full,'/images/full/Cities/Antigua/IMG_100.jpg');
 await assert.rejects(fs.stat(path.join(root,'originals',oldSource)),{code:'ENOENT'});
 assert.ok(await fs.stat(path.join(root,'originals/Cities/Antigua/IMG_100.JPG')));
 assert.equal(library.aliases[first.full],moved.full);
 library=await saveLibrary(root,{...payload(library),edits:[{id:first.id,album:'Antigua Again'}]});
 assert.equal(library.aliases[first.full],'/images/full/Cities/Antigua Again/IMG_100.jpg');
});
test('missing source blocks an album move without losing any catalog metadata',async t=>{
 const root=await fixture(t);await fs.rm(path.join(root,'originals/existing.jpeg'));const before=await loadLibrary(root);
 await assert.rejects(saveLibrary(root,{...payload(before),edits:[{id:'existing',album:'Missing'}]}),/original is missing/);
 assert.equal((await loadLibrary(root)).revision,before.revision);
});

test('folder sync treats a reused legacy filename or duplicate copy as a new photo, preserving old links',async t=>{
 const root=await fixture(t);await organizeLibrary(root);const before=await loadLibrary(root);
 const original=await fs.readFile(path.join(root,'originals/Street/existing.jpeg'));
 await fs.writeFile(path.join(root,'originals/existing.jpeg'),await image('blue'));
 await syncOriginals(root);let next=await loadLibrary(root);assert.equal(next.photos.length,2);
 assert.equal(next.photos.find(p=>p.id==='existing').collection,'Street');
 assert.deepEqual(await fs.readFile(path.join(root,'originals/Street/existing.jpeg')),original);
 assert.equal(next.aliases['/images/full/existing.jpg'],'/images/full/Street/existing.jpg');
 await fs.writeFile(path.join(root,'originals/copy.jpeg'),original);await syncOriginals(root);
 next=await loadLibrary(root);assert.equal(next.photos.length,3);
});

test('a new import and its homepage placement save together with a stable client ID',async t=>{
 const root=await fixture(t);const before=await loadLibrary(root);
 const id='photo_623e5cc0-26ee-4f00-9acc-30f4657011ab';
 const item={id,filename:'new-photo.jpg',data:(await image('green')).toString('base64'),collection:'Cities',album:'Guatemala',alt:'A new photograph'};
 const next=await saveLibrary(root,{...payload(before),imports:[item],home:{selectedIds:['existing',id],heroIds:[id]}});
 assert.equal(next.photos.find(p=>p.id===id).album,'Guatemala');
 assert.deepEqual(next.settings.home,{selectedIds:['existing',id],heroIds:[id]});
 await assert.rejects(saveLibrary(root,{...payload(next),imports:[item]}),/already in the library/);
 assert.equal((await loadLibrary(root)).revision,next.revision);
});
test('invalid client IDs leave the catalog unchanged',async t=>{
 const root=await fixture(t);const before=await loadLibrary(root);
 await assert.rejects(saveLibrary(root,{...payload(before),imports:[{id:'../bad',filename:'test.jpg',data:(await image('blue')).toString('base64'),alt:'Test',collection:'Street'}]}),/Invalid photo identifier/);
 assert.equal((await loadLibrary(root)).revision,before.revision);
});
