#!/usr/bin/env node
/* Трассы гонок Флейм-Сити — один источник для клиента и сервера: client/tracks.json.
 *
 * Клиент рисует чекпоинты и ведёт гонку (fmodes.js), сервер fcg засчитывает время ТОЛЬКО по своему потоку позиций
 * (modes.py) — поэтому координаты обязаны совпадать байт в байт. Трассы строятся по дорогам плана города: опорные
 * точки → ближайшие перекрёстки → маршрут по графу улиц (FC.map.roadRoute) → чекпоинты на углах и через ~170 м.
 * План детерминирован (сид в fmap.js), но если сетку улиц поменяют — перегенерировать и выложить оба: сайт и fcg.
 *
 *   node tools/gen_tracks.cjs            — записать tracks.json
 *   node tools/gen_tracks.cjs --check    — сверить, что файл не отстал от плана (код 1 — отстал)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "client");
const OUT = path.join(SITE, "tracks.json");

const win = { addEventListener() {}, localStorage: { getItem() { return null; }, setItem() {} }, matchMedia() { return { matches: true }; }, console };
const ctx = { window: win, document: { addEventListener() {}, hidden: false }, navigator: { userAgent: "node", maxTouchPoints: 0 },
  location: { search: "", hash: "", origin: "http://localhost", pathname: "/", hostname: "localhost" }, RegExp,
  Math, JSON, Date, Set, Map, Object, Array, String, Number, console };
win.window = win;
vm.createContext(ctx);
for (const f of ["data/zones.js", "fcore.js", "fmap.js"]) {
  vm.runInContext(fs.readFileSync(path.join(SITE, f), "utf8"), ctx, { filename: f });
}
const M = win.FC.map;

// Опорные точки трасс (м). Маршрут между ними — по улицам. loop — круг (финиш = старт).
const DEF = [
  { id: "embank", name: "Набережная", emoji: "🌊", d: "msk", pts: [[-860, -300], [-600, -380], [-400, -260], [-290, -110], [-260, 90], [-320, 330], [-430, 520]] },
  { id: "center", name: "Кольцо Огонька", emoji: "🔥", d: "center", loop: true, pts: [[230, 230], [230, -230], [-230, -230], [-230, 230]] },
  { id: "siti", name: "Спринт Москва-Сити", emoji: "🏙️", d: "msk", pts: [[-120, -120], [-480, -480], [-780, -700], [-1050, -1050]] },
  { id: "minsk", name: "Проспект Независимости", emoji: "🛣️", d: "minsk", pts: [[-120, 260], [-120, 700], [-60, 1060], [300, 1060]] },
  { id: "lake", name: "Озёрная петля", emoji: "🦢", d: "minsk", loop: true, pts: [[60, 470], [400, 470], [400, 820], [60, 820]] },
  { id: "serp", name: "Серпантин к горам", emoji: "⛰️", d: "ala", pts: [[300, -80], [720, -80], [720, -300], [420, -300], [420, -560], [900, -560], [900, -820], [1100, -1100]] },
  { id: "bridges", name: "Пять мостов", emoji: "🌉", d: "msk", pts: [[-560, -220], [-150, -200], [-150, 140], [-560, 160], [-600, 420], [-200, 460]] },
  { id: "beach", name: "Пляжное шоссе", emoji: "🏖️", d: "minsk", pts: [[-1100, 1100], [1100, 1100]] },
  { id: "three", name: "Три города", emoji: "🏆", d: "center", loop: true, pts: [[40, 40], [-480, -480], [620, -290], [-120, 670]] },
  { id: "ring", name: "Большое кольцо", emoji: "💍", d: "center", loop: true, pts: [[-1100, -1100], [1100, -1100], [1100, 1100], [-1100, 1100]] }
];

function routeOf(def) {
  const pts = def.loop ? def.pts.concat([def.pts[0]]) : def.pts;
  let nodes = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = M.roadRoute(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (nodes.length && seg.length && nodes[nodes.length - 1].n === seg[0].n) seg.shift();
    nodes = nodes.concat(seg);
  }
  return nodes;
}
function checkpoints(nodes) {
  const out = [[nodes[0].x, nodes[0].z]];
  let since = 0;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i], c = nodes[i + 1];
    since += Math.hypot(b.x - a.x, b.z - a.z);
    const corner = c && ((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) !== 0;
    if (!c || corner || since >= 170) { out.push([b.x, b.z]); since = 0; }
  }
  return out;
}
function length(cps) {
  let L = 0;
  for (let i = 1; i < cps.length; i++) L += Math.hypot(cps[i][0] - cps[i - 1][0], cps[i][1] - cps[i - 1][1]);
  return L;
}

const tracks = DEF.map((d) => {
  const cps = checkpoints(routeOf(d)).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  const len = Math.round(length(cps));
  // «Золото» — средняя 33 м/с (≈120 км/ч с поворотами), «серебро» — 26, «бронза» — 20
  return { id: d.id, name: d.name, emoji: d.emoji, d: d.d, loop: !!d.loop, cps, len,
    medals: [Math.round(len / 33), Math.round(len / 26), Math.round(len / 20)] };
});
for (const t of tracks) {
  for (const [x, z] of t.cps) {
    if (!M.onRoad(x, z)) throw new Error(t.id + ": чекпоинт не на дороге " + x + "," + z);
  }
  if (t.cps.length < 3) throw new Error(t.id + ": мало чекпоинтов");
}
const json = JSON.stringify({ v: 1, r: 16, tracks }, null, 1) + "\n";
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur !== json) { console.error("tracks.json отстал от плана города — node tools/gen_tracks.cjs"); process.exit(1); }
  console.log("tracks.json: совпадает с планом (" + tracks.length + " трасс)");
} else {
  fs.writeFileSync(OUT, json);
  console.log("tracks.json: " + tracks.map((t) => t.id + " " + t.cps.length + " кп " + t.len + " м").join(", "));
}
