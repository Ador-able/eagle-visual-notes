import {
  Editor, EditorStatus, rootCtx, editorViewCtx, editorViewOptionsCtx, serializerCtx,
} from "@milkdown/kit/core";
import {
  commonmark, inlineCodeKeymap, bulletListKeymap, orderedListKeymap,
  blockquoteKeymap, toggleStrongCommand, toggleEmphasisCommand,
  toggleInlineCodeCommand, wrapInHeadingCommand, turnIntoTextCommand,
  wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm, strikethroughKeymap, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { keymap } from "@milkdown/kit/prose/keymap";
import { getMarkRange } from "@milkdown/kit/prose";
import { $prose, callCommand, replaceAll } from "@milkdown/kit/utils";
import { $ } from "./shared";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "@milkdown/kit/prose/gapcursor/style/gapcursor.css";

export class RichNoteEditor {
  private editor: Editor;
  private replacing = false;
  private editable = true;
  private text = "";
  private linkDialog = $<HTMLDialogElement>("link-dialog");

  constructor(parent: HTMLElement, onChange: (text: string) => void) {
    // 同步接收正文变化，立即切换模式或图片时也能保存最后一次输入。
    const changes = $prose((ctx) => new Plugin({
      view: () => ({
        update: (view, previous) => {
          if (this.replacing || view.state.doc.eq(previous.doc)) return;
          this.text = ctx.get(serializerCtx)(view.state.doc);
          onChange(this.text);
        },
      }),
    }));
    const shortcuts = $prose(() => keymap({ "Mod-k": () => this.link() }));
    this.editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, parent);
        ctx.set(editorViewOptionsCtx, {
          editable: () => this.editable,
          attributes: { class: "markdown", "aria-label": "渲染笔记编辑器", spellcheck: "false" },
          handleDOMEvents: { click: (_view, event) => {
            if (!(event.target as Element).closest("a")) return false;
            event.preventDefault();
            return true;
          } },
        });
        ctx.set(inlineCodeKeymap.key, { ToggleInlineCode: { shortcuts: "Mod-`" } });
        ctx.set(strikethroughKeymap.key, { ToggleStrikethrough: { shortcuts: "Mod-Shift-x" } });
        ctx.set(bulletListKeymap.key, { WrapInBulletList: { shortcuts: "Mod-Shift-8" } });
        ctx.set(orderedListKeymap.key, { WrapInOrderedList: { shortcuts: "Mod-Shift-7" } });
        ctx.set(blockquoteKeymap.key, { WrapInBlockquote: { shortcuts: "Mod-Shift-." } });
      })
      .use(commonmark).use(gfm).use(history).use(clipboard).use(cursor)
      .use(changes).use(shortcuts);
    $("link-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const href = $<HTMLInputElement>("link-url").value.trim();
      if (!href) return;
      const view = this.view;
      const { from, to, empty } = view.state.selection;
      const tr = view.state.tr;
      if (empty) tr.insertText("链接文字", from);
      const end = empty ? from + 4 : to;
      tr.addMark(from, end, view.state.schema.marks.link.create({ href }));
      tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(end)));
      view.dispatch(tr);
      this.linkDialog.close();
      view.focus();
    });
    $("link-cancel").onclick = () => { this.linkDialog.close(); this.view.focus(); };
  }

  async create() { await this.editor.create(); }
  get view() { return this.editor.ctx.get(editorViewCtx); }
  get hasFocus() { return this.editor.status === EditorStatus.Created && this.view.hasFocus(); }
  setText(text: string, reset = false) {
    if (!reset && text === this.text) return;
    this.linkDialog.close();
    this.replacing = true;
    try {
      // 重建文档会清空撤销历史，避免将上一张图片的内容撤销回来。
      this.editor.action(replaceAll(text, true));
      this.text = text;
    } finally { this.replacing = false; }
  }
  setEditable(value: boolean) {
    this.editable = value;
    if (this.editor.status === EditorStatus.Created)
      this.view.setProps({ editable: () => this.editable });
  }
  wrap(marker: string) {
    if (!this.editable) return;
    const command = {
      "**": toggleStrongCommand, "*": toggleEmphasisCommand,
      "~~": toggleStrikethroughCommand, "`": toggleInlineCodeCommand,
    }[marker]!;
    this.editor.action(callCommand(command.key));
    this.view.focus();
  }
  prefix(prefix: string) {
    if (!this.editable) return;
    if (prefix.startsWith("#"))
      this.editor.action(callCommand(wrapInHeadingCommand.key, prefix.trim().length));
    else {
      const command = { "- ": wrapInBulletListCommand, "1. ": wrapInOrderedListCommand,
        "> ": wrapInBlockquoteCommand, "": turnIntoTextCommand }[prefix]!;
      this.editor.action(callCommand(command.key));
    }
    this.view.focus();
  }
  link() {
    if (!this.editable) return false;
    const { $from } = this.view.state.selection;
    const range = getMarkRange($from, this.view.state.schema.marks.link);
    if (range && this.view.state.selection.empty)
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, range.from, range.to)));
    $<HTMLInputElement>("link-url").value = range?.mark.attrs.href || "https://";
    this.linkDialog.showModal();
    $<HTMLInputElement>("link-url").select();
    return true;
  }
}
