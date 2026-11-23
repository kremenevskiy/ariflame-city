/* Флейм-Сити — люди (FC.humans): прохожие, офисные, патруль «Щит», медики, охрана, банды, другие игроки и сам игрок —
 * сригованные люди Microsoft Rocketbox (MIT) с анимациями Rocketbox и Quaternius UAL1 (CC0). Ассеты — people/
 * (собирает tools/fc-humans/run.sh, состав и клипы — people.json), авторы и лицензии — people/CREDITS.md.
 *
 * Не людьми остаются: агенты внешней ленты жителей (если подключена), талисман-гид и сюжетные «блогеры»-виды (ch.code,
 * только с набором видов FC_SPECIES). Остальные персонажи fpeople — люди (isHuman).
 *
 * Три яруса (бюджет — budget(), по качеству fgfx):
 *  • рядом (8–16 м, 4–12 человек + игрок; в интерьере больше) — SkinnedMesh + AnimationMixer: плавные переходы 0,25 с,
 *    настоящие тени; скелет доступен FC.humans.bones(ch) (под будущий рэгдолл: 22 кости гуманоида);
 *  • дальше — InstancedMesh на вариант и LOD (LOD1 до 22–48 м, LOD2 дальше): скиннинг в вершинном шейдере по текстуре
 *    матриц костей. Текстура запекается в браузере из тех же клипов (24 кадра/с, half float, по полу одна: у всех мужчин
 *    скелет один, у женщин — свой), процессор пишет на человека матрицу и 16 чисел анимации; смена клипа — смешивание
 *    двух клипов в шейдере. Время клипа считает шейдер: кадр = старт + (сейчас − t0) × темп;
 *  • дальше 95–200 м — не рисуем (туман), спрайтом не подменяем: существо вместо человека вдали выглядело бы чужим.
 * Пока модели не догрузились (поток после старта, ~2,5–3 МБ), человек рисуется как раньше (fmodels/спрайт).
 *
 * Анимация — по состоянию ch: скорость (шаг в стиле персонажа с темпом под скорость, трусца, бег, паника, спринт),
 * сидит/печатает (flife), танцует, звонит (ch.calling — свидетель вызывает патруль), снимает на телефон (ch.filming),
 * прячется (ch.cower), руки вверх (ch.hands), разговор (ch.talk = клип), злится (ch.angry), сбит (ch.knocked: падение,
 * лежит, встаёт), лежит без сознания (ch.down). Разовые жесты — FC.humans.play(ch, клип, {rate, hold, prio, then}).
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE, G = FC.gfx;
  if (!T || !T.GLTFLoader || !FC.people) return;
  var BASE = "people/";
  var TFPS = 24, TW = 2048, BLEND = 0.25;
  var SP = FC.people.SPECIAL;

  /* ---- бюджет по качеству ------------------------------------------------------------------------------------ */
  var SUBSET = {
    low: ["m01", "m04", "m20", "f01", "f04", "f12", "bm02", "copm", "copf", "medm", "grdm"],
    mid: ["m01", "m04", "m06", "m13", "m20", "f01", "f02", "f04", "f11", "f12", "bm02", "bf01", "copm", "copf", "medm", "grdm"],
    high: null
  };
  var CFG = {};
  function budget() {
    var l = G.Q.level;
    CFG.near = l === "high" ? 12 : l === "mid" ? 8 : 4;
    CFG.nearR = l === "high" ? 16 : l === "mid" ? 12 : 9;
    CFG.lodR = l === "high" ? 48 : l === "mid" ? 34 : 22;
    CFG.far = l === "high" ? 200 : l === "mid" ? 150 : 95;
    CFG.shadows = !!G.Q.shadows;
    CFG.atlas = l === "high" ? 1024 : l === "mid" ? 768 : 512;
  }
  budget();

  /* ---- палитры одежды (реалистичные, без ярких «мультяшных») -------------------------------------------------- */
  var TOPS = [0x1f2a44, 0x2b2b2e, 0xd8d8d2, 0x6b1f2a, 0x4a5a35, 0xc9b48f, 0x3e5f8a, 0xb8892b, 0x2f4f3f, 0x3a3f47,
    0x9b2d2d, 0x2c6b6b, 0x7c7f86, 0x5a3b2e, 0xe0d6c4, 0x34495e];
  var TOPS_F = [0xb85a7a, 0x8e3b5f, 0xe2c9b0, 0x5d7fa3, 0x2f2f35, 0x6a8f6a, 0xd9a441, 0xa23b3b, 0x7b6aa8, 0xf0ece4];
  var BOTS = [0x1c2433, 0x232326, 0x2f3a52, 0x8b7d62, 0x4a4a4f, 0x3b3226, 0x55606e, 0x1a1a1a, 0x6e5a44, 0x2b3d5c];
  var SHIELD = { top: 0x4f74a3, bot: 0x1d2840, k: 0.82 }, SPEC = { top: 0x24282f, bot: 0x16181d, k: 0.9 };
  function pack(hex) { return hex & 0xffffff; }

  /* ---- общее состояние ---------------------------------------------------------------------------------------- */
  var man = null, ready = false, started = 0, loader = null, failed = false;
  var SK = {};                 // пол → скелет, клипы, текстура матриц
  var VARS = {}, LOADED = [];  // id → вариант
  var clock = 0, frameNo = 0;
  var U_TIME = { value: 0 };
  var root = new T.Group(); root.name = "humans";
  G.add(root);
  var stat = { ms: 0, n: 0, near: 0, inst: 0, calls: 0, loadMs: 0, bytes: 0, bakeMs: 0 };

  function gltf(url) { return new Promise(function (res, rej) { loader.load(url, res, null, rej); }); }
  function img(url) { return new Promise(function (res, rej) { new T.TextureLoader().load(url, res, null, rej); }); }

  function start() {
    if (started || failed) return;
    started = performance.now();
    if (/[?&]humans=off/.test(global.location.search)) { failed = true; return; }   // сравнение «до/после»: ?humans=off
    if (!G.renderer.capabilities.isWebGL2) { failed = true; return; }    // толпа шейдером — только WebGL2
    loader = new T.GLTFLoader();
    loader.setMeshoptDecoder(T.MeshoptDecoder);
    fetch(BASE + "people.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (m) {
      man = m;
      return Promise.all(["m", "f"].map(function (g) {
        return gltf(BASE + "anims_" + g + ".glb?v=" + m.v).then(function (gl) { prepSkeleton(g, gl); });
      }));
    }).then(function () {
      var sub = SUBSET[G.Q.level], list = man.variants.filter(function (v) { return !sub || sub.indexOf(v.id) >= 0; });
      var pri = { civ: 0, cop: 1, office: 2, medic: 3, guard: 4 };
      list.sort(function (a, b) { return pri[a.role] - pri[b.role]; });
      man.want = {};
      list.forEach(function (v) { man.want[v.role] = (man.want[v.role] || 0) + 1; });
      var i = 0;
      function next() {
        var v = list[i++];
        if (!v) return null;
        return loadVariant(v).catch(function (e) { if (global.console) console.warn("fc-humans: " + v.id, e); }).then(next);
      }
      return Promise.all([next(), next(), next()]);
    }).then(function () { stat.loadMs = Math.round(performance.now() - started); }).catch(function (e) {
      failed = true;
      if (global.console) console.warn("fc-humans: люди не загрузились, остаются фигурки", e);
    });
  }

  /* ---- скелет пола: клипы из общей дорожки, текстура матриц ---------------------------------------------------- */
  function cut(src, name, s, d) {
    // клип [s, s+d] из общей дорожки: ключи внутри + точные значения на концах (интерполяцией)
    var tracks = [];
    src.tracks.forEach(function (tr) {
      var ip = tr.createInterpolant(), vs = tr.getValueSize(), times = [0], vals = [], k, i;
      var a = ip.evaluate(s);
      for (k = 0; k < vs; k++) vals.push(a[k]);
      for (i = 0; i < tr.times.length; i++) {
        var t = tr.times[i];
        if (t > s + 1e-4 && t < s + d - 1e-4) { times.push(t - s); for (k = 0; k < vs; k++) vals.push(tr.values[i * vs + k]); }
      }
      var b = ip.evaluate(s + d);
      times.push(d);
      for (k = 0; k < vs; k++) vals.push(b[k]);
      tracks.push(new tr.constructor(tr.name, times, vals));
    });
    return new T.AnimationClip(name, d, tracks);
  }
  function prepSkeleton(g, gl) {
    var carrier = null;
    gl.scene.traverse(function (o) { if (o.isSkinnedMesh) carrier = o; });
    var bones = carrier.skeleton.bones, clips = {}, info = {}, frames = 0, all = gl.animations[0];
    man.clips[g].forEach(function (c) {
      if (!c.at) return;
      clips[c.id] = cut(all, c.id, c.at[0], c.at[1]);
      var n = Math.max(2, Math.round(c.dur * TFPS) + 1);
      info[c.id] = { start: frames, n: n, loop: !!c.loop, dur: c.dur, speed: c.speed || 0 };
      frames += n;
    });
    var nb = bones.length, fpr = Math.floor(TW / (nb * 3));
    SK[g] = { g: g, scene: gl.scene, bones: bones, names: bones.map(function (b) { return b.name; }), nb: nb,
      clips: clips, info: info, order: Object.keys(info), frames: frames, fpr: fpr, rows: Math.ceil(frames / fpr),
      mixer: new T.AnimationMixer(gl.scene), texU: { value: null }, ci: 0, cf: 0, data: null, done: false };
    SK[g].data = new Uint16Array(TW * SK[g].rows * 4);
  }
  var f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function half(v) {
    f32[0] = v;
    var x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
    if (e <= 0) return s;
    if (e >= 31) return s | 0x7bff;
    return s | ((e << 10) + ((m + 0x1000) >>> 13));
  }
  function bake(sk, ms) {
    var t0 = performance.now();
    while (performance.now() - t0 < ms) {
      var id = sk.order[sk.ci];
      if (!id) {
        var tex = new T.DataTexture(sk.data, TW, sk.rows, T.RGBAFormat, T.HalfFloatType);
        tex.minFilter = tex.magFilter = T.NearestFilter; tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
        sk.texU.value = tex; sk.done = true; sk.mixer.stopAllAction();
        return true;
      }
      var inf = sk.info[id];
      if (sk.cf === 0) {
        sk.mixer.stopAllAction();
        sk.act = sk.mixer.clipAction(sk.clips[id]);
        sk.act.setLoop(T.LoopOnce, 1); sk.act.clampWhenFinished = true; sk.act.reset().play();
      }
      sk.act.time = Math.min(inf.dur, sk.cf / TFPS);
      sk.act.enabled = true; sk.act.paused = false;
      sk.mixer.update(0);
      sk.scene.updateMatrixWorld(true);
      var f = inf.start + sk.cf, row = Math.floor(f / sk.fpr), col = (f % sk.fpr) * sk.nb * 3, d = sk.data;
      for (var b = 0; b < sk.nb; b++) {
        var e = sk.bones[b].matrixWorld.elements, o = (row * TW + col + b * 3) * 4;
        d[o] = half(e[0]); d[o + 1] = half(e[4]); d[o + 2] = half(e[8]); d[o + 3] = half(e[12]);
        d[o + 4] = half(e[1]); d[o + 5] = half(e[5]); d[o + 6] = half(e[9]); d[o + 7] = half(e[13]);
        d[o + 8] = half(e[2]); d[o + 9] = half(e[6]); d[o + 10] = half(e[10]); d[o + 11] = half(e[14]);
      }
      if (++sk.cf >= inf.n) { sk.cf = 0; sk.ci++; }
    }
    return false;
  }

  /* ---- шейдеры: скиннинг толпы по текстуре и перекраска одежды по маске атласа --------------------------------- */
  var VS_HEAD = [
    "uniform highp sampler2D uBones; uniform float uTime; uniform float uFPR; uniform mat4 uIBM[H_NB];",
    "attribute vec4 skinIndex; attribute vec4 skinWeight;",
    "attribute vec4 aClipA; attribute vec4 aClipB; attribute vec4 aMix; attribute vec4 aTint;",
    "varying vec3 vTop; varying vec3 vBot; varying float vTintK;",
    // кадр клипа: x — первый кадр в текстуре, |y| — кадров (y < 0 — разовый, держит последний), z — t0, w — кадров/с
    "int hFrame(vec4 c) { float n = abs(c.y); float t = max(0.0, (uTime - c.z) * c.w);",
    "  float f = c.y > 0.0 ? mod(t, n - 1.0) : min(t, n - 1.0); return int(c.x + floor(f + 0.5)); }",
    "mat4 hBone(int f, int b) { int fp = int(uFPR); int y = f / fp; int x = (f - y * fp) * (H_NB * 3) + b * 3;",
    "  vec4 r0 = texelFetch(uBones, ivec2(x, y), 0); vec4 r1 = texelFetch(uBones, ivec2(x + 1, y), 0);",
    "  vec4 r2 = texelFetch(uBones, ivec2(x + 2, y), 0);",
    "  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0); }",
    "vec3 hRGB(float p) { return pow(vec3(floor(p / 65536.0), mod(floor(p / 256.0), 256.0), mod(p, 256.0)) / 255.0, vec3(2.2)); }"
  ].join("\n");
  var VS_SKIN = [
    "ivec4 hI = ivec4(skinIndex + 0.5);",
    "int hA = hFrame(aClipA);",
    "float hW = clamp((uTime - aMix.x) / max(aMix.y, 0.001), 0.0, 1.0);",
    "mat4 hM0 = hBone(hA, hI.x), hM1 = hBone(hA, hI.y), hM2 = hBone(hA, hI.z), hM3 = hBone(hA, hI.w);",
    "if (hW < 1.0) { int hB = hFrame(aClipB); float hV = 1.0 - hW;",
    "  hM0 = hM0 * hW + hBone(hB, hI.x) * hV; hM1 = hM1 * hW + hBone(hB, hI.y) * hV;",
    "  hM2 = hM2 * hW + hBone(hB, hI.z) * hV; hM3 = hM3 * hW + hBone(hB, hI.w) * hV; }",
    "mat4 hSkin = skinWeight.x * (hM0 * uIBM[hI.x]) + skinWeight.y * (hM1 * uIBM[hI.y]) +",
    "  skinWeight.z * (hM2 * uIBM[hI.z]) + skinWeight.w * (hM3 * uIBM[hI.w]);",
    "vTop = hRGB(aTint.x); vBot = hRGB(aTint.y); vTintK = aTint.z;"
  ].join("\n");
  var FS_HEAD = [
    "uniform vec2 uLum;",
    "#ifdef H_INST",
    "varying vec3 vTop; varying vec3 vBot; varying float vTintK;",
    "#else",
    "uniform vec3 vTop; uniform vec3 vBot; uniform float vTintK;",
    "#endif"
  ].join("\n");
  // альфа тела — маска (tex.py): 160 — верх, 96 — низ, 255 — не красим; в области волос — прозрачность
  var FS_MAP = [
    "#ifdef USE_MAP",
    "  vec4 hTex = texture2D(map, vMapUv);",
    "  vec3 hC = hTex.rgb;",
    "  if (vMapUv.x < 0.5) {",
    "    float hTop = 1.0 - smoothstep(0.05, 0.1, abs(hTex.a - 0.6275));",
    "    float hBot = 1.0 - smoothstep(0.05, 0.1, abs(hTex.a - 0.3765));",
    "    float hL = dot(hC, vec3(0.2126, 0.7152, 0.0722));",
    "    vec3 hT = hTop * vTop * (hL / uLum.x) + hBot * vBot * (hL / uLum.y);",
    "    float hS = hTop + hBot;",
    "    hC = mix(hC, hT / max(hS, 0.001), clamp(hS, 0.0, 1.0) * vTintK);",
    "  } else if (vMapUv.x > 0.75 && vMapUv.y < 0.5 && hTex.a < 0.5) discard;",
    "  diffuseColor.rgb *= hC;",
    "#endif"
  ].join("\n");
  function patchFS(s) {
    return s.replace("#include <common>", "#include <common>\n" + FS_HEAD).replace("#include <map_fragment>", FS_MAP);
  }
  function instMat(v, lod) {
    var sk = SK[v.g], m = new T.MeshLambertMaterial({ map: v.tex, side: lod === 2 ? T.FrontSide : T.DoubleSide });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uBones = sk.texU; sh.uniforms.uTime = U_TIME; sh.uniforms.uFPR = { value: sk.fpr };
      sh.uniforms.uIBM = { value: v.ibm[lod] }; sh.uniforms.uLum = { value: v.lumV };
      sh.vertexShader = "#define H_INST\n#define H_NB " + sk.nb + "\n" + sh.vertexShader
        .replace("#include <common>", "#include <common>\n" + VS_HEAD)
        .replace("#include <skinbase_vertex>", VS_SKIN)
        .replace("#include <skinnormal_vertex>", "objectNormal = normalize(mat3(hSkin) * objectNormal);")
        .replace("#include <skinning_vertex>", "transformed = (hSkin * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = "#define H_INST\n" + patchFS(sh.fragmentShader);
    };
    m.customProgramCacheKey = function () { return "fc-human-inst-" + sk.nb; };
    return m;
  }
  function nearMat(v) {
    var m = new T.MeshLambertMaterial({ map: v.tex, side: T.DoubleSide });
    var u = { vTop: { value: new T.Color() }, vBot: { value: new T.Color() }, vTintK: { value: 0 }, uLum: { value: v.lumV } };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.vTop = u.vTop; sh.uniforms.vBot = u.vBot; sh.uniforms.vTintK = u.vTintK; sh.uniforms.uLum = u.uLum;
      sh.fragmentShader = patchFS(sh.fragmentShader);
    };
    m.customProgramCacheKey = function () { return "fc-human-near"; };
    m.userData.u = u;
    return m;
  }

  /* ---- варианты: GLB (LOD0..2) + атлас; кости — в канонический порядок скелета пола ---------------------------- */
  function loadVariant(v) {
    var q = "?v=" + man.v;
    return Promise.all([gltf(BASE + v.id + ".glb" + q), img(BASE + v.id + ".webp" + q)]).then(function (r) {
      prepVariant(v, r[0], r[1]);
      stat.bytes += (v.kb || 0) * 1024;
    });
  }
  function atlasTex(t) {
    var im = t.image, w = CFG.atlas;
    if (w < (im.width || 1024)) {               // меньше качество — меньше атлас (холстом, без чтения пикселей)
      var c = document.createElement("canvas");
      c.width = w; c.height = w / 2;
      c.getContext("2d").drawImage(im, 0, 0, w, w / 2);
      t.dispose();
      t = new T.CanvasTexture(c);
    }
    t.flipY = false; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 2;
    t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.needsUpdate = true;
    return t;
  }
  function prepVariant(v, gl, tex) {
    var sk = SK[v.g], lods = [];
    gl.scene.traverse(function (o) { if (o.isSkinnedMesh && /^lod\d$/.test(o.name)) lods[+o.name.slice(3)] = o; });
    gl.scene.updateMatrixWorld(true);
    var ibm = [], m4 = new T.Matrix4(), seen = new Set();
    lods.forEach(function (mesh, li) {
      var map = mesh.skeleton.bones.map(function (b) { return sk.names.indexOf(b.name); });
      var si = mesh.geometry.attributes.skinIndex, ident = map.every(function (c, j) { return c === j; });
      if (!ident && !seen.has(si)) { seen.add(si); for (var k = 0; k < si.array.length; k++) si.array[k] = Math.max(0, map[si.array[k]]); si.needsUpdate = true; }
      var arr = new Float32Array(sk.nb * 16);
      for (var c = 0; c < sk.nb; c++) {
        var j = map.indexOf(c);
        if (j < 0) m4.identity(); else m4.multiplyMatrices(mesh.skeleton.boneInverses[j], mesh.bindMatrix);
        arr.set(m4.elements, c * 16);
      }
      ibm[li] = arr;
    });
    var rec = { id: v.id, g: v.g, role: v.role, tint: v.tint, old: v.old, h: v.h, scene: gl.scene, lods: lods, ibm: ibm,
      tex: atlasTex(tex), lumV: new T.Vector2(Math.pow(v.lum.top, 2.2), Math.pow(v.lum.bottom, 2.2)),
      pool: [], buckets: [null, null, null] };
    rec.buckets[1] = bucket(rec, 1); rec.buckets[2] = bucket(rec, 2);
    VARS[v.id] = rec; LOADED.push(rec);
  }

  /* ---- корзины толпы: InstancedMesh на (вариант, LOD), атрибуты анимации на экземпляр --------------------------- */
  function bucket(v, lod) {
    var B = { v: v, lod: lod, geo: v.lods[lod].geometry, mat: instMat(v, lod), cap: 0, n: 0, mesh: null };
    grow(B, lod === 1 ? 12 : 20);
    return B;
  }
  function grow(B, cap) {
    function at() { var a = new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(T.DynamicDrawUsage); return a; }
    B.aA = at(); B.aB = at(); B.aM = at(); B.aT = at();
    B.geo.setAttribute("aClipA", B.aA); B.geo.setAttribute("aClipB", B.aB); B.geo.setAttribute("aMix", B.aM); B.geo.setAttribute("aTint", B.aT);
    if (B.mesh) root.remove(B.mesh);
    B.mesh = new T.InstancedMesh(B.geo, B.mat, cap);
    B.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    B.mesh.frustumCulled = false; B.mesh.count = 0; B.mesh.visible = false;
    B.mesh.castShadow = false; B.mesh.receiveShadow = false;
    root.add(B.mesh);
    B.cap = cap;
  }
  function upd(a, n) { a.needsUpdate = true; if (a.clearUpdateRanges) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); } }
  function endBucket(B) {
    var n = B.n;
    B.mesh.count = n; B.mesh.visible = n > 0;
    if (!n) return;
    stat.calls++;
    upd(B.mesh.instanceMatrix, n); upd(B.aA, n); upd(B.aB, n); upd(B.aM, n); upd(B.aT, n);
  }
  function clipVec(arr, o, sk, id, t0, rate) {
    var inf = sk.info[id];
    arr[o] = inf.start; arr[o + 1] = inf.loop ? inf.n : -inf.n; arr[o + 2] = t0; arr[o + 3] = rate * TFPS;
  }
  // танцоры в интерьерах подпрыгивают по y (так «танцевали» фигурки) — человека ставим на пол, танцует клип
  function yOf(ch) { return (ch.dance || (ch.life && ch.life.dance)) && ch.ground != null ? ch.ground : ch.y; }
  function putInst(ch, hs, lod) {
    var B = hs.v.buckets[lod];
    if (B.n >= B.cap) grow(B, B.cap * 2);
    var i = B.n++, sk = SK[hs.g], a = B.mesh.instanceMatrix.array, o = i * 16, sc = hs.sc;
    var c = Math.cos(ch._yaw) * sc, s = Math.sin(ch._yaw) * sc;
    a[o] = c; a[o + 1] = 0; a[o + 2] = -s; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = sc; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = s; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0; a[o + 12] = ch.x; a[o + 13] = yOf(ch); a[o + 14] = ch.z; a[o + 15] = 1;
    o = i * 4;
    clipVec(B.aA.array, o, sk, hs.clip, hs.t0, hs.rate);
    clipVec(B.aB.array, o, sk, hs.pc || hs.clip, hs.pt0, hs.pr || hs.rate);
    var m = B.aM.array; m[o] = hs.bt; m[o + 1] = BLEND; m[o + 2] = 0; m[o + 3] = 0;
    var t = B.aT.array; t[o] = hs.top; t[o + 1] = hs.bot; t[o + 2] = hs.tk; t[o + 3] = 0;
    stat.inst++;
    blob(ch, hs);
  }

  /* ---- тени-пятна (один InstancedMesh на всех) ------------------------------------------------------------------ */
  var blobCap = 64, blobN = 0;
  var blobMesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({ map: G.tex.blob, transparent: true, depthWrite: false }), blobCap);
  blobMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); blobMesh.frustumCulled = false; blobMesh.count = 0; blobMesh.renderOrder = 1;
  root.add(blobMesh);
  function blob(ch, hs) {
    if (blobN >= blobCap) {
      blobCap *= 2;
      root.remove(blobMesh);
      var nm = new T.InstancedMesh(blobMesh.geometry, blobMesh.material, blobCap);
      nm.instanceMatrix.setUsage(T.DynamicDrawUsage); nm.frustumCulled = false; nm.renderOrder = 1;
      blobMesh = nm; root.add(blobMesh);
    }
    var a = blobMesh.instanceMatrix.array, o = blobN++ * 16, lie = ch.knocked > 0 || ch.down ? 1.6 : 1, r = 0.62 * hs.sc;
    a.fill(0, o, o + 16);
    a[o] = r * (lie > 1 ? 1.2 : 1); a[o + 5] = 1; a[o + 10] = r * lie;
    a[o + 12] = ch.x; a[o + 13] = (ch.ground != null ? ch.ground : ch.y) + 0.015; a[o + 14] = ch.z; a[o + 15] = 1;
  }

  /* ---- ближний ярус: пул SkinnedMesh + свой микшер ---------------------------------------------------------------- */
  var nearRoot = new T.Group(); nearRoot.name = "humans-near"; root.add(nearRoot);
  var nearTotal = 0;
  function acquire(v) {
    for (var i = 0; i < v.pool.length; i++) if (!v.pool[i].busy) return v.pool[i];
    if (nearTotal >= CFG.near + 8) return null;
    var r = T.cloneSkinned(v.scene), mesh = null, extra = [];
    r.traverse(function (o) { if (o.isSkinnedMesh) { if (o.name === "lod0") mesh = o; else extra.push(o); } });
    extra.forEach(function (o) { o.parent.remove(o); });
    if (!mesh) return null;
    mesh.material = nearMat(v);
    mesh.frustumCulled = false; mesh.castShadow = CFG.shadows; mesh.receiveShadow = false;
    r.visible = false;
    nearRoot.add(r);
    var no = { v: v, root: r, mesh: mesh, mixer: new T.AnimationMixer(r), acts: {}, cur: null, seq: -1, busy: false, used: 0 };
    v.pool.push(no); nearTotal++;
    return no;
  }
  function release(hs) {
    var no = hs.near;
    if (!no) return;
    no.busy = false; no.root.visible = false; no.mixer.stopAllAction(); no.cur = null; no.seq = -1; hs.near = null;
  }

  function hexLin(c, p) { return c.setHex(p).convertSRGBToLinear(); }
  function syncNear(no, ch, hs, dt) {
    var r = no.root, fresh = no.seq < 0;
    r.position.set(ch.x, yOf(ch), ch.z); r.rotation.y = ch._yaw; r.scale.setScalar(hs.sc); r.visible = true;
    if (fresh) {
      var u = no.mesh.material.userData.u;
      hexLin(u.vTop.value, hs.top); hexLin(u.vBot.value, hs.bot); u.vTintK.value = hs.tk;
      no.mesh.castShadow = CFG.shadows;
    }
    if (no.seq !== hs.seq) {
      var sk = SK[hs.g], inf = sk.info[hs.clip], a = no.acts[hs.clip], prev = no.cur;
      if (!a) {
        a = no.acts[hs.clip] = no.mixer.clipAction(sk.clips[hs.clip]);
        if (inf.loop) a.setLoop(T.LoopRepeat, Infinity); else { a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; }
      }
      if (fresh || !prev || prev === a) { no.mixer.stopAllAction(); a.reset(); }
      a.enabled = true; a.timeScale = hs.rate; a.setEffectiveWeight(1);
      a.time = clipTime(hs, inf);
      a.play();
      if (!fresh && prev && prev !== a) a.crossFadeFrom(prev, Math.max(0.06, BLEND - (clock - hs.bt)), false);
      no.cur = a; no.seq = hs.seq;
    } else if (no.cur) no.cur.timeScale = hs.rate;
    no.mixer.update(dt);
    stat.near++;
    blob(ch, hs);
  }
  function clipTime(hs, inf) {
    var t = Math.max(0, (clock - hs.t0) * hs.rate);
    return inf.loop ? t % inf.dur : Math.min(t, inf.dur);
  }

  /* ---- кто человек, какой вариант ------------------------------------------------------------------------------- */
  function isHuman(ch) {
    var k = ch.kind;
    if (k === "agent" || ch.realAgent || ch.buddy || ch.code) return false;
    if (k === "player" || k === "ped" || k === "cop" || k === "remote") return true;
    return ch.cell !== SP.guide;
  }
  function roleOf(ch) {
    if (ch.kind === "cop" || ch.cell === SP.cop || ch.cell === SP.cop2) return "cop";
    if (ch.cell === SP.medic) return "medic";
    if (ch.cell === SP.guard) return "guard";
    if (ch.kind === "npc" && ch.life && (ch.life.role === "worker" || ch.life.role === "manager")) return "office";
    return "civ";
  }
  function ofRole(role) {
    var list = LOADED.filter(function (v) { return v.role === role; });
    var want = man && man.want ? man.want[role] || 0 : 0;
    // роль включаем, когда догружены все её варианты (или прошло 8 с) — иначе первые минуты город из одного лица
    if (!list.length || (list.length < want && performance.now() - started < 8000 + (role === "civ" ? 4000 : 0))) return null;
    return list;
  }
  function pickR(r, l) { return l[Math.floor(r() * l.length)]; }
  function assign(ch) {
    var role = roleOf(ch), list = ofRole(role === "office" ? "civ" : role);
    if (!list) return null;
    var seed = ch.kind === "player" ? FC.hash((FC.me && FC.me.rid) || "guest", 3) : FC.hash(ch.id || "x", 7);
    var r = FC.rng(seed);
    if (role === "office") { var off = ofRole("office"); if (off && r() < 0.6) list = off; }
    if (ch.variant && VARS[ch.variant]) list = [VARS[ch.variant]];          // свой облик (Макс — всегда одно лицо)
    else if (ch.kind === "player" && FC.save && FC.save.look && VARS[FC.save.look]) list = [VARS[FC.save.look]];
    else if (ch.kind === "player") { var young = list.filter(function (v) { return !v.old; }); if (young.length) list = young; }
    var v = pickR(r, list), g = v.g, I = SK[g].info;
    if (ch.kind === "player" && FC.save && !FC.save.look) { FC.save.look = v.id; FC.dirty(); }   // облик игрока не меняется от захода к заходу
    var hs = { v: v, g: g, sc: g === "m" ? 0.95 + r() * 0.1 : 0.95 + r() * 0.09, clip: "idle", t0: clock - r() * 5, rate: 1,
      pc: null, pt0: 0, pr: 1, bt: -10, seq: 0, act: null, near: null, top: 0, bot: 0, tk: 0, last: "" };
    // стиль шага и стойки — характер персонажа
    var x = r();
    hs.walk = v.old ? (x < 0.65 ? "walk_old" : "walk") : x < 0.45 ? "walk" : x < 0.65 ? "walk_cool" : x < 0.85 ? "walk_fast" : "walk_stroll";
    if (role === "cop" || role === "guard") hs.walk = x < 0.5 ? "walk" : "walk_cool";
    if (role === "office") hs.walk = x < 0.5 ? "walk_fast" : "walk";
    if (ch.kind === "npc" && !ch.life && FC.clock && (FC.clock.hour >= 23 || FC.clock.hour < 4) && r() < 0.07 && role === "civ") hs.walk = "walk_drunk";
    var y = r();
    hs.idle = y < 0.5 ? "idle" : y < 0.8 ? "idle2" : "look";
    hs.phoneIdle = r() < 0.5 ? "text" : "phone";
    // одежда
    if (role === "cop") {
      var p = ch.cell === SP.cop2 ? SPEC : SHIELD;
      hs.top = pack(p.top); hs.bot = pack(p.bot); hs.tk = v.id === "copm" && p === SHIELD ? 0 : p.k;
    } else if (v.tint && ch.kind !== "player") {
      hs.tk = r() < 0.3 ? 0 : 0.55 + r() * 0.35;
      hs.top = pack(pickR(r, g === "f" && r() < 0.6 ? TOPS_F : TOPS)); hs.bot = pack(pickR(r, BOTS));
    }
    if (!I[hs.walk]) hs.walk = "walk";
    ch._hs = hs;
    return hs;
  }

  /* ---- выбор клипа по состоянию ------------------------------------------------------------------------------- */
  var GAIT = [["idle", 0, 0.32], ["walk", 0.22, 2.15], ["jog", 1.95, 4.3], ["run", 4.0, 7.4], ["sprint", 7.0, 99]];
  function gaitOf(hs, sp) {
    var cur = hs.gait || 0;
    if (sp >= GAIT[cur][1] && sp <= GAIT[cur][2]) return cur;        // полосы перекрываются: без дрожи на границе
    cur = sp < 0.27 ? 0 : sp < 2.05 ? 1 : sp < 4.15 ? 2 : sp < 7.2 ? 3 : 4;
    hs.gait = cur;
    return cur;
  }
  function rateFor(I, id, sp, lo, hi) { var s = I[id] && I[id].speed; return s ? Math.min(hi, Math.max(lo, sp / s)) : 1; }
  function want(ch, hs) {
    var I = SK[hs.g].info, sp = ch.speed || 0;
    if (ch.down) return set1(hs, "fall", 1, "hold");
    if (ch.sit) return set1(hs, ch.life && ch.life.typing ? "sit_table" : "sit", 1);
    if (ch.drive) return set1(hs, "drive", 1);
    if (ch.dance || (ch.life && ch.life.dance)) return set1(hs, "dance", 1);
    if (ch.kind === "player" && ch.air) return set1(hs, "air", 1);
    var g = gaitOf(hs, sp);
    if (g === 0) {
      if (ch.hands) return set1(hs, "surrender", 1);
      if (ch.calling) return set1(hs, "phone", 1);
      if (ch.filming > 0) return set1(hs, "photo", 1);
      if (ch.cower > 0) return set1(hs, "cower", 1);
      if (ch.talk && I[ch.talk]) return set1(hs, ch.talk, 1);
      if (ch.angry && ch.angry > performance.now() / 1000) return set1(hs, "angry", 1);
      if (ch.phone) return set1(hs, hs.phoneIdle, 1);
      return set1(hs, hs.idle, 1);
    }
    if (g === 1) {
      var w = hs.walk;
      if (!I[w] || !I[w].speed) w = "walk";
      if (sp / I[w].speed > 1.32 && w !== "walk_fast") w = "walk_fast";
      return set1(hs, w, rateFor(I, w, sp, 0.7, 1.4));
    }
    if (g === 2) return set1(hs, "jog", rateFor(I, "jog", sp, 0.75, 1.45));
    if (g === 3) {
      var c = ch.flee > 0 && hs.g === "m" ? "flee" : "run";
      return set1(hs, c, rateFor(I, c, sp, 0.75, 1.6));
    }
    return set1(hs, "sprint", rateFor(I, "sprint", sp, 0.8, 1.25));
  }
  // смена клипа: прежний уходит в смешивание (B), новый — с начала; тот же клип с новым темпом — без скачка фазы
  function set1(hs, id, rate, hold, restart) {
    if (id !== hs.clip || restart) {
      hs.pc = hs.clip; hs.pt0 = hs.t0; hs.pr = hs.rate; hs.bt = clock;
      hs.clip = id; hs.rate = rate; hs.seq++;
      var inf = SK[hs.g].info[id];
      // зацикленные (шаг, стойка) — со случайной фазы, чтобы толпа не шагала в ногу; разовые и «держать» — с начала
      hs.t0 = inf && inf.loop && !restart && !hold ? clock - Math.random() * inf.dur : clock;
    } else if (Math.abs(rate - hs.rate) > 0.03) {
      var ph = (clock - hs.t0) * hs.rate;
      hs.rate = rate; hs.t0 = clock - ph / rate;
    }
  }
  function think(ch, hs) {
    var a = hs.act;
    if (a && clock >= a.end) {
      hs.act = null;
      if (a.then) { try { a.then(ch); } catch (e) { /* продолжение необязательно */ } }
      a = hs.act;
    }
    // сбит: падение → лежит → встаёт (fpeople ведёт таймер knocked)
    if (ch.knocked > 0) {
      var gu = SK[hs.g].info.getup;
      if (ch.knocked <= gu.dur && (!a || a.id !== "getup")) { a = hs.act = { id: "getup", rate: 1, end: clock + gu.dur, prio: 3, fresh: true }; }
      else if (!a || (a.id !== "fall" && a.id !== "getup")) { a = hs.act = { id: "fall", rate: 1, end: clock + 99, prio: 3, fresh: true }; }
    } else if (a && (a.id === "fall" || a.id === "getup") && !ch.down) { hs.act = a = null; }
    if (a) { set1(hs, a.id, a.rate, false, a.fresh); a.fresh = false; return; }
    want(ch, hs);
  }
  function face(ch, dt) {
    var sp = ch.speed || 0, tgt;
    if (ch._yaw == null) ch._yaw = Math.atan2(ch.vx || 0, ch.vz || 1);
    if (ch.knocked > 0 || ch.down) return;
    if (ch.kind === "player" && FC.player) tgt = FC.player.heading;
    else if (sp > 0.3 && (ch.vx || ch.vz)) tgt = Math.atan2(ch.vx, ch.vz);
    else if (ch.look) tgt = Math.atan2(ch.look.x - ch.x, ch.look.z - ch.z);
    else return;
    ch._yaw = FC.angDamp(ch._yaw, tgt, sp > 3 ? 11 : 7, dt);
  }

  /* ---- кадр: ярусы, отсечение по кадру, запись экземпляров ------------------------------------------------------ */
  var taken = new Set(), nearC = [], pv = new T.Matrix4();
  function byNear(a, b) { return (a.kind === "player" ? -1 : a._d) - (b.kind === "player" ? -1 : b._d); }
  function inView(e, x, y, z) {
    var w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w < 0.5) return w > -2;
    var cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w, cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    var m = 1.15 + 2.5 / w;
    return cx > -m && cx < m && cy > -m - 0.3 && cy < m + 0.3;
  }
  function pump() {
    if (!man || ready) return;
    if (SK.m && SK.f) {
      var t0 = performance.now();
      if (!SK.m.done) bake(SK.m, 5); else if (!SK.f.done) bake(SK.f, 5);
      stat.bakeMs += performance.now() - t0;
      if (SK.m.done && SK.f.done) { ready = true; if (G.warm) G.warm(root); }    // шейдеры толпы — фоном, до первого показа
    }
  }
  function draw(order, dt) {
    taken.clear();
    if (!started && FC.started) start();
    pump();
    if (!ready || !LOADED.length) return taken;
    var t0 = performance.now();
    clock += dt; U_TIME.value = clock; frameNo++;
    stat.near = stat.inst = stat.calls = 0;
    var cam = G.camera;
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    var e = pv.elements, inside = !!(FC.inside && FC.inside.active);
    var far2 = CFG.far * CFG.far, n2 = CFG.nearR * CFG.nearR, keep2 = (CFG.nearR + 3) * (CFG.nearR + 3), l2 = CFG.lodR * CFG.lodR;
    var i, ch, hs;
    for (i = 0; i < LOADED.length; i++) { LOADED[i].buckets[1].n = 0; LOADED[i].buckets[2].n = 0; }
    blobN = 0; nearC.length = 0;
    for (i = 0; i < order.length; i++) {
      ch = order[i];
      if (!ch.visible || !isHuman(ch)) continue;
      hs = ch._hs || assign(ch);
      if (!hs) continue;
      taken.add(ch);
      face(ch, dt);
      think(ch, hs);
      var d2 = ch._d != null ? ch._d : FC.dist2(ch.x, ch.z, cam.position.x, cam.position.z);
      if (ch.kind !== "player") {
        if ((d2 > far2 && !inside) || !inView(e, ch.x, ch.y + 0.9, ch.z)) { release(hs); continue; }
      }
      if (ch.kind === "player" || d2 < (hs.near ? keep2 : n2) || (inside && d2 < 900)) { nearC.push(ch); continue; }
      release(hs);
      putInst(ch, hs, d2 < l2 ? 1 : 2);
    }
    nearC.sort(byNear);
    var lim = CFG.near + (inside ? 4 : 0);
    for (i = 0; i < nearC.length; i++) {
      ch = nearC[i]; hs = ch._hs;
      if (i < lim && (hs.near || (hs.near = acquire(hs.v)))) {
        hs.near.busy = true; hs.near.used = frameNo;
        syncNear(hs.near, ch, hs, dt);
      } else { release(hs); putInst(ch, hs, 1); }
    }
    for (i = 0; i < LOADED.length; i++) {
      var v = LOADED[i];
      endBucket(v.buckets[1]); endBucket(v.buckets[2]);
      for (var k = 0; k < v.pool.length; k++) {
        var no = v.pool[k];
        if (no.busy && no.used !== frameNo) { no.busy = false; no.root.visible = false; no.mixer.stopAllAction(); no.cur = null; no.seq = -1; }
        if (no.busy) stat.calls++;
      }
    }
    blobMesh.count = blobN; blobMesh.visible = blobN > 0;
    if (blobN) { stat.calls++; upd(blobMesh.instanceMatrix, blobN); }
    stat.ms = stat.ms * 0.95 + (performance.now() - t0) * 0.05;
    return taken;
  }
  // объект «рядом» отдан другому, а персонаж его ещё держит — снять ссылку (пул сверяет used по кадру)
  function nearOf(ch) { var hs = ch._hs; return hs && hs.near && hs.near.busy && hs.near.used === frameNo ? hs.near : null; }

  /* ---- API для других модулей ---------------------------------------------------------------------------------- */
  // Разовый жест: play(ch, "wave"), play(ch, "punch", {rate: 1.6}), {hold: с} — держать последний кадр,
  // {prio} — не перебивать важное (падение 3 > удар 2 > жест 1), {then: fn(ch)} — по окончании.
  function play(ch, id, opt) {
    if (!ready || !isHuman(ch)) return 0;
    var hs = ch._hs || assign(ch);
    if (!hs) return 0;
    var inf = SK[hs.g].info[id];
    if (!inf) return 0;
    opt = opt || {};
    var prio = opt.prio || 1;
    if (hs.act && hs.act.prio > prio && clock < hs.act.end) return 0;
    var rate = opt.rate || 1, dur = inf.dur / rate + (opt.hold || 0);
    hs.act = { id: id, rate: rate, end: clock + dur, prio: prio, then: opt.then || null, fresh: true };
    return dur;
  }
  function stop(ch) { var hs = ch._hs; if (hs) hs.act = null; }
  function dur(id, g) { var sk = SK[g || "m"]; return sk && sk.info[id] ? sk.info[id].dur : 0; }

  FC.on("quality", function () { budget(); LOADED.forEach(function (v) { v.pool.forEach(function (no) { no.mesh.castShadow = CFG.shadows; }); }); });
  FC.on("start", function () { setTimeout(start, 300); });
  // игрок: задержан — руки вверх, вырубился — падает
  FC.on("busted", function () { var P = FC.player; if (P && P.ch) play(P.ch, "surrender", { hold: 2.5, prio: 3 }); });
  FC.on("wasted", function () { var P = FC.player; if (P && P.ch) play(P.ch, "fall", { hold: 1.5, prio: 3 }); });

  FC.humans = {
    draw: draw, isHuman: isHuman, play: play, stop: stop, dur: dur,
    get ready() { return ready && LOADED.length > 0; },
    // кости ближнего яруса (для рэгдолла): массив THREE.Bone в порядке скелета пола или null, если персонаж далеко
    bones: function (ch) { var no = nearOf(ch); return no ? no.mesh.skeleton.bones : null; },
    boneNames: function (g) { return SK[g || "m"] ? SK[g || "m"].names.slice() : []; },
    variants: function () { return LOADED.map(function (v) { return v.id; }); },
    lookOf: function (ch) { return ch && ch._hs ? ch._hs.v.id : null; },
    // сменить облик игрока (вариант из people.json); запоминается в сохранении
    setLook: function (id) {
      var P = FC.player;
      if (!VARS[id] || !P) return false;
      FC.save.look = id; FC.dirty();
      if (P.ch._hs) release(P.ch._hs);
      P.ch._hs = null;
      return true;
    },
    stats: function () {
      var near = 0;
      LOADED.forEach(function (v) { v.pool.forEach(function (no) { if (no.busy) near++; }); });
      return { ready: ready, variants: LOADED.length, loadMs: stat.loadMs, kb: Math.round(stat.bytes / 1024), near: near, inst: stat.inst,
        calls: stat.calls, ms: +stat.ms.toFixed(3), bakeMs: Math.round(stat.bakeMs), failed: failed,
        texRows: SK.m ? [SK.m.rows, SK.f && SK.f.rows] : null };
    },
    cfg: CFG,
    // титры (лицензия MIT Rocketbox требует копирайт Microsoft; полный текст — people/CREDITS.md)
    credits: "Модели и часть анимаций людей — Microsoft Rocketbox Avatar Library, Copyright (c) 2020 Microsoft, лицензия MIT; " +
      "анимации ударов, падений, бега и вождения — Quaternius Universal Animation Library (CC0). Полный текст лицензий — people/CREDITS.md и ASSETS.md в репозитории игры"
  };
})(window);
