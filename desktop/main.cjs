const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { parseCharacterCardFile } = require("./character-parser.cjs");

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
  fs.renameSync(temp, file);
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

function detectTavernDir() {
  const configured = typeof readSettings().sillyTavernDir === "string" ? readSettings().sillyTavernDir.trim() : "";
  if (configured) {
    return { dir: configured, configured: true, exists: fs.existsSync(configured) };
  }
  for (const candidate of tavernDirCandidates()) {
    if (fs.existsSync(candidate)) return { dir: candidate, configured: false, exists: true };
  }
  return { dir: tavernDirCandidates()[0], configured: false, exists: false };
}

function readRows() {
  try {
    const rows = JSON.parse(fs.readFileSync(libraryFile(), "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
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
    const target = path.join(backupsDirectory(), `character-library.${stamp}.json`);
    fs.copyFileSync(libraryFile(), target);
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
  return Array.from(new Set(raw.map((tag) => String(tag).trim().replace(/^#/, "")).filter(Boolean))).slice(0, 40);
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
      safePatch.alternateGreetings = Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
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

function buildCardJson(row) {
  const data = {
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
  return JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data }, null, 2);
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

async function launchSillyTavern() {
  const detected = detectTavernDir();
  const tavernDir = detected.dir;
  const port = detectTavernPort();
  updateTavernState({
    phase: "checking",
    progress: 6,
    message: "正在检查酒馆环境",
    detail: `检查 ${tavernDir}`,
    port,
    logs: [],
  }, "开始检查 SillyTavern 安装目录");

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
  const startedAt = Date.now();
  const timeoutMs = 180000;

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) {
      updateTavernState({ phase: "ready", progress: 100, message: "酒馆启动完成", detail: `已在端口 ${port} 就绪 · Start.bat 已处理浏览器打开` }, "SillyTavern 服务已就绪，不重复打开浏览器");
      return;
    }

    if (childExited !== null) {
      updateTavernState({ phase: "error", progress: 100, message: "酒馆进程提前退出", detail: `退出信息：${childExited}` }, "启动进程已退出，请查看酒馆日志");
      return;
    }

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

  updateTavernState({ phase: "error", progress: 100, message: "启动等待超时", detail: `端口 ${port} 在 180 秒内没有响应` }, `请查看 ${path.join(tavernDir, "sillytavern-error.log")}`);
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

function setupAutoUpdater() {
  if (SMOKE_TEST) return;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-available", (info) => sendUpdateStatus({ event: "available", version: info?.version }));
    autoUpdater.on("update-not-available", () => sendUpdateStatus({ event: "not-available" }));
    autoUpdater.on("download-progress", (progress) => sendUpdateStatus({ event: "progress", percent: Math.round(progress?.percent ?? 0) }));
    autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ event: "downloaded", version: info?.version }));
    autoUpdater.on("error", (error) => sendUpdateStatus({ event: "error", message: String(error?.message || error) }));
    autoUpdater.checkForUpdates().catch(() => undefined);
  } catch {
    autoUpdater = null;
  }
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
    if (changed) writeRows(cleanedRows, { backup: "never" });
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
    let skipped = 0;
    let duplicates = 0;
    const existingKeys = new Set(rows.map((row) => `${String(row.fileName || "").toLowerCase()}::${Number(row.size) || 0}`));
    fs.mkdirSync(cardsDirectory(), { recursive: true });

    for (const entry of Array.isArray(entries) ? entries : []) {
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
          const cardDir = path.join(cardsDirectory(), id);
          fs.mkdirSync(cardDir, { recursive: true });
          imagePath = path.join(cardDir, `card${extension}`);
          fs.copyFileSync(entry.path, imagePath);
        }
        const sourceTags = normalizeTags(cardContent?.tags);
        const userTags = normalizeTags(entry.initialTags);
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
      }
    }

    writeRows(rows);
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
    const defaultName = source ? path.basename(source) : `${(row.name || "角色卡").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.json`;
    const extension = path.extname(defaultName).toLowerCase() || ".json";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出角色卡",
      defaultPath: defaultName,
      filters: [{ name: extension === ".json" ? "JSON 卡片" : "图片卡片", extensions: [extension.replace(".", "")] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      if (source) fs.copyFileSync(source, result.filePath);
      else fs.writeFileSync(result.filePath, buildCardJson(row), "utf8");
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle("cards:exportMany", async (_event, ids) => {
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    const rows = readRows().filter((row) => idSet.has(row.id));
    if (!rows.length) return { ok: false, error: "没有可导出的角色卡" };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择导出位置",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, canceled: true };
    const targetDir = result.filePaths[0];
    let exported = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const source = findCardSource(row);
        const fileName = source
          ? path.basename(source)
          : `${(row.name || row.fileName || "角色卡").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.json`;
        const target = uniqueTargetPath(targetDir, fileName);
        if (source) fs.copyFileSync(source, target);
        else fs.writeFileSync(target, buildCardJson(row), "utf8");
        exported += 1;
      } catch {
        failed += 1;
      }
    }
    return { ok: true, exported, failed, dir: targetDir };
  });

  ipcMain.handle("settings:get", () => {
    const detected = detectTavernDir();
    return {
      sillyTavernDir: detected.configured ? detected.dir : "",
      detectedDir: detected.dir,
      dirExists: detected.exists,
      appVersion: app.getVersion(),
      isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    };
  });

  ipcMain.handle("settings:set", (_event, patch) => {
    const dir = typeof patch?.sillyTavernDir === "string" ? patch.sillyTavernDir.trim().replace(/\\+$/, "") : "";
    if (dir && !fs.existsSync(dir)) return { ok: false, error: "目录不存在" };
    const settings = readSettings();
    writeSettings({ ...settings, sillyTavernDir: dir });
    const detected = detectTavernDir();
    tavernState = { ...tavernState, detail: `等待启动 ${detected.dir}` };
    return { ok: true, sillyTavernDir: detected.dir, dirExists: detected.exists };
  });

  ipcMain.handle("settings:pickDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
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
    return { ok: Boolean(name), name };
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
}

function createWindow() {
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
  mainWindow.on("closed", () => { mainWindow = null; });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    tavernState = { ...tavernState, detail: `等待启动 ${detectTavernDir().dir}` };
    registerIpcHandlers();
    createWindow();
    setupAutoUpdater();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on("window-all-closed", () => app.quit());
}
