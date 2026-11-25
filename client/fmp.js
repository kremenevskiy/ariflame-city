/* Флейм-Сити — онлайн: другие игроки через игровой сервер fcg (server, своя SQLite, Postgres не трогает).
 *
 * Сокет FC.gsWs() — <сервер>/g/ws (config.js; ?mp=ws://localhost:8091/g/ws — локально, ?mp=off — без онлайна). Сервер недоступен —
 * игра молча одиночная, переподключение с паузой 2→30 с. Код 4000 — игрок открыл вторую вкладку: эта больше не лезет.
 * Своё состояние — до 10 раз в секунду (стоя — раз в секунду, чтобы сервер не счёл соединение мёртвым).
 * Чужие игроки — существа kind "remote" (FC.people), позиции с задержкой 120 мс и интерполяцией; в машине — модель
 * FC.cars.visual(тип, цвет), если она есть. Бить других нельзя, столкнуться машинами — только у себя (толчок).
 * Над головой — табличка «🌐 ник» (свой ник игрока — fnick.js / server/nicks.py; нет — ник из «Рейтинга», вид существа
 * или «Гость»). Эмоции — только из готового списка сервера. Свой ник уходит в hi (копия с устройства) и кадром «nick».
 * Сохранение вошедшего (есть FC.net.token): при старте /g/load (берём, где больше stats.playMin), дальше /g/save
 * раз в 30 с — прогресс переживает смену устройства.
 *
 * Воздух (fair.js, 22.11 v2): m 3 — за штурвалом (c — тип аппарата), m 4 — под парашютом; чужие — FC.air.visual(тип)
 * на высоте p[1] с интерполяцией. Кто онлайн по всей карте, друзья (взаимно, сервер хранит по rid), «где он» — запросы
 * по сокету с номером q: FC.mp.online() / friends() / locate(id) → Promise; наружу только номер соединения и вид.
 * FC.mp: {online, connected, id, remotes, emo(k), EMO, modes, send(obj), online(), friends(), locate(id),
 *   addFriend(id), acceptFriend(id), declineFriend(id), removeFriend(fid)}  (online — и число, и функция: см. ниже)
 * Режимы (fmodes.js, 22.11 v2): кадры race/room/coop уходят через MP.send, ответы сервера — событиями шины
 * «mp:race», «mp:room», «mp:coop»; сервер с режимами пишет в welcome modes: 1. Сохранение, которое сервер счёл
 * нечестным (прирост денег быстрее возможного), он не принимает и отдаёт последнее честное — его и берём.
 */
(function (global) {
  "use strict";
  var FC = global.FC;
  var OFF = FC.gsOff(), URL_WS = FC.gsWs(), HTTP = FC.gs();
  var DELAY = 120, SEND_MS = 100, KEEP_MS = 1000, SAVE_MS = 30000;

  var MP = { count: 0, connected: false, id: null, modes: false, remotes: {}, EMO: ["👋 Привет", "🚗 Погнали", "🔥", "😂", "🤝", "Догони!", "Помоги!"] };
  var ws = null, retry = 2000, stop = false, lastSend = 0, lastSig = "", lastSave = 0;

  FC.css([
    ".mp-online{position:fixed;right:14px;top:calc(98px + env(safe-area-inset-top));font:700 12px system-ui;color:#cfe3ff;",
    "background:rgba(12,16,32,.6);border:1px solid rgba(107,213,255,.35);border-radius:10px;padding:2px 8px;pointer-events:none;",
    "opacity:0;transition:opacity .3s;text-shadow:0 1px 3px #000}.mp-online.on{opacity:1}",
    "#mp-tags{position:fixed;inset:0;pointer-events:none;overflow:hidden}",
    ".mp-tag{position:absolute;left:0;top:0;font:700 11px system-ui;color:#fff;background:rgba(31,111,235,.78);",
    "border-radius:9px;padding:1px 7px;white-space:nowrap;will-change:transform;text-shadow:0 1px 2px rgba(0,0,0,.5)}",
    ".mp-tag.g{background:rgba(90,98,120,.75)}",
    ".say.mp{background:#e3f0ff;color:#0b2a5a}.say.mp:after{border-top-color:#e3f0ff}",
    ".mp-emo{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}",
    ".mp-who{display:flex;align-items:center;gap:8px}.mp-who .fc{width:34px;height:34px;border-radius:8px;flex:none}"
  ].join(""));
  var badge = document.createElement("div"); badge.className = "mp-online";
  var tags = document.createElement("div"); tags.id = "mp-tags";
  // Таблички — под интерфейсом (перед #hud), плашка — внутри #hud: телефон и карта (z-index там же) их перекрывают.
  function mount() {
    if (badge.parentNode) return;
    var hud = document.getElementById("hud");
    if (hud) { document.body.insertBefore(tags, hud); hud.appendChild(badge); }
    else { document.body.appendChild(tags); document.body.appendChild(badge); }
  }

  /* ---- чужие игроки --------------------------------------------------------------------------------------- */
  function creatureName(code) {
    var W = global.FC_SPECIES, m = W && code && W.META[code];
    return m ? m[0] : "";
  }
  // Вид игрока сервер присылает один раз за соединение — держим его, пока игрок не вышел совсем (leave), даже если он
  // ушёл из радиуса (x) или мы сами убрали его за паузу кадров: иначе вернувшийся был бы «Игроком» без вида.
  var metas = {};
  function remoteOf(id) {
    var r = MP.remotes[id];
    if (r) return r;
    r = MP.remotes[id] = { id: id, meta: metas[id] || null, buf: [], ch: null, car: null, carKey: "", tag: null, seen: 0 };
    return r;
  }
  // табличка: «🌐 [ТЕГ] ник · ⭐ уровень» (свой ник — name, nicks.py; ник из рейтинга и уровень — progress.py, тег клана —
  // crews.py); у гостя без ника — вид существа или «Гость»
  function tagText(m) {
    if (!m) return "🌐 Игрок";
    var name = m.name || m.pn || creatureName(m.creature) || m.nick || "Игрок";
    return "🌐 " + (m.tag ? "[" + m.tag + "] " : "") + name + (m.lvl ? " · ⭐" + m.lvl : "");
  }
  function setMeta(m) {
    metas[m.id] = m;
    var r = remoteOf(m.id);
    r.meta = m;
    if (r.ch) r.ch.cell = cellFor(m.creature);
    if (r.tag) { r.tag.textContent = tagText(m); r.tag.style.borderLeft = m.ccol ? "3px solid " + m.ccol : ""; }
  }
  function cellFor(code) {
    var c = code && FC.people ? FC.people.cellOf(code) : -1;
    return c >= 0 ? c : (FC.people ? FC.people.SPECIAL.civ : 1005);
  }
  function ensureChar(r, s) {
    if (r.ch || !FC.people) return;
    r.ch = FC.people.make("remote", cellFor(r.meta && r.meta.creature), s.x, s.z, { scale: 1.9, alpha: 0, mp: r.id });
    r.tag = document.createElement("div");
    r.tag.className = "mp-tag" + (r.meta && r.meta.guest ? " g" : "");
    r.tag.textContent = tagText(r.meta);
    if (r.meta && r.meta.ccol) r.tag.style.borderLeft = "3px solid " + r.meta.ccol;
    tags.appendChild(r.tag);
  }
  function dropRemote(id) {
    var r = MP.remotes[id]; if (!r) return;
    chute(r, null);
    if (r.ch && FC.people) FC.people.remove(r.ch);
    if (r.car) removeCar(r);
    if (r.tag) r.tag.remove();
    delete MP.remotes[id];
  }
  function removeCar(r) {
    var o = r.car && (r.car.isObject3D ? r.car : r.car.obj);
    if (o && o.parent) o.parent.remove(o);
    if (r.car && typeof r.car.dispose === "function") r.car.dispose();
    r.car = null; r.carKey = "";
  }
  // строка сервера: [id, x, y, z, h, m, c, k, b, a, w]
  function onRow(row, now) {
    var r = remoteOf(row[0]);
    var s = { t: now, x: row[1], y: row[2], z: row[3], h: row[4], m: row[5], c: row[6], k: row[7], b: row[8], a: row[9], w: row[10] };
    r.buf.push(s);
    if (r.buf.length > 12) r.buf.shift();
    r.seen = now;
    ensureChar(r, s);
  }
  function lerpAng(a, b, t) { var d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
  function sample(r, t) {
    var b = r.buf, n = b.length;
    if (!n) return null;
    if (t <= b[0].t) return b[0];
    for (var i = n - 1; i > 0; i--) {
      if (b[i - 1].t <= t) {
        var A = b[i - 1], B = b[i];
        if (t >= B.t) return B;
        var k = (t - A.t) / Math.max(1, B.t - A.t);
        if (Math.hypot(B.x - A.x, B.z - A.z) > 60) return B;      // скачок (вход в здание, респаун) — без «полёта»
        return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, z: A.z + (B.z - A.z) * k, h: lerpAng(A.h, B.h, k),
          m: B.m, c: B.c, k: B.k, b: B.b, a: B.a, w: B.w };
      }
    }
    return b[n - 1];
  }
  function carVisual(r, s) {
    var key = s.c + ":" + s.k;
    if (r.car && r.carKey === key) return r.car;
    if (r.car) removeCar(r);
    if (!(FC.cars && typeof FC.cars.visual === "function")) return null;
    try { r.car = FC.cars.visual(s.c || "sedan", s.k); } catch (e) { r.car = null; }
    var o = r.car && (r.car.isObject3D ? r.car : r.car.obj);
    if (o && !o.parent && FC.gfx) FC.gfx.scene.add(o);
    if (!o) r.car = null;
    r.carKey = key;
    return r.car;
  }
  function airVisual(r, s) {
    var key = "air:" + s.c;
    if (r.car && r.carKey === key) return r.car;
    if (r.car) removeCar(r);
    if (!(FC.air && typeof FC.air.visual === "function")) return null;
    try { r.car = FC.air.visual(s.c); } catch (e) { r.car = null; }
    if (r.car && !r.car.parent && FC.gfx) FC.gfx.scene.add(r.car);
    r.carKey = key;
    return r.car;
  }
  // купол парашюта над чужим игроком — простая полусфера (у fair.js купол только для своего игрока)
  var chuteGeo = null, chuteMat = null;
  function chute(r, s) {
    var T = global.THREE;
    if (!s) { if (r.chute) { r.chute.parent && r.chute.parent.remove(r.chute); r.chute = null; } return; }
    if (!r.chute && T && FC.gfx) {
      chuteGeo = chuteGeo || new T.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      chuteMat = chuteMat || new T.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.7, side: T.DoubleSide });
      r.chute = new T.Mesh(chuteGeo, chuteMat); FC.gfx.scene.add(r.chute);
    }
    if (r.chute) r.chute.position.set(s.x, s.y + 3.2, s.z);
  }
  var tv = null;
  function project(r, x, y, z) {
    var cam = FC.gfx && FC.gfx.camera;
    if (!cam || !global.THREE) return;
    tv = tv || new global.THREE.Vector3();
    tv.set(x, y, z).project(cam);
    var far = FC.dist2(x, z, cam.position.x, cam.position.z) > 70 * 70;
    if (tv.z > 1 || far) { r.tag.style.display = "none"; return; }
    r.tag.style.display = "";
    r.tag.style.transform = "translate(" + ((tv.x + 1) / 2 * global.innerWidth) + "px," + ((1 - tv.y) / 2 * global.innerHeight) + "px) translate(-50%,-100%)";
  }
  function updateRemotes(dt) {
    var now = performance.now(), t = now - DELAY;
    var P = FC.player;
    Object.keys(MP.remotes).forEach(function (id) {
      var r = MP.remotes[id];
      if (now - r.seen > 3000) { dropRemote(id); return; }       // сервер перестал присылать — ушёл из радиуса
      var s = sample(r, t); if (!s || !r.ch) return;
      var ch = r.ch, px = ch.x, pz = ch.z;
      ch.x = s.x; ch.z = s.z; ch.y = s.y;
      ch.vx = (s.x - px) / Math.max(dt, 1e-3); ch.vz = (s.z - pz) / Math.max(dt, 1e-3);
      ch.speed = Math.min(12, Math.hypot(ch.vx, ch.vz));
      ch.room = s.m === 2 && s.b != null ? s.b : null;
      var inCar = s.m === 1 && s.c, inAir = s.m === 3 && s.c;
      var car = inCar ? carVisual(r, s) : inAir ? airVisual(r, s) : null;
      if (!inCar && !inAir && r.car) removeCar(r);
      ch.visible = !car;                                         // в машине и в воздухе видна техника, а не существо
      var o = car && (car.isObject3D ? car : car.obj);
      if (o) {
        o.position.set(s.x, inAir ? s.y : 0, s.z); o.rotation.y = s.h; o.visible = !(FC.inside && FC.inside.active);
        if (inCar) bump(s);
      }
      chute(r, s.m === 4 ? s : null);
      project(r, s.x, (s.y || 0) + (car ? (inAir ? 4 : 2.3) : 2.4), s.z);      // над головой фигурки (рост ~1,9 м)
      if (r.tag && P && FC.inside && FC.inside.active && ch.room == null) r.tag.style.display = "none";
    });
  }
  /* Столкновение с чужой машиной — только у себя: свою машину чуть отталкивает, чужая не реагирует. */
  function bump(s) {
    var P = FC.player, car = P && P.mode === "car" && P.car;
    if (!car || car.x == null) return;
    var dx = car.x - s.x, dz = car.z - s.z, d = Math.hypot(dx, dz);
    if (d > 3.4 || d < 1e-3) return;
    var push = (3.4 - d) / d;
    car.x += dx * push * 0.5; car.z += dz * push * 0.5;
    if (car.vx != null) { car.vx = car.vx * 0.7 + dx / d * 2; car.vz = car.vz * 0.7 + dz / d * 2; }
    if (FC.cam && FC.cam.shake) FC.cam.shake(0.15);
  }

  /* ---- соединение ------------------------------------------------------------------------------------------ */
  function connect() {
    if (OFF || stop || ws || !FC.me) return;
    try { ws = new WebSocket(URL_WS); } catch (e) { ws = null; later(); return; }
    ws.onopen = function () {
      retry = 2000;
      var me = FC.me, hi = { t: "hi", creature: me.creature || undefined, v: 1, city: FC.city || "flame" };
      // район для рейтинга районов — по своему дому (рейтинг пока только Флейм-Сити)
      if (me.home && me.home.dist && FC.city !== "minsk") hi.d = me.home.dist;
      if (FC.net && FC.net.token) hi.token = FC.net.token; else if (/^g-[a-z0-9]{4,16}$/.test(me.rid)) hi.guest = me.rid;
      var nk = FC.nick && FC.nick.forHi();                       // свой ник с устройства — сервер проверит (fnick.js)
      if (nk) hi.nick = nk;
      ws.send(JSON.stringify(hi));
    };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      var now = performance.now();
      if (m.t === "w") {
        (m.meta || []).forEach(setMeta);
        (m.ps || []).forEach(function (row) { onRow(row, now); });
        (m.x || []).forEach(dropRemote);
      } else if (m.t === "meta") setMeta(m);
      else if (m.t === "leave") { dropRemote(m.id); delete metas[m.id]; }
      else if (m.t === "emo") showEmo(m.id, m.k);
      else if (m.t === "online") setOnline(m.n);
      else if (m.t === "race" || m.t === "room" || m.t === "coop" || m.t === "crew" || m.t === "prog" || m.t === "nick") FC.emit("mp:" + m.t, m);
      else if ((m.t === "who" || m.t === "friends" || m.t === "locate") && m.q && pend[m.q]) { pend[m.q](m); delete pend[m.q]; }
      else if (m.t === "friend") onFriend(m);
      else if (m.t === "welcome") {
        MP.id = m.id; MP.connected = true; MP.guest = m.guest; MP.modes = !!m.modes; MP.fid = m.fid || null;
        if (m.emo && m.emo.length) MP.EMO = m.emo;
        setOnline(m.online);
        FC.emit("mp:on", m);
      }
    };
    ws.onclose = function (e) {
      ws = null; MP.connected = false; MP.modes = false; MP.closeCode = e.code;
      FC.emit("mp:off", { code: e.code });
      Object.keys(MP.remotes).forEach(dropRemote);
      metas = {};                                                // новое соединение — сервер пришлёт виды заново
      setOnline(0);
      if (e.code === 4000) {
        stop = true;
        if (FC.hud) FC.hud.toast("Онлайн открыт в другой вкладке", "", 4);
        return;
      }
      later();
    };
    ws.onerror = function () { /* onclose придёт следом */ };
  }
  var hiddenOut = false;
  function later() {
    if (stop || OFF || hiddenOut) return;
    setTimeout(connect, retry);
    retry = Math.min(30000, retry * 2);
  }
  /* Вкладку увели в фон: кадров нет, состояние не уходит — сервер через 30 с счёл бы нас мёртвыми, а мы бы крутили
     переподключения. Уходим из онлайна сами (другие видят, что игрок ушёл) и возвращаемся, как только вкладку открыли. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (ws) { hiddenOut = true; try { ws.close(1000); } catch (e) { /* уже закрыт */ } }
    } else if (hiddenOut) {
      hiddenOut = false; retry = 2000; connect();
    }
  });
  function setOnline(n) {
    MP.count = n || 0;
    mount();
    badge.textContent = "🌐 " + MP.count + " онлайн";
    badge.classList.toggle("on", MP.connected && MP.count > 0);
  }
  function showEmo(id, k) {
    var text = MP.EMO[k]; if (text == null) return;
    if (id === MP.id) { if (FC.player && FC.player.ch && FC.people) FC.people.say(FC.player.ch, text, 3, "me"); return; }
    var r = MP.remotes[id];
    if (r && r.ch && FC.people) FC.people.say(r.ch, text, 3, "mp");
  }
  // Пинг мимо кадров: слабый телефон или долгая компиляция шейдеров дают паузы между кадрами, а сервер через 30 с
  // тишины закрывает сокет. Таймер идёт и тогда, когда кадров нет (скрытую вкладку мы закрываем сами — выше).
  setInterval(function () {
    if (ws && ws.readyState === 1 && MP.connected && !document.hidden) ws.send('{"t":"ping"}');
  }, 10000);
  /* ---- запросы с ответом: кто онлайн, друзья, «где он» -------------------------------------------------------- */
  var pend = {}, qseq = 0, whoCache = null, whoT = 0, friendReq = [], friendSet = {};
  function ask(obj) {
    return new Promise(function (res, rej) {
      if (!MP.send || !(ws && ws.readyState === 1 && MP.connected && MP.modes)) { rej(new Error("offline")); return; }
      var q = obj.q = ++qseq;
      pend[q] = res;
      ws.send(JSON.stringify(obj));
      setTimeout(function () { if (pend[q]) { delete pend[q]; rej(new Error("timeout")); } }, 4000);
    });
  }
  function districtName(x, z) { var d = FC.map && FC.map.district(x, z); return d ? d.name : ""; }
  // Все игроки по карте (сервер огрубляет до 20 м, не чаще раза в 3 с — держим кэш): для большой карты и «Онлайн».
  MP.online = function () {
    var now = performance.now();
    if (whoCache && now - whoT < 3000) return Promise.resolve(whoCache);
    return ask({ t: "who" }).then(function (m) {
      if (!m.ps) return whoCache || [];
      var P = FC.player;
      // игроки другого города — не на этой карте (их координаты — чужого плана); creatureName — имя для показа
      // (карта, список): свой ник игрока или ник из «Рейтинга» (name), иначе вид существа, «Гость» или «Агент»
      whoCache = m.ps.filter(function (p) { return !p.me && (p.city || "flame") === (FC.city || "flame"); }).map(function (p) {
        return { id: p.id, creature: p.creature, creatureName: p.name || creatureName(p.creature) || (p.guest ? "Гость" : "Агент"), name: p.name || null, guest: p.guest,
          district: districtName(p.x, p.z), x: p.x, z: p.z, m: p.m, friend: !!p.friend, d: P ? Math.round(Math.hypot(p.x - P.x, p.z - P.z)) : 0,
          fid: p.fid || null, lvl: p.lvl || null, tag: p.tag || null };
      }).sort(function (a, b) { return (b.friend - a.friend) || a.d - b.d; });
      whoCache.forEach(function (p) { if (p.friend) friendSet[p.id] = 1; });
      whoT = now;
      return whoCache;
    });
  };
  MP.friends = function () {
    return ask({ t: "friends" }).then(function (m) {
      friendReq = (m.req || []).filter(function (r) { return r.id != null; });
      (m.ps || []).forEach(function (f) { if (f.id != null) friendSet[f.id] = 1; });
      return (m.ps || []).map(function (f) {
        return { fid: f.fid, id: f.id, creature: f.creature, creatureName: f.name || creatureName(f.creature) || "Агент", online: f.online, seenH: f.seen };
      }).sort(function (a, b) { return b.online - a.online; });
    });
  };
  MP.locate = function (id) {
    return ask({ t: "locate", id: +id }).then(function (m) {
      if (!m.ok) return m.city && m.city !== FC.city ? { city: m.city } : null;
      var inside = m.inside != null && FC.map && FC.map.buildings[m.inside];
      if (inside && inside.doors && inside.doors[0]) {                          // друг в здании — к его двери на улице
        var d = inside.doors[0];
        return { x: d.x + d.nx * 2 - 2, z: d.z + d.nz * 2 - 2, inside: m.inside, y: 0, m: m.m };
      }
      return { x: m.x, z: m.z, y: m.y, inside: null, m: m.m };
    });
  };
  function friendCmd(a, extra) { if (MP.send) MP.send(Object.assign({ t: "friend", a: a }, extra)); }
  MP.addFriend = function (id) { friendCmd("add", { id: +id }); };
  MP.acceptFriend = function (id, fid) { friendCmd("accept", id != null ? { id: +id } : { fid: fid }); friendReq = friendReq.filter(function (r) { return r.id !== +id; }); };
  MP.declineFriend = function (id, fid) { friendCmd("decline", id != null ? { id: +id } : { fid: fid }); friendReq = friendReq.filter(function (r) { return r.id !== +id; }); };
  MP.removeFriend = function (fid) { friendCmd("remove", { fid: fid }); };
  MP.isFriend = function (id) { return !!friendSet[id]; };
  MP.teleportTo = function (id) {
    return MP.locate(id).then(function (p) {
      if (!p) { if (FC.hud) FC.hud.toast("Игрок уже не в сети", "bad", 2); return false; }
      return FC.hud && FC.hud.teleport ? FC.hud.teleport(p.x + 2, p.z + 2, false) : false;
    });
  };
  var reqEl = null;
  function onFriend(m) {
    if (!FC.hud) return;
    if (m.e === "req") {
      friendReq = friendReq.filter(function (r) { return r.id !== m.id; }).concat([{ id: m.id, fid: m.fid, creature: m.creature, name: m.name }]);
      if (reqEl) reqEl.remove();
      reqEl = document.createElement("div"); reqEl.className = "fm-inv ui mp-req";
      reqEl.innerHTML = "<b>🤝 " + FC.hud.esc(m.name || creatureName(m.creature) || "Агент") + " хочет дружить</b><p>Друзья видят друг друга на карте и могут переместиться друг к другу.</p>" +
        "<button type='button' class='y'>Дружить</button><button type='button' class='n'>Нет</button>";
      document.body.appendChild(reqEl);
      var el = reqEl;
      el.querySelector(".y").addEventListener("click", function () { MP.acceptFriend(m.id); el.remove(); });
      el.querySelector(".n").addEventListener("click", function () { MP.declineFriend(m.id); el.remove(); });
      setTimeout(function () { el.remove(); }, 25000);
      if (FC.audio) FC.audio.play("note");
    } else if (m.e === "added") {
      if (m.id != null) friendSet[m.id] = 1;
      whoCache = null;
      FC.hud.toast("🤝 Теперь вы друзья" + (m.name || m.creature ? ": " + (m.name || creatureName(m.creature) || "Агент") : ""), "ok", 3);
    } else if (m.e === "sent") FC.hud.toast("🤝 Запрос в друзья отправлен", "", 2.5);
    else if (m.e === "removed") { whoCache = null; FC.hud.toast("Удалено из друзей", "", 2); }
    else if (m.e === "err") FC.hud.toast(m.why || "Не получилось", "bad", 3);
  }
  MP.send = function (obj) {
    if (!(ws && ws.readyState === 1 && MP.connected)) return false;
    ws.send(JSON.stringify(obj));
    return true;
  };
  MP.emo = function (k) {
    if (ws && ws.readyState === 1 && MP.connected) ws.send(JSON.stringify({ t: "emo", k: k }));
  };

  /* ---- своё состояние -------------------------------------------------------------------------------------- */
  function colorInt(c) {
    if (typeof c === "number") return c & 0xffffff;
    if (typeof c === "string" && /^#?[0-9a-f]{6}$/i.test(c)) return parseInt(c.replace("#", ""), 16);
    if (c && typeof c.getHex === "function") return c.getHex();
    return 0;
  }
  function carType(car) {
    var t = car.type || (car.spec && (car.spec.type || car.spec.id || car.spec.key)) || "sedan";
    t = String(t).toLowerCase();
    return /^[a-z0-9_]{1,12}$/.test(t) ? t : "sedan";
  }
  function sendState(now) {
    var P = FC.player;
    if (!P || !ws || ws.readyState !== 1 || !MP.connected) return;
    if (now - lastSend < SEND_MS) return;
    var inside = FC.inside && FC.inside.active && FC.inside.building;
    var m = inside ? 2 : P.mode === "car" ? 1 : P.mode === "air" ? 3 : P.mode === "chute" ? 4 : 0;
    var car = m === 1 && P.car;
    var sp = Math.hypot(P.vx || 0, P.vz || 0);
    var msg = { t: "s", p: [+P.x.toFixed(2), +(P.y || 0).toFixed(2), +P.z.toFixed(2), +(P.heading || 0).toFixed(2)], m: m,
      a: P.onGround === false ? 3 : sp > 4.5 ? 2 : sp > 0.3 ? 1 : 0, w: FC.police && FC.police.stars ? FC.police.stars | 0 : 0 };
    if (car) { msg.c = carType(car); msg.k = colorInt(car.color); }
    if (m === 3 && P.air && /^[a-z0-9_]{1,12}$/.test(P.air.type || "")) msg.c = P.air.type;
    if (inside) msg.b = typeof inside.id === "number" ? inside.id : 500000 + FC.hash(String(inside.id)) % 499999;   // дом Минска «o…» → число
    var sig = JSON.stringify(msg);
    if (sig === lastSig && now - lastSend < KEEP_MS) return;
    lastSig = sig; lastSend = now;
    ws.send(sig);
  }

  /* ---- сохранение на сервере (для вошедших) ------------------------------------------------------------------ */
  function post(path, body) {
    return FC.gfetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? r.json() : null; });
  }
  function loadServer() {
    var tok = FC.net && FC.net.token;
    if (OFF || !tok) return;
    post("/g/load", { token: tok }).then(function (d) {
      var srv = d && d.save;
      if (!srv || typeof srv !== "object" || srv.v !== FC.save.v) return;
      var mine = (FC.save.stats && FC.save.stats.playMin) || 0, theirs = (srv.stats && srv.stats.playMin) || 0;
      if (theirs <= mine + 0.5) return;
      // своё сохранение на этом устройстве младше — берём серверное, не трогая позицию (игрок уже в городе)
      var keep = FC.save.pos;
      Object.keys(FC.save).forEach(function (k) { delete FC.save[k]; });
      Object.assign(FC.save, srv, { pos: keep });
      FC.saveNow();
      FC.emit("save:load", FC.save);
      if (FC.hud) FC.hud.toast("☁️ Прогресс подтянут с сервера", "ok", 3);
    }).catch(function () { /* сервер недоступен — играем с локальным */ });
  }
  function saveServer(now) {
    var tok = FC.net && FC.net.token;
    if (OFF || !tok || now - lastSave < SAVE_MS) return;
    lastSave = now;
    post("/g/save", { token: tok, save: FC.save, creature: FC.me && FC.me.creature }).then(function (d) {
      if (!d || d.ok !== false) return;
      // сервер не принял: прирост денег быстрее возможного — берём его последнее честное сохранение (позицию не трогаем)
      if (d.rolled && d.save && typeof d.save === "object" && d.save.v === FC.save.v) {
        var keep = FC.save.pos;
        Object.keys(FC.save).forEach(function (k) { delete FC.save[k]; });
        Object.assign(FC.save, d.save, { pos: keep });
        FC.saveNow();
        FC.emit("save:load", FC.save);
        if (FC.hud) FC.hud.toast("⚠️ Сервер вернул последнее честное сохранение", "bad", 4);
      } else if (FC.hud && !MP.warned) { MP.warned = true; FC.hud.toast("⚠️ Прогресс не принят сервером онлайна", "bad", 4); }
    }).catch(function () { /* в следующий раз */ });
  }
  global.addEventListener("pagehide", function () {
    var tok = FC.net && FC.net.token;
    if (OFF || !tok || !global.navigator.sendBeacon) return;
    try {
      // text/plain — без preflight CORS (маяк его не умеет); сервер читает тело как JSON сам
      var body = JSON.stringify({ token: tok, save: FC.save, creature: FC.me && FC.me.creature });
      global.navigator.sendBeacon(HTTP + "/g/save", new Blob([body], { type: "text/plain;charset=UTF-8" }));
    } catch (e) { /* без маяка — сохранится локально */ }
  });

  /* ---- телефон: «Онлайн» — сколько в городе, кто рядом, эмоции, топ ------------------------------------------- */
  function district(x, z) { var d = FC.map && FC.map.district(x, z); return d ? d.name : ""; }
  function renderApp(b, ctx) {
    var esc = FC.hud.esc, P = FC.player;
    var near = Object.keys(MP.remotes).map(function (id) { return MP.remotes[id]; }).filter(function (r) { return r.ch && r.buf.length; })
      .map(function (r) { var s = r.buf[r.buf.length - 1]; return { r: r, s: s, d: P ? Math.hypot(s.x - P.x, s.z - P.z) : 0 }; })
      .sort(function (a, c) { return a.d - c.d; }).slice(0, 12);
    var html = "<div class='list'>";
    if (OFF) html += "<div class='card'><b>Онлайн выключен</b><p>Адрес страницы с ?mp=off.</p></div>";
    else if (!MP.connected) html += "<div class='card'><b>Нет связи с сервером онлайна</b><p>Играешь один — подключимся сами, как только сервер ответит.</p></div>";
    else {
      var nm = FC.nick && FC.nick.name();
      html += "<div class='card'><b>🌐 В городе сейчас: " + MP.count + "</b><p>" +
        (nm ? "Тебя видят как «" + esc(nm) + "». " : MP.guest ? "Ты гость: тебя видят как «Гость». " : "Тебя видят под ником из «Рейтинга». ") +
        (MP.guest ? FC.net.loginHint() : "Прогресс сохраняется на сервере.") + "</p>" +
        (FC.nick ? "<button type='button' data-nick='1' style='margin-top:6px'>" + (nm ? "Сменить ник" : "Назвать себя") + "</button>" : "") + "</div>";
      html += "<div class='card'><b>Эмоции</b><div class='mp-emo'>" + MP.EMO.map(function (e, i) {
        return "<button type='button' data-emo='" + i + "'>" + esc(e) + "</button>";
      }).join("") + "</div></div>";
      html += "<div class='card'><b>Рядом</b>" + (near.length ? near.map(function (n) {
        var cre = n.r.meta && n.r.meta.creature, cell = cre && FC.people ? FC.people.cellOf(cre) : -1;
        var mt = n.r.meta || {};
        return "<div class='mp-who' style='margin-top:6px'>" + (cell >= 0 ? "<span class='fc' style='" + FC.hud.atlasStyle(cell) + "'></span>" : "<span>🥚</span>") +
          "<span>" + esc(tagText(mt).slice(3)) + " · " + esc(district(n.s.x, n.s.z)) + " · " + Math.round(n.d) + " м" +
          (n.s.m === 1 ? " · 🚗" : n.s.m === 2 ? " · в здании" : "") + (n.s.w ? " · " + "★".repeat(n.s.w) : "") + "</span>" +
          (mt.fid && FC.ranks ? " <button type='button' class='ghost' data-prof='" + esc(mt.fid) + "'>👤</button>" : "") + "</div>";
      }).join("") : "<p>Пока никого в радиусе 350 м.</p>") + "</div>";
    }
    if (MP.connected && MP.modes) html += "<div class='card mp-fr'><b>⭐ Друзья</b><p>загружаю…</p></div><div class='card mp-all'><b>🗺️ Все в городе</b><p>загружаю…</p></div>";
    html += "<div class='mp-modes'></div>";
    html += "<div class='card'><b>🏆 Топ по заработку</b><div class='mp-top'><p>загружаю…</p></div></div></div>";
    b.innerHTML = html;
    if (FC.modes && FC.modes.renderOnline) FC.modes.renderOnline(b.querySelector(".mp-modes"), ctx);
    if (MP.connected && MP.modes) renderPeople(b, ctx);
    b.querySelectorAll("[data-emo]").forEach(function (btn) {
      btn.addEventListener("click", function () { MP.emo(+btn.dataset.emo); ctx.close(); });
    });
    b.querySelectorAll("[data-prof]").forEach(function (x) { x.addEventListener("click", function () { FC.ranks.show(x.dataset.prof); }); });
    var nb = b.querySelector("[data-nick]");
    if (nb) nb.addEventListener("click", function () {
      FC.nick.open();
      var off = FC.on("nick", function () { off(); if (document.body.contains(b)) ctx.refresh(); });
    });
    if (!OFF) {
      FC.gfetch("/g/top").then(function (r) { return r.json(); }).then(function (d) {
        var el = b.querySelector(".mp-top"); if (!el) return;
        var top = (d && d.top) || [];
        el.innerHTML = top.length ? top.slice(0, 10).map(function (t, i) {
          return "<p>" + (i + 1) + ". " + esc(t.name || "Агент") + " — " + FC.fmtMoney(t.earned) + "</p>";
        }).join("") : "<p>Пока пусто — стань первым.</p>";
      }).catch(function () { var el = b.querySelector(".mp-top"); if (el) el.innerHTML = "<p>Топ недоступен.</p>"; });
    }
  }
  // друзья и все в городе: «📍 К нему» — перемещение к игроку (FC.hud.teleport: не в розыске и не на задании)
  function renderPeople(b, ctx) {
    var esc = FC.hud.esc;
    function goBtn(id) { return "<button type='button' data-to='" + id + "'>📍 К нему</button>"; }
    function bind(el) {
      el.querySelectorAll("[data-to]").forEach(function (x) {
        x.addEventListener("click", function () { MP.teleportTo(+x.dataset.to).then(function (ok) { if (ok) ctx.close(); }); });
      });
      el.querySelectorAll("[data-add]").forEach(function (x) { x.addEventListener("click", function () { MP.addFriend(+x.dataset.add); x.disabled = true; }); });
      el.querySelectorAll("[data-acc]").forEach(function (x) { x.addEventListener("click", function () { MP.acceptFriend(+x.dataset.acc); x.parentNode.remove(); }); });
      el.querySelectorAll("[data-dec]").forEach(function (x) { x.addEventListener("click", function () { MP.declineFriend(+x.dataset.dec); x.parentNode.remove(); }); });
      el.querySelectorAll("[data-prof]").forEach(function (x) { x.addEventListener("click", function () { FC.ranks.show(x.dataset.prof); }); });
      el.querySelectorAll("[data-rm]").forEach(function (x) {
        x.addEventListener("click", function () { if (confirm("Удалить из друзей?")) { MP.removeFriend(x.dataset.rm); x.parentNode.remove(); } });
      });
    }
    var fr = b.querySelector(".mp-fr"), all = b.querySelector(".mp-all");
    MP.friends().then(function (list) {
      if (!fr) return;
      var html = "<b>⭐ Друзья</b>";
      if (MP.guest) html += "<p>Друзья — после входа в аккаунт. " + esc(FC.net.loginHint()) + "</p>";
      html += friendReq.map(function (r) {
        return "<p>🤝 " + esc(r.name || creatureName(r.creature) || "Агент") + " хочет дружить <button type='button' data-acc='" + r.id + "'>Да</button> " +
          "<button type='button' class='ghost' data-dec='" + r.id + "'>Нет</button></p>";
      }).join("");
      html += list.length ? list.map(function (f) {
        return "<p>" + (f.online ? "🟢 " : "⚪ ") + esc(f.creatureName) + (f.online ? " " + goBtn(f.id) : " · " + (f.seenH == null ? "давно" : f.seenH < 24 ? "сегодня" : Math.round(f.seenH / 24) + " дн. назад")) +
          " <button type='button' class='ghost' data-rm='" + esc(f.fid) + "'>✕</button></p>";
      }).join("") : (MP.guest ? "" : "<p>Пока никого. Добавь игрока ниже — дружба взаимная.</p>");
      fr.innerHTML = html; bind(fr);
    }).catch(function () { if (fr) fr.innerHTML = "<b>⭐ Друзья</b><p>Нет ответа сервера.</p>"; });
    MP.online().then(function (list) {
      if (!all) return;
      all.innerHTML = "<b>🗺️ Все в городе (" + list.length + ")</b>" + (list.length ? list.slice(0, 30).map(function (p) {
        var cell = p.creature && FC.people ? FC.people.cellOf(p.creature) : -1;
        return "<div class='mp-who' style='margin-top:6px'>" + (cell >= 0 ? "<span class='fc' style='" + FC.hud.atlasStyle(cell) + "'></span>" : "<span>🥚</span>") +
          "<span>" + (p.tag ? "[" + esc(p.tag) + "] " : "") + esc(p.creatureName) + (p.lvl ? " · ⭐" + (+p.lvl | 0) : "") + (p.friend ? " 🤝" : "") + " · " + esc(p.district) + " · " + (p.d > 1000 ? (p.d / 1000).toFixed(1) + " км" : (+p.d | 0) + " м") +
          (p.m === 1 ? " · 🚗" : p.m === 3 ? " · ✈️" : p.m === 2 ? " · в здании" : "") + "</span> " + goBtn(p.id) +
          (p.fid && FC.ranks ? " <button type='button' class='ghost' data-prof='" + esc(p.fid) + "'>👤</button>" : "") +
          (!p.friend && !p.guest && !MP.guest ? " <button type='button' class='ghost' data-add='" + p.id + "'>➕</button>" : "") + "</div>";
      }).join("") : "<p>Ты один в городе — позови друзей.</p>");
      bind(all);
    }).catch(function () { if (all) all.innerHTML = "<b>🗺️ Все в городе</b><p>Подожди пару секунд и открой снова.</p>"; });
  }
  if (FC.hud) {
    FC.hud.addApp({ id: "online", icon: "🌐", name: "Онлайн", color: "#1f6feb", order: 6, render: renderApp,
      badge: function () { return (MP.connected && MP.count > 1 ? MP.count - 1 : 0) + friendReq.length || ""; } });
  }

  /* ---- кадр и старт --------------------------------------------------------------------------------------- */
  FC.addSystem({
    name: "mp", order: 85,
    update: function (dt) {
      if (!FC.started) return;
      var now = performance.now();
      sendState(now);
      updateRemotes(dt);
      saveServer(now);
    }
  });
  FC.on("me", function () {
    mount();
    connect();
    loadServer();
  });

  FC.mp = MP;
})(window);
