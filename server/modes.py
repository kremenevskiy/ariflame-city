"""Флейм-Сити онлайн — режимы и честность (подключает app.py).

Задача: «гонки и чекпоинты, еженедельная гонка с таблицей рекордов онлайн;
коп против вора между игроками, совместный налёт вдвоём-вчетвером, рейтинг районов; серверная проверка рекордов и денег,
чтобы не читерили». Сервер здесь — арбитр: клиент ничего не «сообщает о победе», всё считается по его же потоку позиций.

Гонки. Трассы — client/tracks.json (генерирует tools/gen_tracks.cjs; клиент рисует
те же точки). Время — по часам сервера от «старта» до прохода последнего чекпоинта; проход — по отрезку между соседними
позициями (10 Гц), радиус TRACK_R. Дисквалификация: вышел из машины, телепорт (> JUMP_RACE м за кадр), скорость выше
физической (VMAX на окне ≥ 0,5 с), дольше RACE_MAX. Таблица — только вошедшие (гостям приз не выдать).
Трасса недели — по номеру недели (UTC, понедельник); призов сервер сам не выдаёт:
по итогам недели тройка пишется в weekly_winners, награждает оператор руками (README.md), ручка GET /g/admin/winners — под
ключом (FC_ADMIN_KEY или файл admin.key рядом с базой, создаётся сам; наружу его не печатаем).

Честность сохранений. Прирост «заработано всего» сверяется с бюджетом: он копится по RATE за минуту игры (не быстрее
настенных часов) до CAP; деньги на руках и в банке не больше заработанного. Превышение — сохранение не принимается,
игроку возвращается последнее честное, cheat += 1; у cheat ≥ CHEAT_TOP игрока нет в топе. Деньги, которые выдал сам
сервер (realty.py: касса бизнеса, рейс доставки, продажа здания), идут «кредитом» (таблица credit) сверх бюджета.
Покупки за наличные, о которых сервер знает (здание, оборудование и улучшения бизнеса, сырьё, премия, управляющий, клан),
он записывает «долгом» (таблица debit, 24.11): наличные живут у клиента, и сервер не может их списать сам — он ждёт,
что сохранения покажут эти траты (заработано выросло больше, чем деньги на руках и в банке). Пока долг не покрыт тратами,
кредит на ту же сумму не засчитывается: без этого «купил, не заплатив → продал» давало бесконечные деньги (аудит H-2).

Коп против вора, совместный налёт — комнаты до 8 (налёт до 4) игроков поблизости, всё решает сервер: кто вор, касания,
таймер, фургон инкассатора, мешки, делёж. Рейтинг районов — очки за честный заработок, гонки, раунды и налёты; район-
победитель прошлой недели получает +10% к доходу (применяет клиент, сервер говорит, кто победил).

Кто онлайн, друзья, «где он» (22.11, для «тыкнуть на карте и оказаться возле друга»): who — все игроки с огрублёнными
до WHO_GRID м координатами, не чаще раза в WHO_EVERY с; друзья — взаимно (запрос → принять или встречный запрос), в SQLite
по rid; наружу — номер соединения, вид существа и непрозрачный fid (хэш rid с солью сервера), rid и имён нет.
locate (24.11, аудит L-4): точное место и здание — только другу; остальным — та же клетка WHO_GRID, что в who, без здания.

Протокол (кадры WebSocket, в дополнение к app.py; старый клиент их не шлёт и не получает):
  клиент → who {q}; friends {q}; friend {a: add|accept|decline|remove, id?, fid?}; locate {q, id};
           race {a: start|quit, id}; room {a: create|join|leave|start|role, kind: cvt|coop, room, role};
           coop {a: hit|bag, p}; dist {d: msk|minsk|ala|center}
  сервер → who {q, ps}; friends {q, ps, req}; friend {e: req|added|removed, …}; locate {q, id, ok, x, y, z, inside, m, exact}
           (не друг — клетка WHO_GRID, inside: null; друг в другом городе — ok: false, city);
           race {e: go|cp|done|dq, …}; room {e: invite|state|start|pos|catch|end|gone|left, …}; coop {e: van|phase, …}
HTTP: GET /g/races, /g/districts, /g/admin/winners (заголовок X-Admin-Key).
"""
from __future__ import annotations

import asyncio
import collections
import json
import logging
import math
import os
import random
import secrets
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response

HERE = Path(__file__).resolve().parent

TRACK_R = 20.0              # радиус чекпоинта (в файле 16 — запас на задержку сети и срезанный угол)
JUMP_RACE = 70.0            # м между соседними позициями — телепорт, если ещё и быстрее VMAX·1,3 по часам сервера
VMAX = 95.0                 # м/с на окне ≥ 0,5 с: суперкар 64 + нитро 20% + трамплин — с запасом
RACE_MAX = 15 * 60
START_R = 30.0              # стартовать можно только у первого чекпоинта
START_V = 4.0               # …и почти стоя: разгон до старта — не в зачёт

RATE = 8000.0               # $ бюджета за минуту игры (смены, такси, бизнесы, задания дня)
CAP = 300_000.0             # потолок бюджета: налёт на банк и финал сюжета — разовые крупные суммы
FIRST = 200_000.0           # первое сохранение (игрок играл без входа): заработок ≤ минуты · RATE + FIRST
CREDIT_CAP = 3_000_000.0    # деньги, выданные самим сервером (realty.py: касса бизнеса, продажа здания), — сверх бюджета
START_MONEY = 500.0         # деньги нового сохранения (fcore.js fresh): у первого сохранения траты — заработок + 500 − деньги
CHEAT_TOP = 3

ROOM_MAX = {"cvt": 8, "coop": 4}
ROUND = 240.0               # раунд «коп против вора», с
HEAD = 15.0                 # фора вора
CATCH_CAR, CATCH_FOOT, CATCH_HOLD = 5.0, 3.0, 3.0
COOP_MAX = 8 * 60
VAN_HP, VAN_V = 100.0, 11.0
BAG_PAY, BAGS = 1500, 6
DROP_R = 15.0

WHO_GRID, WHO_EVERY, WHO_MAX = 20.0, 3.0, 300
FRIEND_MAX = 100

RACE_HOOKS: list = []       # fn(store, rid, weekly, rank) — финиш гонки по серверу (app.py кладёт progress.on_race)

DISTRICTS = {"center": "Центр", "msk": "Москва", "minsk": "Минск", "ala": "Алматы"}
BONUS = 0.10


def _load_tracks() -> dict:
    for p in (os.environ.get("FC_TRACKS"), HERE / "tracks.json", HERE.parent / "client" / "tracks.json"):
        if p and Path(p).is_file():
            return json.loads(Path(p).read_text())
    return {"v": 1, "r": 16, "tracks": []}


TRACKS = _load_tracks()
BY_ID = {t["id"]: t for t in TRACKS["tracks"]}


def week_of(ts: float | None = None) -> int:
    """Номер недели с 1970-01-05 (понедельник), UTC — одинаков на сервере и в README; трасса недели — по нему."""
    return int(((ts if ts is not None else time.time()) - 345600) // 604800)


def week_track(w: int) -> dict | None:
    tr = TRACKS["tracks"]
    return tr[w % len(tr)] if tr else None


def week_ends_in(ts: float | None = None) -> int:
    t = ts if ts is not None else time.time()
    return int(345600 + (week_of(t) + 1) * 604800 - t)


def _seg_d(px, pz, ax, az, bx, bz) -> float:
    dx, dz = bx - ax, bz - az
    ll = dx * dx + dz * dz
    t = 0.0 if ll == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / ll))
    return math.hypot(ax + dx * t - px, az + dz * t - pz)


def _wealth_of(text: str | None) -> float | None:
    """Деньги на руках и в банке в сохранённом честном сохранении; None — сохранения нет или оно нечитаемо."""
    if not text:
        return None
    try:
        d = json.loads(text)
    except ValueError:
        return None
    if not isinstance(d, dict):
        return None
    w = 0.0
    for k in ("money", "bank"):
        v = d.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            w += float(v)
    return w


class Modes:
    """Всё состояние режимов. app.py отдаёт ссылки на базу, отправку и соединения (тесты подменяют их так же)."""

    def __init__(self, store_fn, send_fn, clients: dict):
        self.store_fn, self.send, self.clients = store_fn, send_fn, clients
        self.hist: dict[int, collections.deque] = {}      # id → последние позиции [(t, x, z, m)]
        self.races: dict[int, dict] = {}
        self.rooms: dict[str, dict] = {}
        self.room_of: dict[int, str] = {}
        self.created_t: dict[int, float] = {}
        self._close_t = 0.0
        self._pos_t = 0.0
        self.schema_ready = False
        self.now = time.monotonic                           # часы режимов (тесты подменяют)
        self.who_t: dict[int, float] = {}                   # у Client __slots__ — метки частоты держим здесь
        self.loc_t: dict[int, float] = {}
        self.fr_t: dict[int, float] = {}

    # ------------------------------------------------------------------ база
    def db(self):
        st = self.store_fn()
        if not self.schema_ready:
            with st.lock:
                st.db.executescript("""
                    CREATE TABLE IF NOT EXISTS races (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, rid TEXT NOT NULL, track TEXT NOT NULL, week INTEGER NOT NULL,
                        ms INTEGER NOT NULL, creature TEXT, at INTEGER NOT NULL);
                    CREATE INDEX IF NOT EXISTS races_board ON races (track, week, ms);
                    CREATE TABLE IF NOT EXISTS weekly_winners (
                        week INTEGER NOT NULL, place INTEGER NOT NULL, rid TEXT, track TEXT, ms INTEGER, creature TEXT,
                        at INTEGER NOT NULL, paid_at INTEGER, PRIMARY KEY (week, place));
                    CREATE TABLE IF NOT EXISTS honest (
                        rid TEXT PRIMARY KEY, earned REAL NOT NULL, playmin REAL NOT NULL, wall REAL NOT NULL,
                        budget REAL NOT NULL, cheat INTEGER NOT NULL DEFAULT 0, save TEXT);
                    CREATE TABLE IF NOT EXISTS districts (rid TEXT PRIMARY KEY, d TEXT NOT NULL, since INTEGER NOT NULL);
                    CREATE TABLE IF NOT EXISTS district_week (
                        week INTEGER NOT NULL, d TEXT NOT NULL, pts REAL NOT NULL DEFAULT 0, PRIMARY KEY (week, d));
                    CREATE TABLE IF NOT EXISTS friends (a TEXT NOT NULL, b TEXT NOT NULL, at INTEGER NOT NULL,
                        PRIMARY KEY (a, b));
                    CREATE TABLE IF NOT EXISTS friend_req (frm TEXT NOT NULL, dst TEXT NOT NULL, at INTEGER NOT NULL,
                        PRIMARY KEY (frm, dst));
                    CREATE TABLE IF NOT EXISTS credit (rid TEXT PRIMARY KEY, amount REAL NOT NULL DEFAULT 0,
                        at INTEGER NOT NULL);
                    CREATE TABLE IF NOT EXISTS debit (rid TEXT PRIMARY KEY, amount REAL NOT NULL DEFAULT 0,
                        at INTEGER NOT NULL);
                """)
            self.schema_ready = True
        return st

    def q(self, sql: str, args=(), one=False):
        st = self.db()
        with st.lock:
            cur = st.db.execute(sql, args)
            return cur.fetchone() if one else cur.fetchall()

    # ------------------------------------------------------------------ позиции (зовёт app.on_state после проверки)
    def on_pos(self, c) -> None:
        now = self.now()
        s = c.state
        h = self.hist.setdefault(c.id, collections.deque(maxlen=40))
        prev = h[-1] if h else None
        h.append((now, s[0], s[2], s[4]))
        r = self.races.get(c.id)
        if r and prev:
            self._race_step(c, r, prev, (now, s[0], s[2], s[4]))

    def speed(self, cid: int, now: float | None = None) -> float:
        """Средняя скорость на последнем окне ≥ 0,5 с — пачка кадров (TCP) не даёт ложной «сверхскорости»."""
        h = self.hist.get(cid)
        if not h or len(h) < 2:
            return 0.0
        t1, x1, z1, _ = h[-1]
        for t0, x0, z0, _m in reversed(h):
            if t1 - t0 >= 0.5:
                return math.hypot(x1 - x0, z1 - z0) / (t1 - t0)
        t0, x0, z0, _m = h[0]
        return math.hypot(x1 - x0, z1 - z0) / max(t1 - t0, 0.5)

    # ------------------------------------------------------------------ гонки
    async def race_start(self, c, tid: str) -> bool:
        t = BY_ID.get(tid) if isinstance(tid, str) else None
        if not t or not c.state:
            return False
        if c.id in self.races:
            return True
        if getattr(c, "city", "flame") != "flame":                    # трассы проложены по Флейм-Сити
            await self.send(c, {"t": "race", "e": "dq", "id": tid, "why": "гонки недели — во Флейм-Сити"})
            return True
        x, z = c.state[0], c.state[2]
        sx, sz = t["cps"][0]
        if c.state[4] != 1:
            await self.send(c, {"t": "race", "e": "dq", "id": tid, "why": "гонка — только на машине"})
            return True
        if math.hypot(x - sx, z - sz) > START_R:
            await self.send(c, {"t": "race", "e": "dq", "id": tid, "why": "встань на старт — к флажку 🏁"})
            return True
        if self.speed(c.id) > START_V:
            await self.send(c, {"t": "race", "e": "dq", "id": tid, "why": "остановись на старте"})
            return True
        w = week_of()
        wt = week_track(w)
        self.races[c.id] = {"id": tid, "t0": self.now(), "next": 1, "n": len(t["cps"]), "weekly": bool(wt and wt["id"] == tid)}
        await self.send(c, {"t": "race", "e": "go", "id": tid, "n": len(t["cps"]), "weekly": self.races[c.id]["weekly"]})
        return True

    async def race_quit(self, c) -> bool:
        r = self.races.pop(c.id, None)
        if r:
            await self.send(c, {"t": "race", "e": "dq", "id": r["id"], "why": "сход"})
        return True

    def _race_step(self, c, r, prev, cur) -> None:
        loop = asyncio.get_running_loop()
        t, x, z, m = cur
        why = None
        if m != 1:
            why = "вышел из машины"
        elif (math.hypot(x - prev[1], z - prev[2]) > JUMP_RACE
              and math.hypot(x - prev[1], z - prev[2]) / max(t - prev[0], 0.05) > VMAX * 1.3):
            # далеко И мгновенно: слабый телефон шлёт редко (секунда без кадров — 60 м), это не телепорт
            why = "телепорт — время не засчитано"
        elif self.speed(c.id) > VMAX:
            why = "скорость выше возможной — время не засчитано"
        elif t - r["t0"] > RACE_MAX:
            why = "слишком долго"
        if why:
            self.races.pop(c.id, None)
            loop.create_task(self.send(c, {"t": "race", "e": "dq", "id": r["id"], "why": why}))
            return
        tr = BY_ID[r["id"]]
        while r["next"] < r["n"]:
            cx, cz = tr["cps"][r["next"]]
            if _seg_d(cx, cz, prev[1], prev[2], x, z) > TRACK_R:
                break
            ms = int((t - r["t0"]) * 1000)
            r["next"] += 1
            if r["next"] >= r["n"]:
                self.races.pop(c.id, None)
                loop.create_task(self._race_done(c, r, ms))
                return
            loop.create_task(self.send(c, {"t": "race", "e": "cp", "id": r["id"], "i": r["next"], "ms": ms}))

    async def _race_done(self, c, r, ms: int) -> None:
        tid, w = r["id"], week_of()
        best = rank = None
        if not c.guest:
            def write():
                st = self.db()
                with st.lock:
                    st.db.execute("INSERT INTO races (rid, track, week, ms, creature, at) VALUES (?, ?, ?, ?, ?, ?)",
                                  (c.rid, tid, w, ms, c.creature, int(time.time())))
                    b = st.db.execute("SELECT min(ms) AS b FROM races WHERE rid = ? AND track = ?", (c.rid, tid)).fetchone()["b"]
                    week_cond = "AND week = ?" if r["weekly"] else ""
                    args = (tid, w) if r["weekly"] else (tid,)
                    rows = st.db.execute(f"""SELECT rid, min(ms) AS b FROM races WHERE track = ? {week_cond}
                                             GROUP BY rid ORDER BY b""", args).fetchall()
                rk = next((i + 1 for i, x in enumerate(rows) if x["rid"] == c.rid), None)
                return b, rk
            best, rank = await asyncio.to_thread(write)
            await asyncio.to_thread(self.add_points, c.rid, 100 if r["weekly"] else 50)
            for h in RACE_HOOKS:                                # опыт и цель клана (progress.on_race, 22.11)
                try:
                    await asyncio.to_thread(h, self.db(), c.rid, bool(r["weekly"]), rank)
                except Exception:                               # noqa: BLE001 — гонка засчитана, учёт вторичен
                    pass
        await self.send(c, {"t": "race", "e": "done", "id": tid, "ms": ms, "best": best, "rank": rank, "weekly": r["weekly"],
                            "guest": c.guest})

    def board(self, tid: str, weekly: bool, n: int = 10) -> list[dict]:
        w = week_of()
        cond, args = ("AND r.week = ?", (tid, w)) if weekly else ("", (tid,))
        rows = self.q(f"""SELECT r.rid, min(r.ms) AS ms, max(r.creature) AS creature FROM races r
                          LEFT JOIN honest h ON h.rid = r.rid
                          WHERE r.track = ? {cond} AND COALESCE(h.cheat, 0) < ?
                          GROUP BY r.rid ORDER BY ms LIMIT ?""", args + (CHEAT_TOP, n))
        return [{"creature": x["creature"], "ms": int(x["ms"])} for x in rows]

    def close_weeks(self) -> None:
        """Итоги прошедших недель (до 8 назад), которых ещё нет: тройка трассы недели — в weekly_winners."""
        w = week_of()
        for back in range(1, 9):
            wk = w - back
            if self.q("SELECT 1 FROM weekly_winners WHERE week = ? LIMIT 1", (wk,), one=True):
                continue
            t = week_track(wk)
            if not t:
                continue
            rows = self.q("""SELECT r.rid, min(r.ms) AS ms, max(r.creature) AS creature FROM races r
                             LEFT JOIN honest h ON h.rid = r.rid
                             WHERE r.track = ? AND r.week = ? AND COALESCE(h.cheat, 0) < ?
                             GROUP BY r.rid ORDER BY ms LIMIT 3""", (t["id"], wk, CHEAT_TOP))
            st = self.db()
            with st.lock:
                if not rows:
                    st.db.execute("INSERT OR IGNORE INTO weekly_winners (week, place, rid, track, ms, creature, at) "
                                  "VALUES (?, 0, NULL, ?, NULL, NULL, ?)", (wk, t["id"], int(time.time())))
                for i, x in enumerate(rows):
                    st.db.execute("INSERT OR IGNORE INTO weekly_winners (week, place, rid, track, ms, creature, at) "
                                  "VALUES (?, ?, ?, ?, ?, ?, ?)", (wk, i + 1, x["rid"], t["id"], int(x["ms"]), x["creature"],
                                                                     int(time.time())))

    # ------------------------------------------------------------------ честность сохранений
    def check_save(self, rid: str, data: dict, now: float | None = None) -> tuple[bool, dict | None, str]:
        """(принять?, честное сохранение для отката | None, причина). Принятое — запоминается как честное."""
        now = time.time() if now is None else now
        st = data.get("stats") if isinstance(data.get("stats"), dict) else {}

        def num(v, d=0.0):
            return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else d
        earned, pm = max(0.0, num(st.get("earned"))), max(0.0, num(st.get("playMin")))
        wealth = num(data.get("money")) + num(data.get("bank"))
        prev = self.q("SELECT * FROM honest WHERE rid = ?", (rid,), one=True)
        cr = self.credit_of(rid)                                    # выдано сервером (бизнес, продажа здания)
        owed = self.debit_of(rid)                                   # куплено за наличные, трат в сохранениях ещё не видно
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        why = ""
        if num(data.get("money")) < 0 or num(data.get("bank")) < 0:
            why = "отрицательные деньги"
        elif wealth > earned + 2000:
            why = "денег больше, чем заработано"
        # Траты с прошлого честного сохранения: заработано выросло, а денег на руках и в банке — меньше на столько же.
        # Они гасят долг за покупки; непогашенный долг съедает кредит: «купил, не заплатив → продал» кредита не даёт.
        # Какие именно вещи куплены, сервер не видит — и не должен: вещи живут у клиента, деньги одни на всё.
        w0 = _wealth_of(prev["save"]) if prev is not None else None
        if w0 is None:
            spent = earned + START_MONEY - wealth                   # первое сохранение — все траты с начала игры
        else:
            spent = (earned - float(prev["earned"])) - (wealth - w0)
        paid = min(owed, max(0.0, spent))
        cr = max(0.0, cr - (owed - paid))
        if prev is None:
            if not why and earned > pm * RATE + FIRST + cr:
                why = "заработок не по времени игры"
            if why:
                self._cheat(rid, None)
                return False, None, why
            self._honest(rid, earned, pm, now, max(0.0, min(CAP, FIRST - max(0.0, earned - cr) + pm * RATE)), text,
                         insert=True)
            self.credit_use(rid, min(cr, earned))
            self.debit_pay(rid, paid)
            return True, None, ""
        e0, pm0, wall0, budget = float(prev["earned"]), float(prev["playmin"]), float(prev["wall"]), float(prev["budget"])
        reset = earned < e0 * 0.5 and pm < pm0                      # «начать заново» в настройках — честный сброс
        if reset and not why:
            # долг не прощаем: иначе «купил, не заплатив → сброс → продал» снова давало бы кредит
            self._honest(rid, earned, pm, now, FIRST, text)
            return True, None, ""
        dpm = pm - pm0
        if not why and dpm < -0.05:
            why = "время игры пошло назад"
        if not why and dpm > (now - wall0) / 60.0 * 1.15 + 0.5:
            why = "время игры быстрее часов"
        budget = min(CAP, budget + max(0.0, dpm) * RATE)
        de = earned - e0
        if not why and de > budget + cr + 1.0:
            why = "заработок быстрее возможного"
        if why:
            self._cheat(rid, prev)
            try:
                back = json.loads(prev["save"]) if prev["save"] else None
            except ValueError:
                back = None
            return False, back, why
        self._honest(rid, earned, pm, now, budget - max(0.0, de - cr), text)
        self.credit_use(rid, min(cr, max(0.0, de)))
        self.debit_pay(rid, paid)
        if de > 0:
            self.add_points(rid, min(500.0, de / 100.0))
        return True, None, ""

    def _honest(self, rid, earned, pm, wall, budget, text, insert=False):
        st = self.db()
        with st.lock:
            st.db.execute("""INSERT INTO honest (rid, earned, playmin, wall, budget, cheat, save) VALUES (?, ?, ?, ?, ?, 0, ?)
                             ON CONFLICT(rid) DO UPDATE SET earned = excluded.earned, playmin = excluded.playmin,
                               wall = excluded.wall, budget = excluded.budget, save = excluded.save""",
                          (rid, earned, pm, wall, budget, text))

    def _cheat(self, rid, prev):
        st = self.db()
        with st.lock:
            if prev is None:
                st.db.execute("""INSERT INTO honest (rid, earned, playmin, wall, budget, cheat, save) VALUES (?, 0, 0, ?, ?, 1, NULL)
                                 ON CONFLICT(rid) DO UPDATE SET cheat = honest.cheat + 1""", (rid, time.time(), FIRST))
            else:
                st.db.execute("UPDATE honest SET cheat = cheat + 1 WHERE rid = ?", (rid,))

    # деньги от сервера: realty.py выдаёт кассу бизнеса и деньги за проданное здание — их прирост «заработано» не чит
    def credit(self, rid: str, amount: float) -> None:
        if amount <= 0:
            return
        st = self.db()
        with st.lock:
            st.db.execute("""INSERT INTO credit (rid, amount, at) VALUES (?, ?, ?) ON CONFLICT(rid) DO UPDATE SET
                             amount = min(?, credit.amount + excluded.amount), at = excluded.at""",
                          (rid, min(CREDIT_CAP, float(amount)), int(time.time()), CREDIT_CAP))

    def credit_of(self, rid: str) -> float:
        r = self.q("SELECT amount FROM credit WHERE rid = ?", (rid,), one=True)
        return float(r["amount"]) if r else 0.0

    def credit_use(self, rid: str, used: float) -> None:
        if used <= 0:
            return
        st = self.db()
        with st.lock:
            st.db.execute("UPDATE credit SET amount = max(0, amount - ?) WHERE rid = ?", (used, rid))

    # покупки за наличные, о которых знает сервер (realty.py, homes.py, crews.py): клиент списывает их сам после ответа,
    # следующее сохранение показывает трату и гасит долг (check_save). Записываем до ответа клиенту — иначе трата
    # могла бы прийти раньше долга и пропасть. Без потолка: у честного игрока долг живёт до ближайшего сохранения.
    def debit(self, rid: str, amount: float) -> None:
        if not isinstance(amount, (int, float)) or isinstance(amount, bool) or not math.isfinite(amount) or amount <= 0:
            return
        st = self.db()
        with st.lock:
            st.db.execute("""INSERT INTO debit (rid, amount, at) VALUES (?, ?, ?) ON CONFLICT(rid) DO UPDATE SET
                             amount = debit.amount + excluded.amount, at = excluded.at""",
                          (rid, float(amount), int(time.time())))

    def debit_of(self, rid: str) -> float:
        r = self.q("SELECT amount FROM debit WHERE rid = ?", (rid,), one=True)
        return float(r["amount"]) if r else 0.0

    def debit_pay(self, rid: str, paid: float) -> None:
        if paid <= 0:
            return
        st = self.db()
        with st.lock:
            st.db.execute("UPDATE debit SET amount = max(0, amount - ?) WHERE rid = ?", (paid, rid))

    def cheat_of(self, rid: str) -> int:
        r = self.q("SELECT cheat FROM honest WHERE rid = ?", (rid,), one=True)
        return int(r["cheat"]) if r else 0

    # ------------------------------------------------------------------ районы
    def set_district(self, rid: str, d: str) -> bool:
        if d not in DISTRICTS:
            return False
        r = self.q("SELECT d, since FROM districts WHERE rid = ?", (rid,), one=True)
        if r and r["d"] == d:
            return True
        if r and time.time() - r["since"] < 7 * 86400:
            return False                                            # менять район — раз в неделю
        st = self.db()
        with st.lock:
            st.db.execute("INSERT INTO districts (rid, d, since) VALUES (?, ?, ?) ON CONFLICT(rid) DO UPDATE SET "
                          "d = excluded.d, since = excluded.since", (rid, d, int(time.time())))
        return True

    def add_points(self, rid: str, pts: float) -> None:
        r = self.q("SELECT d FROM districts WHERE rid = ?", (rid,), one=True)
        if r and pts > 0:
            self.add_points_week(week_of(), r["d"], pts)

    def add_points_week(self, wk: int, d: str | None, pts: float) -> None:
        if not d:
            return
        st = self.db()
        with st.lock:
            st.db.execute("INSERT INTO district_week (week, d, pts) VALUES (?, ?, ?) ON CONFLICT(week, d) DO UPDATE SET "
                          "pts = district_week.pts + excluded.pts", (wk, d, pts))

    def districts(self) -> dict:
        w = week_of()
        cur = {x["d"]: float(x["pts"]) for x in self.q("SELECT d, pts FROM district_week WHERE week = ?", (w,))}
        last = self.q("SELECT d FROM district_week WHERE week = ? ORDER BY pts DESC LIMIT 1", (w - 1,), one=True)
        table = sorted(({"d": k, "name": v, "pts": round(cur.get(k, 0.0))} for k, v in DISTRICTS.items()),
                       key=lambda x: -x["pts"])
        return {"week": w, "ends_in": week_ends_in(), "table": table, "leader": last["d"] if last else None, "bonus": BONUS}

    # ------------------------------------------------------------------ комнаты: коп против вора, совместный налёт
    def _room_state(self, R) -> dict:
        ps = []
        for cid in R["members"]:
            c = self.clients.get(cid)
            if c:
                ps.append({"id": cid, "nick": c.nick, "creature": c.creature, "role": R["roles"].get(cid)})
        return {"t": "room", "e": "state", "room": R["id"], "kind": R["kind"], "host": R["host"], "phase": R["phase"],
                "players": ps, "max": ROOM_MAX[R["kind"]]}

    async def _room_bcast(self, R, msg) -> None:
        for cid in list(R["members"]):
            c = self.clients.get(cid)
            if c:
                await self.send(c, msg)

    async def room_msg(self, c, m: dict) -> bool:
        a = m.get("a")
        if a == "create":
            kind = m.get("kind")
            if kind not in ROOM_MAX or c.id in self.room_of or not c.state:
                return False
            if kind == "coop" and getattr(c, "city", "flame") != "flame":      # маршрут фургона и схрон — по трассам Флейм-Сити
                await self.send(c, {"t": "room", "e": "gone", "room": "", "why": "налёт вместе — пока во Флейм-Сити"})
                return True
            now = self.now()
            if now - self.created_t.get(c.id, -1e9) < 10:
                return True
            self.created_t[c.id] = now
            rid = secrets.token_hex(3)
            R = {"id": rid, "kind": kind, "host": c.id, "members": [c.id], "roles": {}, "phase": "lobby", "created": now}
            if kind == "coop":
                R["roles"][c.id] = "driver"
            self.rooms[rid] = R
            self.room_of[c.id] = rid
            await self.send(c, self._room_state(R))
            inv = {"t": "room", "e": "invite", "room": rid, "kind": kind, "host": c.nick, "n": 1}
            for oid in list(c.vis):
                o = self.clients.get(oid)
                if o and oid not in self.room_of:
                    await self.send(o, inv)
            return True
        room = m.get("room") if isinstance(m.get("room"), str) else ""
        R = self.rooms.get(room if a == "join" else self.room_of.get(c.id, ""))
        if not R:
            return a in ("leave", "start", "role")                 # комнаты уже нет — не нарушение
        if a == "join":
            if c.id in self.room_of or R["phase"] != "lobby" or len(R["members"]) >= ROOM_MAX[R["kind"]]:
                await self.send(c, {"t": "room", "e": "gone", "room": R["id"], "why": "комната полна или уже играет"})
                return True
            host = self.clients.get(R["host"])
            if not host or not host.state or not c.state or getattr(host, "city", "flame") != getattr(c, "city", "flame") \
                    or math.hypot(host.state[0] - c.state[0], host.state[2] - c.state[2]) > 500:
                await self.send(c, {"t": "room", "e": "gone", "room": R["id"], "why": "подойди ближе к хозяину комнаты"})
                return True
            R["members"].append(c.id)
            self.room_of[c.id] = R["id"]
            if R["kind"] == "coop":
                taken = set(R["roles"].values())
                R["roles"][c.id] = next((x for x in ("hacker", "loader", "loader") if x not in taken or x == "loader"), "loader")
            await self._room_bcast(R, self._room_state(R))
            return True
        if a == "leave":
            await self.leave(c)
            return True
        if a == "role" and R["kind"] == "coop" and R["phase"] == "lobby":
            if m.get("role") in ("driver", "hacker", "loader"):
                R["roles"][c.id] = m.get("role")
                await self._room_bcast(R, self._room_state(R))
            return True
        if a == "start":
            if R["host"] != c.id or R["phase"] != "lobby" or len(R["members"]) < 2:
                return True
            if R["kind"] == "cvt":
                await self._cvt_start(R)
            else:
                await self._coop_start(R)
            return True
        return False

    async def leave(self, c) -> None:
        rid = self.room_of.pop(c.id, None)
        R = self.rooms.get(rid) if rid else None
        if not R:
            return
        await self.send(c, {"t": "room", "e": "left", "room": rid})   # ушедший сбрасывает комнату у себя
        if c.id in R["members"]:
            R["members"].remove(c.id)
        R["roles"].pop(c.id, None)
        if R.get("thieves") and c.id in R["thieves"]:
            R["caught"].add(c.id)
        if R.get("carry"):
            R["carry"].pop(c.id, None)
        if not R["members"]:
            self.rooms.pop(rid, None)
            return
        if R["host"] == c.id:
            R["host"] = R["members"][0]
        if R["phase"] == "run" and len(R["members"]) < 2:
            await self._end(R, "cops" if R["kind"] == "cvt" else "fail")
            return
        await self._room_bcast(R, self._room_state(R))

    # -------- коп против вора
    async def _cvt_start(self, R) -> None:
        n = len(R["members"])
        thieves = random.sample(R["members"], 2 if n >= 5 else 1)
        now = self.now()
        R.update(phase="run", thieves=set(thieves), caught=set(), hold={}, score={cid: 0 for cid in R["members"]},
                 t0=now, t_end=now + ROUND)
        R["roles"] = {cid: ("thief" if cid in thieves else "cop") for cid in R["members"]}
        await self._room_bcast(R, {"t": "room", "e": "start", "room": R["id"], "kind": "cvt", "roles": R["roles"],
                                   "round": ROUND, "head": HEAD})

    async def _cvt_tick(self, R, now: float) -> None:
        if now >= R["t_end"]:
            await self._end(R, "thieves")
            return
        if now - R["t0"] < HEAD:
            return
        st = {cid: self.clients[cid].state for cid in R["members"] if cid in self.clients and self.clients[cid].state}
        for th in list(R["thieves"] - R["caught"]):
            s = st.get(th)
            if not s:
                continue
            got = None
            for cop in R["members"]:
                if cop in R["thieves"] or cop not in st:
                    continue
                o = st[cop]
                if o[7] != s[7]:
                    continue
                d = math.hypot(o[0] - s[0], o[2] - s[2])
                if o[4] == 1 and d < CATCH_CAR:
                    got = cop
                    break
                if d < CATCH_FOOT:
                    k = (th, cop)
                    R["hold"][k] = R["hold"].get(k, 0.0) + 0.1
                    if R["hold"][k] >= CATCH_HOLD:
                        got = cop
                        break
                else:
                    R["hold"].pop((th, cop), None)
            if got is not None:
                R["caught"].add(th)
                R["score"][got] = R["score"].get(got, 0) + 150
                R["score"][th] = R["score"].get(th, 0) + int(now - R["t0"]) * 2           # 2 очка за секунду на свободе
                await self._room_bcast(R, {"t": "room", "e": "catch", "room": R["id"], "thief": th, "by": got})
        if R["thieves"] <= R["caught"]:
            await self._end(R, "cops")

    # -------- совместный налёт на инкассатора
    async def _coop_start(self, R) -> None:
        host = self.clients.get(R["host"])
        hx, hz = (host.state[0], host.state[2]) if host and host.state else (0.0, 0.0)
        # маршрут фургона — ближайшая кольцевая трасса (она по улицам): едет кругами, пока не остановят
        loops = [t for t in TRACKS["tracks"] if t.get("loop")] or TRACKS["tracks"]
        tr = min(loops, key=lambda t: min(math.hypot(p[0] - hx, p[1] - hz) for p in t["cps"])) if loops else None
        route = tr["cps"] if tr else [[0, 0], [100, 0]]
        i0 = min(range(len(route)), key=lambda i: math.hypot(route[i][0] - hx, route[i][1] - hz))
        i0 = (i0 + 2) % len(route)
        # схрон — самая дальняя точка трасс от старта фургона (500–900 м)
        cands = [p for t in TRACKS["tracks"] for p in t["cps"]]
        sx, sz = route[i0]
        far = [p for p in cands if 500 <= math.hypot(p[0] - sx, p[1] - sz) <= 900] or cands or [[sx + 600, sz]]
        drop = random.choice(far)
        now = self.now()
        R.update(phase="run", step="chase", t0=now, route=route, seg=i0, van=[float(sx), float(sz)], vhp=VAN_HP,
                 open_t=0.0, bags=0, carry={}, delivered=0, drop=[float(drop[0]), float(drop[1])], hit_t={})
        await self._room_bcast(R, {"t": "room", "e": "start", "room": R["id"], "kind": "coop", "roles": R["roles"],
                                   "van": R["van"], "drop": R["drop"], "limit": COOP_MAX})

    async def coop_msg(self, c, m: dict) -> bool:
        R = self.rooms.get(self.room_of.get(c.id, ""))
        if not R or R["kind"] != "coop" or R["phase"] != "run" or not c.state:
            return True                                            # запоздалое сообщение — не нарушение
        a, s = m.get("a"), c.state
        vx, vz = R["van"]
        d = math.hypot(s[0] - vx, s[2] - vz)
        now = self.now()
        if a == "hit" and R["step"] == "chase":
            p = m.get("p")
            if not isinstance(p, (int, float)) or isinstance(p, bool) or not math.isfinite(p):
                return False
            if d > 8 or s[4] != 1 or now - R["hit_t"].get(c.id, 0) < 0.25:
                return True
            R["hit_t"][c.id] = now
            R["vhp"] -= max(0.0, min(30.0, float(p)))
            if R["vhp"] <= 0:
                R["step"] = "doors"
                await self._room_bcast(R, {"t": "coop", "e": "phase", "step": "doors", "van": R["van"]})
            return True
        if a == "bag" and R["step"] == "loot":
            cap = 2 if R["roles"].get(c.id) == "loader" else 1
            if d > 4 or R["bags"] <= 0 or R["carry"].get(c.id, 0) >= cap:
                return True
            R["bags"] -= 1
            R["carry"][c.id] = R["carry"].get(c.id, 0) + 1
            await self._room_bcast(R, {"t": "coop", "e": "phase", "step": "loot", "bags": R["bags"], "carry": R["carry"]})
            if R["bags"] <= 0:
                R["step"] = "escape"
                await self._room_bcast(R, {"t": "coop", "e": "phase", "step": "escape", "drop": R["drop"], "carry": R["carry"]})
            return True
        return a in ("hit", "bag")

    async def _coop_tick(self, R, now: float, dt: float) -> None:
        if now - R["t0"] > COOP_MAX:
            await self._end(R, "fail")
            return
        if R["step"] == "chase":                                   # фургон едет по маршруту
            route = R["route"]
            tx, tz = route[(R["seg"] + 1) % len(route)]
            vx, vz = R["van"]
            dd = math.hypot(tx - vx, tz - vz)
            step = VAN_V * dt
            if dd <= step:
                R["seg"] = (R["seg"] + 1) % len(route)
                R["van"] = [float(tx), float(tz)]
            else:
                R["van"] = [vx + (tx - vx) / dd * step, vz + (tz - vz) / dd * step]
        elif R["step"] == "doors":                                 # хакер (или любой) у задних дверей 6 с
            vx, vz = R["van"]
            near = [cid for cid in R["members"] if cid in self.clients and self.clients[cid].state
                    and math.hypot(self.clients[cid].state[0] - vx, self.clients[cid].state[2] - vz) < 5
                    and self.clients[cid].state[4] == 0]
            hacker = any(R["roles"].get(cid) == "hacker" for cid in near)
            if near:
                R["open_t"] += dt * (1.5 if hacker else 1.0)
            if R["open_t"] >= 6.0:
                R["step"] = "loot"
                R["bags"] = BAGS
                await self._room_bcast(R, {"t": "coop", "e": "phase", "step": "loot", "bags": BAGS, "carry": {}})
        elif R["step"] == "escape":                                # донести мешки до схрона
            dx, dz = R["drop"]
            for cid, n in list(R["carry"].items()):
                c = self.clients.get(cid)
                if n and c and c.state and math.hypot(c.state[0] - dx, c.state[2] - dz) < DROP_R:
                    R["delivered"] += n
                    R["carry"][cid] = 0
                    await self._room_bcast(R, {"t": "coop", "e": "phase", "step": "escape", "delivered": R["delivered"],
                                               "carry": R["carry"], "drop": R["drop"]})
            if not any(R["carry"].values()):
                await self._end(R, "win")

    async def _end(self, R, how: str) -> None:
        msg = {"t": "room", "e": "end", "room": R["id"], "kind": R["kind"], "how": how}
        pay: dict[int, int] = {}
        if R["kind"] == "cvt":
            now = self.now()
            for cid in R["members"]:
                if cid in R.get("thieves", ()) and cid not in R["caught"]:
                    R["score"][cid] = R["score"].get(cid, 0) + int(now - R["t0"]) * 2 + 300
                elif how == "cops" and cid not in R.get("thieves", ()):
                    R["score"][cid] = R["score"].get(cid, 0) + 200
            pay = {cid: int(p) * 3 for cid, p in R["score"].items()}
            msg["win"] = "cops" if how == "cops" else "thieves"
            msg["score"] = {str(k): v for k, v in R["score"].items()}
            winners = [cid for cid in R["members"] if (R["roles"].get(cid) == "cop") == (how == "cops")]
        else:
            total = R.get("delivered", 0) * BAG_PAY
            msg["total"] = total
            share = total // max(1, len(R["members"]))
            pay = {cid: share for cid in R["members"]}
            winners = R["members"] if how == "win" else []
        msg["pay"] = {str(k): v for k, v in pay.items()}
        await self._room_bcast(R, msg)
        for cid in winners:
            c = self.clients.get(cid)
            if c and not c.guest:
                await asyncio.to_thread(self.add_points, c.rid, 100 if R["kind"] == "cvt" else 200)
        R.update(phase="lobby")
        for k in ("thieves", "caught", "hold", "score", "route", "carry", "van", "drop"):
            R.pop(k, None)
        if R["kind"] == "cvt":
            R["roles"] = {}
        await self._room_bcast(R, self._room_state(R))

    # ------------------------------------------------------------------ кто онлайн, друзья, «где он»
    def fid(self, rid: str) -> str:
        import hashlib
        return hashlib.sha256((admin_key() + ":" + rid).encode()).hexdigest()[:12]

    def _by_rid(self, rid: str):
        for o in self.clients.values():
            if o.rid == rid and not getattr(o, "closed", False):
                return o
        return None

    def friend_rids(self, rid: str) -> list[str]:
        return [x["b"] for x in self.q("SELECT b FROM friends WHERE a = ? ORDER BY at DESC LIMIT ?", (rid, FRIEND_MAX))]

    async def social(self, c, m: dict) -> bool:
        t, q = m.get("t"), m.get("q")
        q = q if isinstance(q, int) and not isinstance(q, bool) and 0 <= q < 1_000_000_000 else 0
        now = self.now()
        if t == "who":
            last = self.who_t.get(c.id, -1e9)
            if now - last < WHO_EVERY:
                await self.send(c, {"t": "who", "q": q, "wait": round(WHO_EVERY - (now - last), 1)})
                return True
            self.who_t[c.id] = now
            fr = set(await asyncio.to_thread(self.friend_rids, c.rid)) if not c.guest else set()
            ps = []
            for o in list(self.clients.values()):
                if not o.state or getattr(o, "closed", False):
                    continue
                ps.append({"id": o.id, "creature": o.creature, "guest": o.guest, "me": o is c, "city": getattr(o, "city", "flame"),
                           "fid": None if o.guest else self.fid(o.rid), "lvl": getattr(o, "lvl", None), "tag": getattr(o, "ctag", None),
                           "x": round(o.state[0] / WHO_GRID) * WHO_GRID, "z": round(o.state[2] / WHO_GRID) * WHO_GRID,
                           "m": o.state[4], "friend": o.rid in fr})
                if len(ps) >= WHO_MAX:
                    break
            await self.send(c, {"t": "who", "q": q, "ps": ps})
            return True
        if t == "locate":
            last = self.loc_t.get(c.id, -1e9)
            o = self.clients.get(m.get("id")) if isinstance(m.get("id"), int) else None
            if now - last < 1.0:
                await self.send(c, {"t": "locate", "q": q, "ok": False, "why": "не чаще раза в секунду"})
                return True
            self.loc_t[c.id] = now
            if not o or not o.state:
                await self.send(c, {"t": "locate", "q": q, "ok": False, "why": "игрок не в сети"})
                return True
            s = o.state
            if getattr(o, "city", "flame") != getattr(c, "city", "flame"):     # друг в другом городе — координаты не те
                await self.send(c, {"t": "locate", "q": q, "ok": False, "city": getattr(o, "city", "flame"), "why": "другой город"})
                return True
            # Точно (до метра и здание, в котором он, — клиент ведёт к его двери) — только другу. Остальным — как в who:
            # клетка WHO_GRID без здания: «📍 К нему» по-прежнему ставит рядом, но не показывает, в каком доме человек
            # (с «Найди свой дом» в Минске 1:1 это может быть его настоящий дом — аудит L-4).
            exact = o is c or (not c.guest and not o.guest and o.rid in set(await asyncio.to_thread(self.friend_rids, c.rid)))
            if exact:
                await self.send(c, {"t": "locate", "q": q, "ok": True, "id": o.id, "x": round(s[0]), "y": round(s[1]),
                                    "z": round(s[2]), "inside": s[7], "m": s[4], "exact": True})
            else:
                g = WHO_GRID
                await self.send(c, {"t": "locate", "q": q, "ok": True, "id": o.id, "x": round(s[0] / g) * g,
                                    "y": round(s[1] / g) * g, "z": round(s[2] / g) * g, "inside": None, "m": s[4],
                                    "exact": False})
            return True
        if t == "friends":
            if c.guest:
                await self.send(c, {"t": "friends", "q": q, "ps": [], "req": [], "guest": True})
                return True

            def load():
                rows = self.q("""SELECT f.b AS rid, p.creature, p.updated_at FROM friends f
                                 LEFT JOIN players p ON p.rid = f.b WHERE f.a = ? ORDER BY f.at DESC LIMIT ?""",
                              (c.rid, FRIEND_MAX))
                req = self.q("""SELECT r.frm AS rid, p.creature FROM friend_req r LEFT JOIN players p ON p.rid = r.frm
                                WHERE r.dst = ? ORDER BY r.at DESC LIMIT 20""", (c.rid,))
                return rows, req
            rows, req = await asyncio.to_thread(load)
            ps = []
            for r in rows:
                o = self._by_rid(r["rid"])
                ps.append({"fid": self.fid(r["rid"]), "creature": (o.creature if o else None) or r["creature"],
                           "online": bool(o and o.state), "id": o.id if o else None, "city": getattr(o, "city", None) if o else None,
                           "seen": None if o else (int(time.time()) - int(r["updated_at"])) // 3600 if r["updated_at"] else None})
            rq = []
            for r in req:
                o = self._by_rid(r["rid"])
                rq.append({"fid": self.fid(r["rid"]), "creature": (o.creature if o else None) or r["creature"],
                           "id": o.id if o else None})
            await self.send(c, {"t": "friends", "q": q, "ps": ps, "req": rq})
            return True
        if t == "friend":
            return await self._friend(c, m)
        return False

    async def _friend(self, c, m: dict) -> bool:
        a = m.get("a")
        if c.guest:
            await self.send(c, {"t": "friend", "e": "err", "why": "друзья — после входа в аккаунт"})
            return True
        now = self.now()
        if now - self.fr_t.get(c.id, -1e9) < 1.5:
            return True
        self.fr_t[c.id] = now

        def rid_by_fid(fid):
            if not isinstance(fid, str):
                return None
            for r in self.q("SELECT b FROM friends WHERE a = ? UNION SELECT frm FROM friend_req WHERE dst = ?", (c.rid, c.rid)):
                rid = r[0]
                if self.fid(rid) == fid:
                    return rid
            return None
        if a == "add":
            o = self.clients.get(m.get("id")) if isinstance(m.get("id"), int) else None
            if not o or o is c or o.guest:
                await self.send(c, {"t": "friend", "e": "err", "why": "дружить можно с вошедшим игроком в сети"})
                return True

            def add():
                st = self.db()
                with st.lock:
                    if st.db.execute("SELECT 1 FROM friends WHERE a = ? AND b = ?", (c.rid, o.rid)).fetchone():
                        return "already"
                    n = st.db.execute("SELECT count(*) AS n FROM friends WHERE a = ?", (c.rid,)).fetchone()["n"]
                    if n >= FRIEND_MAX:
                        return "full"
                    if st.db.execute("SELECT 1 FROM friend_req WHERE frm = ? AND dst = ?", (o.rid, c.rid)).fetchone():
                        ts = int(time.time())               # встречный запрос — сразу дружба
                        st.db.execute("INSERT OR IGNORE INTO friends (a, b, at) VALUES (?, ?, ?), (?, ?, ?)",
                                      (c.rid, o.rid, ts, o.rid, c.rid, ts))
                        st.db.execute("DELETE FROM friend_req WHERE (frm = ? AND dst = ?) OR (frm = ? AND dst = ?)",
                                      (o.rid, c.rid, c.rid, o.rid))
                        return "added"
                    st.db.execute("INSERT OR REPLACE INTO friend_req (frm, dst, at) VALUES (?, ?, ?)", (c.rid, o.rid, int(time.time())))
                    return "sent"
            res = await asyncio.to_thread(add)
            if res == "added":
                await self.send(c, {"t": "friend", "e": "added", "id": o.id, "creature": o.creature})
                await self.send(o, {"t": "friend", "e": "added", "id": c.id, "creature": c.creature})
            elif res == "sent":
                await self.send(c, {"t": "friend", "e": "sent", "id": o.id})
                await self.send(o, {"t": "friend", "e": "req", "id": c.id, "creature": c.creature, "fid": self.fid(c.rid)})
            else:
                await self.send(c, {"t": "friend", "e": "err", "why": "вы уже друзья" if res == "already" else "друзей уже 100"})
            return True
        if a in ("accept", "decline"):
            o = self.clients.get(m.get("id")) if isinstance(m.get("id"), int) else None
            frm = o.rid if o else await asyncio.to_thread(rid_by_fid, m.get("fid"))
            if not frm:
                return True

            def answer():
                st = self.db()
                with st.lock:
                    if not st.db.execute("SELECT 1 FROM friend_req WHERE frm = ? AND dst = ?", (frm, c.rid)).fetchone():
                        return False
                    st.db.execute("DELETE FROM friend_req WHERE frm = ? AND dst = ?", (frm, c.rid))
                    if a == "accept":
                        ts = int(time.time())
                        st.db.execute("INSERT OR IGNORE INTO friends (a, b, at) VALUES (?, ?, ?), (?, ?, ?)",
                                      (c.rid, frm, ts, frm, c.rid, ts))
                    return True
            if await asyncio.to_thread(answer) and a == "accept":
                o = o or self._by_rid(frm)
                await self.send(c, {"t": "friend", "e": "added", "id": o.id if o else None,
                                    "creature": o.creature if o else None})
                if o:
                    await self.send(o, {"t": "friend", "e": "added", "id": c.id, "creature": c.creature})
            return True
        if a == "remove":
            rid = await asyncio.to_thread(rid_by_fid, m.get("fid"))
            if rid:
                def rm():
                    st = self.db()
                    with st.lock:
                        st.db.execute("DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", (c.rid, rid, rid, c.rid))
                await asyncio.to_thread(rm)
                await self.send(c, {"t": "friend", "e": "removed", "fid": m.get("fid")})
            return True
        return False

    # ------------------------------------------------------------------ кадр (зовёт app.tick)
    async def tick(self, now: float) -> None:
        last = getattr(self, "_tick_t", None)
        dt = 0.1 if last is None else min(0.5, max(0.0, now - last))
        self._tick_t = now
        for R in list(self.rooms.values()):
            if R["phase"] != "run":
                if not R["members"]:
                    self.rooms.pop(R["id"], None)
                continue
            if R["kind"] == "cvt":
                await self._cvt_tick(R, now)
            else:
                await self._coop_tick(R, now, dt)
                # фургон едет — его положение группе 5 раз в секунду (позиции игроков — раз в секунду ниже)
                if R.get("phase") == "run" and R.get("step") == "chase" and now - R.get("van_t", 0) >= 0.2:
                    R["van_t"] = now
                    await self._room_bcast(R, {"t": "coop", "e": "van", "van": [round(R["van"][0], 1), round(R["van"][1], 1)],
                                               "vhp": round(R["vhp"])})
        if now - self._pos_t > 1.0:                                # раз в секунду — позиции комнаты её игрокам
            self._pos_t = now
            for R in list(self.rooms.values()):
                if R["phase"] != "run":
                    continue
                ps = [[cid, round(self.clients[cid].state[0], 1), round(self.clients[cid].state[2], 1)]
                      for cid in R["members"] if cid in self.clients and self.clients[cid].state]
                msg = {"t": "room", "e": "pos", "room": R["id"], "ps": ps}
                if R["kind"] == "cvt":
                    msg["caught"] = sorted(R["caught"])
                    msg["left"] = round(R["t_end"] - now)
                else:
                    msg.update(van=[round(R["van"][0], 1), round(R["van"][1], 1)], vhp=round(R["vhp"]), step=R["step"],
                               left=round(COOP_MAX - (now - R["t0"])), open=round(R["open_t"], 1), bags=R["bags"],
                               carry={str(k): v for k, v in R["carry"].items()}, drop=R["drop"])
                await self._room_bcast(R, msg)
        if now - self._close_t > 60:
            self._close_t = now
            try:
                await asyncio.to_thread(self.close_weeks)
            except Exception:                                       # noqa: BLE001 — итоги недели подождут минуту
                pass

    async def on_leave(self, c) -> None:
        self.races.pop(c.id, None)
        self.hist.pop(c.id, None)
        self.created_t.pop(c.id, None)
        for d in (self.who_t, self.loc_t, self.fr_t):
            d.pop(c.id, None)
        await self.leave(c)

    # ------------------------------------------------------------------ HTTP
    def router(self) -> APIRouter:
        rt = APIRouter()
        modes = self

        @rt.get("/g/races")
        def races(resp: Response):
            resp.headers["Cache-Control"] = "public, max-age=20"
            w = week_of()
            wt = week_track(w)
            last = modes.q("SELECT place, ms, creature, track FROM weekly_winners WHERE week = ? AND place > 0 ORDER BY place",
                           (w - 1,))
            return {"week": w, "weekly": wt["id"] if wt else None, "ends_in": week_ends_in(),
                    "boards": {t["id"]: modes.board(t["id"], bool(wt and wt["id"] == t["id"]), 10) for t in TRACKS["tracks"]},
                    "last": [{"place": x["place"], "ms": x["ms"], "creature": x["creature"], "track": x["track"]} for x in last]}

        @rt.get("/g/districts")
        def districts(resp: Response):
            resp.headers["Cache-Control"] = "public, max-age=30"
            return modes.districts()

        @rt.get("/g/admin/winners")
        def winners(request: Request, weeks: int = 4):
            key = admin_key()
            got = request.headers.get("x-admin-key") or ""
            if not key or not secrets.compare_digest(got, key):
                raise HTTPException(404, "Not Found")
            modes.close_weeks()
            w = week_of()
            rows = modes.q("""SELECT week, place, rid, track, ms, creature, paid_at FROM weekly_winners
                              WHERE week >= ? AND place > 0 ORDER BY week DESC, place""", (w - max(1, min(weeks, 52)),))
            return {"week": w, "winners": [dict(x) for x in rows],
                    "how": "призы недели сервер не выдаёт — награждает оператор по rid (README «Гонка недели»)"}

        return rt


_KEY: dict[str, str] = {}
log = logging.getLogger("fcg")


def admin_key() -> str:
    """Ключ админ-ручки: FC_ADMIN_KEY или файл admin.key рядом с базой (создаётся сам, 0600). Наружу не печатаем.
    Он же — соль fid (друзья, профили, рейтинги: на каждого игрока в «who») — поэтому кэш, а не чтение файла каждый раз.
    Пустым не бывает: постоянной соли «fcg» больше нет (аудит L-5) — по fid с известной солью короткий rid перебирается."""
    k = os.environ.get("FC_ADMIN_KEY", "").strip()
    if k:
        return k
    db_path = os.environ.get("FC_DB") or str(HERE / "data" / "game.db")   # тот же путь, что у app.py
    if _KEY.get(db_path):
        return _KEY[db_path]
    _KEY[db_path] = _admin_key_file(db_path)
    return _KEY[db_path]


def _read_key(p: str) -> str:
    try:
        st = os.stat(p)
    except FileNotFoundError:
        return ""
    if st.st_mode & 0o077:                                  # файл от прежней версии с правами umask — закрываем
        try:
            os.chmod(p, 0o600)
        except OSError:
            log.error("admin.key: не закрыть права до 0600 — %s", p)
    with open(p, encoding="utf-8") as f:
        return f.read().strip()


def _admin_key_file(db_path: str) -> str:
    """admin.key появляется сразу полным и с правами 0600: ключ пишем во временный файл (mkstemp — 0600, O_EXCL) и
    ссылкой ставим на место — ни мига с правами umask, ни пустого файла для соседнего процесса (аудит L-5).
    Не вышло ни прочесть, ни создать — громкая ошибка и случайный ключ до перезапуска: админ-ручка закрыта, fid
    сменятся после рестарта, но соль не угадать."""
    d = os.path.dirname(db_path) or "."
    p = os.path.join(d, "admin.key")
    try:
        key = _read_key(p)
        if key:
            return key
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".admin.key.", dir=d)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(secrets.token_hex(16))
                f.flush()
                os.fsync(f.fileno())
            try:
                os.link(tmp, p)                             # занято — ключ уже поставил соседний процесс
            except FileExistsError:
                if not _read_key(p):                        # пустой файл от старой версии, упавшей посреди записи
                    os.replace(tmp, p)
            except OSError:                                 # ФС без жёстких ссылок — создаём сразу 0600, только новым
                try:
                    fd2 = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                except FileExistsError:
                    pass
                else:
                    with os.fdopen(fd2, "w", encoding="utf-8") as f:
                        f.write(secrets.token_hex(16))
        finally:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass
        key = _read_key(p)
        if key:
            return key
    except (OSError, ValueError) as e:                     # ValueError — в файле не UTF-8
        log.error("admin.key (%s): %s", p, e)
    log.error("admin.key не прочитан и не создан — ключ админки и соль fid случайные до перезапуска; "
              "задайте FC_ADMIN_KEY или права на папку базы")
    return secrets.token_hex(16)
