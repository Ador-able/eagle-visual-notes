import { zipSync } from 'fflate';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const files = {};
for (const name of await readdir('dist')) files[name] = new Uint8Array(await readFile(path.join('dist', name)));
const archive = zipSync(files, { level: 6 });
await mkdir('release', { recursive: true });
const name = `eagle-visual-notes-${manifest.version}.eagleplugin`;
await writeFile(`release/${name}`, archive);
await writeFile(`release/${name}.sha256`, `${createHash('sha256').update(archive).digest('hex')}  ${name}\n`);
console.log(`安装包：release/${name}`);
