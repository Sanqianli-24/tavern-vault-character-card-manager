# 第三方组件声明（Third-Party Notices）

本软件安装包内封装了以下开源组件的副本：

## SillyTavern

- 项目：<https://github.com/SillyTavern/SillyTavern>
- 版本：见 `resources/sillytavern/embedded.json`（构建时固定）
- 许可证：**GNU Affero General Public License v3.0（AGPL-3.0）**
- 随包位置：安装目录 `resources/sillytavern/st/`（完整对应源码，含其原始 `LICENSE` 文件）

依据 AGPL-3.0 的条款，本软件在分发时随安装包提供了 SillyTavern 的完整对应源码；
你也可以随时从上游仓库 <https://github.com/SillyTavern/SillyTavern> 获取同版本源码。

“SillyTavern” 名称及相关商标归其项目所有者所有。本软件为独立的第三方管理与封装工具，
与 SillyTavern 官方项目没有任何隶属或背书关系。SillyTavern 按其原样提供，不附带任何保证。

## Node.js

- 项目：<https://nodejs.org/>
- 版本：见 `resources/sillytavern/embedded.json`（构建时固定）
- 许可证：MIT（含其捆绑的依赖各自的许可，见 `resources/sillytavern/node/LICENSE`）
- 随包位置：安装目录 `resources/sillytavern/node/`
- 用途：仅作为运行内置 SillyTavern 的独立运行时，避免依赖用户机器上安装的 Node 版本。

## 其他

- 本软件自身（角色卡管理器部分）的源码发布于
  <https://github.com/Sanqianli-24/tavern-vault-character-card-manager>。
- Electron、React 等直接依赖的许可证见各自仓库与 `node_modules` 内声明。
