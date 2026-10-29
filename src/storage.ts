import { promises as fs } from "fs";
import { isImage, writeText } from "./shared";

export interface NoteDocument {
  library: string;
  item: EagleItem;
  base: string;
  text: string;
}
export function requireLibrary(library: string) {
  if (library !== eagle.library.path)
    throw new Error(
      "注释尚未保存，所属素材库已切换。请切回原素材库后重试保存。",
    );
}
export function loadNote(library: string, item: EagleItem): NoteDocument {
  return {
    library,
    item,
    base: item.annotation || "",
    text: item.annotation || "",
  };
}

// 每次保存重新读取素材，只修改原生注释。
export async function saveNote(doc: NoteDocument) {
  if (doc.text === doc.base) return;
  requireLibrary(doc.library);
  const item = await eagle.item.getById(doc.item.id);
  requireLibrary(doc.library);
  if (!item || item.isDeleted)
    throw new Error("图片已不存在或已被移入回收站，无法保存注释。");
  const annotation = item.annotation || "";
  if (annotation === doc.text) {
    doc.base = annotation;
    return;
  }
  const text = doc.text;
  item.annotation = text;
  try {
    await item.save();
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Eagle 未能保存原生注释，请检查素材库磁盘连接后重试。");
  }
  requireLibrary(doc.library);
  doc.base = text;
  doc.item.annotation = text;
}

export async function backupLibrary(library: string, target: string) {
  requireLibrary(library);
  const items = await eagle.item.get({
    fields: ["id", "name", "ext", "annotation", "isDeleted"],
  });
  requireLibrary(library);
  const notes: Record<string, { name: string; annotation: string }> = {};
  for (const item of items.filter(isImage)) {
    if (item.annotation)
      notes[item.id] = { name: item.name, annotation: item.annotation };
  }
  await writeText(
    target,
    JSON.stringify(
      {
        format: "eagle-native-annotations",
        version: 1,
        createdAt: new Date().toISOString(),
        notes,
      },
      null,
      2,
    ),
  );
}
export async function restoreLibrary(library: string, source: string) {
  const backup = JSON.parse(await fs.readFile(source, "utf8"));
  if (
    backup.format !== "eagle-native-annotations" ||
    backup.version !== 1 ||
    !backup.notes ||
    typeof backup.notes !== "object" ||
    Array.isArray(backup.notes)
  )
    throw new Error("不是有效的原生注释备份。");
  const entries = Object.entries(backup.notes) as [
    string,
    { annotation: string },
  ][];
  for (const [id, value] of entries) {
    if (!/^[\w-]+$/.test(id) || !value || typeof value.annotation !== "string")
      throw new Error("备份包含无效的图片 ID 或注释。");
  }
  let restored = 0,
    skipped = 0,
    missing = 0;
  for (const [id, value] of entries) {
    requireLibrary(library);
    const item = await eagle.item.getById(id);
    requireLibrary(library);
    if (!item || item.isDeleted) {
      missing++;
      continue;
    }
    if (item.annotation) {
      skipped++;
      continue;
    }
    item.annotation = value.annotation;
    await item.save();
    restored++;
  }
  return { restored, skipped, missing };
}
