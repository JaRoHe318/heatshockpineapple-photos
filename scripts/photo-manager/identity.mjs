import fs from 'node:fs/promises';
import crypto from 'node:crypto';
export const MANAGER_APP = 'heatshockpineapple-photo-manager';
export async function projectIdentity(root) {
  return crypto.createHash('sha256').update(await fs.realpath(root)).digest('hex');
}
