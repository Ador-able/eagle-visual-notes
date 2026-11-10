import { promises as fs } from "fs";
import { isMedia } from "./shared";
import { writeText } from "./files";
import { randomUUID } from "crypto";
import { parseNote, serializeNote, type NoteGroup } from "./note-group";

export interface NoteDocument {
  library: string;
  item: EagleItem;
  base: string;
  text: string;
  members: EagleItem[];
  group?: NoteGroup;
  syncRequired: boolean;
  clearIds: string[];
  choices: { item: EagleItem; text: string }[];
  snapshot: string;
}
export function requireLibrary(library: string) {
  if (library !== eagle.library.path)
    throw new Error(
      "注释尚未保存，所属素材库已切换。请切回原素材库后重试保存。",
    );
}
function noteSnapshot(items: EagleItem[]) {
  return JSON.stringify(items.map(item => [item.id, item.annotation || ""]));
}

export async function loadNote(library: string, selected: EagleItem[]): Promise<NoteDocument> {
  requireLibrary(library);
  const notes = selected.map(item => parseNote(item.annotation || "", item.id));
  const group = notes.find(note => note.group)?.group;
  let members = selected;
  let targetGroup: NoteGroup | undefined;
  const clearIds: string[] = [];
  if (group) {
    if (selected.some((item, index) => !group.items.includes(item.id) ||
      (notes[index].group && notes[index].group!.id !== group.id)))
      throw new Error("所选素材包含不同关联，请先移出原组，再选择需要共同分析的素材。");
    const found = await eagle.item.get({ ids: [...group.items, ...(group.removed || [])] });
    requireLibrary(library);
    const byId = new Map(found.map(item => [item.id, item]));
    members = group.items.map(id => byId.get(id)).filter((item): item is EagleItem => !!item && isMedia(item));
    // 移出意图随注释保存，重新打开任意成员都能继续完成清空。
    const linked = members.map(item => ({ item, note: parseNote(item.annotation || "", item.id) }));
    const related = linked.filter(({ note }) => note.group?.id === group.id);
    clearIds.push(...new Set([...(group.removed || []), ...related.flatMap(entry => entry.note.group!.removed || [])]));
    members = linked.filter(({ item, note }) => !clearIds.includes(item.id) && (!note.group || note.group.id === group.id)).map(entry => entry.item);
    targetGroup = { version: 1, id: group.id, items: members.map(item => item.id) };
  } else if (members.length > 1) {
    targetGroup = { version: 1, id: randomUUID(), items: members.map(item => item.id) };
  }
  if (!members.length) throw new Error("当前素材已不存在，请重新选择图片或视频。");
  const choices: NoteDocument["choices"] = [];
  for (const item of members) {
    const { text } = parseNote(item.annotation || "", item.id);
    if ((!group && members.length > 1 && !text.trim()) || choices.some(choice => choice.text === text)) continue;
    choices.push({ item, text });
  }
  const text = choices[0]?.text || "";
  if (members.length === 1 && !clearIds.length) targetGroup = undefined;
  const annotation = serializeNote(text, targetGroup);
  return {
    library, item: members.find(item => item.id === selected[0].id) || members[0], members,
    group: targetGroup, text, base: text, clearIds, choices: choices.length > 1 ? choices : [],
    syncRequired: clearIds.length > 0 || members.some(item => (item.annotation || "") !== annotation),
    snapshot: noteSnapshot(members),
  };
}

export function needsSave(doc: NoteDocument) {
  return doc.syncRequired || doc.text !== doc.base || doc.clearIds.length > 0;
}

// 全组完成后才推进基线；中途失败保留待写内容，重试跳过已经一致的成员。
export async function saveNote(doc: NoteDocument) {
  if (!needsSave(doc)) return;
  requireLibrary(doc.library);
  const found = await eagle.item.get({ ids: doc.members.map(item => item.id) });
  requireLibrary(doc.library);
  const byId = new Map(found.map(item => [item.id, item]));
  const members = doc.members.map(item => byId.get(item.id)).filter((item): item is EagleItem => !!item && isMedia(item));
  if (!members.length) throw new Error("素材已不存在或已被移入回收站，无法保存注释。");
  if (!doc.group && members.length !== doc.members.length) throw new Error("素材已不存在，无法保存注释。");
  doc.members = members;
  if (!members.some(item => item.id === doc.item.id)) doc.item = members[0];
  if (doc.group) doc.group = { version: 1, id: doc.group.id, items: members.map(item => item.id), ...(doc.clearIds.length ? { removed: [...doc.clearIds] } : {}) };
  if (members.length === 1 && !doc.clearIds.length) doc.group = undefined;
  const text = doc.text;
  const annotation = serializeNote(text, doc.group);
  doc.syncRequired = true;
  let completed = 0;
  try {
    for (const item of members) {
      requireLibrary(doc.library);
      if ((item.annotation || "") !== annotation) {
        item.annotation = annotation;
        await item.save();
      }
      requireLibrary(doc.library);
      completed++;
    }
    // 先记录移出意图，再清空目标，最后去掉完成标记。
    while (doc.clearIds.length) {
      const item = await eagle.item.getById(doc.clearIds[0]);
      requireLibrary(doc.library);
      if (item && !item.isDeleted) {
        item.annotation = "";
        await item.save();
        requireLibrary(doc.library);
      }
      doc.clearIds.shift();
    }
    if (doc.group?.removed) {
      const group = members.length > 1 ? { version: 1 as const, id: doc.group.id, items: doc.group.items } : undefined;
      const finalAnnotation = serializeNote(text, group);
      completed = 0;
      for (const item of members) {
        requireLibrary(doc.library);
        item.annotation = finalAnnotation;
        await item.save();
        requireLibrary(doc.library);
        completed++;
      }
      doc.group = group;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(members.length > 1 || doc.group || doc.clearIds.length
      ? `组分析尚未同步完成，${members.length - completed} 张未同步${doc.clearIds.length ? `，${doc.clearIds.length} 张待清空` : ""}。${reason}`
      : reason);
  }
  doc.base = text;
  doc.syncRequired = false;
  doc.item = members.find(item => item.id === doc.item.id)!;
  doc.snapshot = noteSnapshot(members);
}

export function removeMember(doc: NoteDocument, id: string) {
  doc.members = doc.members.filter(item => item.id !== id);
  doc.group = { ...doc.group!, items: doc.members.map(item => item.id) };
  doc.clearIds.push(id);
  doc.syncRequired = true;
  if (doc.item.id === id) doc.item = doc.members[0];
}

export async function backupLibrary(library: string, target: string) {
  requireLibrary(library);
  const items = await eagle.item.get({
    fields: ["id", "name", "ext", "annotation", "isDeleted"],
  });
  requireLibrary(library);
  const notes: Record<string, { name: string; annotation: string }> = {};
  for (const item of items.filter(isMedia)) {
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
      throw new Error("备份包含无效的素材 ID 或注释。");
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
