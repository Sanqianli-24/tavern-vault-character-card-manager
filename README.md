# 酒馆角色卡库（Tavern Card Library）

中文 SillyTavern 角色卡管理器与一键启动器。从 0.7.0 起，**SillyTavern 本体直接封装在
完整安装版里**：无需单独安装酒馆、Git 或 Node，点一下"启动酒馆"即可在应用内使用。

功能一览：

- 内置酒馆：自带固定版本的 SillyTavern + 独立 Node 运行时，**双击打开应用直接进入
  酒馆界面**（启动间隙显示进度过渡页；首次使用先复制文件到用户目录，仅一次）。
  酒馆以子进程方式运行，只监听 127.0.0.1，随应用退出自动回收。
- 角色卡库：从酒馆窗口"角色卡库"菜单进入——导入 PNG / WEBP / JSON（V2 与
  V3/ccv3 规范）、书架、评分、收藏、标签批量管理、详情补读与导出。
- 外部酒馆：沿用旧版方式，自动探测 / 手动指定安装目录，调用已有 `Start.bat`。
  两种模式在"设置 → 酒馆运行方式"随时切换，数据互不影响。
- 卡库自动备份（最多 5 份）与一键恢复；安装版支持在线自动更新。

## 发行包

| 包 | 内容 | 适用 |
| --- | --- | --- |
| `TavernCardLibrary-Setup-<版本>-x64.exe` | 完整版，内置 SillyTavern（安装后约多占 400MB 磁盘） | 没装过酒馆、想开箱即用 |
| `TavernCardLibrary-Portable-<版本>-x64.exe` | 精简版，不含内置酒馆 | 已有酒馆安装、要便携使用 |

便携版是自解压格式，每次启动都要解压资源，不适合携带几百 MB 的内置酒馆，因此
内置版只出 NSIS 安装包；精简构建沿袭旧的 NSIS + 便携双目标。

## 开发

要求 Node.js `>= 22.13`。

```bash
npm install
npm run dev              # Web 版（localhost:3000）
npm run desktop:dev      # 桌面版开发（Electron）
npm run desktop:check    # 渲染端构建 + 主进程语法检查
npm test
```

## 打包

```bash
# 完整版（内置酒馆，仅 NSIS）：
# 先下载固定版本的 SillyTavern 1.19.0 源码与 Node v22.23.3 并安装依赖
# （幂等，产物在 resources/sillytavern，已 gitignore），再打包。
npm run desktop:pack

# 精简版（无内置酒馆，NSIS + 便携）：
npm run desktop:pack:lite

# 只重新组装内置酒馆资源（支持 --force 强制重建）：
npm run fetch:st
```

electron-builder 配置在 `electron-builder.config.cjs`：检测到
`resources/sillytavern/embedded.json` 时自动附带内置资源并只出 NSIS 目标。

### 内置酒馆的运行方式

- 打包资源放在安装目录 `resources/sillytavern/`（`st/` 源码 + `node/` 运行时），
  可能只读；首次启动复制到用户数据目录 `sillytavern/` 作为运行副本。
- 运行副本的 `data/`、`config.yaml`、`secrets.json`、`plugins/` 与第三方扩展目录
  属于用户数据，应用升级时自动保留，其余文件按新版本覆盖。
- 用随包的 `node.exe` 以子进程方式运行 `server.js`（不依赖系统 Node，也避免与
  Electron ABI 相关的原生模块问题）；配置固定 `listen: false`、不自动开浏览器。
- 内置酒馆随应用退出而关闭；外部酒馆仍是独立进程，不受影响。

## 许可与第三方组件

内置的 SillyTavern 以 AGPL-3.0 许可发布，随包提供其完整对应源码；随包的 Node.js
运行时以 MIT 许可发布。详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
本项目与 SillyTavern 官方没有隶属或背书关系。
