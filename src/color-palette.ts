import iro from "@jaames/iro";
import { $ } from "./shared";

function orderedColors(palettes: EaglePalette[]) {
  const colors = palettes.slice(0, 10).map(({ color: [r, g, b], ratio }) => {
    const color = new iro.Color({ r, g, b });
    const { h, s, l } = color.hsl;
    return { hex: color.hexString.toUpperCase(), ratio, hsl: [h, s, l].map(Math.round) };
  });
  if (!colors.length) return colors;
  // 与 Eagle 一样，主色在前，其余按与主色的色相、饱和度及明度距离排列。
  const dominant = colors.reduce((a, b) => a.ratio > b.ratio ? a : b);
  const others = colors.filter(color => color !== dominant);
  others.sort((a, b) => {
    const distance = a.hsl.map((value, i) => Math.abs(value - dominant.hsl[i]) - Math.abs(b.hsl[i] - dominant.hsl[i]));
    return Math.abs(distance[0]) >= 30 ? distance[0] : Math.abs(distance[1]) >= 10 ? distance[1] : distance[2];
  });
  return [dominant, ...others];
}

export class ColorPalette {
  private signature = "";
  private picker?: iro.ColorPicker;
  private huePicker?: iro.ColorPicker;
  private active?: HTMLButtonElement;
  private pickerSize = 220;
  private tooltip = $("palette-tooltip");

  constructor(private slot: HTMLElement, private panel: HTMLElement) {
    $("color-close").onclick = () => this.close(true);
    $("color-copy").onclick = () => void this.copy();
    for (const channel of ["h", "s", "v"] as const) {
      const input = $<HTMLInputElement>(`color-${channel}`);
      input.oninput = () => this.picker!.color.setChannel("hsv", channel, Number(input.value));
    }
    document.addEventListener("pointerdown", event => {
      if (!this.panel.contains(event.target as Node) && !this.slot.contains(event.target as Node)) this.close();
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      this.tooltip.hidden = true;
      if (!this.panel.hidden) {
        event.preventDefault();
        this.close(true);
      }
    });
    document.addEventListener("focusin", event => {
      if (!this.panel.contains(event.target as Node) && !this.slot.contains(event.target as Node)) this.close();
    });
    // 分栏和窗口尺寸变化时，浮层仍保持在可见区域内。
    new ResizeObserver(() => { this.tooltip.hidden = true; this.position(); }).observe(this.slot);
    window.addEventListener("resize", () => this.position());
  }

  update(item?: EagleItem) {
    const palettes = item?.palettes || [];
    const signature = JSON.stringify([item?.id, palettes.map(({ color, ratio }) => [color, ratio])]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.close();
    this.tooltip.hidden = true;
    const colors = orderedColors(palettes);
    this.slot.hidden = colors.length === 0;
    $("media-palette").replaceChildren(...colors.map(({ hex, ratio }) => {
      const button = document.createElement("button");
      const label = `${hex} (${ratio.toFixed(1)}%)`;
      button.className = "palette-swatch";
      button.style.setProperty("--swatch", hex);
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", "color-panel");
      const show = () => {
        if (!this.panel.hidden) return;
        this.tooltip.textContent = label;
        this.tooltip.hidden = false;
        const rect = button.getBoundingClientRect();
        this.tooltip.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - this.tooltip.offsetWidth / 2, innerWidth - this.tooltip.offsetWidth - 8))}px`;
        this.tooltip.style.top = `${rect.bottom + 8}px`;
      };
      button.onmouseenter = show;
      button.onfocus = show;
      button.onmouseleave = button.onblur = () => { this.tooltip.hidden = true; };
      button.onclick = () => this.open(button, hex, ratio);
      return button;
    }));
  }

  private open(button: HTMLButtonElement, hex: string, ratio: number) {
    this.active?.setAttribute("aria-expanded", "false");
    this.active = button;
    button.setAttribute("aria-expanded", "true");
    this.tooltip.hidden = true;
    this.panel.hidden = false;
    $("color-ratio").textContent = `${ratio.toFixed(1)}%`;
    if (!this.picker) {
      this.huePicker = iro.ColorPicker($("color-wheel"), {
        width: 220, color: { h: 0, s: 100, v: 100 }, padding: 4, handleRadius: 7,
        wheelDirection: "clockwise", layout: [{ component: iro.ui.Wheel }],
      });
      this.picker = iro.ColorPicker($("color-square"), {
        width: 124, color: hex, padding: 4, handleRadius: 7,
        layout: [{ component: iro.ui.Box }],
      });
      // 外圈只控制色相，饱和度和亮度由内区或滑块控制。
      this.huePicker.on("input:change", () => {
        this.picker!.color.hue = this.huePicker!.color.hue;
        this.huePicker!.color.saturation = 100;
      });
      this.picker.on("color:change", () => this.renderValues());
    }
    this.picker.color.hexString = hex;
    this.renderValues();
    this.position();
    this.panel.focus({ preventScroll: true });
  }

  private renderValues() {
    const color = this.picker!.color;
    this.huePicker!.color.hue = color.hue;
    for (const [channel, value, unit] of [["h", color.hue, "°"], ["s", color.saturation, "%"], ["v", color.value, "%"]] as const) {
      $<HTMLInputElement>(`color-${channel}`).value = String(Math.round(value));
      $(`color-${channel}-value`).textContent = `${Math.round(value)}${unit}`;
    }
    const { h, s, v } = color.hsv;
    $("color-s").style.background = `linear-gradient(to right, ${new iro.Color({ h, s: 0, v }).hexString}, ${new iro.Color({ h, s: 100, v }).hexString})`;
    $("color-v").style.background = `linear-gradient(to right, #000, ${new iro.Color({ h, s, v: 100 }).hexString})`;
    $<HTMLInputElement>("color-hex").value = color.hexString.toUpperCase();
    $("color-preview").style.background = color.hexString;
    $("color-rgb").textContent = `RGB  ${color.red} · ${color.green} · ${color.blue}`;
    $("color-copy-state").hidden = true;
  }

  private position() {
    if (this.panel.hidden || !this.active) return;
    const rect = this.active.getBoundingClientRect();
    const top = rect.bottom + 10;
    const size = Math.max(100, Math.min(220, innerHeight - top - 230));
    if (size !== this.pickerSize) {
      this.pickerSize = size;
      this.panel.style.setProperty("--color-size", `${size}px`);
      this.huePicker!.setOptions({ width: size, handleRadius: Math.max(4, size * 7 / 220), padding: size * 4 / 220 });
      this.picker!.resize(Math.round(size * 124 / 220));
    }
    this.panel.style.maxHeight = `${innerHeight - top - 8}px`;
    this.panel.style.top = `${top}px`;
    this.panel.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - this.panel.offsetWidth / 2, innerWidth - this.panel.offsetWidth - 8))}px`;
  }

  close(restoreFocus = false) {
    this.panel.hidden = true;
    this.active?.setAttribute("aria-expanded", "false");
    if (restoreFocus) this.active?.focus({ preventScroll: true });
    this.tooltip.hidden = true;
    this.active = undefined;
  }

  private async copy() {
    const state = $("color-copy-state");
    try {
      await navigator.clipboard.writeText($<HTMLInputElement>("color-hex").value);
      state.textContent = "已复制色值";
    } catch {
      state.textContent = "复制失败，请选中色值后按 Ctrl+C / Cmd+C。";
      $<HTMLInputElement>("color-hex").select();
    }
    state.hidden = false;
  }
}
