import { ensureCardsTable, getStorage, serializeCard, type StoredCardRow } from "../../../../../db/cards";

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function buildCardJson(card: ReturnType<typeof serializeCard>) {
  const data = {
    name: card.name,
    description: card.description || "",
    personality: card.personality || "",
    scenario: card.scenario || "",
    first_mes: card.firstMessage || "",
    mes_example: card.exampleDialogue || "",
    creator_notes: card.creatorNotes || "",
    system_prompt: card.systemPrompt || "",
    post_history_instructions: card.postHistoryInstructions || "",
    alternate_greetings: card.alternateGreetings || [],
    creator: card.creator || "",
    character_version: card.characterVersion || "",
    tags: card.tags || [],
  };
  return JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data }, null, 2);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const wantsDownload = url.searchParams.get("download") === "1";
    const wantsJson = url.searchParams.get("format") === "json";
    const { DB, CARDS } = getStorage();
    await ensureCardsTable(DB);

    if (wantsJson) {
      const row = await DB.prepare("SELECT * FROM character_cards WHERE id = ?")
        .bind(id)
        .first<StoredCardRow>();
      if (!row) return Response.json({ error: "角色卡不存在" }, { status: 404 });
      const card = serializeCard(row);
      const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
      if (wantsDownload) {
        headers.set("content-disposition", contentDisposition(`${card.name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "角色卡"}.json`));
      }
      return new Response(buildCardJson(card), { headers });
    }

    const row = await DB.prepare("SELECT image_key, file_name FROM character_cards WHERE id = ?")
      .bind(id)
      .first<{ image_key: string | null; file_name: string }>();
    if (!row?.image_key) return new Response("Not found", { status: 404 });
    const object = await CARDS.get(row.image_key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=3600");
    if (wantsDownload) headers.set("content-disposition", contentDisposition(row.file_name || "character-card"));
    return new Response(object.body, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "读取文件失败" },
      { status: 500 },
    );
  }
}
