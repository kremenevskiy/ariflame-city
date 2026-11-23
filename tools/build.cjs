#!/usr/bin/env node
/* Сборка для выкладки (необязательно): client/ → dist/, модули f*.js и data/*.js ужаты esbuild по одному (без склейки:
 * порядок и синхронная загрузка остаются как в index.html). config.js не трогаем — его заменяют при выкладке.
 *   npm run build        → dist/
 */
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const SRC = path.resolve(__dirname, "..", "client");
const OUT = path.resolve(__dirname, "..", "dist");
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true, filter: (p) => !p.endsWith(".DS_Store") });

let before = 0, after = 0, n = 0;
function squeeze(file) {
  const src = fs.readFileSync(file, "utf8");
  const r = esbuild.transformSync(src, { loader: "js", minify: true, target: "es2017", legalComments: "inline" });
  fs.writeFileSync(file, r.code);
  before += src.length; after += r.code.length; n++;
}
for (const f of fs.readdirSync(OUT)) if (/^f[a-z0-9]+\.js$/.test(f)) squeeze(path.join(OUT, f));
for (const f of fs.readdirSync(path.join(OUT, "data"))) if (f.endsWith(".js")) squeeze(path.join(OUT, "data", f));
console.log(`dist/: ${n} модулей, ${(before / 1024).toFixed(0)} → ${(after / 1024).toFixed(0)} КБ`);
// страница «Статус города» (status.html): лента изменений по дням из git — свежее (проверки, PR, идеи) она берёт с GitHub сама
try { require("child_process").execFileSync(process.execPath, [path.join(__dirname, "status", "build-status.cjs"), path.join(OUT, "status.json")], { stdio: "inherit" }); }
catch (e) { console.warn("status.json не собран:", e.message); }
