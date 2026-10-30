const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const writeFileAtomic = require('write-file-atomic');

// 验收夹具只替代 Eagle 边界，页面、编辑器、文件写入与打包产物均使用真实实现。
const root = process.argv.at(-1);
app.setPath('userData', path.join(root, 'user-data'));
let state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
let workbench;
const manifest = JSON.parse(fs.readFileSync(path.resolve('dist/manifest.json'), 'utf8'));
let failure = '';
let delay = 0;
let reloaded;
const dialogs = [];
const persist = () => writeFileAtomic.sync(path.join(root, 'state.json'), JSON.stringify(state, null, 2));
const snapshot = () => ({ library: state.library, selected: state.selected, theme: state.theme });

function send(event, value) {
  if (workbench && !workbench.isDestroyed()) workbench.webContents.send('fixture-event', event, value);
}
ipcMain.handle('fixture-call', async (event, method, args) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (method === 'selected') {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    return state.selected.map(id => state.libraries[state.library][id]).filter(Boolean);
  }
  if (method === 'get') {
    let items = Object.values(state.libraries[state.library]);
    if (args?.folders?.length) items = items.filter(item => item.folders.some(id => args.folders.includes(id)));
    return items;
  }
  if (method === 'byId') return state.libraries[state.library][args];
  if (method === 'save') {
    if (failure) throw new Error(failure);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const item = state.libraries[state.library][args.id];
    if (!item) throw new Error('素材不存在');
    item.annotation = args.annotation;
    persist();
    return;
  }
  if (method === 'select') { state.selected = args; persist(); send('snapshot', snapshot()); return true; }
  if (method === 'folders') return state.folders.map(id => ({ id }));
  if (method === 'snapshot') return snapshot();
  if (method === 'window') {
    const [name, value] = args;
    if (name === 'show') {
      win.webContents.send('fixture-event', 'show');
      reloaded?.();
      reloaded = undefined;
      return;
    }
    if (name === 'hide') { win.webContents.send('fixture-event', 'hide'); return; }
    return win[name](value);
  }
  if (method === 'displays') return [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  if (method === 'dialog') return dialogs.shift() || { canceled: true, filePaths: [], response: 0 };
  if (method === 'external') { state.lastExternal = args; persist(); return; }
  if (method === 'openPath') { state.lastOpenPath = args; persist(); return; }
  throw new Error(`未知夹具调用：${method}`);
});
function makeWindow(file, size) {
  const win = new BrowserWindow({ ...size, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') } });
  win.loadFile(path.resolve('dist', file));
  return win;
}
function openWorkbench() {
  if (workbench && !workbench.isDestroyed()) {
    workbench.webContents.send('fixture-event', 'run');
    return;
  }
  workbench = makeWindow('workbench.html', { ...manifest.main, width: 1280, height: 850 });
}
app.whenReady().then(() => {
  global.fixture = {
    select(ids) { state.selected = ids; persist(); send('snapshot', snapshot()); },
    library(library, ids) { state.library = library; state.selected = ids; persist(); send('snapshot', snapshot()); send('library', library); },
    annotation(id, text) { state.libraries[state.library][id].annotation = text; persist(); },
    items(items) { Object.assign(state.libraries[state.library], items); persist(); },
    failure(value) { failure = value; },
    delay(value) { delay = value; },
    dialog(value) { dialogs.push(value); },
    theme(value) { state.theme = value; send('snapshot', snapshot()); send('theme', value); },
    // 工作台恢复窗口尺寸并显示后，才继续验收后续交互。
    reload() { return new Promise(resolve => { reloaded = resolve; workbench.reload(); }); },
    hide() { workbench.webContents.send('fixture-event', 'hide'); },
    run: openWorkbench,
    bounds(bounds) { workbench.setBounds(bounds); },
    async capture(file) {
      const contents = workbench.webContents;
      contents.incrementCapturerCount({ width: 0, height: 0 }, true, true);
      try {
        // 隐藏的验收窗口需要完成绘制，再从合成器获取当前画面。
        await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.writeFileSync(file, (await contents.capturePage()).toPNG());
      }
      finally { contents.decrementCapturerCount(true, true); }
    },
    crash() { workbench.webContents.forcefullyCrashRenderer(); },
    state() { return state; }
  };
});
// 工作台关闭后，验收进程仍需模拟 Eagle 接收下一次运行请求。
app.on('window-all-closed', () => {});
