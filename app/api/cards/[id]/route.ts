import { ensureCardsTable, getStorage, serializeCard, type StoredCardRow } from "../../../../db/cards";

const allowedFields = new Map([
  ["name", "name"],
  ["rating", "rating"],
  ["tags", "tags"],
  ["bookshelf", "bookshelf"],
  ["description", "description"],
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = (await request.json()) as Record<string, unknown>;
    const entries = Object.entries(payload).filter(([key]) => allowedFields.has(key));
    if (!entries.length) return Response.json({ error: "没有可更新的字段" }, { status: 400 });

    const { DB } = getStorage();
    await ensureCardsTable(DB);
    const values = entries.map(([key, value]) =>
      key === "tags" ? JSON.stringify(Array.isArray(value) ? value : []) : value,
    );
    const assignments = entries.map(([key]) => `${allowedFields.get(key)} = ?`).join(", ");
    const modifiedAt = new Date().toISOString();
    await DB.prepare(`UPDATE character_cards SET ${assignments}, modified_at = ? WHERE id = ?`)
      .bind(...values, modifiedAt, id)
      .run();
    const row = await DB.prepare("SELECT * FROM character_cards WHERE id = ?")
      .bind(id)
      .first<StoredCardRow>();
    if (!row) return Response.json({ error: "角色卡不存在" }, { status: 404 });
    return Response.json({ card: serializeCard(row) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新失败" },
      { status: 500 },
    );
  }
}
