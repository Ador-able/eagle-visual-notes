interface EagleItem {
  id: string;
  name: string;
  ext: string;
  filePath: string;
  thumbnailPath: string;
  annotation: string;
  width: number;
  height: number;
  isDeleted?: boolean;
  save(): Promise<void>;
}
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
declare const eagle: {
  onPluginCreate(callback: (plugin: { path: string }) => void): void;
  onPluginRun(callback: () => void): void;
  onPluginShow(callback: () => void): void;
  onPluginHide(callback: () => void): void;
  onPluginBeforeExit(callback: () => void): void;
  onLibraryChanged(callback: (path: string) => void): void;
  onThemeChanged(callback: (theme: string) => void): void;
  app: {
    build: number;
    theme: string;
    getPath(name: string): Promise<string>;
    isDarkColors(): boolean;
  };
  library: { path: string };
  item: {
    getSelected(): Promise<EagleItem[]>;
    get(options: {
      folders?: string[];
      fields?: string[];
    }): Promise<EagleItem[]>;
    getById(id: string): Promise<EagleItem>;
    select(ids: string[]): Promise<boolean>;
  };
  folder: { getSelected(): Promise<{ id: string }[]> };
  window: {
    show(): Promise<void>;
    hide(): Promise<void>;
    minimize(): Promise<void>;
    getBounds(): Promise<Bounds>;
    setBounds(bounds: Bounds): Promise<void>;
    isMaximized(): Promise<boolean>;
    maximize(): Promise<void>;
    unmaximize(): Promise<void>;
    isFullScreen(): Promise<boolean>;
    setFullScreen(flag: boolean): Promise<void>;
  };
  screen: { getAllDisplays(): Promise<{ workArea: Bounds }[]> };
  shell: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<void>;
  };
  dialog: {
    showSaveDialog(
      options: object,
    ): Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog(
      options: object,
    ): Promise<{ canceled: boolean; filePaths: string[] }>;
    showMessageBox(options: object): Promise<{ response: number }>;
  };
};
