import { ensureCardsTable, getStorage } from "../../../../../db/cards";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { DB, CARDS } = getStorage();
  await ensureCardsTable(DB);
  const row = await DB.prepare("SELECT image_key FROM character_cards WHERE id = ?")
    .bind(id)
    .first<{ image_key: string | null }>();
  if (!row?.image_key) return new Response("Not found", { status: 404 });
  const object = await CARDS.get(row.image_key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
