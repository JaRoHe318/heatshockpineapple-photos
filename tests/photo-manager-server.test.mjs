import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startManager } from '../scripts/photo-manager/server.mjs';
test('manager serves library but blocks cross-origin writes, missing tokens, and traversal',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hsp-manager-http-'));await fs.mkdir(path.join(root,'src/data'),{recursive:true});
 await fs.writeFile(path.join(root,'src/data/photos.json'),JSON.stringify({photos:[{id:'one',src:'/images/thumbs/one.jpg',full:'/images/full/one.jpg',alt:'One photo',collection:'Street',album:null}]}));
 const manager=await startManager({root,port:0});t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true});});
 const library=await (await fetch(manager.url+'/api/library')).json();assert.equal(library.photos.length,1);
 for(const headers of [{Origin:'https://example.com','X-Photo-Manager-Token':library.token},{Origin:manager.url}]){
  const response=await fetch(manager.url+'/api/save',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});assert.equal(response.status,403);
 }
 assert.equal((await fetch(manager.url+'/images/%2e%2e%2f%2e%2e%2fsrc/data/photos.json')).status,400);
 const response=await fetch(manager.url+'/api/save',{method:'POST',headers:{'Content-Type':'application/json',Origin:manager.url,'X-Photo-Manager-Token':library.token},body:JSON.stringify({revision:library.revision,edits:[{id:'one',alt:'Updated photo',collection:'Street',album:null}],imports:[]})});
 assert.equal(response.status,200);assert.equal((await response.json()).photos[0].alt,'Updated photo');
});
