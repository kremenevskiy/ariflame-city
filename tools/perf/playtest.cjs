#!/usr/bin/env node
/* Прогон-«игра» по Минску (~4 минуты): старт, ходьба и бег, районы, машина, вертолёт, самолёт, метро, вход в здание,
 * ночь с дождём, большая карта, телефон, пауза. На каждом шаге — сколько кадров нарисовано, плавность (промежутки
 * между кадрами: худший, 99-й перцентиль, сколько дольше 50/100 мс), длинные задачи главного потока, вызовы отрисовки,
 * треугольники; ошибки страницы; снимок; по желанию — видео всего прогона.
 *
 *   node tools/perf/playtest.cjs http://127.0.0.1:8080/ --out /tmp/play [--phone] [--cpu 4] [--video] [--qs "&q=high"]
 */
const path = require("path");
const fs = require("fs");
// playwright из репо; на другой машине хватит playwright-core и своего Chrome: CHANNEL=chrome
const { chromium } = (function () { try { return require("playwright"); } catch (e) { return require("playwright-core"); } })();
/* global window, document, performance, PerformanceObserver, FC */
const argv = process.argv.slice(2);
const BASE = argv.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:8080/";
function arg(n, d) { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; }
const OUT = path.resolve(arg("out", "/tmp/fc-play")), PHONE = argv.includes("--phone"), CPU = +arg("cpu", 1), VIDEO = argv.includes("--video");
const EXTRA = arg("qs", "");
fs.mkdirSync(OUT, { recursive: true });
const DEV = PHONE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

function probe() {
  var S = window.__pt = { on: false, gaps: [], last: 0, n: 0, long: [], calls: 0, tris: 0, js: 0 };
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (S.on) S.long.push(Math.round(e.duration)); }); }).observe({ type: "longtask" }); } catch (e) { /* нет */ }
  // считаем кадры, которые игра нарисовала (обёртка FC.gfx.frame), и промежутки между ними
  var hook = setInterval(function () {
    var G = window.FC && FC.gfx; if (!G || !G.frame || G.frame.__pt) return;
    var f = G.frame, R = G.renderer;
    G.frame = function (dt) {
      var c0 = R.info.render.frame, t = performance.now();
      R.info.autoReset = false; R.info.reset();
      f(dt);
      if (R.info.render.calls > 0 && S.on) {
        if (S.last) S.gaps.push(t - S.last);
        S.last = t; S.n++; S.calls += R.info.render.calls; S.tris += R.info.render.triangles; S.js += FC.loopMs || 0;
      }
      void c0;
    };
    G.frame.__pt = 1; clearInterval(hook);
  }, 20);
  S.begin = function () { S.on = true; S.gaps = []; S.last = 0; S.n = 0; S.long = []; S.calls = 0; S.tris = 0; S.js = 0; S.t0 = performance.now(); };
  S.end = function () {
    S.on = false; var g = S.gaps.slice().sort(function (a, b) { return a - b; }), secs = (performance.now() - S.t0) / 1000;
    var p = function (q) { return g.length ? +g[Math.min(g.length - 1, Math.floor(g.length * q))].toFixed(1) : null; };
    return { secs: +secs.toFixed(1), fps: +(S.n / secs).toFixed(1), worst: g.length ? +g[g.length - 1].toFixed(1) : null, p99: p(0.99), p50: p(0.5),
      gaps50: g.filter(function (x) { return x > 50; }).length, gaps100: g.filter(function (x) { return x > 100; }).length,
      long: S.long.length, longMs: S.long.reduce(function (a, b) { return a + b; }, 0), worstLong: Math.max.apply(null, [0].concat(S.long)),
      calls: Math.round(S.calls / Math.max(1, S.n)), ktris: Math.round(S.tris / Math.max(1, S.n) / 1000), jsMs: +(S.js / Math.max(1, S.n)).toFixed(2),
      mode: FC.player && FC.player.mode, inside: !!(FC.inside && FC.inside.active), metro: !!(FC.metro && FC.metro.active),
      pos: FC.player ? [Math.round(FC.player.x), Math.round(FC.player.z), Math.round(FC.player.y || 0)] : null,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.CHANNEL || undefined, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] });
  const opt = Object.assign({}, DEV);
  if (VIDEO) opt.recordVideo = { dir: OUT, size: PHONE ? { width: 390, height: 844 } : { width: 1280, height: 800 } };
  const ctx = await browser.newContext(opt);
  await ctx.addInitScript(probe);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 160) + " @ " + String(e.stack || "").split("\n").slice(1, 3).map((x) => x.trim()).join(" < ")));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  const t0 = Date.now();
  await page.goto(new URL(`?city=minsk&gs=off&mp=off&pick=0${EXTRA}`, BASE).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FC && FC.started, null, { timeout: 180000 });
  const startSecs = (Date.now() - t0) / 1000;
  const steps = [];
  const ev = (fn, a) => page.evaluate(fn, a).catch((e) => ({ err: String(e).slice(0, 160) }));
  async function step(name, secs, act, during, a) {
    if (act) { const r = await ev(act, a); if (r && r.err) errs.push(name + ": " + r.err); }
    await ev(() => window.__pt.begin());
    if (during) await during(); else await sleep(secs * 1000);
    const r = await ev(() => window.__pt.end());
    r.step = name; steps.push(r);
    await page.screenshot({ path: path.join(OUT, `${String(steps.length).padStart(2, "0")}-${name}.jpg`), type: "jpeg", quality: 70 });
    console.log(`${name.padEnd(16)} ${r.fps} к/с · худший ${r.worst} мс · p99 ${r.p99} · >50мс ${r.gaps50} · >100мс ${r.gaps100} · долгих задач ${r.long} (${r.longMs} мс) · ${r.calls} выз · ${r.ktris}k тр · JS ${r.jsMs} мс · ${r.mode}${r.inside ? " внутри" : ""}${r.metro ? " метро" : ""}`);
  }
  const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of keys) await page.keyboard.up(k); };
  await ev(() => { FC.setHour(13); FC.gfx.calm(3600); FC.money(5000, "debug"); });
  await step("старт", 8);
  await step("ходьба", 6, null, () => hold(["KeyW"], 6000));
  await step("бег", 6, null, () => hold(["KeyW", "ShiftLeft"], 6000));
  const D = [["Немига", -2126, -164], ["Маяк-Минска", 4795, -3389], ["Минск-Мир", -2372, 3865], ["Уручье", 7078, -5016], ["Минск-Арена", -6453, -3985], ["Комаровка", -173, -2187]];
  for (const d of D) {
    await step(d[0], 7, (a) => { FC.player.teleport(a[1], a[2], 1.0); }, async () => { await sleep(2000); await hold(["KeyW"], 5000); }, d);
    steps[steps.length - 1].note = "перенос + 5 с ходьбы";
  }
  // машина по проспекту
  await step("машина", 16, () => { FC.player.teleport(-1226, -306, 2.2); const c = FC.cars.spawn("sedan", FC.player.x + 2, FC.player.z, 2.2, {}); FC.cars.enter(c); }, async () => {
    await sleep(800); await page.keyboard.down("KeyW");
    for (let i = 0; i < 6; i++) { await sleep(1800); await hold([i % 2 ? "KeyA" : "KeyD"], 500); }
    await page.keyboard.up("KeyW");
  });
  // вертолёт
  await step("вертолёт", 16, () => { if (FC.player.mode === "car") FC.cars.exit(true); const A = FC.air.spawn("heli_light", FC.player.x + 6, FC.player.z + 6, 0); FC.air.enter(A); }, async () => {
    await sleep(800); await hold(["Space"], 6000); await hold(["KeyW", "Space"], 2000); await hold(["KeyW"], 7000);
  });
  // самолёт
  await step("самолёт", 14, () => { FC.air.exit(true); FC.player.teleport(-1226, -306, 2.2); const A = FC.air.spawn("plane_prop", FC.player.x + 8, FC.player.z, 2.2); FC.air.enter(A); }, async () => {
    await sleep(800); await hold(["KeyW"], 6000); await hold(["KeyW", "Space"], 7000);
  });
  // метро: спуститься на ближайшей открытой станции и проехать
  await step("метро", 20, () => {
    FC.air.exit(true); if (FC.player.mode !== "foot") return { err: "не пешком: " + FC.player.mode };
    const names = Object.keys(FC.metro.stations || {}); const st = FC.metro.stations[names[0]];
    if (!st) return { err: "нет станций" };
    FC.player.teleport(st.x, st.z, 0); setTimeout(function () { FC.metro.enter({ name: st.name }); }, 1500);
  }, async () => { await sleep(20000); });
  // в здании
  await step("в-здании", 12, () => {
    if (FC.metro && FC.metro.active && FC.metro.leave) FC.metro.leave();
    FC.player.teleport(-1226, -306, 2.2);
    setTimeout(function () {
      // как игра: дом с дверями рядом (FC.map.near), встать у двери, «Войти»
      const P = FC.player, B = FC.map.near(P.x, P.z, 150).filter(function (b) { return !b.prop && b.doors && b.doors.length; })[0];
      if (!B) return;
      P.teleport(B.doors[0].x, B.doors[0].z);
      setTimeout(function () { FC.inside.enter(B, 0); }, 600);
    }, 2500);
  }, async () => { await sleep(4000); await hold(["KeyW"], 3000); await hold(["KeyD"], 1000); await sleep(4000); });
  await step("ночь-дождь", 10, () => { if (FC.inside && FC.inside.active) FC.inside.exit(); FC.player.teleport(-2159, 488, 1.0); FC.setHour(22.5); FC.gfx.weather.target = 1; FC.gfx.weather.rain = 1; }, async () => { await sleep(2500); await hold(["KeyW", "ShiftLeft"], 7500); });
  await step("карта", 5, () => { FC.setHour(13); FC.gfx.calm(3600); FC.hud.openMap(); });
  await step("телефон", 5, () => { const bm = document.getElementById("bigmap"); if (bm) bm.classList.remove("on"); FC.gfx.hold && FC.gfx.hold("map", false); FC.input.enable(true); document.querySelector(".phone") && document.querySelector(".phone").classList.add("on"); });
  await step("пауза", 5, () => { const ph = document.querySelector(".phone"); if (ph) ph.classList.remove("on"); FC.hud.pause(true); });
  await ev(() => FC.hud.pause(false));
  const total = { url: BASE, phone: PHONE, cpu: CPU, startSecs, errors: errs, steps };
  fs.writeFileSync(path.join(OUT, "playtest.json"), JSON.stringify(total, null, 1));
  console.log(`старт ${startSecs.toFixed(1)} с · ошибок ${errs.length}${errs.length ? ": " + errs.slice(0, 5).join(" | ") : ""}`);
  await ctx.close(); await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
