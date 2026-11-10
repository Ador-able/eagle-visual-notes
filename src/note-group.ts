export interface NoteGroup {
  version: 1;
  id: string;
  items: string[];
  removed?: string[];
}

const footer = /(?:\r?\n){2}<!-- eagle-note-group:(\{[^\r\n]*\}) -->\s*$/;

// 关联只在注释末尾解析，正文和编辑器不接触协议。
export function parseNote(annotation: string, itemId: string) {
  const match = footer.exec(annotation);
  if (!match) return { text: annotation, group: undefined };
  let value: NoteGroup;
  try {
    value = JSON.parse(match[1]);
    if (value.version !== 1 || typeof value.id !== "string" || !/^[\w-]+$/.test(value.id) ||
      !Array.isArray(value.items) || !value.items.length ||
      value.items.some(id => typeof id !== "string" || !/^[\w-]+$/.test(id)) ||
      new Set(value.items).size !== value.items.length || !value.items.includes(itemId) ||
      (value.removed !== undefined && (!Array.isArray(value.removed) ||
        value.removed.some(id => typeof id !== "string" || !/^[\w-]+$/.test(id) || value.items.includes(id))))) throw new Error();
  } catch {
    throw new Error("组分析的关联协议无效，请检查 Eagle 注释末尾的关联信息。");
  }
  return { text: annotation.slice(0, match.index), group: value };
}

export function serializeNote(text: string, group?: NoteGroup) {
  return group ? `${text}\n\n<!-- eagle-note-group:${JSON.stringify(group)} -->` : text;
}
