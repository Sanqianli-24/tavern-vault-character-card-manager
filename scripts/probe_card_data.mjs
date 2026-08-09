import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const libraryPath = "C:\\Users\\LongShuo\\AppData\\Roaming\\sillytavern-character-library\\character-library.json";
const rows = JSON.parse(fs.readFileSync(libraryPath, "utf8"));

function parsePng(buffer) {
  if (!buffer || buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return null;
    if (type === "tEXt") {
      const raw = buffer.subarray(dataStart, dataEnd);
      const sep = raw.indexOf(0);
      if (sep > 0 && raw.toString("latin1", 0, sep) === "chara") {
        const payload = raw.subarray(sep + 1);
        for (const encoding of ["utf8", "latin1"]) {
          try {
            const text = payload.toString(encoding);
            return JSON.parse(text);
          } catch (error) {
            lastTexError = { encoding, message: error.message, prefix: payload.toString("utf8").slice(0, 100) };
          }
        }
        return { parseError: "tEXt json", lastTexError };
      }
    } else if (type === "iTXt") {
      try {
        const first = buffer.indexOf(0, dataStart);
        if (first > dataStart && buffer.toString("latin1", dataStart, first) === "chara") {
          const after = first + 1;
          const compressionFlag = buffer[after];
          const languageStart = buffer.indexOf(0, after + 1);
          const translatedStart = buffer.indexOf(0, languageStart + 1);
          const raw = buffer.subarray(translatedStart + 1, dataEnd);
          const text = compressionFlag === 1 ? zlib.inflateSync(raw).toString("utf8") : raw.toString("utf8");
          return JSON.parse(text);
        }
      } catch { /* not valid */ }
    } else if (type === "zTXt") {
      try {
        const first = buffer.indexOf(0, dataStart);
        if (first > dataStart && buffer.toString("latin1", dataStart, first) === "chara") {
          const raw = buffer.subarray(first + 2, dataEnd);
          return JSON.parse(zlib.inflateSync(raw).toString("utf8"));
        }
      } catch { /* not valid */ }
    }
    offset = dataEnd + 4;
  }
  return null;
}

const pngRows = rows.filter((row) => row.imagePath && path.extname(row.imagePath).toLowerCase() === ".png");
let lastTexError = null;
const results = { total: rows.length, pngRows: pngRows.length, found: 0, withDescription: 0, withFirstMes: 0, missingFile: 0, unreadable: 0, invalid: 0 };
const errors = [];
for (const row of pngRows.slice(0, 400)) {
  try {
    if (!fs.existsSync(row.imagePath)) {
      results.missingFile += 1;
      if (errors.length < 3) errors.push(`missing ${row.imagePath}`);
      continue;
    }
    const parsed = parsePng(fs.readFileSync(row.imagePath));
    if (!parsed) {
      results.invalid += 1;
      if (errors.length < 3) errors.push(`no chara ${row.name} ${row.imagePath}`);
      continue;
    }
    results.found += 1;
    const data = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
    if (data.description) results.withDescription += 1;
    if (data.first_mes) results.withFirstMes += 1;
  } catch (error) {
    results.unreadable += 1;
    if (errors.length < 3) errors.push(`${row.name}: ${error.message}`);
  }
}

const first = rows[0];
const firstPath = first.imagePath;
const firstParsed = parsePng(fs.readFileSync(firstPath));
let rawChara = null;
{
  const buffer = fs.readFileSync(firstPath);
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "tEXt") {
      const raw = buffer.subarray(dataStart, dataEnd);
      const sep = raw.indexOf(0);
      if (sep > 0 && raw.toString("latin1", 0, sep) === "chara") {
        rawChara = raw.subarray(sep + 1);
        break;
      }
    }
    offset = dataEnd + 4;
  }
}
let bomStripped = null;
if (rawChara) {
  try {
    const text = rawChara.toString("utf8").replace(/^\uFEFF/, "");
    bomStripped = JSON.parse(text);
  } catch (error) {
    bomStripped = { parseError: error.message };
  }
}
const sample = pngRows.slice(1, 5).map((row) => {
  try {
    const parsed = parsePng(fs.readFileSync(row.imagePath));
    const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
    return {
      name: row.name,
      keys: Object.keys(data || {}),
      hasDesc: Boolean(data?.description),
      hasFirst: Boolean(data?.first_mes),
      descPreview: data?.description ? String(data.description).slice(0, 80) : null,
      firstPreview: data?.first_mes ? String(data.first_mes).slice(0, 80) : null,
    };
  } catch (error) {
    return { name: row.name, error: error.message };
  }
});
console.log(JSON.stringify({ ...results, firstRow: { name: first.name, path: firstPath, exists: fs.existsSync(firstPath), size: fs.existsSync(firstPath) ? fs.statSync(firstPath).size : null }, errors }, null, 2));
console.log("FIRST_PARSED", JSON.stringify({
  keys: Object.keys(firstParsed || {}),
  dataKeys: Object.keys(firstParsed?.data || {}),
  name: firstParsed?.data?.name || firstParsed?.name,
  description: (firstParsed?.data?.description || firstParsed?.description || "").toString().slice(0, 120),
  first_mes: (firstParsed?.data?.first_mes || firstParsed?.first_mes || "").toString().slice(0, 120),
  spec: String(firstParsed?.spec || "").slice(0, 80),
  type: firstParsed?.type,
}, null, 2));
console.log("RAW_CHARA", rawChara ? JSON.stringify({
  bytes: rawChara.length,
  firstBytes: [...rawChara.subarray(0, 40)],
  utf8Prefix: rawChara.toString("utf8").slice(0, 160),
  latinPrefix: rawChara.toString("latin1").slice(0, 160),
  bomStrippedKeys: bomStripped ? Object.keys(bomStripped) : null,
}, null, 2) : null);
console.log("SAMPLE", JSON.stringify(sample, null, 2));
