/* Флейм-Сити — задания дня: три цели на календарный день (одинаковые у всех — сид по дате), награда и серия дней.
 * Повод вернуться завтра. Считает по событиям шины (FC.emit оборачивается — модули ничего не знают о заданиях) и по
 * пройденному пути. Приложение в телефоне «Задачи дня», бейдж — сколько осталось.
 */
(function (global) {
  "use strict";
  var FC = global.FC;

  // Цель: проверка события (имя, данные) → сколько засчитать. Каталог; три на день выбираются сидом даты.
  var POOL = [
    { id: "drive", text: "Проедь 3 км на машине", need: 3000, unit: "м", metric: "drive" },
    { id: "walk", text: "Пробеги 1 км", need: 1000, unit: "м", metric: "walk" },
    { id: "work", text: "Отработай 2 смены за столом", need: 2, ev: "job:done", f: function (d) { return d.id === "desk" ? 1 : 0; } },
    { id: "earn", text: "Заработай $2 000 честно", need: 2000, ev: "money", f: function (d) { return d.delta > 0 && !/ограб|налёт|касс|инкасс|ювел/i.test(d.why || "") ? d.delta : 0; } },
    { id: "stunt", text: "Сделай 5 трюков на машине", need: 5, ev: "stunt" },
    { id: "find", text: "Найди 4 находки на улицах", need: 4, ev: "pickup" },
    { id: "escape", text: "Уйди от погони", need: 1, ev: "wanted:lost" },
    { id: "taxi", text: "Отвези 3 пассажиров или посылки", need: 3, ev: "job:done", f: function (d) { return d.id === "taxi" || d.id === "courier" ? 1 : 0; } },
    { id: "rob", text: "Ограбь любую кассу", need: 1, ev: "heist:done" },
    { id: "inside", text: "Зайди в 5 разных зданий", need: 5, ev: "inside:enter", uniq: function (d) { return d && d.building ? d.building.id : null; } },
    { id: "fly", text: "Пролети 2 км", need: 2000, unit: "м", metric: "fly" },
    { id: "agents", text: "Посмотри, как работают 3 агента", need: 3, ev: "inside:enter", f: function (d) { return d && d.building && d.building.zone && FC.people && FC.people.insideOf(d.building).length ? 1 : 0; }, uniq: function (d) { return d && d.building ? d.building.id : null; } },
    { id: "mission", text: "Пройди задание сюжета", need: 1, ev: "story:pass" },
    { id: "shop", text: "Купи что-нибудь в магазине", need: 1, ev: "money", f: function (d) { return d.delta < 0 && /магазин|еда|покуп|оружейн/i.test(d.why || "") ? 1 : 0; } }
  ];
  var REWARD = [600, 900, 1500];

  function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function pick(key) {
    var r = FC.rng(FC.hash("daily" + key)), list = POOL.slice(), out = [];
    while (out.length < 3 && list.length) out.push(list.splice(Math.floor(r() * list.length), 1)[0]);
    return out;
  }
  function state() {
    var S = FC.save, key = today();
    if (!S.daily || S.daily.key !== key) {
      var prev = S.daily;
      var yesterday = new Date(Date.now() - 86400000);
      var ykey = yesterday.getFullYear() + "-" + (yesterday.getMonth() + 1) + "-" + yesterday.getDate();
      var streak = prev && prev.key === ykey && prev.allDone ? (prev.streak || 0) + 1 : 0;
      S.daily = { key: key, goals: pick(key).map(function (g) { return { id: g.id, n: 0, done: false, seen: [] }; }), allDone: false, streak: streak };
      FC.dirty();
    }
    return S.daily;
  }
  function def(id) { for (var i = 0; i < POOL.length; i++) if (POOL[i].id === id) return POOL[i]; return null; }

  function bump(g, n) {
    if (g.done || !n) return;
    var D = def(g.id);
    g.n = Math.min(D.need, g.n + n);
    if (g.n >= D.need) {
      g.done = true;
      var st = state(), idx = st.goals.indexOf(g);
      FC.money(REWARD[idx] || 600, "задание дня");
      if (FC.hud) { FC.hud.popup("ЗАДАНИЕ ДНЯ ✓", { color: "#9dffbf", big: true }); FC.hud.toast("«" + D.text + "» — +" + FC.fmtMoney(REWARD[idx] || 600), "ok", 3); }
      if (FC.audio) FC.audio.play("mission");
      if (st.goals.every(function (x) { return x.done; }) && !st.allDone) {
        st.allDone = true;
        var bonus = 1000 + 500 * Math.min(st.streak, 6);
        FC.money(bonus, "все задания дня");
        if (FC.hud) FC.hud.big("ДЕНЬ ЗАКРЫТ", "+" + FC.fmtMoney(bonus) + (st.streak ? " · серия " + (st.streak + 1) + " дн." : " · завтра — новые"), "#9dffbf", 3.5);
      }
    }
    FC.dirty();
  }

  // события: оборачиваем FC.emit — модули остаются как есть
  var emit0 = FC.emit;
  FC.emit = function (ev, data) {
    emit0(ev, data);
    if (!FC.save || !FC.started) return;
    var st = state();
    st.goals.forEach(function (g) {
      var D = def(g.id);
      if (!D || !D.ev || D.ev !== ev) return;
      var n = D.f ? D.f(data || {}) : 1;
      if (!n) return;
      if (D.uniq) { var u = D.uniq(data); if (u == null || g.seen.indexOf(u) >= 0) return; g.seen.push(u); }
      bump(g, n);
    });
  };

  // пройденный путь: пешком, на машине, в воздухе
  var lx = null, lz = null, acc = { drive: 0, walk: 0, fly: 0 };
  FC.addSystem({
    name: "daily", order: 93,
    update: function () {
      var P = FC.player; if (!P || !FC.started) return;
      if (lx != null) {
        var d = Math.hypot(P.x - lx, P.z - lz);
        if (d < 60) {                                 // телепорт не считаем
          var k = P.mode === "car" ? "drive" : P.mode === "air" ? "fly" : P.mode === "foot" ? "walk" : null;
          if (k) acc[k] += d;
        }
      }
      lx = P.x; lz = P.z;
      if (acc.drive + acc.walk + acc.fly > 25) {
        var st = state();
        st.goals.forEach(function (g) { var D = def(g.id); if (D && D.metric && acc[D.metric] >= 1) bump(g, Math.floor(acc[D.metric])); });
        acc.drive = acc.walk = acc.fly = 0;
      }
    }
  });

  if (FC.hud) FC.hud.addApp({
    id: "daily", icon: "🎯", name: "Задачи дня", color: "#2f9e6e", order: 3,
    badge: function () { var st = FC.save && FC.save.daily; if (!st) return 0; var left = st.goals.filter(function (g) { return !g.done; }).length; return left || 0; },
    render: function (b) {
      var st = state(), esc = FC.hud.esc;
      b.innerHTML = "<div class='list'>" + st.goals.map(function (g, i) {
        var D = def(g.id), pct = Math.round(g.n / D.need * 100);
        var nv = D.unit ? Math.round(g.n) + " / " + D.need + " " + D.unit : g.n + " / " + D.need;
        return "<div class='card'><b>" + (g.done ? "✅ " : "🎯 ") + esc(D.text) + "</b><p>" + nv + " · награда " + FC.fmtMoney(REWARD[i]) + "</p>" +
          "<div style='height:6px;border-radius:4px;background:rgba(255,255,255,.12);margin-top:6px;overflow:hidden'><i style='display:block;height:100%;width:" + pct + "%;background:linear-gradient(90deg,#3fd98b,#ffcf7a)'></i></div></div>";
      }).join("") + "<div class='card'><b>🔥 Серия: " + (st.streak || 0) + " дн.</b><p>Закрой все три — бонус $1 000 и больше с каждым днём серии. Завтра — новые задачи.</p></div></div>";
    }
  });
})(window);
