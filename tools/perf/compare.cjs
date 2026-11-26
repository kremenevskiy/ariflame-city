#!/usr/bin/env node
/* Таблица «до → после» из двух замеров tools/perf/bench.cjs (markdown).
 *   node tools/perf/compare.cjs /tmp/perf/before /tmp/perf/after [--metric gpuPerSec,jsPerSec,calls,tris]
 * Каждая строка — город / устройство / качество / сцена; в ячейке «было → стало (−N%)».
 */
const fs = require("fs");
const path = require("path");
const argv = process.argv.slice(2);
const [A, B] = argv.filter((a) => !a.startsWith("--"));
const mi = argv.indexOf("--metric");
const METRICS = (mi >= 0 ? argv[mi + 1] : "fps,jsPerSec,gpuPerSec,jsMs,calls,tris,cpuCores").split(",");
const NAMES = { fps: "к/с", jsPerSec: "JS мс/с", gpuPerSec: "GPU мс/с", jsMs: "JS мс/кадр", gpuMs: "GPU мс/кадр", calls: "вызовов", tris: "треуг.", cpuCores: "ядер браузера", gcPerSec: "GC/с", heapMB: "куча МБ" };
function load(d) { return JSON.parse(fs.readFileSync(path.join(d, "bench.json"), "utf8")); }
function key(r, s) { return `${r.case.city} / ${r.case.device} / ${r.case.q} / ${s.scene}`; }
function rows(d) { const m = {}; d.runs.forEach((r) => r.scenes.forEach((s) => { if (!s.error) m[key(r, s)] = s; })); return m; }
const a = rows(load(A)), b = rows(load(B));
function fmt(v, m) { if (v == null) return "—"; if (m === "tris") return Math.round(v / 1000) + "k"; return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); }
const out = ["| сцена | " + METRICS.map((m) => NAMES[m] || m).join(" | ") + " |", "|---|" + METRICS.map(() => "---").join("|") + "|"];
Object.keys(a).forEach((k) => {
  if (!b[k]) return;
  const cells = METRICS.map((m) => {
    const x = a[k][m], y = b[k][m];
    if (x == null || y == null) return fmt(x, m) + " → " + fmt(y, m);
    const pc = x ? Math.round((y - x) / x * 100) : 0;
    return fmt(x, m) + " → " + fmt(y, m) + (m === "fps" ? "" : ` (${pc > 0 ? "+" : ""}${pc}%)`);
  });
  out.push("| " + k + " | " + cells.join(" | ") + " |");
});
console.log(out.join("\n"));
