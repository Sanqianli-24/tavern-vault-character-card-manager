const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const CARD_TEXT_KEYWORDS = new Set(["chara", "ccv3"]);
const MAX_INFLATE_BYTES = 32 * 1024 * 1024;

function isCardKeyword(keyword) {
  return CARD_TEXT_KEYWORDS.has(keyword);
}

function normalizeCardContent(parsed) {
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
}

function parseCharacterCardFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".json") {
      return normalizeCardContent(JSON.parse(fs.readFileSync(filePath, "utf8")));
    }
    if (extension === ".png") {
      return normalizeCardContent(parsePngCharacterCard(fs.readFileSync(filePath)));
    }
    return null;
  } catch {
    return null;
  }
}

// V3 规范要求 ccv3 优先于旧的 chara 关键字，因此按关键字分两轮扫描。
function parsePngCharacterCard(buffer) {
  if (!buffer || buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  for (const keyword of ["ccv3", "chara"]) {
    const decoded = scanPngForKeyword(buffer, keyword);
    if (decoded) return decoded;
  }
  return null;
}

function scanPngForKeyword(buffer, wanted) {
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return null;
    let decoded = null;
    if (type === "tEXt") {
      const raw = buffer.subarray(dataStart, dataEnd);
      const separator = raw.indexOf(0);
      if (separator > 0 && raw.toString("latin1", 0, separator) === wanted) {
        decoded = decodeCharaBytes(raw.subarray(separator + 1));
      }
    } else if (type === "iTXt") {
      decoded = parsePngInternationalText(buffer.subarray(dataStart, dataEnd), wanted);
    } else if (type === "zTXt") {
      decoded = parsePngCompressedText(buffer.subarray(dataStart, dataEnd), wanted);
    }
    if (decoded) return decoded;
    offset = dataEnd + 4;
  }
  return null;
}

function parsePngInternationalText(bytes, wanted) {
  const findNull = (start) => {
    const index = bytes.indexOf(0, start);
    return index === -1 ? bytes.length : index;
  };
  const keywordEnd = findNull(0);
  const keyword = bytes.subarray(0, keywordEnd).toString("latin1");
  if (keyword !== wanted || keywordEnd + 2 > bytes.length) return null;
  const compressionFlag = bytes[keywordEnd + 1];
  const languageEnd = findNull(keywordEnd + 3);
  const translatedEnd = findNull(languageEnd + 1);
  const raw = bytes.subarray(translatedEnd + 1);
  let text = null;
  try {
    text = compressionFlag === 1
      ? zlib.inflateSync(Buffer.from(raw), { maxOutputLength: MAX_INFLATE_BYTES }).toString("utf8")
      : raw.toString("utf8");
  } catch {
    return null;
  }
  return decodeCharaPayload(text);
}

function parsePngCompressedText(bytes, wanted) {
  const keywordEnd = bytes.indexOf(0);
  if (keywordEnd <= 0) return null;
  const keyword = bytes.subarray(0, keywordEnd).toString("latin1");
  if (keyword !== wanted || keywordEnd + 1 >= bytes.length) return null;
  let inflated = null;
  try {
    inflated = zlib.inflateSync(Buffer.from(bytes.subarray(keywordEnd + 2)), { maxOutputLength: MAX_INFLATE_BYTES }).toString("utf8");
  } catch {
    return null;
  }
  return decodeCharaPayload(inflated);
}

function decodeCharaBytes(bytes) {
  // 少数写卡工具把未 Base64 的 UTF-8 JSON 直接放进 tEXt；先按 UTF-8 解，
  // 出现替换符说明是 Latin-1/Base64 载荷，再走原有路径。
  if (bytes.length) {
    const utf8Text = bytes.toString("utf8");
    if (!utf8Text.includes("￿")) {
      const direct = tryParseCharaJson(utf8Text);
      if (direct) return direct;
    }
  }
  return decodeCharaPayload(bytes.toString("latin1"));
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

let crcTable = null;

function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function makeTextChunk(keyword, text) {
  const data = Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0]),
    Buffer.from(text, "latin1"),
  ]);
  const type = Buffer.from("tEXt", "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([length, type, data, crc]);
}

function chunkHasCardKeyword(bytes) {
  const keywordEnd = bytes.indexOf(0);
  if (keywordEnd <= 0) return false;
  return isCardKeyword(bytes.subarray(0, keywordEnd).toString("latin1"));
}

// 把编辑后的角色数据写回 PNG：移除旧的 chara/ccv3 文本块，
// 在 IHDR 后插入新的 chara + ccv3 tEXt 块（Base64 V2/V3 兼容载荷）。
function writeCharacterCardToPng(buffer, data) {
  if (!buffer || buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  const payload = JSON.stringify({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: data && typeof data === "object" ? data : {},
  });
  const base64Payload = Buffer.from(payload, "utf8").toString("base64");
  const parts = [buffer.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return null;
    const isCardText = (type === "tEXt" || type === "iTXt" || type === "zTXt")
      && chunkHasCardKeyword(buffer.subarray(dataStart, dataEnd));
    if (!isCardText) parts.push(buffer.subarray(offset, dataEnd + 4));
    if (type === "IHDR") {
      parts.push(makeTextChunk("chara", base64Payload));
      parts.push(makeTextChunk("ccv3", base64Payload));
      inserted = true;
    }
    offset = dataEnd + 4;
  }
  if (!inserted) return null;
  return Buffer.concat(parts);
}

module.exports = { parseCharacterCardFile, writeCharacterCardToPng };
