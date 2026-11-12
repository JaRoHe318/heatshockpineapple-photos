import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placementForPhoto,placementChanged,withoutDraft,onHomepage } from '../scripts/photo-manager/ui/editor-state.js';
test('saving one import includes its choices without applying other pending homepage changes',()=>{
 const saved={selectedIds:['a'],heroIds:['a']};
 const current={selectedIds:['b','new'],heroIds:['b','new']};
 assert.deepEqual(placementForPhoto(current,saved,'new',['a','b']),{selectedIds:['a','new'],heroIds:['a','new']});
 assert.equal(placementChanged(current,saved,'new'),true);
 assert.deepEqual(saved,{selectedIds:['a'],heroIds:['a']});
});
test('the default rotation can exclude an unsaved import on its first save',()=>{
 const saved={selectedIds:['a'],heroIds:null};const current={selectedIds:['a','new'],heroIds:['a','other-draft']};
 assert.deepEqual(placementForPhoto(current,saved,'new',['a']),{selectedIds:['a','new'],heroIds:['a']});
 assert.equal(onHomepage(saved,'new','heroIds'),true);
});
test('removing a draft also removes its homepage references',()=>{
 assert.deepEqual(withoutDraft({selectedIds:['a','new'],heroIds:['a','new']},'new',['a']),{selectedIds:['a'],heroIds:null});
});
