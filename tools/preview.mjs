/**
 * 开发用静态服务器：node tools/preview.mjs
 * 然后浏览器打开 http://127.0.0.1:5311/panel/index.html?mock=1
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PREVIEW_PORT || 5311);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
  let file = join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${port}/panel/index.html?mock=1`);
});
