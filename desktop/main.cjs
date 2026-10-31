const { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { parseCharacterCardFile, writeCharacterCardToPng } = require("./character-parser.cjs");

const ALLOWED_CARD_FIELDS = new Set([
  "name", "rating", "favorite", "tags", "bookshelf", "description", "personality", "scenario",
  "firstMessage", "exampleDialogue", "creatorNotes", "systemPrompt",
  "postHistoryInstructions", "alternateGreetings", "creator", "characterVersion",
]);
const SMOKE_TEST = process.argv.includes("--smoke-test");
const BACKUP_KEEP_COUNT = 5;
const BACKUP_MIN_INTERVAL_MS = 10 * 60 * 1000;
let mainWindow = null;
let launchTask = null;
let tavernChild = null;
let tavernChildEmbedded = false;
let tavernWindow = null;
let tray = null;
let trayBalloonShown = false;
let tavernState = {
  phase: "idle",
  progress: 0,
  message: "酒馆尚未启动",
  detail: "等待配置酒馆目录",
  port: 8000,
  logs: [],
};
let lastAutoBackupAt = 0;
let autoUpdater = null;

function libraryFile() {
  return path.join(app.getPath("userData"), "character-library.json");
}

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function backupsDirectory() {
  return path.join(app.getPath("userData"), "backups");
}

function cardsDirectory() {
  return path.join(app.getPath("userData"), "cards");
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function atomicWriteFile(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data, "utf8");
  try {
    const fd = fs.openSync(temp, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {}
  let lastError = null;
  // Windows 上目标文件偶尔被杀软/索引器短暂占用导致 EPERM，重试几次。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.renameSync(temp, file);
      return;
    } catch (error) {
      lastError = error;
    }
    const deadline = Date.now() + 150;
    while (Date.now() < deadline) {}
  }
  try { fs.rmSync(temp, { force: true }); } catch {}
  throw lastError;
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  atomicWriteFile(settingsFile(), JSON.stringify(settings, null, 2));
}

function tavernDirCandidates() {
  const home = app.getPath("home");
  return [
    "D:\\SillyTavern",
    "C:\\SillyTavern",
    path.join(home, "SillyTavern"),
    path.join(home, "Documents", "SillyTavern"),
  ];
}

// ---- 内置酒馆：安装包里封装的 SillyTavern ----
// 资源目录（可能只读）放原始副本，用户目录放可写运行副本；数据、插件、配置都在运行副本里。

function embeddedSourceDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "sillytavern")
    : path.join(__dirname, "..", "resources", "sillytavern");
}

function readEmbeddedManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(embeddedSourceDir(), "embedded.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function embeddedAvailable() {
  const manifest = readEmbeddedManifest();
  return Boolean(manifest?.stVersion) && fs.existsSync(path.join(embeddedSourceDir(), "st", "server.js"));
}

function embeddedRuntimeDir() {
  return path.join(app.getPath("userData"), "sillytavern");
}

function embeddedRuntimeManifestFile() {
  return path.join(embeddedRuntimeDir(), ".tavern-vault-embedded.json");
}

function embeddedRuntimeReady() {
  return fs.existsSync(embeddedRuntimeManifestFile()) && fs.existsSync(path.join(embeddedRuntimeDir(), "server.js"));
}

function detectTavernDir() {
  const settings = readSettings();
  if (settings.preferEmbedded === true && embeddedAvailable()) {
    return { dir: embeddedRuntimeDir(), configured: true, exists: embeddedRuntimeReady(), embedded: true };
  }
  const configured = typeof settings.sillyTavernDir === "string" ? settings.sillyTavernDir.trim() : "";
  if (configured) {
    return { dir: configured, configured: true, exists: fs.existsSync(configured), embedded: false };
  }
  for (const candidate of tavernDirCandidates()) {
    if (fs.existsSync(candidate)) return { dir: candidate, configured: false, exists: true, embedded: false };
  }
  if (embeddedAvailable()) {
    return { dir: embeddedRuntimeDir(), configured: false, exists: embeddedRuntimeReady(), embedded: true };
  }
  return { dir: tavernDirCandidates()[0], configured: false, exists: false, embedded: false };
}

// ---- 卡库 × 酒馆 桥接 ----
// 卡库以 SillyTavern 扩展的形式进入酒馆界面（data/<user>/extensions/tavern-vault），
// 扩展运行在酒馆页面主世界，通过酒馆窗口 preload 注入的 desktopAPI 与主进程互通。

const ST_EXTENSION_NAME = "tavern-vault";
const ST_EXTENSION_SOURCE = path.join(__dirname, "st-extension", ST_EXTENSION_NAME);

function tavernCharactersDir() {
  return path.join(detectTavernDir().dir, "data", "default-user", "characters");
}

function listTavernCharacterFiles() {
  try {
    return fs.readdirSync(tavernCharactersDir()).filter((name) => /\.png$/i.test(name));
  } catch {
    return [];
  }
}

// 从 asar 里复制目录:cpSync 对 asar 源不可靠,用逐文件读写
function copyTreeFromAsar(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTreeFromAsar(from, to);
    else if (entry.isFile()) fs.writeFileSync(to, fs.readFileSync(from));
  }
}

// 把仓库里的联动扩展强制同步到酒馆运行副本（我们自己的目录始终以应用版本为准）
function syncStExtension(tavernDir) {
  const logFile = path.join(app.getPath("userData"), "tavern-vault-extension.log");
  const fail = (message) => {
    try { fs.writeFileSync(logFile, `${new Date().toISOString()} ${message}\n`, "utf8"); } catch {}
    return false;
  };
  try {
    if (!fs.existsSync(path.join(ST_EXTENSION_SOURCE, "manifest.json"))) {
      return fail(`extension source missing: ${ST_EXTENSION_SOURCE}`);
    }
    const target = path.join(tavernDir, "data", "default-user", "extensions", ST_EXTENSION_NAME);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    copyTreeFromAsar(ST_EXTENSION_SOURCE, target);
    return fs.existsSync(path.join(target, "manifest.json")) || fail(`copy produced no manifest at ${target}`);
  } catch (error) {
    return fail(`sync failed: ${error?.stack || error}`);
  }
}

function safeTavernCardName(row) {
  return (row.name || row.fileName || "角色卡").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

// 生成可写入酒馆的角色卡字节：优先用原始 PNG 重写元数据（保留用户编辑），
// 其余格式退回 JSON 卡（webp/jpg 无法内嵌元数据）。
function buildTavernCardFile(row) {
  const source = findCardSource(row);
  if (source && /\.png$/i.test(source)) {
    try {
      const bytes = writeCharacterCardToPng(fs.readFileSync(source), cardDataFromRow(row));
      if (bytes) return { bytes, fileName: `${safeTavernCardName(row)}.png`, mime: "image/png" };
      const original = fs.readFileSync(source);
      return { bytes: original, fileName: `${safeTavernCardName(row)}.png`, mime: "image/png" };
    } catch {}
  }
  const json = buildCardJson(row);
  return { bytes: Buffer.from(json, "utf8"), fileName: `${safeTavernCardName(row)}.json`, mime: "application/json" };
}

// 确保卡已在酒馆 characters 目录（已导入直接复用文件名，否则写入），返回 avatar 文件名
function ensureCardInTavern(row, rowsRef) {
  const tavernFiles = listTavernCharacterFiles();
  const remembered = String(row.tavernAvatar || "");
  if (remembered && tavernFiles.includes(remembered)) return remembered;
  const byName = tavernFiles.find((name) => name.toLowerCase() === String(row.fileName || "").toLowerCase());
  if (byName) {
    row.tavernAvatar = byName;
    return byName;
  }
  const card = buildTavernCardFile(row);
  const target = uniqueTargetPath(tavernCharactersDir(), card.fileName);
  if (!fs.existsSync(tavernCharactersDir())) fs.mkdirSync(tavernCharactersDir(), { recursive: true });
  fs.writeFileSync(target, card.bytes);
  row.tavernAvatar = path.basename(target);
  if (rowsRef) rowsRef.touched = true;
  return row.tavernAvatar;
}

// 让酒馆页面重新拉取角色列表（写文件后调用，酒馆即刻可见）
async function refreshTavernCharacters() {
  if (!tavernWindow || tavernWindow.isDestroyed()) return;
  const url = tavernWindow.webContents.getURL();
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) return;
  await tavernWindow.webContents.executeJavaScript(
    "(async()=>{const c=window.SillyTavern&&window.SillyTavern.getContext?SillyTavern.getContext():null;if(c&&typeof c.getCharacters==='function')await c.getCharacters();})()",
    true,
  ).catch(() => {});
}

// 在酒馆页面里选中某个角色并进入聊天
async function selectTavernCharacter(avatar) {
  const port = detectTavernPort();
  const window = ensureTavernWindow();
  window.show();
  window.focus();
  const url = window.webContents.getURL();
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url)) {
    await window.loadURL(`http://127.0.0.1:${port}`).catch(() => {});
    await new Promise((resolve) => {
      const done = () => { window.webContents.removeListener("did-finish-load", done); resolve(); };
      window.webContents.once("did-finish-load", done);
      setTimeout(resolve, 8000);
    });
  }
  return window.webContents.executeJavaScript(
    `(async()=>{
      const c=window.SillyTavern&&window.SillyTavern.getContext?SillyTavern.getContext():null;
      if(!c) return {ok:false,error:'酒馆界面尚未就绪'};
      if(typeof c.getCharacters==='function') await c.getCharacters();
      const chars=Array.isArray(c.characters)?c.characters:[];
      let idx=chars.findIndex(x=>x.avatar===${JSON.stringify(avatar)});
      if(idx<0) idx=chars.findIndex(x=>x.name===${JSON.stringify(String(avatar).replace(/\.[^.]+$/, ""))});
      if(idx<0) return {ok:false,error:'酒馆中未找到该角色'};
      if(typeof c.selectCharacterById==='function'){ await c.selectCharacterById(idx); return {ok:true}; }
      return {ok:false,error:'酒馆版本不支持切换角色'};
    })()`,
    true,
  ).catch((error) => ({ ok: false, error: String(error?.message || error) }));
}

function readRows() {
  const file = libraryFile();
  if (!fs.existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("卡库文件损坏，已停止读写以保护数据；请从“••• → 备份与恢复”还原");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("卡库文件格式异常，已停止读写以保护数据；请从“••• → 备份与恢复”还原");
  }
  return parsed;
}

function listBackupFiles() {
  try {
    return fs.readdirSync(backupsDirectory())
      .filter((name) => /^character-library\.[\w-]+\.json$/.test(name))
      .map((name) => {
        const backupPath = path.join(backupsDirectory(), name);
        let cardCount = 0;
        let size = 0;
        let mtime = "";
        try {
          const stat = fs.statSync(backupPath);
          size = stat.size;
          mtime = stat.mtime.toISOString();
          const parsed = JSON.parse(fs.readFileSync(backupPath, "utf8"));
          if (Array.isArray(parsed)) cardCount = parsed.length;
        } catch {}
        return { name, mtime, size, cardCount };
      })
      .filter((entry) => entry.mtime)
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

function createBackup(reason) {
  try {
    if (!fs.existsSync(libraryFile())) return null;
    fs.mkdirSync(backupsDirectory(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let target = path.join(backupsDirectory(), `character-library.${stamp}.json`);
    let counter = 2;
    while (fs.existsSync(target)) {
      target = path.join(backupsDirectory(), `character-library.${stamp}-${counter}.json`);
      counter += 1;
    }
    const temp = `${target}.tmp`;
    fs.copyFileSync(libraryFile(), temp);
    fs.renameSync(temp, target);
    const backups = listBackupFiles();
    for (const stale of backups.slice(BACKUP_KEEP_COUNT)) {
      try { fs.rmSync(path.join(backupsDirectory(), stale.name), { force: true }); } catch {}
    }
    return path.basename(target);
  } catch {
    return null;
  }
}

function writeRows(rows, options = {}) {
  fs.mkdirSync(path.dirname(libraryFile()), { recursive: true });
  const now = Date.now();
  const shouldBackup = options.backup === "always"
    || (options.backup !== "never" && now - lastAutoBackupAt >= BACKUP_MIN_INTERVAL_MS);
  if (shouldBackup) {
    createBackup();
    lastAutoBackupAt = now;
  }
  atomicWriteFile(libraryFile(), JSON.stringify(rows, null, 2));
}

function normalizeFavorite(row) {
  if (!row || typeof row.favorite === "boolean") return row;
  return { ...row, favorite: row.bookshelf === "最爱角色" };
}

function publicCard(row) {
  return {
    ...row,
    image: row.imagePath && fs.existsSync(row.imagePath) ? pathToFileURL(row.imagePath).href : "",
    imagePath: undefined,
  };
}

function joinInside(base, relative) {
  const target = path.resolve(base, relative);
  const baseResolved = path.resolve(base);
  return target.toUpperCase().startsWith(baseResolved.toUpperCase() + path.sep) ? target : null;
}

function findCardSource(row) {
  const tavernDir = detectTavernDir().dir;
  const candidates = [];
  if (row.imagePath) candidates.push(row.imagePath);
  if (row.sourcePath) {
    candidates.push(row.sourcePath);
    if (row.sourcePath.startsWith("sillytavern resource/")) {
      const joined = joinInside(tavernDir, row.sourcePath.slice("sillytavern resource/".length));
      if (joined) candidates.push(joined);
    }
  }
  if (row.fileName) {
    const safeName = path.basename(row.fileName);
    candidates.push(path.join(tavernDir, "data", "default-user", "characters", safeName));
    candidates.push(path.join(tavernDir, "public", "characters", safeName));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function normalizeTags(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : value.split(/[,，\s]+/);
        } catch {
          return value.split(/[,，\s]+/);
        }
      })()
      : [];
  return Array.from(new Set(raw.map((tag) => String(tag).trim().replace(/^#/, "").slice(0, 60)).filter(Boolean))).slice(0, 40);
}

function sanitizePatch(patch) {
  const safePatch = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!ALLOWED_CARD_FIELDS.has(key)) continue;
    if (key === "rating") {
      const rating = Number(value);
      if (Number.isFinite(rating)) safePatch.rating = Math.min(5, Math.max(0, Math.round(rating)));
    } else if (key === "favorite") {
      safePatch.favorite = value === true || value === 1 || value === "true";
    } else if (key === "tags") {
      safePatch.tags = normalizeTags(value);
      safePatch.userTags = safePatch.tags;
      safePatch.tagOwnershipMigrated = true;
    } else if (key === "alternateGreetings") {
      safePatch.alternateGreetings = Array.isArray(value)
        ? value.filter((item) => typeof item === "string").slice(0, 50).map((item) => item.slice(0, 10000))
        : [];
    } else if (typeof value === "string") {
      safePatch[key] = value.slice(0, 100000);
    }
  }
  return safePatch;
}

function stripImportedTags(row) {
  if (!row || row.tagOwnershipMigrated) return row;
  const source = findCardSource(row);
  const content = source ? parseCharacterCardFile(source) : null;
  if (!content) return row;
  const currentTags = normalizeTags(row.tags);
  const sourceTags = normalizeTags(content.tags);
  const sourceSet = new Set(sourceTags);
  const userTags = currentTags.filter((tag) => !sourceSet.has(tag));
  return {
    ...row,
    tags: userTags,
    userTags,
    sourceTags,
    tagOwnershipMigrated: true,
  };
}

function needsHydration(row) {
  if (!row) return false;
  if (row.contentParsed) return false;
  const hasRealDescription = Boolean(row.description && !row.description.startsWith("刚刚导入的角色卡"));
  return !hasRealDescription
    || !row.firstMessage
    || !row.personality
    || !row.scenario
    || !row.exampleDialogue
    || !row.creatorNotes
    || !row.systemPrompt
    || !row.postHistoryInstructions
    || !row.alternateGreetings?.length;
}

function applyCardContent(row, content) {
  const hasRealDescription = Boolean(row.description && !row.description.startsWith("刚刚导入的角色卡"));
  const sourceTags = normalizeTags(content.tags);
  const currentTags = normalizeTags(row.userTags ?? row.tags);
  const userTags = row.userTags ? currentTags : currentTags.filter((tag) => !sourceTags.includes(tag));
  return {
    ...row,
    contentParsed: true,
    description: hasRealDescription ? row.description : (content.description?.trim() || row.description),
    personality: row.personality || content.personality || "",
    scenario: row.scenario || content.scenario || "",
    firstMessage: row.firstMessage || content.firstMes || "",
    exampleDialogue: row.exampleDialogue || content.mesExample || "",
    creatorNotes: row.creatorNotes || content.creatorNotes || "",
    systemPrompt: row.systemPrompt || content.systemPrompt || "",
    postHistoryInstructions: row.postHistoryInstructions || content.postHistoryInstructions || "",
    alternateGreetings: row.alternateGreetings?.length ? row.alternateGreetings : content.alternateGreetings,
    tags: userTags,
    userTags,
    sourceTags,
    tagOwnershipMigrated: true,
    creator: row.creator || content.creator || "",
    characterVersion: row.characterVersion || content.characterVersion || "",
    modifiedAt: new Date().toISOString(),
  };
}

function cardDataFromRow(row) {
  return {
    name: row.name || row.fileName || "未命名角色",
    description: row.description || "",
    personality: row.personality || "",
    scenario: row.scenario || "",
    first_mes: row.firstMessage || "",
    mes_example: row.exampleDialogue || "",
    creator_notes: row.creatorNotes || "",
    system_prompt: row.systemPrompt || "",
    post_history_instructions: row.postHistoryInstructions || "",
    alternate_greetings: Array.isArray(row.alternateGreetings) ? row.alternateGreetings : [],
    creator: row.creator || "",
    character_version: row.characterVersion || "",
    tags: normalizeTags(row.userTags ?? row.tags),
  };
}

function buildCardJson(row) {
  return JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: cardDataFromRow(row) }, null, 2);
}

// 导出时尽量保留用户的编辑：PNG 重写元数据块，JSON 重建内容；
// 仅 webp/jpg 这类无法内嵌元数据的格式退回复制原始文件。
function exportCardToFile(row, target) {
  const source = findCardSource(row);
  if (source && /\.png$/i.test(source)) {
    try {
      const rewritten = writeCharacterCardToPng(fs.readFileSync(source), cardDataFromRow(row));
      if (rewritten) {
        fs.writeFileSync(target, rewritten);
        return;
      }
    } catch {}
    fs.copyFileSync(source, target);
    return;
  }
  if (source && /\.(webp|jpe?g)$/i.test(source)) {
    fs.copyFileSync(source, target);
    return;
  }
  fs.writeFileSync(target, buildCardJson(row), "utf8");
}

function detectTavernPort() {
  const tavernDir = detectTavernDir().dir;
  try {
    const config = fs.readFileSync(path.join(tavernDir, "config.yaml"), "utf8");
    const match = config.match(/^port:\s*["']?(\d+)["']?\s*(?:#.*)?$/m);
    return match ? Number(match[1]) : 8000;
  } catch {
    return 8000;
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateTavernState(patch, logLine) {
  let logs = tavernState.logs;
  if (patch && Array.isArray(patch.logs)) {
    logs = patch.logs;
  } else {
    logs = [...tavernState.logs];
    if (logLine) logs.push(logLine.trim());
  }
  logs = logs.filter(Boolean).slice(-12);
  const { logs: _patchLogs, ...rest } = patch || {};
  tavernState = { ...tavernState, ...rest, logs };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("tavern:progress", tavernState);
  }
}

// 升级内置酒馆版本时必须保留的用户数据（相对运行目录）
const EMBEDDED_PRESERVED_PATHS = [
  "data",
  "config.yaml",
  "secrets.json",
  "plugins",
  path.join("public", "scripts", "extensions", "third-party"),
];

function collectFilesRecursive(root) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push({ path: full, rel: path.relative(root, full), size: fs.statSync(full).size });
    }
  };
  walk(root);
  return files;
}

// 内置副本的固定安全配置：只监听本机、启动后不抢系统浏览器（界面由应用内窗口承载）
function patchEmbeddedStConfig(config) {
  let patched = config.replace(/^listen:.*$/m, "listen: false");
  patched = patched.replace(/(browserLaunch:\s*\n(?:[ \t]+#.*\n)*?[ \t]+enabled:\s*)(\S+)/, "$1false");
  if (!/^listen:/m.test(patched)) patched += "\nlisten: false\n";
  return patched;
}

// 首次使用或版本更新时，把安装包里的酒馆复制到用户可写目录（安装目录可能只读，酒馆要写自己的数据）
async function ensureEmbeddedRuntime(onProgress) {
  const source = path.join(embeddedSourceDir(), "st");
  const runtime = embeddedRuntimeDir();
  const manifest = readEmbeddedManifest() || {};
  const stamp = {
    version: String(manifest.stVersion ?? ""),
    nodeVersion: String(manifest.nodeVersion ?? ""),
    copiedAt: new Date().toISOString(),
  };

  if (embeddedRuntimeReady()) {
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(embeddedRuntimeManifestFile(), "utf8")); } catch {}
    if (existing?.version === stamp.version) return { ok: true, fresh: false };
  }

  const previousBackup = `${runtime}.old-${Date.now()}`;
  if (fs.existsSync(runtime)) fs.renameSync(runtime, previousBackup);
  try {
    fs.mkdirSync(runtime, { recursive: true });
    const files = collectFilesRecursive(source);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
    let copiedBytes = 0;
    let lastReport = 0;
    for (const file of files) {
      const target = path.join(runtime, file.rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file.path, target);
      copiedBytes += file.size;
      const now = Date.now();
      if (now - lastReport > 300) {
        lastReport = now;
        onProgress?.(copiedBytes, totalBytes);
        await delay(0);
      }
    }
    if (fs.existsSync(previousBackup)) {
      for (const rel of EMBEDDED_PRESERVED_PATHS) {
        const from = path.join(previousBackup, rel);
        if (!fs.existsSync(from)) continue;
        const to = path.join(runtime, rel);
        if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(from, to, { recursive: true });
      }
    }
  } catch (error) {
    // 复制失败时回滚旧版本，保证运行目录要么完整、要么回到升级前
    if (fs.existsSync(previousBackup)) {
      try {
        fs.rmSync(runtime, { recursive: true, force: true });
        fs.renameSync(previousBackup, runtime);
      } catch {}
    }
    return { ok: false, error: `复制内置酒馆文件失败：${error.message || error}` };
  }
  try { fs.rmSync(previousBackup, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}

  const configPath = path.join(runtime, "config.yaml");
  try {
    const template = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, "utf8")
      : fs.readFileSync(path.join(runtime, "default", "config.yaml"), "utf8");
    fs.writeFileSync(configPath, patchEmbeddedStConfig(template), "utf8");
  } catch (error) {
    return { ok: false, error: `写入内置酒馆配置失败：${error.message || error}` };
  }

  syncStExtension(runtime);

  fs.writeFileSync(embeddedRuntimeManifestFile(), `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
  return { ok: true, fresh: true };
}

function forwardTavernChildLogs(child) {
  const forward = (stream) => {
    if (!stream) return;
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const text = line.trim();
        if (text) updateTavernState({}, `酒馆 ${text.slice(0, 180)}`);
      }
    });
  };
  forward(child.stdout);
  forward(child.stderr);
}

async function waitForTavernPort(port, getExited, timeoutMs = 180000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) return { ready: true };

    if (getExited() !== null) return { ready: false, exited: getExited() };

    const elapsed = Date.now() - startedAt;
    const progress = Math.min(94, 36 + Math.floor(elapsed / 2600));
    const message = elapsed < 20000
      ? "正在检查运行依赖"
      : elapsed < 65000
        ? "正在初始化酒馆服务"
        : "酒馆仍在启动，请稍候";
    updateTavernState({ phase: "waiting", progress, message, detail: `等待端口 ${port} 响应 · ${Math.floor(elapsed / 1000)} 秒` });
    await delay(900);
  }
  return { ready: false, timeout: true };
}

async function launchSillyTavern() {
  const detected = detectTavernDir();
  const port = detectTavernPort();
  updateTavernState({
    phase: "checking",
    progress: 6,
    message: "正在检查酒馆环境",
    detail: detected.embedded ? "使用内置酒馆" : `检查 ${detected.dir}`,
    port,
    logs: [],
  }, detected.embedded ? "使用内置 SillyTavern" : "开始检查 SillyTavern 安装目录");

  if (detected.embedded) {
    await launchEmbeddedTavern(port);
  } else {
    await launchExternalTavern(detected, port);
  }
}

async function launchExternalTavern(detected, port) {
  const tavernDir = detected.dir;

  if (!detected.exists) {
    updateTavernState({
      phase: "error",
      progress: 100,
      message: "未找到酒馆目录",
      detail: `${tavernDir} 不存在，可在设置中选择目录`,
    }, "启动失败：目录不存在，请打开设置选择酒馆目录");
    return;
  }

  const startScript = path.join(tavernDir, "Start.bat");
  if (!fs.existsSync(startScript)) {
    updateTavernState({ phase: "error", progress: 100, message: "未找到酒馆启动脚本", detail: startScript }, "启动失败：Start.bat 不存在");
    return;
  }

  updateTavernState({ progress: 18, message: "安装目录检查完成", detail: `Start.bat · 端口 ${port}` }, `找到酒馆启动脚本：${startScript}`);

  if (await isPortOpen(port)) {
    updateTavernState({ phase: "ready", progress: 100, message: "酒馆已经在运行", detail: `请切换已有页面 · http://127.0.0.1:${port}` }, "检测到现有酒馆服务，不重复打开页面");
    return;
  }

  updateTavernState({ phase: "starting", progress: 28, message: "正在启动酒馆服务", detail: "调用现有 Start.bat，不修改酒馆本体" }, `正在启动 ${startScript}`);

  let childExited = null;
  try {
    tavernChildEmbedded = false;
    tavernChild = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${startScript}" < nul`], {
      cwd: tavernDir,
      windowsHide: false,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production" },
    });
    tavernChild.once("exit", (code) => { childExited = code; });
    tavernChild.once("error", (error) => { childExited = error.message; });
    tavernChild.unref();
  } catch (error) {
    updateTavernState({ phase: "error", progress: 100, message: "无法启动酒馆", detail: String(error.message || error) }, "创建启动进程失败");
    return;
  }

  updateTavernState({ phase: "waiting", progress: 36, message: "酒馆进程已启动", detail: "正在等待服务准备完成" }, "启动进程创建成功");
  const outcome = await waitForTavernPort(port, () => childExited);

  if (outcome.ready) {
    updateTavernState({ phase: "ready", progress: 100, message: "酒馆启动完成", detail: `已在端口 ${port} 就绪 · Start.bat 已处理浏览器打开` }, "SillyTavern 服务已就绪，不重复打开浏览器");
    return;
  }
  if (outcome.exited !== undefined) {
    updateTavernState({ phase: "error", progress: 100, message: "酒馆进程提前退出", detail: `退出信息：${outcome.exited}` }, "启动进程已退出，请查看酒馆日志");
    return;
  }
  updateTavernState({ phase: "error", progress: 100, message: "启动等待超时", detail: `端口 ${port} 在 180 秒内没有响应` }, `请查看 ${path.join(tavernDir, "sillytavern-error.log")}`);
}

async function launchEmbeddedTavern(port) {
  const manifest = readEmbeddedManifest() || {};
  const runtime = embeddedRuntimeDir();

  if (!embeddedRuntimeReady()) {
    updateTavernState({
      phase: "checking",
      progress: 8,
      message: "正在准备内置酒馆",
      detail: `首次使用：把 SillyTavern ${manifest.stVersion || ""} 复制到用户目录（仅此一次）`,
    }, "开始复制内置酒馆文件");
    const ensured = await ensureEmbeddedRuntime((copied, total) => {
      const ratio = total ? copied / total : 0;
      updateTavernState({
        progress: 8 + Math.round(ratio * 14),
        message: "正在准备内置酒馆",
        detail: `已复制 ${(copied / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`,
      });
    });
    if (!ensured.ok) {
      updateTavernState({ phase: "error", progress: 100, message: "内置酒馆准备失败", detail: ensured.error }, ensured.error);
      return;
    }
    updateTavernState({ progress: 24, message: "内置酒馆就绪", detail: `SillyTavern ${manifest.stVersion || ""} · 端口 ${port}` }, "内置酒馆文件复制完成");
  } else {
    updateTavernState({ progress: 18, message: "内置酒馆已就绪", detail: `SillyTavern ${manifest.stVersion || ""}` }, "内置酒馆已准备好");
  }

  if (await isPortOpen(port)) {
    updateTavernState({ phase: "ready", progress: 100, message: "酒馆已经在运行", detail: `http://127.0.0.1:${port}` }, "检测到内置酒馆已在运行");
    openTavernWindow(port);
    return;
  }

  const nodeExe = path.join(embeddedSourceDir(), "node", "node.exe");
  const useBundledNode = fs.existsSync(nodeExe);
  const command = useBundledNode ? nodeExe : process.execPath;
  const env = { ...process.env, NODE_ENV: "production" };
  if (useBundledNode) delete env.ELECTRON_RUN_AS_NODE;
  else env.ELECTRON_RUN_AS_NODE = "1";

  updateTavernState(
    { phase: "starting", progress: 28, message: "正在启动内置酒馆", detail: useBundledNode ? "使用随包的 Node 运行时" : "使用应用内置兼容层" },
    `启动内置酒馆：${command} server.js`,
  );

  let childExited = null;
  try {
    tavernChildEmbedded = true;
    tavernChild = spawn(command, ["server.js"], {
      cwd: runtime,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    forwardTavernChildLogs(tavernChild);
    tavernChild.once("exit", (code) => { childExited = code; });
    tavernChild.once("error", (error) => { childExited = error.message; });
  } catch (error) {
    tavernChildEmbedded = false;
    updateTavernState({ phase: "error", progress: 100, message: "无法启动内置酒馆", detail: String(error.message || error) }, "创建内置酒馆进程失败");
    return;
  }

  updateTavernState({ phase: "waiting", progress: 36, message: "内置酒馆进程已启动", detail: "正在等待服务准备完成" }, "内置酒馆启动进程创建成功");
  const outcome = await waitForTavernPort(port, () => childExited);

  if (outcome.ready) {
    updateTavernState({ phase: "ready", progress: 100, message: "酒馆启动完成", detail: `已在端口 ${port} 就绪 · 已在应用内打开` }, "内置酒馆就绪，已打开应用内窗口");
    openTavernWindow(port);
    return;
  }
  if (outcome.exited !== undefined) {
    tavernChildEmbedded = false;
    updateTavernState({ phase: "error", progress: 100, message: "内置酒馆进程提前退出", detail: `退出信息：${outcome.exited}` }, "内置酒馆进程已退出，详情见启动日志");
    return;
  }
  updateTavernState({ phase: "error", progress: 100, message: "启动等待超时", detail: `端口 ${port} 在 180 秒内没有响应` }, "内置酒馆启动超时，请重试或反馈日志");
}

// ---- 关闭行为与系统托盘 ----
// 首次关窗弹窗询问「最小化到托盘 / 彻底关闭」，可勾选「以后都这样」；
// 选择保存在 settings.closeAction（ask/tray/quit），托盘菜单与设置里可改。

function getCloseAction() {
  const value = readSettings().closeAction;
  return value === "tray" || value === "quit" ? value : "ask";
}

function setCloseAction(value) {
  const settings = readSettings();
  writeSettings({ ...settings, closeAction: value });
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const action = getCloseAction();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开酒馆界面", click: () => showPrimaryWindow() },
    { label: "完整卡库管理", click: () => { openFullManager(); } },
    { type: "separator" },
    { label: "关闭时：每次询问", type: "radio", checked: action === "ask", click: () => setCloseAction("ask") },
    { label: "关闭时：最小化到托盘", type: "radio", checked: action === "tray", click: () => setCloseAction("tray") },
    { label: "关闭时：彻底退出", type: "radio", checked: action === "quit", click: () => setCloseAction("quit") },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
}

function ensureTray() {
  if (tray) return tray;
  try {
    tray = new Tray(path.join(__dirname, "icon.ico"));
  } catch {
    return null;
  }
  tray.setToolTip("酒馆角色卡库");
  rebuildTrayMenu();
  tray.on("double-click", () => showPrimaryWindow());
  return tray;
}

function showPrimaryWindow() {
  const target = tavernWindow && !tavernWindow.isDestroyed()
    ? tavernWindow
    : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  if (!target) {
    createManagerWindow();
    return;
  }
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}

function hideToTray(window) {
  ensureTray();
  window.hide();
  if (!trayBalloonShown && tray) {
    trayBalloonShown = true;
    try {
      tray.displayBalloon({ iconType: "info", title: "酒馆角色卡库", content: "已最小化到托盘，酒馆仍在后台运行；双击托盘图标可恢复窗口。" });
    } catch {}
  }
}

async function handleCloseRequest(window, event) {
  const action = getCloseAction();
  if (action === "tray") {
    event.preventDefault();
    hideToTray(window);
    return;
  }
  if (action === "quit") {
    app.quit();
    return;
  }
  event.preventDefault();
  try {
    const result = await dialog.showMessageBox(window, {
      type: "question",
      title: "关闭酒馆角色卡库",
      message: "关闭窗口后，要保留后台运行吗？",
      detail: "最小化到托盘：酒馆继续在后台运行，随时从任务栏托盘恢复。\n彻底关闭：酒馆服务会一并停止。",
      checkboxLabel: "以后都这样，不再询问",
      checkboxChecked: false,
      buttons: ["最小化到托盘", "彻底关闭"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) {
      if (result.checkboxChecked) setCloseAction("quit");
      app.quit();
    } else {
      if (result.checkboxChecked) setCloseAction("tray");
      hideToTray(window);
    }
  } catch {
    app.quit();
  }
}

// 应用内酒馆窗口：内置模式下的主窗口（打开应用直接进入酒馆），
// 也用于在应用内查看已在运行的外部酒馆。
// 完整管理入口：优先在酒馆页面内打开（扩展挂载的停靠面板），失败回退独立窗口
async function openFullManager() {
  const loaded = tavernWindow && !tavernWindow.isDestroyed()
    && /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(tavernWindow.webContents.getURL());
  if (loaded) {
    if (tavernWindow.isMinimized()) tavernWindow.restore();
    tavernWindow.show();
    tavernWindow.focus();
    const opened = await tavernWindow.webContents.executeJavaScript(
      "typeof window.__tavernVaultOpenManager === 'function' ? (window.__tavernVaultOpenManager(), true) : false",
      true,
    ).catch(() => false);
    if (opened) return;
  }
  createManagerWindow();
}

function ensureTavernWindow() {
  if (tavernWindow && !tavernWindow.isDestroyed()) return tavernWindow;
  tavernWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0d0d11",
    title: "酒馆角色卡库",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 所有入口都在酒馆页面内（魔法棒菜单/角色面板按钮）与托盘，不再挂原生菜单栏
  tavernWindow.setMenu(null);
  tavernWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^http:\/\/(127\.0\.0\.1|localhost):\d+\//i.test(url)) return { action: "allow" };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  tavernWindow.once("ready-to-show", () => tavernWindow.show());
  tavernWindow.on("close", (event) => { handleCloseRequest(tavernWindow, event); });
  tavernWindow.on("closed", () => { tavernWindow = null; });
  return tavernWindow;
}

function openTavernWindow(port) {
  const window = ensureTavernWindow();
  window.show();
  window.focus();
  window.loadURL(`http://127.0.0.1:${port}`).catch(() => {});
}

// 启动酒馆前的过渡页：实时显示启动进度（复用 tavern:progress 推送），
// 首次使用时的文件复制进度也在这里展示；出错时提供重试与打开卡库入口。
function tavernSplashUrl() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>酒馆角色卡库</title><style>
    body{margin:0;height:100vh;display:grid;place-items:center;background:#0d0d11;color:#eee;
      font-family:"Microsoft YaHei","Segoe UI",sans-serif}
    .box{width:min(520px,86vw);text-align:center}
    .spin{width:46px;height:46px;margin:0 auto 26px;border-radius:50%;border:3px solid #3a2a22;
      border-top-color:#d97b4a;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    h1{margin:0 0 10px;font-size:17px;font-weight:600}
    p{margin:0 0 22px;color:#9b9287;font-size:12px;min-height:18px;word-break:break-all}
    .bar{height:5px;border-radius:3px;background:#241d19;overflow:hidden}
    .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#a95731,#d97b4a);
      border-radius:3px;transition:width .4s}
    .btns{margin-top:26px;display:none;gap:10px;justify-content:center}
    .btns.show{display:flex}
    button{height:34px;padding:0 16px;border:1px solid #9c5c36;border-radius:6px;background:#a95731;
      color:#fff4ec;cursor:pointer;font-size:12px;font-weight:600}
    button.ghost{border-color:#4a4038;background:#241d19;color:#c9c0b4}
  </style></head><body><div class="box">
    <div class="spin"></div>
    <h1 id="msg">正在启动内置酒馆…</h1>
    <p id="detail">首次使用会先准备文件，仅此一次</p>
    <div class="bar"><i id="fill"></i></div>
    <div class="btns" id="btns">
      <button class="ghost" id="lib">打开角色卡库</button>
      <button id="retry">重新尝试</button>
    </div>
  </div><script>
    var api = window.desktopAPI;
    function bind(id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; }
    if (api) {
      api.onTavernProgress(function (p) {
        var msg = document.getElementById("msg");
        var detail = document.getElementById("detail");
        var fill = document.getElementById("fill");
        if (msg && p.message) msg.textContent = p.message;
        if (detail && p.detail) detail.textContent = p.detail;
        if (fill) fill.style.width = Math.max(2, Math.min(100, p.progress || 0)) + "%";
        if (p.phase === "error") document.getElementById("btns").className = "btns show";
      });
      bind("retry", function () { api.startSillyTavern(); });
      bind("lib", function () { api.openLibrary(); });
    }
  </script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showTavernSplash() {
  const window = ensureTavernWindow();
  window.loadURL(tavernSplashUrl()).catch(() => {});
}

function uniqueTargetPath(dir, fileName) {
  const parsed = path.parse(fileName);
  let target = path.join(dir, fileName);
  let counter = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${parsed.name} (${counter})${parsed.ext}`);
    counter += 1;
  }
  return target;
}

function sendUpdateStatus(payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("update:status", payload);
  }
}

// 更新下载直连 GitHub 在部分网络环境极慢；本地代理（Clash 等）快百倍。
// 只把 updater 自己的 netSession 走代理，探测顺序：环境变量 → 注册表 ProxyServer → 常见本地端口。
async function configureUpdaterProxy(updateLog) {
  const candidates = [];
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (envProxy) candidates.push(envProxy);
  try {
    const { spawnSync } = require("node:child_process");
    const out = spawnSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", "ProxyServer"], { encoding: "utf8" });
    const match = String(out.stdout || "").match(/REG_SZ\s+(\S+)/);
    if (match) candidates.push(match[1].startsWith("http") ? match[1] : `http://${match[1]}`);
  } catch {}
  candidates.push("http://127.0.0.1:7897", "http://127.0.0.1:7890");

  const alive = (rule) => new Promise((resolve) => {
    try {
      const parsed = new URL(rule);
      const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) || 80 });
      socket.setTimeout(600);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
      socket.once("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });

  for (const rule of candidates) {
    if (!(await alive(rule))) continue;
    try {
      await autoUpdater.netSession.setProxy({ proxyRules: rule });
      updateLog("INFO", `updater proxy enabled: ${rule}`);
      return rule;
    } catch (error) {
      updateLog("WARN", `setProxy(${rule}) failed: ${error?.message || error}`);
    }
  }
  updateLog("INFO", "no local proxy found, updater uses direct connection");
  return null;
}

function setupAutoUpdater() {
  // electron-updater 不支持便携版目标，强制走 GitHub 手动下载路径
  if (SMOKE_TEST || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // 更新过程的完整日志落盘，失败不再静默（此前私有仓库 404 被吞，用户无从得知）
    const updateLog = (level, message) => {
      try {
        fs.appendFileSync(path.join(app.getPath("userData"), "update.log"), `[${new Date().toISOString()}] ${level} ${String(message).slice(0, 500)}\n`);
      } catch {}
    };
    autoUpdater.logger = {
      info: (m) => updateLog("INFO", m),
      warn: (m) => updateLog("WARN", m),
      error: (m) => updateLog("ERROR", m),
      debug: (m) => updateLog("DEBUG", m),
    };
    autoUpdater.on("update-available", (info) => sendUpdateStatus({ event: "available", version: info?.version }));
    autoUpdater.on("update-not-available", () => sendUpdateStatus({ event: "not-available" }));
    autoUpdater.on("download-progress", (progress) => sendUpdateStatus({ event: "progress", percent: Math.round(progress?.percent ?? 0) }));
    autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ event: "downloaded", version: info?.version }));
    autoUpdater.on("error", (error) => {
      updateLog("ERROR", `check/download failed: ${error?.message || error}`);
      sendUpdateStatus({ event: "error", message: String(error?.message || error) });
    });
    (async () => {
      await configureUpdaterProxy(updateLog);
      await autoUpdater.checkForUpdates().catch((error) => updateLog("ERROR", `checkForUpdates rejected: ${error?.message || error}`));
    })();
  } catch (error) {
    try {
      fs.appendFileSync(path.join(app.getPath("userData"), "update.log"), `[${new Date().toISOString()}] ERROR init failed: ${error?.message || error}\n`);
    } catch {}
    autoUpdater = null;
  }
}

// 卡库窗口改为按需打开后可能不存在，对话框要能在无父窗口时独立弹出
function showSaveDialogSafe(options) {
  return mainWindow && !mainWindow.isDestroyed()
    ? dialog.showSaveDialog(mainWindow, options)
    : dialog.showSaveDialog(options);
}

function showOpenDialogSafe(options) {
  return mainWindow && !mainWindow.isDestroyed()
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options);
}

function registerIpcHandlers() {
  ipcMain.handle("cards:list", () => {
    const rows = readRows();
    let changed = false;
    const cleanedRows = rows.map((row) => {
      const normalized = normalizeFavorite(row);
      const cleaned = stripImportedTags(normalized);
      if (cleaned !== row) changed = true;
      return cleaned;
    });
    if (changed) {
      try { writeRows(cleanedRows, { backup: "never" }); } catch {}
    }
    return cleanedRows.map(publicCard);
  });

  ipcMain.handle("cards:updateMany", (_event, ids, patch) => {
    const rows = readRows();
    const safePatch = sanitizePatch(patch);
    if (!Object.keys(safePatch).length) return 0;
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    let changed = 0;
    const now = new Date().toISOString();
    for (const row of rows) {
      if (!idSet.has(row.id)) continue;
      Object.assign(row, safePatch, { modifiedAt: now });
      changed += 1;
    }
    if (changed) writeRows(rows);
    return changed;
  });

  ipcMain.handle("cards:delete", (_event, ids) => {
    const rows = readRows();
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    const remaining = rows.filter((row) => !idSet.has(row.id));
    const removed = rows.length - remaining.length;
    if (removed) {
      writeRows(remaining);
      const cardsRoot = cardsDirectory();
      for (const row of rows) {
        if (idSet.has(row.id) && row.imagePath) {
          try { fs.rmSync(row.imagePath, { force: true }); } catch {}
          try {
            const cardDir = path.dirname(row.imagePath);
            const rel = path.relative(cardsRoot, cardDir);
            if (rel && !rel.startsWith("..") && !path.isAbsolute(rel) && fs.existsSync(cardDir)) {
              fs.rmSync(cardDir, { recursive: true, force: true });
            }
          } catch {}
        }
      }
    }
    return removed;
  });

  ipcMain.handle("cards:import", (_event, entries) => {
    const rows = readRows();
    const imported = [];
    const createdDirs = [];
    let skipped = 0;
    let duplicates = 0;
    const existingKeys = new Set(rows.map((row) => `${String(row.fileName || "").toLowerCase()}::${Number(row.size) || 0}`));
    fs.mkdirSync(cardsDirectory(), { recursive: true });

    for (const entry of Array.isArray(entries) ? entries : []) {
      let cardDir = null;
      try {
        if (!entry || !entry.path || !fs.existsSync(entry.path)) {
          skipped += 1;
          continue;
        }
        let size = Number(entry.size);
        if (!Number.isFinite(size) || size <= 0) size = fs.statSync(entry.path).size;
        const fileName = path.basename(entry.fileName || path.basename(entry.path));
        const dedupeKey = `${fileName.toLowerCase()}::${size}`;
        if (existingKeys.has(dedupeKey)) {
          duplicates += 1;
          continue;
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const extension = path.extname(fileName).toLowerCase();
        const isImage = [".png", ".webp", ".jpg", ".jpeg"].includes(extension);
        const cardContent = parseCharacterCardFile(entry.path);
        let imagePath = "";
        if (isImage) {
          cardDir = path.join(cardsDirectory(), id);
          createdDirs.push(cardDir);
          fs.mkdirSync(cardDir, { recursive: true });
          imagePath = path.join(cardDir, `card${extension}`);
          fs.copyFileSync(entry.path, imagePath);
        }
        const sourceTags = normalizeTags(cardContent?.tags);
        const userTags = [];
        const description = cardContent?.description?.trim() || "刚刚导入的角色卡，等待你补充标签与简介。";
        const row = {
          id,
          name: entry.suggestedName || cardContent?.name?.trim() || path.parse(fileName).name,
          fileName,
          fileType: entry.fileType || (extension === ".json" ? "application/json" : "image/png"),
          size,
          rating: 0,
          favorite: false,
          tags: userTags,
          userTags,
          sourceTags,
          tagOwnershipMigrated: true,
          bookshelf: "未分类",
          imagePath,
          description,
          personality: cardContent?.personality ?? "",
          scenario: cardContent?.scenario ?? "",
          firstMessage: cardContent?.firstMes ?? "",
          exampleDialogue: cardContent?.mesExample ?? "",
          creatorNotes: cardContent?.creatorNotes ?? "",
          systemPrompt: cardContent?.systemPrompt ?? "",
          postHistoryInstructions: cardContent?.postHistoryInstructions ?? "",
          alternateGreetings: cardContent?.alternateGreetings ?? [],
          creator: cardContent?.creator ?? "",
          characterVersion: cardContent?.characterVersion ?? "",
          sourcePath: entry.sourcePath || entry.path,
          createdAt: now,
          modifiedAt: now,
          accent: "#7557c5",
        };
        existingKeys.add(dedupeKey);
        rows.unshift(row);
        imported.push(publicCard(row));
      } catch {
        skipped += 1;
        if (cardDir) {
          try { fs.rmSync(cardDir, { recursive: true, force: true }); } catch {}
        }
      }
    }

    try {
      writeRows(rows);
    } catch (error) {
      for (const dir of createdDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      throw error;
    }
    return { cards: imported, skipped, duplicates };
  });

  ipcMain.handle("cards:update", (_event, id, patch) => {
    const rows = readRows();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return null;
    const safePatch = sanitizePatch(patch);
    rows[index] = { ...rows[index], ...safePatch, modifiedAt: new Date().toISOString() };
    writeRows(rows);
    return publicCard(rows[index]);
  });

  ipcMain.handle("cards:hydrate", (_event, id) => {
    const rows = readRows();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return null;
    const row = rows[index];
    if (!needsHydration(row)) return publicCard(row);
    const source = findCardSource(row);
    const content = source ? parseCharacterCardFile(source) : null;
    if (!content) return publicCard(row);
    const updated = applyCardContent(row, content);
    rows[index] = updated;
    writeRows(rows);
    return publicCard(updated);
  });

  ipcMain.handle("cards:hydrateAll", () => {
    const rows = readRows();
    let changed = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!needsHydration(row)) continue;
      const source = findCardSource(row);
      const content = source ? parseCharacterCardFile(source) : null;
      if (!content) continue;
      rows[index] = applyCardContent(row, content);
      changed += 1;
    }
    if (changed) writeRows(rows);
    return { hydrated: changed, total: rows.length };
  });

  ipcMain.handle("cards:export", async (_event, id) => {
    const row = readRows().find((item) => item.id === id);
    if (!row) return { ok: false, error: "角色卡不存在" };
    const source = findCardSource(row);
    const defaultName = source
      ? path.basename(source)
      : `${(row.name || "角色卡").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.json`;
    const extension = path.extname(defaultName).toLowerCase() || ".json";
    const result = await showSaveDialogSafe({
      title: "导出角色卡",
      defaultPath: defaultName,
      filters: [{ name: extension === ".json" ? "JSON 卡片" : "图片卡片", extensions: [extension.replace(".", "")] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      exportCardToFile(row, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle("cards:exportMany", async (_event, ids) => {
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    const rows = readRows().filter((row) => idSet.has(row.id));
    if (!rows.length) return { ok: false, error: "没有可导出的角色卡" };
    const result = await showOpenDialogSafe({
      title: "选择导出位置",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, canceled: true };
    const targetDir = result.filePaths[0];
    let exported = 0;
    let failed = 0;
    for (const row of rows) {
      const source = findCardSource(row);
      const fileName = source
        ? path.basename(source)
        : `${(row.name || row.fileName || "角色卡").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.json`;
      try {
        exportCardToFile(row, uniqueTargetPath(targetDir, fileName));
        exported += 1;
      } catch {
        failed += 1;
      }
    }
    return { ok: true, exported, failed, dir: targetDir };
  });

  ipcMain.handle("settings:get", () => {
    const detected = detectTavernDir();
    const settings = readSettings();
    return {
      sillyTavernDir: typeof settings.sillyTavernDir === "string" ? settings.sillyTavernDir.trim() : "",
      detectedDir: detected.dir,
      dirExists: detected.exists,
      appVersion: app.getVersion(),
      isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
      preferEmbedded: settings.preferEmbedded === true,
      closeAction: getCloseAction(),
      embeddedAvailable: embeddedAvailable(),
      embeddedVersion: readEmbeddedManifest()?.stVersion ?? null,
      embeddedRuntimeReady: embeddedRuntimeReady(),
      tavernEmbedded: detected.embedded,
    };
  });

  ipcMain.handle("settings:set", (_event, patch) => {
    const settings = readSettings();
    let dir = typeof settings.sillyTavernDir === "string" ? settings.sillyTavernDir : "";
    if (typeof patch?.sillyTavernDir === "string") {
      dir = patch.sillyTavernDir.trim().replace(/\\+$/, "");
      // 保留盘符根（"D:\" 削成 "D:" 会变成随 CWD 漂移的驱动器相对路径）
      if (/^[A-Za-z]:$/.test(dir)) dir += "\\";
      if (dir && !fs.existsSync(dir)) return { ok: false, error: "目录不存在" };
    }
    const preferEmbedded = patch?.preferEmbedded === true;
    if (preferEmbedded && !embeddedAvailable()) {
      return { ok: false, error: "当前版本未内置酒馆（精简版请使用外部目录）" };
    }
    const closeAction = ["ask", "tray", "quit"].includes(patch?.closeAction) ? patch.closeAction : settings.closeAction;
    writeSettings({ ...settings, sillyTavernDir: dir, preferEmbedded, closeAction });
    const detected = detectTavernDir();
    tavernState = { ...tavernState, detail: `等待启动 ${detected.dir}` };
    rebuildTrayMenu();
    return { ok: true, sillyTavernDir: detected.dir, dirExists: detected.exists };
  });

  ipcMain.handle("settings:pickDirectory", async () => {
    const result = await showOpenDialogSafe({
      title: "选择 SillyTavern 目录",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths?.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("backups:list", () => listBackupFiles());

  ipcMain.handle("backups:create", () => {
    const name = createBackup("manual");
    lastAutoBackupAt = Date.now();
    return { ok: Boolean(name), name: name ?? undefined };
  });

  ipcMain.handle("backups:restore", (_event, name) => {
    if (!/^character-library\.[\w-]+\.json$/.test(String(name || ""))) {
      return { ok: false, error: "备份名称无效" };
    }
    const backupPath = path.join(backupsDirectory(), String(name));
    if (!fs.existsSync(backupPath)) return { ok: false, error: "备份不存在" };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    } catch {
      return { ok: false, error: "备份文件已损坏" };
    }
    if (!Array.isArray(parsed)) return { ok: false, error: "备份内容不是有效的卡库数据" };
    createBackup("pre-restore");
    writeRows(parsed, { backup: "never" });
    return { ok: true, cards: parsed.map(publicCard) };
  });

  ipcMain.handle("update:check", async () => {
    if (!autoUpdater) {
      return { ok: false, error: "当前环境不支持自动更新，便携版请到 GitHub Releases 下载新版" };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, version: result?.updateInfo?.version ?? null };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle("update:install", () => {
    if (!autoUpdater) return { ok: false, error: "自动更新不可用" };
    autoUpdater.quitAndInstall();
    return { ok: true };
  });

  ipcMain.handle("tavern:status", async () => {
    const port = detectTavernPort();
    if (!launchTask && (await isPortOpen(port))) {
      tavernState = { ...tavernState, phase: "ready", progress: 100, message: "酒馆正在运行", detail: `http://127.0.0.1:${port}`, port };
    }
    return tavernState;
  });

  ipcMain.handle("tavern:start", async () => {
    if (!launchTask) {
      launchTask = launchSillyTavern().finally(() => { launchTask = null; });
    }
    await delay(80);
    return tavernState;
  });

  ipcMain.handle("tavern:openWindow", async () => {
    const port = detectTavernPort();
    if (!(await isPortOpen(port))) return { ok: false, error: "酒馆尚未运行" };
    openTavernWindow(port);
    return { ok: true, port };
  });

  ipcMain.handle("tavern:openBrowser", async () => {
    const port = detectTavernPort();
    if (!(await isPortOpen(port))) return { ok: false, error: "酒馆尚未运行" };
    await shell.openExternal(`http://127.0.0.1:${port}`);
    return { ok: true, port };
  });

  ipcMain.handle("library:open", () => {
    createManagerWindow();
    return { ok: true };
  });

  // ---- 卡库面板（酒馆内扩展）与联动 ----

  ipcMain.handle("tavernPanel:list", () => {
    const rows = readRows();
    const tavernFiles = new Set(listTavernCharacterFiles().map((name) => name.toLowerCase()));
    return rows.map((row) => {
      const avatar = String(row.tavernAvatar || "");
      const imported = (avatar && tavernFiles.has(avatar.toLowerCase()))
        || tavernFiles.has(String(row.fileName || "").toLowerCase());
      return {
        id: row.id,
        name: row.name || row.fileName,
        tags: normalizeTags(row.userTags ?? row.tags),
        rating: row.rating || 0,
        favorite: row.favorite === true,
        fileName: row.fileName || "",
        tavernAvatar: avatar || null,
        imported,
      };
    });
  });

  ipcMain.handle("tavernPanel:cardImage", (_event, id) => {
    const row = readRows().find((item) => item.id === id);
    if (!row) return "";
    const source = (row.imagePath && fs.existsSync(row.imagePath)) ? row.imagePath : findCardSource(row);
    if (!source) return "";
    try {
      const mime = /\.png$/i.test(source) ? "image/png" : /\.webp$/i.test(source) ? "image/webp" : "image/jpeg";
      return `data:${mime};base64,${fs.readFileSync(source).toString("base64")}`;
    } catch {
      return "";
    }
  });

  ipcMain.handle("tavernPanel:cardPayload", (_event, id) => {
    const row = readRows().find((item) => item.id === id);
    if (!row) return { ok: false, error: "角色卡不存在" };
    const card = buildTavernCardFile(row);
    return { ok: true, fileName: card.fileName, mime: card.mime, base64: card.bytes.toString("base64") };
  });

  ipcMain.handle("tavernPanel:markImported", (_event, id, avatar) => {
    const rows = readRows();
    const index = rows.findIndex((item) => item.id === id);
    if (index < 0) return { ok: false };
    const safeAvatar = path.basename(String(avatar || ""));
    rows[index].tavernAvatar = safeAvatar;
    writeRows(rows);
    return { ok: true };
  });

  ipcMain.handle("tavernPanel:tavernCharacters", () => {
    const rows = readRows();
    const known = new Set();
    for (const row of rows) {
      if (row.tavernAvatar) known.add(String(row.tavernAvatar).toLowerCase());
      if (row.fileName) known.add(String(row.fileName).toLowerCase());
    }
    return listTavernCharacterFiles()
      .map((avatar) => {
        const parsed = parseCharacterCardFile(path.join(tavernCharactersDir(), avatar));
        return { avatar, name: parsed?.name?.trim() || avatar.replace(/\.png$/i, ""), adopted: known.has(avatar.toLowerCase()) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  });

  ipcMain.handle("tavern:adoptCharacter", (_event, avatar) => {
    const safeAvatar = path.basename(String(avatar || ""));
    if (!/\.png$/i.test(safeAvatar)) return { ok: false, error: "仅支持 PNG 角色卡" };
    const source = path.join(tavernCharactersDir(), safeAvatar);
    if (!fs.existsSync(source)) return { ok: false, error: "酒馆角色文件不存在" };

    const rows = readRows();
    const size = fs.statSync(source).size;
    const fileName = safeAvatar;
    if (rows.some((row) => `${String(row.fileName || "").toLowerCase()}::${Number(row.size) || 0}` === `${fileName.toLowerCase()}::${size}`)) {
      return { ok: false, error: "卡库中已有这张卡" };
    }
    const content = parseCharacterCardFile(source);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const userTags = [];
    const row = {
      id,
      name: content?.name?.trim() || fileName.replace(/\.png$/i, ""),
      fileName,
      fileType: "image/png",
      size,
      rating: 0,
      favorite: false,
      tags: userTags,
      userTags,
      sourceTags: normalizeTags(content?.tags),
      tagOwnershipMigrated: true,
      bookshelf: "未分类",
      imagePath: "",
      description: content?.description?.trim() || "从酒馆收录的角色卡。",
      personality: content?.personality ?? "",
      scenario: content?.scenario ?? "",
      firstMessage: content?.firstMes ?? "",
      exampleDialogue: content?.mesExample ?? "",
      creatorNotes: content?.creatorNotes ?? "",
      systemPrompt: content?.systemPrompt ?? "",
      postHistoryInstructions: content?.postHistoryInstructions ?? "",
      alternateGreetings: content?.alternateGreetings ?? [],
      creator: content?.creator ?? "",
      characterVersion: content?.characterVersion ?? "",
      sourcePath: `sillytavern resource/data/default-user/characters/${safeAvatar}`,
      tavernAvatar: safeAvatar,
      createdAt: now,
      modifiedAt: now,
      accent: "#7557c5",
    };
    rows.unshift(row);
    writeRows(rows);
    return { ok: true, card: publicCard(row) };
  });

  ipcMain.handle("tavern:chatWithCard", async (_event, id) => {
    const rows = readRows();
    const row = rows.find((item) => item.id === id);
    if (!row) return { ok: false, error: "角色卡不存在" };

    const port = detectTavernPort();
    if (!(await isPortOpen(port))) {
      if (!launchTask) launchTask = launchSillyTavern().finally(() => { launchTask = null; });
      const startedAt = Date.now();
      while (Date.now() - startedAt < 120000) {
        if (await isPortOpen(port)) break;
        await delay(900);
      }
      if (!(await isPortOpen(port))) return { ok: false, error: "酒馆启动超时，请稍后重试" };
    }

    let avatar = row.tavernAvatar;
    if (!avatar || !listTavernCharacterFiles().includes(avatar)) {
      avatar = ensureCardInTavern(row, rows);
      writeRows(rows);
    }
    return selectTavernCharacter(avatar);
  });

  ipcMain.handle("cards:sendToTavern", async (_event, ids) => {
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    const rows = readRows();
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      if (!idSet.has(row.id)) continue;
      try {
        ensureCardInTavern(row, rows);
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    if (sent) writeRows(rows);
    await refreshTavernCharacters();
    return { ok: true, sent, failed };
  });

  ipcMain.handle("tavern:installExtension", () => {
    const detected = detectTavernDir();
    if (detected.embedded) return { ok: false, error: "内置酒馆会自动携带卡库扩展，无需安装" };
    if (!detected.exists) return { ok: false, error: "酒馆目录不存在，请先选择目录" };
    const ok = syncStExtension(detected.dir);
    if (!ok) return { ok: false, error: "扩展文件缺失，请重新安装本应用" };
    return { ok: true, dir: path.join(detected.dir, "data", "default-user", "extensions", ST_EXTENSION_NAME) };
  });
}

function createManagerWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#0d0d11",
    title: "酒馆角色卡库",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.loadFile(path.join(__dirname, "..", "desktop-dist", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    if (SMOKE_TEST) setTimeout(() => app.exit(0), 250);
  });
  mainWindow.webContents.once("did-fail-load", (event, errorCode, errorDescription, failedUrl, isMainFrame) => {
    if (SMOKE_TEST) {
      app.exit(2);
      return;
    }
    if (isMainFrame) {
      const html = `<html><body style="background:#0d0d11;color:#eee;font-family:'Microsoft YaHei',sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>界面加载失败</h2><p>${errorDescription}（代码 ${errorCode}）</p><p>请重新安装应用，或到 GitHub 仓库下载最新版本</p></div></body></html>`;
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      mainWindow.show();
    }
  });
  mainWindow.once("ready-to-show", () => { if (!SMOKE_TEST) mainWindow.show(); });
  mainWindow.on("close", (event) => { handleCloseRequest(mainWindow, event); });
  mainWindow.on("closed", () => { mainWindow = null; });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => showPrimaryWindow());

  app.whenReady().then(() => {
    const detectedAtBoot = detectTavernDir();
    tavernState = {
      ...tavernState,
      detail: detectedAtBoot.embedded ? "正在自动启动内置酒馆" : `等待启动 ${detectedAtBoot.dir}`,
    };
    registerIpcHandlers();
    // 内置模式：双击打开直接进入酒馆界面（启动间隙显示过渡页）；外部模式与冒烟测试保持原行为
    const bootStraightToTavern = !SMOKE_TEST && detectedAtBoot.embedded && embeddedAvailable();
    if (bootStraightToTavern) {
      // 应用升级而内置酒馆版本未变时,也要把联动扩展更新到运行副本
      if (embeddedRuntimeReady()) syncStExtension(embeddedRuntimeDir());
      showTavernSplash();
      launchTask = launchSillyTavern().finally(() => { launchTask = null; });
    } else {
      createManagerWindow();
    }
    setupAutoUpdater();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createManagerWindow(); });
  });

  app.on("before-quit", () => {
    // 内置酒馆随应用退出；外部安装的酒馆是独立进程，不受影响
    if (tavernChild && tavernChildEmbedded) {
      try { tavernChild.kill(); } catch {}
    }
    if (tray) {
      try { tray.destroy(); } catch {}
      tray = null;
    }
  });

  app.on("window-all-closed", () => app.quit());
}
