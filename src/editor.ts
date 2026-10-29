import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";

export class NoteEditor {
  view: EditorView;
  private editable = new Compartment();
  private replacing = false;
  private extensions: Extension;
  constructor(parent: HTMLElement, onChange: (text: string) => void) {
    this.extensions = [
      markdown(),
      history(),
      drawSelection(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      keymap.of([
        { key: "Mod-b", run: () => this.wrap("**") },
        { key: "Mod-i", run: () => this.wrap("*") },
        { key: "Mod-k", run: () => this.link() },
        { key: "Mod-`", run: () => this.wrap("`") },
        { key: "Mod-Shift-x", run: () => this.wrap("~~") },
        { key: "Mod-Shift-7", run: () => this.prefix("1. ") },
        { key: "Mod-Shift-8", run: () => this.prefix("- ") },
        { key: "Mod-Shift-.", run: () => this.prefix("> ") },
        ...Array.from({ length: 7 }, (_, level) => ({
          key: `Mod-Alt-${level}`,
          run: () => this.prefix(level ? `${"#".repeat(level)} ` : ""),
        })),
        indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap,
      ]),
      placeholder("写下你对构图、光线和色彩的观察……"),
      this.editable.of(EditorView.editable.of(true)),
      EditorView.contentAttributes.of({
        "aria-label": "Markdown 笔记编辑器",
        spellcheck: "false",
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.replacing)
          onChange(update.state.doc.toString());
      }),
    ];
    this.view = new EditorView({ parent, extensions: this.extensions });
  }
  setText(text: string) {
    this.replacing = true;
    // 每张图片独立建立编辑历史，撤销不会带入上一张图片的内容。
    this.view.setState(
      EditorState.create({ doc: text, extensions: this.extensions }),
    );
    this.replacing = false;
  }
  setEditable(value: boolean) {
    this.view.dispatch({
      effects: this.editable.reconfigure(EditorView.editable.of(value)),
    });
  }
  wrap(before: string, after = before, fallback = "文字") {
    if (!this.view.state.facet(EditorView.editable)) return false;
    const range = this.view.state.selection.main;
    const selected = this.view.state.sliceDoc(range.from, range.to);
    let from = range.from, to = range.to, text = selected || fallback;
    let insert = `${before}${text}${after}`;
    let offset = before.length;
    // 保持正文选中，再按一次快捷键即可移除同一层标记。
    const selectedItalic = (selected.match(/^\*+/)?.[0].length || 0) % 2 === 1;
    const surroundingItalic = (this.view.state.sliceDoc(Math.max(0, range.from - 8), range.from).match(/\*+$/)?.[0].length || 0) % 2 === 1;
    if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length && (before !== "*" || selectedItalic)) {
      text = selected.slice(before.length, selected.length - after.length);
      insert = text;
      offset = 0;
    } else if (
      range.from >= before.length &&
      this.view.state.sliceDoc(range.from - before.length, range.from) === before &&
      this.view.state.sliceDoc(range.to, range.to + after.length) === after &&
      (before !== "*" || surroundingItalic)
    ) {
      from -= before.length;
      to += after.length;
      insert = selected;
      text = selected;
      offset = 0;
    }
    this.view.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: from + offset,
        head: from + offset + text.length,
      },
      userEvent: "input.format",
    });
    this.view.focus();
    return true;
  }
  link() {
    if (!this.view.state.facet(EditorView.editable)) return false;
    const range = this.view.state.selection.main;
    const text = this.view.state.sliceDoc(range.from, range.to) || "链接文字";
    const url = "https://";
    const start = range.from + text.length + 3;
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert: `[${text}](${url})` },
      selection: { anchor: start, head: start + url.length },
      userEvent: "input.format",
    });
    this.view.focus();
    return true;
  }
  prefix(prefix: string) {
    if (!this.view.state.facet(EditorView.editable)) return false;
    const range = this.view.state.selection.main;
    const first = this.view.state.doc.lineAt(range.from);
    const last = this.view.state.doc.lineAt(range.empty ? range.to : range.to - 1);
    const lines = Array.from({ length: last.number - first.number + 1 }, (_, n) => this.view.state.doc.line(first.number + n));
    const marker = (text: string) => /^(\s*)(#{1,6} |[-+*] |\d+[.)] |> )/.exec(text);
    const remove = !!prefix && lines.every(line => {
      const current = marker(line.text)?.[2];
      return prefix === "1. " ? /^\d+[.)] $/.test(current || "") : current === prefix;
    });
    this.view.dispatch({
      changes: lines.map((line, index) => {
        const match = marker(line.text);
        const indent = match?.[1].length || 0;
        return {
          from: line.from + indent,
          to: line.from + (match?.[0].length || indent),
          insert: remove ? "" : prefix === "1. " ? `${index + 1}. ` : prefix,
        };
      }),
      userEvent: "input.format",
    });
    this.view.focus();
    return true;
  }
}
