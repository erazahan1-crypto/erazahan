// Скачивает изображения с erazahan.info в public/uploads/
// Запуск: node scripts/download-images.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const images = JSON.parse(readFileSync(join(root, 'src', 'data', 'images.json'), 'utf8'));
const outRoot = join(root, 'public', 'uploads');

function fetch(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).toString()));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

let ok = 0;
let fail = 0;
const failed = [];
let done = 0;

async function worker(queue) {
  while (queue.length) {
    const img = queue.shift();
    const dest = join(outRoot, img.file);
    if (existsSync(dest)) { ok++; done++; continue; }
    const buf = await fetch(img.url);
    if (buf && buf.length > 0) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      ok++;
    } else {
      fail++;
      failed.push(img.file);
    }
    done++;
    process.stdout.write(`\r${done}/${images.length} (ok=${ok} fail=${fail})`);
  }
}

(async () => {
  const N = 8;
  const queue = [...images];
  await Promise.all(Array.from({ length: N }, () => worker(queue)));
  console.log(`\nГотово. ok=${ok}, fail=${fail}`);
  if (failed.length) console.log('Не скачались:', failed.join(', '));
})();
