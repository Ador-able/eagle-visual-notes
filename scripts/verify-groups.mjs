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
    await until(async () => { const data = await items(); return members.every(id => data[id].annotation === data[members[0]].annotation) && data[members[0]].annotation.startsWith(body) && data[members[0]].annotation.includes('<!-- eagle-note-group:'); }, '全组正文和协议一致');
    const data = await items();
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
  await until(async () => (await items()).D.annotation === '', '重开恢复清空');
  await shared(['A', 'B', 'C'], '# 中断后的新稿');
  assert(!groupOf((await items()).A.annotation).removed);
  pass('移出清空失败时保留操作，重开剩余成员后继续清空并收尾');

  await remove('C');
  await until(async () => await gallery.count() === 2 && (await items()).C.annotation === '', '移出 C');
  await remove('B');
  await until(async () => (await items()).B.annotation === '' && !(await items()).A.annotation.includes('eagle-note-group'), '最后一张恢复单图');
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
  await control('select', ['H', 'I']); await control('run');
  await shared(['H', 'I'], '\n\n<!--');
  assert(await page.locator('#group-choice').isHidden());
  pass('仅多选不会改写注释，点击分析处理不同正文；全空组直接建立');

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
} finally { await control('shutdown'); await app.close(); }
