import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'client', 'dist');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const KiB = 1024;
const budgets = {
  initialJsGzip: 125 * KiB,
  initialCssGzip: 60 * KiB,
  largestJsChunkGzip: 500 * KiB,
};

const entries = Object.entries(manifest).filter(([, item]) => item.isEntry);
if (entries.length !== 1) {
  throw new Error(`Expected one client entry in ${manifestPath}; found ${entries.length}.`);
}

const readAsset = (asset) => readFile(path.join(distDir, asset));
const gzipSize = async (asset) => gzipSync(await readAsset(asset)).byteLength;

async function collectInitialAssets(entry) {
  const visited = new Set();
  const js = new Set();
  const css = new Set();

  async function visit(item) {
    if (visited.has(item)) return;
    visited.add(item);
    const record = manifest[item];
    if (!record) throw new Error(`Missing manifest entry for ${item}.`);
    if (record.file?.endsWith('.js')) js.add(record.file);
    for (const stylesheet of record.css ?? []) css.add(stylesheet);
    for (const imported of record.imports ?? []) await visit(imported);
  }

  await visit(entry);
  return { js: [...js], css: [...css] };
}

const initial = await collectInitialAssets(entries[0][0]);
const totalGzip = async (assets) =>
  (await Promise.all(assets.map(gzipSize))).reduce((sum, size) => sum + size, 0);

const initialJsGzip = await totalGzip(initial.js);
const initialCssGzip = await totalGzip(initial.css);

async function findJsFiles(directory) {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const itemPath = path.join(directory, item.name);
    if (item.isDirectory()) found.push(...await findJsFiles(itemPath));
    else if (item.isFile() && item.name.endsWith('.js')) found.push(itemPath);
  }
  return found;
}

const jsFiles = await findJsFiles(path.join(distDir, 'assets'));
const jsSizes = await Promise.all(jsFiles.map(async (file) => ({
  file: path.relative(distDir, file),
  gzip: gzipSync(await readFile(file)).byteLength,
})));
const largestChunk = jsSizes.reduce((largest, current) => current.gzip > largest.gzip ? current : largest);

const formatKiB = (size) => `${(size / KiB).toFixed(1)} KiB`;
console.log(`Initial JS (gzip): ${formatKiB(initialJsGzip)} / ${formatKiB(budgets.initialJsGzip)}`);
console.log(`Initial CSS (gzip): ${formatKiB(initialCssGzip)} / ${formatKiB(budgets.initialCssGzip)}`);
console.log(`Largest JS chunk (gzip): ${formatKiB(largestChunk.gzip)} / ${formatKiB(budgets.largestJsChunkGzip)} (${largestChunk.file})`);

const failures = [];
if (initialJsGzip > budgets.initialJsGzip) failures.push('Initial JavaScript gzip budget exceeded.');
if (initialCssGzip > budgets.initialCssGzip) failures.push('Initial CSS gzip budget exceeded.');
if (largestChunk.gzip > budgets.largestJsChunkGzip) failures.push('Largest JavaScript chunk gzip budget exceeded.');

if (failures.length) {
  throw new Error(failures.join(' '));
}
