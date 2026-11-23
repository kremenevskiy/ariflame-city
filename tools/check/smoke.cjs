#!/usr/bin/env node
/* Headless-проверка клиента: оба города стартуют без ошибок консоли и без запросов за пределы своего адреса.
 *
 *   npm run dev &                      (и, по желанию, игровой сервер — server/README.md)
 *   npm run check                      → http://localhost:8080/
 *   BASE=http://localhost:3000/ node tools/check/smoke.cjs --shots docs/img --phone
 *
 * Для каждого города: ждёт FC.started и FC.me (вход гостем), шлёт в лог игрока, онлайн и число запросов; падает, если
 * были ошибки консоли/страницы или запрос ушёл на чужой адрес. --shots <папка> — снимки экрана; --phone — ещё и
 * телефон 390×844 (тач). Рендер — программный (swiftshader), поэтому FPS здесь не показатель.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
/* global window, FC -- код page.evaluate выполняется в браузере */

const args = process.argv.slice(2);
const BASE = new URL(process.env.BASE || "http://127.0.0.1:8080/");
const SHOTS = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : null;
const PHONE = args.includes("--phone");
const EXTRA = process.env.QS || "";                   // доп. параметры адреса, например "&mp=off"

const CASES = [
  { name: "flame", qs: "?city=flame&q=mid" },
  { name: "minsk", qs: "?city=minsk&q=mid&pick=0" },                // pick=0 — без экрана «Где начнёшь?» (FC.places)
];
if (PHONE) CASES.push({ name: "phone-minsk", qs: "?city=minsk&q=low&pick=0", phone: true });

async function one(browser, c) {
  const ctx = await browser.newContext(c.phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [], foreign = [], reqs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("request", (r) => {
    const u = r.url();
    reqs.push(u);
    if (/^(data|blob):/.test(u)) return;
    try { if (new URL(u).origin !== BASE.origin) foreign.push(u); } catch (e) { foreign.push(u); }
  });
  page.on("requestfailed", (r) => { if (!/\/g\//.test(r.url())) errs.push("requestfailed: " + r.url()); });
  await page.goto(new URL(c.qs + EXTRA, BASE).toString(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.FC && window.FC.started && window.FC.me, null, { timeout: 90000 });
  await page.waitForTimeout(9000);
  const info = await page.evaluate(() => ({
    city: FC.city, guest: FC.me.guest, rid: FC.me.rid, label: FC.me.label,
    online: !!(FC.mp && FC.mp.connected), mpId: FC.mp && FC.mp.id, money: FC.save && FC.save.money,
  }));
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, c.name + ".png") });
    if (c.phone) {                                        // телефон: открыть «телефон» в игре
      await page.evaluate(() => FC.hud && FC.hud.openPhone && FC.hud.openPhone());
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(SHOTS, c.name + "-phone-ui.png") });
    }
  }
  await ctx.close();
  return { case: c.name, info, requests: reqs.length, foreign, errors: errs };
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  let bad = 0;
  for (const c of CASES) {
    let r;
    try { r = await one(browser, c); } catch (e) { r = { case: c.name, errors: ["не стартовал: " + e.message], foreign: [] }; }
    const ok = !r.errors.length && !r.foreign.length;
    if (!ok) bad++;
    console.log((ok ? "✓ " : "✗ ") + JSON.stringify(r, null, 1));
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
