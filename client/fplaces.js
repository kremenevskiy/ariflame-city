/* Флейм-Сити — места (FC.places): настоящие заведения, магазины и районы поверх города — данными, без правки кода.
 *
 * Пакеты мест — JSON (формат — client/places/README.md): общий places/<город>.json из репозитория (районы для старта)
 * и пакеты развёртывания из config.js (FC_CONFIG.places — список адресов: партнёрские места с логотипами и фото, которые
 * в открытый репозиторий не входят). Пакетов может быть сколько угодно — каждый следующий дополняет предыдущие.
 *
 *  • districts — где можно начать (Минск): карточка с картинкой, точка и взгляд. При входе в город — экран «Где начнёшь?»
 *    поверх заставки; город строится сразу вокруг выбранной точки (fmain ждёт выбора, ?pick=0 — без выбора).
 *  • places — «большие» места (кальянная, клуб, бар): логотип на карте и миникарте, вывеска у настоящего входа (логотип-
 *    лайтбокс или буквы), дверь здания — в точке входа, свой интерьер по этажам (наборы мебели ниже и ffurn.js, палитра).
 *  • biz — все заведения района (названия как на картах): вывеска с настоящим названием на ближайшей стене — вместо
 *    «ПРОДУКТЫ»/«КАФЕ» у магазинов OSM (fosm спрашивает signFor), точка и имя на большой карте вблизи, имя здания у двери.
 * Координаты — lat/lon (или x/z игры): x = (lon − 27.58)·cos 53.9°·111320, z = −(lat − 53.9)·110540.
 *
 * FC.places: {ready(cb), list, biz, districts, claim(B), floorInfo(B, f), signFor(x, z), pickSpawn(cb), wantPick(),
 *   spawnAt, ll(lat, lon), add(pack, base)}
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE;
  if (!FC || !T) return;
  var CITY = global.FC_CITY === "minsk" ? "minsk" : "flame";
  var KX = Math.cos(53.9 * Math.PI / 180) * 111320, KZ = 110540;
  function ll(lat, lon) { return { x: (lon - 27.58) * KX, z: -(lat - 53.9) * KZ }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
  function hex(c, d) { if (typeof c === "number") return c; var m = /^#?([0-9a-f]{6})$/i.exec(String(c || "")); return m ? parseInt(m[1], 16) : d; }

  var P = { list: [], biz: [], districts: [], spawnAt: null, loaded: false };
  var waiters = [], GRID = 60, grid = {};
  function cell(x, z) { return Math.floor(x / GRID) + "," + Math.floor(z / GRID); }
  function index(o) { var k = cell(o.x, o.z); (grid[k] || (grid[k] = [])).push(o); }
  function around(x, z, r) {
    var out = [];
    for (var gx = Math.floor((x - r) / GRID); gx <= Math.floor((x + r) / GRID); gx++)
      for (var gz = Math.floor((z - r) / GRID); gz <= Math.floor((z + r) / GRID); gz++) {
        var l = grid[gx + "," + gz]; if (l) for (var i = 0; i < l.length; i++) if (Math.hypot(l[i].x - x, l[i].z - z) <= r) out.push(l[i]);
      }
    return out;
  }
  function pos(o) {
    if (o.lat != null && o.lon != null) { var p = ll(+o.lat, +o.lon); o.x = p.x; o.z = p.z; }
    return o.x != null && o.z != null && isFinite(o.x) && isFinite(o.z);
  }
  function url(base, u) { return !u || /^(https?:)?\/\//.test(u) || u.charAt(0) === "/" ? u : base + u; }

  /* ---- пакеты ---------------------------------------------------------------------------------------------------- */
  // тип заведения → цвета вывески (если в пакете своих нет) и значок
  var KIND = {
    hookah: { bg: 0x2a1840, fg: 0xffd9a0, icon: "💨" }, bar: { bg: 0x3a1020, fg: 0xffe3b0, icon: "🍸" }, club: { bg: 0x1d0f33, fg: 0xf4c2ff, icon: "🪩" },
    cafe: { bg: 0x5a3a24, fg: 0xfff2de, icon: "☕" }, restaurant: { bg: 0x2c2f3a, fg: 0xf3e1c0, icon: "🍽" }, fastfood: { bg: 0xc0392b, fg: 0xffffff, icon: "🍔" },
    shop: { bg: 0x1f5f8b, fg: 0xffffff, icon: "🛍" }, grocery: { bg: 0x2e7d32, fg: 0xffffff, icon: "🛒" }, pharmacy: { bg: 0x1b8a5a, fg: 0xffffff, icon: "💊" },
    bank: { bg: 0x1e3a6e, fg: 0xffffff, icon: "🏦" }, beauty: { bg: 0x8e3b6e, fg: 0xffffff, icon: "💇" }, fitness: { bg: 0x263238, fg: 0xffd54f, icon: "🏋" },
    mall: { bg: 0x283593, fg: 0xffffff, icon: "🏬" }, service: { bg: 0x37474f, fg: 0xffffff, icon: "🔧" }, other: { bg: 0x34495e, fg: 0xffffff, icon: "📍" }
  };
  function kindOf(k) { return KIND[k] ? k : "other"; }
  function add(pack, base) {
    if (!pack || (pack.city && pack.city !== CITY)) return;
    base = base || "";
    (pack.districts || []).forEach(function (d) {
      if (!pos(d)) return;
      d.img = url(base, d.img);
      if (d.order == null) d.order = (P.districts.length + 1) * 10;      // порядок карточек: order из пакета или по очереди
      P.districts = P.districts.filter(function (o) { return o.id !== d.id; });
      P.districts.push(d);
      P.districts.sort(function (x, y) { return x.order - y.order; });
    });
    (pack.places || []).forEach(function (p) {
      if (!pos(p)) return;
      p.kind = kindOf(p.kind); p.logo = url(base, p.logo); p.base = base;
      if (p.door && pos(p.door)) p.door = { x: p.door.x, z: p.door.z };
      P.list = P.list.filter(function (o) { return o.id !== p.id; });
      P.list.push(p); index(p); clearList = null;
      if (p.logo) loadLogo(p);
      if (p.exterior && p.exterior.poly && p.exterior.poly.length > 2) {
        // своё здание на настоящем контуре: дом OSM под ним прячем (до сборки кусков — без пересборки)
        var X = p.exterior;
        X.poly = X.poly.map(function (v) { if (X.ll) { var q = ll(v[0], v[1]); return [q.x, q.z]; } return [v[0], v[1]]; });
        (X.murals || []).forEach(function (m, i) { X.murals[i] = url(base, m); });
        if (FC.osm && FC.osm.maskPoly) FC.osm.maskPoly(X.poly);
        heroes.push(p);
      }
      if (p.interior) ["murals", "images"].forEach(function (k) { var a = p.interior[k]; if (a) a.forEach(function (m, i) { a[i] = url(base, m); }); });
      if (p.interior && p.interior.art) Object.keys(p.interior.art).forEach(function (k) { p.interior.art[k] = url(base, p.interior.art[k]); });
    });
    if (pack.streets && P.addStreets) P.addStreets(pack.streets);
    (pack.biz || []).forEach(function (b) {
      if (!b.name || !pos(b)) return;
      b.kind = kindOf(b.kind);
      var K = KIND[b.kind];
      b.bg = hex(b.bg, K.bg); b.fg = hex(b.fg, K.fg);
      b.biz = true; P.biz.push(b); index(b);
    });
  }
  var logos = {}, heroes = [];
  function loadLogo(p) {
    if (logos[p.logo]) { p.img = logos[p.logo]; return; }
    var im = new Image(); im.decoding = "async"; im.src = p.logo; logos[p.logo] = im; p.img = im;
  }
  function hqTower() {
    // Башня Флейм (штаб сюжета) — перенесена fmapx; рисуем её здесь: тёмное стекло с огненными поясами, огненная корона
    var H = FC.map && FC.map.hq;
    if (!H || !H.moved || heroes.some(function (o) { return o.id === "hq"; })) return;
    heroes.push({ id: "hq", name: "Башня Флейм", kind: "other", x: H.x, z: H.z, sign: false, map: false,
      exterior: { poly: H.poly, h: H.h, floors: H.floors, style: "bands", far: 6000, bay: 3.0,
        colors: { glass: "#2c4566", glass2: "#152238", band: "#ff8a3d", frame: "#3a4250" }, podium: { h: 9, kind: "shops" }, crown: { h: 7, color: "#ff7a2f" }, roof: "#2b2f36" } });
  }
  function done() {
    hqTower(); P.loaded = true;
    if (FC.osm && FC.osm.propsDirty) FC.osm.propsDirty();             // деревья у мест с exterior.clear — убрать, если кусок уже построен
    waiters.splice(0).forEach(function (f) { try { f(); } catch (e) { if (global.console) console.error(e); } });
  }
  (function load() {
    var cfg = (FC.cfg && FC.cfg.places) || [];
    var dev = (global.location.search.match(/[?&]places=([^&]+)/) || [])[1];     // разработка: ?places=<пакет.json>
    var urls = ["places/" + CITY + ".json"].concat(Array.isArray(cfg) ? cfg : [cfg]).concat(dev ? [decodeURIComponent(dev)] : []).filter(Boolean);
    var left = urls.length, packs = new Array(urls.length);
    urls.forEach(function (u, i) {
      fetch(u, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) {
          packs[i] = j;
          if (--left) return;
          packs.forEach(function (pk, k) { try { add(pk, urls[k].replace(/[^/]*$/, "")); } catch (e) { if (global.console) console.warn("places", urls[k], e); } });
          done();
        });
    });
    setTimeout(function () { if (!P.loaded) done(); }, 2500);   // пакет не ответил — игра без мест, но не ждёт
  })();
  P.ready = function (cb) { if (P.loaded) cb(); else waiters.push(cb); };

  /* ---- здания: имя, вход, интерьер ------------------------------------------------------------------------------------ */
  function pip(x, z, p) {
    var c = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var a = p[i], b = p[j];
      if (((a[1] > z) !== (b[1] > z)) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1] || 1e-9) + a[0]) c = !c;
    }
    return c;
  }
  function edge(p, x, z) {
    var best = { d: 1e9 };
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var ax = p[j][0], az = p[j][1], ex = p[i][0] - ax, ez = p[i][1] - az, L2 = ex * ex + ez * ez || 1e-9;
      var t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), qx = ax + ex * t, qz = az + ez * t, d = Math.hypot(x - qx, z - qz);
      if (d < best.d) {
        var L = Math.sqrt(L2), ux = ex / L, uz = ez / L, nx = -uz, nz = ux;
        if (pip(qx + nx * 0.3, qz + nz * 0.3, p)) { nx = -nx; nz = -nz; }   // нормаль — наружу
        best = { d: d, x: qx, z: qz, ux: ux, uz: uz, nx: nx, nz: nz, len: L };
      }
    }
    return best;
  }
  function inside(p, B) { return B.poly && (pip(p.x, p.z, B.poly) || edge(B.poly, p.x, p.z).d < (p.r || 6)); }
  P.claim = function (B) {
    if (!B || !B.poly) return;
    var cx = B.x, cz = B.z, R = Math.max(B.w || 10, B.d || 10) + 30;
    var near = around(cx, cz, R), place = null, firstBiz = null;
    for (var i = 0; i < near.length; i++) {
      var o = near[i];
      if (!inside(o, B)) continue;
      if (!o.biz) { place = o; break; }
      if (!firstBiz) firstBiz = o;
    }
    if (place) {
      B.place = place; B.name = place.name; B.emoji = place.icon || KIND[place.kind].icon; B.color = place.color || "#ffb347";
      var fl = place.interior && place.interior.floors;
      if (fl && fl.length) B.floors = Math.max(B.floors, fl.length);
      // зал на всё здание места: {x, z, w, d, rot} (мир) — у дома OSM прямоугольник меньше настоящего контура
      if (place.interior && place.interior.room) B.room = place.interior.room;
      var dp = place.door || place, e = edge(B.poly, dp.x, dp.z);
      if (e.d < 25) B.doors = [{ x: e.x + e.nx * 0.9, z: e.z + e.nz * 0.9, nx: e.nx, nz: e.nz, side: "n" }].concat((B.doors || []).slice(1));
    } else if (firstBiz && !B.name) B.name = firstBiz.name;
  };
  P.floorInfo = function (B, f) {
    var pl = B.place, it = pl && pl.interior;
    if (!it || !it.floors || f < 0 || f >= it.floors.length) return null;
    var F = it.floors[f] || {};
    return { role: "hall", plan: "open", kit: F.kit || "hookah", title: F.title || pl.name, emoji: F.emoji || B.emoji, color: pl.color || "#ffb347",
      tenant: null, hero: null, pal: F.pal || it.pal || null, place: pl, floorData: F };
  };

  // у места с exterior.clear (м) вокруг контура нет деревьев улицы: перед кальянной из пакета — плитка до тротуара, а не газон с липами
  // список мест с exterior.clear и их рамки считаются один раз: fosm спрашивает о каждом дереве при каждой пересборке
  // (тысячи деревьев), перебор всех мест и заведений давал рывки в сотни мс после перемещения по карте
  var clearList = null;
  P.keepClear = function (x, z) {
    if (!P.loaded) return false;
    if (!clearList) clearList = P.list.filter(function (o) { return o.exterior && o.exterior.clear && o.exterior.poly; }).map(function (o) {
      var X = o.exterior, b = [1e9, 1e9, -1e9, -1e9];
      X.poly.forEach(function (v) { b[0] = Math.min(b[0], v[0]); b[1] = Math.min(b[1], v[1]); b[2] = Math.max(b[2], v[0]); b[3] = Math.max(b[3], v[1]); });
      return { poly: X.poly, r: X.clear, b: [b[0] - X.clear, b[1] - X.clear, b[2] + X.clear, b[3] + X.clear] };
    });
    for (var i = 0; i < clearList.length; i++) {
      var c = clearList[i];
      if (x < c.b[0] || x > c.b[2] || z < c.b[1] || z > c.b[3]) continue;
      if (polyDist(c.poly, x, z) < c.r) return true;
    }
    return false;
  };
  function polyDist(poly, x, z) {
    var inside = false, best = 1e9;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[j], b = poly[i];
      if ((b[1] > z) !== (a[1] > z) && x < (a[0] - b[0]) * (z - b[1]) / (a[1] - b[1]) + b[0]) inside = !inside;
      var dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
    }
    return inside ? 0 : best;
  }

  /* ---- вывески с настоящими названиями ---------------------------------------------------------------------------- */
  P.signFor = function (x, z) {
    if (!P.loaded) return null;
    var l = around(x, z, 14), best = null, bd = 1e9;
    for (var i = 0; i < l.length; i++) {
      var o = l[i], d = Math.hypot(o.x - x, o.z - z);
      if (!o.biz && o.sign !== false && d < 14) return { skip: true };       // у большого места своя вывеска
      if (o.biz && !o.taken && d < bd) { bd = d; best = o; }
    }
    if (!best) return null;
    best.taken = true;                                                     // у этого магазина OSM — его название
    return { s: best.name.slice(0, 26), bg: best.bg, fg: best.fg };
  };

  /* вывески мест и заведений без магазина OSM рядом: своя табличка на ближайшей стене, строим вблизи камеры */
  var G = FC.gfx, root = new T.Group(); root.name = "places";
  if (G && G.add) G.add(root);
  var built = new Map(), sweepT = 0;
  function canvasTex(w, h, draw) {
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    var t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function wallNear(o) {
    if (!FC.osm || !FC.osm.near) return null;
    var tx = o.door ? o.door.x : o.x, tz = o.door ? o.door.z : o.z;
    var items = FC.osm.near(tx, tz, 30), best = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i]; if (!it.p || it.p.length < 3) continue;
      var e = edge(it.p, tx, tz);
      if (!best || e.d < best.d) { best = e; best.item = it; }
    }
    return best && best.d < 22 ? best : null;
  }
  function signMesh(o, e) {
    var g = new T.Group(), K = KIND[o.kind] || KIND.other, S = o.sign || {}, big = !o.biz;
    var name = S.text || o.name, w, h, tex;
    if (big && o.img && o.img.complete && o.img.naturalWidth && S.type !== "text") {
      // логотип-лайтбокс: картинка на фоне места, светится ночью
      var ar = o.img.naturalWidth / o.img.naturalHeight;
      h = S.h || 1.3; w = S.w || Math.min(5, h * Math.max(1, ar) + 0.4);
      tex = canvasTex(512, Math.round(512 * h / w), function (c, W, H) {
        c.fillStyle = S.bg || "#120c18"; c.fillRect(0, 0, W, H);
        var pad = H * 0.1, ih = H - pad * 2, iw = Math.min(W - pad * 2, ih * ar);
        c.drawImage(o.img, (W - iw) / 2, pad, iw, iw / ar);
      });
    } else {
      var fs = big ? 64 : 48, font = (big ? "700 " : "600 ") + fs + "px Oswald, 'Arial Narrow', system-ui, sans-serif";
      var mc = document.createElement("canvas").getContext("2d"); mc.font = font;
      var tw = Math.min(900, mc.measureText(name).width + fs * 0.9);
      h = S.h || (big ? 1.0 : 0.72); w = S.w || Math.max(1.4, Math.min(big ? 6 : 4.2, h * tw / (fs * 1.45)));
      tex = canvasTex(Math.ceil(tw), Math.round(fs * 1.45), function (c, W, H) {
        c.fillStyle = S.bg || "#" + (o.bg != null ? o.bg : K.bg).toString(16).padStart(6, "0"); c.fillRect(0, 0, W, H);
        c.fillStyle = S.fg || "#" + (o.fg != null ? o.fg : K.fg).toString(16).padStart(6, "0");
        c.font = font; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(name, W / 2, H / 2 + fs * 0.04);
      });
    }
    var mat = new T.MeshBasicMaterial({ map: tex, toneMapped: false, fog: true });
    var m = new T.Mesh(new T.PlaneGeometry(w, h), mat);
    var y = S.y || (big ? 3.6 : 3.1), sx = e.x + e.nx * 0.14, sz = e.z + e.nz * 0.14;
    // свободное место на стене: не на вывеске магазина города и не на соседней табличке — вдоль стены, потом рядом выше
    if (!S.y) {
      var spot = freeSpot(sx, y, sz, e, w, h);
      if (!spot) { tex.dispose(); mat.dispose(); m.geometry.dispose(); return null; }
      sx = spot.x; y = spot.y; sz = spot.z;
    }
    taken2.push([sx, y, sz, e.ux, e.uz, w, h]);
    if (o.door && big) { sx += e.ux * 0; }
    m.position.set(sx, y, sz); m.rotation.y = Math.atan2(e.nx, e.nz);
    g.add(m);
    if (big) {                                                             // подсветка у входа: тёплое пятно и козырёк
      var lamp = new T.Mesh(new T.BoxGeometry(Math.min(w, 2.4), 0.08, 0.5), new T.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6 }));
      lamp.position.set(sx + e.nx * 0.25, y - h / 2 - 0.25, sz + e.nz * 0.25); lamp.rotation.y = m.rotation.y; g.add(lamp);
    }
    g.userData.dispose = function () { tex.dispose(); mat.dispose(); m.geometry.dispose(); };
    return g;
  }
  var taken2 = [];                                                         // таблички мест, уже висящие на стенах
  function clashAt(x, y, z, e, w, h) {
    var osm = FC.osm && FC.osm.signsNear ? FC.osm.signsNear(x, z, 12) : [];
    function hit(o, oh) {
      if (Math.abs(o[3] * e.ux + o[4] * e.uz) < 0.95) return false;                     // другая стена
      if (Math.abs((o[0] - x) * e.nx + (o[2] - z) * e.nz) > 0.6) return false;
      return Math.abs((o[0] - x) * e.ux + (o[2] - z) * e.uz) < (o[5] + w) / 2 + 0.25 && Math.abs(o[1] - y) < (oh + h) / 2 + 0.1;
    }
    for (var i = 0; i < osm.length; i++) if (hit(osm[i], 0.78)) return true;
    for (var j = 0; j < taken2.length; j++) if (hit(taken2[j], taken2[j][6])) return true;
    return false;
  }
  function freeSpot(x, y, z, e, w, h) {
    var half = (e.len || 8) / 2, step = w + 0.4;
    var rows = [y, y + h + 0.25];
    for (var r = 0; r < rows.length; r++) for (var k = 0; k < 5; k++) {
      var off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step;
      if (Math.abs(off) > half + 2) continue;
      var cx = x + e.ux * off, cz = z + e.uz * off;
      if (!clashAt(cx, rows[r], cz, e, w, h)) return { x: cx, y: rows[r], z: cz };
    }
    return null;
  }
  function sweep() {
    var f = (G && G.focus) || (FC.player ? { x: FC.player.x, z: FC.player.z } : null);
    if (!f || !P.loaded) return;
    var want = around(f.x, f.z, 260).filter(function (o) { return !o.taken && o.sign !== false; }), keep = new Set(), n = 0;
    want.sort(function (a, b) { return (b.biz ? 0 : 1) - (a.biz ? 0 : 1) || Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z); });
    for (var i = 0; i < want.length && n < 70; i++) {
      var o = want[i];
      if (o.big === undefined) o.big = !o.biz;
      if (built.has(o)) { keep.add(o); n++; continue; }
      if (o.big && o.img && !(o.img.complete && o.img.naturalWidth) && !o.waitImg) { o.waitImg = 1; o.img.addEventListener("load", function () { /* следующий проход */ }); }
      var e = wallNear(o); if (!e) continue;
      var g = signMesh(o, e); if (!g) { o.sign = false; continue; }   // на стене нет места — без таблички (карта и точка остаются)
      g.userData.spot = taken2[taken2.length - 1]; root.add(g); built.set(o, g); keep.add(o); n++;
    }
    built.forEach(function (g, o) {
      var d = Math.hypot(o.x - f.x, o.z - f.z);
      if (!keep.has(o) && d > 330) { root.remove(g); if (g.userData.dispose) g.userData.dispose(); built.delete(o); var ti = taken2.indexOf(g.userData.spot); if (ti >= 0) taken2.splice(ti, 1); }
    });
  }
  FC.addSystem({ name: "places", order: 80, update: function (dt) { sweepT -= dt; if (sweepT <= 0) { sweepT = 0.8; sweep(); } } });
  // логотип загрузился позже вывески — пересобрать её с картинкой
  function refreshLogo(p) { var g = built.get(p); if (g) { root.remove(g); if (g.userData.dispose) g.userData.dispose(); built.delete(p); var ti = taken2.indexOf(g.userData.spot); if (ti >= 0) taken2.splice(ti, 1); } }

  /* ---- карта: логотипы мест, точки и имена заведений ------------------------------------------------------------------- */
  function mapLayer(c, k, mode) {
    if (!P.loaded) return;
    var px = 1 / k;                                                        // пикселей экрана в метре мира — обратное
    if (mode === "big" && k > 0.55) {
      c.textAlign = "left"; c.textBaseline = "middle"; c.font = (11 * px) + "px system-ui";
      P.biz.forEach(function (b) {
        c.fillStyle = "#" + b.bg.toString(16).padStart(6, "0"); c.beginPath(); c.arc(b.x, b.z, 3.2 * px, 0, 7); c.fill();
        if (k > 1.1) { c.fillStyle = "rgba(255,255,255,.92)"; c.fillText(b.name, b.x + 5 * px, b.z); }
      });
    }
    P.list.forEach(function (p) {
      if (p.map === false) return;
      var far = mode === "big" && FC.hud.mapTier && FC.hud.mapTier(k) === 0;
      var r = (mode === "big" ? (far ? 10 : 15) : 11) * px;
      c.save();
      c.fillStyle = "#120c18"; c.strokeStyle = p.color || "#ffb347"; c.lineWidth = 2.5 * px;
      c.beginPath(); c.arc(p.x, p.z, r, 0, 7); c.fill(); c.stroke();
      if (p.img && p.img.complete && p.img.naturalWidth) {
        c.beginPath(); c.arc(p.x, p.z, r - 1.5 * px, 0, 7); c.clip();
        var ar = p.img.naturalWidth / p.img.naturalHeight, iw = ar >= 1 ? r * 1.7 : r * 1.7 * ar, ih = iw / ar;
        c.drawImage(p.img, p.x - iw / 2, p.z - ih / 2, iw, ih);
      } else { c.fillStyle = "#fff"; c.font = (r * 1.1) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(p.icon || KIND[p.kind].icon, p.x, p.z); }
      c.restore();
      if (mode === "big" && !far) {
        c.font = "600 " + (12 * px) + "px system-ui"; c.textAlign = "center"; c.textBaseline = "top";
        c.lineWidth = 3 * px; c.strokeStyle = "rgba(0,0,0,.75)"; c.strokeText(p.name, p.x, p.z + r + 3 * px);
        c.fillStyle = "#fff"; c.fillText(p.name, p.x, p.z + r + 3 * px);
      }
    });
  }
  function hookMap() { if (FC.hud && FC.hud.addMapLayer) FC.hud.addMapLayer(mapLayer); else setTimeout(hookMap, 200); }
  hookMap();

  /* ---- «Где начнёшь?»: выбор района при входе в город ---------------------------------------------------------------- */
  P.wantPick = function () {
    if (!P.districts.length) return false;
    var q = global.location.search;
    return !/[?&](pick=0|at=)/.test(q);
  };
  var CSS = "#spawnpick{position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;overflow-y:auto;" +
    "padding:calc(28px + var(--safe-t,0px)) 20px calc(28px + var(--safe-b,0px));background:linear-gradient(180deg,rgba(9,13,34,.72),rgba(9,13,34,.92));" +
    "color:#fff;font-family:Oswald,'Arial Narrow',system-ui,sans-serif;animation:sp-in .35s ease both}" +
    "@keyframes sp-in{from{opacity:0}}" +
    "#spawnpick h2{margin:0;font-weight:600;font-size:36px;letter-spacing:.01em}" +
    "#spawnpick p.sub{margin:6px 0 20px;font:500 15px/1.4 system-ui,sans-serif;color:rgba(255,243,223,.8);text-align:center;max-width:560px}" +
    "#spawnpick .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;width:min(1080px,100%)}" +
    "#spawnpick button.card{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;" +
    "background:#0d56a3;border:3px solid #fff;box-shadow:0 14px 34px rgba(0,0,0,.45);transition:transform .15s,box-shadow .15s}" +
    "#spawnpick button.card:hover,#spawnpick button.card:focus-visible{transform:translateY(-3px);box-shadow:0 18px 40px rgba(0,0,0,.55),0 0 0 3px #ffcf7a}" +
    "#spawnpick .card img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#14203a}" +
    "#spawnpick .card b{display:block;padding:9px 12px 0;font-weight:600;font-size:22px;line-height:1.15}" +
    "#spawnpick .card span{display:block;padding:3px 12px 11px;font:500 13px/1.35 system-ui,sans-serif;color:rgba(255,255,255,.86)}" +
    "#spawnpick .card.cont{background:#1d2440}" +
    "@media (max-width:560px){#spawnpick{padding:calc(18px + var(--safe-t,0px)) 14px calc(18px + var(--safe-b,0px))}#spawnpick h2{font-size:28px}" +
    "#spawnpick .grid{grid-template-columns:1fr 1fr;gap:10px}#spawnpick .card b{font-size:18px;padding:7px 9px 0}#spawnpick .card span{font-size:12px;padding:2px 9px 9px}}";
  P.pickSpawn = function (cb, last) {
    if (!P.districts.length) { cb(null); return; }
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var box = document.createElement("div"); box.id = "spawnpick"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Где начнёшь?");
    var cards = P.districts.map(function (d, i) {
      return "<button type='button' class='card' data-i='" + i + "'><img alt='' src='" + esc(d.img || "") + "'><b>" + esc(d.name) + "</b><span>" + esc(d.about || "") + "</span></button>";
    });
    if (last) cards.unshift("<button type='button' class='card cont' data-i='last'><img alt='' src='" + esc((P.districts[0] || {}).img || "") +
      "' style='filter:grayscale(.6) brightness(.7)'><b>Где был в прошлый раз</b><span>" + esc(last.name || "Продолжить с того же места") + "</span></button>");
    box.innerHTML = "<h2>Где начнёшь?</h2><p class='sub'>Город соберётся вокруг тебя. Переехать можно в любой момент — с карты (M).</p><div class='grid'>" + cards.join("") + "</div>";
    document.body.appendChild(box);
    var ld = document.getElementById("loader"); if (ld) ld.classList.add("picking");
    var first = box.querySelector("button"); if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) { /* старый браузер */ } }, 50);
    box.addEventListener("click", function (ev) {
      var b = ev.target.closest("button.card"); if (!b) return;
      var i = b.getAttribute("data-i"), d = i === "last" ? null : P.districts[+i];
      box.remove(); st.remove(); if (ld) ld.classList.remove("picking");
      if (d) {
        if (d.art && global.FCL && global.FCL.setArt) global.FCL.setArt(d.art);
        P.spawnAt = { x: d.x, z: d.z, h: d.h != null ? d.h * Math.PI / 180 : null, id: d.id, name: d.name };
        try { global.localStorage.setItem("fc.spawn." + CITY, d.id); } catch (e) { /* приватное окно */ }
      }
      cb(P.spawnAt);
    });
  };

  /* ---- интерьеры мест: кальянная (зал и второй этаж) --------------------------------------------------------------------- */
  function hookah(ctx, x, z, glass) {
    // кальян: колба, шахта, чаша с углями (светятся), шланг
    ctx.cyl(x, z, 0.16, 0.26, 0, glass || "#3b6f8f", { solid: false });
    ctx.cyl(x, z, 0.035, 0.52, 0.26, "#c9b27a", { solid: false });
    ctx.cyl(x, z, 0.12, 0.03, 0.62, "#8a7350", { solid: false });
    ctx.cyl(x, z, 0.065, 0.08, 0.65, "#d9c9a8", { solid: false });
    ctx.glow(x, z, 0.09, 0.09, 0.03, 0.73, "#ff7a2f");
    ctx.box(x + 0.2, z, 0.34, 0.03, 0.03, 0.5, "#2b2b2b", { solid: false });
  }
  function lounge(ctx, cx, cz, sofaCol, tableCol, glass, face) {
    // зона: низкий стол с кальяном, П-образный диван, подушки; сидят двое-трое
    if (!ctx.box(cx, cz, 1.2, 0.8, 0.42, 0, tableCol || "#3a2a22")) return false;
    hookah(ctx, cx, cz, glass);
    ctx.box(cx, cz + 1.05, 2.4, 0.75, 0.42, 0, sofaCol, {});
    ctx.box(cx, cz + 1.38, 2.4, 0.14, 0.5, 0.42, sofaCol, { solid: false });
    ctx.box(cx - 1.35, cz + 0.2, 0.75, 1.6, 0.42, 0, sofaCol, {});
    ctx.box(cx + 1.35, cz + 0.2, 0.75, 1.6, 0.42, 0, sofaCol, {});
    ctx.seat(cx - 0.6, cz + 1.0, -1, "chair"); ctx.seat(cx + 0.6, cz + 1.0, -1, "chair"); ctx.seat(cx - 1.35, cz + 0.2, 0, "chair");
    return true;
  }
  var LINES = ["Ещё кальян на мяте!", "Забей на холодке", "Тут лучший кальянщик", "Давай в приставку?", "Угли поменяйте, пожалуйста",
    "Плотно, но мягко", "Сегодня ди-джей в девять", "Возьмём чай с чабрецом?"];
  function rndCell(ctx) { return FC.people.randomCell(ctx.r); }
  function hookahHall(o, ctx, up) {
    var B = ctx.B, pl = B.place || {}, it = pl.interior || {}, F = (ctx.info && ctx.info.floorData) || {};
    var I = { x0: o.x0 + 0.7, x1: o.x1 - 0.7, z0: o.z0 + 0.7, z1: o.z1 - 0.7 };
    I.w = I.x1 - I.x0; I.d = I.z1 - I.z0; I.cx = (I.x0 + I.x1) / 2; I.cz = (I.z0 + I.z1) / 2;
    var sofa = F.sofa || it.sofa || "#6b2a3a", table = F.table || it.table || "#2e211b", neon = F.neon || it.neon || "#ff4fa8", glass = it.glass || "#3b6f8f";
    if (!up) {
      // бар и кальянная станция у дальней стены, подсветка полок
      var bw = Math.min(5.5, I.w - 1.5);
      ctx.box(I.cx - 0.8, I.z1 - 1.1, bw, 0.7, 1.08, 0, F.bar || it.bar || "#24161a");
      ctx.glow(I.cx - 0.8, I.z1 - 0.75, bw, 0.04, 0.05, 1.05, neon);
      for (var s = 0; s < 3; s++) ctx.glow(I.cx - 0.8, I.z1 - 0.12, bw, 0.18, 0.04, 1.4 + s * 0.45, "#ffcf8a");
      ctx.npc(I.cx - 0.8, I.z1 - 0.55, rndCell(ctx), { line: ["Что будете курить?", "Есть новинки табака", "Чай, лимонад?"] });
      ctx.act(I.cx - 0.8, I.z1 - 2.0, (pl.name || "Кальянная") + ": заказать кальян — $15", function () {
        if (FC.money(-15, "кальян") === false) { FC.hud.toast("Не хватает денег", "bad", 2); return; }
        if (FC.player && FC.player.heal) FC.player.heal(25);
        FC.hud.toast("💨 Кальян принесут через минуту. +25 здоровья, -стресс", "ok", 3); if (FC.audio) FC.audio.play("cash");
      }, 1.6);
      // кальянная станция: угли светятся
      var sx = I.x1 - 1.0, sz = I.z1 - 1.0;
      ctx.box(sx, sz, 1.4, 0.8, 0.95, 0, "#1a1a1d");
      for (var c = 0; c < 4; c++) ctx.glow(sx - 0.45 + c * 0.3, sz, 0.18, 0.18, 0.04, 0.97, "#ff6a1a");
      ctx.npc(sx - 0.2, sz - 0.9, rndCell(ctx), { line: ["Раскуриваю — две минуты", "Кому на дыню?"] });
      if (pl.logo) ctx.image(I.cx - 0.8, I.z1 - 0.06, 2.7, Math.min(2.6, bw * 0.5), Math.PI, pl.logo);
      else ctx.sign(I.cx - 0.8, I.z1 - 0.06, 2.6, Math.min(3.4, bw * 0.6), Math.PI, pl.name || "", pl.icon || "💨", pl.color || neon);
    } else {
      // второй этаж: кабинки с занавесками, приставка с большим экраном
      ctx.box(I.cx, I.z1 - 0.1, Math.min(3.4, I.w * 0.5), 0.08, 1.9, 0.8, "#0d0d10", { solid: false });
      ctx.glow(I.cx, I.z1 - 0.16, Math.min(3.2, I.w * 0.48), 0.02, 1.7, 0.9, "#4f6bff");
      ctx.act(I.cx, I.z1 - 2.2, "Приставка: сыграть партию", function () { FC.hud.toast("🎮 3:2 — ты выиграл у кальянщика", "ok", 3); }, 1.5);
    }
    // зоны с диванами рядами — сколько поместится
    var n = 0, pitchX = 3.6, pitchZ = 3.3, z0 = up ? I.z0 + 1.0 : I.z0 + 1.6, zMax = up ? I.z1 - 2.8 : I.z1 - 3.2;
    for (var z = z0; z < zMax; z += pitchZ) for (var x = I.x0 + 1.6; x < I.x1 - 1.5; x += pitchX) {
      if (lounge(ctx, x, z, sofa, table, glass)) {
        n++;
        if (up) { ctx.box(x - 1.75, z + 0.4, 0.06, 2.4, 2.4, 0, F.curtain || it.curtain || "#3a1622", { solid: false }); }
        ctx.glow(x, z + 1.5, 0.5, 0.06, 0.06, 2.2, "#ffb06a");
        if (ctx.r() < 0.75) ctx.npc(x - 0.6, z + 1.0, rndCell(ctx), { line: LINES });
        if (ctx.r() < 0.45) ctx.npc(x + 0.6, z + 1.0, rndCell(ctx), { line: LINES });
      }
    }
    // неон по стенам и тёплые лампы
    ctx.glow(I.x0 + 0.05, I.cz, 0.04, Math.max(1, I.d - 2), 0.05, 2.5, neon);
    ctx.glow(I.x1 - 0.05, I.cz, 0.04, Math.max(1, I.d - 2), 0.05, 2.5, neon);
    for (var k = 0; k < 5; k++) ctx.glow(I.x0 + 1.5 + k * (I.w - 3) / 4, I.cz, 0.35, 0.35, 0.12, ctx.hc - 0.35, "#ffcf8a");
    return n;
  }
  function addKits() {
    if (!FC.furn || !FC.furn.K) { setTimeout(addKits, 100); return; }
    FC.furn.K.hookah = function (o, ctx) { hookahHall(o, ctx, false); };
    FC.furn.K.hookah2 = function (o, ctx) { hookahHall(o, ctx, true); };
  }
  addKits();

  /* ---- своё здание места на настоящем контуре (exterior) ------------------------------------------------------------
   * exterior: {poly: [[x, z]…] (или ll: true и [[lat, lon]…]), h, floors, wall, roof, glass: [номера стен] (стеклянные —
   *   скруглённый угол, витрины), ornament: {color, density} (мазки кистью по белой стене), canopy: {edges, h, depth, color},
   *   logo: {edge, t, y, d} (круглый световой логотип на стене), terrace: {edge, depth}, door: {edge, t}}
   * Стена i — от вершины i к i+1. Окна верхних этажей — светятся вечером. Строится, когда камера ближе 650 м. */
  function brushTex(color, density, seed) {
    // мазки кистью: широкие рваные чёрные штрихи наискосок, гуще внизу — как граффити-орнамент на белом фасаде
    return canvasTex(1024, 512, function (c, W, H) {
      c.fillStyle = "rgba(0,0,0,0)"; c.clearRect(0, 0, W, H);
      var r = FC.rng(seed || 7), n = Math.round(46 * (density || 1));
      c.fillStyle = color || "#141414";
      for (var i = 0; i < n; i++) {
        // жирные чёрные мазки с белым воздухом между ними — как граффити-орнамент на фасаде
        var y = H * (0.08 + 0.9 * r()), x = r() * W, len = 70 + r() * 170, wd = 16 + r() * 22, a = (r() < 0.5 ? -1 : 1) * (0.55 + r() * 0.6);
        c.save(); c.translate(x, y); c.rotate(a); c.globalAlpha = 1;
        c.beginPath(); c.moveTo(-len / 2, -wd / 2);
        for (var k = 0; k <= 6; k++) c.lineTo(-len / 2 + len * k / 6, -wd / 2 + (r() - 0.5) * 5);
        c.lineTo(len / 2 + r() * 12, 0);
        for (var k2 = 6; k2 >= 0; k2--) c.lineTo(-len / 2 + len * k2 / 6, wd / 2 + (r() - 0.5) * 5);
        c.closePath(); c.fill(); c.restore();
      }
    });
  }
  function calliTex(seed) {
    // «каллиграффити» (как на фасадах кальянных): крупные плавные ленты-буквы — чёрные с серым переливом, белые прорези-блики
    return canvasTex(1024, 512, function (c, W, H) {
      c.fillStyle = "#ecebe7"; c.fillRect(0, 0, W, H);
      var r = FC.rng(seed || 11);
      for (var i = 0; i < 16; i++) {
        var x0 = r() * W, y0 = r() * H, ang = (r() - 0.5) * 2.2, L = 260 + r() * 380, w = 48 + r() * 70;
        var ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, bend = (r() - 0.5) * L * 0.6;
        var x1 = x0 + ux * L, y1 = y0 + uy * L, mx = (x0 + x1) / 2 + nx * bend, my = (y0 + y1) / 2 + ny * bend;
        var g = c.createLinearGradient(x0 + nx * w, y0 + ny * w, x0 - nx * w, y0 - ny * w);
        g.addColorStop(0, "#050506"); g.addColorStop(0.45, "#2c2c2e"); g.addColorStop(0.55, "#5a5a5c"); g.addColorStop(1, "#0d0d0e");
        c.fillStyle = g;
        // лента: край с одной стороны — срез под углом (как у кисти), с другой — острый
        c.beginPath();
        c.moveTo(x0 + nx * w / 2, y0 + ny * w / 2);
        c.quadraticCurveTo(mx + nx * w / 2, my + ny * w / 2, x1 + nx * w * 0.15, y1 + ny * w * 0.15);
        c.lineTo(x1 + ux * w * 0.5, y1 + uy * w * 0.5);
        c.quadraticCurveTo(mx - nx * w / 2, my - ny * w / 2, x0 - nx * w / 2 - ux * w * 0.4, y0 - ny * w / 2 - uy * w * 0.4);
        c.closePath(); c.fill();
        // белые прорези-блики вдоль ленты
        c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 4 + r() * 4;
        c.beginPath(); c.moveTo(x0 + nx * w * 0.18, y0 + ny * w * 0.18); c.quadraticCurveTo(mx + nx * w * 0.18, my + ny * w * 0.18, x1 + nx * w * 0.05, y1 + ny * w * 0.05); c.stroke();
        if (r() < 0.6) { c.lineWidth = 2; c.beginPath(); c.moveTo(x0 - nx * w * 0.28, y0 - ny * w * 0.28); c.quadraticCurveTo(mx - nx * w * 0.28, my - ny * w * 0.28, x1 - nx * w * 0.1, y1 - ny * w * 0.1); c.stroke(); }
      }
    });
  }
  function rhombTex() {
    // геометрический орнамент ромбами (полоса над навесом, лента под вывеской)
    return canvasTex(512, 128, function (c, W, H) {
      c.fillStyle = "#efede8"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#151515";
      for (var x = 0; x < W; x += 64) {
        c.beginPath(); c.moveTo(x + 32, 8); c.lineTo(x + 60, 64); c.lineTo(x + 32, 120); c.lineTo(x + 4, 64); c.closePath(); c.fill();
        c.fillStyle = "#efede8"; c.beginPath(); c.moveTo(x + 32, 34); c.lineTo(x + 46, 64); c.lineTo(x + 32, 94); c.lineTo(x + 18, 64); c.closePath(); c.fill();
        c.fillStyle = "#151515"; c.fillRect(x + 28, 58, 8, 12);
        c.fillRect(x, 0, 64, 4); c.fillRect(x, H - 4, 64, 4);
      }
    });
  }
  var heroBuilt = new Map(), heroT = 0;
  function quadGeo(ax, az, bx, bz, y0, y1, u0, u1, y1b) {
    var g = new T.BufferGeometry(), yb = y1b == null ? y1 : y1b;
    g.setAttribute("position", new T.Float32BufferAttribute([ax, y0, az, bx, y0, bz, bx, yb, bz, ax, y1, az], 3));
    g.setAttribute("uv", new T.Float32BufferAttribute([u0, y0, u1, y0, u1, yb, u0, y1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g;
  }
  function buildHero(pl) {
    var X = pl.exterior, P0 = X.poly, n = P0.length, g = new T.Group(), H = X.h || 8, F = X.floors || 2, FH = H / F;
    // обход по часовой/против: наружная нормаль стены — от центра
    var cx = 0, cz = 0; P0.forEach(function (v) { cx += v[0]; cz += v[1]; }); cx /= n; cz /= n;
    var glass = X.glass || [], wallCol = new T.Color(X.wall || "#f1eee8");
    var wallMat = new T.MeshStandardMaterial({ color: wallCol, roughness: 0.85, side: T.DoubleSide });
    var orn = X.ornament && X.ornament.kind !== "calli" ? brushTex(X.ornament.color, X.ornament.density, FC.hash(pl.id)) : null;
    if (orn) { orn.wrapS = orn.wrapT = T.RepeatWrapping; orn.repeat.set(1 / 9, 1 / (H + 0.5)); }
    var ornMat = orn ? new T.MeshStandardMaterial({ map: orn, transparent: true, roughness: 0.9, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }) : null;
    var glassMat = new T.MeshStandardMaterial({ color: X.glassColor ? new T.Color(X.glassColor) : 0x324656, roughness: 0.08, metalness: 0.55, emissive: new T.Color(0xffb46a), emissiveIntensity: 0, side: T.DoubleSide });
    var frameMat = new T.MeshStandardMaterial({ color: 0x16181b, roughness: 0.5, metalness: 0.4 });
    function edge(i) {
      var a = P0[i], b = P0[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      var mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if ((mx + nx - cx) * (mx + nx - cx) + (mz + nz - cz) * (mz + nz - cz) < (mx - cx) * (mx - cx) + (mz - cz) * (mz - cz)) { nx = -nx; nz = -nz; }
      return { a: a, b: b, L: L, ux: ux, uz: uz, nx: nx, nz: nz, mx: mx, mz: mz };
    }
    // скатная крыша (shed): низкий край — стена shed.low, к противоположной стороне крыша поднимается на shed.rise
    var topY = function () { return H; };
    if (X.shed) {
      var eL = edge(X.shed.low), dmax = 0;
      P0.forEach(function (v) { dmax = Math.max(dmax, -((v[0] - eL.a[0]) * eL.nx + (v[1] - eL.a[1]) * eL.nz)); });
      topY = function (v) { var d = -((v[0] - eL.a[0]) * eL.nx + (v[1] - eL.a[1]) * eL.nz); return H + X.shed.rise * Math.max(0, Math.min(1, d / (dmax || 1))); };
    }
    var calli = X.ornament && X.ornament.kind === "calli" ? calliTex(FC.hash(pl.id)) : null;
    if (calli) { calli.wrapS = calli.wrapT = T.RepeatWrapping; }
    var calliMat = calli ? new T.MeshStandardMaterial({ map: calli, roughness: 0.9, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }) : null;
    var acc = 0;
    for (var i = 0; i < n; i++) {
      var e = edge(i);
      if (glass.indexOf(i) >= 0) {
        // стекло на всю высоту: тёплый свет внутри вечером, тёмные стойки и межэтажные пояса
        var gm = new T.Mesh(quadGeo(e.a[0], e.a[1], e.b[0], e.b[1], 0.3, H - 0.4, 0, e.L), glassMat); g.add(gm);
        for (var f = 1; f < F; f++) { var belt = new T.Mesh(new T.BoxGeometry(e.L + 0.05, 0.35, 0.18), frameMat); belt.position.set(e.mx + e.nx * 0.05, f * FH, e.mz + e.nz * 0.05); belt.rotation.y = Math.atan2(e.ux, e.uz) - Math.PI / 2; g.add(belt); }
        var posts = Math.max(1, Math.round(e.L / 1.3));
        if (X.xbrace) for (var kb = 0; kb < posts; kb++) for (var fb = 0; fb < F; fb++) {
          // X-связи в каждой клетке витража (стеклянная ротонда)
          var t0b = kb / posts, t1b = (kb + 1) / posts, ax = e.a[0] + (e.b[0] - e.a[0]) * t0b, az = e.a[1] + (e.b[1] - e.a[1]) * t0b, bx2 = e.a[0] + (e.b[0] - e.a[0]) * t1b, bz2 = e.a[1] + (e.b[1] - e.a[1]) * t1b;
          var ya = 0.3 + fb * FH, yb2 = Math.min(H - 0.4, (fb + 1) * FH), cw = Math.hypot(bx2 - ax, bz2 - az), ch2 = yb2 - ya, dl = Math.hypot(cw, ch2);
          [1, -1].forEach(function (sg) {
            var br = new T.Mesh(new T.BoxGeometry(0.05, dl, 0.05), frameMat);
            br.position.set((ax + bx2) / 2 + e.nx * 0.07, (ya + yb2) / 2, (az + bz2) / 2 + e.nz * 0.07);
            br.rotation.order = "YXZ"; br.rotation.y = Math.atan2(e.nx, e.nz); br.rotation.z = sg * Math.atan2(cw, ch2); g.add(br);
          });
        }
        for (var k = 0; k <= posts; k++) { var t = k / posts, pst = new T.Mesh(new T.BoxGeometry(0.08, H - 0.5, 0.12), frameMat); pst.position.set(e.a[0] + (e.b[0] - e.a[0]) * t + e.nx * 0.06, (H - 0.5) / 2 + 0.3, e.a[1] + (e.b[1] - e.a[1]) * t + e.nz * 0.06); g.add(pst); }
      } else {
        g.add(new T.Mesh(quadGeo(e.a[0], e.a[1], e.b[0], e.b[1], 0, topY(e.a), acc, acc + e.L, topY(e.b)), wallMat));
        if (calliMat && (!X.ornament.edges || X.ornament.edges.indexOf(i) >= 0)) {
          var ct = X.ornament.top || 3.4, cg = quadGeo(e.a[0] + e.nx * 0.03, e.a[1] + e.nz * 0.03, e.b[0] + e.nx * 0.03, e.b[1] + e.nz * 0.03, 0, ct, acc / 7, (acc + e.L) / 7);
          var uvs = cg.attributes.uv; for (var q = 0; q < 4; q++) uvs.setY(q, uvs.getY(q) / ct); uvs.needsUpdate = true;
          g.add(new T.Mesh(cg, calliMat));
        }
        if (ornMat) {
          var og = quadGeo(e.a[0] + e.nx * 0.04, e.a[1] + e.nz * 0.04, e.b[0] + e.nx * 0.04, e.b[1] + e.nz * 0.04, 0, H, acc, acc + e.L);
          g.add(new T.Mesh(og, ornMat));
        }
        // окна второго этажа и витрины первого: тёмное стекло, вечером светятся
        var nw = Math.floor((e.L - 1.5) / 2.6);
        for (var f2 = 0; f2 < F; f2++) for (var w = 0; w < nw; w++) {
          if (f2 === 0 && X.blindGround && X.blindGround.indexOf(i) >= 0) continue;
          if (f2 > 0 && X.upperWindows === false) continue;                  // глухой белый верх (как у кальянной с ротондой)
          if (f2 === 0 && X.groundEdges && X.groundEdges.indexOf(i) < 0) continue;
          var t2 = (w + 0.5) / nw, wx = e.a[0] + (e.b[0] - e.a[0]) * t2 + e.nx * 0.06, wz = e.a[1] + (e.b[1] - e.a[1]) * t2 + e.nz * 0.06;
          var ww = f2 === 0 ? (X.groundWin ? X.groundWin[0] : 1.9) : 1.5, wh = f2 === 0 ? (X.groundWin ? X.groundWin[1] : 2.1) : 1.6, wy = f2 * FH + (f2 === 0 ? 0.25 + wh / 2 : FH * 0.55);
          if (X.frames) {                                                   // чёрная рама с импостом — витрина, а не цветной прямоугольник
            var fr = new T.Mesh(new T.PlaneGeometry(ww + 0.2, wh + 0.2), frameMat); fr.position.set(wx, wy, wz); fr.rotation.y = Math.atan2(e.nx, e.nz); g.add(fr);
            var mul = new T.Mesh(new T.BoxGeometry(0.07, wh, 0.05), frameMat); mul.position.set(wx + e.nx * 0.04, wy, wz + e.nz * 0.04); mul.rotation.y = Math.atan2(e.nx, e.nz); g.add(mul);
            wx += e.nx * 0.015; wz += e.nz * 0.015;
          }
          var win = new T.Mesh(new T.PlaneGeometry(ww, wh), glassMat);
          win.position.set(wx, wy, wz); win.rotation.y = Math.atan2(e.nx, e.nz); g.add(win);
        }
      }
      acc += e.L;
    }
    // крыша: плоская, с парапетом
    var shape = new T.Shape(); P0.forEach(function (v, k) { if (k) shape.lineTo(v[0], -v[1]); else shape.moveTo(v[0], -v[1]); });
    // в нашей сборке three нет ShapeGeometry — крыша выдавливанием контура (заодно толщина плиты)
    if (X.shed) {
      var rp = [cx, 0, cz], ri = []; var cy = 0; P0.forEach(function (v) { cy += topY(v); }); rp[1] = cy / n;
      P0.forEach(function (v) { rp.push(v[0], topY(v), v[1]); });
      for (var ti = 0; ti < n; ti++) ri.push(0, 1 + ti, 1 + (ti + 1) % n);
      var rg = new T.BufferGeometry(); rg.setAttribute("position", new T.Float32BufferAttribute(rp, 3)); rg.setIndex(ri); rg.computeVertexNormals();
      g.add(new T.Mesh(rg, new T.MeshStandardMaterial({ color: new T.Color(X.roof || "#4b4d50"), roughness: 0.8, side: T.DoubleSide })));
    } else {
      var roof = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false }), new T.MeshStandardMaterial({ color: new T.Color(X.roof || "#4b4d50"), roughness: 0.95 }));
      roof.rotation.x = -Math.PI / 2; roof.position.y = H - 0.35; g.add(roof);
    }
    // полосы орнамента ромбами (над навесом и т. п.): bands [{edges, y0, y1}]
    (X.bands || []).forEach(function (bd) {
      var rt = rhombTex(); rt.wrapS = T.RepeatWrapping;
      (bd.edges || []).forEach(function (ei) {
        var e = edge(ei), hgt = bd.y1 - bd.y0, m = new T.Mesh(new T.PlaneGeometry(e.L, hgt), new T.MeshStandardMaterial({ map: rt.clone(), roughness: 0.85 }));
        m.material.map.repeat.set(e.L / (hgt * 4), 1); m.material.map.needsUpdate = true;
        m.position.set(e.mx + e.nx * 0.05, (bd.y0 + bd.y1) / 2, e.mz + e.nz * 0.05); m.rotation.y = Math.atan2(e.nx, e.nz); g.add(m);
      });
    });
    // круглое окно-иллюминатор на фронтоне: тёмное стекло, белая рама, вечером подсвечено с логотипом
    if (X.porthole) {
      var ep = edge(X.porthole.edge), pr = X.porthole.r || 0.8, tp = X.porthole.t == null ? 0.5 : X.porthole.t;
      var px = ep.a[0] + (ep.b[0] - ep.a[0]) * tp + ep.nx * 0.06, pz = ep.a[1] + (ep.b[1] - ep.a[1]) * tp + ep.nz * 0.06, py = X.porthole.y || H - 2;
      var pm2 = new T.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.1, metalness: 0.5, emissive: new T.Color(0xffffff), emissiveIntensity: 0 });
      if (pl.img && pl.img.complete) { var pt2 = new T.CanvasTexture(pl.img); pt2.colorSpace = T.SRGBColorSpace; pm2.emissiveMap = pt2; }
      var disc2 = new T.Mesh(new T.CircleGeometry(pr, 32), pm2); disc2.position.set(px, py, pz); disc2.rotation.y = Math.atan2(ep.nx, ep.nz); g.add(disc2);
      var rim = new T.Mesh(new T.TorusGeometry(pr + 0.05, 0.08, 8, 40), new T.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5 })); rim.position.copy(disc2.position); rim.rotation.y = disc2.rotation.y; g.add(rim);
      g.userData.porthole = pm2;
    }
    // пристройка: остеклённая летняя терраса в чёрных рамах (annex {edge, depth, h}) — внутри диваны из поддонов, канаты, огоньки
    if (X.annex) {
      var ea, dep, ah = X.annex.h || 3.2, a0, b0, a1, b1;
      if (X.annex.quad) {
        // контур четырьмя точками [у дома a, у дома b, снаружи b, снаружи a] — терраса не обязана стоять на ребре контура
        var Q = X.annex.quad; a0 = Q[0]; b0 = Q[1]; b1 = Q[2]; a1 = Q[3];
        var qL = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1; dep = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
        ea = { a: a0, b: b0, L: qL, ux: (b0[0] - a0[0]) / qL, uz: (b0[1] - a0[1]) / qL, nx: (a1[0] - a0[0]) / dep, nz: (a1[1] - a0[1]) / dep };
      } else {
        ea = edge(X.annex.edge); dep = X.annex.depth || 5;
        a0 = ea.a; b0 = ea.b; a1 = [a0[0] + ea.nx * dep, a0[1] + ea.nz * dep]; b1 = [b0[0] + ea.nx * dep, b0[1] + ea.nz * dep];
      }
      [[a0, a1], [a1, b1], [b1, b0]].forEach(function (sg) {
        g.add(new T.Mesh(quadGeo(sg[0][0], sg[0][1], sg[1][0], sg[1][1], 0.2, ah - 0.25, 0, 1), glassMat));
        var Ls = Math.hypot(sg[1][0] - sg[0][0], sg[1][1] - sg[0][1]), np = Math.max(1, Math.round(Ls / 1.4));
        for (var k2 = 0; k2 <= np; k2++) { var tt2 = k2 / np, po = new T.Mesh(new T.BoxGeometry(0.08, ah, 0.08), frameMat); po.position.set(sg[0][0] + (sg[1][0] - sg[0][0]) * tt2, ah / 2, sg[0][1] + (sg[1][1] - sg[0][1]) * tt2); g.add(po); }
        var top2 = new T.Mesh(new T.BoxGeometry(Ls, 0.25, 0.12), frameMat); top2.position.set((sg[0][0] + sg[1][0]) / 2, ah - 0.12, (sg[0][1] + sg[1][1]) / 2); top2.rotation.y = -Math.atan2(sg[1][1] - sg[0][1], sg[1][0] - sg[0][0]); g.add(top2);
        var bot = top2.clone(); bot.position.y = 0.12; g.add(bot);
      });
      var shp = new T.Shape(); [a0, a1, b1, b0].forEach(function (v, k3) { if (k3) shp.lineTo(v[0], -v[1]); else shp.moveTo(v[0], -v[1]); });
      var ar = new T.Mesh(new T.ExtrudeGeometry(shp, { depth: 0.2, bevelEnabled: false }), frameMat); ar.rotation.x = -Math.PI / 2; ar.position.y = ah - 0.05; g.add(ar);
      var wood = new T.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.85 }), rope = new T.MeshStandardMaterial({ color: 0xc9a26b, roughness: 0.9 });
      for (var s2 = 0; s2 < 3; s2++) {
        var ts = (s2 + 0.5) / 3, sx2 = a0[0] + (b0[0] - a0[0]) * ts + ea.nx * dep * 0.55, sz2 = a0[1] + (b0[1] - a0[1]) * ts + ea.nz * dep * 0.55;
        var sofa2 = new T.Mesh(new T.BoxGeometry(1.8, 0.45, 0.8), wood); sofa2.position.set(sx2, 0.42, sz2); sofa2.rotation.y = Math.atan2(ea.ux, ea.uz); g.add(sofa2);
        for (var rk = 0; rk < 5; rk++) { var rpz = new T.Mesh(new T.BoxGeometry(0.03, ah - 0.4, 0.03), rope); rpz.position.set(sx2 + ea.ux * 1.3 + ea.nx * (rk - 2) * 0.35, (ah - 0.4) / 2 + 0.2, sz2 + ea.uz * 1.3 + ea.nz * (rk - 2) * 0.35); rpz.rotation.z = 0.35 * (rk % 2 ? 1 : -1); g.add(rpz); }
      }
      g.userData.annexLights = [];
      for (var lb = 0; lb < 14; lb++) { var tl = lb / 13, bulb = new T.Mesh(new T.SphereGeometry(0.06, 6, 4), new T.MeshBasicMaterial({ color: 0xffd79a })); bulb.position.set(a1[0] + (b1[0] - a1[0]) * tl - ea.nx * 0.4, ah - 0.45 - Math.sin(tl * Math.PI) * 0.25, a1[1] + (b1[1] - a1[1]) * tl - ea.nz * 0.4); g.add(bulb); }
    }
    // ограда вдоль бордюра (fence {edge, dist, color})
    if (X.fence) {
      var ef = edge(X.fence.edge), fd = X.fence.dist || 6, fmw = new T.MeshStandardMaterial({ color: new T.Color(X.fence.color || "#eceae5"), roughness: 0.5, metalness: 0.3 });
      var fx0 = ef.a[0] + ef.nx * fd - ef.ux * 3, fz0 = ef.a[1] + ef.nz * fd - ef.uz * 3, FL = ef.L + 6;
      [0.95, 0.5].forEach(function (yy) { var rl = new T.Mesh(new T.BoxGeometry(FL, 0.06, 0.06), fmw); rl.position.set(fx0 + ef.ux * FL / 2, yy, fz0 + ef.uz * FL / 2); rl.rotation.y = Math.atan2(ef.ux, ef.uz) - Math.PI / 2; g.add(rl); });
      for (var fp = 0; fp <= FL / 0.22; fp++) { var bar = new T.Mesh(new T.BoxGeometry(0.03, 0.95, 0.03), fmw); bar.position.set(fx0 + ef.ux * fp * 0.22, 0.47, fz0 + ef.uz * fp * 0.22); g.add(bar); }
    }
    // козырёк над входом: тёмная плита, по фронту — полоса мазков
    (X.canopy ? [].concat(X.canopy.edges || [X.canopy.edge]) : []).forEach(function (ei) {
      var e = edge(ei), C = X.canopy, d = C.depth || 1.8, ch = C.h || 3.3;
      var slab = new T.Mesh(new T.BoxGeometry(e.L, 0.22, d), new T.MeshStandardMaterial({ color: new T.Color(C.color || "#1b1b1d"), roughness: 0.7 }));
      slab.position.set(e.mx + e.nx * d / 2, ch, e.mz + e.nz * d / 2); slab.rotation.y = Math.atan2(e.ux, e.uz) - Math.PI / 2; g.add(slab);
      var bandTex = X.ornament && X.ornament.kind === "calli" ? calliTex(FC.hash(pl.id) + 3) : brushTex("#121212", 1.6, FC.hash(pl.id) + 3);
      if (X.ornament && X.ornament.kind === "calli") { bandTex.wrapS = T.RepeatWrapping; bandTex.repeat.set(e.L / 6, 0.35); }
      var band = new T.Mesh(new T.PlaneGeometry(e.L, 0.75), new T.MeshStandardMaterial({ map: bandTex, color: 0xffffff, roughness: 0.8 }));
      var bb = new T.Mesh(new T.PlaneGeometry(e.L, 0.75), new T.MeshStandardMaterial({ color: wallCol, roughness: 0.8 }));
      [bb, band].forEach(function (m, q) { m.position.set(e.mx + e.nx * (d + 0.01 + q * 0.01), ch + 0.45, e.mz + e.nz * (d + 0.01 + q * 0.01)); m.rotation.y = Math.atan2(e.nx, e.nz); if (q) m.material.transparent = true; g.add(m); });
      for (var k = 0; k < 6; k++) { var lamp = new T.Mesh(new T.BoxGeometry(0.25, 0.05, 0.25), new T.MeshBasicMaterial({ color: 0xffd9a0 })); var t3 = (k + 0.5) / 6; lamp.position.set(e.a[0] + (e.b[0] - e.a[0]) * t3 + e.nx * d * 0.6, ch - 0.13, e.a[1] + (e.b[1] - e.a[1]) * t3 + e.nz * d * 0.6); g.add(lamp); }
    });
    // круглый световой логотип: чёрный круг, белое кольцо, картинка
    if (X.logo && pl.img) {
      var e2 = edge(X.logo.edge), Ld = X.logo.d || 2.2, t4 = X.logo.t == null ? 0.5 : X.logo.t;
      var lx = e2.a[0] + (e2.b[0] - e2.a[0]) * t4 + e2.nx * 0.18, lz = e2.a[1] + (e2.b[1] - e2.a[1]) * t4 + e2.nz * 0.18, ly = X.logo.y || H - 2;
      var ltex = new T.CanvasTexture(pl.img); ltex.colorSpace = T.SRGBColorSpace; ltex.needsUpdate = true;
      var disc = new T.Mesh(new T.CircleGeometry(Ld / 2, 40), new T.MeshBasicMaterial({ map: ltex, toneMapped: false }));
      disc.position.set(lx, ly, lz); disc.rotation.y = Math.atan2(e2.nx, e2.nz); g.add(disc);
      var ring = new T.Mesh(new T.TorusGeometry(Ld / 2 + 0.04, 0.06, 8, 48), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      ring.position.copy(disc.position); ring.rotation.y = disc.rotation.y; g.add(ring);
      var can = new T.Mesh(new T.CylinderGeometry(Ld / 2 + 0.06, Ld / 2 + 0.06, 0.25, 40), new T.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.5 }));
      can.rotation.z = Math.PI / 2; can.rotation.y = disc.rotation.y + Math.PI / 2; can.position.set(lx - e2.nx * 0.14, ly, lz - e2.nz * 0.14); g.add(can);   // короб целиком за кругом (раньше его торец закрывал картинку)
    }
    // терраса: ограда и столы под зонтами вдоль стены
    if (X.terrace) {
      var e3 = edge(X.terrace.edge), dd = X.terrace.depth || 3.5, fm = new T.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.5 });
      var fx0 = e3.a[0] + e3.nx * dd, fz0 = e3.a[1] + e3.nz * dd, fx1 = e3.b[0] + e3.nx * dd, fz1 = e3.b[1] + e3.nz * dd;
      var rail = new T.Mesh(new T.BoxGeometry(e3.L, 0.06, 0.06), fm); rail.position.set((fx0 + fx1) / 2, 1.0, (fz0 + fz1) / 2); rail.rotation.y = Math.atan2(e3.ux, e3.uz) - Math.PI / 2; g.add(rail);
      var rail2 = rail.clone(); rail2.position.y = 0.55; g.add(rail2);
      for (var k4 = 0; k4 <= Math.round(e3.L / 1.5); k4++) { var tt = k4 / Math.round(e3.L / 1.5), post = new T.Mesh(new T.BoxGeometry(0.06, 1.05, 0.06), fm); post.position.set(fx0 + (fx1 - fx0) * tt, 0.52, fz0 + (fz1 - fz0) * tt); g.add(post); }
      for (var k5 = 0; k5 < Math.floor(e3.L / 3.5); k5++) {
        var t5 = (k5 + 0.5) / Math.floor(e3.L / 3.5), tx = e3.a[0] + (e3.b[0] - e3.a[0]) * t5 + e3.nx * dd * 0.5, tz = e3.a[1] + (e3.b[1] - e3.a[1]) * t5 + e3.nz * dd * 0.5;
        var tb = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.05, 14), new T.MeshStandardMaterial({ color: 0x5a4030 })); tb.position.set(tx, 0.74, tz); g.add(tb);
        var leg = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.72, 6), fm); leg.position.set(tx, 0.36, tz); g.add(leg);
      }
    }
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData.glass = glassMat;
    root.add(g);
    return g;
  }
  /* ---- здания-«герои» районов: свой фасад по стилю (exterior.style) ------------------------------------------------------
   * style: bands — стекло с белыми поясами по этажам (башни «Маяка Минска»), brick — кирпич с белыми рамами, render —
   * штукатурка с тёмными окнами, pastel — пастель старого города (наличники, карниз). Плитка фасада = пролёт × этаж,
   * рисуется холстом; стены — по настоящему контуру. Дополнительно: podium {h, kind: "shops"|"arcade", color} — первый
   * этаж (витрины или белая аркада), steps [[с этажа, отступ м]…] — уступы верхних этажей, arch {w, h} — сквозная арка
   * по короткой оси (две башни и мост сверху), crown {h, color} — венчающий пояс, roof — цвет крыши.
   * Цвета: colors {glass, band, wall, frame, trim}. Размер пролёта — bay (м), этаж — h / floors. */
  var FAC = {};
  function facadeTile(style, C) {
    var key = style + "|" + JSON.stringify(C || {});
    if (FAC[key]) return FAC[key];
    C = C || {};
    function tile(draw) { var t = canvasTex(256, 256, draw); t.wrapS = t.wrapT = T.RepeatWrapping; return t; }
    var win = { x0: 0.16, x1: 0.84, y0: 0.18, y1: 0.78 };
    var map = tile(function (c, W, H) {
      if (style === "bands") {
        var g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, C.glass || "#4f7fae"); g.addColorStop(0.55, C.glass2 || "#2e5279"); g.addColorStop(1, C.glass || "#4f7fae");
        c.fillStyle = g; c.fillRect(0, 0, W, H);
        c.fillStyle = "rgba(255,255,255,.18)"; c.beginPath(); c.moveTo(W * 0.1, 0); c.lineTo(W * 0.45, 0); c.lineTo(W * 0.05, H * 0.72); c.lineTo(0, H * 0.72); c.fill();
        c.fillStyle = C.band || "#f2f4f6"; c.fillRect(0, H * 0.72, W, H * 0.28);
        c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(0, H * 0.72, W, 3);
        c.fillStyle = C.frame || "#c9d3dc"; c.fillRect(0, 0, 3, H * 0.72); c.fillRect(W / 2 - 1, 0, 2, H * 0.72);
        win = { x0: 0.02, x1: 0.98, y0: 0.0, y1: 0.7 };
      } else if (style === "brick") {
        c.fillStyle = C.wall || "#8e3f30"; c.fillRect(0, 0, W, H);
        c.strokeStyle = "rgba(255,240,230,.18)"; c.lineWidth = 1;
        for (var y = 0; y < H; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); for (var x = (y / 8) % 2 ? 0 : 12; x < W; x += 24) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 8); c.stroke(); } }
        c.fillStyle = C.frame || "#f1efe9"; c.fillRect(W * 0.2 - 5, H * 0.2 - 5, W * 0.6 + 10, H * 0.56 + 10);
        c.fillStyle = C.glass || "#2c3742"; c.fillRect(W * 0.2, H * 0.2, W * 0.6, H * 0.56);
        c.fillStyle = C.frame || "#f1efe9"; c.fillRect(W / 2 - 2, H * 0.2, 4, H * 0.56); c.fillRect(W * 0.2, H * 0.42, W * 0.6, 3);
        win = { x0: 0.2, x1: 0.8, y0: 0.24, y1: 0.8 };
      } else if (style === "stripes") {
        // белые панели, песочный пояс на уровне перекрытия, остеклённая лоджия с голубоватым стеклом (башни бульвара «Маяка»)
        c.fillStyle = C.wall || "#f2f0ea"; c.fillRect(0, 0, W, H);
        c.fillStyle = C.band || "#d9c19c"; c.fillRect(0, H * 0.78, W, H * 0.22);
        c.fillStyle = C.frame || "#ffffff"; c.fillRect(W * 0.12 - 4, H * 0.12 - 4, W * 0.76 + 8, H * 0.6 + 8);
        var gg = c.createLinearGradient(0, H * 0.12, 0, H * 0.72); gg.addColorStop(0, C.glass || "#9cc0dc"); gg.addColorStop(1, C.glass2 || "#6f97b8");
        c.fillStyle = gg; c.fillRect(W * 0.12, H * 0.12, W * 0.76, H * 0.6);
        c.fillStyle = C.frame || "#ffffff"; c.fillRect(W * 0.5 - 2, H * 0.12, 4, H * 0.6); c.fillRect(W * 0.12, H * 0.5, W * 0.76, 3);
        win = { x0: 0.12, x1: 0.88, y0: 0.28, y1: 0.88 };
      } else if (style === "grid") {
        // сетка белых и графитовых рам с цветной вставкой у окна — у каждого квартала «Минск-Мира» свой цвет вставки
        c.fillStyle = C.wall || "#f2f4f6"; c.fillRect(0, 0, W, H);
        c.fillStyle = C.frame || "#3a3d42"; c.fillRect(0, H * 0.84, W, H * 0.16); c.fillRect(W * 0.66, 0, 6, H);
        c.fillStyle = C.accent || "#4a78b5"; c.fillRect(W * 0.7, H * 0.1, W * 0.26, H * 0.7);
        c.fillStyle = C.glass || "#2c3440"; c.fillRect(W * 0.08, H * 0.1, W * 0.54, H * 0.7);
        c.fillStyle = "rgba(255,255,255,.14)"; c.fillRect(W * 0.08, H * 0.1, W * 0.16, H * 0.7);
        if (C.accent2) { c.fillStyle = C.accent2; c.fillRect(W * 0.7, H * 0.1, W * 0.26, H * 0.32); }
        win = { x0: 0.08, x1: 0.62, y0: 0.2, y1: 0.9 };
      } else if (style === "ribs") {
        // металлическая облицовка с вертикальными рёбрами (красный фасад торгового центра)
        c.fillStyle = C.wall || "#c8202f"; c.fillRect(0, 0, W, H);
        for (var rx = 0; rx < W; rx += 32) { c.fillStyle = C.rib || "#9c1622"; c.fillRect(rx, 0, 9, H); c.fillStyle = "rgba(255,255,255,.14)"; c.fillRect(rx + 9, 0, 3, H); }
        win = { x0: 0, x1: 0, y0: 0, y1: 0 };
      } else if (style === "pastel") {
        c.fillStyle = C.wall || "#f2c9a0"; c.fillRect(0, 0, W, H);
        c.fillStyle = "rgba(0,0,0,.06)"; for (var k = 0; k < 40; k++) c.fillRect(Math.random() * W, Math.random() * H, 2, 2);
        c.fillStyle = C.trim || "#fbf7ee"; c.fillRect(W * 0.28 - 8, H * 0.14 - 10, W * 0.44 + 16, H * 0.64 + 18);
        c.fillStyle = C.glass || "#33403f"; c.fillRect(W * 0.28, H * 0.14, W * 0.44, H * 0.64);
        c.fillStyle = C.trim || "#fbf7ee"; c.fillRect(W / 2 - 2, H * 0.14, 4, H * 0.64); c.fillRect(W * 0.28, H * 0.36, W * 0.44, 3);
        c.fillRect(0, 0, W, 6);
        win = { x0: 0.28, x1: 0.72, y0: 0.22, y1: 0.86 };
      } else {                                                          // render
        c.fillStyle = C.wall || "#e8e3d9"; c.fillRect(0, 0, W, H);
        c.fillStyle = C.frame || "#3b3f45"; c.fillRect(W * 0.18 - 4, H * 0.18 - 4, W * 0.64 + 8, H * 0.58 + 8);
        c.fillStyle = C.glass || "#26303a"; c.fillRect(W * 0.18, H * 0.18, W * 0.64, H * 0.58);
        c.fillStyle = "rgba(255,255,255,.12)"; c.fillRect(W * 0.18, H * 0.18, W * 0.2, H * 0.58);
        win = { x0: 0.18, x1: 0.82, y0: 0.24, y1: 0.82 };
      }
    });
    // ночной свет окон — та же плитка: светятся только окна (вечером тёплым)
    var em = tile(function (c, W, H) {
      c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
      c.fillStyle = style === "bands" ? "#ffe6c0" : "#ffcf8f"; c.fillRect(W * win.x0, H * (1 - win.y1), W * (win.x1 - win.x0), H * (win.y1 - win.y0));
    });
    FAC[key] = { map: map, em: em };
    return FAC[key];
  }
  // стены здания копим по материалам и собираем одним мешем на материал (154 дома «Минск-Мира» — не тысячи вызовов отрисовки)
  var ACC = null;
  function wallsUV(poly, y0, y1, bay, fh, mat, g, open) {
    var n = poly.length, own = !ACC;
    if (own) ACC = new Map();
    var A = ACC.get(mat); if (!A) { A = { p: [], n: [], uv: [], idx: [] }; ACC.set(mat, A); }
    var cx = 0, cz = 0; poly.forEach(function (v) { cx += v[0]; cz += v[1]; }); cx /= n; cz /= n;
    for (var i = 0; i < n; i++) {
      if (open && !open(i)) continue;
      var a = poly[i], b = poly[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.2) continue;
      var reps = Math.max(1, Math.round(L / bay)), v0 = y0 / fh, v1 = y1 / fh, k = A.p.length / 3;
      var nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if ((mx + nx - cx) * (mx + nx - cx) + (mz + nz - cz) * (mz + nz - cz) < (mx - cx) * (mx - cx) + (mz - cz) * (mz - cz)) { nx = -nx; nz = -nz; }
      A.p.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
      for (var q = 0; q < 4; q++) A.n.push(nx, 0, nz);
      A.uv.push(0, v0, reps, v0, reps, v1, 0, v1);
      A.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    if (own) flushWalls(g);
  }
  function flushWalls(g) {
    if (!ACC) return;
    ACC.forEach(function (A, mat) {
      if (!A.p.length) return;
      var geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(A.p, 3)); geo.setAttribute("normal", new T.Float32BufferAttribute(A.n, 3));
      geo.setAttribute("uv", new T.Float32BufferAttribute(A.uv, 2)); geo.setIndex(A.idx);
      g.add(new T.Mesh(geo, mat));
    });
    ACC = null;
  }
  function capPoly(poly, y, mat, g) {
    var sh = new T.Shape(); poly.forEach(function (v, k) { if (k) sh.lineTo(v[0], -v[1]); else sh.moveTo(v[0], -v[1]); });
    var m = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }), mat); m.rotation.x = -Math.PI / 2; m.position.y = y - 0.3; g.add(m);
  }
  function roofSlope(poly, y, h, d, mat, g) {
    var top = inset(poly, d), n = poly.length, pos = [], idx = [];
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n], ta = top[i], tb = top[(i + 1) % n], k = pos.length / 3;
      pos.push(a[0], y, a[1], b[0], y, b[1], tb[0], y + h, tb[1], ta[0], y + h, ta[1]);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    var geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    g.add(new T.Mesh(geo, mat));
    capPoly(top, y + h + 0.05, mat, g);
  }
  function inset(poly, d) {
    var n = poly.length, cx = 0, cz = 0; poly.forEach(function (v) { cx += v[0]; cz += v[1]; }); cx /= n; cz /= n;
    var r = 0; poly.forEach(function (v) { r += Math.hypot(v[0] - cx, v[1] - cz); }); r /= n;
    var k = Math.max(0.2, 1 - d / Math.max(r, 1));
    return poly.map(function (v) { return [cx + (v[0] - cx) * k, cz + (v[1] - cz) * k]; });
  }
  function obb(poly) {
    // ориентированная коробка контура: ось по самой длинной стене
    var best = 0, ux = 1, uz = 0;
    for (var i = 0; i < poly.length; i++) { var a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; ux = (b[0] - a[0]) / L; uz = (b[1] - a[1]) / L; } }
    var vx = -uz, vz = ux, mn = [1e9, 1e9], mx = [-1e9, -1e9];
    poly.forEach(function (p) { var s = p[0] * ux + p[1] * uz, t = p[0] * vx + p[1] * vz; mn[0] = Math.min(mn[0], s); mx[0] = Math.max(mx[0], s); mn[1] = Math.min(mn[1], t); mx[1] = Math.max(mx[1], t); });
    function P(s, t) { return [ux * s + vx * t, uz * s + vz * t]; }
    return { P: P, s0: mn[0], s1: mx[0], t0: mn[1], t1: mx[1] };
  }
  function buildVault(pl) {
    // мост арки с полуциркульным сводом снизу (Арка «Маяка Минска»): форма в плоскости поперёк проёма, выдавлена вдоль
    // толщины корпуса; по дуге — розово-малиновая LED-линия (вечером ярче)
    var X = pl.exterior, V = X.vault, g = new T.Group(), H = X.h || 41, r = V.r, sp = V.spring, L = V.x1 - V.x0;
    var sh = new T.Shape(); sh.moveTo(-r, H); sh.lineTo(-r, sp); sh.absarc(0, sp, r, Math.PI, 0, true); sh.lineTo(r, H); sh.lineTo(-r, H);
    var geo = new T.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false, curveSegments: 28 }), pa = geo.attributes.position;
    for (var i = 0; i < pa.count; i++) { var u = pa.getX(i), v = pa.getY(i), w = pa.getZ(i); pa.setXYZ(i, V.x0 + w, v, V.c + u); }
    pa.needsUpdate = true; geo.computeVertexNormals();
    var m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: new T.Color(X.colors && X.colors.wall || "#f2f0ea"), roughness: 0.75 }));
    m.castShadow = m.receiveShadow = true; g.add(m);
    var led = new T.MeshBasicMaterial({ color: new T.Color(V.led || "#ff3fa6"), toneMapped: false });
    [V.x0 - 0.06, V.x1 + 0.06].forEach(function (x) {
      var ring = new T.Mesh(new T.TorusGeometry(r - 0.15, 0.09, 6, 40, Math.PI), led);
      ring.position.set(x, sp, V.c); ring.rotation.y = Math.PI / 2; g.add(ring);
    });
    g.userData.led = led; root.add(g); return g;
  }
  function buildStyled(pl) {
    if (pl.exterior.vault) return buildVault(pl);
    ACC = new Map();
    var X = pl.exterior, g = new T.Group(), H = X.h || 30, F = X.floors || Math.round(H / 3.1), FH = H / F, bay = X.bay || 3.2;
    var tileT = facadeTile(X.style, X.colors), mat = new T.MeshStandardMaterial({ map: tileT.map, emissiveMap: tileT.em, emissive: new T.Color(0xffffff), emissiveIntensity: 0, roughness: X.style === "bands" ? 0.25 : 0.85, metalness: X.style === "bands" ? 0.35 : 0, side: T.DoubleSide });
    var roofM = new T.MeshStandardMaterial({ color: new T.Color(X.roof || "#55585c"), roughness: 0.9 });
    var pod = X.podium, y0 = X.base != null ? X.base : pod ? pod.h : 0;           // base — здание начинается выше земли (мост арки)
    var blocks = [{ poly: X.poly, y0: y0, y1: H }];
    if (X.arch) {
      // сквозная арка по короткой оси: две башни по бокам и мост над проёмом
      var o = obb(X.poly), mid = (o.s0 + o.s1) / 2, hw = (X.arch.w || 10) / 2;
      function rect(s0, s1) { return [o.P(s0, o.t0), o.P(s1, o.t0), o.P(s1, o.t1), o.P(s0, o.t1)]; }
      blocks = [{ poly: rect(o.s0, mid - hw), y0: y0, y1: H }, { poly: rect(mid + hw, o.s1), y0: y0, y1: H }, { poly: rect(mid - hw, mid + hw), y0: X.arch.h || H * 0.65, y1: H }];
      if (pod) pod.cut = rect(mid - hw, mid + hw);
    }
    blocks.forEach(function (bk) {
      var poly = bk.poly, yA = bk.y0;
      var steps = (X.steps || []).slice().sort(function (a, b) { return a[0] - b[0]; });
      steps.forEach(function (st) {
        var yS = Math.min(bk.y1, st[0] * FH);
        if (yS > yA) { wallsUV(poly, yA, yS, bay, FH, mat, g); capPoly(poly, yS, roofM, g); }
        poly = inset(poly, st[1]); yA = Math.max(yA, yS);
      });
      if (bk.y1 > yA) wallsUV(poly, yA, bk.y1, bay, FH, mat, g);
      if (X.pitch) roofSlope(poly, bk.y1, X.pitch.h || 4, X.pitch.d || 4, new T.MeshStandardMaterial({ color: new T.Color(X.pitch.color || X.roof || "#5e4038"), roughness: 0.55, metalness: 0.35, side: T.DoubleSide }), g);
      else capPoly(poly, bk.y1, roofM, g);
      if (X.base != null && X.base > 0) capPoly(poly, X.base + 0.3, roofM, g);   // низ моста над проёмом
      if (X.crown) { var cm = new T.MeshStandardMaterial({ color: new T.Color(X.crown.color || "#f2f4f6"), roughness: 0.6 }); wallsUV(poly, bk.y1 - (X.crown.h || 1.2), bk.y1 + 0.4, 100, 100, cm, g); }
    });
    if (pod) {
      // первый этаж: витрины (тёмное стекло, вечером светятся) или белая аркада с арками
      var pm;
      if (pod.kind === "arcade") {
        var at = canvasTex(256, 256, function (c, W, Hh) {
          c.fillStyle = pod.color || "#f3f1ea"; c.fillRect(0, 0, W, Hh);
          c.fillStyle = "#2a2f36"; c.beginPath(); c.moveTo(W * 0.14, Hh); c.lineTo(W * 0.14, Hh * 0.42); c.arc(W / 2, Hh * 0.42, W * 0.36, Math.PI, 0); c.lineTo(W * 0.86, Hh); c.fill();
          c.fillStyle = "rgba(255,214,150,.35)"; c.fillRect(W * 0.2, Hh * 0.55, W * 0.6, Hh * 0.45);
        });
        at.wrapS = at.wrapT = T.RepeatWrapping;
        pm = new T.MeshStandardMaterial({ map: at, roughness: 0.8, side: T.DoubleSide });
      } else {
        // витрины первого этажа: алюминиевые рамы, стекло с отражением и тёплым светом зала, фриз под вывеску, цоколь
        var fr = pod.frame || "#3a3d42", fz = pod.fascia || "#dcd8d1";
        var stt = canvasTex(256, 256, function (c, W, Hh) {
          c.fillStyle = fz; c.fillRect(0, 0, W, Hh * 0.2);
          var gg = c.createLinearGradient(0, Hh * 0.2, 0, Hh * 0.92); gg.addColorStop(0, "#5f7380"); gg.addColorStop(0.45, "#8fa4b0"); gg.addColorStop(1, "#b9a98e");
          c.fillStyle = gg; c.fillRect(0, Hh * 0.2, W, Hh * 0.72);
          c.fillStyle = "rgba(255,236,200,.35)"; c.fillRect(W * 0.08, Hh * 0.55, W * 0.84, Hh * 0.37);           // свет зала, полки
          c.fillStyle = "rgba(60,50,40,.35)"; for (var k = 0; k < 4; k++) c.fillRect(W * (0.12 + k * 0.2), Hh * 0.62, W * 0.12, Hh * 0.22);
          c.fillStyle = "rgba(255,255,255,.22)"; c.beginPath(); c.moveTo(W * 0.15, Hh * 0.2); c.lineTo(W * 0.4, Hh * 0.2); c.lineTo(W * 0.12, Hh * 0.9); c.lineTo(0, Hh * 0.9); c.fill();
          c.fillStyle = fr; c.fillRect(0, Hh * 0.19, W, 6); c.fillRect(0, Hh * 0.2, 8, Hh * 0.72); c.fillRect(W / 2 - 3, Hh * 0.2, 6, Hh * 0.72); c.fillRect(0, Hh * 0.9, W, 6);
          c.fillStyle = "#4a4743"; c.fillRect(0, Hh * 0.92, W, Hh * 0.08);
        });
        stt.wrapS = stt.wrapT = T.RepeatWrapping;
        var sem = canvasTex(256, 256, function (c, W, Hh) { c.fillStyle = "#000"; c.fillRect(0, 0, W, Hh); c.fillStyle = "#ffdcaa"; c.fillRect(8, Hh * 0.22, W - 16, Hh * 0.68); });
        sem.wrapS = sem.wrapT = T.RepeatWrapping;
        pm = new T.MeshStandardMaterial({ map: stt, emissiveMap: sem, emissive: new T.Color(0xffffff), emissiveIntensity: 0, roughness: 0.3, metalness: 0.2, side: T.DoubleSide });
      }
      wallsUV(X.poly, 0, pod.h, pod.bay || 4.5, pod.h, pm, g);
      capPoly(X.poly, pod.h, roofM, g);
      g.userData.pod = pm;
    }
    flushWalls(g);
    (X.towers || []).forEach(function (tw) {
      // круглая башенка на углу: барабан в цвет фасада, купол (ТЦ «Метрополь» на Немиге)
      var r = tw.r || 4, th = tw.h || H + 6;
      var drum = new T.Mesh(new T.CylinderGeometry(r, r, th, 24, 1, true), mat.clone()); drum.material.map = mat.map.clone(); drum.material.map.needsUpdate = true;
      drum.material.map.repeat.set(Math.round(2 * Math.PI * r / bay), th / FH); drum.position.set(tw.x, th / 2, tw.z); g.add(drum);
      var dome = new T.Mesh(new T.SphereGeometry(r * 1.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: new T.Color(tw.dome || "#9e3b32"), roughness: 0.45, metalness: 0.4 }));
      dome.position.set(tw.x, th, tw.z); g.add(dome);
      var spire = new T.Mesh(new T.ConeGeometry(0.25, 2.4, 8), dome.material); spire.position.set(tw.x, th + r + 1.1, tw.z); g.add(spire);
    });
    g.traverse(function (o2) { if (o2.isMesh) { o2.castShadow = true; o2.receiveShadow = true; } });
    g.userData.facade = mat;
    root.add(g);
    return g;
  }
  /* ---- улицы и бульвары мест (streets): мощение, деревья-шары, лавки, фонари, фонтаны, скульптуры ------------------------
   * streets: [{points: [[x, z]…], width, paving: {a, b, tile}, rows: [{off, every, prop}], items: [{prop, x, z, r, h}]}]
   * prop: topiary (дерево-шар на стволе), tree, bench, lamp (вечером светится), planter, bollard; items: fountain, globe, statue. */
  var streets = P.streets = [], streetBuilt = new Map();         // P.streets — для flive.js (люди, мотоциклы на бульварах)
  function pavingTex(P) {
    // крупные бетонные плиты: основной тон с лёгким разбросом по плитам, тонкие швы; второй тон — редкими полосами
    var t = canvasTex(256, 256, function (c, W, H) {
      var r = FC.rng(5), n = 4, cw = W / n;
      for (var i = 0; i < n; i++) for (var k = 0; k < n; k++) {
        var v = (r() - 0.5) * 14, base = P.a || "#bdb6a9";
        c.fillStyle = shadeHex(base, v); c.fillRect(i * cw, k * cw, cw, cw);
      }
      if (P.b) { c.fillStyle = P.b; c.fillRect(0, H / 2 - cw * 0.12, W, cw * 0.24); }
      c.strokeStyle = "rgba(0,0,0,.16)"; c.lineWidth = 2;
      for (var q = 0; q <= n; q++) { c.beginPath(); c.moveTo(q * cw, 0); c.lineTo(q * cw, H); c.stroke(); c.beginPath(); c.moveTo(0, q * cw); c.lineTo(W, q * cw); c.stroke(); }
    });
    t.wrapS = t.wrapT = T.RepeatWrapping; return t;
  }
  function shadeHex(hex, d) {
    var n = parseInt(String(hex).replace("#", ""), 16), r = Math.max(0, Math.min(255, (n >> 16) + d)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + d)), b = Math.max(0, Math.min(255, (n & 255) + d));
    return "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + ")";
  }
  var PROP = null;
  function props() {
    if (PROP) return PROP;
    var green = new T.MeshStandardMaterial({ color: 0x4f7f3f, roughness: 0.9, flatShading: true }), bark = new T.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
    var wood = new T.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.8 }), metal = new T.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.5, metalness: 0.6 });
    var lampHead = new T.MeshStandardMaterial({ color: 0xf4efe4, emissive: new T.Color(0xffe2b0), emissiveIntensity: 0, roughness: 0.4 });
    var stone = new T.MeshStandardMaterial({ color: 0xcfc8bb, roughness: 0.8 }), water = new T.MeshStandardMaterial({ color: 0x5fa6d6, emissive: new T.Color(0x2a6fa8), emissiveIntensity: 0.2, roughness: 0.1, metalness: 0.3 });
    PROP = {
      topiary: [[new T.CylinderGeometry(0.09, 0.11, 1.9, 6).translate(0, 0.95, 0), bark], [new T.IcosahedronGeometry(0.95, 1).translate(0, 2.55, 0), green]],
      tree: [[new T.CylinderGeometry(0.14, 0.2, 2.6, 6).translate(0, 1.3, 0), bark], [new T.IcosahedronGeometry(1.9, 0).translate(0, 3.9, 0), green]],
      bench: [[new T.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.45, 0), wood], [new T.BoxGeometry(1.8, 0.45, 0.07).translate(0, 0.75, -0.22), wood], [new T.BoxGeometry(1.6, 0.42, 0.42).translate(0, 0.21, 0), metal]],
      lamp: [[new T.CylinderGeometry(0.07, 0.1, 4.6, 8).translate(0, 2.3, 0), metal], [new T.SphereGeometry(0.28, 12, 8).translate(0, 4.75, 0), lampHead]],
      planter: [[new T.BoxGeometry(1.2, 0.55, 1.2).translate(0, 0.27, 0), stone], [new T.IcosahedronGeometry(0.55, 0).translate(0, 0.85, 0), green]],
      bollard: [[new T.CylinderGeometry(0.12, 0.12, 0.8, 8).translate(0, 0.4, 0), metal]],
      _m: { stone: stone, water: water, metal: metal, lampHead: lampHead }
    };
    return PROP;
  }
  function buildStreet(S) {
    var g = new T.Group(), Pp = props(), pts = S.points, W = S.width || 12, inst = {};
    // мощение — полоса вдоль ломаной, чуть выше земли
    if (S.paving !== false) {
      var pt = pavingTex(S.paving || {}), pm = new T.MeshStandardMaterial({ map: pt, roughness: 0.92, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), tile = (S.paving && S.paving.tile) || 1.2;
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux, h = W / 2;
        var geo = new T.BufferGeometry();
        geo.setAttribute("position", new T.Float32BufferAttribute([a[0] + nx * h, 0.25, a[1] + nz * h, b[0] + nx * h, 0.25, b[1] + nz * h, b[0] - nx * h, 0.25, b[1] - nz * h, a[0] - nx * h, 0.25, a[1] - nz * h], 3));
        geo.setAttribute("uv", new T.Float32BufferAttribute([0, 0, L / (tile * 2), 0, L / (tile * 2), W / (tile * 2), 0, W / (tile * 2)], 2));
        geo.setIndex([0, 2, 1, 0, 3, 2]); geo.computeVertexNormals();
        var m = new T.Mesh(geo, pm); m.receiveShadow = true; g.add(m);
      }
    }
    function put(kind, x, z, rot) { (inst[kind] || (inst[kind] = [])).push([x, z, rot || 0]); }
    (S.rows || []).forEach(function (R) {
      var acc = R.start || 0;
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux;
        for (var d = acc; d < L; d += R.every) put(R.prop, a[0] + ux * d + nx * R.off, a[1] + uz * d + nz * R.off, Math.atan2(nx * (R.off > 0 ? -1 : 1), nz * (R.off > 0 ? -1 : 1)));
        acc = (acc - L) % R.every; if (acc < 0) acc += R.every;
      }
    });
    var M4 = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), Sc = new T.Vector3(1, 1, 1), UP = new T.Vector3(0, 1, 0);
    Object.keys(inst).forEach(function (k) {
      var list = inst[k], parts = Pp[k]; if (!parts) return;
      parts.forEach(function (pr) {
        var im = new T.InstancedMesh(pr[0], pr[1], list.length);
        list.forEach(function (it, j) { Q.setFromAxisAngle(UP, it[2]); V.set(it[0], 0.18, it[1]); M4.compose(V, Q, Sc); im.setMatrixAt(j, M4); });
        im.castShadow = true; im.receiveShadow = true; g.add(im);
      });
    });
    (S.items || []).forEach(function (it) {
      var x = it.x, z = it.z, r = it.r || 5, M = Pp._m;
      if (it.prop === "fountain") {
        var basin = new T.Mesh(new T.CylinderGeometry(r, r + 0.2, 0.6, 32), M.stone); basin.position.set(x, 0.3, z); g.add(basin);
        var wat = new T.Mesh(new T.CylinderGeometry(r - 0.3, r - 0.3, 0.05, 32), M.water); wat.position.set(x, 0.58, z); g.add(wat);
        for (var j = 0; j < 9; j++) {
          var aa = j / 9 * 6.283, jet = new T.Mesh(new T.CylinderGeometry(0.05, 0.12, it.h || 2.4, 6), new T.MeshStandardMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.55, emissive: new T.Color(0x8fd0ff), emissiveIntensity: 0.3 }));
          jet.position.set(x + Math.cos(aa) * r * 0.55, 0.6 + (it.h || 2.4) / 2, z + Math.sin(aa) * r * 0.55); g.add(jet);
        }
      } else if (it.prop === "lens") {
        // газон-«линза» (вытянутый овал) с низкими кустами — по оси бульвара Пикассо
        var lw = it.w || 6, ll = it.len || 20, lm = new T.Mesh(new T.CircleGeometry(1, 40), new T.MeshStandardMaterial({ color: 0x5b8a44, roughness: 0.95 }));
        lm.rotation.x = -Math.PI / 2; lm.rotation.z = -(it.rot || 0); lm.scale.set(ll / 2, lw / 2, 1); lm.position.set(x, 0.33, z); g.add(lm);
        var curb = new T.Mesh(new T.TorusGeometry(1, 0.06, 4, 40), M.stone); curb.rotation.x = -Math.PI / 2; curb.rotation.z = -(it.rot || 0); curb.scale.set(ll / 2, lw / 2, 1); curb.position.set(x, 0.34, z); g.add(curb);
        for (var bs = 0; bs < 7; bs++) { var bt = (bs / 6 - 0.5) * ll * 0.75, bush = new T.Mesh(new T.IcosahedronGeometry(0.45, 0), new T.MeshStandardMaterial({ color: 0x3f6f35, flatShading: true })); bush.position.set(x + Math.cos(it.rot || 0) * bt, 0.55, z + Math.sin(it.rot || 0) * bt); g.add(bush); }
      } else if (it.prop === "globe") {
        var ped = new T.Mesh(new T.CylinderGeometry(0.9, 1.1, 1.2, 16), M.stone); ped.position.set(x, 0.6, z); g.add(ped);
        var gl = new T.Mesh(new T.IcosahedronGeometry(r * 0.5, 2), new T.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.3, wireframe: true }));
        gl.position.set(x, 1.2 + r * 0.5, z); g.add(gl);
      } else if (it.prop === "statue") {
        var b2 = new T.Mesh(new T.BoxGeometry(1.8, 0.45, 0.5), M.metal); b2.position.set(x, 0.45, z); g.add(b2);
        var body = new T.Mesh(new T.CylinderGeometry(0.22, 0.26, 0.7, 8), new T.MeshStandardMaterial({ color: 0x6b5a3a, metalness: 0.7, roughness: 0.4 })); body.position.set(x + 0.4, 1.05, z); g.add(body);
        var head = new T.Mesh(new T.SphereGeometry(0.16, 10, 8), body.material); head.position.set(x + 0.4, 1.55, z); g.add(head);
      }
    });
    g.userData.lamp = Pp._m.lampHead;
    root.add(g);
    return g;
  }
  P.addStreets = function (list) { (list || []).forEach(function (S) { if (S.points && S.points.length > 1) { var c = S.points[Math.floor(S.points.length / 2)]; S.cx = c[0]; S.cz = c[1]; streets.push(S); } }); };
  // высота поверхности: на мощении бульвара — 0,25 м (машины, люди, герой стоят на плитке, а не в ней); иначе — null
  P.surfaceAt = function (x, z) {
    for (var i = 0; i < streets.length; i++) {
      var S = streets[i], p = S.points, h = (S.width || 12) / 2;
      if (S.paving === false || Math.abs(x - S.cx) > 600 || Math.abs(z - S.cz) > 600) continue;
      for (var k = 1; k < p.length; k++) {
        var ax = p[k - 1][0], az = p[k - 1][1], dx = p[k][0] - ax, dz = p[k][1] - az, L2 = dx * dx + dz * dz || 1;
        var u = ((x - ax) * dx + (z - az) * dz) / L2; if (u < 0 || u > 1) continue;
        var qx = ax + dx * u - x, qz = az + dz * u - z; if (qx * qx + qz * qz <= h * h) return 0.25;
      }
    }
    return null;
  };
  function streets_update(f, night) {
    streets.forEach(function (S) {
      var d = Math.hypot(S.cx - f.x, S.cz - f.z), g = streetBuilt.get(S);
      if (!g && d < 900) streetBuilt.set(S, buildStreet(S));
      else if (g && d > 1300) { root.remove(g); g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); streetBuilt.delete(S); }
    });
    if (PROP) PROP._m.lampHead.emissiveIntensity = 1.6 * night;
  }

  function heroes_update(dt) {
    heroT -= dt; if (heroT > 0) return; heroT = 0.6;
    var f = (G && G.focus) || (FC.player ? { x: FC.player.x, z: FC.player.z } : null); if (!f) return;
    heroes.forEach(function (pl) {
      var d = Math.hypot(pl.x - f.x, pl.z - f.z), g = heroBuilt.get(pl);
      if (!g && d < (pl.exterior.far || (pl.exterior.style ? 1400 : 650)) && (!pl.logo || (pl.img && pl.img.complete))) heroBuilt.set(pl, pl.exterior.style ? buildStyled(pl) : buildHero(pl));
      else if (g && pl.exterior.style && d > (pl.exterior.far ? pl.exterior.far + 500 : 1900)) { root.remove(g); g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); heroBuilt.delete(pl); }
      else if (g && !pl.exterior.style && d > 900) { root.remove(g); g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); heroBuilt.delete(pl); }
    });
    // вечером и ночью стекло светится изнутри
    var night = G && G.night != null ? G.night : (FC.clock && (FC.clock.hour < 7 || FC.clock.hour > 19) ? 1 : 0);
    streets_update(f, night);
    heroBuilt.forEach(function (g) {
      var m = g.userData.glass; if (m) m.emissiveIntensity = 0.95 * night;
      if (g.userData.facade) g.userData.facade.emissiveIntensity = 0.85 * night;
      if (g.userData.porthole) g.userData.porthole.emissiveIntensity = 0.9 * night;
      if (g.userData.pod && g.userData.pod.emissive) g.userData.pod.emissiveIntensity = 0.9 * night;
    });
  }
  FC.addSystem({ name: "places-heroes", order: 81, update: heroes_update });

  /* ---- интерьер «лаунж»: зал с неоновой надписью над баром, кресла, печь с углями; второй этаж — канаты, поддоны, коконы ---- */
  function neonImg(text, color) {
    var cv = document.createElement("canvas"); cv.width = 1024; cv.height = 300; var c = cv.getContext("2d");
    c.font = "500 190px Oswald, 'Arial Narrow', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = color; c.shadowBlur = 40; c.strokeStyle = color; c.lineWidth = 10; c.strokeText(text, 512, 160);
    c.shadowBlur = 12; c.strokeStyle = "#fff0f0"; c.lineWidth = 3; c.strokeText(text, 512, 160);
    return cv.toDataURL("image/png");
  }
  function mossImg() {
    var cv = document.createElement("canvas"); cv.width = 512; cv.height = 512; var c = cv.getContext("2d"), r = FC.rng(3);
    for (var i = 0; i < 2600; i++) { var a = r() * 6.283, d = 175 + r() * 70; c.fillStyle = ["#3f7d2a", "#5c9a33", "#2f5f20", "#78b33f"][i % 4]; c.beginPath(); c.arc(256 + Math.cos(a) * d, 256 + Math.sin(a) * d, 4 + r() * 7, 0, 7); c.fill(); }
    return cv.toDataURL("image/png");
  }
  // картинки для интерьера «лаунжа» (рисуются один раз): каллиграффити на белой стене, белые буквы на чёрной колонне
  var IMG = {};
  function calliWall() {
    if (IMG.calli) return IMG.calli;
    var cv = document.createElement("canvas"); cv.width = 1024; cv.height = 512; var c = cv.getContext("2d"), r = FC.rng(21);
    c.fillStyle = "#efede8"; c.fillRect(0, 0, 1024, 512);
    c.strokeStyle = "rgba(0,0,0,.07)"; for (var by = 0; by < 512; by += 22) { c.beginPath(); c.moveTo(0, by); c.lineTo(1024, by); c.stroke(); }   // белый кирпич
    c.fillStyle = "#141414"; c.font = "900 64px Impact, 'Arial Black', sans-serif";
    var abc = "КАЛЬЯНМИНСКАРТЫЖВЁДЫМЧАЙ";
    for (var k = 0; k < 140; k++) {
      c.save(); c.translate(r() * 1024, r() * 512); c.rotate((r() - 0.5) * 1.4); c.scale(0.6 + r() * 1.4, 0.4 + r() * 1.2);
      c.fillText(abc[Math.floor(r() * abc.length)], 0, 0); c.restore();
    }
    return (IMG.calli = cv.toDataURL("image/png"));
  }
  function letterStrip() {
    if (IMG.strip) return IMG.strip;
    var cv = document.createElement("canvas"); cv.width = 64; cv.height = 512; var c = cv.getContext("2d"), r = FC.rng(8);
    c.fillStyle = "#141416"; c.fillRect(0, 0, 64, 512); c.fillStyle = "#f2f2f0"; c.font = "800 34px Impact, 'Arial Black', sans-serif"; c.textAlign = "center";
    for (var y = 30; y < 512; y += 36) { c.save(); c.translate(32, y); c.rotate((r() - 0.5) * 0.6); c.fillText("КАЛЬЯНДЫМ"[Math.floor(r() * 9)], 0, 0); c.restore(); }
    return (IMG.strip = cv.toDataURL("image/png"));
  }
  // ---- картинки лаунжа по фото: старый красный кирпич, стена туалета (охра, ч/б панно, крест с цепью), зеркало-кольцо, шеврон
  function cv2url(w, h, draw) { var cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"), w, h); return cv.toDataURL("image/png"); }
  function brickImg() {
    return IMG.brick || (IMG.brick = cv2url(512, 512, function (c, W, H) {   // квадрат: картинка на стене теперь в своих пропорциях
      var r = FC.rng(31); c.fillStyle = "#5a2e1e"; c.fillRect(0, 0, W, H);
      for (var y = 0, row = 0; y < H; y += 16, row++) for (var x = -(row % 2) * 24; x < W; x += 48) {
        var v = Math.floor(r() * 40); c.fillStyle = "rgb(" + (128 + v) + "," + (64 + v / 2) + "," + (40 + v / 3) + ")"; c.fillRect(x + 1, y + 1, 46, 14);
      }
      for (var k = 0; k < 9; k++) { var g = c.createRadialGradient(r() * W, r() * H, 4, r() * W, r() * H, 60 + r() * 60); g.addColorStop(0, "rgba(30,18,12,.55)"); g.addColorStop(1, "rgba(30,18,12,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    }));
  }
  function wcArtImg() {
    return IMG.wcArt || (IMG.wcArt = cv2url(1024, 768, function (c, W, H) {
      var r = FC.rng(44); c.fillStyle = "#b8743a"; c.fillRect(0, 0, W, H);
      for (var k = 0; k < 400; k++) { c.fillStyle = "rgba(" + (r() < 0.5 ? "90,50,20" : "230,170,110") + "," + (0.06 + r() * 0.12) + ")"; c.fillRect(r() * W, r() * H, 6 + r() * 40, 4 + r() * 20); }
      c.strokeStyle = "rgba(20,20,20,.55)"; c.lineWidth = 5; c.font = "900 90px Impact, sans-serif"; c.fillStyle = "rgba(15,15,15,.35)";
      c.fillText("ЛАУНЖ", 600, 740); c.beginPath(); c.moveTo(60, 720); c.lineTo(110, 640); c.lineTo(160, 720); c.closePath(); c.stroke();
      // четыре ч/б панно в рамах: силуэты (свет и тень), без подробностей
      [[70, 60, 200, 290], [320, 40, 250, 340], [640, 40, 250, 340], [80, 400, 190, 330]].forEach(function (q, n) {
        c.fillStyle = "#111"; c.fillRect(q[0] - 8, q[1] - 8, q[2] + 16, q[3] + 16);
        var g = c.createLinearGradient(q[0], q[1], q[0] + q[2], q[1] + q[3]); g.addColorStop(0, "#d8d8d8"); g.addColorStop(1, "#5a5a5a"); c.fillStyle = g; c.fillRect(q[0], q[1], q[2], q[3]);
        c.fillStyle = "#1a1a1a"; var cx = q[0] + q[2] / 2, cy = q[1] + q[3] * 0.34;
        c.beginPath(); c.ellipse(cx, cy, q[2] * 0.17, q[2] * 0.21, 0, 0, 7); c.fill();
        c.beginPath(); c.moveTo(cx - q[2] * 0.36, q[1] + q[3]); c.quadraticCurveTo(cx, cy + q[3] * 0.1, cx + q[2] * 0.36, q[1] + q[3]); c.fill();
        c.strokeStyle = "#0c0c0c"; c.lineWidth = 6; c.beginPath(); c.moveTo(cx - q[2] * 0.25, cy + q[3] * 0.32); c.lineTo(cx + q[2] * 0.25, cy + q[3] * 0.32); c.stroke();
      });
      // деревянный крест с цепью между верхними концами
      c.save(); c.translate(760, 380); [0.62, -0.62].forEach(function (a) { c.save(); c.rotate(a); c.fillStyle = "#3a2416"; c.fillRect(-26, -360, 52, 720); c.fillStyle = "#9aa0a6"; c.beginPath(); c.arc(0, -300, 14, 0, 7); c.fill(); c.restore(); }); c.restore();
      c.strokeStyle = "#8a8f95"; c.lineWidth = 7; for (var t = 0; t < 1; t += 0.05) { var x = 540 + t * 440, y = 120 + Math.sin(t * Math.PI) * 120; c.beginPath(); c.ellipse(x, y, 11, 7, t * 3, 0, 7); c.stroke(); }
      c.fillStyle = "#3f6f2e"; for (var v = 0; v < 60; v++) { c.beginPath(); c.ellipse(W - 20 - r() * 160 * r(), r() * 200 * r(), 12, 7, r() * 3, 0, 7); c.fill(); }
    }));
  }
  function ringMirrorImg() {
    return IMG.ring || (IMG.ring = cv2url(256, 256, function (c, W, H) {
      c.fillStyle = "#4a3026"; c.fillRect(0, 0, W, H);
      var g = c.createRadialGradient(128, 128, 96, 128, 128, 126); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.beginPath(); c.arc(128, 128, 126, 0, 7); c.fill();
      var m = c.createLinearGradient(40, 40, 216, 216); m.addColorStop(0, "#9aa6ad"); m.addColorStop(1, "#3a4046"); c.fillStyle = m; c.beginPath(); c.arc(128, 128, 98, 0, 7); c.fill();
    }));
  }
  function chevronImg() {
    return IMG.chev || (IMG.chev = cv2url(512, 512, function (c, W, H) {
      c.fillStyle = "#ede6e0"; c.fillRect(0, 0, W, H); c.fillStyle = "#151515";
      for (var y = -W; y < H + W; y += 44) { c.beginPath(); c.moveTo(0, y); c.lineTo(W / 2, y + W / 2); c.lineTo(W, y); c.lineTo(W, y + 20); c.lineTo(W / 2, y + W / 2 + 20); c.lineTo(0, y + 20); c.closePath(); c.fill(); }
    }));
  }
  function stoneImg() {
    return IMG.stone || (IMG.stone = cv2url(512, 512, function (c, W, H) {
      var r = FC.rng(9); c.fillStyle = "#a86a38"; c.fillRect(0, 0, W, H);
      for (var k = 0; k < 70; k++) { c.fillStyle = "rgb(" + (170 + r() * 40 | 0) + "," + (110 + r() * 30 | 0) + "," + (60 + r() * 25 | 0) + ")"; c.beginPath(); c.ellipse(r() * W, r() * H, 30 + r() * 40, 18 + r() * 26, r() * 3, 0, 7); c.fill(); c.strokeStyle = "rgba(60,30,10,.5)"; c.lineWidth = 3; c.stroke(); }
    }));
  }
  // кресло с капюшоном (как в лаунже перед неоном): сиденье, высокая спинка, «капюшон» сверху; face: +1 — смотрит к +z, −1 — к −z
  function porter(ctx, x, z, face, col) {
    ctx.box(x, z, 0.8, 0.75, 0.45, 0, col, { solid: false });
    ctx.box(x, z - face * 0.34, 0.8, 0.14, 1.55, 0.25, col, { solid: false });
    ctx.box(x, z - face * 0.14, 0.86, 0.5, 0.14, 1.7, col, { solid: false });
    [-0.38, 0.38].forEach(function (ax) { ctx.box(x + ax, z - face * 0.05, 0.1, 0.62, 1.25, 0.45, col, { solid: false }); });
    ctx.seat(x, z, face > 0 ? 0 : Math.PI, "chair");
  }
  function xbraceImg() {
    return IMG.xb || (IMG.xb = cv2url(256, 256, function (c, W, H) {
      c.clearRect(0, 0, W, H); c.strokeStyle = "#f1f0ec"; c.lineWidth = 14; c.lineCap = "square";
      c.beginPath(); c.moveTo(8, 8); c.lineTo(W - 8, H - 8); c.moveTo(W - 8, 8); c.lineTo(8, H - 8); c.stroke();
    }));
  }
  // картины места: interior.art {faces, cosmo, snake, mecha, smoke, phone, glasses} — свои перерисовки муралов по фото;
  // нет — берём старый список murals по порядку
  function artOf(it) {
    var A = it.art || {}, M = it.murals || [];
    return { faces: A.faces || M[0], cosmo: A.cosmo || M[2], snake: A.snake || M[3], mecha: A.mecha || M[0], smoke: A.smoke || M[1],
      phone: A.phone || M[1], glasses: A.glasses || M[0] };
  }
  // Первый этаж двухэтажного лаунжа (набор lounge1) (местные x: −x — СВ торец у парковки, +x — ЮЗ; −z — улица):
  // белый блок (−x) — тамбур, хостес под круглой вывеской во мху, туалет; его стена в зал — мурал «лица» во всю высоту;
  // вдоль задней стены под антресолью — сетчатая клетка с красным неоном и «тронами», бар в белой плитке, кальянная
  // станция, белая дверь «ВЫХОД», лестница; спереди — стеклянный зал: белые стойки и X-связи, белый потолок на чёрных
  // балках, шары «Melt», папоротники, чёрные стёганые кресла-«уши»; у ЮЗ торца — девушка в оранжевых очках
  function lounge1(o, ctx) {
    var B = ctx.B, pl = B.place || {}, it = pl.interior || {}, I = { x0: o.x0 + 0.7, x1: o.x1 - 0.7, z0: o.z0 + 0.7, z1: o.z1 - 0.7 };
    I.w = I.x1 - I.x0; I.d = I.z1 - I.z0; I.cx = (I.x0 + I.x1) / 2; I.cz = (I.z0 + I.z1) / 2;
    var red = it.neon || "#ff3b2f", hc = ctx.hc, A = artOf(it);
    if (I.w < 14 || I.d < 6) return lounge1small(o, ctx);
    var st = FC.inside && FC.inside.stairs ? FC.inside.stairs() : null, stX0 = st && st.x0 != null ? st.x0 : I.x1 - 2.7;
    // ядро лестницы (площадка перед маршем) — занятая зона движка: всё ставим до неё
    var core = ctx.plan && ctx.plan.core, coreX0 = core && core.x0 != null ? core.x0 : stX0, coreZ0 = core && core.z0 != null ? core.z0 : I.z1 - 2.5;
    var pX = I.x0 + I.w * 0.42, pOpen = I.z0 + 1.4;                  // стена белого блока; проход у витража
    var stripZ = I.z1 - 2.9;                                           // край антресоли: сзади — клетка, бар, станция
    // ---- стена белого блока: от прохода до задней стены, со стороны зала — «лица» во всю высоту
    ctx.box(pX, (pOpen + I.z1) / 2 + 0.35, 0.16, I.z1 - pOpen + 0.7, hc, 0, "#e6e4de", { force: true });
    if (A.faces) ctx.image(pX + 0.1, (pOpen + I.z1) / 2 + 0.3, hc / 2 + 0.05, Math.min(hc * 16 / 9, I.z1 - pOpen + 0.6), Math.PI / 2, A.faces);
    for (var dmd = 0; dmd < 3; dmd++) ctx.glow(pX + 0.11, pOpen + 1.2 + dmd * 0.7, 0.02, 0.3, 0.3, 2.4, "#0c0c0e");
    // ---- белый блок: тамбур у двери, хостес под круглой вывеской во мху, космонавт с телефоном, табличка 18+
    var hX = pX - 1.3, hZ = I.z0 + 2.6;
    ctx.box(hX, hZ, 1.4, 0.55, 1.05, 0, "#18181a"); ctx.box(hX, hZ, 1.5, 0.65, 0.05, 1.05, "#2a2a2c", { solid: false });
    ctx.image(pX - 0.1, hZ + 0.2, 2.5, 1.8, -Math.PI / 2, mossImg());
    if (pl.logo) ctx.image(pX - 0.14, hZ + 0.2, 2.5, 1.2, -Math.PI / 2, pl.logo);
    ctx.npc(hX, hZ + 0.55, FC.people.randomCell(ctx.r), { line: ["Добро пожаловать в «" + (pl.name || "лаунж") + "»!", "У вас бронь?", "Проходите — в зале есть места, наверху тоже"] });
    if (A.phone) ctx.image(pX - 0.1, I.z1 - 1.6, 1.7, 1.9, -Math.PI / 2, A.phone);
    ctx.box(pX - 0.09, hZ - 0.9, 0.02, 0.7, 0.5, 1.4, "#9c7444", { solid: false });
    for (var gr = -1.0; gr <= 1.01; gr += 0.15) ctx.glow(pX - 1.3 + gr, I.z0 + 0.8, 0.02, 1.2, 0.004, 0.005, "#2a2a2c");
    ctx.image(I.x0 + 0.08, I.z0 + 1.3, 1.8, 2.4, Math.PI / 2, calliWall());
    // ---- туалет в глубине белого блока: старый кирпич, раковины-бетон на стеклоблоках, круглые зеркала с кольцом
    // света, двери кабинок из тёмных досок; стена в охре с ч/б панно и деревянным крестом с цепью
    var wX1 = I.x0 + 3.0, wZ0 = I.z1 - 3.0;
    ctx.box((I.x0 + wX1) / 2 - 0.35, wZ0, wX1 - I.x0 + 0.7, 0.12, hc, 0, "#8a4a2e", { force: true });
    var wpZ = wZ0 + 1.8;                                                                  // проход 1,8 м (был 1 м — игрок не пролезал)
    ctx.box(wX1, (wpZ + I.z1) / 2, 0.12, I.z1 - wpZ, hc, 0, "#8a4a2e", { force: true });
    ctx.image((I.x0 + wX1) / 2, wZ0 - 0.07, hc / 2, wX1 - I.x0, Math.PI, brickImg());
    ctx.image((I.x0 + wX1) / 2, wZ0 + 0.07, hc / 2, wX1 - I.x0, 0, brickImg());
    ctx.image(wX1 + 0.07, (wpZ + I.z1) / 2, hc / 2, I.z1 - wpZ, Math.PI / 2, brickImg());
    ctx.image(I.x0 + 0.08, (wZ0 + I.z1) / 2, 1.6, 2.6, Math.PI / 2, wcArtImg());
    [0.8, 1.75].forEach(function (dx) {
      var vx2 = I.x0 + dx;
      ctx.box(vx2, I.z1 - 0.3, 0.7, 0.45, 0.75, 0, "#7a5a3e");
      for (var gb2 = 0; gb2 < 3; gb2++) ctx.glow(vx2 - 0.22 + gb2 * 0.22, I.z1 - 0.06, 0.18, 0.02, 0.18, 0.1 + (gb2 % 2) * 0.22, "#d8f0f4");
      ctx.box(vx2, I.z1 - 0.32, 0.46, 0.36, 0.14, 0.75, "#a8a6a0", { solid: false });
      ctx.glow(vx2, I.z1 - 0.22, 0.03, 0.03, 0.28, 0.89, "#101012");
      ctx.image(vx2, I.z1 - 0.08, 1.5, 0.62, Math.PI, ringMirrorImg());
    });
    [I.x0 + 0.5, I.x0 + 1.5].forEach(function (dx) { ctx.box(dx, wZ0 + 0.08, 0.8, 0.05, 2.1, 0, "#4a3426", { solid: false }); });
    ctx.act(I.x0 + 1.4, (wZ0 + I.z1) / 2, "Туалет: умыться", function () { if (FC.player && FC.player.heal) FC.player.heal(5); FC.hud.toast("🧼 Бетонные раковины, круглые зеркала с подсветкой — чисто", "ok", 2.5); }, 1.3);
    // ---- клетка у стены с «лицами»: чёрная сварная сетка ~3×3 м, на передней грани — красный неон имени; внутри «троны»
    var cX0 = pX + 0.25, cX1 = Math.min(pX + 2.1, coreX0 - 3.6), cZ0 = stripZ;
    for (var mx = cX0; mx <= cX1 + 0.01; mx += 0.2) { ctx.glow(mx, cZ0, 0.02, 0.02, 2.8, 0, "#0c0c0e"); }
    for (var mz = cZ0; mz <= I.z1 + 0.01; mz += 0.2) ctx.glow(cX1, mz, 0.02, 0.02, 2.8, 0, "#0c0c0e");
    for (var my2 = 0.3; my2 <= 2.81; my2 += 0.25) { ctx.glow((cX0 + cX1) / 2, cZ0, cX1 - cX0, 0.02, 0.02, my2, "#0c0c0e"); ctx.glow(cX1, (cZ0 + I.z1) / 2, 0.02, I.z1 - cZ0, 0.02, my2, "#0c0c0e"); }
    for (var rz2 = cZ0; rz2 <= I.z1; rz2 += 0.25) ctx.glow((cX0 + cX1) / 2, rz2, cX1 - cX0, 0.02, 0.02, 2.8, "#0c0c0e");
    [[cX0, cZ0], [cX1, cZ0]].forEach(function (pp) { ctx.box(pp[0], pp[1], 0.08, 0.08, 2.8, 0, "#0c0c0e", { force: true }); });
    ctx.image((cX0 + cX1) / 2 + 0.3, cZ0 - 0.04, 2.35, Math.min(2.4, cX1 - cX0 - 0.2), 0, neonImg(pl.name || "БАР", red));
    ctx.image((cX0 + cX1) / 2 + 0.3, cZ0 + 0.04, 2.35, Math.min(2.4, cX1 - cX0 - 0.2), Math.PI, neonImg(pl.name || "БАР", red));
    var tcx = (cX0 + cX1) / 2 + 0.2, tcz = (cZ0 + I.z1) / 2 + 0.2;
    porter(ctx, tcx, tcz - 0.95, 1, "#9e2a1c"); porter(ctx, tcx, tcz + 0.95, -1, "#7a0f18");
    ctx.cyl(tcx, tcz, 0.3, 0.7, 0, "#2a2320"); FC.places.hookahProp(ctx, tcx, tcz);
    porter(ctx, cX0 + 0.7, cZ0 - 1.0, -1, "#9e2a1c"); porter(ctx, cX0 + 2.2, cZ0 - 1.0, -1, "#7a0f18");
    ctx.cyl(cX0 + 1.45, cZ0 - 1.1, 0.28, 0.7, 0, "#2a2320");
    // ---- бар в белой плитке, г-образный конец; сзади — каллиграффити, стеллаж табака, бутылки, печь с конусом, «ВЫХОД»
    var bX0 = cX1 + 0.45, bX1 = coreX0 - 0.6, bw = bX1 - bX0, bx = (bX0 + bX1) / 2, bz = I.z1 - 1.2;
    ctx.box(bx, bz, bw, 0.7, 1.08, 0, "#f2f0eb");
    ctx.box(bx, bz, bw + 0.2, 0.85, 0.06, 1.08, "#b07a45", { solid: false });
    ctx.box(bx, bz - 0.05, bw, 0.32, 0.012, 1.145, "#b9bcc0", { solid: false });
    ctx.glow(bx, bz - 0.43, bw, 0.02, 0.02, 1.02, "#19d3e0");
    ctx.glow(bx, bz - 0.5, bw, 0.05, 0.05, 0.25, "#0c0c0e");
    ctx.image(bx, I.z1 - 0.08, hc - 0.9, Math.min(bw + 1, 5.5), Math.PI, calliWall());
    var tobX = bX0 + 0.6;
    ctx.box(tobX, I.z1 - 0.18, 1.0, 0.3, 1.8, 0.2, "#101012", { solid: false });
    for (var sh = 0; sh < 4; sh++) ctx.glow(tobX, I.z1 - 0.32, 1.15, 0.04, 0.03, 0.6 + sh * 0.42, sh % 2 ? "#30c8f0" : "#7a5cff");
    for (var jb = 0; jb < 20; jb++) ctx.cyl(tobX - 0.4 + (jb % 5) * 0.2, I.z1 - 0.22, 0.06, 0.16, 0.62 + Math.floor(jb / 5) * 0.42, "#e8eef4", { solid: false });
    var botX = bX1 - 0.45;
    ctx.box(botX, I.z1 - 0.18, 0.8, 0.3, 1.8, 0.2, "#101012", { solid: false });
    for (var bt = 0; bt < 8; bt++) ctx.cyl(botX - 0.3 + (bt % 4) * 0.2, I.z1 - 0.22, 0.045, 0.28, 0.62 + Math.floor(bt / 4) * 0.62, ["#2f4a2a", "#5a3a1e", "#c9d2d8"][bt % 3], { solid: false });
    for (var bs = 0; bs < 4; bs++) {
      var sx = bX0 + 0.45 + bs * (bw - 0.9) / 3, sz = bz - 0.75;
      ctx.cyl(sx, sz, 0.05, 0.72, 0, "#4a3020", { solid: false }); ctx.cyl(sx, sz, 0.24, 0.1, 0.72, "#141416", { solid: false });
      ctx.box(sx, sz + 0.2, 0.42, 0.08, 0.55, 0.82, "#141416", { solid: false });
    }
    for (var pl2 = 0; pl2 < 3; pl2++) { var lx = bX0 + 0.5 + pl2 * (bw - 1.0) / 2; ctx.glow(lx, bz, 0.01, 0.01, 0.5, hc - 0.5, "#101012"); ctx.cyl(lx, bz, 0.2, 0.16, hc - 0.66, "#101012", { solid: false }); ctx.glow(lx, bz, 0.26, 0.26, 0.02, hc - 0.68, "#f4f4f0"); }
    ctx.npc(bx, I.z1 - 0.6, FC.people.randomCell(ctx.r), { line: ["Что будете курить?", "Есть новый табак — с ягодами", "Коктейль к кальяну?"] });
    ctx.act(bx, bz - 1.4, (pl.name || "Бар") + ": кальян — $15", function () {
      if (FC.money(-15, "кальян") === false) { FC.hud.toast("Не хватает денег", "bad", 2); return; }
      if (FC.player && FC.player.heal) FC.player.heal(25);
      FC.hud.toast("💨 Кальян несут — плотный, на мяте. +25 здоровья", "ok", 3); if (FC.audio) FC.audio.play("cash");
    }, 1.7);
    var ovX = (tobX + 0.5 + botX - 0.4) / 2;                                   // печь — между табаком и бутылками, за стойкой
    ctx.box(ovX, I.z1 - 0.35, 0.6, 0.5, 0.9, 0, "#efeee9", { force: true });
    ctx.box(ovX, I.z1 - 0.35, 0.42, 0.42, 0.5, 0.9, "#b9bcc0", { solid: false });
    for (var cc = 0; cc < 4; cc++) ctx.glow(ovX - 0.1 + (cc % 2) * 0.2, I.z1 - 0.42 + Math.floor(cc / 2) * 0.14, 0.1, 0.1, 0.05, 1.41, cc % 2 ? "#ff3d0a" : "#ff8a1a");
    ctx.cyl(ovX, I.z1 - 0.35, 0.45, 0.35, 2.1, "#111113", { solid: false }); ctx.cyl(ovX, I.z1 - 0.35, 0.08, hc - 2.45, 2.45, "#9a9da3", { solid: false });
    ctx.npc(ovX + 0.5, I.z1 - 0.75, FC.people.randomCell(ctx.r), { line: ["Раскуриваю — две минуты", "Угли — кокосовые", "Сделать покрепче?"] });
    var exX = coreX0 + 0.8;                                                    // белая дверь «ВЫХОД» — на лицевой стене площадки лестницы
    ctx.box(exX, coreZ0 - 0.04, 0.9, 0.05, 2.1, 0, "#f1f0ec", { solid: false });
    ctx.glow(exX, coreZ0 - 0.07, 0.5, 0.02, 0.16, 2.25, "#1fbf4a");
    // белая плитка перед баром, край «пикселями» в дуб, внутри поля редкие чёрные плитки
    var tw = bw + 1.0;
    ctx.box(bx, bz - 1.4, tw, 2.0, 0.012, 0.004, "#f2f0eb", { solid: false });
    for (var px = bx - tw / 2; px < bx + tw / 2 - 0.01; px += 0.3) {
      var np = Math.floor(ctx.r() * ctx.r() * 4);
      for (var kp = 0; kp < np; kp++) ctx.box(px + 0.15, bz - 2.55 - kp * 0.3, 0.3, 0.3, 0.012, 0.004, "#f2f0eb", { solid: false });
    }
    for (var bk2 = 0; bk2 < 6; bk2++) ctx.box(bx - tw / 2 + 0.15 + Math.floor(ctx.r() * tw / 0.3) * 0.3, bz - 2.25 + Math.floor(ctx.r() * 5) * 0.3, 0.3, 0.3, 0.012, 0.007, "#141414", { solid: false });
    // ---- лестница: вид задаёт interior.stair (finside: ступени, подсветка); девушка-космонавт — на задней стене шахты,
    // навстречу поднимающимся по первому маршу
    if (A.cosmo && st) ctx.image((st.x0 + st.x1) / 2, st.z1 - 0.14, hc + 0.55, Math.min(2.2, st.x1 - st.x0 - 0.3), Math.PI, A.cosmo);
    if (st) {                                                            // стены пролёта — белёный кирпич в ч/б каллиграффити
      var sL = st.z1 - st.z0 - 0.3, scz = (st.z0 + st.z1) / 2;
      ctx.image(st.x0 + 0.02, scz, hc + 0.5, sL, Math.PI / 2, calliWall());
      ctx.image(st.x1 - 0.14, scz, hc + 0.5, sL, -Math.PI / 2, calliWall());
      ctx.image(st.x1 - 0.14, scz, 1.5, sL, -Math.PI / 2, calliWall());
    }
    // девушка в оранжевых очках — на глухом ЮЗ торце у витража (в жизни — на террасе, видна из зала)
    if (A.glasses) ctx.image(I.x1 - 0.08, I.z0 + 1.6, 1.9, 2.4, -Math.PI / 2, A.glasses);
    // ---- стеклянный зал: белые стойки витража с буквами и белые X-связи, белый потолок на чёрных балках, чёрный — над антресолью
    for (var vx = pX + 0.9; vx < I.x1 - 0.5; vx += 2.4) {
      ctx.box(vx, I.z0 + 0.15, 0.25, 0.25, hc, 0, "#ecebe6", { force: true }); ctx.image(vx, I.z0 + 0.3, hc / 2, 0.22, 0, letterStrip());
      if (vx + 2.4 < I.x1 - 0.5) ctx.image(vx + 1.2, I.z0 + 0.12, hc / 2 + 0.2, 2.1, 0, xbraceImg());
    }
    var hallZ1 = stripZ - 0.1;
    ctx.glow((pX + I.x1) / 2, (I.z0 + hallZ1) / 2 - 0.35, I.x1 - pX + 0.7, hallZ1 - I.z0 + 0.7, 0.03, hc - 0.06, "#d6d4cf");
    for (var rx = pX + 0.5; rx < I.x1 + 0.6; rx += 1.2) ctx.glow(rx, (I.z0 + hallZ1) / 2 - 0.35, 0.14, hallZ1 - I.z0 + 0.7, 0.2, hc - 0.28, "#141416");
    ctx.glow((pX + I.x1) / 2, hallZ1, I.x1 - pX, 0.2, 0.35, hc - 0.38, "#141416");
    ctx.glow((pX + I.x1) / 2, hallZ1 + 0.12, I.x1 - pX, 0.04, 0.06, hc - 0.45, "#c0262c");
    ctx.box((pX + I.x1) / 2, I.z1 - 0.9, I.x1 - pX - 1, 0.3, 0.3, hc - 0.45, "#18181a", { solid: false });
    for (var hp = 0; hp < 6; hp++) {
      var hx = pX + 1.0 + hp * (I.x1 - pX - 2.0) / 5, hz = I.z0 + 1.2 + (hp % 2) * 1.6;
      ctx.glow(hx, hz, 0.01, 0.01, 0.3, hc - 0.3, "#101012");
      ctx.cyl(hx, hz, 0.42, 0.2, hc - 0.5, "#4e7a3a", { solid: false });
      ctx.cyl(hx + 0.18, hz - 0.12, 0.26, 0.2, hc - 0.68, "#8bb56a", { solid: false });
    }
    for (var gb = 0; gb < 16; gb++) {
      var gx2 = pX + 0.6 + ctx.r() * (I.x1 - pX - 1.2), gz2 = I.z0 + 0.5 + ctx.r() * (hallZ1 - I.z0 - 0.8), gy = hc - 0.75 - ctx.r() * 0.2;
      ctx.glow(gx2, gz2, 0.01, 0.01, hc - gy - 0.3, gy + 0.3, "#101012");
      ctx.cyl(gx2, gz2, 0.2, 0.3, gy, "#3a3a3c", { solid: false }); ctx.glow(gx2, gz2, 0.08, 0.08, 0.1, gy + 0.1, "#e09a3c");
    }
    // ---- зал: круглые дубовые столы на чёрной опоре, чёрные стёганые «уши» и красный бархат, кальяны
    var spots = [];
    for (var xa = pX + 1.5; xa < I.x1 - 1.0; xa += 2.6) { spots.push([xa, I.z0 + 2.0]); spots.push([xa + 1.3, hallZ1 - 1.0]); }
    spots.forEach(function (sp, n) {
      var x = sp[0], z = sp[1];
      if (x > I.x1 - 1.4) return;
      if (z > I.z0 + 3 && x < cX1 + 1.9) return; if (z > coreZ0 - 1.4 && x > coreX0 - 1.2) return;                     // перед клеткой — свои «троны», не столы зала
      if (!ctx.cyl(x, z, 0.42, 0.72, 0, "#8a6038")) return;
      FC.places.hookahProp(ctx, x, z);
      var redSide = n % 3 === 2;
      [-1, 1].forEach(function (sd) {
        var cx = x + sd * 0.95, bkx = cx + sd * 0.34, col = redSide ? "#8c1422" : "#1b1b1d", col2 = redSide ? "#7a101c" : "#121214";
        ctx.box(cx, z, 0.75, 0.75, 0.45, 0, col, { solid: false });
        ctx.box(bkx, z, 0.14, 0.8, 1.15, 0.3, col2, { solid: false });
        [-0.36, 0.36].forEach(function (az) { ctx.box(cx, z + az, 0.72, 0.1, 0.24, 0.45, col2, { solid: false }); ctx.box(bkx - sd * 0.12, z + az, 0.18, 0.1, 0.4, 1.0, col2, { solid: false }); });
        ctx.seat(cx, z, 0, "chair");
        if (ctx.r() < 0.6) ctx.npc(cx, z, FC.people.randomCell(ctx.r), { line: LINES });
      });
    });
  }
  function lounge1small(o, ctx) {
    var B = ctx.B, pl = B.place || {}, it = pl.interior || {}, I = { x0: o.x0 + 0.7, x1: o.x1 - 0.7, z0: o.z0 + 0.7, z1: o.z1 - 0.7 };
    I.w = I.x1 - I.x0; I.d = I.z1 - I.z0; I.cx = (I.x0 + I.x1) / 2; I.cz = (I.z0 + I.z1) / 2;
    var red = it.neon || "#ff2a3a", hc = ctx.hc, M = it.murals || [];
    // Раскладка по фото: −z — улица (витражи), +z — задняя стена. С края −x — белый блок: туалет у торца, бар под
    // антресолью вдоль задней стены; дальше к +x — двухсветный стеклянный зал (белый потолок на чёрных балках).
    var big = I.w > 14, wcX1 = big ? I.x0 + 2.6 : I.x0, hallX = big ? I.x0 + I.w * 0.42 : I.x0;
    // ---- бар: белая плитка, дубовая столешница с перфорированной стальной рейкой, сзади — сетка-стеллаж: слева банки
    // табака, в середине белая кирпичная колонна, справа бутылки; над стойкой чёрные купола
    var bw = Math.min(6, I.w - 2), bx = big ? I.x0 + 1.2 + bw / 2 : I.cx - 0.8, bz = I.z1 - 1.2;
    ctx.box(bx, bz, bw, 0.7, 1.08, 0, "#eeeeea");
    ctx.box(bx, bz, bw + 0.2, 0.85, 0.06, 1.08, "#a9825f", { solid: false });
    ctx.box(bx, bz - 0.05, bw, 0.32, 0.012, 1.145, "#b9bcc0", { solid: false });
    ctx.glow(bx, bz - 0.43, bw, 0.02, 0.02, 1.02, "#2f6bff");
    for (var sh = 0; sh < 4; sh++) ctx.glow(bx, I.z1 - 0.16, bw * 0.95, 0.16, 0.04, 1.0 + sh * 0.42, sh % 2 ? "#30c8f0" : "#2f6bff");
    for (var jb = 0; jb < 24; jb++) ctx.cyl(bx - bw * 0.45 + (jb % 8) * bw * 0.05, I.z1 - 0.2, 0.06, 0.18, 1.05 + Math.floor(jb / 8) * 0.42, "#d9e6ff", { solid: false });
    ctx.box(bx + bw * 0.05, I.z1 - 0.3, 0.7, 0.5, hc, 0, "#d9d3c9", { force: true });
    for (var bt = 0; bt < 15; bt++) ctx.cyl(bx + bw * 0.2 + (bt % 5) * bw * 0.055, I.z1 - 0.2, 0.05, 0.3, 1.05 + Math.floor(bt / 5) * 0.42, ["#2f4a2a", "#5a3a1e", "#c9d2d8"][bt % 3], { solid: false });
    for (var gx = -bw / 2; gx <= bw / 2 + 0.01; gx += 0.5) ctx.glow(bx + gx, I.z1 - 0.06, 0.03, 0.03, hc - 0.3, 0.2, "#101012");
    for (var bs = 0; bs < 6; bs++) {
      var sx = bx - bw / 2 + 0.6 + bs * (bw - 1.2) / 5, sz = bz - 0.75;
      ctx.cyl(sx, sz, 0.05, 0.72, 0, "#b08a5e", { solid: false }); ctx.cyl(sx, sz, 0.24, 0.1, 0.72, "#8d8f93", { solid: false });
      ctx.box(sx, sz + 0.2, 0.42, 0.08, 0.5, 0.82, "#8d8f93", { solid: false });
    }
    for (var pl2 = 0; pl2 < 5; pl2++) { var lx = bx - bw / 2 + 0.6 + pl2 * (bw - 1.2) / 4; ctx.glow(lx, bz, 0.01, 0.01, 0.5, hc - 0.5, "#101012"); ctx.cyl(lx, bz, 0.2, 0.16, hc - 0.66, "#101012", { solid: false }); ctx.glow(lx, bz, 0.26, 0.26, 0.02, hc - 0.68, "#f4f4f0"); }
    ctx.npc(bx, I.z1 - 0.6, FC.people.randomCell(ctx.r), { line: ["Что будете курить?", "Есть новый табак — с ягодами", "Коктейль к кальяну?"] });
    ctx.act(bx, bz - 1.4, (pl.name || "Бар") + ": кальян — $15", function () {
      if (FC.money(-15, "кальян") === false) { FC.hud.toast("Не хватает денег", "bad", 2); return; }
      if (FC.player && FC.player.heal) FC.player.heal(25);
      FC.hud.toast("💨 Кальян несут — плотный, на мяте. +25 здоровья", "ok", 3); if (FC.audio) FC.audio.play("cash");
    }, 1.7);
    // кальянная станция у торца бара: стальной стол, белая плитка для углей, шланги на стене
    var hsX = bx - bw / 2 - 0.55;
    ctx.box(hsX, I.z1 - 0.45, 0.9, 0.7, 0.9, 0, "#b9bcc0");
    ctx.box(hsX, I.z1 - 0.45, 0.5, 0.4, 0.3, 0.9, "#f1f0ec", { solid: false });
    for (var cc = 0; cc < 4; cc++) ctx.glow(hsX - 0.12 + (cc % 2) * 0.24, I.z1 - 0.52 + Math.floor(cc / 2) * 0.16, 0.12, 0.1, 0.06, 1.2, cc % 2 ? "#ff3d0a" : "#ff8a1a");
    for (var hs = 0; hs < 5; hs++) ctx.glow(hsX - 0.36 + hs * 0.18, I.z1 - 0.06, 0.03, 0.03, 0.7, 1.3, "#1a1a1c");
    ctx.npc(hsX + 0.1, I.z1 - 1.2, FC.people.randomCell(ctx.r), { line: ["Раскуриваю — две минуты", "Угли — кокосовые", "Сделать покрепче?"] });
    // белая плитка у бара на тёмном дубе — край ступеньками «пикселей», внутри поля редкие чёрные плитки
    var tw = bw + 1.4;
    ctx.box(bx, I.z1 - 2.4, tw, 2.2, 0.012, 0.004, "#f1f0ec", { solid: false });
    for (var px = bx - tw / 2; px < bx + tw / 2 - 0.01; px += 0.3) {
      var np = Math.floor(ctx.r() * ctx.r() * 4);
      for (var kp = 0; kp < np; kp++) ctx.box(px + 0.15, I.z1 - 3.65 - kp * 0.3, 0.3, 0.3, 0.012, 0.004, "#f1f0ec", { solid: false });
    }
    for (var bk2 = 0; bk2 < 7; bk2++) ctx.box(bx - tw / 2 + 0.15 + Math.floor(ctx.r() * tw / 0.3) * 0.3, I.z1 - 3.35 + Math.floor(ctx.r() * 6) * 0.3, 0.3, 0.3, 0.012, 0.007, "#141414", { solid: false });
    // ---- чёрная сетка от пола до потолка в конце бара с красным неоном имени; перед ней — красные кресла с капюшонами
    var mX = bx + bw / 2 + 0.9;
    for (var mz = I.z1 - 3.0; mz <= I.z1 + 0.01; mz += 0.2) ctx.glow(mX, mz, 0.02, 0.02, hc, 0, "#0c0c0e");
    for (var my = 0.3; my < hc; my += 0.2) ctx.glow(mX, I.z1 - 1.5, 0.02, 3.0, 0.02, my, "#0c0c0e");
    ctx.image(mX + 0.06, I.z1 - 1.5, 2.2, 2.6, Math.PI / 2, neonImg(pl.name || "БАР", red));
    ctx.image(mX - 0.06, I.z1 - 1.5, 2.2, 2.6, -Math.PI / 2, neonImg(pl.name || "БАР", red));
    porter(ctx, mX + 0.9, I.z1 - 2.6, 1, "#9e1622"); porter(ctx, mX + 0.9, I.z1 - 0.5, -1, "#9e1622");
    ctx.cyl(mX + 0.9, I.z1 - 1.55, 0.3, 0.7, 0, "#2a2320");
    FC.places.hookahProp(ctx, mX + 0.9, I.z1 - 1.55);
    // ---- лестница: ступени из рифлёной стали, подсветка под каждой — голубая, фиолетовая, малиновая; девушка-космонавт
    var st = ctx.plan && ctx.plan.stairs, sx0 = st ? st.x : I.x1 - 1.2, sz0 = st ? st.z - 1.6 : I.z0 + 2.5;
    var LED = ["#3fe3ff", "#8a3bff", "#ff1e5a"];
    for (var k = 0; k < 9; k++) ctx.glow(sx0, sz0 - k * 0.28, 1.0, 0.05, 0.03, 0.18 + k * 0.33, LED[Math.floor(k / 3)]);
    for (var g2 = -0.6; g2 <= 0.61; g2 += 0.3) ctx.glow(sx0 + g2, sz0 - 1.2, 0.02, 2.6, 0.02, 1.6, "#0c0c0e");
    if (M[2]) ctx.image(sx0 - 1.2, sz0 - 2.4, 1.9, 2.0, 0, M[2]);
    // ---- стены: каллиграффити у бара; на торце зала — большая девушка-космонавт с кольцами дыма; шеврон за креслами
    ctx.image(I.x0 + 0.08, I.z1 - 1.9, 1.8, Math.min(3.6, I.d * 0.45), Math.PI / 2, calliWall());
    ctx.image(bx, I.z1 - 0.08, hc - 0.7, Math.min(bw, 5), Math.PI, calliWall());
    if (M[1]) ctx.image(I.x1 - 0.1, I.z0 + 2.0, 2.0, Math.min(3.2, I.d * 0.4), -Math.PI / 2, M[1]);
    if (big) ctx.image((mX + (st ? st.x - 1.5 : I.x1)) / 2 + 0.6, I.z1 - 0.08, 1.7, 3.0, Math.PI, chevronImg());
    // круглый логотип во мху — на задней стене зала, не у лестницы
    var mossX = big ? hallX + 1.6 : I.cx;
    ctx.image(mossX + 2.6, I.z1 - 0.1, 2.4, 1.6, Math.PI, mossImg());
    if (pl.logo) ctx.image(mossX + 2.6, I.z1 - 0.14, 2.4, 1.05, Math.PI, pl.logo);
    // ---- стеклянный зал: белые стойки витража с чёрными буквами; потолок — белый профлист на чёрных балках, над баром — чёрный
    for (var vx = hallX + 1.2; vx < I.x1 - 0.5; vx += 2.4) { ctx.box(vx, I.z0 + 0.15, 0.25, 0.25, hc, 0, "#ecebe6", { force: true }); ctx.image(vx, I.z0 + 0.3, hc / 2, 0.22, 0, letterStrip()); }
    ctx.glow((hallX + I.x1) / 2, I.cz, I.x1 - hallX + 1.4, I.d + 1.4, 0.03, hc - 0.06, "#e6e6e2");
    for (var rx = hallX + 0.6; rx < I.x1 + 0.6; rx += 1.6) ctx.glow(rx, I.cz, 0.14, I.d + 1.4, 0.2, hc - 0.28, "#141416");
    for (var cxg = I.x0; cxg <= hallX; cxg += 0.6) ctx.glow(cxg, I.cz, 0.02, I.d, 0.02, hc - 0.25, "#1a1a1c");
    ctx.box((I.x0 + hallX) / 2, I.z1 - 2.2, hallX - I.x0, 0.4, 0.4, hc - 0.55, "#9a9da3", { solid: false });     // воздуховод над баром
    // папоротники на плоских чёрных сетках на тросах и стеклянные шары «Melt»: днём дымчатые, внутри — янтарная нить
    for (var hp = 0; hp < 8; hp++) {
      var hx = hallX + 0.8 + ctx.r() * (I.x1 - hallX - 1.6), hz = I.z0 + 0.8 + ctx.r() * (I.d - 3.5);
      // без плоской рамы: у потолка она на высоте камеры и закрывает весь кадр (рамы не прозрачнеют, как зелень)
      ctx.glow(hx, hz, 0.01, 0.01, 0.3, hc - 0.3, "#101012");
      ctx.cyl(hx, hz, 0.42, 0.2, hc - 0.5, "#3f7f45", { solid: false });
      ctx.cyl(hx + 0.18, hz - 0.12, 0.26, 0.2, hc - 0.68, "#4f9a52", { solid: false });
    }
    for (var gb = 0; gb < 11; gb++) {
      var gx2 = hallX + 0.6 + ctx.r() * (I.x1 - hallX - 1.2), gz2 = I.z0 + 0.6 + ctx.r() * (I.d - 2.6), gy = hc - 0.75 - ctx.r() * 0.2;
      ctx.glow(gx2, gz2, 0.01, 0.01, hc - gy - 0.3, gy + 0.3, "#101012");
      ctx.cyl(gx2, gz2, 0.2, 0.3, gy, "#6e5a50", { solid: false }); ctx.glow(gx2, gz2, 0.08, 0.08, 0.1, gy + 0.1, "#f2a640");
    }
    // ---- тамбур у входа: пол-решётка, хостес
    for (var gr = -1.2; gr <= 1.21; gr += 0.15) ctx.glow(I.cx + gr, I.z0 + 1.0, 0.02, 1.4, 0.004, 0.005, "#2a2a2c");
    ctx.npc(I.cx + 1.4, I.z0 + 1.0, FC.people.randomCell(ctx.r), { line: ["Добро пожаловать в «" + (pl.name || "лаунж") + "»!", "У вас бронь?", "Проходите, на втором есть места"] });
    // ---- туалет у торца белого блока: старый красный кирпич, раковины-бетон на подсвеченных блоках, круглые зеркала
    // с кольцом света, двери кабинок из тёмного дерева; на стене напротив — охра, ч/б панно и деревянный крест с цепью
    if (big) {
      var wz1 = I.z0 + 2.6, wcZ = (I.z0 + wz1) / 2;
      ctx.box(I.x0 + 1.0, wz1, 2.0, 0.12, hc, 0, "#8a4a2e", { force: true });                 // стенка от зала (проход у края)
      ctx.box(wcX1, I.z0 + 0.7, 0.12, 1.4, hc, 0, "#8a4a2e", { force: true });                // перегородка у витража
      ctx.image(I.x0 + 1.0, wz1 - 0.07, hc / 2, 2.0, Math.PI, brickImg());
      ctx.image(I.x0 + 1.0, wz1 + 0.07, hc / 2, 2.0, 0, brickImg());
      ctx.image(wcX1 + 0.07, I.z0 + 0.7, hc / 2, 1.4, Math.PI / 2, brickImg());
      ctx.image(wcX1 - 0.07, I.z0 + 0.7, hc / 2, 1.4, -Math.PI / 2, stoneImg());
      ctx.image(I.x0 + 0.08, wcZ, 1.6, 2.4, Math.PI / 2, wcArtImg());
      [0.55, 1.45].forEach(function (dx) {
        var vx2 = I.x0 + dx;
        ctx.box(vx2, wz1 - 0.35, 0.5, 0.4, 0.8, 0, "#8e8c86");
        ctx.glow(vx2, wz1 - 0.12, 0.45, 0.02, 0.05, 0.05, "#ffe0b0");
        ctx.box(vx2, wz1 - 0.35, 0.46, 0.36, 0.14, 0.8, "#b0aea8", { solid: false });
        ctx.glow(vx2, wz1 - 0.2, 0.03, 0.03, 0.28, 0.94, "#101012");
        ctx.image(vx2, wz1 - 0.1, 1.55, 0.62, Math.PI, ringMirrorImg());
      });
      ctx.box(I.x0 + 0.08, I.z0 + 0.35, 0.08, 0.7, 2.1, 0, "#3a2416", { solid: false });
      ctx.act(I.x0 + 1.0, wcZ, "Туалет: умыться", function () { if (FC.player && FC.player.heal) FC.player.heal(5); FC.hud.toast("🧼 Круглые зеркала с подсветкой, бетонные раковины — чисто", "ok", 2.5); }, 1.3);
    }
    // ---- зал: столы — у витражей, вдоль зала и по бокам бара; середина — проход от двери к бару
    var spots = [], rowA = I.z0 + 2.3, rowB = Math.min(I.z1 - 2.2, bz - 0.6);
    for (var xa = I.x0 + 1.9; xa < I.x1 - 1.6; xa += 3.1) spots.push([xa, rowA]);
    for (var xb = I.x0 + 1.9; xb < I.x1 - 1.6; xb += 3.1) if (Math.abs(xb - bx) > bw / 2 + 1.6 && Math.abs(xb - (mX + 0.9)) > 1.8) spots.push([xb, rowB]);
    spots.forEach(function (sp) {
      var x = sp[0], z = sp[1];
      if (big && x < wcX1 + 1.3 && z < I.z0 + 3.4) return;
      var rect = ((Math.round(x * 3 + z) % 3) === 0), inHall = x > hallX;
      if (rect ? !ctx.box(x, z, 1.3, 0.8, 0.72, 0, "#7a5638") : !ctx.cyl(x, z, 0.45, 0.72, 0, "#7a5638")) return;
      FC.places.hookahProp(ctx, x, z);
      var redSide = !inHall && (Math.round(x + z) % 2) === 0;
      [[-0.95, 0], [0.95, 0]].forEach(function (q, kk) {
        var bk = x + q[0] + (kk ? 0.34 : -0.34), col = redSide ? "#8c1422" : "#1b1b1d", col2 = redSide ? "#7a101c" : "#121214";
        if (redSide || inHall) {                                           // кресло-«уши»: красный бархат или чёрная стёганая кожа
          ctx.box(x + q[0], z, 0.75, 0.75, 0.45, 0, col, { solid: false });
          ctx.box(bk, z, 0.14, 0.8, 1.15, 0.3, col2, { solid: false });
          [-0.36, 0.36].forEach(function (az) { ctx.box(x + q[0], z + az, 0.72, 0.1, 0.24, 0.45, col2, { solid: false }); ctx.box(bk + (kk ? -0.12 : 0.12), z + az, 0.18, 0.1, 0.4, 1.0, col2, { solid: false }); });
        }
        else { ctx.box(x + q[0], z, 0.8, 1.6, 0.42, 0, "#3a3b3e", { solid: false }); ctx.box(x + q[0] + (kk ? 0.36 : -0.36), z, 0.14, 1.6, 0.55, 0.42, "#2c2d30", { solid: false }); }
        ctx.seat(x + q[0], z, 0, "chair");
      });
      if (ctx.r() < 0.7) ctx.npc(x - 0.95, z, FC.people.randomCell(ctx.r), { line: LINES });
      if (ctx.r() < 0.45) ctx.npc(x + 0.95, z, FC.people.randomCell(ctx.r), { line: LINES });
    });
  }
  function slatsImg() {
    return IMG.slats || (IMG.slats = cv2url(512, 512, function (c, W, H) {
      c.fillStyle = "#24160e"; c.fillRect(0, 0, W, H);
      for (var k = -W; k < W * 2; k += 26) { c.fillStyle = k % 52 ? "#4a2e1e" : "#3a2418"; c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 16, 0); c.lineTo(k + 16 - H, H); c.lineTo(k - H, H); c.closePath(); c.fill(); }
    }));
  }
  function haloImg() {
    return IMG.halo || (IMG.halo = cv2url(256, 256, function (c) {
      c.fillStyle = "#e9e7e2"; c.fillRect(0, 0, 256, 256); c.fillStyle = "#111"; c.beginPath(); c.arc(128, 128, 124, 0, 7); c.fill();
      c.fillStyle = "#9fb3c0"; c.beginPath(); c.arc(128, 128, 82, 0, 7); c.fill(); c.strokeStyle = "#151515"; c.lineWidth = 8;
      c.beginPath(); c.moveTo(46, 128); c.lineTo(210, 128); c.moveTo(128, 46); c.lineTo(128, 210); c.stroke();
    }));
  }
  // второй этаж двухэтажного лаунжа (набор lounge2): белый блок (−x) — комната у круглого окна с меха-девушкой и кабинки PS со стенами из
  // диагональных реек; его стена в сторону зала — девушка-космонавт с кольцами дыма; над залом (спереди) — проём в
  // арматуре от пола до потолка, сквозь него висят шары и папоротники; антресоль сзади над баром — красные кресла парами
  // вдоль арматуры, чёрные стёганые «ванны», мурал со змеёй и оливковые кресла; над ЮЗ концом — ещё кресла у витража
  function lounge2(o, ctx) {
    var B = ctx.B, pl = B.place || {}, it = pl.interior || {}, I = { x0: o.x0 + 0.7, x1: o.x1 - 0.7, z0: o.z0 + 0.7, z1: o.z1 - 0.7 };
    I.w = I.x1 - I.x0; I.d = I.z1 - I.z0; I.cx = (I.x0 + I.x1) / 2; I.cz = (I.z0 + I.z1) / 2;
    var hc = ctx.hc, A = artOf(it);
    if (I.w < 14 || I.d < 6) return lounge2small(o, ctx);
    var st = FC.inside && FC.inside.stairs ? FC.inside.stairs() : null, stX0 = st && st.x0 != null ? st.x0 : I.x1 - 2.7;
    var core = ctx.plan && ctx.plan.core, coreX0 = core && core.x0 != null ? core.x0 : stX0;   // площадка лестницы — занята движком
    var pX = I.x0 + I.w * 0.42, roomX = I.x0 + 3.6;
    var vX0 = pX + 0.15, vX1 = Math.min(coreX0 - 1.7, I.x1 - 4.2), vZ0 = I.z0 - 0.7, vZ1 = I.z1 - 2.9;   // от лестницы к антресоли — проход между проёмом и площадкой
    // 1) комната у круглого окна: окно с крестом в чёрном ореоле и логотипом, угловой диван из нубука, синий ковёр,
    //    чёрная кованая люстра со свечами, меха-девушка «脆い [メカ]» с розовой подсветкой
    var wz = I.cz + 0.4;
    ctx.image(I.x0 + 0.08, wz, 2.0, 2.5, Math.PI / 2, haloImg());
    if (pl.logo) ctx.image(I.x0 + 0.12, wz, 2.0, 0.6, Math.PI / 2, pl.logo);
    ctx.glow(I.x0 + 0.06, wz, 0.03, 1.7, 0.5, 0.25, "#1a1a1c");
    ctx.box(I.x0 + 1.5, I.z1 - 0.5, 2.6, 0.9, 0.45, 0, "#7a5a3a"); ctx.box(I.x0 + 0.5, I.z1 - 1.8, 0.9, 1.8, 0.45, 0, "#7a5a3a");
    ctx.box(I.x0 + 1.5, I.z1 - 0.12, 2.6, 0.16, 0.5, 0.45, "#634830", { solid: false });
    ctx.seat(I.x0 + 1.5, I.z1 - 0.6, Math.PI, "chair"); ctx.seat(I.x0 + 0.6, I.z1 - 1.8, 0, "chair");
    ctx.cyl(I.x0 + 1.8, I.z1 - 1.7, 0.45, 0.72, 0, "#7a5638", { solid: false }); P.hookahProp(ctx, I.x0 + 1.8, I.z1 - 1.7);
    ctx.box(I.x0 + 1.8, I.z1 - 1.7, 2.4, 2.0, 0.01, 0.003, "#1c2a4a", { solid: false });
    for (var cl = 0; cl < 8; cl++) { var ca = cl / 8 * Math.PI * 2, clx = I.x0 + 1.8 + Math.cos(ca) * 0.45, clz = I.z1 - 1.7 + Math.sin(ca) * 0.45; ctx.glow(clx, clz, 0.04, 0.04, 0.16, hc - 0.92, "#151515"); ctx.glow(clx, clz, 0.05, 0.05, 0.08, hc - 0.76, "#ffd9a0"); }
    ctx.glow(I.x0 + 1.8, I.z1 - 1.7, 0.95, 0.95, 0.03, hc - 0.93, "#151515"); ctx.glow(I.x0 + 1.8, I.z1 - 1.7, 0.04, 0.04, 0.55, hc - 0.6, "#101012");
    if (A.mecha) { ctx.image((I.x0 + roomX) / 2, I.z0 + 0.1, 1.75, Math.min(3.0, roomX - I.x0 - 0.3), 0, A.mecha); ctx.glow((I.x0 + roomX) / 2, I.z0 + 0.1, 3.0, 0.03, 0.04, 0.12, "#ff2a9a"); ctx.glow((I.x0 + roomX) / 2, I.z0 + 0.1, 3.0, 0.03, 0.04, hc - 0.2, "#e0218a"); }
    ctx.npc(I.x0 + 1.5, I.z1 - 1.15, FC.people.randomCell(ctx.r), { line: ["Тут как в своей квартире", "Возьмём ещё чашу?"] });
    // перегородка «криттал» между комнатой и кабинками PS: чёрная решётка, проход посередине
    [[I.z0, I.cz - 0.8], [I.cz + 0.8, I.z1]].forEach(function (zz) {
      var L = zz[1] - zz[0], zc = (zz[0] + zz[1]) / 2;
      ctx.box(roomX, zc, 0.08, L, 0.4, 0, "#121214", { force: true });
      for (var gz = zz[0]; gz <= zz[1] + 0.01; gz += 0.6) ctx.glow(roomX, gz, 0.05, 0.04, hc - 0.2, 0, "#121214");
      for (var gy = 0.9; gy < hc - 0.2; gy += 0.9) ctx.glow(roomX, zc, 0.05, L, 0.04, gy, "#121214");
    });
    // 2) кабинки PS: стены из диагональных реек, П-образные замшевые диваны, ТВ на чёрных стойках, сетка с плющом
    var psX = (roomX + pX) / 2;
    ctx.image(psX, I.z0 + 0.1, hc / 2, pX - roomX - 0.3, 0, slatsImg());
    ctx.image(psX, I.z1 - 0.1, hc / 2, pX - roomX - 0.3, Math.PI, slatsImg());
    [I.z0 + 1.1, I.z1 - 1.1].forEach(function (bz2, n) {
      if (!ctx.box(psX, bz2, 1.0, 0.6, 0.6, 0, "#2b1d14")) return;
      var away = n ? -1 : 1;
      ctx.box(psX, bz2 + away * 1.15, 1.5, 0.7, 0.42, 0, "#7a4a2e", { solid: false }); ctx.box(psX, bz2 + away * 1.45, 1.5, 0.16, 0.5, 0.42, "#6a3e26", { solid: false });
      ctx.seat(psX, bz2 + away * 1.15, n ? Math.PI : 0, "chair");
      ctx.box(psX, bz2 - away * 0.4, 0.5, 0.12, 1.0, 0, "#101012", { solid: false }); ctx.box(psX, bz2 - away * 0.42, 1.5, 0.06, 0.85, 1.0, "#0d0d10", { solid: false });
      ctx.glow(psX, bz2 - away * 0.38, 1.4, 0.02, 0.78, 1.04, n ? "#5b74ff" : "#3a8f5a");
      if (n === 0) ctx.act(psX, bz2 + 0.6, "Приставка: сыграть партию", function () { FC.hud.toast("🎮 Победа 3:1 — кальянщик просит реванш", "ok", 3); }, 1.5);
      ctx.npc(psX + 0.4, bz2 + away * 1.15, FC.people.randomCell(ctx.r), { line: ["Ещё катку в Mortal Kombat?", "GTA или Split Fiction?"] });
    });
    // 3) стена белого блока в зал: проход сзади (к антресоли), со стороны зала — девушка с кольцами дыма
    ctx.box(pX, (I.z0 + I.z1 - 1.4) / 2 - 0.35, 0.16, I.z1 - I.z0 - 0.7, hc, 0, "#e6e4de", { force: true });
    if (A.smoke) ctx.image(pX + 0.1, I.cz - 1.0, hc / 2, Math.min(3.0, hc * 0.75), Math.PI / 2, A.smoke);
    ctx.image(pX - 0.1, I.cz - 0.4, hc / 2, 3.0, -Math.PI / 2, calliWall());
    // 4) проём над залом: бетонный бортик, арматура от пола до потолка (реже, чем в жизни — иначе камера ничего не видит)
    var vw = vX1 - vX0, vcx = (vX0 + vX1) / 2, vcz = (Math.max(vZ0, I.z0) + vZ1) / 2, vd = vZ1 - Math.max(vZ0, I.z0);
    ctx.glow(vcx, vcz, vw, vd, 0.01, 0.012, "#0b0b0d");
    [[vcx, vZ1, vw + 0.2, 0.16], [vX1, vcz, 0.16, vd]].forEach(function (c4) { ctx.box(c4[0], c4[1], c4[2], c4[3], 0.37, 0, "#8e8c88", { force: true }); });
    for (var rx = vX0; rx <= vX1 + 0.01; rx += 0.32) ctx.glow(rx, vZ1, 0.015, 0.015, hc - 0.37, 0.37, "#0c0c0e");
    for (var rz = Math.max(vZ0, I.z0); rz <= vZ1 + 0.01; rz += 0.32) ctx.glow(vX1, rz, 0.015, 0.015, hc - 0.37, 0.37, "#0c0c0e");
    for (var gb = 0; gb < 8; gb++) { var gx = vX0 + 0.5 + ctx.r() * (vw - 1), gzz = Math.max(vZ0, I.z0) + 0.4 + ctx.r() * (vd - 0.8), gyy = 0.3 + ctx.r() * 1.3; ctx.glow(gx, gzz, 0.01, 0.01, hc - gyy, gyy, "#101012"); ctx.cyl(gx, gzz, 0.2, 0.3, gyy - 0.3, "#3a3a3c", { solid: false }); ctx.glow(gx, gzz, 0.08, 0.08, 0.1, gyy - 0.2, "#e09a3c"); }
    for (var fp = 0; fp < 3; fp++) { var fx = vX0 + 0.8 + fp * (vw - 1.6) / 2; ctx.cyl(fx, vcz, 0.5, 0.25, 1.3, "#4e7a3a", { solid: false }); ctx.glow(fx, vcz, 0.01, 0.01, hc - 1.55, 1.55, "#101012"); }
    for (var iv = vX0; iv < vX1; iv += 0.6) ctx.glow(iv + 0.3, vZ1, 0.5, 0.06, 0.25 + ctx.r() * 0.3, hc - 0.6, "#4f8a45");
    // 5) антресоль над баром: у арматуры — красные кресла парами у круглых дубовых столов; у стены — «ванны» и змея
    var cols = ["#8e1018", "#9e2a1c", "#8e1018", "#a84a3a", "#6b6c5c", "#e07a86"];
    for (var t = 0, tx = vX0 + 1.0; tx < vX1 - 0.3; tx += 2.2, t++) {
      var tz = vZ1 + 0.75;
      if (!ctx.cyl(tx, tz, 0.33, 0.72, 0, "#8a6038", { solid: false })) continue;   // столики антресоли проходимы: иначе отрезают её от лестницы
      P.hookahProp(ctx, tx, tz);
      [-1, 1].forEach(function (sd, kk) {
        var col = cols[(t * 2 + kk) % cols.length], cx = tx + sd * 0.75, bk = cx + sd * 0.33;
        ctx.box(cx, tz, 0.72, 0.72, 0.45, 0, col, { solid: false });
        ctx.box(bk, tz, 0.13, 0.78, 1.1, 0.3, col, { solid: false });
        [-0.34, 0.34].forEach(function (az) { ctx.box(cx, tz + az, 0.7, 0.1, 0.22, 0.45, col, { solid: false }); ctx.box(bk - sd * 0.11, tz + az, 0.16, 0.1, 0.38, 0.98, col, { solid: false }); });
        ctx.seat(cx, tz, sd > 0 ? -Math.PI / 2 : Math.PI / 2, "chair");
        if (ctx.r() < 0.55) ctx.npc(cx, tz, FC.people.randomCell(ctx.r), { line: LINES });
      });
    }
    var snW = Math.min(3.6, (coreX0 - 0.3) - (pX + 3.0)), snX = coreX0 - 0.3 - snW / 2;
    for (var sx = pX + 2.0; sx < snX - snW / 2 - 0.6; sx += 2.4) {           // у стены белого блока — проход в комнаты, не занимать
      var sz = I.z1 - 0.55;
      if (!ctx.box(sx, sz, 1.2, 0.6, 0.72, 0, "#7a5638", { solid: false })) continue;
      P.hookahProp(ctx, sx, sz);
      ctx.box(sx, sz - 0.7, 1.5, 0.7, 0.42, 0, "#141416", { solid: false }); ctx.box(sx, sz - 1.0, 1.5, 0.16, 0.5, 0.42, "#0e0e10", { solid: false });
      ctx.seat(sx, sz - 0.7, 0, "chair");
      if (ctx.r() < 0.7) ctx.npc(sx, sz - 0.7, FC.people.randomCell(ctx.r), { line: LINES });
    }
    if (A.snake) { ctx.image(snX, I.z1 - 0.1, 1.5, snW, Math.PI, A.snake); ctx.glow(snX, I.z1 - 0.1, snW, 0.03, 0.04, 0.1, "#ffcf8a"); }
    [-0.85, 0.85].forEach(function (dx, kk) {
      var cx = snX + dx, bk = cx + (kk ? 0.33 : -0.33);
      ctx.box(cx, I.z1 - 0.75, 0.72, 0.72, 0.45, 0, "#5c5e48", { solid: false }); ctx.box(bk, I.z1 - 0.75, 0.13, 0.78, 1.15, 0.3, "#55574a", { solid: false });
      ctx.seat(cx, I.z1 - 0.75, 0, "chair");
    });
    ctx.cyl(snX, I.z1 - 0.75, 0.3, 0.7, 0, "#3a2a22", { solid: false });
    // 6) над ЮЗ концом: красные кресла у витража; место у лестницы свободно (туда приходит игрок)
    for (var sw = 0; sw < 2; sw++) {
      var wx = vX1 + 1.3 + sw * 1.9, wzz = I.z0 + 0.8;
      if (wx > I.x1 - 0.6 || !ctx.box(wx, wzz, 0.75, 0.75, 0.45, 0, "#8e1018", { solid: false })) continue;
      ctx.box(wx, wzz - 0.32, 0.8, 0.12, 1.1, 0.3, "#7a0d15", { solid: false }); ctx.seat(wx, wzz, 0, "chair");
      if (ctx.r() < 0.6) ctx.npc(wx, wzz, FC.people.randomCell(ctx.r), { line: LINES });
    }
    ctx.cyl(vX1 + 2.25, I.z0 + 1.5, 0.3, 0.7, 0, "#8a6038");
    // потолок: белый LED-шнур змейкой, подвесы с лампами Эдисона над антресолью
    for (var nx2 = pX; nx2 < I.x1 - 0.5; nx2 += 1.2) ctx.glow(nx2 + 0.6, vZ1 + 1.4 + Math.sin(nx2) * 0.5, 1.2, 0.03, 0.03, hc - 0.12, "#fff2c8");
    for (var ed = 0; ed < 4; ed++) { var ex = vX0 + 1.0 + ed * 2.2; if (ex > vX1) break; ctx.glow(ex, vZ1 + 0.75, 0.01, 0.01, 0.5, hc - 0.5, "#101012"); ctx.cyl(ex, vZ1 + 0.75, 0.1, 0.22, hc - 0.72, "#d8e0e4", { solid: false }); ctx.glow(ex, vZ1 + 0.75, 0.04, 0.04, 0.12, hc - 0.66, "#ffb347"); }
  }
  function lounge2small(o, ctx) {
    var B = ctx.B, pl = B.place || {}, it = pl.interior || {}, I = { x0: o.x0 + 0.7, x1: o.x1 - 0.7, z0: o.z0 + 0.7, z1: o.z1 - 0.7 };
    I.w = I.x1 - I.x0; I.d = I.z1 - I.z0; I.cx = (I.x0 + I.x1) / 2; I.cz = (I.z0 + I.z1) / 2;
    var thirdX = I.x0 + I.w / 3, twoX = I.x0 + 2 * I.w / 3;
    // 1) комната за круглым окном: подсвеченный иллюминатор с логотипом, коричневый кожаный угловой диван, хрустальная люстра
    if (pl.logo) ctx.image(I.x0 + 0.1, I.z1 - 1.6, 1.9, 1.1, Math.PI / 2, pl.logo);
    ctx.glow(I.x0 + 0.06, I.z1 - 1.6, 0.03, 1.25, 1.25, 1.35, "#fff4dc");
    ctx.box(I.x0 + 1.1, I.z1 - 0.7, 2.6, 0.9, 0.45, 0, "#6b3f2a"); ctx.box(I.x0 + 0.5, I.z1 - 2.4, 0.9, 2.6, 0.45, 0, "#6b3f2a");
    ctx.box(I.x0 + 1.1, I.z1 - 0.32, 2.6, 0.16, 0.5, 0.45, "#5a3322", { solid: false });
    ctx.seat(I.x0 + 1.1, I.z1 - 0.8, -1, "chair"); ctx.seat(I.x0 + 0.6, I.z1 - 2.4, 0, "chair");
    ctx.cyl(I.x0 + 1.8, I.z1 - 2.0, 0.45, 0.42, 0, "#3a2a22"); P.hookahProp(ctx, I.x0 + 1.8, I.z1 - 2.0);
    for (var cl = 0; cl < 10; cl++) ctx.glow(I.x0 + 1.8 + Math.cos(cl) * 0.35, I.z1 - 2.0 + Math.sin(cl) * 0.35, 0.07, 0.07, 0.22, ctx.hc - 0.9 + (cl % 3) * 0.12, "#fffaf0");
    ctx.npc(I.x0 + 1.1, I.z1 - 0.8, FC.people.randomCell(ctx.r), { line: ["Тут как в своей квартире", "Возьмём ещё чашу?"] });
    // 2) зона с приставкой: большой экран, круглый стол, диваны, сетчатая перегородка
    ctx.box(I.cx, I.z1 - 0.1, 2.6, 0.08, 1.5, 0.9, "#0d0d10", { solid: false }); ctx.glow(I.cx, I.z1 - 0.15, 2.45, 0.02, 1.35, 0.98, "#5b74ff");
    ctx.cyl(I.cx, I.z1 - 2.2, 0.55, 0.5, 0, "#1d1d20"); P.hookahProp(ctx, I.cx, I.z1 - 2.2);
    ctx.box(I.cx, I.z1 - 3.4, 2.4, 0.85, 0.45, 0, "#2a2a2e"); ctx.box(I.cx, I.z1 - 3.75, 2.4, 0.16, 0.55, 0.45, "#232327", { solid: false });
    ctx.seat(I.cx - 0.6, I.z1 - 3.4, 1, "chair"); ctx.seat(I.cx + 0.6, I.z1 - 3.4, 1, "chair");
    for (var mg = -1.4; mg <= 1.41; mg += 0.35) ctx.glow(I.cx + 1.9, I.z1 - 2.3 + mg, 0.02, 0.02, 2.3, 0.1, "#151517");
    ctx.act(I.cx, I.z1 - 2.9, "Приставка: сыграть партию", function () { FC.hud.toast("🎮 Победа 3:1 — кальянщик просит реванш", "ok", 3); }, 1.5);
    ctx.npc(I.cx - 0.6, I.z1 - 3.4, FC.people.randomCell(ctx.r), { line: ["Ещё катку в Mortal Kombat?", "GTA или Split Fiction?"] });
    // 3) мурал «девушка со змеёй» и серые «уши» рядом
    if (it.murals && it.murals[3]) ctx.image(I.x1 - 0.12, I.z1 - 2.0, 1.8, 2.0, -Math.PI / 2, it.murals[3]);
    [-0.8, 0.8].forEach(function (dz) { ctx.box(I.x1 - 1.0, I.z1 - 2.0 + dz, 0.75, 0.75, 0.45, 0, "#5d5f63"); ctx.box(I.x1 - 0.66, I.z1 - 2.0 + dz, 0.12, 0.8, 1.3, 0.1, "#55575b", { solid: false }); ctx.seat(I.x1 - 1.0, I.z1 - 2.0 + dz, 0, "chair"); });
    // 4) стена из диагональных реек с коричневыми кожаными диванами
    for (var sl = 0; sl < 14; sl++) ctx.box(I.x1 - 0.08, I.z0 + 1.0 + sl * 0.32, 0.05, 0.12, 2.3, 0.2 + (sl % 2) * 0.15, "#9a6f45", { solid: false });
    ctx.box(I.x1 - 0.7, I.z0 + 2.6, 0.85, 2.6, 0.45, 0, "#6b3f2a"); ctx.seat(I.x1 - 0.7, I.z0 + 2.0, 0, "chair"); ctx.seat(I.x1 - 0.7, I.z0 + 3.2, 0, "chair");
    ctx.cyl(I.x1 - 1.8, I.z0 + 2.6, 0.42, 0.45, 0, "#3a2a22"); P.hookahProp(ctx, I.x1 - 1.8, I.z0 + 2.6);
    // 5) красные бархатные «уши» вдоль витража ротонды
    for (var rw = 0; rw < 4; rw++) {
      var wx = I.x0 + 1.4 + rw * Math.max(1.6, (I.w - 3) / 4), wz = I.z0 + 0.9;
      if (!ctx.box(wx, wz, 0.75, 0.75, 0.45, 0, "#8e1018")) continue;
      ctx.box(wx, wz - 0.32, 0.8, 0.12, 1.35, 0.1, "#7a0d15", { solid: false }); ctx.seat(wx, wz, 1, "chair");
      if (ctx.r() < 0.6) ctx.npc(wx, wz, FC.people.randomCell(ctx.r), { line: LINES });
    }
    ctx.glow(I.cx, I.z0 - 0.5, I.w * 0.8, 0.03, 0.04, 0.12, "#ffd9a0");
    // зелень и тёплый свет
    for (var hp2 = 0; hp2 < 4; hp2++) { var hx2 = thirdX + ctx.r() * (twoX - thirdX), hz2 = I.z0 + 1.5 + ctx.r() * (I.d - 4); ctx.cyl(hx2, hz2, 0.3, 0.45, ctx.hc - 0.8, "#3f7f45", { solid: false }); }
    for (var lk = 0; lk < 4; lk++) ctx.glow(I.x0 + 1.5 + lk * (I.w - 3) / 3, I.cz, 0.3, 0.3, 0.1, ctx.hc - 0.35, "#ffcf8a");
  }
  function addLounge() {
    if (!FC.furn || !FC.furn.K) { setTimeout(addLounge, 100); return; }
    FC.furn.K.lounge1 = lounge1; FC.furn.K.lounge2 = lounge2;
  }
  addLounge();
  P.hookahProp = function (ctx, x, z) { hookah(ctx, x, z); };
  P.debugHeroes = function () { var o = []; heroBuilt.forEach(function (g, pl) { o.push(pl.id + ':' + g.children.length); }); return o; };

  P.ll = ll; P.add = add; P.refreshLogo = refreshLogo; P.KIND = KIND;
  FC.places = P;
})(window);
