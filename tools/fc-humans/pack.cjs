#!/usr/bin/env node
/* Флейм-Сити, люди — конвейер ассетов, шаг 4 из 4: сжатие GLB (meshopt + квантование) и манифест people.json.
 *
 *   node tools/fc-humans/pack.cjs <рабочая папка> <папка игры people/>
 *
 * Инструменты (gltf-transform 4, meshoptimizer) — не в package.json репо (общий package-lock у всех копий, как
 * three в tools/world-three.cjs): ставятся один раз в ~/.cache/fc-humans-tools (или FC_GLTF_TOOLS).
 * Аватары: reorder + квантование (позиции 14 бит, нормали 8, UV 12, веса 8) + EXT_meshopt_compression.
 * Клипы: прореживание ключей (resample), сжатие meshopt. Декодер — в сборке three (MeshoptDecoder, tools/world-three.cjs).
 */
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const [WORK, OUT] = process.argv.slice(2).map((p) => path.resolve(p));
const TOOLS = process.env.FC_GLTF_TOOLS || path.join(os.homedir(), ".cache", "fc-humans-tools");
if (!fs.existsSync(path.join(TOOLS, "node_modules", "@gltf-transform", "functions"))) {
  fs.mkdirSync(TOOLS, { recursive: true });
  execSync("npm install --no-audit --no-fund --loglevel=error --prefix " + JSON.stringify(TOOLS) +
    " @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22", { stdio: "inherit" });
}
const req = (m) => require(path.join(TOOLS, "node_modules", m));
const { NodeIO } = req("@gltf-transform/core");
const { ALL_EXTENSIONS, EXTMeshoptCompression } = req("@gltf-transform/extensions");
const { prune, dedup, resample, meshopt, quantize, reorder } = req("@gltf-transform/functions");
const { MeshoptEncoder, MeshoptDecoder } = req("meshoptimizer");

// быстрые клипы (шаг, бег, удары, падения) — все 30 кадров/с
const FAST = new Set(["walk", "walk_cool", "walk_fast", "walk_stroll", "walk_old", "walk_drunk", "jog", "run", "flee",
  "sprint", "punch", "jab", "hit", "hit2", "fall", "getup", "roll"]);

const clipAt = {};

async function main() {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  fs.mkdirSync(OUT, { recursive: true });
  const build = JSON.parse(fs.readFileSync(path.join(WORK, "build.json"), "utf8"));
  const tex = JSON.parse(fs.readFileSync(path.join(WORK, "tex.json"), "utf8"));
  let total = 0;
  for (const v of build.variants) {
    const doc = await io.read(path.join(WORK, v.id + ".glb"));
    await doc.transform(prune(), dedup(), reorder({ encoder: MeshoptEncoder, target: "size" }),
      quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12, quantizeWeight: 8 }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    const out = path.join(OUT, v.id + ".glb");
    await io.write(out, doc);
    v.kb = +(fs.statSync(out).size / 1024).toFixed(1);
    v.lum = (tex[v.id] || {}).lum || { top: 0.5, bottom: 0.5 };
    v.texKb = (tex[v.id] || {}).kb || 0;
    total += v.kb + v.texKb;
    console.log("[pack]", v.id, v.kb + " КБ меш,", v.texKb + " КБ атлас");
  }
  for (const g of ["m", "f"]) {
    const src = path.join(WORK, "anims_" + g + ".glb");
    if (!fs.existsSync(src)) continue;
    const doc = await io.read(src);
    // каналы: повороты всех костей + смещение таза; масштаб и смещения остальных — постоянные, их даёт покой скелета
    for (const anim of doc.getRoot().listAnimations()) {
      for (const ch of anim.listChannels()) {
        const p = ch.getTargetPath(), n = ch.getTargetNode() && ch.getTargetNode().getName();
        if (p === "scale" || (p === "translation" && n !== "Hips")) { const s = ch.getSampler(); ch.dispose(); s.dispose(); }
      }
    }
    // медленные клипы (стоять, говорить, сидеть) — 15 кадров/с вместо 30: мокап гладкий, разницы не видно
    for (const anim of doc.getRoot().listAnimations()) {
      if (FAST.has(anim.getName())) continue;
      const done = new Set();
      for (const ch of anim.listChannels()) {
        const s = ch.getSampler();
        if (done.has(s)) continue;
        done.add(s);
        const inp = s.getInput(), out = s.getOutput(), n = inp.getCount(), k = out.getElementSize();
        if (n < 5) continue;
        const keep = [];
        for (let i = 0; i < n; i += 2) keep.push(i);
        if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
        const ti = inp.getArray(), to = out.getArray();
        const ni = new Float32Array(keep.length), no = new Float32Array(keep.length * k);
        keep.forEach((src, j) => { ni[j] = ti[src]; for (let c = 0; c < k; c++) no[j * k + c] = to[src * k + c]; });
        s.setInput(doc.createAccessor().setType("SCALAR").setArray(ni).setBuffer(inp.getBuffer()));
        s.setOutput(doc.createAccessor().setType(out.getType()).setArray(no).setBuffer(out.getBuffer()));
      }
    }
    // все клипы — в одну дорожку подряд (пауза 0,25 с): иначе JSON на тысячу аксессоров весит втрое больше данных.
    // Границы клипов — в people.json (clips[].at), рантайм режет дорожку обратно на клипы (fhumans.js)
    const GAP = 0.25, tracks = new Map(), at = {};
    let T0 = 0;
    for (const anim of doc.getRoot().listAnimations()) {
      let dur = 0;
      for (const ch of anim.listChannels()) dur = Math.max(dur, ch.getSampler().getInput().getMax([])[0] || 0);
      at[anim.getName()] = [+T0.toFixed(4), +dur.toFixed(4)];
      for (const ch of anim.listChannels()) {
        const key = ch.getTargetNode().getName() + "|" + ch.getTargetPath(), s = ch.getSampler();
        let tr = tracks.get(key);
        if (!tr) tracks.set(key, tr = { node: ch.getTargetNode(), path: ch.getTargetPath(), t: [], v: [], k: s.getOutput().getElementSize(), type: s.getOutput().getType() });
        const ti = s.getInput().getArray(), vo = s.getOutput().getArray();
        for (let i = 0; i < ti.length; i++) { tr.t.push(T0 + ti[i]); for (let c = 0; c < tr.k; c++) tr.v.push(vo[i * tr.k + c]); }
      }
      T0 += dur + GAP;
      for (const ch of anim.listChannels()) { const sm = ch.getSampler(); ch.dispose(); sm.dispose(); }
      anim.dispose();
    }
    const all = doc.createAnimation("all"), buf = doc.getRoot().listBuffers()[0];
    for (const tr of tracks.values()) {
      const smp = doc.createAnimationSampler().setInterpolation("LINEAR")
        .setInput(doc.createAccessor().setType("SCALAR").setArray(new Float32Array(tr.t)).setBuffer(buf))
        .setOutput(doc.createAccessor().setType(tr.type).setArray(new Float32Array(tr.v)).setBuffer(buf));
      all.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(tr.node).setTargetPath(tr.path).setSampler(smp));
    }
    clipAt[g] = at;
    await doc.transform(resample({ tolerance: 1.5e-3 }), prune(), dedup());
    // повороты — int16 с нормировкой (KHR_mesh_quantization): вдвое меньше и лучше жмётся фильтром meshopt
    const seen = new Set();
    for (const anim of doc.getRoot().listAnimations()) {
      for (const ch of anim.listChannels()) {
        if (ch.getTargetPath() !== "rotation") continue;
        const acc = ch.getSampler().getOutput();
        if (seen.has(acc)) continue;
        seen.add(acc);
        const f = acc.getArray(), q = new Int16Array(f.length);
        for (let i = 0; i < f.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
        acc.setArray(q).setNormalized(true);
      }
    }
    doc.createExtension(req("@gltf-transform/extensions").KHRMeshQuantization).setRequired(true);
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
      method: EXTMeshoptCompression.EncoderMethod.FILTER });
    const out = path.join(OUT, "anims_" + g + ".glb");
    await io.write(out, doc);
    const kb = +(fs.statSync(out).size / 1024).toFixed(1);
    total += kb;
    console.log("[pack] анимации", g, kb + " КБ");
  }
  const manifest = {
    _: "Флейм-Сити, люди: варианты (Rocketbox, MIT) и клипы (Rocketbox + Quaternius UAL1, CC0). Собирает tools/fc-humans/run.sh.",
    v: Date.now().toString(36), ground: build.ground,
    variants: build.variants.map((v) => ({ id: v.id, g: v.g, role: v.role, tint: v.tint, old: v.old, h: v.h, tris: v.tris, lum: v.lum, kb: +(v.kb + v.texKb).toFixed(1) })),
    clips: Object.fromEntries(Object.entries(build.clips).map(([g, list]) => [g, list.map((c) => Object.assign({}, c, { at: (clipAt[g] || {})[c.id] }))]))
  };
  fs.writeFileSync(path.join(OUT, "people.json"), JSON.stringify(manifest));
  console.log("[pack] всего", (total / 1024).toFixed(2), "МБ");
}
main().catch((e) => { console.error(e); process.exit(1); });
