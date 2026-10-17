import { ensureCardsTable, getStorage, serializeCard, type StoredCardRow } from "../../../db/cards";

const IMAGE_EXTENSIONS = new Set(["png", "webp", "jpg", "jpeg", "gif"]);

function cleanText(value: FormDataEntryValue | null, fallback: string, limit: number) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, limit);
}

export async function GET() {
  try {
    const { DB } = getStorage();
    await ensureCardsTable(DB);
    const result = await DB.prepare(
      "SELECT * FROM character_cards ORDER BY modified_at DESC",
    ).all<StoredCardRow>();
    return Response.json({ cards: (result.results ?? []).map(serializeCard) });
  } catch (error) {
    return Response.json(
      { cards: [], error: error instanceof Error ? error.message : "读取失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let storage: { DB: D1Database; CARDS: R2Bucket } | null = null;
  let imageKey: string | null = null;
  try {
    storage = getStorage();
    const { DB, CARDS } = storage;
    await ensureCardsTable(DB);
    const form = await request.formData();
    const file = form.get("file");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = cleanText(form.get("name"), "未命名角色", 200);
    const fileName = cleanText(form.get("fileName"), name, 200);
    const fileType = String(form.get("fileType") || "application/octet-stream").slice(0, 100);
    const bookshelf = cleanText(form.get("bookshelf"), "未分类", 100);
    const sourcePath = String(form.get("sourcePath") || "").slice(0, 500);
    let size = file instanceof File ? file.size : Number(form.get("size") || 0);
    if (!Number.isFinite(size) || size < 0) size = 0;

    const extension = (fileName.split(".").pop() || "").toLowerCase();
    if (file instanceof File && file.size > 0) {
      const looksImage = fileType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
      const contentType = file.type
        || (extension === "json" ? "application/json" : looksImage ? `image/${extension === "jpg" ? "jpeg" : extension}` : "application/octet-stream");
      imageKey = `cards/${id}/${encodeURIComponent(fileName)}`;
      await CARDS.put(imageKey, file.stream(), {
        httpMetadata: { contentType },
      });
    }

    await DB.prepare(`INSERT INTO character_cards
      (id, name, file_name, file_type, size, rating, favorite, tags, bookshelf, image_key, description, source_path, created_at, modified_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, '[]', ?, ?, '', ?, ?, ?)`)
      .bind(id, name, fileName, fileType, size, bookshelf, imageKey, sourcePath, now, now)
      .run();

    const row = await DB.prepare("SELECT * FROM character_cards WHERE id = ?")
      .bind(id)
      .first<StoredCardRow>();
    return Response.json({ card: row ? serializeCard(row) : null }, { status: 201 });
  } catch (error) {
    if (imageKey && storage?.CARDS) {
      try { await storage.CARDS.delete(imageKey); } catch {}
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "导入失败" },
      { status: 500 },
    );
  }
}
