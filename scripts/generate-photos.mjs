import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncOriginals, withLibraryLock } from './photo-manager/library.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
withLibraryLock(root, () => syncOriginals(root)).then(result => {
  console.log(`✓ Photo library updated: ${result.count} photos.`);
  for (const warning of result.warnings) console.warn(warning);
}).catch(error => { console.error(`Photo import stopped: ${error.message}\nThe catalog is preserved; interrupted writes are recovered on the next run.`); process.exitCode = 1; });
