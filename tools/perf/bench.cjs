#!/usr/bin/env node
/* Замер нагрузки клиента: сколько стоит кадр процессору и видеокарте, сколько вызовов отрисовки, мусора и работы
 * главного потока — на одних и тех же сценах до и после правки.
 *
 *   npm run dev &
 *   node tools/perf/bench.cjs --out /tmp/perf/after                       → http://127.0.0.1:8080/
 *   BASE=http://127.0.0.1:8786/ node tools/perf/bench.cjs --out /tmp/perf/before --label before
 *   node tools/perf/bench.cjs --cities minsk --devices phone --q mid --scenes center,drive --secs 6
 *   node tools/perf/compare.cjs /tmp/perf/before /tmp/perf/after          → таблица «до → после»
 *
 * Сцены: start (сразу после старта), center (центр днём, стоим), drive (едем по проспекту 25 м/с), night (22:00),
 * rain (дождь днём), map (большая карта открыта), pause (пауза). Устройства: desktop 1440×900 ×2, phone 390×844 ×3
 * (тач, user agent iPhone). Качество: auto (как у игрока — без ?q=), low, mid, high.
 *
 * Метрики (на сцену): к/с; JS кадра (сумма обработчиков requestAnimationFrame); кадр главного потока (от первого
 * обработчика до следующей задачи — с пересчётом стилей и раскладкой); GPU мс на кадр (EXT_disjoint_timer_query_webgl2);
 * renderer.info за кадр целиком (вызовы, треугольники — и для свечения, и для теней); программы, геометрии, текстуры;
 * буфер отрисовки; куча JS, сборки мусора (трейс), занятость главного потока (CDP Performance.getMetrics: TaskDuration);
 * процессорное время всех процессов браузера (ps), загрузка видеокарты по ioreg (вся система — шумно).
 * --unlimited — без vsync и ограничения частоты: показывает запас (сколько кадров в секунду смогло бы быть).
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
/* global window, FC, document, performance, HTMLCanvasElement, MessageChannel */

const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : def; }
const BASE = new URL(process.env.BASE || "http://127.0.0.1:8080/");
const OUT = path.resolve(arg("out", path.join(os.tmpdir(), "fc-perf")));
const LABEL = arg("label", path.basename(OUT));
const CITIES = arg("cities", "minsk,flame").split(",");
const DEVICES = arg("devices", "desktop,phone").split(",");
const QS = arg("q", "auto").split(",");
const SCENES = arg("scenes", "start,center,drive,night,rain,map,pause").split(",");
const SECS = +arg("secs", 8);
const UNLIMITED = argv.includes("--unlimited");
const HEADED = argv.includes("--headed");
const EXTRA = arg("qs", "");
const SHOTS = argv.includes("--shots");
fs.mkdirSync(OUT, { recursive: true });

const DEV = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" },
};

/* В страницу до её скриптов: часы кадра, GPU-таймер, renderer.info за кадр целиком. */
function instrument() {
  var S = window.__perf = { on: false, frames: 0, ticks: 0, js: 0, jsAll: 0, jsMax: 0, main: 0, mainArr: [], jsArr: [], gpuArr: [], gpuAll: 0, calls: 0, tris: 0,
    t0: 0, t1: 0, gpuOk: false, gpuDisjoint: 0, rafCbs: 0 };
  var gl = null, ext = null, pend = [], curQ = null, frameT = -1, frameStart = 0, jsFrame = 0;
  var og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var c = og.apply(this, arguments);
    if (c && type === "webgl2" && this.id === "cv" && !gl) { gl = c; ext = c.getExtension("EXT_disjoint_timer_query_webgl2"); S.gpuOk = !!ext; }
    return c;
  };
  var mc = new MessageChannel();
  mc.port1.onmessage = endFrame;
  function poll() {
    if (!gl || !ext) return;
    var dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pend.length) {
      var q = pend[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      var ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      pend.shift(); gl.deleteQuery(q);
      if (dis) { S.gpuDisjoint++; continue; }
      if (S.on && q.__on) { S.gpuAll += ns / 1e6; if (q.__r) S.gpuArr.push(ns / 1e6); }
    }
  }
  function info() { return window.FC && FC.gfx && FC.gfx.renderer && FC.gfx.renderer.info; }
  function endFrame() {
    if (frameT < 0) return;
    var now = performance.now();
    var I = info();
    // кадр отрисован, если были вызовы отрисовки (ограничитель частоты и удержание пропускают кадры экрана целиком)
    var drawn = !!(I && I.render.calls > 0);
    if (curQ) { gl.endQuery(ext.TIME_ELAPSED_EXT); curQ.__r = drawn; pend.push(curQ); curQ = null; }
    if (S.on) {
      S.ticks++; S.jsAll += jsFrame;
      if (drawn) {
        S.frames++; S.js += jsFrame; if (jsFrame > S.jsMax) S.jsMax = jsFrame; S.jsArr.push(jsFrame);
        S.main += now - frameStart; S.mainArr.push(now - frameStart);
        S.calls += I.render.calls; S.tris += I.render.triangles;
      }
    }
    frameT = -1;
  }
  var oraf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return oraf(function (t) {
      if (t !== frameT) {
        if (frameT >= 0) endFrame();
        frameT = t; frameStart = performance.now(); jsFrame = 0;
        poll();
        var I = info();
        if (I) { I.autoReset = false; I.reset(); }
        if (gl && ext && !curQ) { curQ = gl.createQuery(); curQ.__on = S.on; gl.beginQuery(ext.TIME_ELAPSED_EXT, curQ); }
        mc.port2.postMessage(0);
      }
      var s = performance.now();
      try { cb(t); } finally { jsFrame += performance.now() - s; S.rafCbs++; }
    });
  };
  S.start = function () { S.on = true; S.frames = 0; S.ticks = 0; S.jsAll = 0; S.gpuAll = 0; S.js = 0; S.jsMax = 0; S.main = 0; S.mainArr = []; S.jsArr = []; S.gpuArr = []; S.calls = 0; S.tris = 0; S.gpuDisjoint = 0; S.t0 = performance.now(); };
  S.stop = function () { S.on = false; S.t1 = performance.now(); };
}

function pct(a, p) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function r2(x) { return x == null ? null : Math.round(x * 100) / 100; }

/* процессорное время всех процессов нашего браузера (браузер + GPU + рендерер), секунды */
function cpuSecs(rootPid) {
  if (!rootPid) return null;
  const rows = execSync("ps -A -o pid=,ppid=,time=").toString().trim().split("\n").map((l) => l.trim().split(/\s+/));
  const kids = {}; rows.forEach(([p, pp]) => { (kids[pp] = kids[pp] || []).push(p); });
  const want = new Set([String(rootPid)]); const st = [String(rootPid)];
  while (st.length) { const p = st.pop(); (kids[p] || []).forEach((k) => { if (!want.has(k)) { want.add(k); st.push(k); } }); }
  let tot = 0;
  rows.forEach(([p, , t]) => {
    if (!want.has(p)) return;
    const m = t.split(/[:.]/).map(Number);                // [[d-]hh:]mm:ss.cc
    const parts = t.split(":"); let s = 0;
    for (const x of parts) s = s * 60 + parseFloat(x.replace(/^\d+-/, ""));
    if (!isNaN(s)) tot += s; void m;
  });
  return tot;
}
function gpuUtil() {
  try { const o = execSync("ioreg -r -d 1 -w 0 -c IOAccelerator").toString(); const m = o.match(/"Device Utilization %"=(\d+)/); return m ? +m[1] : null; }
  catch (e) { return null; }
}

/* сцены: подготовка в странице (до замера) */
const PREP = {
  start: null,
  center: (city) => { FC.setHour(13); FC.gfx.calm(3600); const p = city === "minsk" ? [-1226, -306, 2.2] : [40, 40, 0.7]; FC.player.teleport(p[0], p[1], p[2]); },
  night: (city) => { FC.setHour(22); FC.gfx.calm(3600); const p = city === "minsk" ? [-1226, -306, 2.2] : [40, 40, 0.7]; FC.player.teleport(p[0], p[1], p[2]); },
  rain: (city) => { FC.setHour(13); const p = city === "minsk" ? [-1226, -306, 2.2] : [40, 40, 0.7]; FC.player.teleport(p[0], p[1], p[2]); FC.gfx.weather.target = 1; FC.gfx.weather.rain = 1; FC.gfx.weather.wet = 1; },
  map: () => { FC.setHour(13); FC.gfx.calm(3600); FC.hud.openMap(); },
  pause: () => { FC.setHour(13); FC.gfx.calm(3600); FC.hud.pause(true); },
  drive: (city) => {
    FC.setHour(13); FC.gfx.calm(3600);
    let a, b;
    if (city === "minsk") { a = [-1226, -306]; b = [-322, -958]; }
    else { const r = FC.map.HROADS.reduce((m, o) => (Math.abs(o.z) < Math.abs(m.z) ? o : m)); a = [-900, r.z]; b = [900, r.z]; }
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), h = Math.atan2(dx, dz);
    FC.player.teleport(a[0], a[1], h);
    const car = FC.cars.spawn("sedan", FC.player.x, FC.player.z, h, {});
    FC.cars.enter(car);
    // «автопилот»: каждый кадр ставим машину на прямую a→b, 25 м/с — одинаково в обеих сборках
    const t0 = performance.now(); const V = 25;
    FC.addSystem({ name: "bench-drive", order: 99, update: function () {
      const s = Math.min(L - 5, ((performance.now() - t0) / 1000) * V);
      car.x = a[0] + (dx / L) * s; car.z = a[1] + (dz / L) * s; car.heading = h; car.v = V; car.vx = (dx / L) * V; car.vz = (dz / L) * V;
    } });
  },
};

async function scene(page, cdp, browserPid, c, name) {
  if (PREP[name]) await page.evaluate(`(${PREP[name].toString()})(${JSON.stringify(c.city)})`);
  // перенос: подождать, пока куски догрузятся (Минск строит улицы пачками)
  await page.waitForTimeout(name === "start" ? 1000 : name === "drive" ? 1500 : 5000);
  await page.evaluate(() => { const S = window.__perf; S.start(); });
  const m0 = await cdp.send("Performance.getMetrics");
  const cpu0 = cpuSecs(browserPid), w0 = Date.now();
  await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-v8.gc,v8", transferMode: "ReturnAsStream" }).catch(() => {});
  const gu = []; const tick = setInterval(() => { const g = gpuUtil(); if (g != null) gu.push(g); }, 700);
  await page.waitForTimeout(SECS * 1000);
  clearInterval(tick);
  const trace = await stopTrace(cdp);
  const cpu1 = cpuSecs(browserPid), w1 = Date.now();
  const m1 = await cdp.send("Performance.getMetrics");
  const r = await page.evaluate(() => {
    const S = window.__perf; S.stop();
    const g = FC.gfx, R = g.renderer, I = R.info, db = R.getDrawingBufferSize(new window.THREE.Vector2());
    let objs = 0, vis = 0, meshes = 0, inst = 0;
    g.scene.traverse((o) => { objs++; if (o.isMesh || o.isPoints || o.isLine || o.isSprite) { meshes++; if (o.visible) vis++; if (o.isInstancedMesh) inst++; } });
    return {
      frames: S.frames, ticks: S.ticks, jsAll: S.jsAll, gpuAll: S.gpuAll, secs: (S.t1 - S.t0) / 1000, js: S.js, jsMax: S.jsMax, jsArr: S.jsArr, mainArr: S.mainArr, gpuArr: S.gpuArr, gpuOk: S.gpuOk,
      gpuDisjoint: S.gpuDisjoint, calls: S.calls, tris: S.tris,
      programs: I.programs ? I.programs.length : null, geometries: I.memory.geometries, textures: I.memory.textures,
      buffer: [db.x, db.y], dpr: window.devicePixelRatio, ratio: R.getPixelRatio(), q: g.Q.level, shadows: !!(g.Q.shadows && R.shadowMap.enabled),
      heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
      objs, meshes, vis, inst, night: FC.clock.night, rain: g.weather.rain, paused: !!FC.paused,
      pos: [Math.round(FC.player.x), Math.round(FC.player.z)], mode: FC.player.mode,
      dom: document.getElementsByTagName("*").length,
    };
  });
  const met = (m, k) => (m.metrics.find((x) => x.name === k) || {}).value;
  const wall = (w1 - w0) / 1000;
  const gc = gcStats(trace, wall);
  const out = {
    scene: name, fps: r2(r.frames / r.secs), frames: r.frames, vsync: r2(r.ticks / r.secs),
    // работа в секунду — то, что греет: мс JS и мс GPU за секунду (1000 = поток или видеокарта заняты целиком)
    jsPerSec: r2(r.jsAll / r.secs), gpuPerSec: r2(r.gpuAll / r.secs),
    jsMs: r2(r.js / Math.max(1, r.frames)), jsP95: r2(pct(r.jsArr, 0.95)), mainMs: r2(avg(r.mainArr)), mainP95: r2(pct(r.mainArr, 0.95)),
    gpuMs: r2(avg(r.gpuArr)), gpuP95: r2(pct(r.gpuArr, 0.95)), gpuN: r.gpuArr.length, gpuOk: r.gpuOk,
    calls: Math.round(r.calls / Math.max(1, r.frames)), tris: Math.round(r.tris / Math.max(1, r.frames)),
    programs: r.programs, geometries: r.geometries, textures: r.textures, buffer: r.buffer, dpr: r.dpr, ratio: r2(r.ratio), q: r.q, shadows: r.shadows,
    heapMB: r2(r.heap), objs: r.objs, meshes: r.meshes, visMeshes: r.vis, instMeshes: r.inst, dom: r.dom,
    taskBusy: r2((met(m1, "TaskDuration") - met(m0, "TaskDuration")) / wall),          // доля главного потока занята (0..1)
    scriptBusy: r2((met(m1, "ScriptDuration") - met(m0, "ScriptDuration")) / wall),
    cpuCores: cpu0 != null ? r2((cpu1 - cpu0) / wall) : null,                         // ядер браузера в среднем (все процессы)
    gpuUtil: gu.length ? r2(avg(gu)) : null,
    gcPerSec: gc.n, gcMsPerSec: gc.ms, gcMinor: gc.minor, gcMajor: gc.major,
    night: r2(r.night), rain: r2(r.rain), paused: r.paused, pos: r.pos, mode: r.mode,
  };
  return out;
}

async function stopTrace(cdp) {
  try {
    const done = new Promise((res) => cdp.once("Tracing.tracingComplete", res));
    await cdp.send("Tracing.end");
    const { stream } = await done;
    let data = "";
    for (;;) { const ch = await cdp.send("IO.read", { handle: stream }); data += ch.base64Encoded ? Buffer.from(ch.data, "base64").toString() : ch.data; if (ch.eof) break; }
    await cdp.send("IO.close", { handle: stream });
    const j = JSON.parse(data); return Array.isArray(j) ? j : j.traceEvents || [];
  } catch (e) { return []; }
}
function gcStats(ev, wall) {
  let n = 0, ms = 0, minor = 0, major = 0;
  for (const e of ev) {
    if (e.ph !== "X" && e.ph !== "B") continue;
    if (e.name === "MinorGC" || e.name === "MajorGC" || e.name === "V8.GC_MC_BACKGROUND_MARKING") {
      if (e.name === "V8.GC_MC_BACKGROUND_MARKING") continue;
      n++; ms += (e.dur || 0) / 1000; if (e.name === "MinorGC") minor++; else major++;
    }
  }
  return { n: r2(n / wall), ms: r2(ms / wall), minor, major };
}

async function runCase(c) {
  const args = ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--enable-precise-memory-info"];
  if (UNLIMITED) args.push("--disable-gpu-vsync", "--disable-frame-rate-limit");
  const browser = await chromium.launch({ headless: !HEADED, args });
  // pid корня браузера: процесс с нашим профилем playwright
  let pid = null;
  try {
    const ps = execSync("ps -A -o pid=,ppid=,command=").toString().split("\n");
    const mine = ps.filter((l) => /ms-playwright.*(chrome|Chromium|headless_shell)/.test(l) && !/--type=/.test(l)).map((l) => +l.trim().split(/\s+/)[0]);
    pid = mine.sort((a, b) => b - a)[0] || null;    // самый свежий
  } catch (e) { pid = null; }
  const ctx = await browser.newContext(DEV[c.device]);
  await ctx.addInitScript(instrument);
  const page = await ctx.newPage();
  const errs = [], net = { n: 0, bytes: 0 };
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  page.on("response", async (r) => { net.n++; const l = +(r.headers()["content-length"] || 0); net.bytes += l; });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const q = c.q === "auto" ? "" : "&q=" + c.q;
  const url = new URL(`?city=${c.city}&gs=off&mp=off&pick=0${q}${EXTRA}`, BASE).toString();
  const tLoad = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.FC && window.FC.started && window.FC.gfx, null, { timeout: 120000 });
  const startSecs = (Date.now() - tLoad) / 1000;
  await page.waitForTimeout(6000);
  const res = { case: c, url, startSecs: r2(startSecs), gpuOk: null, scenes: [], errs, net };
  for (const s of c.scenes) {
    try {
      const o = await scene(page, cdp, pid, c, s);
      res.scenes.push(o);
      if (SHOTS) await page.screenshot({ path: path.join(OUT, `${c.city}-${c.device}-${c.q}-${s}.jpg`), quality: 70, type: "jpeg" });
      console.log(`${c.city}/${c.device}/q=${c.q}/${s}: ${o.fps} к/с (экран ${o.vsync}) · в секунду JS ${o.jsPerSec} мс, GPU ${o.gpuPerSec} мс · на кадр: JS ${o.jsMs} мс · кадр ${o.mainMs} мс · GPU ${o.gpuMs} мс · вызовов ${o.calls} · тр ${Math.round(o.tris / 1000)}k · ядер ${o.cpuCores} · GC ${o.gcPerSec}/с ${o.gcMsPerSec} мс/с · буфер ${o.buffer.join("×")} ${o.q}`);
      // выйти из сцены: карта/пауза закрыть, машину оставить (следующая сцена переносит пешком)
      await page.evaluate(() => {
        if (FC.paused && FC.hud.pause) FC.hud.pause(false);
        const bm = document.querySelector(".bigmap.on, #bigmap.on"); if (bm) bm.classList.remove("on");
        if (FC.input && FC.input.enable) FC.input.enable(true);
        for (let i = FC.systems.length - 1; i >= 0; i--) if (FC.systems[i].name === "bench-drive") FC.systems.splice(i, 1);
        if (FC.player.mode === "car") FC.cars.exit();
        if (FC.gfx.weather) { FC.gfx.weather.target = 0; FC.gfx.weather.rain = 0; }
      });
    } catch (e) { res.scenes.push({ scene: s, error: String(e).slice(0, 300) }); console.log(`${c.city}/${c.device}/${s}: ОШИБКА ${e}`); }
  }
  res.gpuOk = res.scenes.length ? res.scenes[0].gpuOk : null;
  await browser.close();
  return res;
}

(async () => {
  const all = { label: LABEL, base: BASE.toString(), unlimited: UNLIMITED, at: new Date().toISOString(), runs: [] };
  for (const city of CITIES) for (const device of DEVICES) for (const q of QS) {
    const c = { city, device, q, scenes: SCENES };
    console.log(`\n== ${LABEL}: ${city} ${device} q=${q}`);
    const r = await runCase(c);
    all.runs.push(r);
    fs.writeFileSync(path.join(OUT, "bench.json"), JSON.stringify(all, null, 1));
  }
  console.log("\n→ " + path.join(OUT, "bench.json"));
})().catch((e) => { console.error(e); process.exit(1); });
