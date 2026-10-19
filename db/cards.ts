import { env } from "cloudflare:workers";

export type StorageEnv = {
  DB: D1Database;
  CARDS: R2Bucket;
};

export function getStorage(): StorageEnv {
  const bindings = env as unknown as Partial<StorageEnv>;
  if (!bindings.DB || !bindings.CARDS) {
    throw new Error("角色卡存储尚未连接");
  }
  return bindings as StorageEnv;
}

const CARD_COLUMNS: Array<[name: string, definition: string]> = [
  ["size", "INTEGER NOT NULL DEFAULT 0"],
  ["rating", "INTEGER NOT NULL DEFAULT 0"],
  ["favorite", "INTEGER NOT NULL DEFAULT 0"],
  ["tags", "TEXT NOT NULL DEFAULT '[]'"],
  ["bookshelf", "TEXT NOT NULL DEFAULT '未分类'"],
  ["image_key", "TEXT"],
  ["description", "TEXT NOT NULL DEFAULT ''"],
  ["personality", "TEXT NOT NULL DEFAULT ''"],
  ["scenario", "TEXT NOT NULL DEFAULT ''"],
  ["first_message", "TEXT NOT NULL DEFAULT ''"],
  ["example_dialogue", "TEXT NOT NULL DEFAULT ''"],
  ["creator_notes", "TEXT NOT NULL DEFAULT ''"],
  ["system_prompt", "TEXT NOT NULL DEFAULT ''"],
  ["post_history_instructions", "TEXT NOT NULL DEFAULT ''"],
  ["alternate_greetings", "TEXT NOT NULL DEFAULT '[]'"],
  ["creator", "TEXT NOT NULL DEFAULT ''"],
  ["character_version", "TEXT NOT NULL DEFAULT ''"],
  ["source_path", "TEXT NOT NULL DEFAULT ''"],
  ["created_at", "TEXT NOT NULL DEFAULT ''"],
  ["modified_at", "TEXT NOT NULL DEFAULT ''"],
];

let schemaReady: Promise<void> | null = null;

export function ensureCardsTable(db: D1Database) {
  // 每个请求都跑 DDL 太贵：isolate 内缓存一次成功结果。
  if (!schemaReady) {
    schemaReady = runEnsureCardsTable(db).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function runEnsureCardsTable(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS character_cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      rating INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      bookshelf TEXT NOT NULL DEFAULT '未分类',
      image_key TEXT,
      description TEXT NOT NULL DEFAULT '',
      personality TEXT NOT NULL DEFAULT '',
      scenario TEXT NOT NULL DEFAULT '',
      first_message TEXT NOT NULL DEFAULT '',
      example_dialogue TEXT NOT NULL DEFAULT '',
      creator_notes TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      post_history_instructions TEXT NOT NULL DEFAULT '',
      alternate_greetings TEXT NOT NULL DEFAULT '[]',
      creator TEXT NOT NULL DEFAULT '',
      character_version TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_character_cards_modified_at ON character_cards(modified_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_character_cards_name ON character_cards(name)"),
  ]);
  const info = await db.prepare("PRAGMA table_info(character_cards)").all<{ name: string }>();
  const present = new Set((info.results ?? []).map((row) => row.name));
  const missing = CARD_COLUMNS.filter(([column]) => !present.has(column));
  if (missing.length) {
    try {
      await db.batch(missing.map(([column, definition]) =>
        db.prepare(`ALTER TABLE character_cards ADD COLUMN ${column} ${definition}`),
      ));
    } catch (error) {
      // 并发请求同时补列时后到者会撞 duplicate column，忽略即可。
      if (!/duplicate column/i.test(String(error))) throw error;
    }
  }
}

export type StoredCardRow = {
  id: string;
  name: string;
  file_name: string;
  file_type: string;
  size: number;
  rating: number;
  favorite: number;
  tags: string;
  bookshelf: string;
  image_key: string | null;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  example_dialogue: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string;
  creator: string;
  character_version: string;
  source_path: string;
  created_at: string;
  modified_at: string;
};

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function serializeCard(row: StoredCardRow) {
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    fileType: row.file_type,
    size: row.size,
    rating: row.rating,
    favorite: Boolean(row.favorite),
    tags: parseJsonStringArray(row.tags),
    bookshelf: row.bookshelf,
    // JSON 卡在 R2 里存的是文本文件，当缩略图必然破图，回退到首字母占位。
    image: row.image_key && !row.file_type.includes("json") ? `/api/cards/file/${row.id}` : "",
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    firstMessage: row.first_message,
    exampleDialogue: row.example_dialogue,
    creatorNotes: row.creator_notes,
    systemPrompt: row.system_prompt,
    postHistoryInstructions: row.post_history_instructions,
    alternateGreetings: parseJsonStringArray(row.alternate_greetings),
    creator: row.creator,
    characterVersion: row.character_version,
    sourcePath: row.source_path,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  };
}
