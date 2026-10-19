import { ensureCardsTable, getStorage, serializeCard, type StoredCardRow } from "../../../db/cards";

const IMAGE_EXTENSIONS = new Set(["png", "webp", "jpg", "jpeg", "gif"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const TEXT_LIMIT = 100000;

function cleanText(value: FormDataEntryValue | null, fallback: string, limit: number) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, limit);
}

function cleanJsonStringArray(value: FormDataEntryValue | null, limit: number) {
  if (typeof value !== "string" || !value.trim()) return "[]";
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return "[]";
    return JSON.stringify(parsed
      .filter((item) => typeof item === "string")
      .slice(0, 100)
      .map((item) => (item as string).slice(0, limit)));
  } catch {
    return "[]";
  }
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
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "上传数据格式错误" }, { status: 400 });
    }
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
    if (size > MAX_FILE_SIZE) {
      return Response.json({ error: "文件过大（上限 50MB）" }, { status: 400 });
    }

    const description = cleanText(form.get("description"), "", TEXT_LIMIT);
    const personality = cleanText(form.get("personality"), "", TEXT_LIMIT);
    const scenario = cleanText(form.get("scenario"), "", TEXT_LIMIT);
    const firstMessage = cleanText(form.get("firstMessage"), "", TEXT_LIMIT);
    const exampleDialogue = cleanText(form.get("exampleDialogue"), "", TEXT_LIMIT);
    const creatorNotes = cleanText(form.get("creatorNotes"), "", TEXT_LIMIT);
    const systemPrompt = cleanText(form.get("systemPrompt"), "", TEXT_LIMIT);
    const postHistoryInstructions = cleanText(form.get("postHistoryInstructions"), "", TEXT_LIMIT);
    const creator = cleanText(form.get("creator"), "", 200);
    const characterVersion = cleanText(form.get("characterVersion"), "", 100);
    const tags = cleanJsonStringArray(form.get("tags"), 60);
    const alternateGreetings = cleanJsonStringArray(form.get("alternateGreetings"), 10000);

    const extension = (fileName.split(".").pop() || "").toLowerCase();
    if (file instanceof File && file.size > 0 && file.size <= MAX_FILE_SIZE) {
      const looksImage = fileType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
      const contentType = file.type
        || (extension === "json" ? "application/json" : looksImage ? `image/${extension === "jpg" ? "jpeg" : extension}` : "application/octet-stream");
      imageKey = `cards/${id}/${encodeURIComponent(fileName)}`;
      await CARDS.put(imageKey, file.stream(), {
        httpMetadata: { contentType },
      });
    }

    await DB.prepare(`INSERT INTO character_cards
      (id, name, file_name, file_type, size, rating, favorite, tags, bookshelf, image_key,
       description, personality, scenario, first_message, example_dialogue, creator_notes,
       system_prompt, post_history_instructions, alternate_greetings, creator, character_version,
       source_path, created_at, modified_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id, name, fileName, fileType, size, tags, bookshelf, imageKey,
        description, personality, scenario, firstMessage, exampleDialogue, creatorNotes,
        systemPrompt, postHistoryInstructions, alternateGreetings, creator, characterVersion,
        sourcePath, now, now,
      )
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
