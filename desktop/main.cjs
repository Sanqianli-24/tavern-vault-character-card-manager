const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { parseCharacterCardFile } = require("./character-parser.cjs");

const SILLY_TAVERN_DIR = "D:\\SillyTavern";
const ALLOWED_CARD_FIELDS = new Set([
  "name", "rating", "favorite", "tags", "bookshelf", "description", "personality", "scenario",
  "firstMessage", "exampleDialogue", "creatorNotes", "systemPrompt",
  "postHistoryInstructions", "alternateGreetings", "creator", "characterVersion",
]);
const SMOKE_TEST = process.argv.includes("--smoke-test");
let mainWindow = null;
let launchTask = null;
let tavernChild = null;
let tavernState = {
  phase: "idle",
  progress: 0,
  message: "酒馆尚未启动",
  detail: `等待启动 ${SILLY_TAVERN_DIR}`,
  port: 8000,
  logs: [],
};

function libraryFile() {
  return path.join(app.getPath("userData"), "character-library.json");
}

function cardsDirectory() {
  return path.join(app.getPath("userData"), "cards");
}

function readRows() {
  try {
    const rows = JSON.parse(fs.readFileSync(libraryFile(), "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeRows(rows) {
  fs.mkdirSync(path.dirname(libraryFile()), { recursive: true });
  fs.writeFileSync(libraryFile(), JSON.stringify(rows, null, 2), "utf8");
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


function detectTavernPort() {
  try {
    const config = fs.readFileSync(path.join(SILLY_TAVERN_DIR, "config.yaml"), "utf8");
    const match = config.match(/^port:\s*(\d+)\s*$/m);
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
  const logs = [...tavernState.logs];
  if (logLine) logs.push(logLine.trim());
  tavernState = { ...tavernState, ...patch, logs: logs.filter(Boolean).slice(-12) };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("tavern:progress", tavernState);
  }
}

async function launchSillyTavern() {
  const port = detectTavernPort();
  updateTavernState({
    phase: "checking",
    progress: 6,
    message: "正在检查酒馆环境",
    detail: `检查 ${SILLY_TAVERN_DIR}`,
    port,
    logs: [],
  }, "开始检查 SillyTavern 安装目录");

  if (!fs.existsSync(SILLY_TAVERN_DIR)) {
    updateTavernState({ phase: "error", progress: 100, message: "未找到酒馆目录", detail: SILLY_TAVERN_DIR }, "启动失败：目录不存在");
    return;
  }

  const startScript = path.join(SILLY_TAVERN_DIR, "Start.bat");
  if (!fs.existsSync(startScript)) {
    updateTavernState({ phase: "error", progress: 100, message: "未找到酒馆启动脚本", detail: startScript }, "启动失败：Start.bat 不存在");
    return;
  }

  updateTavernState({ progress: 18, message: "安装目录检查完成", detail: `Start.bat · 端口 ${port}` }, `找到酒馆启动脚本：${startScript}`);

  if (await isPortOpen(port)) {
    updateTavernState({ phase: "ready", progress: 100, message: "酒馆已经在运行", detail: `请切换已有页面 · http://127.0.0.1:${port}` }, "检测到现有酒馆服务，不重复打开页面");
    return;
  }

  updateTavernState({ phase: "starting", progress: 28, message: "正在启动酒馆服务", detail: "调用现有 Start.bat，不修改酒馆本体" }, "正在启动 D:\\SillyTavern\\Start.bat");

  let childExited = null;
  try {
    tavernChild = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${startScript} < nul`], {
      cwd: SILLY_TAVERN_DIR,
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

  updateTavernState({ phase: "error", progress: 100, message: "启动等待超时", detail: `端口 ${port} 在 180 秒内没有响应` }, "请检查 D:\\SillyTavern\\sillytavern-error.log");
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
    if (changed) writeRows(cleanedRows);
    return cleanedRows.map(publicCard);
  });

  ipcMain.handle("cards:updateMany", (_event, ids, patch) => {
    const rows = readRows();
    const safePatch = {};
    for (const [key, value] of Object.entries(patch || {})) {
      if (ALLOWED_CARD_FIELDS.has(key)) safePatch[key] = value;
    }
    if (!Object.keys(safePatch).length) return 0;
    const idSet = new Set(ids || []);
    let changed = 0;
    const now = new Date().toISOString();
    for (const row of rows) {
      if (!idSet.has(row.id)) continue;
      row.rating = Number(safePatch.rating ?? row.rating);
      if (typeof safePatch.favorite === "boolean") row.favorite = safePatch.favorite;
      if (typeof safePatch.bookshelf === "string") row.bookshelf = safePatch.bookshelf;
      if (Array.isArray(safePatch.tags) || typeof safePatch.tags === "string") {
        row.tags = normalizeTags(safePatch.tags);
        row.userTags = row.tags;
        row.tagOwnershipMigrated = true;
      }
      if (typeof safePatch.description === "string") row.description = safePatch.description;
      if (typeof safePatch.name === "string") row.name = safePatch.name;
      row.modifiedAt = now;
      changed += 1;
    }
    if (changed) writeRows(rows);
    return changed;
  });

  ipcMain.handle("cards:delete", (_event, ids) => {
    const rows = readRows();
    const idSet = new Set(ids || []);
    const remaining = rows.filter((row) => !idSet.has(row.id));
    const removed = rows.length - remaining.length;
    if (removed) {
      writeRows(remaining);
      for (const row of rows) {
        if (idSet.has(row.id) && row.imagePath) {
          try { fs.rmSync(row.imagePath, { force: true }); } catch {}
          try {
            const cardDir = path.dirname(row.imagePath);
            if (cardDir.startsWith(cardsDirectory()) && fs.existsSync(cardDir)) fs.rmSync(cardDir, { recursive: true, force: true });
          } catch {}
        }
      }
    }
    return removed;
  });

  ipcMain.handle("cards:import", (_event, entries) => {
    const rows = readRows();
    const imported = [];
    fs.mkdirSync(cardsDirectory(), { recursive: true });

    for (const entry of entries) {
      if (!entry.path || !fs.existsSync(entry.path)) continue;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const extension = path.extname(entry.fileName || entry.path).toLowerCase();
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
        name: entry.suggestedName || cardContent?.name?.trim() || path.parse(entry.fileName || entry.path).name,
        fileName: entry.fileName || path.basename(entry.path),
        fileType: entry.fileType || (extension === ".json" ? "application/json" : "image/png"),
        size: Number(entry.size || fs.statSync(entry.path).size),
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
      rows.unshift(row);
      imported.push(publicCard(row));
    }

    writeRows(rows);
    return imported;
  });

  ipcMain.handle("cards:update", (_event, id, patch) => {
    const rows = readRows();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return null;
    const safePatch = {};
    for (const [key, value] of Object.entries(patch || {})) {
      if (ALLOWED_CARD_FIELDS.has(key)) safePatch[key] = value;
    }
    if (Object.prototype.hasOwnProperty.call(safePatch, "tags")) {
      safePatch.tags = normalizeTags(safePatch.tags);
      safePatch.userTags = safePatch.tags;
      safePatch.tagOwnershipMigrated = true;
    }
    if (Object.prototype.hasOwnProperty.call(safePatch, "favorite")) {
      safePatch.favorite = Boolean(safePatch.favorite);
    }
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

  ipcMain.handle("tavern:status", async () => {
    const port = detectTavernPort();
    if (await isPortOpen(port)) {
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
      sandbox: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, "..", "desktop-dist", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    if (SMOKE_TEST) setTimeout(() => app.exit(0), 250);
  });
  mainWindow.webContents.once("did-fail-load", () => {
    if (SMOKE_TEST) app.exit(2);
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
    registerIpcHandlers();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on("window-all-closed", () => app.quit());
}
