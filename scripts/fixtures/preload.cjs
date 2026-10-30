const { ipcRenderer } = require('electron');
const handlers = {};
const on = name => callback => { (handlers[name] ||= []).push(callback); };
const emit = (name, value) => (handlers[name] || []).forEach(callback => callback(value));
const call = (method, args) => ipcRenderer.invoke('fixture-call', method, args);
const item = value => value ? { ...value, save() { return call('save', { id: this.id, annotation: this.annotation }); } } : undefined;

global.eagle = {
  onPluginCreate: on('create'), onPluginRun: on('run'), onPluginShow: on('show'),
  onPluginHide: on('hide'), onPluginBeforeExit: on('exit'),
  onThemeChanged: on('theme'), onLibraryChanged: on('library'),
  app: { build: 23, theme: 'DARK', isDarkColors: () => true },
  library: { path: '' },
  item: {
    getSelected: async () => (await call('selected')).map(item),
    get: async options => (await call('get', options)).map(item),
    getById: async id => item(await call('byId', id)),
    select: ids => call('select', ids)
  },
  folder: { getSelected: () => call('folders') },
  window: Object.fromEntries(['show', 'hide', 'minimize', 'getBounds', 'setBounds', 'isMaximized', 'maximize', 'unmaximize', 'isFullScreen', 'setFullScreen'].map(name => [name, value => call('window', [name, value])])),
  screen: { getAllDisplays: () => call('displays') },
  shell: { openExternal: url => call('external', url) },
  dialog: { showSaveDialog: () => call('dialog'), showOpenDialog: () => call('dialog'), showMessageBox: () => call('dialog') }
};
ipcRenderer.on('fixture-event', (_, name, value) => {
  if (name === 'snapshot') { eagle.library.path = value.library; eagle.app.theme = value.theme; }
  else emit(name, value);
});
window.addEventListener('DOMContentLoaded', async () => {
  const state = await call('snapshot');
  eagle.library.path = state.library;
  eagle.app.theme = state.theme;
  emit('create');
  setTimeout(() => emit('run'), 150);
});
