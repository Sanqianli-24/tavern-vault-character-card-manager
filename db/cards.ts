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

export async function ensureCardsTable(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS character_cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      rating INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      bookshelf TEXT NOT NULL DEFAULT '未分类',
      image_key TEXT,
      description TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_character_cards_modified_at ON character_cards(modified_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_character_cards_name ON character_cards(name)"),
  ]);
}

export type StoredCardRow = {
  id: string;
  name: string;
  file_name: string;
  file_type: string;
  size: number;
  rating: number;
  tags: string;
  bookshelf: string;
  image_key: string | null;
  description: string;
  source_path: string;
  created_at: string;
  modified_at: string;
};

export function serializeCard(row: StoredCardRow) {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    fileType: row.file_type,
    size: row.size,
    rating: row.rating,
    tags,
    bookshelf: row.bookshelf,
    image: row.image_key ? `/api/cards/file/${row.id}` : "",
    description: row.description,
    sourcePath: row.source_path,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  };
}
