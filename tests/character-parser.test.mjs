import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseCharacterCardFile } = require("../desktop/character-parser.cjs");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tavern-parser-"));
test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function chunk(type, data) {
  // The parser ignores chunk CRC bytes, so they are left as zero here.
  const buffer = Buffer.alloc(8 + data.length + 4);
  buffer.writeUInt32BE(data.length, 0);
  buffer.write(type, 4, "latin1");
  data.copy(buffer, 8);
  return buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(textChunks) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    ...textChunks,
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function tEXt(keyword, text) {
  return chunk("tEXt", Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0]),
    Buffer.from(text, "latin1"),
  ]));
}

function zTXt(keyword, text) {
  return chunk("zTXt", Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0, 0]),
    zlib.deflateSync(Buffer.from(text, "latin1")),
  ]));
}

function iTXt(keyword, text) {
  return chunk("iTXt", Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0, 0, 0]),
    Buffer.from([0]),
    Buffer.from([0]),
    Buffer.from(text, "utf8"),
  ]));
}

function writeTemp(name, data) {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, data);
  return filePath;
}

const v2Card = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "测试角色甲",
    description: "这是 V2 测试角色。",
    personality: "温柔",
    first_mes: "你好，旅行者。",
    tags: ["幻想", "测试"],
  },
};

const v3Card = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: {
    name: "测试角色乙",
    description: "这是 V3 测试角色。",
    first_mes: "V3 开场白。",
    tags: ["科幻"],
  },
};

const base64 = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

test("parses a V2 card embedded as base64 in a chara tEXt chunk", () => {
  const filePath = writeTemp("v2-chara.png", makePng([tEXt("chara", base64(v2Card))]));
  const parsed = parseCharacterCardFile(filePath);
  assert.equal(parsed.name, "测试角色甲");
  assert.equal(parsed.description, "这是 V2 测试角色。");
  assert.equal(parsed.firstMes, "你好，旅行者。");
  assert.deepEqual(parsed.tags, ["幻想", "测试"]);
});

test("parses a V3 card embedded with the ccv3 keyword", () => {
  const filePath = writeTemp("v3-ccv3.png", makePng([tEXt("ccv3", base64(v3Card))]));
  const parsed = parseCharacterCardFile(filePath);
  assert.equal(parsed.name, "测试角色乙");
  assert.equal(parsed.description, "这是 V3 测试角色。");
  assert.deepEqual(parsed.tags, ["科幻"]);
});

test("keeps scanning after a broken chara chunk", () => {
  const broken = tEXt("chara", "!!!这不是base64也不是json!!!");
  const valid = tEXt("chara", base64(v2Card));
  const filePath = writeTemp("broken-then-valid.png", makePng([broken, valid]));
  const parsed = parseCharacterCardFile(filePath);
  assert.equal(parsed.name, "测试角色甲");
});

test("parses a card stored in a compressed zTXt chunk", () => {
  const filePath = writeTemp("ztxt.png", makePng([zTXt("chara", base64(v2Card))]));
  const parsed = parseCharacterCardFile(filePath);
  assert.equal(parsed.name, "测试角色甲");
});

test("parses a card stored in an iTXt chunk", () => {
  const filePath = writeTemp("itxt.png", makePng([iTXt("ccv3", JSON.stringify(v3Card))]));
  const parsed = parseCharacterCardFile(filePath);
  assert.equal(parsed.name, "测试角色乙");
});

test("returns null for a PNG without character data", () => {
  const filePath = writeTemp("plain.png", makePng([tEXt("Comment", "just an image")]));
  assert.equal(parseCharacterCardFile(filePath), null);
});

test("returns null for a corrupt zlib stream and does not throw", () => {
  const corrupt = chunk("zTXt", Buffer.concat([
    Buffer.from("chara", "latin1"),
    Buffer.from([0, 0]),
    Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff]),
  ]));
  const filePath = writeTemp("corrupt-ztxt.png", makePng([corrupt]));
  assert.equal(parseCharacterCardFile(filePath), null);
});

test("parses a plain JSON card file", () => {
  const filePath = writeTemp("card.json", Buffer.from(JSON.stringify(v2Card), "utf8"));
  const parsed = parseCharacterCardFile(filePath);
  assert.equal(parsed.name, "测试角色甲");
  assert.equal(parsed.personality, "温柔");
});

test("returns null for malformed JSON files", () => {
  const filePath = writeTemp("bad.json", Buffer.from("{not json", "utf8"));
  assert.equal(parseCharacterCardFile(filePath), null);
});
