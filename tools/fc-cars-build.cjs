#!/usr/bin/env node
/* Сборка моделей машин Флейм-Сити → client/cars/cars-<хэш>.glb (+ имя файла в fcarsgl.js).
 *
 *   node tools/fc-cars-build.cjs            — все машины из ростера (client/fcarlist.js), дальние силуэты, колёса
 *   node tools/fc-cars-build.cjs --stats    — то же + треугольники по моделям
 *
 * Кузова — свои параметрические (tools/lib/fc-cargen.cjs + рецепты fc-carbodies.cjs), чужих моделей нет.
 * Сжатие — meshopt (EXT_meshopt_compression, декодер уже в сборке three). gltf-transform ставится во временную папку
 * (как three в world-three.cjs) — общий package-lock копий не трогаем; FC_GT_DIR — взять уже поставленный.
 * Вершины: POSITION, NORMAL, COLOR_0 (RGBA8: rgb — цвет, a — вид поверхности K из генератора). Узел — id типа,
 * в extras — колёса, маячки, посадка; узлы lod_<силуэт> — дальний план (колёса впечатаны); wheel_<стиль> — колёса.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PLAY = path.join(ROOT, "client");
const OUTDIR = path.join(PLAY, "cars");
const GEN = require("./lib/fc-cargen.cjs");
const BODIES = require("./lib/fc-carbodies.cjs");
const GT_VER = "4.5.1", MO_VER = "1.0.1";

function gtDir() {
  if (process.env.FC_GT_DIR) return process.env.FC_GT_DIR;
  const dir = path.join(os.tmpdir(), "fc-gt-" + GT_VER);
  if (!fs.existsSync(path.join(dir, "node_modules/@gltf-transform/functions"))) {
    fs.mkdirSync(dir, { recursive: true });
    execSync(`npm install --silent --no-audit --no-fund --prefix "${dir}" @gltf-transform/core@${GT_VER} @gltf-transform/extensions@${GT_VER} ` +
      `@gltf-transform/functions@${GT_VER} meshoptimizer@${MO_VER}`, { stdio: "inherit" });
  }
  return dir;
}

function roster() {
  const win = { FC: {} };
  vm.runInNewContext(fs.readFileSync(path.join(PLAY, "fcarlist.js"), "utf8"), { window: win, globalThis: win });
  return win.FC.carList;
}

(async () => {
  const stats = process.argv.includes("--stats");
  const dir = gtDir(), req = (m) => require(path.join(dir, "node_modules", m));
  const { Document, NodeIO } = req("@gltf-transform/core");
  const { EXTMeshoptCompression, KHRMeshQuantization } = req("@gltf-transform/extensions");
  const { meshopt } = req("@gltf-transform/functions");
  const { MeshoptEncoder, MeshoptDecoder } = req("meshoptimizer");
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;

  const CL = roster(), doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene("cars");
  doc.getRoot().getAsset().generator = "fc-cars-build (Flame City)";
  doc.getRoot().getAsset().copyright = "Flame City contributors — own parametric models (MIT)";
  const report = [];
  function addMesh(name, w, extras) {
    const n = w.kind.length, colA = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      colA[i * 4] = Math.round(Math.min(1, w.col[i * 3]) * 255); colA[i * 4 + 1] = Math.round(Math.min(1, w.col[i * 3 + 1]) * 255);
      colA[i * 4 + 2] = Math.round(Math.min(1, w.col[i * 3 + 2]) * 255); colA[i * 4 + 3] = w.kind[i];
    }
    const idx = n < 65535 ? new Uint16Array(w.idx) : w.idx;
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(w.pos).setBuffer(buf))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(w.nor).setBuffer(buf))
      .setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(colA).setNormalized(true).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buf));
    const mesh = doc.createMesh(name).addPrimitive(prim);
    const node = doc.createNode(name).setMesh(mesh);
    if (extras) node.setExtras(extras);
    scene.addChild(node);
    report.push([name, w.idx.length / 3, n]);
  }
  const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === "number" ? +v.toFixed(3) : v);
  const ids = Object.keys(CL.TYPES);
  for (const id of ids) {
    const T = CL.TYPES[id], R = BODIES.recipe(id, T), b = GEN.build(R, 0);
    const meta = b.meta;
    addMesh(id, GEN.weld(b.mesh), { wheels: round(meta.wheels), beacons: meta.beacons ? round(meta.beacons) : null, seat: meta.seat || null,
      wheel: meta.wheel, tireW: meta.tireW, H: round(meta.H) });
  }
  const lods = [...new Set(ids.map((id) => CL.TYPES[id].lod))];
  for (const k of lods) {
    const src = BODIES.LOD_OF[k]; if (!src) throw new Error("нет силуэта дальнего плана: " + k);
    const T = CL.TYPES[src], b = GEN.build(BODIES.recipe(src, T), 1);
    addMesh("lod_" + k, GEN.weld(b.mesh), { L: T.L, W: T.W, src });
  }
  // три стиля дисков на весь парк — три вызова отрисовки колёс (оттенок — цвет экземпляра)
  ["alloy", "multi", "steel"].forEach((s) => addMesh("wheel_" + s, GEN.weld(GEN.wheelModel(s, 0)), null));

  doc.createExtension(KHRMeshQuantization);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  const glb = Buffer.from(await io.writeBinary(doc));
  const hash = crypto.createHash("sha1").update(glb).digest("hex").slice(0, 8);
  fs.mkdirSync(OUTDIR, { recursive: true });
  for (const f of fs.readdirSync(OUTDIR)) if (/^cars-[0-9a-f]{8}\.glb$/.test(f)) fs.unlinkSync(path.join(OUTDIR, f));
  const name = "cars-" + hash + ".glb";
  fs.writeFileSync(path.join(OUTDIR, name), glb);
  // имя файла — в загрузчик (кэш Cloudflare: новое содержимое = новое имя)
  const gl = path.join(PLAY, "fcarsgl.js");
  if (fs.existsSync(gl)) {
    const src = fs.readFileSync(gl, "utf8"), next = src.replace(/var GLB = "cars\/cars-[0-9a-f]{8}\.glb";/, `var GLB = "cars/${name}";`);
    if (next !== src) fs.writeFileSync(gl, next);
  }
  const tris = report.filter((r) => !/^(lod_|wheel_)/.test(r[0])).map((r) => r[1]);
  if (stats) report.forEach((r) => console.log(r[0].padEnd(14), String(r[1]).padStart(6), "тр.", String(r[2]).padStart(6), "верш."));
  console.log("машины →", path.relative(ROOT, path.join(OUTDIR, name)), Math.round(glb.length / 1024) + " КБ ·",
    ids.length, "моделей, треугольников " + Math.min(...tris) + "–" + Math.max(...tris));
})().catch((e) => { console.error(e); process.exit(1); });
