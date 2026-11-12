import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { launchManager, findRunningManager } from '../scripts/photo-manager/launcher.mjs';
import { withLibraryLock } from '../scripts/photo-manager/library.mjs';
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hsp-launcher-'));
 await fs.mkdir(path.join(root,'src/data'),{recursive:true});await fs.writeFile(path.join(root,'src/data/photos.json'),JSON.stringify({photos:[]}));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}
test('relaunch reuses the same manager even during a library write, without changing files',async t=>{
 const root=await fixture(t);const before=await fs.readFile(path.join(root,'src/data/photos.json'));
 const first=await launchManager({root,port:0,openBrowser:false});t.after(()=>first.manager.close());assert.equal(first.reused,false);
 const port=first.manager.server.address().port;
 const second=await withLibraryLock(root,()=>launchManager({root,port,openBrowser:false}));
 assert.equal(second.reused,true);assert.equal(second.url,first.url);assert.equal(second.manager,undefined);
 assert.deepEqual(await fs.readFile(path.join(root,'src/data/photos.json')),before);
 assert.ok((await (await fetch(first.url+'/api/health')).json()).projectId);
 const other=await fixture(t);await assert.rejects(launchManager({root:other,port,openBrowser:false}),/another application or a manager for another folder/);
 assert.equal((await fetch(first.url+'/api/library')).status,200);
});
test('an unrelated service is left running and never treated as the photo manager',async t=>{
 const root=await fixture(t);const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({app:'another-app'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port;assert.equal(await findRunningManager({root,port}),null);
 await assert.rejects(launchManager({root,port,openBrowser:false}),/another application/);
 assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200);
});
