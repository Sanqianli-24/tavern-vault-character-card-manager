#!/usr/bin/env node
// 组装内置 SillyTavern 运行时：
//   resources/sillytavern/st/    固定版本的 SillyTavern 源码（含依赖）
//   resources/sillytavern/node/  独立 Node.js 运行时（避免原生模块与 Electron ABI 不匹配）
//   resources/sillytavern/embedded.json  版本清单
// 打包时由 electron-builder.config.cjs 以 extraResources 带进安装包。
// 幂等：目标已存在且版本一致时直接跳过，--force 强制重建。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ST_VERSION = "1.19.0";
const NODE_VERSION = "22.23.3";
const ST_ZIP_URL = `https://github.com/SillyTavern/SillyTavern/archive/refs/tags/${ST_VERSION}.zip`;
const NODE_ZIP_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesDir = path.join(root, "resources");
const embeddedDir = path.join(resourcesDir, "sillytavern");
const workDir = path.join(resourcesDir, ".st-build");
const force = process.argv.includes("--force");

function log(message) {
  process.stdout.write(`[fetch-st] ${message}\n`);
}

function dirSize(dir) {
  let total = 0;
  let files = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        total += fs.statSync(full).size;
        files += 1;
      }
    }
  };
  walk(dir);
  return { total, files };
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function download(url, target) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`下载失败 ${response.status} ${url}`);
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  const stream = fs.createWriteStream(target);
  const readable = response.body;
  if (!readable) throw new Error(`下载失败：无响应体 ${url}`);
  const reader = readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    stream.write(Buffer.from(value));
    if (total) process.stdout.write(`\r[fetch-st] 下载中 ${mb(received)} / ${mb(total)}   `);
  }
  await new Promise((resolve) => stream.end(resolve));
  if (total) process.stdout.write("\n");
  log(`下载完成 ${path.basename(target)}（${mb(received)}）`);
}

function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // Windows 10+ 自带 bsdtar，能直接解 zip 且比 PowerShell Expand-Archive 快得多
  const tar = spawnSync("tar", ["-xf", zip, "-C", dest], { stdio: "pipe", shell: false });
  if (tar.status === 0) return;
  const ps = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`],
    { stdio: "pipe", shell: false },
  );
  if (ps.status !== 0) {
    throw new Error(`解压失败：${path.basename(zip)}\n${tar.stderr?.toString() || ps.stderr?.toString() || ""}`);
  }
}

function singleTopLevelDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.name !== "__MACOSX");
  if (entries.length !== 1 || !entries[0].isDirectory()) {
    throw new Error(`解压结果不符合单一顶层目录的预期：${dir}`);
  }
  return path.join(dir, entries[0].name);
}

function rmSyncSafe(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function moveTree(from, to) {
  rmSyncSafe(to);
  fs.renameSync(from, to);
}

const manifestPath = path.join(embeddedDir, "embedded.json");
if (
  !force
  && fs.existsSync(manifestPath)
  && fs.existsSync(path.join(embeddedDir, "st", "node_modules"))
  && fs.existsSync(path.join(embeddedDir, "node", "node.exe"))
) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.stVersion === ST_VERSION && manifest.nodeVersion === NODE_VERSION) {
    log(`内置酒馆已就绪（SillyTavern ${ST_VERSION} · Node v${NODE_VERSION}），跳过。如需重建请加 --force`);
    process.exit(0);
  }
}

log(`开始组装内置 SillyTavern ${ST_VERSION} + Node v${NODE_VERSION}`);
fs.mkdirSync(workDir, { recursive: true });

const stZip = path.join(workDir, `sillytavern-${ST_VERSION}.zip`);
const nodeZip = path.join(workDir, `node-v${NODE_VERSION}-win-x64.zip`);
if (!fs.existsSync(stZip)) await download(ST_ZIP_URL, stZip);
if (!fs.existsSync(nodeZip)) await download(NODE_ZIP_URL, nodeZip);

log("解压 SillyTavern 源码…");
rmSyncSafe(path.join(workDir, "st-extract"));
fs.mkdirSync(path.join(workDir, "st-extract"), { recursive: true });
extractZip(stZip, path.join(workDir, "st-extract"));
const stSource = singleTopLevelDir(path.join(workDir, "st-extract"));

log("解压 Node 运行时…");
rmSyncSafe(path.join(workDir, "node-extract"));
fs.mkdirSync(path.join(workDir, "node-extract"), { recursive: true });
extractZip(nodeZip, path.join(workDir, "node-extract"));
const nodeRuntime = singleTopLevelDir(path.join(workDir, "node-extract"));

fs.mkdirSync(embeddedDir, { recursive: true });
moveTree(stSource, path.join(embeddedDir, "st"));
moveTree(nodeRuntime, path.join(embeddedDir, "node"));

// .zip 里没有 .git，但防御性清掉，避免目录被误当成 git 工作区
rmSyncSafe(path.join(embeddedDir, "st", ".git"));

const nodeExe = path.join(embeddedDir, "node", "node.exe");
const npmCli = path.join(embeddedDir, "node", "node_modules", "npm", "bin", "npm-cli.js");
const stDir = path.join(embeddedDir, "st");

log("安装 SillyTavern 依赖（npm ci --omit=dev，预编译二进制随包带走）…");
// 直接用下载的 node 执行 npm-cli.js：不依赖系统 Node/.cmd，且原生模块预编译与该运行时 ABI 一致
const env = { ...process.env, PATH: `${path.join(embeddedDir, "node")};${process.env.PATH ?? ""}` };
let install = spawnSync(nodeExe, [npmCli, "ci", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], {
  cwd: stDir,
  env,
  stdio: "inherit",
});
if (install.status !== 0) {
  log("npm ci 失败，回退 npm install…");
  install = spawnSync(nodeExe, [npmCli, "install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: stDir,
    env,
    stdio: "inherit",
  });
  if (install.status !== 0) {
    throw new Error("SillyTavern 依赖安装失败（若为网络问题请重试；若为编译失败请确认可用网络下载预编译二进制）");
  }
}

fs.writeFileSync(
  manifestPath,
  `${JSON.stringify({ stVersion: ST_VERSION, nodeVersion: NODE_VERSION, createdAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8",
);

rmSyncSafe(workDir);

const stSize = dirSize(path.join(embeddedDir, "st"));
const nodeSize = dirSize(path.join(embeddedDir, "node"));
log(`完成：st ${mb(stSize.total)} / ${stSize.files} 个文件 · node ${mb(nodeSize.total)} / ${nodeSize.files} 个文件`);
log("已在 resources/sillytavern 就绪，npm run desktop:pack 将把它打进安装包");
