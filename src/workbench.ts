import path from "path";
import {
  $,
  applyTheme,
  bindLinks,
  controlRoot,
  errorMessage,
  isImage,
  readText,
  renderMarkdown,
  writeText,
} from "./shared";
import { NoteEditor } from "./editor";
import { ImageView } from "./image-view";
import {
  backupLibrary,
  loadNote,
  restoreLibrary,
  saveNote,
  type NoteDocument,
} from "./storage";

interface Settings {
  fontSize: number;
  lineHeight: number;
  split: number;
  editing: boolean;
  bounds?: Bounds;
  maximized?: boolean;
  fullscreen?: boolean;
}
const defaults: Settings = {
  fontSize: 17,
  lineHeight: 1.8,
  split: 52,
  editing: false,
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
let control = "";
let lastRequest = "";
let restoredWindow = false;
let lastGeometry = 0;
let disposed = false;
let editVersion = 0;
const editor = new NoteEditor($("editor"), (text) => {
  if (!current || switching) return;
  current.text = text;
  $("word-count").textContent =
    `${text.replace(/\s/g, "").length.toLocaleString()} 字符`;
  editVersion++;
  $("save-state").textContent = "正在保存…";
  void flush().catch(showError);
});
const imageView = new ImageView(
  $("image-stage"),
  $("image"),
  $("zoom"),
  $("image-message"),
);

function showError(error: unknown) {
  $("error-text").textContent = errorMessage(error);
  $("error").hidden = false;
  $("retry").hidden = !current || current.text === current.base;
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
}
function updateMode() {
  $("note-empty").hidden = !!current;
  $("reading").hidden = !current || settings.editing;
  $("editor").hidden = !current || !settings.editing;
  $("format-toolbar").hidden = !current || !settings.editing;
  $("read-mode").setAttribute("aria-pressed", String(!settings.editing));
  $("edit-mode").setAttribute("aria-pressed", String(settings.editing));
  $<HTMLButtonElement>("edit-mode").disabled = !current;
  if (current && !settings.editing) renderMarkdown($("reading"), current.text);
  if (current && settings.editing) editor.view.requestMeasure();
}
function present(
  doc: NoteDocument | null,
  message = "在 Eagle 中选择一张图片",
  commitImage?: () => void,
) {
  current = doc;
  editor.setText(doc?.text || "");
  document.title = doc ? `${doc.item.name} — 视觉笔记` : "视觉笔记";
  $("window-title").textContent = doc?.item.name || "视觉笔记";
  $("image-meta").textContent = doc
    ? `${doc.item.width} × ${doc.item.height}`
    : "";
  $("word-count").textContent = doc
    ? `${doc.text.replace(/\s/g, "").length.toLocaleString()} 字符`
    : "";
  $("save-state").textContent = "";
  $("navigation-scope").textContent = "";
  for (const id of ["previous", "next", "fit", "actual", "export-note"])
    $<HTMLButtonElement>(id).disabled = !doc;
  if (doc) {
    if (commitImage) commitImage();
  } else imageView.clear(message);
  $("note-empty").querySelector("p")!.textContent = message;
  $("reading").scrollTop = 0;
  updateMode();
}

async function flush() {
  if (savePromise) return savePromise;
  const doc = current;
  if (!doc) return;
  if (doc.text === doc.base) {
    saveBlocked = false;
    $("save-state").textContent = "";
    return;
  }
  savePromise = (async () => {
    try {
      // 写入期间继续输入时，按顺序保存到最新文本。
      while (doc.text !== doc.base) {
        await saveNote(doc);
      }
      saveBlocked = false;
      $("save-state").textContent = "已保存";
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
    const library = eagle.library.path;
    const version = editVersion;
    const wasSaving = !!savePromise;
    const selected = await eagle.item.getSelected();
    if (library !== eagle.library.path) return;
    const item =
      selected.length === 1 && isImage(selected[0]) ? selected[0] : null;
    if (current?.library === library && current.item.id === item?.id) {
      // 丢弃本次输入之前发出的旧查询，避免将已经保存的新文字显示成旧内容。
      const annotation = item?.annotation || "";
      if (
        version === editVersion &&
        !wasSaving &&
        current.text === current.base &&
        !savePromise &&
        annotation !== current.base
      ) {
        current.base = annotation;
        current.text = annotation;
        current.item = item!;
        editor.setText(annotation);
        updateMode();
        $("word-count").textContent =
          `${annotation.replace(/\s/g, "").length.toLocaleString()} 字符`;
      }
      return;
    }
    const hadEditorFocus = editor.view.hasFocus;
    switching = true;
    editor.setEditable(false);
    try {
      await flush();
      const doc = item ? loadNote(library, item) : null;
      const commitImage = item ? await imageView.prepare(item) : undefined;
      const latest = await eagle.item.getSelected();
      // 查询返回后再次核对选择，快速切图时不展示已经过时的结果。
      if (
        library !== eagle.library.path ||
        selected.map((i) => i.id).join(",") !==
          latest.map((i) => i.id).join(",")
      )
        return;
      const message =
        selected.length > 1
          ? `已选中 ${selected.length} 个素材，请单选一张图片`
          : selected.length
            ? "请选择图片素材"
            : "在 Eagle 中选择一张图片";
      present(doc, message, commitImage);
      clearError();
    } finally {
      switching = false;
      editor.setEditable(true);
      if (hadEditorFocus && settings.editing) editor.view.focus();
    }
  })().finally(() => {
    syncPromise = null;
  });
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
    const request = await readText(path.join(control, "open.request"));
    if (request && request !== lastRequest) {
      lastRequest = request;
      await showWindow();
      await writeText(path.join(control, "open.ack"), request);
    }
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
    editor.setEditable(false);
    await operation();
  } catch (error) {
    showError(error);
  } finally {
    actionBusy = false;
    editor.setEditable(true);
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
  const library = current.library;
  if (library !== eagle.library.path)
    throw new Error("素材库已切换，请等待笔记同步。");
  const folders = await eagle.folder.getSelected();
  const items = (
    await eagle.item.get({
      folders: folders.length ? folders.map((f) => f.id) : undefined,
      fields: ["id", "name", "ext", "isDeleted"],
    })
  )
    .filter(isImage)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
  if (library !== eagle.library.path) return;
  const index = items.findIndex((item) => item.id === current!.item.id);
  if (index < 0)
    throw new Error("当前图片不在所选文件夹中，请在 Eagle 中重新选择图片。");
  const target = items[index + direction];
  $("navigation-scope").textContent =
    `${folders.length ? "当前文件夹" : "本素材库"} · 名称顺序`;
  if (!target) {
    notice(direction < 0 ? "已是第一张图片" : "已是最后一张图片");
    return;
  }
  if (!(await eagle.item.select([target.id])))
    throw new Error("Eagle 未能切换图片，请在主窗口选择。");
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
onAction("export-note", exportCurrent);
onAction("window-minimize", () => eagle.window.minimize());
onAction("window-maximize", async () => {
  if (await eagle.window.isFullScreen()) await eagle.window.setFullScreen(false);
  else if (await eagle.window.isMaximized()) await eagle.window.unmaximize();
  else await eagle.window.maximize();
  await rememberWindow();
});
onAction("window-close", async () => {
  await flush();
  await rememberWindow();
  await eagle.window.hide();
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
    title: "备份本库图片注释",
    defaultPath: `原生注释-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "注释备份", extensions: ["json"] }],
  });
  if (!result.canceled && result.filePath) {
    await backupLibrary(library, result.filePath);
    notice("本库图片注释已备份");
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
    if (current?.library === library && library === eagle.library.path)
      present(loadNote(library, await eagle.item.getById(current.item.id)));
    notice(
      `已补充 ${restored} 条注释，保留 ${skipped} 条已有注释，${missing} 个素材未找到`,
    );
  }
});
$("fit").onclick = () => imageView.fit();
$("actual").onclick = () => imageView.actual();
for (const [id, editing] of [
  ["read-mode", false],
  ["edit-mode", true],
] as const) {
  $(id).onclick = () => {
    settings.editing = editing;
    try {
      persistSettings();
    } catch (error) {
      showError(error);
    }
    updateMode();
    if (editing && current) editor.view.focus();
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
for (const [id, before, after] of [
  ["format-bold", "**", "**"],
  ["format-italic", "*", "*"],
  ["format-strike", "~~", "~~"],
  ["format-code", "`", "`"],
] as const) {
  $(id).onmousedown = (event) => event.preventDefault();
  $(id).onclick = () => {
    if (!actionBusy && !switching) editor.wrap(before, after);
  };
}
$("format-link").onmousedown = (event) => event.preventDefault();
$("format-link").onclick = () => { if (!actionBusy && !switching) editor.link(); };
$("format-list").onclick = () => {
  if (!actionBusy && !switching) editor.prefix("- ");
};
$("format-quote").onclick = () => {
  if (!actionBusy && !switching) editor.prefix("> ");
};
$("heading").addEventListener("change", () => {
  if (!actionBusy && !switching)
    editor.prefix($<HTMLSelectElement>("heading").value);
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
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "z" &&
    !editor.view.hasFocus
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
    $(settings.editing ? "read-mode" : "edit-mode").click();
  }
  if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    void action(() => navigate(event.key === "ArrowLeft" ? -1 : 1));
  }
});
bindLinks($("reading"), showError);

eagle.onPluginCreate(() => {
  void (async () => {
    if (eagle.app.build < 12)
      throw new Error("视觉笔记需要 Eagle 4.0 Build 12 或更新版本。");
    const stored = localStorage.getItem("visual-notes-settings");
    if (stored) settings = { ...defaults, ...JSON.parse(stored) };
    applySettings();
    applyTheme(eagle.app.theme);
    control = await controlRoot();
    lastRequest = await readText(path.join(control, "open.request"));
    ready = true;
    await syncSelection();
    void tick();
  })().catch((error) => {
    showError(error);
    void eagle.window.show();
  });
});
eagle.onPluginRun(() => {
  void showWindow().catch(showError);
});
eagle.onPluginShow(() => {
  visible = true;
  if (ready) void syncSelection().catch(showError);
});
eagle.onPluginHide(() => {
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
  disposed = true;
  clearTimeout(tickTimer);
  clearTimeout(noticeTimer);
});
window.addEventListener("beforeunload", (event) => {
  if (!current || current.text === current.base) return;
  event.preventDefault();
  event.returnValue = false as unknown as string;
  void flush().catch(showError);
});
