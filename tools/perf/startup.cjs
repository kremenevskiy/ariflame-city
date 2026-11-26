#!/usr/bin/env node
/* Замер запуска: сколько ждать до картинки города и есть ли рывки в первые секунды.
 *
 *   node tools/perf/startup.cjs [адрес] [--phone] [--net 4g|wifi|none] [--warm] [--secs 15] [--cpu 4] [--video ПАПКА]
 *   node tools/perf/startup.cjs https://city.ariflame.com/ --phone --net 4g
 *
 * Что пишет: время до первого кадра заставки, до старта игры (FC.started), до ухода заставки (город на экране), байты и
 * число запросов; после старта N секунд — частота кадров, длинные задачи главного потока (> 50 мс), промежутки между
 * кадрами (худший, 99-й перцентиль, сколько дольше 50 и 100 мс). --warm — второй заход с кэшем браузера.
 * Город — ?city= в адресе (по умолчанию minsk), онлайн выключен (gs=off&mp=off), экраны входа пропущены (pick=0).
 */
const fs = require("fs");
const { chromium } = require("playwright");
/* global window, document, performance, PerformanceObserver, FC, getComputedStyle */
const argv = process.argv.slice(2);
const BASE = argv.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:8080/";
function arg(n, d) { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; }
const PHONE = argv.includes("--phone"), WARM = argv.includes("--warm"), NET = arg("net", "none"), SECS = +arg("secs", 15);
const CITY = arg("city", "minsk"), VIDEO = arg("video", null), EXTRA = arg("qs", ""), CPU = +arg("cpu", 1);
const NETS = { "4g": { latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 }, wifi: { latency: 15, downloadThroughput: 40e6 / 8, uploadThroughput: 10e6 / 8 } };
const DEV = PHONE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

function probe() {
  var S = window.__st = { long: [], frames: [], t0: performance.now(), started: 0, shown: 0, loader: 0 };
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { S.long.push([Math.round(e.startTime), Math.round(e.duration)]); }); }).observe({ type: "longtask", buffered: true }); } catch (e) { /* нет longtask */ }
  var last = 0;
  (function f(t) {
    if (window.FC && FC.started && !S.started) S.started = t;
    var ld = document.getElementById("loader");
    if (S.started && !S.shown && (!ld || ld.classList.contains("done") || getComputedStyle(ld).display === "none" || getComputedStyle(ld).opacity === "0")) S.shown = t;
    if (!S.loader && ld) S.loader = t;
    if (S.started && last) S.frames.push([Math.round(t), +(t - last).toFixed(1)]);
    last = t; window.requestAnimationFrame(f);
  })(0);
}
function pct(a, p) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

async function once(ctx, label) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });   // процессор телефона: в N раз медленнее
  if (NETS[NET]) { await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", Object.assign({ offline: false }, NETS[NET])); }
  let bytes = 0, reqs = 0;
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength || 0; reqs++; });
  if (!NETS[NET]) await cdp.send("Network.enable");
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  const url = new URL(`?city=${CITY}&gs=off&mp=off&pick=0${EXTRA}`, BASE).toString();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__st && window.__st.shown > 0, null, { timeout: 180000, polling: 100 });
  const tShown = Date.now() - t0;
  await page.waitForTimeout(SECS * 1000);
  const r = await page.evaluate(() => { const S = window.__st; return { started: S.started, shown: S.shown, loader: S.loader, long: S.long, frames: S.frames, nav: performance.timing.navigationStart, fcp: (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime }; });
  const after = r.frames.filter((f) => f[0] > r.shown);
  const gaps = after.map((f) => f[1]);
  const longAfter = r.long.filter((l) => l[0] > r.shown);
  const out = {
    label, url, net: NET, phone: PHONE, fcpMs: Math.round(r.fcp || 0), startedMs: Math.round(r.started), cityShownMs: Math.round(r.shown), wallShownMs: tShown,
    mb: +(bytes / 1048576).toFixed(2), requests: reqs,
    fps: +(gaps.length / (SECS)).toFixed(1), worstGap: Math.max(0, ...gaps), p99Gap: pct(gaps, 0.99), gaps50: gaps.filter((g) => g > 50).length, gaps100: gaps.filter((g) => g > 100).length,
    longTasksAfter: longAfter.length, longMsAfter: longAfter.reduce((a, l) => a + l[1], 0), worstLong: Math.max(0, ...longAfter.map((l) => l[1])),
    longTasksBefore: r.long.length - longAfter.length, errors: errs,
  };
  await page.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] });
  const opt = Object.assign({}, DEV);
  if (VIDEO) { fs.mkdirSync(VIDEO, { recursive: true }); opt.recordVideo = { dir: VIDEO, size: PHONE ? { width: 390, height: 844 } : { width: 1280, height: 800 } }; }
  const ctx = await browser.newContext(opt);
  await ctx.addInitScript(probe);
  const res = [await once(ctx, "холодный")];
  if (WARM) res.push(await once(ctx, "повторный"));
  await ctx.close(); await browser.close();
  for (const o of res) console.log(JSON.stringify(o));
})().catch((e) => { console.error(e); process.exit(1); });
