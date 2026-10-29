import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/workbench.ts', 'src/inspector.ts'],
  outdir: 'dist', bundle: true, platform: 'browser', format: 'iife',
  target: ['chrome107'], external: builtinModules.flatMap(name => [name, `node:${name}`]),
  legalComments: 'eof', logLevel: 'info',
  define: { __filename: '"visual-notes.js"' }
});
for (const name of await readdir('static')) await copyFile(path.join('static', name), path.join('dist', name));
await copyFile('manifest.json', 'dist/manifest.json');
const packages = JSON.parse(await readFile('package-lock.json', 'utf8')).packages;
let licenses = '# 第三方许可\n\n以下为随插件分发的运行时依赖许可原文。\n';
for (const [dir, info] of Object.entries(packages)) {
  if (!dir || info.dev) continue;
  const files = await readdir(dir);
  const license = files.find(file => /^(mit-)?licen[sc]e(\.|$)/i.test(file));
  if (license) licenses += `\n## ${dir.replace(/^node_modules\//, '')} ${info.version}\n\n${await readFile(path.join(dir, license), 'utf8')}\n`;
}
await writeFile('dist/第三方许可.txt', licenses);
console.log('插件已构建至 dist');
