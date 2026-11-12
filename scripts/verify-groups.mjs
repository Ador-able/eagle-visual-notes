import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// 通过实际工作台操作，保存结果从独立数据文件回读。
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), 'eagle-note-groups-'));
const library = path.join(root, '组分析.library');
await mkdir(library);
await copyFile('scripts/fixtures/composition.svg', path.join(root, '构图.svg'));
const original = '# 共同分析\n\n观察构图、光线和色彩。\n';
const makeItem = (id, annotation = '') => ({ id, name: `素材 ${id}`, annotation, ext: 'svg', filePath: path.join(root, '构图.svg'), thumbnailPath: path.join(root, '构图.svg'), width: 1400, height: 1000, folders: ['F1'], tags: ['保留标签'], isDeleted: false });
const ids = ['A', 'B', 'C', 'D', 'E'];
const initial = { library, selected: ids, folders: ['F1'], theme: 'DARK', libraries: { [library]: Object.fromEntries(ids.map(id => [id, makeItem(id, id === 'A' ? original : '')])) } };
await writeFile(path.join(root, 'state.json'), JSON.stringify(initial));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: ['scripts/fixtures/main.cjs', root], env, timeout: 20000 });
const results = [], errors = [];
const control = (method, ...args) => app.evaluate((_, [method, args]) => global.fixture[method](...args), [method, args]);
const items = async () => JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8')).libraries[library];
const until = async (fn, label) => {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw new Error(`等待失败：${label}`);
};
const groupOf = text => JSON.parse(text.match(/<!-- eagle-note-group:(.*) -->\s*$/)[1]);
const pass = text => { results.push(text); console.log(`通过：${text}`); };
let page;
try {
  await app.evaluate(({ app }) => app.whenReady());
  await control('run');
  await until(async () => app.windows().some(p => p.url().includes('workbench')), '工作台启动');
  page = app.windows().find(p => p.url().includes('workbench'));
  page.on('pageerror', error => errors.push(error.message));
  let gallery = page.locator('#group-members button');
  let rich = page.locator('#rich-editor .ProseMirror');
  const restart = async () => {
    const oldPage = page;
    await control('restart');
    await until(async () => app.windows().some(p => p !== oldPage && p.url().includes('workbench')), '中断后重新打开');
    page = app.windows().find(p => p !== oldPage && p.url().includes('workbench'));
    page.on('pageerror', error => errors.push(error.message));
    gallery = page.locator('#group-members button');
    rich = page.locator('#rich-editor .ProseMirror');
  };
  const paste = async text => {
    await page.locator('#rich-mode').click();
    await rich.focus(); await page.keyboard.press('Control+a');
    await rich.evaluate((element, text) => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, text);
  };
  const shared = async (members, body) => {
    // 保存结束后再独立回读文件，避免 Windows 读句柄与原子替换争用。
    await until(async () => await page.locator('#save-state').innerText() === '已保存', '组同步完成');
    const data = await items();
    assert(members.every(id => data[id].annotation === data[members[0]].annotation));
    assert(data[members[0]].annotation.startsWith(body));
    assert.deepEqual(groupOf(data[members[0]].annotation).items, members);
    for (const id of members) assert.deepEqual(data[id].tags, ['保留标签']);
  };
  await until(async () => await gallery.count() === 5, '五张缩略图');
  await shared(ids, original);
  assert.equal(await page.locator('#window-title').innerText(), '组分析 · 5 张');
  pass('多选后运行直接建立组，只有一张有正文时沿用，五张原生注释完全相同');

  for (const mode of ['source', 'rich', 'read']) {
    await page.locator(`#${mode}-mode`).click();
    const content = mode === 'source' ? await page.locator('#editor').innerText() : await page.locator(mode === 'rich' ? '#rich-editor' : '#reading').innerText();
    assert(!content.includes('eagle-note-group'));
  }
  const markdown = path.join(root, '共同分析.md');
  await control('dialog', { canceled: false, filePath: markdown });
  await page.locator('#more-menu summary').click(); await page.locator('#export-note').click();
  await until(async () => { try { return await readFile(markdown, 'utf8') === original; } catch { return false; } }, '仅导出正文');
  const backup = path.join(root, '注释备份.json');
  await control('dialog', { canceled: false, filePath: backup });
  await page.locator('#more-menu summary').click(); await page.locator('#backup').click();
  await until(async () => { try { return JSON.parse(await readFile(backup, 'utf8')).notes.E.annotation.includes('eagle-note-group'); } catch { return false; } }, '备份保留协议');
  pass('三种模式隐藏协议，Markdown 导出只有正文，注释备份保留完整协议');

  await control('select', ['C']); await control('reload');
  await until(async () => await gallery.count() === 5, '单张重开整组');
  await page.locator('#rich-mode').click();
  const editorNode = await rich.elementHandle();
  await page.locator('[data-item="E"]').click();
  assert(await editorNode.evaluate(el => el.isConnected));
  assert.match(await rich.innerText(), /共同分析/);
  assert.equal(await page.locator('[data-item="E"]').getAttribute('aria-pressed'), 'true');
  await paste('# 组内编辑\n\n整组自动保存。');
  await shared(ids, '# 组内编辑');
  await page.keyboard.press('Control+z');
  await shared(ids, '# 共同分析');
  pass('从任意成员重开整组，缩略图切换保留编辑器，编辑与撤销同步所有成员');

  await control('failure', { id: 'C', message: '模拟 C 写入失败' });
  await paste('# 部分失败\n\n保留这份最新内容。');
  await page.locator('#error:not([hidden])').waitFor();
  assert.match(await page.locator('#error-text').innerText(), /3 张未同步/);
  assert.match((await items()).A.annotation, /部分失败/);
  assert(!((await items()).E.annotation.includes('部分失败')));
  assert.match(await rich.innerText(), /最新内容/);
  await control('failure', '');
  await page.locator('#retry').click(); await shared(ids, '# 部分失败');
  await page.locator('#error').waitFor({ state: 'hidden' });
  pass('部分写入失败报告未同步数量并保留正文，重试补齐所有成员');

  await control('failure', { id: 'D', message: '模拟中断' });
  await paste('# 中断后的新稿\n\n采用这一份。');
  await page.locator('#error:not([hidden])').waitFor();
  await control('failure', ''); await restart();
  await page.locator('#group-choice:not([hidden])').waitFor();
  const beforeChoice = await items();
  await page.locator('#group-source').selectOption('0');
  assert.match(await page.locator('#group-preview').innerText(), /中断后的新稿/);
  assert.deepEqual(await items(), beforeChoice);
  await page.locator('#group-adopt').click(); await shared(ids, '# 中断后的新稿');
  pass('中断后重开显示不同正文，预览不写入，采用后才统一同步');

  const beforeReadFailure = await items();
  await control('readFailure', '模拟读取失败');
  await page.locator('#error:not([hidden])').waitFor();
  assert.deepEqual(await items(), beforeReadFailure);
  await control('readFailure', '');
  await until(async () => await page.locator('#error').isHidden(), '读取恢复');
  const deleted = { ...(await items()).E, isDeleted: true };
  await control('items', { E: deleted });
  await until(async () => await gallery.count() === 4, '删除后静默剔除');
  await shared(['A', 'B', 'C', 'D'], '# 中断后的新稿');
  assert(await page.locator('#error').isHidden());
  assert.equal((await items()).E.annotation, deleted.annotation);
  pass('读取失败不会当作删除，已删除成员静默剔除，其余分析完整保留');

  const remove = async id => {
    await page.locator(`[data-item="${id}"]`).click({ button: 'right' });
    await page.locator('#group-remove').click();
  };
  await control('failure', { id: 'D', message: '模拟清空失败' });
  await remove('D');
  await page.locator('#error:not([hidden])').waitFor();
  assert.match(await page.locator('#error-text').innerText(), /1 张待清空/);
  assert.deepEqual(groupOf((await items()).A.annotation).removed, ['D']);
  await control('failure', ''); await restart();
  await shared(['A', 'B', 'C'], '# 中断后的新稿');
  assert.equal((await items()).D.annotation, '');
  assert(!groupOf((await items()).A.annotation).removed);
  pass('移出清空失败时保留操作，重开剩余成员后继续清空并收尾');

  await remove('C');
  await shared(['A', 'B'], '# 中断后的新稿');
  assert.equal(await gallery.count(), 2);
  assert.equal((await items()).C.annotation, '');
  await remove('B');
  await until(async () => await page.locator('#group-members').isHidden() && await page.locator('#save-state').innerText() === '已保存', '最后一张恢复单图');
  assert.equal((await items()).B.annotation, '');
  assert(!(await items()).A.annotation.includes('eagle-note-group'));
  assert.match((await items()).A.annotation, /中断后的新稿/);
  assert(await page.locator('#group-members').isHidden());
  pass('主动移出清空完整注释，最后一张去掉协议并保留分析');

  await control('items', { F: makeItem('F', '# F 的内容'), G: makeItem('G', '# G 的内容'), H: makeItem('H'), I: makeItem('I') });
  await control('select', ['F', 'G']);
  await until(async () => (await page.locator('#note-empty').innerText()).includes('点击分析'), '多选等待分析入口');
  assert.equal((await items()).F.annotation, '# F 的内容');
  await control('run');
  await page.locator('#group-choice:not([hidden])').waitFor();
  await page.locator('#group-source').selectOption('1');
  await page.locator('#group-adopt').click();
  await shared(['F', 'G'], '# G 的内容');
  await page.evaluate(() => {
    window.analysisRunObserved = false;
    eagle.onPluginRun(() => { window.analysisRunObserved = true; });
  });
  // 将分析操作插入选择同步的等待阶段，核对请求不会被旧一轮清掉。
  await app.evaluate(() => { global.fixture.pauseSelection(1); global.fixture.select(['H', 'I']); });
  await until(() => control('selectionPaused'), '选择同步等待返回');
  await control('run');
  await page.waitForFunction(() => window.analysisRunObserved);
  await control('resumeSelection');
  await shared(['H', 'I'], '\n\n<!--');
  assert(await page.locator('#group-choice').isHidden());
  pass('仅多选不会改写注释，点击分析处理不同正文；选择同步期间点击分析仍能建立全空组');

  await control('items', { J: makeItem('J', '# 相同正文'), K: makeItem('K', '# 相同正文'), M: makeItem('M', '  \n\n') });
  await control('select', ['M']);
  await until(async () => (await page.title()).includes('素材 M'), '单图空白注释');
  assert.equal((await items()).M.annotation, '  \n\n');
  await control('select', ['J', 'K']); await control('run');
  await shared(['J', 'K'], '# 相同正文');
  assert(await page.locator('#group-choice').isHidden());
  await control('run');
  await page.waitForTimeout(850);
  await control('select', ['M', 'C']);
  await until(async () => (await page.locator('#note-empty').innerText()).includes('点击分析'), '运行请求不影响后续选择');
  assert.equal((await items()).M.annotation, '  \n\n');
  assert.equal((await items()).C.annotation, '');
  pass('相同正文直接建组，单图空白原样保留，重复运行不会授权后续多选自动建组');

  const scrollIds = Array.from({ length: 18 }, (_, index) => `S${index + 1}`);
  const scrollAnnotation = `# 连续观察\n\n滚动到后面继续选图。\n\n<!-- eagle-note-group:${JSON.stringify({ version: 1, id: 'scroll-gallery', items: scrollIds })} -->`;
  await control('items', Object.fromEntries(scrollIds.map(id => [id, makeItem(id, scrollAnnotation)])));
  await control('select', ['S1']);
  await until(async () => await gallery.count() === scrollIds.length, '长缩略图列表');
  await page.locator('#read-mode').click();
  const scrollStrip = page.locator('#group-members');
  const scrollStart = await scrollStrip.evaluate(el => { el.scrollLeft = el.scrollWidth - el.clientWidth; return el.scrollLeft; });
  assert(scrollStart > 500);
  const scrollBody = await page.locator('#reading').innerText();
  // 使用可见缩略图的屏幕坐标点击，避免自动滚动掩盖位置回退。
  for (const id of ['S18', 'S17', 'S16']) {
    const thumbnail = page.locator(`[data-item="${id}"]`);
    const rect = await thumbnail.boundingBox();
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await until(async () => await thumbnail.getAttribute('aria-pressed') === 'true', '切换后段缩略图');
    const scrollAfter = await scrollStrip.evaluate(el => el.scrollLeft);
    console.log(`缩略图 ${id}：滚动位置 ${scrollStart} → ${scrollAfter}`);
    assert(Math.abs(scrollAfter - scrollStart) <= 1, '点击缩略图后保持横向滚动位置');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-item')), id);
  }
  assert.equal(await page.locator('#reading').innerText(), scrollBody);
  await page.keyboard.press('Alt+ArrowRight');
  await until(async () => await page.locator('[data-item="S17"]').getAttribute('aria-pressed') === 'true', '组内快捷键导航');
  assert(Math.abs(await scrollStrip.evaluate(el => el.scrollLeft) - scrollStart) <= 1);
  await paste('# 连续观察\n\n保存后仍保持缩略图位置。');
  await shared(scrollIds, '# 连续观察');
  await until(async () => (await page.locator('#save-state').innerText()) === '已保存', '长列表编辑保存');
  assert(Math.abs(await scrollStrip.evaluate(el => el.scrollLeft) - scrollStart) <= 1);
  pass('长列表后段连续点击、快捷键导航和自动保存均保持横向滚动位置，点击焦点与正文稳定');

  const imageBody = '# 图片引用\n\n对照 ![第一张](eagle-image:R1) 与 ![](eagle-image:R2)。\n\n[![局部细节](eagle-image:R2)](https://example.invalid)\n\n![组外配图](eagle-image:OUT)\n\n![缺失配图](eagle-image:MISSING)\n';
  const imageAnnotation = `${imageBody}\n<!-- eagle-note-group:${JSON.stringify({ version: 1, id: 'image-references', items: ['R1', 'R2', 'R3'] })} -->`;
  await control('items', { R1: makeItem('R1', imageAnnotation), R2: makeItem('R2', imageAnnotation), R3: makeItem('R3', imageAnnotation), OUT: makeItem('OUT') });
  await control('select', ['R1']);
  await until(async () => await page.locator('[data-item="R1"]').count() === 1, '图片引用组');
  await page.locator('#read-mode').click();
  const reading = page.locator('#reading');
  assert.equal(await reading.locator('.note-image-reference').count(), 3);
  assert.equal(await reading.locator('.note-image-reference img').count(), 0);
  assert.equal(await reading.locator('[data-note-image="R2"]').first().innerText(), '素材 R2');
  await until(async () => reading.locator('img[alt="组外配图"]').evaluate(img => img.naturalWidth > 0), '组外配图解码');
  await until(async () => await reading.locator('img[alt="图片素材不可用：缺失配图"]').count() === 1, '缺失配图提示');
  await reading.locator('a .note-image-reference').click();
  await until(async () => await page.locator('#image').getAttribute('alt') === '素材 R2', '引用切换左侧图片');
  assert.equal(await page.locator('[data-item="R2"]').getAttribute('aria-pressed'), 'true');
  assert.equal((await control('state')).lastExternal, undefined);
  await reading.locator('[data-note-image="R1"]').focus();
  await page.keyboard.press('Enter');
  await until(async () => await page.locator('#image').getAttribute('alt') === '素材 R1', '键盘激活引用');
  assert.equal((await items()).R1.annotation, imageAnnotation);
  await mkdir('artifacts/verification', { recursive: true });
  await control('capture', path.resolve('artifacts/verification/group-image-references.png'));
  pass('组内引用默认显示文字，空说明使用素材名；鼠标和键盘切换左图，不打开外链或改写正文，组外与缺失配图正常处理');

  const showImages = async value => {
    await page.locator('#more-menu summary').click();
    await page.locator('#show-group-images').setChecked(value);
    await page.keyboard.press('Escape');
  };
  await showImages(true);
  await until(async () => reading.locator('.note-image-reference img').evaluateAll(images => images.length === 3 && images.every(img => img.naturalWidth > 0)), '显示组内配图');
  await reading.locator('[data-note-image="R2"]').first().click();
  await until(async () => await page.locator('#image').getAttribute('alt') === '素材 R2', '显示图片时点击引用');
  assert.equal((await items()).R1.annotation, imageAnnotation);
  await restart();
  await until(async () => await page.locator('#reading .note-image-reference img').count() === 3, '重开保留显示设置');
  assert(await page.locator('#show-group-images').isChecked());
  await control('capture', path.resolve('artifacts/verification/group-image-expanded.png'));
  pass('显示开关即时生效并跨窗口保留，展开图片仍可切换左图，原始注释保持一致');

  await page.locator('#rich-mode').click();
  await rich.locator('[data-note-image="R2"]').first().click();
  await until(async () => await page.locator('#image').getAttribute('alt') === '素材 R2', '渲染编辑中点击引用');
  await rich.focus(); await page.keyboard.press('Control+End');
  await page.keyboard.type('撤销标记');
  await until(async () => await page.locator('#save-state').innerText() === '已保存', '引用正文编辑保存');
  await showImages(false);
  assert.equal(await rich.locator('.note-image-reference img').count(), 0);
  await rich.focus(); await page.keyboard.press('Control+z');
  await until(async () => !(await rich.innerText()).includes('撤销标记') && await page.locator('#save-state').innerText() === '已保存', '显示切换后撤销');
  const savedImages = await items();
  assert.equal(savedImages.R1.annotation, savedImages.R2.annotation);
  for (const source of ['eagle-image:R1', 'eagle-image:R2', 'eagle-image:OUT', 'eagle-image:MISSING']) assert(savedImages.R1.annotation.includes(source));
  assert(!savedImages.R1.annotation.includes('file:'));
  await page.locator('#source-mode').click();
  assert((await page.locator('#editor').innerText()).includes('eagle-image:R2'));
  const imageExport = path.join(root, '图片引用.md');
  await control('dialog', { canceled: false, filePath: imageExport });
  await page.locator('#more-menu summary').click(); await page.locator('#export-note').click();
  await until(async () => { try { return (await readFile(imageExport, 'utf8')).includes('eagle-image:R2'); } catch { return false; } }, '导出原始图片引用');
  pass('渲染编辑中的引用可点击，显示切换保留撤销历史；整组保存、源码和导出均保留素材 ID');

  await page.locator('#read-mode').click();
  await remove('R2');
  await until(async () => await page.locator('#reading [data-note-image="R2"]').count() === 0 && await page.locator('#save-state').innerText() === '已保存', '移出后恢复普通配图');
  await until(async () => page.locator('#reading img[alt="局部细节"]').evaluate(img => img.naturalWidth > 0), '移出成员图片仍可引用');
  await restart();
  await until(async () => await gallery.count() === 2 && await page.locator('#reading [data-note-image="R1"]').count() === 1, '重开后保留移出结果');
  await remove('R3');
  await until(async () => await page.locator('#group-members').isHidden() && await page.locator('#reading .note-image-reference').count() === 0, '单图笔记不隐藏配图');
  pass('成员移出后自动恢复普通配图，组解散为单图后不隐藏任何引用');

  await control('select', ['F']);
  await until(async () => await page.locator('[data-item="F"]').count() === 1, '展示两张组');
  await page.locator('#read-mode').click();
  await mkdir('artifacts/verification', { recursive: true });
  await control('capture', path.resolve('artifacts/verification/group-dark.png'));
  await control('theme', 'LIGHT'); await control('bounds', { width: 760, height: 500 });
  // Windows 显示缩放会将窗口宽度取整到相邻像素。
  await until(async () => await page.evaluate(() => innerWidth >= 760 && innerWidth <= 762), '最小窗口');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await control('capture', path.resolve('artifacts/verification/group-small.png'));
  assert.deepEqual(errors, []);
  pass('深色与浅色窄窗口布局无横向溢出，未捕获页面脚本异常');
  await writeFile('artifacts/verification/group-results.json', JSON.stringify({ passed: results, errors, fixtureRoot: root, runtime: await app.evaluate(() => process.versions) }, null, 2));
} catch (error) {
  console.error(`验收数据：${root}`);
  console.error(error);
  if (page) console.error(await page.locator('body').innerText().catch(() => '窗口不可读取'));
  throw error;
} finally { await control('resumeSelection'); await control('shutdown'); await app.close(); }
