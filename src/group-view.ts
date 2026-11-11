import { $, renderMarkdown } from "./shared";
import { fileURL } from "./files";
import type { NoteDocument } from "./storage";

export class GroupView {
  private menu = $("group-menu");
  private target = "";
  private galleryKey = "";

  constructor(select: (id: string) => void, remove: (id: string) => void, adopt: (text: string) => void) {
    $("group-members").addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button[data-item]");
      if (button) select(button.dataset.item!);
    });
    $("group-members").addEventListener("contextmenu", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button[data-item]");
      if (!button) return;
      event.preventDefault();
      this.target = button.dataset.item!;
      this.menu.hidden = false;
      const rect = button.getBoundingClientRect();
      this.menu.style.left = `${Math.min(rect.left, innerWidth - this.menu.offsetWidth - 8)}px`;
      this.menu.style.top = `${rect.top - this.menu.offsetHeight - 6}px`;
      $("group-remove").focus();
    });
    $("group-remove").onclick = () => { this.menu.hidden = true; remove(this.target); };
    document.addEventListener("pointerdown", event => {
      if (!this.menu.contains(event.target as Node)) this.menu.hidden = true;
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") this.menu.hidden = true; });
    $("group-adopt").onclick = () => {
      const index = $<HTMLSelectElement>("group-source").value;
      if (index !== "") adopt(this.choices[Number(index)].text);
    };
    $("group-source").onchange = () => {
      const index = $<HTMLSelectElement>("group-source").value;
      $<HTMLButtonElement>("group-adopt").disabled = index === "";
      renderMarkdown($("group-preview"), index === "" ? "" : this.choices[Number(index)].text);
    };
  }
  private choices: NoteDocument["choices"] = [];

  render(doc: NoteDocument | null) {
    this.menu.hidden = true;
    const gallery = $("group-members");
    gallery.hidden = !doc?.group || doc.members.length < 2;
    const members = doc?.group ? doc.members : [];
    const key = JSON.stringify([doc?.library, doc?.group?.id, members.map(item => [item.id, item.name, item.thumbnailPath || item.filePath])]);
    // 成员和缩略图未变化时复用节点，保留滚动位置与键盘焦点。
    if (key !== this.galleryKey) {
      this.galleryKey = key;
      gallery.replaceChildren(...members.map(item => {
        const button = document.createElement("button");
        button.dataset.item = item.id;
        button.title = item.name;
        button.setAttribute("aria-label", item.name);
        const img = document.createElement("img");
        img.src = fileURL(item.thumbnailPath || item.filePath);
        img.alt = "";
        img.draggable = false;
        button.append(img);
        return button;
      }));
    }
    for (const button of gallery.querySelectorAll<HTMLButtonElement>("button[data-item]"))
      button.setAttribute("aria-pressed", String(button.dataset.item === doc?.item.id));
    const choices = doc?.choices || [];
    $("group-choice").hidden = !choices.length;
    if (JSON.stringify(choices.map(c => [c.item.id, c.text])) === JSON.stringify(this.choices.map(c => [c.item.id, c.text]))) return;
    this.choices = choices;
    const select = $<HTMLSelectElement>("group-source");
    select.replaceChildren(new Option("选择要保留的分析", ""), ...choices.map((choice, index) => new Option(choice.item.name, String(index))));
    $<HTMLButtonElement>("group-adopt").disabled = true;
    $("group-preview").replaceChildren();
  }
}
