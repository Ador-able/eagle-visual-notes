import { fileURL } from "./files";

export interface NoteImageContext {
  members: readonly Pick<EagleItem, "id" | "name">[];
  showGroupImages: boolean;
  select: (id: string) => void;
}

const imageId = (source: string) => /^eagle-image:([\w-]+)$/.exec(source)?.[1];

export function createNoteImage(source: string, alt: string, title: string, context?: NoteImageContext): HTMLElement {
  const id = imageId(source);
  const member = id && context?.members.find(item => item.id === id);
  let reference: HTMLButtonElement | undefined;
  if (member && context) {
    reference = document.createElement("button");
    reference.type = "button";
    reference.className = "note-image-reference";
    reference.dataset.noteImage = member.id;
    reference.title = `在左侧查看：${alt || member.name}`;
    reference.setAttribute("aria-label", reference.title);
    reference.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      context.select(member.id);
    };
    if (!context.showGroupImages) {
      // 隐藏的组内配图只保留文字入口，不加载图片文件。
      reference.textContent = alt || member.name;
      return reference;
    }
    reference.classList.add("note-image-expanded");
  }
  const image = document.createElement("img");
  if (!id) image.src = source;
  image.alt = alt;
  if (title) image.title = title;
  image.draggable = true;
  resolveNoteImage(image, source);
  if (reference) reference.append(image);
  return reference || image;
}

// 注释只保存素材 ID，显示时从当前素材库取得文件地址。
function resolveNoteImage(image: HTMLImageElement, source: string) {
  const id = imageId(source);
  if (!id) return;
  const library = eagle.library.path;
  const alt = image.alt;
  const title = image.title;
  image.removeAttribute("src");
  const unavailable = () => {
    image.alt = `图片素材不可用：${alt || id}`;
    image.title = "请检查素材是否仍在当前素材库中";
  };
  image.onerror = unavailable;
  void eagle.item.getById(id).then((item) => {
    if (!image.isConnected || eagle.library.path !== library) return;
    if (!item || item.isDeleted || !item.filePath) {
      unavailable();
      return;
    }
    image.alt = alt;
    image.title = title;
    image.src = fileURL(item.filePath);
  }).catch(() => {
    if (image.isConnected && eagle.library.path === library) unavailable();
  });
}
