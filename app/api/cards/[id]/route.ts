import { ensureCardsTable, getStorage, serializeCard, type StoredCardRow } from "../../../../db/cards";

const allowedFields = new Map([
  ["name", "name"],
  ["rating", "rating"],
  ["favorite", "favorite"],
  ["tags", "tags"],
  ["bookshelf", "bookshelf"],
  ["description", "description"],
  ["personality", "personality"],
  ["scenario", "scenario"],
  ["firstMessage", "first_message"],
  ["exampleDialogue", "example_dialogue"],
  ["creatorNotes", "creator_notes"],
  ["systemPrompt", "system_prompt"],
  ["postHistoryInstructions", "post_history_instructions"],
  ["alternateGreetings", "alternate_greetings"],
  ["creator", "creator"],
  ["characterVersion", "character_version"],
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
      key === "tags" || key === "alternateGreetings"
        ? JSON.stringify(Array.isArray(value) ? value : [])
        : key === "favorite"
          ? (value ? 1 : 0)
        : value,
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { DB, CARDS } = getStorage();
    await ensureCardsTable(DB);
    const row = await DB.prepare("SELECT image_key FROM character_cards WHERE id = ?")
      .bind(id)
      .first<{ image_key: string | null }>();
    if (!row) return Response.json({ deleted: 0 });
    await DB.prepare("DELETE FROM character_cards WHERE id = ?").bind(id).run();
    if (row.image_key) await CARDS.delete(row.image_key);
    return Response.json({ deleted: 1 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 500 },
    );
  }
}
