type DesktopCharacterCard = {
  id: string;
  name: string;
  fileName: string;
  fileType: string;
  size: number;
  rating: number;
  favorite?: boolean;
  tags: string[];
  userTags?: string[];
  bookshelf: string;
  image: string;
  description: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  exampleDialogue?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  alternateGreetings?: string[];
  creator?: string;
  characterVersion?: string;
  sourcePath: string;
  createdAt: string;
  modifiedAt: string;
  accent?: string;
};

type TavernLaunchProgress = {
  phase: "idle" | "checking" | "starting" | "waiting" | "ready" | "error";
  progress: number;
  message: string;
  detail: string;
  port: number;
  logs: string[];
};

type DesktopImportEntry = {
  file: File;
  suggestedName: string;
  sourcePath?: string;
};

type DesktopImportResult = {
  cards: DesktopCharacterCard[];
  skipped: number;
  duplicates: number;
};

type DesktopExportResult = {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
};

type DesktopBulkExportResult = {
  ok: boolean;
  canceled?: boolean;
  exported?: number;
  failed?: number;
  dir?: string;
  error?: string;
};

type DesktopSettings = {
  sillyTavernDir: string;
  detectedDir: string;
  dirExists: boolean;
  appVersion: string;
  isPortable: boolean;
  preferEmbedded: boolean;
  closeAction: "ask" | "tray" | "quit";
  embeddedAvailable: boolean;
  embeddedVersion: string | null;
  embeddedRuntimeReady: boolean;
  tavernEmbedded: boolean;
};

type DesktopSettingsResult = {
  ok: boolean;
  sillyTavernDir?: string;
  dirExists?: boolean;
  error?: string;
};

type DesktopBackup = {
  name: string;
  mtime: string;
  size: number;
  cardCount: number;
};

type DesktopRestoreResult = {
  ok: boolean;
  cards?: DesktopCharacterCard[];
  error?: string;
};

type DesktopUpdateResult = {
  ok: boolean;
  version?: string | null;
  error?: string;
};

type TavernPanelCard = {
  id: string;
  name: string;
  tags: string[];
  rating: number;
  favorite: boolean;
  fileName: string;
  tavernAvatar: string | null;
  imported: boolean;
};

type TavernPanelCardPayload = {
  ok: boolean;
  fileName?: string;
  mime?: string;
  base64?: string;
  error?: string;
};

type TavernCharacterSummary = {
  avatar: string;
  name: string;
  adopted: boolean;
};

type DesktopUpdateStatus =
  | { event: "available"; version?: string }
  | { event: "not-available" }
  | { event: "progress"; percent: number }
  | { event: "downloaded"; version?: string }
  | { event: "error"; message?: string };

interface Window {
  desktopAPI?: {
    isDesktop: true;
    listCards(): Promise<DesktopCharacterCard[]>;
    importCards(entries: DesktopImportEntry[]): Promise<DesktopImportResult>;
    updateCard(id: string, patch: Partial<DesktopCharacterCard>): Promise<DesktopCharacterCard | null>;
    hydrateCard(id: string): Promise<DesktopCharacterCard | null>;
    hydrateAllCards(): Promise<{ hydrated: number; total: number }>;
    updateCards(ids: string[], patch: Partial<DesktopCharacterCard>): Promise<number>;
    deleteCards(ids: string[]): Promise<number>;
    exportCard(id: string): Promise<DesktopExportResult>;
    exportCards(ids: string[]): Promise<DesktopBulkExportResult>;
    getSettings(): Promise<DesktopSettings>;
    setSettings(patch: { sillyTavernDir?: string; preferEmbedded?: boolean; closeAction?: "ask" | "tray" | "quit" }): Promise<DesktopSettingsResult>;
    pickDirectory(): Promise<string | null>;
    listBackups(): Promise<DesktopBackup[]>;
    createBackup(): Promise<{ ok: boolean; name?: string }>;
    restoreBackup(name: string): Promise<DesktopRestoreResult>;
    checkForUpdates(): Promise<DesktopUpdateResult>;
    installUpdate(): Promise<DesktopUpdateResult>;
    onUpdateStatus(callback: (status: DesktopUpdateStatus) => void): () => void;
    getTavernStatus(): Promise<TavernLaunchProgress>;
    startSillyTavern(): Promise<TavernLaunchProgress>;
    openTavernWindow(): Promise<{ ok: boolean; port?: number; error?: string }>;
    openTavernBrowser(): Promise<{ ok: boolean; port?: number; error?: string }>;
    openLibrary(): Promise<{ ok: boolean }>;
    tavernPanelList(): Promise<TavernPanelCard[]>;
    tavernPanelCardImage(id: string): Promise<string>;
    tavernPanelCardPayload(id: string): Promise<TavernPanelCardPayload>;
    tavernPanelMarkImported(id: string, avatar: string): Promise<{ ok: boolean }>;
    tavernPanelTavernCharacters(): Promise<TavernCharacterSummary[]>;
    tavernAdoptCharacter(avatar: string): Promise<{ ok: boolean; error?: string }>;
    tavernChatWithCard(id: string): Promise<{ ok: boolean; error?: string }>;
    tavernSendToTavern(ids: string[]): Promise<{ ok: boolean; sent?: number; failed?: number; error?: string }>;
    tavernInstallExtension(): Promise<{ ok: boolean; dir?: string; error?: string }>;
    onTavernProgress(callback: (progress: TavernLaunchProgress) => void): () => void;
  };
}
