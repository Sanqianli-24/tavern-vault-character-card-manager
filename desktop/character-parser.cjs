const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const CARD_TEXT_KEYWORDS = new Set(["chara", "ccv3"]);

function isCardKeyword(keyword) {
  return CARD_TEXT_KEYWORDS.has(keyword);
}

function parseCharacterCardFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const extension = path.extname(filePath).toLowerCase();
    let parsed = null;
    if (extension === ".json") {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else if (extension === ".png") {
      parsed = parsePngCharacterCard(fs.readFileSync(filePath));
    }
    if (!parsed || typeof parsed !== "object") return null;
    const data = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
    return {
      name: typeof data.name === "string" ? data.name : "",
      description: typeof data.description === "string" ? data.description : "",
      personality: typeof data.personality === "string" ? data.personality : "",
      scenario: typeof data.scenario === "string" ? data.scenario : "",
      firstMes: typeof data.first_mes === "string" ? data.first_mes : "",
      mesExample: typeof data.mes_example === "string" ? data.mes_example : "",
      creatorNotes: typeof data.creator_notes === "string" ? data.creator_notes : "",
      systemPrompt: typeof data.system_prompt === "string" ? data.system_prompt : "",
      postHistoryInstructions: typeof data.post_history_instructions === "string" ? data.post_history_instructions : "",
      alternateGreetings: Array.isArray(data.alternate_greetings)
        ? data.alternate_greetings.filter((item) => typeof item === "string")
        : [],
      tags: Array.isArray(data.tags) ? data.tags.filter((item) => typeof item === "string") : [],
      creator: typeof data.creator === "string" ? data.creator : "",
      characterVersion: typeof data.character_version === "string" ? data.character_version : "",
    };
  } catch {
    return null;
  }
}

function parsePngCharacterCard(buffer) {
  if (!buffer || buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return null;
    let decoded = null;
    if (type === "tEXt") {
      const text = buffer.subarray(dataStart, dataEnd).toString("latin1");
      const separator = text.indexOf("\0");
      if (separator > 0 && isCardKeyword(text.slice(0, separator))) {
        decoded = decodeCharaPayload(text.slice(separator + 1));
      }
    } else if (type === "iTXt") {
      decoded = parsePngInternationalText(buffer.subarray(dataStart, dataEnd));
    } else if (type === "zTXt") {
      decoded = parsePngCompressedText(buffer.subarray(dataStart, dataEnd));
    }
    if (decoded) return decoded;
    offset = dataEnd + 4;
  }
  return null;
}

function parsePngInternationalText(bytes) {
  const findNull = (start) => {
    const index = bytes.indexOf(0, start);
    return index === -1 ? bytes.length : index;
  };
  const keywordEnd = findNull(0);
  const keyword = bytes.subarray(0, keywordEnd).toString("latin1");
  if (!isCardKeyword(keyword) || keywordEnd + 2 > bytes.length) return null;
  const compressionFlag = bytes[keywordEnd + 1];
  const languageEnd = findNull(keywordEnd + 3);
  const translatedEnd = findNull(languageEnd + 1);
  const raw = bytes.subarray(translatedEnd + 1);
  let text = null;
  try {
    text = compressionFlag === 1
      ? zlib.inflateSync(Buffer.from(raw)).toString("utf8")
      : raw.toString("utf8");
  } catch {
    return null;
  }
  return decodeCharaPayload(text);
}

function parsePngCompressedText(bytes) {
  const keywordEnd = bytes.indexOf(0);
  if (keywordEnd <= 0) return null;
  const keyword = bytes.subarray(0, keywordEnd).toString("latin1");
  if (!isCardKeyword(keyword) || keywordEnd + 1 >= bytes.length) return null;
  let inflated = null;
  try {
    inflated = zlib.inflateSync(Buffer.from(bytes.subarray(keywordEnd + 2))).toString("utf8");
  } catch {
    return null;
  }
  return decodeCharaPayload(inflated);
}

function decodeCharaPayload(payload) {
  if (typeof payload !== "string" || !payload.trim()) return null;
  const direct = tryParseCharaJson(payload);
  if (direct) return direct;
  try {
    const decoded = Buffer.from(payload.trim(), "base64").toString("utf8");
    const fromBase64 = tryParseCharaJson(decoded.replace(/^\uFEFF/, ""));
    if (fromBase64) return fromBase64;
  } catch {
    // Fall through to null when the payload is not valid Base64.
  }
  return null;
}

function tryParseCharaJson(text) {
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { parseCharacterCardFile };
