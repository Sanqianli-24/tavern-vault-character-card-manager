import { ensureCardsTable, getStorage, serializeCard, type StoredCardRow } from "../../../db/cards";

export async function GET() {
  try {
    const { DB } = getStorage();
    await ensureCardsTable(DB);
    const result = await DB.prepare(
      "SELECT * FROM character_cards ORDER BY modified_at DESC",
    ).all<StoredCardRow>();
    return Response.json({ cards: (result.results ?? []).map(serializeCard) });
  } catch (error) {
    return Response.json({ cards: [], error: error instanceof Error ? error.message : "读取失败" });
  }
}

export async function POST(request: Request) {
  try {
    const { DB, CARDS } = getStorage();
    await ensureCardsTable(DB);
    const form = await request.formData();
    const file = form.get("file");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = String(form.get("name") || "未命名角色").trim();
    const fileName = String(form.get("fileName") || name);
    const fileType = String(form.get("fileType") || "application/octet-stream");
    const bookshelf = String(form.get("bookshelf") || "未分类");
    const sourcePath = String(form.get("sourcePath") || "");
    const size = file instanceof File ? file.size : Number(form.get("size") || 0);
    let imageKey: string | null = null;

    if (file instanceof File && file.size > 0 && file.type.startsWith("image/")) {
      imageKey = `cards/${id}/${file.name}`;
      await CARDS.put(imageKey, file.stream(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
      });
    }

    await DB.prepare(`INSERT INTO character_cards
      (id, name, file_name, file_type, size, rating, tags, bookshelf, image_key, description, source_path, created_at, modified_at)
      VALUES (?, ?, ?, ?, ?, 0, '[]', ?, ?, '', ?, ?, ?)`)
      .bind(id, name, fileName, fileType, size, bookshelf, imageKey, sourcePath, now, now)
      .run();

    const row = await DB.prepare("SELECT * FROM character_cards WHERE id = ?")
      .bind(id)
      .first<StoredCardRow>();
    return Response.json({ card: row ? serializeCard(row) : null }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "导入失败" },
      { status: 500 },
    );
  }
}
