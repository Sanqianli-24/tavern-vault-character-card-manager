// electron-builder 配置已从 package.json 迁出：
// 是否把内置 SillyTavern 打进安装包取决于 resources/sillytavern/embedded.json 是否存在。
//   有内置资源（npm run desktop:pack 先跑 fetch）→ 只出 NSIS 安装包；便携版是自解压格式，
//   每次启动都要解压几百 MB，不适合携带内置酒馆。
//   无内置资源（npm run desktop:pack:lite）→ 沿用旧的 NSIS + 便携双目标，运行时使用外部酒馆目录。
const fs = require("node:fs");
const path = require("node:path");

const hasEmbedded = fs.existsSync(path.join(__dirname, "resources", "sillytavern", "embedded.json"));

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: "cn.sillytavern.characterlibrary",
  productName: "酒馆角色卡库",
  asar: true,
  npmRebuild: false,
  directories: {
    output: "release",
  },
  publish: [
    {
      provider: "github",
      owner: "Sanqianli-24",
      repo: "tavern-vault-character-card-manager",
    },
  ],
  files: [
    "desktop/main.cjs",
    "desktop/preload.cjs",
    "desktop/character-parser.cjs",
    "desktop-dist/**/*",
    "package.json",
  ],
  extraResources: hasEmbedded
    ? [
        {
          from: "resources/sillytavern",
          to: "sillytavern",
        },
      ]
    : [],
  win: {
    icon: "desktop/icon.ico",
    target: hasEmbedded
      ? [
          {
            target: "nsis",
            arch: ["x64"],
          },
        ]
      : [
          {
            target: "nsis",
            arch: ["x64"],
          },
          {
            target: "portable",
            arch: ["x64"],
          },
        ],
  },
  nsis: {
    artifactName: "TavernCardLibrary-Setup-${version}-${arch}.${ext}",
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "酒馆角色卡库",
    installerLanguages: ["zh_CN"],
  },
  portable: {
    artifactName: "TavernCardLibrary-Portable-${version}-${arch}.${ext}",
  },
};

module.exports = config;
