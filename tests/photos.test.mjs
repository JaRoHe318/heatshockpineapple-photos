import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shuffledSample } from '../src/lib/photos.mjs';
test('sampling preserves the catalog, returns unique items, and caps the sample', () => {
  const source = Object.freeze([1, 2, 3, 4]);
  const sample = shuffledSample(source, 3, () => 0);
  assert.deepEqual(source, [1, 2, 3, 4]);
  assert.equal(sample.length, 3);
  assert.equal(new Set(sample).size, 3);
  assert.deepEqual(shuffledSample([], 15), []);
  assert.equal(shuffledSample(source, 15).length, 4);
});
