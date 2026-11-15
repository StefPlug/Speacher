/**
 * Проверка собранного расширения: манифест, наличие файлов, отсутствие
 * внешних скриптов (CSP MV3), и что content script — один файл без import.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist-extension');
const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

if (!existsSync(dist)) {
  console.error('dist-extension не найден — сначала npm run build:ext');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));

if (manifest.manifest_version !== 3) fail('manifest_version должен быть 3');
if (!manifest.background?.service_worker) fail('нет background.service_worker');
if (!manifest.action) fail('нет action');
if (!manifest.icons?.['128']) fail('нет иконки 128');

const referenced = new Set();
const addRef = (p) => p && referenced.add(p.replace(/^\//, ''));

addRef(manifest.background?.service_worker);
addRef(manifest.options_ui?.page);
for (const size of Object.values(manifest.action?.default_icon ?? {})) addRef(size);
for (const size of Object.values(manifest.icons ?? {})) addRef(size);

for (const file of referenced) {
  if (!existsSync(resolve(dist, file))) fail(`манифест ссылается на отсутствующий файл: ${file}`);
}

// Права должны быть минимальными и осознанными.
const allowed = new Set(['storage', 'scripting', 'activeTab', 'offscreen', 'commands']);
for (const permission of manifest.permissions ?? []) {
  if (!allowed.has(permission)) fail(`неожиданное разрешение: ${permission}`);
}
if (!manifest.host_permissions?.includes('https://api.groq.com/*')) {
  fail('нет host_permissions на api.groq.com — запросы из браузера не пройдут CORS');
}

// content script должен существовать и быть самодостаточным (MV3 не грузит модули как контент-скрипты).
const contentPath = resolve(dist, 'content.js');
if (!existsSync(contentPath)) {
  fail('нет content.js');
} else {
  const content = readFileSync(contentPath, 'utf8');
  if (/^\s*import\s/m.test(content)) fail('content.js содержит import — не загрузится как контент-скрипт');
  notes.push(`content.js: ${(content.length / 1024).toFixed(1)} КБ, без import`);
}

// background как модуль — допустимо, но проверим, что type указан и чанки на месте.
if (manifest.background?.type !== 'module') {
  const bg = readFileSync(resolve(dist, 'background.js'), 'utf8');
  if (/^\s*import\s/m.test(bg)) fail('background.js использует import, но type не "module"');
}

// HTML не должен содержать inline-скриптов (CSP extension_pages).
for (const page of ['popup.html', 'options.html', 'offscreen.html']) {
  const path = resolve(dist, page);
  if (!existsSync(path)) {
    fail(`нет ${page}`);
    continue;
  }
  const html = readFileSync(path, 'utf8');
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g);
  if (inline?.length) fail(`${page}: inline-скрипт нарушит CSP MV3`);
  for (const src of html.matchAll(/src="([^"]+)"/g)) {
    const file = src[1].replace(/^\//, '');
    if (!existsSync(resolve(dist, file))) fail(`${page}: отсутствует ${file}`);
  }
}

// Никаких следов ключа в сборке.
for (const file of ['background.js', 'options.js', 'popup.js', 'offscreen.js', 'content.js']) {
  const path = resolve(dist, file);
  if (!existsSync(path)) continue;
  if (/\bgsk_[A-Za-z0-9]{20,}/.test(readFileSync(path, 'utf8'))) {
    fail(`${file}: похоже на захардкоженный ключ Groq`);
  }
}

console.log(`Расширение ${manifest.name} v${manifest.version}`);
for (const note of notes) console.log(`  · ${note}`);
if (errors.length === 0) {
  console.log('✓ проверка пройдена');
  process.exit(0);
}
console.error('✗ ошибки:');
for (const error of errors) console.error(`  - ${error}`);
process.exit(1);
