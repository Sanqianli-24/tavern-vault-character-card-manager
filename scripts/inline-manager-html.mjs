#!/usr/bin/env node
// 把 desktop-dist 构建产物内联成单文件 manager.html，供酒馆页面的
// 「完整卡库管理」覆盖层 iframe 使用（srcdoc）。IPC 通过 postMessage
// 桥接到宿主页面的 window.desktopAPI（shim 一并注入）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "desktop-dist");
const outFile = path.join(root, "desktop", "st-extension", "tavern-vault", "manager.html");

const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");

function inlineTag(match, attrName, tagName) {
  const src = (match.match(new RegExp(`${attrName}="([^"]+)"`)) || [])[1];
  if (!src) return match;
  const assetPath = path.join(distDir, src);
  if (!fs.existsSync(assetPath)) return match;
  const content = fs.readFileSync(assetPath, "utf8");
  if (tagName === "script") return `<script type="module">\n${content}\n</script>`;
  return `<style>\n${content}\n</style>`;
}

let out = html
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, (m) => inlineTag(m, "src", "script"))
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, (m) => inlineTag(m, "href", "link"))
  // 覆盖层里不需要（也不能要）这个针对独立窗口的 CSP
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/g, "");

const shim = `
<script>
(function () {
  if (window.desktopAPI) return; // 独立卡库窗口场景，真实 API 已由 preload 注入
  var pending = new Map();
  var seq = 0;
  var events = {};
  window.addEventListener('message', function (event) {
    var d = event.data;
    if (!d) return;
    if (d.__tv === 'event') {
      (events[d.method] || []).forEach(function (fn) { fn(d.payload); });
      return;
    }
    if (d.__tv !== 'resp') return;
    var entry = pending.get(d.id);
    if (!entry) return;
    pending.delete(d.id);
    if (d.ok) entry.resolve(d.result); else entry.reject(new Error(d.error || 'IPC 调用失败'));
  });
  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      parent.postMessage({ __tv: 'call', id: id, method: method, args: args }, '*');
    });
  }
  window.desktopAPI = new Proxy({ isDesktop: true }, {
    get: function (target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop.indexOf('on') === 0) {
        return function (callback) {
          (events[prop] = events[prop] || []).push(callback);
          return function () {};
        };
      }
      return function () { return call(prop, Array.prototype.slice.call(arguments)); };
    },
  });
})();
</script>
`;

// shim 必须先于主 bundle 执行
out = out.replace("<body>", `<body>\n${shim}`);
out = out.replace("<title>酒馆角色卡库</title>", "<title>角色卡库 · 完整管理</title>");

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out, "utf8");
console.log(`[inline-manager] ${outFile} (${(out.length / 1024).toFixed(0)} KB)`);
