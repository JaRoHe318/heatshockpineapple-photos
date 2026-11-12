import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeImageAliases } from '../scripts/photo-manager/image-aliases.mjs';
test('build preserves old image URLs as exact copies, blocks traversal and canonical conflicts',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hsp-aliases-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.mkdir(path.join(dir,'images/full/Cities/Guatemala'),{recursive:true});const file='images/full/Cities/Guatemala/photo.jpg';await fs.writeFile(path.join(dir,file),'test image bytes');
 await writeImageAliases(dir,{'/images/full/managed/old-id.jpg':'/'+file});
 assert.equal(await fs.readFile(path.join(dir,'images/full/managed/old-id.jpg'),'utf8'),'test image bytes');
 await assert.rejects(writeImageAliases(dir,{'/images/full/managed/old-id.jpg':'/'+file}),/conflicts/);
 await assert.rejects(writeImageAliases(dir,{'/images/full/../../../outside.jpg':'/'+file}),/Invalid/);
});
