export type ParsedCardContent = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  tags: string[];
  creator: string;
  characterVersion: string;
};

function normalizeCardContent(parsed: unknown): ParsedCardContent | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const textArray = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
  return {
    name: text(data.name),
    description: text(data.description),
    personality: text(data.personality),
    scenario: text(data.scenario),
    firstMes: text(data.first_mes),
    mesExample: text(data.mes_example),
    creatorNotes: text(data.creator_notes),
    systemPrompt: text(data.system_prompt),
    postHistoryInstructions: text(data.post_history_instructions),
    alternateGreetings: textArray(data.alternate_greetings),
    tags: textArray(data.tags),
    creator: text(data.creator),
    characterVersion: text(data.character_version),
  };
}

export function parseCharacterCardJson(text: string): ParsedCardContent | null {
  try {
    return normalizeCardContent(JSON.parse(text.replace(/^\uFEFF/, "")));
  } catch {
    return null;
  }
}

function tryParseCharaJson(text: string): unknown {
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function decodeCharaText(payload: string): unknown {
  if (!payload.trim()) return null;
  const direct = tryParseCharaJson(payload);
  if (direct) return direct;
  try {
    const binary = atob(payload.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const decoded = new TextDecoder().decode(bytes);
    const fromBase64 = tryParseCharaJson(decoded);
    if (fromBase64) return fromBase64;
  } catch {
    // Payload 不是有效 Base64 时落到 null。
  }
  return null;
}

function decodeLatin1(bytes: Uint8Array, start: number, end: number) {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = start; i < end; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, end)));
  }
  return out;
}

// 浏览器端 PNG 角色卡解析：支持 tEXt（chara/ccv3，Base64 或 UTF-8 JSON）与
// 未压缩 iTXt。压缩 zTXt 在浏览器无 inflate，跳过（桌面端解析器完整支持）。
export function parseCharacterCardPng(buffer: ArrayBuffer): ParsedCardContent | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 8 || view.getUint32(0) !== 0x89504e47) return null;
  for (const keyword of ["ccv3", "chara"]) {
    const decoded = scanPngForKeyword(bytes, view, keyword);
    if (decoded) return normalizeCardContent(decoded);
  }
  return null;
}

function scanPngForKeyword(bytes: Uint8Array, view: DataView, wanted: string): unknown {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) return null;
    const type = decodeLatin1(bytes, offset + 4, offset + 8);
    if (type === "tEXt") {
      const separator = bytes.indexOf(0, dataStart);
      if (separator > dataStart && separator < dataEnd) {
        const keyword = decodeLatin1(bytes, dataStart, separator);
        if (keyword === wanted) {
          const decoded = decodeCharaText(decodeLatin1(bytes, separator + 1, dataEnd));
          if (decoded) return decoded;
        }
      }
    } else if (type === "iTXt") {
      const decoded = parseInternationalText(bytes, dataStart, dataEnd, wanted);
      if (decoded) return decoded;
    }
    offset = dataEnd + 4;
  }
  return null;
}

function parseInternationalText(bytes: Uint8Array, start: number, end: number, wanted: string): unknown {
  const findNull = (from: number) => {
    const index = bytes.indexOf(0, from);
    return index === -1 || index >= end ? -1 : index;
  };
  const keywordEnd = findNull(start);
  if (keywordEnd <= start) return null;
  if (decodeLatin1(bytes, start, keywordEnd) !== wanted) return null;
  if (keywordEnd + 2 >= end) return null;
  const compressionFlag = bytes[keywordEnd + 1];
  if (compressionFlag === 1) return null; // 压缩 iTXt 需 inflate，浏览器端跳过
  const languageEnd = findNull(keywordEnd + 3);
  if (languageEnd === -1) return null;
  const translatedEnd = findNull(languageEnd + 1);
  if (translatedEnd === -1) return null;
  const text = new TextDecoder().decode(bytes.subarray(translatedEnd + 1, end));
  return decodeCharaText(text);
}
