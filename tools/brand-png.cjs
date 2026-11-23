#!/usr/bin/env node
/* Рисунки проекта из SVG → PNG с прозрачным фоном (headless Chromium из devDependencies).
 *   node tools/brand-png.cjs                 — client/brand/mascot.svg → mascot.png (512) и icon-192.png
 * PNG нужен там, где картинку читает холст (фигурка талисмана из контура в fmodels.js) и для иконки страницы. */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
/* global Image, document -- код page.evaluate выполняется в браузере */

const BRAND = path.join(__dirname, "..", "client", "brand");
const JOBS = [["mascot.svg", "mascot.png", 512], ["mascot.svg", "icon-192.png", 192]];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [src, out, size] of JOBS) {
    const svg = fs.readFileSync(path.join(BRAND, src), "utf8");
    const url = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    const b64 = await page.evaluate(async ([u, s]) => {
      const img = new Image(); img.src = u; await img.decode();
      const c = document.createElement("canvas"); c.width = c.height = s;
      c.getContext("2d").drawImage(img, 0, 0, s, s);
      return c.toDataURL("image/png").split(",")[1];
    }, [url, size]);
    fs.writeFileSync(path.join(BRAND, out), Buffer.from(b64, "base64"));
    console.log("✓", out, size + "px");
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
