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

const stringFields = new Set([
  "name", "bookshelf", "description", "personality", "scenario",
  "firstMessage", "exampleDialogue", "creatorNotes", "systemPrompt",
  "postHistoryInstructions", "creator", "characterVersion",
]);
const STRING_LIMIT = 100000;

type ValidatedPatch = { assignments: string[]; values: unknown[] };

function validatePatch(payload: Record<string, unknown>): ValidatedPatch | { error: string } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (stringFields.has(key)) {
      if (typeof value !== "string") return { error: `${key} 必须是字符串` };
      if (key === "name" && !value.trim()) return { error: "角色名称不能为空" };
      if (key === "bookshelf" && !value.trim()) return { error: "书架名称不能为空" };
      assignments.push(`${allowedFields.get(key)} = ?`);
      values.push(value.slice(0, key === "name" || key === "bookshelf" ? 200 : STRING_LIMIT));
    } else if (key === "rating") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 5) {
        return { error: "rating 必须是 0-5 的整数" };
      }
      assignments.push("rating = ?");
      values.push(value);
    } else if (key === "favorite") {
      if (typeof value !== "boolean") return { error: "favorite 必须是布尔值" };
      assignments.push("favorite = ?");
      values.push(value ? 1 : 0);
    } else if (key === "tags" || key === "alternateGreetings") {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        return { error: `${key} 必须是字符串数组` };
      }
      assignments.push(`${allowedFields.get(key)} = ?`);
      values.push(JSON.stringify(value.slice(0, 100).map((item) => item.slice(0, key === "tags" ? 60 : 10000))));
    }
  }
  if (!assignments.length) return { error: "没有可更新的字段" };
  return { assignments, values };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "请求体不是有效的 JSON" }, { status: 400 });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Response.json({ error: "请求体格式错误" }, { status: 400 });
    }
    const validated = validatePatch(payload);
    if ("error" in validated) return Response.json({ error: validated.error }, { status: 400 });

    const { DB } = getStorage();
    await ensureCardsTable(DB);
    const modifiedAt = new Date().toISOString();
    await DB.prepare(`UPDATE character_cards SET ${validated.assignments.join(", ")}, modified_at = ? WHERE id = ?`)
      .bind(...validated.values, modifiedAt, id)
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
    if (!row) return Response.json({ error: "角色卡不存在" }, { status: 404 });
    if (row.image_key) {
      try { await CARDS.delete(row.image_key); } catch {}
    }
    await DB.prepare("DELETE FROM character_cards WHERE id = ?").bind(id).run();
    return Response.json({ deleted: 1 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 500 },
    );
  }
}
