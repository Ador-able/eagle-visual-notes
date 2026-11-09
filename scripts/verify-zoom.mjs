import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), 'eagle-zoom-'));
const library = path.join(root, '缩放验收.library');
await mkdir(library);
const svg = await readFile('scripts/fixtures/composition.svg', 'utf8');
const items = {};
for (const [id, width, height] of [['横图', 2800, 2000], ['竖图', 1000, 2400], ['小图', 180, 120]]) {
  const file = path.join(root, `${id}.svg`);
  await writeFile(file, svg.replace('width="1400" height="1000"', `width="${width}" height="${height}"`));
  items[id] = { id, name: id, ext: 'svg', filePath: file, thumbnailPath: file, width, height, annotation: '# 缩放验收\n\n保留笔记内容。', folders: ['F1'] };
}
const videoFile = path.join(root, '视频.mp4');
await copyFile('scripts/fixtures/motion.mp4', videoFile);
items['视频'] = { ...items['横图'], id: '视频', name: '视频', ext: 'mp4', filePath: videoFile };
await writeFile(path.join(root, 'state.json'), JSON.stringify({ library, selected: ['横图'], folders: ['F1'], theme: 'DARK', libraries: { [library]: items } }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: ['scripts/fixtures/main.cjs', root], env, timeout: 20000 });
const control = (method, ...args) => app.evaluate((_, [method, args]) => global.fixture[method](...args), [method, args]);
const checks = [];
try {
  await app.evaluate(({ app }) => app.whenReady());
  await control('run');
  const page = await app.firstWindow();
  await page.waitForSelector('#image[src]');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const painted = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const rect = () => page.locator('#image').boundingBox();
  const point = async (horizontal = .7, vertical = .35) => {
    const img = await rect(), stage = await page.locator('#media-stage').boundingBox();
    const left = Math.max(img.x, stage.x), top = Math.max(img.y, stage.y);
    const right = Math.min(img.x + img.width, stage.x + stage.width), bottom = Math.min(img.y + img.height, stage.y + stage.height);
    return { x: left + (right - left) * horizontal, y: top + (bottom - top) * vertical };
  };
  const zoomAt = async (anchor, delta, label) => {
    const before = await rect();
    // 跟踪鼠标下的同一个图片像素，直接检查缩放后的屏幕位置。
    const u = (anchor.x - before.x) / before.width, v = (anchor.y - before.y) / before.height;
    await page.mouse.move(anchor.x, anchor.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, delta);
    await page.keyboard.up('Control');
    await page.waitForFunction(width => Math.abs(document.querySelector('#image').getBoundingClientRect().width - width) > .01, before.width);
    await painted();
    const after = await rect();
    const drift = Math.hypot(after.x + u * after.width - anchor.x, after.y + v * after.height - anchor.y);
    console.log(`${label}：锚点偏移 ${drift.toFixed(4)} CSS px`);
    assert(drift <= 1, `${label}：鼠标锚点漂移 ${drift} CSS px`);
    checks.push({ label, drift });
  };
  const centered = async label => {
    await painted();
    const img = await rect(), stage = await page.locator('#media-stage').boundingBox();
    assert(Math.abs(img.x + img.width / 2 - stage.x - stage.width / 2) <= 1, `${label}：水平居中`);
    assert(Math.abs(img.y + img.height / 2 - stage.y - stage.height / 2) <= 1, `${label}：垂直居中`);
  };
  for (const id of ['横图', '竖图', '小图']) {
    await control('select', [id]);
    await page.waitForFunction(id => document.querySelector('#image').alt === id, id);
    await painted();
    await centered(id);
    const reading = await page.locator('#reading').boundingBox();
    const anchor = await point();
    const initial = await rect();
    for (let i = 0; i < 5; i++) await zoomAt(anchor, -120, `${id}连续放大 ${i + 1}`);
    for (let i = 0; i < 5; i++) await zoomAt(anchor, 120, `${id}连续缩小 ${i + 1}`);
    const returned = await rect();
    for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(initial[key] - returned[key]) <= 1, `${id}：往返缩放 ${key}`);
    await page.mouse.wheel(0, -120);
    await painted();
    assert.deepEqual(await rect(), returned, '未按 Ctrl 时不缩放');
    const dragStart = await point(.5, .5);
    await page.mouse.move(dragStart.x, dragStart.y); await page.mouse.down();
    await page.mouse.move(dragStart.x + 35, dragStart.y + 25, { steps: 5 }); await page.mouse.up();
    await painted();
    assert(Math.abs((await rect()).x - returned.x - 35) <= 1, '拖动可平移图片');
    await zoomAt(await point(.35, .65), -120, `${id}平移后缩放`);
    await page.locator('#actual').click(); await painted(); await centered(`${id}原始比例`);
    assert(Math.abs((await rect()).width - items[id].width) <= 1);
    await zoomAt(await point(.8, .2), 120, `${id}原始比例缩小`);
    await page.locator('#fit').click(); await painted(); await centered(`${id}适应`);
    assert.deepEqual(await page.locator('#reading').boundingBox(), reading, '缩放不改变笔记布局');
  }
  await control('bounds', { width: 760, height: 500 }); await painted();
  await page.locator('#divider').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  await page.locator('#fit').click(); await painted();
  await centered('窄分栏');
  await zoomAt(await point(.25, .75), -120, '窄分栏缩放');
  await control('select', ['视频']); await page.waitForSelector('#video');
  assert(await page.locator('#image').isHidden());
  const video = await page.locator('#video').boundingBox(), stage = await page.locator('#media-stage').boundingBox();
  assert(Math.abs(video.width - stage.width) <= 1, '图片容器不挤占视频空间');
  await control('select', ['横图']); await page.waitForFunction(() => document.querySelector('#image').alt === '横图');
  await painted(); await centered('视频切回图片');
  await zoomAt(await point(), -120, '视频切回图片缩放');
  assert.deepEqual(errors, []);
  await mkdir('artifacts/verification', { recursive: true });
  await writeFile('artifacts/verification/zoom-results.json', JSON.stringify({ checks, maxDrift: Math.max(...checks.map(c => c.drift)) }, null, 2));
  console.log('通过：横图、竖图、小图、连续缩放、平移后缩放、1:1、适应、窄分栏、视频切换；笔记布局不变。');
} finally { await app.close(); }
