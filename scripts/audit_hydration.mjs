import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseCharacterCardFile } = require("../desktop/character-parser.cjs");

const SILLY_TAVERN_DIR = "D:\\SillyTavern";
const libraryPath = "C:\\Users\\LongShuo\\AppData\\Roaming\\sillytavern-character-library\\character-library.json";
const rows = JSON.parse(fs.readFileSync(libraryPath, "utf8"));

function findCardSource(row) {
  const candidates = [];
  if (row.imagePath) candidates.push(row.imagePath);
  if (row.sourcePath) {
    candidates.push(row.sourcePath);
    if (row.sourcePath.startsWith("sillytavern resource/")) {
      candidates.push(path.join(SILLY_TAVERN_DIR, row.sourcePath.slice("sillytavern resource/".length)));
    }
  }
  if (row.fileName) {
    candidates.push(path.join(SILLY_TAVERN_DIR, "data", "default-user", "characters", row.fileName));
    candidates.push(path.join(SILLY_TAVERN_DIR, "public", "characters", row.fileName));
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

const stats = {
  total: rows.length,
  png: 0,
  json: 0,
  other: 0,
  recoverable: 0,
  missing: 0,
  pngRecoverable: 0,
  pngMissing: 0,
  jsonRecoverable: 0,
  jsonMissing: 0,
};
const samples = [];

for (const row of rows) {
  const ext = path.extname(row.fileName || "").toLowerCase();
  if (ext === ".png") stats.png += 1;
  else if (ext === ".json") stats.json += 1;
  else stats.other += 1;

  const source = findCardSource(row);
  const content = source ? parseCharacterCardFile(source) : null;
  const hasContent = Boolean(content && (content.description || content.firstMes || content.personality || content.scenario || content.mesExample));
  if (hasContent) {
    stats.recoverable += 1;
    if (ext === ".png") stats.pngRecoverable += 1;
    else if (ext === ".json") stats.jsonRecoverable += 1;
  } else {
    stats.missing += 1;
    if (ext === ".png") stats.pngMissing += 1;
    else if (ext === ".json") stats.jsonMissing += 1;
    if (samples.length < 5) samples.push({ name: row.name, file: row.fileName, source: row.sourcePath, sourceExists: Boolean(source) });
  }
}

console.log(JSON.stringify({ stats, samples }, null, 2));
