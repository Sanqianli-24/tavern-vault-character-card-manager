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
  sourcePath: string;
};

interface Window {
  desktopAPI?: {
    isDesktop: true;
    listCards(): Promise<DesktopCharacterCard[]>;
    importCards(entries: DesktopImportEntry[]): Promise<DesktopCharacterCard[]>;
    updateCard(id: string, patch: Partial<DesktopCharacterCard>): Promise<DesktopCharacterCard | null>;
    hydrateCard(id: string): Promise<DesktopCharacterCard | null>;
    hydrateAllCards(): Promise<{ hydrated: number; total: number }>;
    updateCards(ids: string[], patch: Partial<DesktopCharacterCard>): Promise<number>;
    deleteCards(ids: string[]): Promise<number>;
    getTavernStatus(): Promise<TavernLaunchProgress>;
    startSillyTavern(): Promise<TavernLaunchProgress>;
    onTavernProgress(callback: (progress: TavernLaunchProgress) => void): () => void;
  };
}
