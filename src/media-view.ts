import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";
import { isVideo, nativeImageExtensions } from "./shared";
import { fileURL } from "./files";

export class MediaView {
  private panzoom: PanzoomObject | null = null;
  private fitMode = true;
  private generation = 0;
  private width = 0;
  private height = 0;
  private video: HTMLVideoElement | null = null;
  constructor(
    private stage: HTMLElement,
    private img: HTMLImageElement,
    private label: HTMLElement,
    private message: HTMLElement,
    private openMedia: HTMLButtonElement,
  ) {
    stage.addEventListener(
      "wheel",
      (event) => {
        if (!this.panzoom) return;
        event.preventDefault();
        this.fitMode = false;
        this.panzoom.zoomWithWheel(event);
      },
      { passive: false },
    );
    stage.addEventListener("dblclick", () => this.fit());
    new ResizeObserver(() => {
      if (this.fitMode) this.fit();
    }).observe(stage);
  }
  clear(message = "") {
    this.generation++;
    this.panzoom?.destroy();
    this.panzoom = null;
    this.img.hidden = true;
    this.img.removeAttribute("src");
    if (this.video) {
      // 解除文件引用，切换素材后不继续解码或播放声音。
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      this.video.remove();
      this.video = null;
    }
    this.openMedia.hidden = true;
    this.message.textContent = message;
    this.label.textContent = "";
  }
  async prepare(item: EagleItem): Promise<() => void> {
    const generation = ++this.generation;
    if (isVideo(item)) {
      // 视频在采用当前选择后加载，不让解码等待阻塞笔记或下一次选图。
      return () => {
        if (generation !== this.generation) return;
        this.clear("正在加载视频…");
        const video = document.createElement("video");
        this.video = video;
        video.id = "video";
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;
        video.setAttribute("aria-label", item.name);
        video.addEventListener("loadeddata", () => {
          if (this.video === video) this.message.textContent = "";
        });
        video.addEventListener("error", () => {
          if (this.video !== video) return;
          video.pause();
          video.hidden = true;
          this.message.textContent = "视频无法在工作台播放，请检查文件或使用系统播放器。";
          this.openMedia.hidden = false;
        });
        this.stage.prepend(video);
        video.src = fileURL(item.filePath);
      };
    }
    let preview = !nativeImageExtensions.has(item.ext.toLowerCase());
    const nextImage = new Image();
    nextImage.id = "image";
    nextImage.draggable = false;
    nextImage.alt = item.name;
    nextImage.src = fileURL(preview ? item.thumbnailPath : item.filePath);
    let failed = false;
    try {
      await nextImage.decode();
    } catch {
      try {
        if (preview || !item.thumbnailPath) throw new Error("没有可用的预览图");
        preview = true;
        nextImage.src = fileURL(item.thumbnailPath);
        await nextImage.decode();
      } catch {
        failed = true;
      }
    }
    // 新图解码完成后才替换，图片和笔记由调用方在同一帧更新。
    return () => {
      if (generation !== this.generation) return;
      if (failed) {
        this.clear("图片暂时无法读取，请检查素材库磁盘连接。");
        return;
      }
      this.clear();
      this.width = nextImage.naturalWidth;
      this.height = nextImage.naturalHeight;
      this.fitMode = true;
      const scale = this.fitScale();
      nextImage.style.width = `${this.width}px`;
      nextImage.style.height = `${this.height}px`;
      nextImage.style.transform = `scale(${scale})`;
      nextImage.addEventListener("panzoomchange", () => this.updateLabel());
      this.img.replaceWith(nextImage);
      this.img = nextImage;
      this.message.textContent = preview ? "当前格式显示 Eagle 预览图" : "";
      this.panzoom = Panzoom(nextImage, {
        startScale: scale,
        minScale: 0.005,
        maxScale: 32,
        animate: false,
        cursor: "grab",
      });
      this.updateLabel();
    };
  }
  pause() {
    this.video?.pause();
  }
  private fitScale() {
    return Math.max(
      0.005,
      Math.min(
        (this.stage.clientWidth - 48) / this.width,
        (this.stage.clientHeight - 48) / this.height,
        1,
      ),
    );
  }
  fit() {
    if (!this.panzoom) return;
    this.fitMode = true;
    this.panzoom.zoom(this.fitScale(), { animate: false });
    this.panzoom.pan(0, 0, { animate: false });
    this.updateLabel();
  }
  actual() {
    this.fitMode = false;
    this.panzoom?.zoom(1, { animate: false });
    this.panzoom?.pan(0, 0, { animate: false });
  }
  private updateLabel() {
    this.label.textContent = this.panzoom
      ? `${Math.round(this.panzoom.getScale() * 100)}%`
      : "";
  }
}
