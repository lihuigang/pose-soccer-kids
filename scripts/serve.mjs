#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const portArg = process.argv.find((a) => a.startsWith('--port'));
const port = Number(portArg?.split('=')[1] ?? process.env.PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = normalize(join(root, url === '/' ? 'index.html' : url));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
    return;
  }
  const type = TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`小小射手 running at http://${host}:${port}/`);
  console.log(`演示模式: http://${host}:${port}/?demo=1`);
});
