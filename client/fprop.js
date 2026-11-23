/* Флейм-Сити — владение настоящими зданиями (FC.prop): дома и нежилые здания обоих городов, закреплённые на сервере.
 *
 * Задача: «можно здание, которое существует, купить за какие-то деньги, захватить, бизнес сделать,
 * построить, потом кого-то нанять на работу или уволить». Сервер — server/realty.py (таблица props): здание —
 * (город, ключ), второй покупатель получает 409. Ключ: Флейм-Сити — номер здания плана («123»), Минск — «m<x>_<z>»,
 * центр вершин контура OSM (номера контуров меняются при пересборке данных, место — нет). Сервер помнит адрес, x/z и
 * дверь — «Мои здания» и карта работают, даже если кусок Минска не загружен; здание находится по точке (resolve).
 *
 * Классы: res — жилые (дом/квартира: мебель, гараж, сон — fhome.js), com — нежилые (под бизнес — fbiz.js). Не продаются:
 * госучреждения и тихие зоны у мемориалов (M.gov, M.quiet), храмы, школы и больницы, точки города (участки, больницы,
 * магазины 24/7…), здания-зоны агентов, Башня Флейм. Лимит — 3 дома и 3 нежилых в каждом городе. Цена — та же
 * формула, что на сервере (realty.price_of): район × площадь × этажность × стиль × ориентир × класс; сервер считает
 * её сам и возвращает — списываем её. Деньги — FC.money; продажа — 70% цены (+ половина вложенного в бизнес и касса).
 * Наружу — вид агента-владельца («Лис»), ни имени, ни rid: реальные адреса людей игра не раскрывает.
 *
 *   FC.prop.keyOf(B) / classOf(B) / priceOf(B) / factsOf(B)      ключ, класс {cls|why}, цена, факты для сервера
 *   FC.prop.mine(cls?) / all() / takenOf(B) / mineOf(B) / resolve(p)   свои, занятые, своё ли, запись здания по записи
 *   FC.prop.buy(B) / sell(p) / primary(p) / route(p) / taxi(p) / open(tab, opt) / renderTab(tab, el, ctl)
 *   FC.prop.post(path, body) — запрос к игровому серверу (fbiz, fseason); события prop:mine, prop:taken, prop:buy, prop:sell
 */
(function (global) {
  "use strict";
  var FC = global.FC, M = FC.map, CITY = FC.city === "minsk" ? "minsk" : "flame";

  // адрес игрового сервера — FC.gs() (fcore: config.js, ?gs=, ?mp=)
  var HTTP = FC.gs();
  var LIMIT = { res: 3, com: 3 };

  var P = { taken: {}, list: [], mine: [], all: [], loaded: false, ok: true, sale: null, sel: null, filt: "res", rec: {} };

  FC.css([
    ".pr-chips{display:flex;gap:6px;margin:0 0 8px}.pr-chips button{flex:1;background:rgba(255,255,255,.1)!important;color:#fff!important;padding:6px 4px!important;font-size:12px}",
    ".pr-chips button.on{background:#c86bff!important;color:#1b0526!important}",
    ".pr-meta{font-size:12px;color:rgba(255,240,215,.62);margin:2px 0 0}",
    ".pr-badge{display:inline-block;font:700 10px system-ui;padding:1px 6px;border-radius:8px;background:rgba(255,207,122,.18);color:#ffcf7a;margin-left:4px;vertical-align:1px}",
    ".pr-badge.biz{background:rgba(200,107,255,.2);color:#e3b8ff}.pr-badge.ok{background:#2fbf71;color:#04210f}",
    ".pr-sum{display:flex;gap:6px;margin-bottom:8px}.pr-sum div{flex:1;background:rgba(255,255,255,.07);border-radius:12px;padding:7px 8px;font-size:11px;color:rgba(255,245,230,.6)}",
    ".pr-sum b{display:block;font:800 15px system-ui;color:#fff}"
  ].join("\n"));

  function token() { return FC.net && FC.net.token; }
  function money(n) { return FC.fmtMoney(n); }
  function toast(t, c, s) { if (FC.hud) FC.hud.toast(t, c || "", s || 2.4); }
  function esc(s) { return FC.hud && FC.hud.esc ? FC.hud.esc(s) : String(s == null ? "" : s); }
  function noop() {}

  /* ---- цена: та же формула, что realty.price_of на сервере --------------------------------------------------- */
  var BASE = { flame: [0, 90000, 60000, 38000, 30000], minsk: [0, 70000, 45000, 30000, 22000] };
  var STYLE_K = { glass: 1.5, stalin: 1.3, modern: 1.15, brick: 1.05, panel: 0.9, house: 0.8, studio: 1 };
  var GENERIC = ["Жилой дом", "Храм", "Общественное здание", "Завод", "Магазин", "Здание"];
  function tierOf(B) {
    if (CITY !== "minsk") return { center: 1, msk: 2, minsk: 3, ala: 4 }[B.dist] || 4;
    var d = Math.hypot(B.x + 900, B.z + 400);
    return d < 2600 ? 1 : d < 5500 ? 2 : d < 9000 ? 3 : 4;
  }
  function origName(B) { return B._orig ? B._orig.name : B.name; }
  function landmarkOf(B) {
    if (CITY !== "minsk") return B.h >= 90 || (B.style === "glass" && B.floors >= 25);
    var n = origName(B);
    return (!!n && GENERIC.indexOf(n) < 0) || B.h > 60;
  }
  function factsOf(B) {
    return { area: Math.round(B.w * B.d), floors: B.floors || 1, tier: tierOf(B), style: STYLE_K[B.style] ? B.style : "", landmark: !!landmarkOf(B) };
  }
  function priceOf(B, cls) {
    cls = cls || (classOf(B) || {}).cls || "res";
    var f = factsOf(B), area = FC.clamp(f.area / 700, 0.6, 2.2), fl = 0.7 + Math.min(f.floors, 30) / 20;
    var p = BASE[CITY][f.tier] * area * fl * (STYLE_K[f.style] || 1);
    if (f.landmark) p *= 2.5;
    if (cls === "com") p *= 1.2;
    return Math.max(8000, Math.round(p / 500) * 500);
  }

  /* ---- что продаётся -------------------------------------------------------------------------------------------- */
  var NOT = { gov: "Госучреждение — не продаётся", quiet: "Тихая зона у мемориала — не продаётся", city: "Городской объект — не продаётся",
    church: "Храм — не продаётся", pub: "Общественное здание — не продаётся", small: "Слишком маленькое здание",
    franchise: "Франшиза города — точка покупается у входа" };
  var COM_OSM = { office: 1, shop: 1, industrial: 1 };
  function classOf(B) {
    if (!B || B.prop || !B.doors) return null;
    if (B._own) return { cls: "com" };                      // бизнес игрока (оформил fbiz.js)
    if (B.type === "hq" || B.zone) return { why: NOT.city };
    if (B.poi === "biz") return { why: NOT.franchise };
    if (B.poi) return { why: NOT.city };
    if (CITY === "minsk") {
      if (M.gov && M.gov(B.x, B.z)) return { why: NOT.gov };
      if (M.quiet && M.quiet(B.x, B.z)) return { why: NOT.quiet };
      var k = B.kindOsm, A = B.w * B.d;
      if (A < 40) return { why: NOT.small };
      if (k === "res" || k === "house") return { cls: "res" };
      if (COM_OSM[k] || (k === "garage" && A >= 80)) return { cls: "com" };
      if (k === "church") return { why: NOT.church };
      if (k === "public") return { why: NOT.pub };
      return { why: NOT.city };
    }
    if (B.type === "res") return { cls: "res" };
    if (B.type === "office") return { cls: "com" };
    return { why: NOT.city };
  }
  function kindName(B, cls) {
    if (!B) return cls === "com" ? "Здание" : "Дом";
    if ((cls || (classOf(B) || {}).cls) === "res") return B.style === "house" || B.kindOsm === "house" ? "Дом" : "Квартира";
    if (B.kindOsm === "shop") return "Торговое помещение";
    if (B.kindOsm === "industrial") return "Цех";
    if (B.kindOsm === "garage") return "Бокс";
    return B.style === "studio" ? "Студия" : "Офисное здание";
  }

  /* ---- ключи и поиск записи здания ------------------------------------------------------------------------------- */
  function keyOfPoly(p) {
    var sx = 0, sz = 0;
    for (var i = 0; i < p.length; i++) { sx += p[i][0]; sz += p[i][1]; }
    return "m" + Math.round(sx / p.length) + "_" + Math.round(sz / p.length);
  }
  function keyOf(B) {
    if (!B || B.prop) return null;
    if (B._pk) return B._pk;
    if (CITY !== "minsk") return (B._pk = typeof B.id === "number" ? String(B.id) : null);
    var p = B.poly; if (!p || !p.length) return null;
    return (B._pk = keyOfPoly(p));
  }
  function inPoly(x, z, p) {
    if (!p) return false;
    var inside = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  }
  // запись здания по записи владения (своей или чужой): Флейм-Сити — по номеру, Минск — по точке (кусок должен быть загружен)
  function resolve(p) {
    if (!p) return null;
    var city = p.city || CITY, key = p.key || p.k;
    if (city !== CITY) return null;
    if (CITY !== "minsk") return M.buildings[+key] || null;
    var c = P.rec[key];
    if (c && c.doors) return c;
    if (p.x == null || !FC.osm) return null;
    // сперва — контур с тем же ключом (в точке могут лежать и части здания), потом — контур, в котором точка
    var hit = null;
    FC.osm.near(p.x, p.z, 40).forEach(function (it) { if (!hit && it.p && keyOfPoly(it.p) === key) hit = it; });
    if (!hit) { var at = FC.osm.itemAt(p.x, p.z, 0.5); if (at && at.p && inPoly(p.x, p.z, at.p)) hit = at; }
    var B = hit && M.recordOf(hit);
    if (B && !B.prop && B.doors) { P.rec[key] = B; return B; }
    return null;
  }
  function near(a, B) { return a.x != null && Math.abs(a.x - B.x) < 90 && Math.abs(a.z - B.z) < 90 && inPoly(a.x, a.z, B.poly); }
  function takenOf(B) {
    var k = keyOf(B); if (!k) return null;
    if (P.taken[k]) return P.taken[k];
    if (CITY === "minsk" && B.poly) for (var i = 0; i < P.list.length; i++) if (near(P.list[i], B)) return P.list[i];
    return null;
  }
  function mineOf(B) {
    var k = keyOf(B); if (!k) return null;
    for (var i = 0; i < P.mine.length; i++) if (P.mine[i].key === k) return P.mine[i];
    if (CITY === "minsk" && B.poly) for (var j = 0; j < P.mine.length; j++) if (near(P.mine[j], B)) return P.mine[j];
    return null;
  }
  function mine(cls) { return P.mine.filter(function (p) { return !cls || p.cls === cls; }); }
  function homeOf() {
    var l = mine("res"), pin = FC.save.homePrimary;
    for (var i = 0; i < l.length; i++) if (pin != null && l[i].key === String(pin)) return l[i];
    for (var k = 0; k < l.length; k++) if (l[k].kind === "home") return l[k];
    return l[0] || null;
  }
  function door(p) {
    var B = resolve(p), d = B && B.doors && B.doors[0];
    if (d) return { x: d.x + d.nx * 2.5, z: d.z + d.nz * 2.5, h: Math.atan2(d.nx, d.nz) };
    if (p.dx != null) return { x: p.dx, z: p.dz, h: 0 };
    return p.x != null ? { x: p.x, z: p.z, h: 0 } : null;
  }
  function addrOf(p) { var B = resolve(p); return p.addr || (B && B.addr) || "здание " + (p.key || p.k); }
  function distName(x, z) { var d = M.district && M.district(x, z); return d ? d.name : ""; }

  /* ---- сеть ------------------------------------------------------------------------------------------------------- */
  function post(path, body) {
    return FC.gfetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.detail || ("ошибка " + r.status)); e.status = r.status; throw e; }
          return j;
        });
      });
  }
  function refreshTaken() {
    return FC.gfetch("/g/props?city=" + CITY).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      var t = {};
      (d.props || []).forEach(function (p) { t[p.k] = p; });
      P.taken = t; P.list = d.props || []; P.ok = true;
      FC.emit("prop:taken", P.list);
    }).catch(function () { P.ok = false; });
  }
  function fromSave() {
    // сервер недоступен — последнее известное из сохранения (купить и продать без сервера нельзя); старый формат — {building}
    return (FC.save.homes || []).map(function (h) { return h.key ? h : { key: String(h.building), city: CITY, cls: "res", kind: h.kind, price: h.price }; });
  }
  function refreshMine() {
    if (!token()) { P.mine = []; P.all = []; P.loaded = true; FC.emit("prop:mine", P.mine); return Promise.resolve(); }
    return post("/g/prop/mine", { token: token() }).then(function (d) {
      P.all = d.props || []; P.mine = P.all.filter(function (p) { return p.city === CITY; }); P.loaded = true; P.ok = true;
      FC.save.homes = P.mine.map(function (p) {
        return { key: p.key, city: p.city, cls: p.cls, kind: p.kind, price: p.price, addr: p.addr, x: p.x, z: p.z, dx: p.dx, dz: p.dz, biz: p.biz };
      });
      FC.dirty(); backfill();
      FC.emit("prop:mine", P.mine);
    }).catch(function () {
      P.mine = fromSave(); P.all = P.mine.slice(); P.loaded = true; P.ok = false;
      FC.emit("prop:mine", P.mine);
    });
  }
  function refresh() { return Promise.all([refreshTaken(), refreshMine()]); }
  // записи, перенесённые со старых домов, — без адреса и точки: дописываем один раз, когда здание найдено
  function backfill() {
    var todo = P.mine.filter(function (p) { return !p.addr && resolve(p); });
    todo.forEach(function (p, i) {
      setTimeout(function () {
        var B = resolve(p), d = door(p); if (!B) return;
        post("/g/prop/info", { token: token(), city: CITY, key: p.key, addr: B.addr || B.name, x: B.x, z: B.z, dx: d.x, dz: d.z, facts: factsOf(B) }).catch(noop);
      }, 1200 * (i + 1));
    });
  }

  /* ---- купить, продать, главный дом, маршрут, такси ------------------------------------------------------------ */
  function loginCard() {
    if (FC.hud) FC.hud.dialog([{ who: FC.MASCOT.name, face: "mascot", text: "Здание закрепляется за игроком навсегда — для этого нужно войти. " +
      FC.net.loginHint() }], function () { FC.net.openLogin(); });
  }
  function buy(B) {
    var c = classOf(B);
    if (!c || !c.cls) { toast(c ? c.why : "Не продаётся", "bad", 3); return Promise.resolve(false); }
    if (!token()) { loginCard(); return Promise.resolve(false); }
    if (mineOf(B)) { toast("Это уже твоё", "ok"); return Promise.resolve(false); }
    if (takenOf(B)) { toast("Это здание уже чьё-то", "bad"); return Promise.resolve(false); }
    var lv = FC.progress ? FC.progress.gate("prop", B) : 0;                     // ориентиры — с уровня (fprogress.js)
    if (lv) { toast("Ориентиры (высотки, известные здания) — с " + lv + "-го уровня", "bad", 3); return Promise.resolve(false); }
    if (mine(c.cls).length >= LIMIT[c.cls]) { toast("Не больше " + LIMIT[c.cls] + (c.cls === "res" ? " домов" : " нежилых зданий") + " в городе — продай одно", "bad", 3.5); return Promise.resolve(false); }
    var price = priceOf(B, c.cls);
    if (FC.save.money < price) { toast("Не хватает " + money(price - FC.save.money), "bad"); return Promise.resolve(false); }
    var key = keyOf(B), d = B.doors[0];
    P.rec[key] = B;
    var body = { token: token(), city: CITY, key: key, cls: c.cls, facts: factsOf(B), addr: B.addr || B.name, x: B.x, z: B.z,
      dx: d.x + d.nx * 2.5, dz: d.z + d.nz * 2.5 };
    return post("/g/prop/claim", body).then(function (r) {
      var paid = r.price || price;
      if (!r.already && FC.money(-paid, (c.cls === "res" ? "недвижимость: " : "здание: ") + kindName(B, c.cls).toLowerCase()) === false) {
        // денег не хватило после ответа (потратил, пока шёл запрос) — отдаём здание обратно
        post("/g/prop/sell", { token: token(), city: CITY, key: key }).catch(noop);
        toast("Не хватает денег", "bad"); return false;
      }
      if (FC.audio) FC.audio.play("cash");
      if (FC.fx && FC.player) { FC.fx.burst(FC.player.x, 1.4, FC.player.z, "confetti", 50); if (FC.fx.haptic) FC.fx.haptic("medium"); }
      if (FC.hud) FC.hud.big(c.cls === "res" ? "ТВОЙ ДОМ" : "ТВОЁ ЗДАНИЕ", kindName(B, c.cls) + " · " + (B.addr || B.name) + (c.cls === "res" ? " — теперь только твоя" : " — открывай бизнес"), c.cls === "res" ? "#9dffbf" : "#e3b8ff", 3.2);
      FC.emit("prop:buy", { B: B, cls: c.cls, price: paid, key: key });
      if (c.cls === "res") FC.emit("home:buy", { building: B, price: paid });
      return refresh().then(function () { return true; });
    }).catch(function (e) {
      if (e.status === 409) { toast("Это здание только что купили — выбери другое", "bad", 3); refreshTaken(); }
      else if (e.status === 401) loginCard();
      else toast(e.message || "Не получилось купить", "bad", 3);
      return false;
    });
  }
  function sell(p) {
    var est = Math.round(p.price * 0.7);
    var what = (p.cls === "res" ? "дом" : "здание") + " «" + addrOf(p) + "»";
    var extra = p.biz ? " Бизнес «" + p.biz.name + "» закроется: вернём половину вложенного и всю кассу." : "";
    if (!global.confirm("Продать " + what + " за " + money(est) + " (70% цены)?" + extra + " Здание сразу станет свободным для других.")) return Promise.resolve(false);
    return post("/g/prop/sell", { token: token(), city: p.city || CITY, key: p.key }).then(function (d) {
      var got = d.refund != null ? d.refund : est;
      FC.money(got, "недвижимость: продажа");
      toast("Продано: +" + money(got), "ok", 3);
      var B = resolve(p);
      FC.emit("prop:sell", { prop: p, B: B, refund: got });
      if (p.cls === "res") FC.emit("home:sell", { building: B });
      return refresh().then(function () { return true; });
    }).catch(function (e) { toast(e.message || "Не получилось продать", "bad", 3); return false; });
  }
  function primary(p) {
    FC.save.homePrimary = p.key; FC.dirty();
    P.mine.forEach(function (x) { if (x.cls === "res") x.kind = x.key === p.key ? "home" : "flat"; });
    FC.emit("prop:mine", P.mine);
    if (token()) post("/g/prop/primary", { token: token(), city: CITY, key: p.key }).catch(noop);
    toast("Главный дом: " + addrOf(p), "ok");
  }
  function route(p, icon) {
    var d = door(p); if (!d) return false;
    P.sel = p.key || p.k;
    FC.markers.add({ id: "wp", x: d.x, z: d.z, color: "#c86bff", icon: icon || (p.cls === "com" ? "🏢" : "🏠"), route: true, ring: 2 });
    return true;
  }
  function taxi(p) {
    var cost = 150, d = door(p);
    if (!d) return;
    if (FC.player.mode !== "foot" || (FC.inside && FC.inside.active)) { toast("Выйди на улицу пешком — такси подберёт", ""); return; }
    if (FC.police && FC.police.stars > 0) { toast("С розыском такси не повезёт", "bad"); return; }
    if (FC.money(-cost, "такси") === false) { toast("Такси стоит " + money(cost), "bad"); return; }
    document.body.classList.add("hm-veil");
    setTimeout(function () {
      FC.player.teleport(d.x, d.z, d.h);
      FC.setHour(FC.clock.hour + 1);
      document.body.classList.remove("hm-veil");
      toast("🚕 Приехали: " + addrOf(p), "ok");
    }, 700);
  }
  FC.css("body.hm-veil #cv{filter:brightness(0);transition:filter .5s}");

  /* ---- карта: свои — цветом (дом зелёным, нежилое фиолетовым), чужие — серым, продающиеся — рамкой -------------- */
  function shape(c, B, x, z, s) {
    if (B && B.poly && CITY === "minsk") {
      c.beginPath(); B.poly.forEach(function (q, i) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.closePath();
    } else if (B) { c.beginPath(); c.rect(B.x - B.w / 2, B.z - B.d / 2, B.w, B.d); }
    else { c.beginPath(); c.rect(x - s / 2, z - s / 2, s, s); }
  }
  function bizEmoji(t) { return (FC.biz && FC.biz.TYPES && FC.biz.TYPES[t] && FC.biz.TYPES[t].emoji) || "🏪"; }
  function saleLayer(c, k) {
    c.lineWidth = 2 / k; c.strokeStyle = P.sale === "com" ? "rgba(227,184,255,.9)" : "rgba(255,207,122,.85)";
    if (CITY !== "minsk") {
      M.buildings.forEach(function (B) { var cl = classOf(B); if (cl && cl.cls === P.sale && !takenOf(B)) c.strokeRect(B.x - B.w / 2, B.z - B.d / 2, B.w, B.d); });
      return;
    }
    if (!FC.osm || !FC.player) return;
    var want = P.sale === "com" ? COM_OSM : { res: 1, house: 1 };
    FC.osm.near(FC.player.x, FC.player.z, 900).forEach(function (it) {
      if (!want[it.kind] || !it.p) return;
      var pb = it.pi >= 0 ? M.buildings[it.pi] : null;          // важные дома: зоны и точки города — не продаются
      if (pb && (pb.poi || pb.zone || pb.type === "hq")) return;
      if (P.taken[keyOfPoly(it.p)]) return;
      c.beginPath(); it.p.forEach(function (q, i) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.closePath(); c.stroke();
    });
  }
  function mapLayer(c, k, mode) {
    var big = mode === "big";
    if (big && P.sale) saleLayer(c, k);
    var fs = Math.max(10, 18 / k);
    c.textAlign = "center"; c.textBaseline = "middle";
    if (big) {
      c.fillStyle = "rgba(120,128,140,.8)";
      P.list.forEach(function (t) {
        if (mineKey(t.k)) return;
        var B = CITY === "minsk" ? null : M.buildings[+t.k], x = B ? B.x : t.x, z = B ? B.z : t.z;
        if (x == null) return;
        shape(c, B, x, z, 16); c.fill();
        if (t.biz) { c.font = (fs * 0.8) + "px system-ui"; c.fillText(bizEmoji(t.biz), x, z); }
      });
    }
    P.mine.forEach(function (p) {
      var B = resolve(p), x = B ? B.x : p.x, z = B ? B.z : p.z;
      if (x == null) return;
      c.fillStyle = p.cls === "res" ? "#2fbf71" : "#c86bff";
      shape(c, B, x, z, 18); c.fill();
      c.font = fs + "px system-ui";
      c.fillText(p.biz ? bizEmoji(p.biz.type) : p.cls === "res" ? "🏠" : "🏢", x, z);
    });
    if (big && P.sel) {
      var S = P.taken[P.sel] || mineKey(P.sel), SB = S ? resolve(S) : (CITY === "minsk" ? P.rec[P.sel] : M.buildings[+P.sel]);
      if (SB) { c.strokeStyle = "#c86bff"; c.lineWidth = 4 / k; shape(c, SB, SB.x, SB.z, 18); c.stroke(); }
    }
  }
  function mineKey(k) { for (var i = 0; i < P.mine.length; i++) if (P.mine[i].key === k) return P.mine[i]; return null; }

  /* ---- у двери: купить / моё / занято (дома и нежилые) ---------------------------------------------------------- */
  function doorPoint(B) {
    var d = B.doors[0], sx = -d.nz, sz = d.nx;                  // вбок вдоль фасада, чтобы не спорить с «Войти»
    return { x: d.x + sx * 2.6, z: d.z + sz * 2.6 };
  }
  function creatureName(code) { var W = global.FC_SPECIES; return code && W && W.META[code] ? W.META[code][0] : ""; }
  function provider(px, pz, room) {
    if (room != null || !FC.player || FC.player.mode !== "foot") return null;
    var out = [];
    M.near(px, pz, 8).forEach(function (B) {
      var c = classOf(B); if (!c || !c.cls) return;
      var pt = doorPoint(B), my = mineOf(B), tk = my ? null : takenOf(B), who = tk ? (creatureName(tk.cre) || "чей-то агент") : "";
      var it = { id: "prop" + keyOf(B), x: pt.x, z: pt.z, r: 1.7, key: "use" };
      if (c.cls === "res") {
        it.label = my ? "🏠 Мой дом — гараж, мебель" : tk ? "Занято — " + who : "🔑 " + kindName(B, "res") + " за " + money(priceOf(B, "res"));
        it.act = function () {
          if (my) { if (FC.home && FC.home.open) FC.home.open("mine"); else open("mine"); }
          else if (tk) toast("Этот дом уже чей-то — он закреплён за владельцем", "");
          else { P.sel = keyOf(B); P.filt = "res"; P.rec[keyOf(B)] = B; open("buy"); }
        };
      } else if (my) {
        it.label = my.biz && FC.biz ? FC.biz.doorLabel(my) : "🏢 Моё здание — открыть бизнес";
        it.act = function () { if (FC.biz) FC.biz.atDoor(my, B); else open("mine"); };
      } else if (tk) {
        it.label = tk.biz ? bizEmoji(tk.biz) + " " + (tk.name || "Бизнес") + " · владелец — " + who : "Здание занято — " + who;
        it.act = function () { toast(tk.biz ? "Это бизнес другого игрока — заходи в гости" : "Здание закреплено за владельцем", ""); };
      } else {
        it.label = "🔑 " + kindName(B, "com") + " под бизнес за " + money(priceOf(B, "com"));
        it.act = function () { P.sel = keyOf(B); P.filt = "com"; P.rec[keyOf(B)] = B; open("buy"); };
      }
      out.push(it);
    });
    return out;
  }

  /* ---- вкладки «Недвижимости»: «Мои» и «Купить» (оболочку, «Мебель» и «Гараж» держит fhome.js) ------------------- */
  function candidates(cls) {
    var Pl = FC.player, out = [], i;
    if (CITY !== "minsk") {
      out = M.buildings.filter(function (B) { var c = classOf(B); return c && c.cls === cls && !takenOf(B); });
    } else if (FC.osm) {
      // сначала дёшево по контурам кусков (вид, площадь, расстояние), записи зданий — только для ближайших
      var want = cls === "com" ? COM_OSM : { res: 1, house: 1 }, items = [];
      FC.osm.near(Pl.x, Pl.z, 450).forEach(function (it) {
        if (!(want[it.kind] || (cls === "com" && it.kind === "garage")) || !it.p) return;
        var cx = (it.x0 + it.x1) / 2, cz = (it.z0 + it.z1) / 2;
        items.push([FC.dist2(cx, cz, Pl.x, Pl.z), it]);
      });
      items.sort(function (a, b) { return a[0] - b[0]; });
      for (i = 0; i < items.length && out.length < 24; i++) {
        var B = M.recordOf(items[i][1]), c = classOf(B);
        if (B && c && c.cls === cls && !takenOf(B) && out.indexOf(B) < 0) out.push(B);
      }
    }
    out.sort(function (a, b) { return FC.dist2(a.x, a.z, Pl.x, Pl.z) - FC.dist2(b.x, b.z, Pl.x, Pl.z); });
    out = out.slice(0, 12);
    var sel = P.sel != null && (CITY === "minsk" ? P.rec[P.sel] : M.buildings[+P.sel]);
    if (sel && (classOf(sel) || {}).cls === cls && !takenOf(sel)) out = [sel].concat(out.filter(function (x) { return x !== sel; })).slice(0, 12);
    return out;
  }
  function cardOf(p, other) {
    var B = other ? null : resolve(p), x = B ? B.x : p.x, z = B ? B.z : p.z;
    var dist = !other && x != null ? distName(x, z) : (p.city === "minsk" ? "Минск" : "Флейм-Сити");
    var icon = p.biz ? bizEmoji(p.biz.type) : p.cls === "res" ? (p.kind === "home" ? "🏠" : "🔑") : "🏢";
    var title = p.biz ? esc(p.biz.name) + "<span class='pr-badge biz'>ур. " + p.biz.level + "</span>" : (p.cls === "res" ? kindName(B, "res") : kindName(B, "com"));
    var h = "<div class='card'><b>" + icon + " " + title + (p.kind === "home" ? "<span class='pr-badge ok'>главный</span>" : "") + (p.landmark ? "<span class='pr-badge'>⭐ ориентир</span>" : "") + "</b>" +
      "<p class='pr-meta'>" + esc(addrOf(p)) + " · " + esc(dist) + (p.floors ? " · " + p.floors + " эт." : "") + " · куплено за " + money(p.price) + "</p>";
    if (other) return h + "</div>";
    h += "<div class='hm-row'><button type='button' data-pr-show='" + esc(p.key) + "'>На карте</button>" +
      "<button type='button' class='ghost' data-pr-taxi='" + esc(p.key) + "'>🚕 Такси · $150</button>";
    if (p.cls === "res" && p.kind !== "home") h += "<button type='button' class='ghost' data-pr-main='" + esc(p.key) + "'>Сделать главным</button>";
    if (p.cls === "com") h += "<button type='button' data-pr-biz='" + esc(p.key) + "'>" + (p.biz ? "💼 Бизнес" : "💼 Открыть бизнес") + "</button>";
    h += "<button type='button' class='danger' data-pr-sell='" + esc(p.key) + "'>Продать · от " + money(Math.round(p.price * 0.7)) + "</button></div></div>";
    return h;
  }
  function renderTab(tab, el, ctl) {
    var html = "";
    if (!P.ok) html += "<div class='card'><b>Сервер недвижимости недоступен</b><p>Покупка и продажа — когда связь вернётся. Свои здания видны по сохранению.</p></div>";
    if (tab === "mine") {
      var nr = mine("res").length, nc = mine("com").length, others = P.all.filter(function (p) { return p.city !== CITY; });
      html += "<div class='pr-sum'><div><b>" + nr + "/" + LIMIT.res + "</b>домов</div><div><b>" + nc + "/" + LIMIT.com + "</b>нежилых</div><div><b>" + (FC.city === "minsk" ? "Минск" : "Флейм") + "</b>город</div></div>";
      if (!token()) html += "<div class='card'><b>Здание закрепляется за агентом</b><p>Войди своим агентом — и купленное никто не займёт.</p><div class='hm-row'><button type='button' data-pr-login='1'>Войти</button></div></div>";
      if (!P.mine.length) html += "<div class='card'><b>Пока своего нет</b><p>Дом — точка сохранения, мебель и гараж; нежилое здание — под бизнес с сотрудниками-агентами. Выбирай на карте или во вкладке «Купить».</p></div>";
      P.mine.forEach(function (p) { html += cardOf(p, false); });
      if (others.length) { html += "<h4>В другом городе</h4>"; others.forEach(function (p) { html += cardOf(p, true); }); }
      html += "<div class='row'><span>Появляться дома при входе</span><button type='button' data-pr-spawn='1'>" + (FC.save.flags.homeSpawn === false ? "выкл" : "вкл") + "</button></div>";
    } else {
      var Pl = FC.player, list = candidates(P.filt);
      html += "<div class='pr-chips'><button type='button' data-pr-filt='res' class='" + (P.filt === "res" ? "on" : "") + "'>🏠 Дома</button><button type='button' data-pr-filt='com' class='" + (P.filt === "com" ? "on" : "") + "'>🏢 Под бизнес</button></div>";
      html += "<div class='row'><span>Продающиеся на большой карте</span><button type='button' data-pr-sale='1'>" + (P.sale === P.filt ? "показаны" : "показать") + "</button></div>";
      if (!list.length) html += "<div class='card'><p>Рядом свободного нет — пройдись или открой большую карту.</p></div>";
      list.forEach(function (B) {
        var p = priceOf(B, P.filt), d = Math.round(Math.hypot(B.x - Pl.x, B.z - Pl.z)), k = keyOf(B), f = factsOf(B);
        P.rec[k] = B;
        var full = mine(P.filt).length >= LIMIT[P.filt];
        html += "<div class='card'" + (k === P.sel ? " style='outline:2px solid #c86bff'" : "") + "><b>" + (P.filt === "res" ? "🏠 " : "🏢 ") + kindName(B, P.filt) +
          (f.landmark ? "<span class='pr-badge'>⭐ ориентир</span>" : "") + "</b><p class='pr-meta'>" + esc(B.addr || B.name) + " · " + esc(distName(B.x, B.z)) + " · " + B.floors + " эт. · " + f.area + " м² · " + d + " м от тебя</p>" +
          "<div class='hm-row'><button type='button' data-pr-buy='" + esc(k) + "'" + (FC.save.money < p || full ? " disabled" : "") + ">Купить · " + money(p) + "</button><button type='button' class='ghost' data-pr-route='" + esc(k) + "'>Маршрут</button></div></div>";
      });
      html += "<p class='quiet'>Цена — от района, площади, этажности и стиля; ориентиры (именные и высотные) дороже, нежилые — на 20%. Госучреждения, храмы, школы, больницы и мемориалы не продаются. " +
        "Купленное закрепляется за твоим агентом: другие видят его занятым, пока ты не продашь (возврат 70%). Лимит — " + LIMIT.res + " дома и " + LIMIT.com + " нежилых в каждом городе.</p>";
    }
    el.innerHTML = html;
    function on(sel, fn) { el.querySelectorAll(sel).forEach(function (x) { x.addEventListener("click", function () { fn(x); }); }); }
    function byKey(k) { return mineKey(k) || P.all.filter(function (p) { return p.key === k; })[0]; }
    on("[data-pr-login]", function () { ctl.close(); loginCard(); });
    on("[data-pr-show]", function (x) { var p = byKey(x.dataset.prShow); if (p && route(p)) { ctl.close(); toast("Маршрут проложен", "ok"); } });
    on("[data-pr-taxi]", function (x) { var p = byKey(x.dataset.prTaxi); ctl.close(); if (p) taxi(p); });
    on("[data-pr-main]", function (x) { var p = byKey(x.dataset.prMain); if (p) { primary(p); ctl.refresh(); } });
    on("[data-pr-biz]", function (x) { var p = byKey(x.dataset.prBiz); if (p && FC.biz) FC.biz.open(p); });
    on("[data-pr-sell]", function (x) { var p = byKey(x.dataset.prSell); if (p) sell(p).then(function (ok) { if (ok) ctl.refresh(); }); });
    on("[data-pr-spawn]", function () { FC.save.flags.homeSpawn = FC.save.flags.homeSpawn === false; FC.dirty(); ctl.refresh(); });
    on("[data-pr-filt]", function (x) { P.filt = x.dataset.prFilt; ctl.refresh(); });
    on("[data-pr-sale]", function () { P.sale = P.sale === P.filt ? null : P.filt; ctl.refresh(); if (P.sale) { ctl.close(); FC.hud.openMap(); } });
    on("[data-pr-buy]", function (x) { var B = P.rec[x.dataset.prBuy]; if (B) { x.disabled = true; buy(B).then(function () { ctl.refresh(); }); } });
    on("[data-pr-route]", function (x) {
      var B = P.rec[x.dataset.prRoute]; if (!B) return;
      P.sel = x.dataset.prRoute; var d = B.doors[0];
      FC.markers.add({ id: "wp", x: d.x + d.nx * 3, z: d.z + d.nz * 3, color: "#c86bff", icon: P.filt === "res" ? "🏠" : "🏢", route: true, ring: 2 });
      ctl.close(); toast("Маршрут к зданию проложен", "ok");
    });
  }
  function open(tab, opt) {
    if (opt && opt.filt) P.filt = opt.filt;
    if (FC.home && FC.home.open) FC.home.open(tab); else if (FC.hud) FC.hud.openPhone("realty");
  }

  /* ---- жизнь модуля ------------------------------------------------------------------------------------------- */
  FC.on("me", function () { P.rec = {}; refresh(); });
  var pollT = 60;
  FC.addSystem({
    name: "prop", order: 57,
    init: function () { if (FC.interact) FC.interact.provider(provider); },
    update: function (dt) {
      pollT -= dt;
      if (pollT <= 0) { pollT = 60; refreshTaken(); }
    }
  });
  if (FC.hud) FC.hud.addMapLayer(mapLayer);

  FC.prop = {
    CITY: CITY, LIMIT: LIMIT, HTTP: HTTP, keyOf: keyOf, classOf: classOf, priceOf: priceOf, factsOf: factsOf, kindName: kindName,
    landmarkOf: landmarkOf, tierOf: tierOf, mine: mine, all: function () { return P.all.slice(); }, home: homeOf,
    taken: function () { return P.taken; }, takenList: function () { return P.list; }, takenOf: takenOf, mineOf: mineOf,
    resolve: resolve, door: door, addrOf: addrOf, buy: buy, sell: sell, primary: primary, route: route, taxi: taxi, open: open,
    renderTab: renderTab, refresh: refresh, refreshMine: refreshMine, refreshTaken: refreshTaken, post: post, token: token,
    loginCard: loginCard, loaded: function () { return P.loaded; }, ok: function () { return P.ok; }, select: function (k, filt) { P.sel = k; if (filt) P.filt = filt; },
    _state: P
  };
})(window);
