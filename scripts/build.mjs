import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { mkdir, readdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/workbench.ts'],
  outdir: 'dist', bundle: true, platform: 'browser', format: 'iife',
  target: ['chrome107'], external: builtinModules.flatMap(name => [name, `node:${name}`]),
  legalComments: 'eof', logLevel: 'info', metafile: true,
  define: { __filename: '"visual-notes.js"' }
});
for (const name of await readdir('static')) await copyFile(path.join('static', name), path.join('dist', name));
await copyFile('manifest.json', 'dist/manifest.json');
const packages = JSON.parse(await readFile('package-lock.json', 'utf8')).packages;
let licenses = '# 第三方许可\n\n以下为随插件分发的运行时依赖许可原文。\n';
// 仅收集参与构建的依赖，未安装的平台可选包不参与分发。
const bundled = new Set(Object.keys(result.metafile.inputs).map(file => file.match(/^node_modules\/(?:@[^/]+\/)?[^/]+/)?.[0]).filter(Boolean));
for (const dir of [...bundled].sort()) {
  const info = packages[dir];
  const files = await readdir(dir);
  const license = files.find(file => /^(mit-)?licen[sc]e(\.|$)/i.test(file));
  if (license) licenses += `\n## ${dir.replace(/^node_modules\//, '')} ${info.version}\n\n${await readFile(path.join(dir, license), 'utf8')}\n`;
}
await writeFile('dist/第三方许可.txt', licenses);
console.log('插件已构建至 dist');
