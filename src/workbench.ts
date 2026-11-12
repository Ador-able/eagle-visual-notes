import {
  $,
  applyTheme,
  bindLinks,
  errorMessage,
  isMedia,
  isVideo,
  renderMarkdown,
} from "./shared";
import { writeText } from "./files";
import { NoteEditor } from "./editor";
import { RichNoteEditor } from "./rich-editor";
import { MediaView } from "./media-view";
import { ColorPalette } from "./color-palette";
import { GroupView } from "./group-view";
import { parseNote } from "./note-group";
import type { NoteImageContext } from "./note-images";
import {
  backupLibrary,
  loadNote,
  restoreLibrary,
  saveNote,
  needsSave,
  removeMember,
  type NoteDocument,
} from "./storage";

type NoteMode = "read" | "rich" | "source";
interface Settings {
  fontSize: number;
  lineHeight: number;
  split: number;
  mode: NoteMode;
  showGroupImages: boolean;
  bounds?: Bounds;
  maximized?: boolean;
  fullscreen?: boolean;
}
const defaults: Settings = {
  fontSize: 17,
  lineHeight: 1.8,
  split: 52,
  mode: "read",
  showGroupImages: false,
};
let settings: Settings = { ...defaults };
let current: NoteDocument | null = null;
let savePromise: Promise<void> | null = null;
let syncPromise: Promise<void> | null = null;
let tickTimer: ReturnType<typeof setTimeout>;
let noticeTimer: ReturnType<typeof setTimeout>;
let visible = false;
let ready = false;
let actionBusy = false;
let switching = false;
let saveBlocked = false;
let restoredWindow = false;
let lastGeometry = 0;
let disposed = false;
let editVersion = 0;
let selectionKey = "";
let analysisRequest = 1;
let consumedAnalysisRequest = 0;
let imageContextKey = "";
function noteChanged(text: string) {
  if (!current || switching) return;
  current.text = text;
  $("word-count").textContent =
    `${text.replace(/\s/g, "").length.toLocaleString()} 字符`;
  editVersion++;
  $("save-state").textContent = "正在保存…";
  void flush().catch(showError);
}
const editor = new NoteEditor($("editor"), noteChanged);
const richEditor = new RichNoteEditor($("rich-editor"), noteChanged);
function setEditable(value: boolean) {
  editor.setEditable(value);
  richEditor.setEditable(value);
}
function focusEditor() {
  if (settings.mode === "rich") richEditor.view.focus();
  if (settings.mode === "source") editor.view.focus();
}
function editorHasFocus() {
  return editor.view.hasFocus || richEditor.hasFocus;
}
const mediaView = new MediaView(
  $("media-stage"),
  $("image"),
  $("zoom"),
  $("media-message"),
  $("open-media"),
);
const colorPalette = new ColorPalette($("palette-slot"), $("color-panel"));
const groupView = new GroupView(
  id => void action(() => previewMember(id)),
  id => void action(async () => {
    if (!current?.group || current.choices.length) return;
    await flush();
    if (!current.group || current.members.length < 2 || !current.members.some(item => item.id === id)) return;
    removeMember(current, id);
    await eagle.item.select([current.item.id]);
    present(current, "", await mediaView.prepare(current.item));
    selectionKey = "";
    await flush();
  }),
  text => void action(async () => {
    if (!current) return;
    current.text = text;
    current.choices = [];
    current.syncRequired = true;
    present(current, "", await mediaView.prepare(current.item));
    await flush();
  }),
  imageContext,
);

function imageContext(): NoteImageContext {
  return {
    members: current?.group ? current.members : [],
    showGroupImages: settings.showGroupImages,
    select: id => void action(() => previewMember(id)),
  };
}
function updateNoteImages() {
  const images = imageContext();
  const key = JSON.stringify([current?.library, images.members.map(item => [item.id, item.name]), images.showGroupImages]);
  if (key === imageContextKey) return;
  imageContextKey = key;
  richEditor.setImageContext(images);
  if (current && settings.mode === "read") renderMarkdown($("reading"), current.text, images);
  groupView.renderPreview();
}

function updateMedia(doc: NoteDocument) {
  colorPalette.update(doc.item);
  const title = doc.group ? `组分析 · ${doc.members.length} 张` : doc.item.name;
  document.title = `${title} — 视觉笔记`;
  $("window-title").textContent = title;
  $("media-meta").textContent = `${doc.item.width} × ${doc.item.height}`;
  for (const id of ["fit", "actual", "zoom"]) $(id).hidden = isVideo(doc.item);
  groupView.render(doc);
  updateNoteImages();
}

async function previewMember(id: string) {
  if (!current) return;
  const item = current.members.find(item => item.id === id);
  if (!item) return;
  const commit = await mediaView.prepare(item);
  current.item = item;
  commit();
  updateMedia(current);
}

function showError(error: unknown) {
  $("error-text").textContent = errorMessage(error);
  $("error").hidden = false;
  $("retry").hidden = !current || !needsSave(current) || !!current.choices.length;
}
function clearError() {
  $("error").hidden = true;
}
function notice(message: string) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  $("notice").hidden = !message;
  if (message) noticeTimer = setTimeout(() => { $("notice").hidden = true; }, 3200);
}
function persistSettings() {
  localStorage.setItem("visual-notes-settings", JSON.stringify(settings));
}
function applySettings() {
  const style = document.documentElement.style;
  style.setProperty("--note-size", `${settings.fontSize}px`);
  style.setProperty("--note-leading", String(settings.lineHeight));
  style.setProperty("--split", `${settings.split}%`);
  $("divider").setAttribute(
    "aria-valuenow",
    String(Math.round(settings.split)),
  );
  $<HTMLInputElement>("font-size").value = String(settings.fontSize);
  $<HTMLInputElement>("line-height").value = String(settings.lineHeight);
  $<HTMLInputElement>("show-group-images").checked = settings.showGroupImages;
}
function updateMode() {
  const available = !!current && !current.choices.length;
  $("note-empty").hidden = !!current;
  $("reading").hidden = !available || settings.mode !== "read";
  $("rich-editor").hidden = !available || settings.mode !== "rich";
  $("editor").hidden = !available || settings.mode !== "source";
  $("format-toolbar").hidden = !available || settings.mode === "read";
  for (const mode of ["read", "rich", "source"] as const) {
    $(`${mode}-mode`).setAttribute("aria-pressed", String(settings.mode === mode));
    $<HTMLButtonElement>(`${mode}-mode`).disabled = !available;
  }
  if (current && settings.mode === "read") renderMarkdown($("reading"), current.text, imageContext());
  if (current && settings.mode === "source") editor.view.requestMeasure();
}
function present(
  doc: NoteDocument | null,
  message = "在 Eagle 中选择图片或视频",
  commitMedia?: () => void,
) {
  current = doc;
  groupView.render(doc);
  updateNoteImages();
  colorPalette.update(doc?.item);
  editor.setText(doc?.text || "");
  richEditor.setText(doc?.text || "", true);
  document.title = doc ? `${doc.item.name} — 视觉笔记` : "视觉笔记";
  $("window-title").textContent = doc?.item.name || "视觉笔记";
  $("media-meta").textContent = doc
    ? `${doc.item.width} × ${doc.item.height}`
    : "";
  $("word-count").textContent = doc
    ? `${doc.text.replace(/\s/g, "").length.toLocaleString()} 字符`
    : "";
  $("save-state").textContent = "";
  $("navigation-scope").textContent = "";
  for (const id of ["previous", "next", "fit", "actual", "export-note"])
    $<HTMLButtonElement>(id).disabled = !doc || (id === "export-note" && !!doc.choices.length);
  for (const id of ["fit", "actual", "zoom"])
    $(id).hidden = !!doc && isVideo(doc.item);
  if (doc) {
    updateMedia(doc);
    if (commitMedia) commitMedia();
  } else mediaView.clear(message);
  $("note-empty").querySelector("p")!.textContent = message;
  $("reading").scrollTop = 0;
  updateMode();
}

async function flush() {
  if (savePromise) return savePromise;
  const doc = current;
  if (!doc || doc.choices.length) return;
  if (!needsSave(doc)) {
    saveBlocked = false;
    $("save-state").textContent = "";
    return;
  }
  savePromise = (async () => {
    try {
      // 写入期间继续输入时，按顺序保存到最新文本。
      while (needsSave(doc)) {
        await saveNote(doc);
      }
      saveBlocked = false;
      $("save-state").textContent = "已保存";
      updateMedia(doc);
      clearError();
    } catch (error) {
      saveBlocked = true;
      $("save-state").textContent = "尚未保存";
      throw error;
    } finally {
      savePromise = null;
    }
  })();
  return savePromise;
}

async function syncSelection() {
  if (!ready || actionBusy || saveBlocked) return;
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const request = analysisRequest;
    const library = eagle.library.path;
    const version = editVersion;
    const wasSaving = !!savePromise;
    const selected = await eagle.item.getSelected();
    if (library !== eagle.library.path) return;
    const key = JSON.stringify([library, selected.map(item => item.id)]);
    const sameSelection = key === selectionKey;
    // 保存中的轮询结果不能覆盖窗口内的新输入。
    if (sameSelection && current && (wasSaving || savePromise || needsSave(current) && !current.choices.length || version !== editVersion)) return;
    if (!sameSelection) await flush();
    const valid = selected.length > 0 && selected.every(isMedia);
    const unlinkedSelection = valid && selected.length > 1 && selected.every(item => !parseNote(item.annotation || "", item.id).group);
    // 每轮只消费开始时已有的请求，等待期间到达的请求留给下一轮。
    const requested = request !== consumedAnalysisRequest;
    consumedAnalysisRequest = request;
    const openGroup = !unlinkedSelection || requested || sameSelection && !!current?.group;
    const doc = valid && openGroup ? await loadNote(library, selected) : null;
    if (library !== eagle.library.path || version !== editVersion || savePromise) return;
    if (sameSelection && current && doc && current.snapshot === doc.snapshot &&
      (current.choices.length || JSON.stringify(current.group) === JSON.stringify(doc.group) && !doc.syncRequired)) {
      colorPalette.update(doc.members.find(item => item.id === current!.item.id));
      clearError();
      return;
    }
    const hadEditorFocus = editorHasFocus();
    switching = true;
    setEditable(false);
    try {
      if (sameSelection && current && doc) doc.item = doc.members.find(item => item.id === current!.item.id) || doc.item;
      const commitMedia = doc ? await mediaView.prepare(doc.item) : undefined;
      const latest = await eagle.item.getSelected();
      if (library !== eagle.library.path || key !== JSON.stringify([library, latest.map(item => item.id)])) return;
      selectionKey = key;
      present(doc, unlinkedSelection && !openGroup ? `已选择 ${selected.length} 张素材，请在 Eagle 中点击分析` : selected.length ? "请选择图片或视频素材" : "在 Eagle 中选择图片或视频", commitMedia);
      if (doc && !doc.choices.length) await flush();
      clearError();
    } finally {
      switching = false;
      setEditable(true);
      if (hadEditorFocus && !current?.choices.length) focusEditor();
    }
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

async function rememberWindow() {
  if (!visible || !restoredWindow) return;
  const [maximized, fullscreen] = await Promise.all([
    eagle.window.isMaximized(),
    eagle.window.isFullScreen(),
  ]);
  settings.maximized = maximized;
  settings.fullscreen = fullscreen;
  updateWindowControls(maximized || fullscreen);
  if (!maximized && !fullscreen)
    settings.bounds = await eagle.window.getBounds();
  persistSettings();
}
function updateWindowControls(expanded: boolean) {
  const label = expanded ? "还原窗口" : "最大化";
  $("window-maximize").title = label;
  $("window-maximize").setAttribute("aria-label", label);
  $("maximize-icon").setAttribute(
    "d",
    expanded ? "M3.5 1.5h7v7M1.5 3.5h7v7h-7z" : "M1.5 1.5h9v9h-9z",
  );
}
async function showWindow() {
  if (!ready) return;
  if (!restoredWindow) {
    restoredWindow = true;
    if (settings.bounds) {
      const displays = await eagle.screen.getAllDisplays();
      const b = settings.bounds;
      const display =
        displays.find(
          (d) =>
            b.x + 80 > d.workArea.x &&
            b.x < d.workArea.x + d.workArea.width - 80 &&
            b.y + 40 > d.workArea.y &&
            b.y < d.workArea.y + d.workArea.height - 40,
        ) || displays[0];
      if (display) {
        const a = display.workArea;
        const width = Math.min(Math.max(760, b.width), a.width);
        const height = Math.min(Math.max(480, b.height), a.height);
        await eagle.window.setBounds({
          width,
          height,
          x: Math.round(Math.max(a.x, Math.min(b.x, a.x + a.width - width))),
          y: Math.round(Math.max(a.y, Math.min(b.y, a.y + a.height - height))),
        });
      }
    }
    if (settings.maximized) await eagle.window.maximize();
    if (settings.fullscreen) await eagle.window.setFullScreen(true);
  }
  visible = true;
  await eagle.window.show();
  await syncSelection();
}

async function tick() {
  try {
    if (visible) {
      await syncSelection();
      if (Date.now() - lastGeometry > 2500) {
        lastGeometry = Date.now();
        await rememberWindow();
      }
    }
  } catch (error) {
    showError(error);
  } finally {
    if (!disposed) tickTimer = setTimeout(() => void tick(), 650);
  }
}

async function action(operation: () => Promise<void>) {
  if (actionBusy) return;
  actionBusy = true;
  try {
    await syncPromise;
    setEditable(false);
    await operation();
  } catch (error) {
    showError(error);
  } finally {
    actionBusy = false;
    setEditable(true);
  }
}
function onAction(id: string, operation: () => Promise<void>) {
  $(id).addEventListener("click", () => {
    $<HTMLDetailsElement>("more-menu").open = false;
    void action(operation);
  });
}

async function navigate(direction: number) {
  if (!current) return;
  await flush();
  if (current.group) {
    const index = current.members.findIndex(item => item.id === current!.item.id);
    const target = current.members[index + direction];
    if (target) await previewMember(target.id);
    return;
  }
  const library = current.library;
  if (library !== eagle.library.path)
    throw new Error("素材库已切换，请等待笔记同步。");
  const folders = await eagle.folder.getSelected();
  // 过滤非媒体素材时保留 Eagle 接口的返回顺序。
  const items = (
    await eagle.item.get({
      folders: folders.length ? folders.map((f) => f.id) : undefined,
      fields: ["id", "name", "ext", "isDeleted"],
    })
  ).filter(isMedia);
  if (library !== eagle.library.path) return;
  const index = items.findIndex((item) => item.id === current!.item.id);
  if (index < 0)
    throw new Error("当前素材不在所选文件夹中，请在 Eagle 中重新选择。");
  const target = items[index + direction];
  $("navigation-scope").textContent =
    `${folders.length ? "当前文件夹" : "本素材库"} · Eagle 返回顺序`;
  if (!target) {
    notice(direction < 0 ? "已是第一个素材" : "已是最后一个素材");
    return;
  }
  if (!(await eagle.item.select([target.id])))
    throw new Error("Eagle 未能切换素材，请在主窗口选择。");
  notice("");
}
async function exportCurrent() {
  const doc = current;
  if (!doc) return;
  const result = await eagle.dialog.showSaveDialog({
    title: "导出 Markdown 笔记",
    defaultPath: `${doc.item.name.replace(/[<>:"/\\|?*]/g, "_")}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!result.canceled && result.filePath) {
    await writeText(result.filePath, doc.text);
    notice("笔记已导出");
  }
}

onAction("previous", () => navigate(-1));
onAction("next", () => navigate(1));
onAction("retry", async () => {
  saveBlocked = false;
  await flush();
  if (!saveBlocked) clearError();
});
// 保存尚未返回时，仍可导出窗口内的文本。
let exporting = false;
$("export-note").addEventListener("click", () => {
  $<HTMLDetailsElement>("more-menu").open = false;
  if (exporting) return;
  exporting = true;
  void exportCurrent().catch(showError).finally(() => { exporting = false; });
});
onAction("open-media", async () => {
  if (current) await eagle.shell.openPath(current.item.filePath);
});
onAction("window-minimize", async () => {
  mediaView.pause();
  await eagle.window.minimize();
});
onAction("window-maximize", async () => {
  if (await eagle.window.isFullScreen()) await eagle.window.setFullScreen(false);
  else if (await eagle.window.isMaximized()) await eagle.window.unmaximize();
  else await eagle.window.maximize();
  await rememberWindow();
});
onAction("window-close", async () => {
  await flush();
  await rememberWindow();
  window.close();
});
onAction("fullscreen", async () => {
  await eagle.window.setFullScreen(!(await eagle.window.isFullScreen()));
  await rememberWindow();
});
onAction("backup", async () => {
  await flush();
  const library = eagle.library.path;
  if (!library) return;
  const result = await eagle.dialog.showSaveDialog({
    title: "备份本库图片与视频注释",
    defaultPath: `原生注释-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "注释备份", extensions: ["json"] }],
  });
  if (!result.canceled && result.filePath) {
    await backupLibrary(library, result.filePath);
    notice("本库图片与视频注释已备份");
  }
});
onAction("restore", async () => {
  await flush();
  const library = eagle.library.path;
  if (!library) return;
  const result = await eagle.dialog.showOpenDialog({
    title: "从备份补充空白注释",
    properties: ["openFile"],
    filters: [{ name: "注释备份", extensions: ["json"] }],
  });
  if (!result.canceled && result.filePaths[0]) {
    const { restored, skipped, missing } = await restoreLibrary(
      library,
      result.filePaths[0],
    );
    if (current?.library === library && library === eagle.library.path) {
      const item = await eagle.item.getById(current.item.id);
      if (item) present(await loadNote(library, [item]));
    }
    notice(
      `已补充 ${restored} 条注释，保留 ${skipped} 条已有注释，${missing} 个素材未找到`,
    );
  }
});
$("fit").onclick = () => mediaView.fit();
$("actual").onclick = () => mediaView.actual();
for (const mode of ["read", "rich", "source"] as const) {
  $(`${mode}-mode`).onclick = () => {
    if (!current || current.choices.length || switching || actionBusy) return;
    try {
      if (mode === "rich") richEditor.setText(current.text);
      if (mode === "source" && editor.view.state.doc.toString() !== current.text)
        editor.setText(current.text);
      settings.mode = mode;
      persistSettings();
      updateMode();
      focusEditor();
    } catch (error) {
      showError(error);
    }
  };
}
for (const id of ["font-size", "line-height"])
  $(id).addEventListener("input", () => {
    settings.fontSize = Number($<HTMLInputElement>("font-size").value);
    settings.lineHeight = Number($<HTMLInputElement>("line-height").value);
    applySettings();
    editor.view.requestMeasure();
    try {
      persistSettings();
    } catch (error) {
      showError(error);
    }
  });
$("show-group-images").addEventListener("change", () => {
  settings.showGroupImages = $<HTMLInputElement>("show-group-images").checked;
  updateNoteImages();
  try { persistSettings(); } catch (error) { showError(error); }
});
for (const [id, before, after] of [
  ["format-bold", "**", "**"],
  ["format-italic", "*", "*"],
  ["format-strike", "~~", "~~"],
  ["format-code", "`", "`"],
] as const) {
  $(id).onmousedown = (event) => event.preventDefault();
  $(id).onclick = () => {
    if (!actionBusy && !switching && settings.mode !== "read") {
      if (settings.mode === "rich") richEditor.wrap(before);
      else editor.wrap(before, after);
    }
  };
}
$("format-link").onmousedown = (event) => event.preventDefault();
function activeEditor() { return settings.mode === "rich" ? richEditor : editor; }
$("format-link").onclick = () => { if (!actionBusy && !switching) activeEditor().link(); };
$("format-list").onmousedown = (event) => event.preventDefault();
$("format-list").onclick = () => {
  if (!actionBusy && !switching) activeEditor().prefix("- ");
};
$("format-quote").onmousedown = (event) => event.preventDefault();
$("format-quote").onclick = () => {
  if (!actionBusy && !switching) activeEditor().prefix("> ");
};
$("heading").addEventListener("change", () => {
  if (!actionBusy && !switching)
    activeEditor().prefix($<HTMLSelectElement>("heading").value);
  $<HTMLSelectElement>("heading").value = "";
});
const divider = $("divider");
divider.addEventListener("pointerdown", (event) => {
  divider.setPointerCapture(event.pointerId);
  event.preventDefault();
});
divider.addEventListener("pointermove", (event) => {
  if (!divider.hasPointerCapture(event.pointerId)) return;
  const rect = $("workspace").getBoundingClientRect();
  settings.split = Math.max(
    25,
    Math.min(75, ((event.clientX - rect.left) / rect.width) * 100),
  );
  applySettings();
});
divider.addEventListener("pointerup", (event) => {
  divider.releasePointerCapture(event.pointerId);
  try {
    persistSettings();
  } catch (error) {
    showError(error);
  }
});
divider.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
  event.preventDefault();
  settings.split =
    event.key === "Home"
      ? 52
      : Math.max(
          25,
          Math.min(75, settings.split + (event.key === "ArrowLeft" ? -2 : 2)),
        );
  applySettings();
  try {
    persistSettings();
  } catch (error) {
    showError(error);
  }
});
const moreMenu = $<HTMLDetailsElement>("more-menu");
// 菜单关闭不拦截点击，用户可直接继续操作图片或正文。
for (const name of ["pointerdown", "focusin"])
  document.addEventListener(name, (event) => {
    if (!moreMenu.contains(event.target as Node)) moreMenu.open = false;
  });
window.addEventListener("blur", () => { moreMenu.open = false; });
window.addEventListener("resize", () => {
  void rememberWindow().catch(showError);
});
document.addEventListener("keydown", (event) => {
  if ($<HTMLDialogElement>("link-dialog").open) return;
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "z" &&
    !editorHasFocus()
  )
    event.preventDefault();
  if (event.key === "F11") {
    event.preventDefault();
    $("fullscreen").click();
  }
  if (event.key === "Escape" && moreMenu.open) {
    moreMenu.open = false;
    moreMenu.querySelector("summary")!.focus();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void flush().catch(showError);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
    event.preventDefault();
    $(settings.mode === "read" ? "rich-mode" : "read-mode").click();
  }
  if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    void action(() => navigate(event.key === "ArrowLeft" ? -1 : 1));
  }
});
bindLinks($("reading"), showError);
bindLinks($("group-preview"), showError);

eagle.onPluginCreate(() => {
  void (async () => {
    if (eagle.app.build < 12)
      throw new Error("视觉笔记需要 Eagle 4.0 Build 12 或更新版本。");
    const stored = localStorage.getItem("visual-notes-settings");
    if (stored) settings = { ...defaults, ...JSON.parse(stored) };
    if (!["read", "rich", "source"].includes(settings.mode)) settings.mode = "read";
    applySettings();
    applyTheme(eagle.app.theme);
    await richEditor.create();
    ready = true;
    await showWindow();
    void tick();
  })().catch((error) => {
    showError(error);
    void eagle.window.show();
  });
});
eagle.onPluginRun(() => {
  analysisRequest++;
  void showWindow().catch(showError);
});
eagle.onPluginShow(() => {
  visible = true;
  if (ready) void syncSelection().catch(showError);
});
eagle.onPluginHide(() => {
  mediaView.pause();
  void (async () => {
    await rememberWindow();
    visible = false;
    await flush();
  })().catch((error) => {
    showError(error);
    void eagle.window.show();
  });
});
eagle.onLibraryChanged(() => {
  if (visible) void syncSelection().catch(showError);
});
eagle.onThemeChanged(applyTheme);
eagle.onPluginBeforeExit(() => {
  mediaView.clear();
  disposed = true;
  clearTimeout(tickTimer);
  clearTimeout(noticeTimer);
});
window.addEventListener("beforeunload", (event) => {
  mediaView.pause();
  if (!current || !needsSave(current) || current.choices.length) return;
  event.preventDefault();
  event.returnValue = false as unknown as string;
  void flush().catch(showError);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) mediaView.pause();
});
