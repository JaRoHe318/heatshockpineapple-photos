import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startManager } from '../scripts/photo-manager/server.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture() {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hsp-quit-'));
 await fs.mkdir(path.join(root,'src/data'),{recursive:true});
 await fs.writeFile(path.join(root,'src/data/photos.json'),JSON.stringify({photos:[{id:'one',src:'/images/thumbs/one.jpg',full:'/images/full/one.jpg',alt:'Before',collection:'Street',album:null}]}));
 return root;
}
const headers=(url,token)=>({'Content-Type':'application/json',Origin:url,'X-Photo-Manager-Token':token});
async function until(predicate) { for(let i=0;i<200;i++){if(await predicate())return;await sleep(10);}throw new Error('Timed out waiting for shutdown state.'); }
function slowSave(url,token,revision) {
 const data=JSON.stringify({revision,edits:[{id:'one',alt:'Saved before shutdown',collection:'Street',album:null}],imports:[]});
 let req;
 const response=new Promise((resolve,reject)=>{
  req=http.request(url+'/api/save',{method:'POST',headers:headers(url,token)},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});req.on('error',reject);req.write(data.slice(0,10));
 });
 return {response,finish:()=>req.end(data.slice(10))};
}
test('Quit requires local authorization and closes manager plus preview listeners',async t=>{
 const root=await fixture();const manager=await startManager({root,port:0});
 t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true});});
 const previewURL=`http://127.0.0.1:${manager.preview.address().port}/`;
 const library=await(await fetch(manager.url+'/api/library')).json();
 for(const bad of [{Origin:'https://example.com','X-Photo-Manager-Token':library.token},{Origin:manager.url}])assert.equal((await fetch(manager.url+'/api/quit',{method:'POST',headers:{'Content-Type':'application/json',...bad},body:'{}'})).status,403);
 const response=await fetch(manager.url+'/api/quit',{method:'POST',headers:headers(manager.url,library.token),body:'{}'});assert.equal(response.status,200);assert.equal((await response.json()).stopped,true);
 await manager.closed;await assert.rejects(fetch(manager.url+'/api/health'));await assert.rejects(fetch(previewURL));
});
test('Quit drains an accepted upload and save before closing, and rejects new writes',async t=>{
 const root=await fixture();const manager=await startManager({root,port:0});
 t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true});});
 const library=await(await fetch(manager.url+'/api/library')).json();const upload=slowSave(manager.url,library.token,library.revision);
 await until(async()=> (await(await fetch(manager.url+'/api/health')).json()).activeOperations===1);
 let quitDone=false;const quitting=fetch(manager.url+'/api/quit',{method:'POST',headers:headers(manager.url,library.token),body:'{}'}).then(res=>{quitDone=true;return res;});
 await until(async()=> (await(await fetch(manager.url+'/api/health')).json()).stopping);
 assert.equal(quitDone,false);assert.equal((await fetch(manager.url+'/api/save',{method:'POST',headers:headers(manager.url,library.token),body:'{}'})).status,503);
 upload.finish();assert.equal((await upload.response).status,200);assert.equal((await quitting).status,200);await manager.closed;
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'src/data/photos.json'),'utf8')).photos[0].alt,'Saved before shutdown');
});
async function launchCLI(t) {
 const root=await fixture();const files=['server.mjs','launcher.mjs','identity.mjs','library.mjs'];const dir=path.join(root,'scripts/photo-manager');await fs.mkdir(dir,{recursive:true});
 for(const file of files)await fs.copyFile(fileURLToPath(new URL('../scripts/photo-manager/'+file,import.meta.url)),path.join(dir,file));
 await fs.symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
 const child=spawn(process.execPath,[path.join(dir,'server.mjs'),'--no-open'],{cwd:root,env:{...process.env,PHOTO_MANAGER_PORT:'0'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}await fs.rm(root,{recursive:true,force:true});});
 let output='';const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CLI did not start. '+output)),5000);child.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',data=>output+=data);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('CLI exited before startup. '+output));});});
 return {child,url,root};
}
async function exitNormally(child) {
 if(child.exitCode!==null){assert.equal(child.exitCode,0);return;}
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CLI stayed running after shutdown.')),5000);child.once('exit',(code,signal)=>{clearTimeout(timer);code===0 && !signal ? resolve() : reject(new Error(`Exit ${code}, signal ${signal}`));});});
}
test('Control+C finishes an accepted save and exits the actual CLI process',async t=>{
 const {child,url,root}=await launchCLI(t);const library=await(await fetch(url+'/api/library')).json();const upload=slowSave(url,library.token,library.revision);
 await until(async()=> (await(await fetch(url+'/api/health')).json()).activeOperations===1);
 child.kill('SIGINT');await until(async()=> (await(await fetch(url+'/api/health')).json()).stopping);
 upload.finish();assert.equal((await upload.response).status,200);await exitNormally(child);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'src/data/photos.json'),'utf8')).photos[0].alt,'Saved before shutdown');
});
for(const signal of ['SIGTERM','SIGHUP'])test(`${signal} closes the CLI process cleanly`,async t=>{const {child}=await launchCLI(t);child.kill(signal);await exitNormally(child);});
