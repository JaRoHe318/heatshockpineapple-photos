import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startManager } from './server.mjs';
import { MANAGER_APP, projectIdentity } from './identity.mjs';
const exec = promisify(execFile);
async function legacyProcessMatches(root, port) {
  if (process.platform !== 'darwin') return false;
  try {
    const { stdout } = await exec('/usr/sbin/lsof',['-t',`-iTCP:${port}`,'-sTCP:LISTEN']);
    const pids = [...new Set(stdout.trim().split(/\s+/))];
    if (pids.length !== 1 || !/^\d+$/.test(pids[0])) return false;
    const pid = pids[0];
    const [{stdout:cwd},{stdout:command}] = await Promise.all([
      exec('/usr/sbin/lsof',['-a','-p',pid,'-d','cwd','-Fn']),
      exec('/bin/ps',['-p',pid,'-o','command=']),
    ]);
    const directory = cwd.split('\n').find(line=>line.startsWith('n'))?.slice(1);
    return directory && await fs.realpath(directory) === await fs.realpath(root) && /scripts\/photo-manager\/server\.mjs(?:\s|$)/.test(command);
  } catch { return false; }
}
export async function findRunningManager({root,port}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const url = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(url+'/api/health',{signal:AbortSignal.timeout(1500),redirect:'error'});
    if (response.ok) {
      const identity = await response.json();
      return identity.app === MANAGER_APP && identity.projectId === await projectIdentity(root) ? {url} : null;
    }
    // Older managers lack /api/health. Confirm the exact project process before reusing one.
    if (response.status !== 404 || !(await legacyProcessMatches(root,port))) return null;
    const libraryResponse = await fetch(url+'/api/library',{signal:AbortSignal.timeout(1500),redirect:'error'});
    if (!libraryResponse.ok) return null;
    const library = await libraryResponse.json();
    return Array.isArray(library.photos) && /^[a-f0-9]{64}$/.test(library.revision) && /^[a-f0-9]{64}$/.test(library.token) ? {url} : null;
  } catch { return null; }
}
export async function launchManager({root,port=8787,openBrowser=true}) {
  let running = await findRunningManager({root,port});
  let manager;
  if (!running) {
    try { manager = await startManager({root,port}); }
    catch (error) {
      if (error.code !== 'EADDRINUSE' && error.status !== 409) throw error;
      // A simultaneous launch may still be binding its port.
      for (let attempt=0;attempt<5 && !running;attempt++) {
        running = await findRunningManager({root,port});
        if (!running && attempt<4) await new Promise(resolve=>setTimeout(resolve,100));
      }
      if (!running) {
        if (error.code === 'EADDRINUSE') throw new Error(`Port ${port} is occupied by another application or a manager for another folder. Nothing was stopped. Set PHOTO_MANAGER_PORT to a free port, or close that application.`);
        throw error;
      }
    }
  }
  const url = running?.url || manager.url;
  if (openBrowser && process.platform === 'darwin') {
    try { await exec('/usr/bin/open',[url]); }
    catch { console.warn(`Open your browser at ${url}`); }
  }
  return {url,reused:Boolean(running),manager};
}
