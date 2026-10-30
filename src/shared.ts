import MarkdownIt from "markdown-it";

const imageExtensions = new Set(
  "jpg jpeg png webp gif bmp avif svg tif tiff heic heif psd ai eps raw cr2 cr3 nef arw dng raf orf rw2 jxl".split(
    " ",
  ),
);
export const nativeImageExtensions = new Set(
  "jpg jpeg png webp gif bmp avif svg".split(" "),
);
const videoExtensions = new Set(
  "mp4 m4v mov webm mkv avi wmv flv mpg mpeg ts mts m2ts 3gp ogv".split(" "),
);
export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const isVideo = (item: EagleItem) => videoExtensions.has(item.ext.toLowerCase());
export const isMedia = (item: EagleItem) =>
  !item.isDeleted && (imageExtensions.has(item.ext.toLowerCase()) || isVideo(item));

// Markdown 禁用原始 HTML，避免笔记内容在启用 Node 的插件中执行脚本。
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
export function renderMarkdown(target: HTMLElement, text: string) {
  target.innerHTML = text.trim()
    ? markdown.render(text)
    : '<p class="empty-note">还没有分析笔记</p>';
}
export function bindLinks(
  target: HTMLElement,
  onError: (error: unknown) => void,
) {
  target.addEventListener("click", (event) => {
    const link = (event.target as Element).closest("a");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href))
      eagle.shell.openExternal(href).catch(onError);
  });
}
export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.dark = String(
    !["LIGHT", "LIGHTGRAY"].includes(theme) &&
      (theme !== "Auto" || eagle.app.isDarkColors()),
  );
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
