import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MANAGER_APP, projectIdentity } from './identity.mjs';
import { loadLibrary, saveLibrary, withLibraryLock, LibraryError, inside } from './library.mjs';
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json' };
function send(res, status, body) { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(body)); }
async function serve(res, root, rel) {
  let file = inside(root, rel || 'index.html');
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const real = await fs.realpath(file);
    if (!real.startsWith(await fs.realpath(root) + path.sep)) throw new LibraryError('Invalid path.');
    const data = await fs.readFile(real);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(real)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' }); res.end(data);
  } catch (error) { send(res, error.code === 'ENOENT' ? 404 : 400, { error: 'File not found.' }); }
}
function listen(server, port) { return new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); }); }
async function body(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 145 * 1024 * 1024) throw new LibraryError('This batch is too large. Import fewer images at a time.',413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new LibraryError('Invalid request data.'); }
}
function publicLibrary(library) { return { photos: library.photos.map(photo => ({ ...photo, originalPath: library.state[photo.id]?.path ? 'originals/' + library.state[photo.id].path : null })), home: library.settings.home, revision: library.revision }; }
export async function startManager({ root, port = 8787, previewPort = 0 } = {}) {
  root = path.resolve(root);
  const projectId = await projectIdentity(root);
  await withLibraryLock(root, () => loadLibrary(root));
  const token = crypto.randomBytes(32).toString('hex');
  let origin; let busy = false;
  const preview = http.createServer(async (req,res) => {
    if (req.headers.host !== `127.0.0.1:${preview.address().port}`) return send(res,403,{error:'Local preview only.'});
    if (!['GET','HEAD'].includes(req.method)) return send(res,405,{error:'Read-only preview.'});
    try { await serve(res, inside(root,'dist'), decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')); }
    catch { send(res,400,{error:'Invalid path.'}); }
  });
  const server = http.createServer(async (req,res) => {
    if (req.headers.host !== new URL(origin).host) return send(res,403,{error:'Local manager only.'});
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{app:MANAGER_APP,projectId,busy});
      if (req.method === 'GET' && url.pathname === '/api/library') return send(res,200,{ ...publicLibrary(await loadLibrary(root)), token });
      if (req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['x-photo-manager-token'] !== token || req.headers['content-type'] !== 'application/json') throw new LibraryError('This save must come from the local photo manager.',403);
        if (busy) throw new LibraryError('A save or preview build is already running.',409);
        if (!['/api/save','/api/preview'].includes(url.pathname)) throw new LibraryError('Unknown action.',404);
        const input = await body(req);
        if (busy) throw new LibraryError('A save or preview build is already running.',409);
        busy = true;
        try {
          return await withLibraryLock(root, async () => {
            if (url.pathname === '/api/save') return send(res,200,publicLibrary(await saveLibrary(root,input)));
            try {
              await exec(process.execPath,[inside(root,'node_modules/astro/astro.js'),'build'],{cwd:root,env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1'},maxBuffer:4*1024*1024,timeout:120000});
            } catch (error) { console.error(error.stderr || error.message); throw new LibraryError('The website build failed. Your saved photos are safe; check the manager Terminal window for details.',500); }
            return send(res,200,{ url:`http://127.0.0.1:${preview.address().port}/` });
          });
        } finally { busy = false; }
      }
      if (!['GET','HEAD'].includes(req.method)) throw new LibraryError('Method not allowed.',405);
      if (url.pathname.startsWith('/images/')) {
        const pathname = decodeURIComponent(url.pathname);
        const { aliases } = await loadLibrary(root);
        return await serve(res,inside(root,'public'),(aliases[pathname] || pathname).slice(1));
      }
      return await serve(res,path.join(here,'ui'),url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1));
    } catch (error) {
      if (!(error instanceof LibraryError)) console.error(error);
      send(res,error.status || 500,{error:error instanceof LibraryError ? error.message : 'Something went wrong. No publishing occurred. Check the Terminal window for details.'});
    }
  });
  await listen(preview,previewPort);
  try { await listen(server,port); } catch(error) { preview.close(); throw error; }
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, preview, url:origin, close: () => Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>preview.close(resolve))]) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  import('./launcher.mjs').then(({launchManager}) => launchManager({root:path.resolve(here,'../..'),port:Number(process.env.PHOTO_MANAGER_PORT || 8787),openBrowser:!process.argv.includes('--no-open')})).then(result => {
    if (result.reused) console.log(`\n🍍 Photography Manager is already running.\nOpened your existing manager: ${result.url}\nYour running session has been left in place.\n`);
    else console.log(`\n🍍 Photography Manager\n${result.url}\n\nYour files stay on this Mac. Save locally, then publish with GitHub Desktop.\nKeep this window open; press Control+C to stop.\n`);
  }).catch(error => { console.error(error.message); process.exitCode=1; });
}
