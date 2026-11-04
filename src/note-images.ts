import { fileURL } from "./files";

// 注释只保存素材 ID，显示时从当前素材库取得文件地址。
export function resolveNoteImage(image: HTMLImageElement, source: string) {
  const id = /^eagle-image:([\w-]+)$/.exec(source)?.[1];
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
