import path from "path";
import { randomUUID } from "crypto";
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

let stopped = false;
let lastContent = "";
let root = "";
let timer: ReturnType<typeof setTimeout>;
function showError(error: unknown) {
  $("inspector-status").hidden = false;
  $("inspector-status").textContent = errorMessage(error);
}
async function refresh() {
  try {
    const library = eagle.library.path;
    const selected = await eagle.item.getSelected();
    if (library !== eagle.library.path) return;
    const item =
      selected.length === 1 && isImage(selected[0]) ? selected[0] : null;
    if (!item) {
      $("preview").textContent =
        selected.length > 1 ? "请单选一张图片查看笔记" : "请选择一张图片";
      lastContent = "";
      return;
    }
    const text = item.annotation || "";
    const key = `${library}/${item.id}/${text}`;
    if (key !== lastContent) {
      renderMarkdown($("preview"), text);
      lastContent = key;
    }
  } catch (error) {
    showError(error);
  } finally {
    if (!stopped) timer = setTimeout(() => void refresh(), 900);
  }
}
$("expand").onclick = async () => {
  const button = $<HTMLButtonElement>("expand");
  button.disabled = true;
  $("inspector-status").hidden = true;
  try {
    const request = randomUUID();
    await writeText(path.join(root, "open.request"), request);
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !stopped) {
      if ((await readText(path.join(root, "open.ack"))) === request) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!stopped)
      throw new Error("工作台未响应，请在 Eagle 插件菜单中打开「视觉笔记」。");
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
};
bindLinks($("preview"), showError);
eagle.onPluginCreate(() => {
  void (async () => {
    applyTheme(eagle.app.theme);
    root = await controlRoot();
    await refresh();
  })().catch(showError);
});
eagle.onThemeChanged(applyTheme);
window.addEventListener("unload", () => {
  stopped = true;
  clearTimeout(timer);
});
