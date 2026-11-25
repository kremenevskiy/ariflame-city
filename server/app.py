"""Флейм-Сити — игровой сервер онлайна (fcg): FastAPI + WebSocket, своя SQLite.

- Своя база — SQLite (FC_DB, по умолчанию data/game.db рядом с сервером, WAL): прогресс игроков, сессии, топ,
  недвижимость, кланы. Положения игроков — только в памяти.
- Личность (README «Личность»): по умолчанию все — гости «g-…» (FC_WORLD не задан). Вход через внешний аккаунт —
  вебхук: токен клиента один раз проверяет внешний сервис (`POST {FC_WORLD}/w/me {token}` → `{rid}`), ответ кэшируется
  на 10 минут; ключей у нас нет. FC_WORLD=fake — локальная проверка и тесты: токен «tok-<rid>» = rid.
- Наружу — только номер соединения, свой ник игрока (nicks.py) или ник из рейтинга и код облика. rid другим игрокам не
  уходит никогда: он связал бы игрока с его домом на карте.
- Свободного текста нет: эмоции — номер из готового списка EMO (мат и спам невозможны по построению).

Протокол (JSON-кадры WebSocket /g/ws, поле t — тип):
  клиент → hi {token?, guest?, creature, v, nick?}; s {p:[x,y,z,h], m, c, k, b, a, w} до 10 Гц; emo {k}; nick {nick}
  сервер → welcome {id, online, guest, emo, name}; w {ts, ps:[[id,x,y,z,h,m,c,k,b,a,w],…], x:[ушли], meta:[{id,creature,
           nick,guest,name?}]} 10 Гц — только ближние (радиус RADIUS, внутри здания — только то же здание); leave {id};
           emo {id, k}; online {n}; nick {ok, nick | why, wait?}
  Ник (nicks.py, 25.11.2026): свой — name (проверяет и хранит сервер); hi.nick — копия с устройства для пустой записи.
  m: 0 пешком, 1 в машине, 2 внутри, 3 в воздухе (c — тип аппарата fair.js), 4 под парашютом; c — тип машины;
  k — цвет; b — здание; a — анимация; w — звёзды розыска. Воздух — шире границы (±AIR_LIM, до AIR_Y м).
HTTP: GET /g/health, /g/stats, /g/top; POST /g/save {token, save, creature?}, /g/load {token}.
Правки без GitHub (contrib.py, 24.11.2026): POST /g/contrib, GET /g/contrib/<id> — очередь для contrib-intake.yml.
Недвижимость (realty.py, homes.py): /g/props, /g/prop/*, /g/biz/*, /g/season* — здания обоих городов, бизнесы, «Передел».
Фоторежим и календарь (22.11.2026 v3): POST /g/photo (кадр для сторис, 48 ч), GET /g/p/<id>.jpg, GET /g/events (неделя) —
media.py, events.py.
Режимы (modes.py, 22.11.2026 v2): гонки с временем по серверу, честность сохранений, «коп против вора», совместный налёт,
рейтинг районов — кадры race/room/coop/dist, ручки /g/races, /g/districts, /g/admin/winners; welcome несёт modes: 1.
Кататься вместе (ride.py, 25.11.2026): кадры ride — пассажиры в машине и вертолёте другого игрока, места решает сервер;
строка пассажира в w — m 5 (копия водителя, a — место); welcome несёт ride: 1.

    uvicorn app:app --host 127.0.0.1 --port 8091      (README.md — запуск; docs/DEPLOY.md — выкладка и прокси)
"""
from __future__ import annotations

import asyncio
import hashlib
import itertools
import json
import logging
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware

import sys  # noqa: E402 — модули службы лежат рядом с app.py (тесты грузят его по пути файла)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modes as fcmodes  # noqa: E402
import media  # noqa: E402 — кадры фоторежима (/g/photo, /g/p/<id>)
import events as fcevents  # noqa: E402 — календарь недели (/g/events)
import contrib  # noqa: E402 — правки без GitHub (/g/contrib → contrib-intake.yml открывает PR)
import errors as fcerrors  # noqa: E402 — ошибки у игроков и сервера (/g/err, /g/admin/errors)
import stats as fcstats  # noqa: E402 — город в цифрах (/g/stats)
import traceback  # noqa: E402
import nicks  # noqa: E402 — ник игрока: проверка, хранение, лимиты смен
import ride as fcride  # noqa: E402 — кататься вместе: пассажиры в чужой машине и вертолёте

# Имена кодов облика (необязательный набор видов). Пусто — ники «Игрок»/«Гость».
CREATURE_NAMES: dict[str, str] = {}

log = logging.getLogger("fcg")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

DB_PATH = os.environ.get("FC_DB") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "game.db")
# Вебхук личности (README «Личность»): пусто — только гости; "fake" — тесты и локально; URL — внешний сервис с POST /w/me.
WORLD = (os.environ.get("FC_WORLD") or "").strip()
WORLD_UA = os.environ.get("FC_WORLD_UA", "FlameCity-GameServer/1.0")   # свой User-Agent: CDN режут «python-httpx/…»
# Откуда пускать браузер (Origin): "*" — отовсюду (по умолчанию: вход — токеном в теле, не кукой); в проде — свой адрес.
ORIGINS = [o.strip() for o in os.environ.get("FC_ORIGINS", "*").split(",") if o.strip()]
MAX_CONN = int(os.environ.get("FC_MAX_CONN", "300"))

TICK = 0.1                    # 10 раз в секунду рассылаем ближних
RADIUS = 350.0                # интерес: дальше не видно (туман города ~900 м, но толпа в 300 игроков не нужна каждому)
MAX_VIS = 60                  # не больше стольких соседей в кадре — ближайшие
SILENCE = 30.0                # тишина дольше — соединение мёртвое
ONLINE_EVERY = 5.0            # счётчик «в городе N» всем
MSG_MAX = 1024                # байт на сообщение клиента
FRAME_MAX = MSG_MAX * 4       # кадр длиннее — не наш клиент (его hi с токеном — до 4 КБ): закрываем сокет сразу (1009)
HI_WAIT = 5.0                 # hi клиент шлёт в onopen; молчит дольше — закрываем, место под MAX_CONN не держим
RATE, BURST = 20.0, 40.0      # сообщений в секунду (ведро), всплеск
BAD_LIMIT = 60                # столько отброшенных — отключаем (4008)
LIM = 1300.0                  # координаты города ±1200 + запас
AIR_LIM, AIR_Y = 2800.0, 1000.0  # в воздухе (m 3, 4): граница воздушного пространства fair.js ±2700, потолок 900
# Города (hi.city): у каждого свои координаты — игроки разных городов друг друга не видят. Минск 1:1 — данные OSM
# (client/minsk/meta.js bounds: x −16000…18000, z −10000…12000), земля и воздух — одна граница с запасом.
CITY_LIM = {"flame": (LIM, AIR_LIM), "minsk": (18500.0, 18500.0)}
JUMP_M, JUMP_FREE, JUMP_WIN = 220.0, 6, 10.0   # скачок дальше JUMP_M без смены здания/режима — «телепорт»: не больше
                                               # JUMP_FREE за JUMP_WIN с (респаун, быстрый переезд); вход в здание и выход
                                               # (меняется b или m) — законный скачок, не считается
SAVE_MAX = 64 * 1024
SAVE_EVERY = 10.0
EMO = ["👋 Привет", "🚗 Погнали", "🔥", "😂", "🤝", "Догони!", "Помоги!"]
EMO_EVERY = 2.0

RID_RE = re.compile(r"[0-9a-f]{8,32}")          # rid от вебхука личности: 8–32 hex (гости — свой вид «g-…»)
GUEST_RE = re.compile(r"g-[a-z0-9]{4,16}")
CRE_RE = re.compile(r"[a-z_]{2,24}")
CAR_RE = re.compile(r"[a-z0-9_]{0,12}")


# --------------------------------------------------------------------------
# своя база: SQLite
# --------------------------------------------------------------------------

class Store:
    """Прогресс игроков, сессии, топ. Один файл, одна блокировка: записей мало (сохранение не чаще раза в 10 с)."""

    def __init__(self, path: str):
        if os.path.dirname(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=NORMAL")
            self.db.execute("PRAGMA busy_timeout=3000")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS players (
                    rid TEXT PRIMARY KEY,
                    creature TEXT,
                    save TEXT,
                    money INTEGER NOT NULL DEFAULT 0,      -- заработано всего (stats.earned) — для топа
                    playmin REAL NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS players_money ON players (money DESC);
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    rid TEXT NOT NULL,
                    guest INTEGER NOT NULL DEFAULT 0,
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS sessions_started ON sessions (started_at);
            """)
            # сессии старше 60 дней — не нужны никому (нагрузка на диск без пользы)
            self.db.execute("DELETE FROM sessions WHERE started_at < ?", (int(time.time()) - 60 * 86400,))
            nicks.ensure(self.db)                            # ники игроков (и гостей) — своя таблица

    def touch(self, rid: str, creature: str | None):
        now = int(time.time())
        with self.lock:
            self.db.execute("""INSERT INTO players (rid, creature, created_at, updated_at) VALUES (?, ?, ?, ?)
                               ON CONFLICT(rid) DO UPDATE SET creature = COALESCE(excluded.creature, players.creature)""",
                            (rid, creature, now, now))

    def save(self, rid: str, creature: str | None, data: str, money: int, playmin: float):
        now = int(time.time())
        with self.lock:
            self.db.execute("""INSERT INTO players (rid, creature, save, money, playmin, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?)
                               ON CONFLICT(rid) DO UPDATE SET creature = COALESCE(excluded.creature, players.creature),
                                 save = excluded.save, money = excluded.money, playmin = excluded.playmin,
                                 updated_at = excluded.updated_at""",
                            (rid, creature, data, money, playmin, now, now))

    def load(self, rid: str) -> dict | None:
        with self.lock:
            r = self.db.execute("SELECT save FROM players WHERE rid = ?", (rid,)).fetchone()
        if not r or not r["save"]:
            return None
        try:
            return json.loads(r["save"])
        except ValueError:
            return None

    def session_start(self, rid: str, guest: bool) -> int:
        with self.lock:
            cur = self.db.execute("INSERT INTO sessions (rid, guest, started_at) VALUES (?, ?, ?)",
                                  (rid, int(guest), int(time.time())))
            return int(cur.lastrowid)

    def session_end(self, sid: int):
        with self.lock:
            self.db.execute("UPDATE sessions SET ended_at = ? WHERE id = ?", (int(time.time()), sid))

    def total(self) -> int:
        with self.lock:
            return int(self.db.execute("SELECT count(*) AS n FROM players").fetchone()["n"])

    def top(self, n: int = 20) -> list[dict]:
        with self.lock:
            # только честные: игрок с откатами сохранений (modes.check_save, cheat ≥ CHEAT_TOP) в топ не попадает
            rows = self.db.execute("""SELECT p.creature, p.money, p.playmin, n.nick FROM players p
                                      LEFT JOIN nicks n ON n.rid = p.rid WHERE p.money > 0
                                      AND p.rid NOT IN (SELECT rid FROM honest WHERE cheat >= ?)
                                      ORDER BY p.money DESC LIMIT ?""", (fcmodes.CHEAT_TOP, n)).fetchall()
        return [{"creature": r["creature"], "name": r["nick"] or CREATURE_NAMES.get(r["creature"] or "", "Игрок"),
                 "earned": int(r["money"]), "playmin": round(float(r["playmin"]))} for r in rows]


store: Store | None = None


def db() -> Store:
    global store
    if store is None:
        store = Store(DB_PATH)
    return store


# --------------------------------------------------------------------------
# личность: токен → rid (проверяет внешний вебхук, мы только кэшируем); без FC_WORLD — только гости
# --------------------------------------------------------------------------

_tok: dict[str, tuple[str, float]] = {}

# Каждый незнакомый токен — запрос к сервису аккаунтов: поток случайных токенов на любую ручку раньше превращался в
# такой же поток к нему (аудит M-3). Поэтому: отказ помним NEG_TTL (по хэшу токена), один и тот же токен в полёте —
# один запрос, одновременно — не больше WORLD_PAR, всего — не быстрее WORLD_RATE в секунду со всплеском WORLD_BURST
# (всплеск — рестарт сервера: все игроки переподключаются разом). Ведро общее, не на адрес: за мостом и Caddy адрес
# у всех игроков сейчас один (аудит M-2). Принятый токен — как раньше: кэш 10 минут, повторно вебхук не зовём.
NEG_TTL, NEG_MAX = 60.0, 20000
WORLD_PAR = 16
WORLD_RATE, WORLD_BURST = 20.0, 400.0
_neg: dict[bytes, float] = {}
_flight: dict[str, asyncio.Future] = {}
_wbucket = [WORLD_BURST, time.monotonic()]
_wsem: list = [None, None]                                   # (цикл, семафор): asyncio.Semaphore в 3.9 привязан к циклу
_wlog = [0.0]


def _world_take() -> bool:
    now = time.monotonic()
    _wbucket[0] = min(WORLD_BURST, _wbucket[0] + (now - _wbucket[1]) * WORLD_RATE)
    _wbucket[1] = now
    if _wbucket[0] < 1:
        if now - _wlog[0] > 60:                              # о потоке — раз в минуту, а не на каждый токен
            _wlog[0] = now
            log.warning("вебхук личности: больше %s проверок в секунду — лишние токены не проверяем", WORLD_RATE)
        return False
    _wbucket[0] -= 1
    return True


def _world_sem() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    if _wsem[0] is not loop:
        _wsem[0], _wsem[1] = loop, asyncio.Semaphore(WORLD_PAR)
    return _wsem[1]


def _neg_key(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8", "surrogatepass")).digest()


def _neg_put(k: bytes, until: float) -> None:
    if len(_neg) >= NEG_MAX:
        now = time.time()
        for x in [x for x, t in _neg.items() if t <= now]:
            del _neg[x]
        if len(_neg) >= NEG_MAX:
            _neg.clear()
    _neg[k] = until


async def _ask_world(token: str) -> str | None:
    """Один запрос к вебхуку. Отказ (4xx, 200 без годного rid) — в отрицательный кэш; сбой сети и 5xx — нет:
    сервис аккаунтов мог моргнуть, а токен — настоящий."""
    k = _neg_key(token)
    if not _world_take():
        return None
    async with _world_sem():
        try:
            async with httpx.AsyncClient(timeout=5, headers={"User-Agent": WORLD_UA}) as c:
                r = await c.post(WORLD.rstrip("/") + "/w/me", json={"token": token})
        except (httpx.HTTPError, ValueError) as e:
            log.warning("вебхук личности не ответил: %s", e)
            return None
    rid = None
    if r.status_code == 200:
        try:
            d = r.json()
        except ValueError:
            d = None
        rid = d.get("rid") if isinstance(d, dict) else None
    if rid and RID_RE.fullmatch(str(rid)):
        return str(rid)
    if r.status_code == 200 or (400 <= r.status_code < 500 and r.status_code != 429):
        _neg_put(k, time.time() + NEG_TTL)
    return None


async def verify(token: str) -> str | None:
    if not isinstance(token, str) or not token or len(token) > 4096:
        return None
    now = time.time()
    hit = _tok.get(token)
    if hit and hit[1] > now:
        return hit[0]
    rid = None
    if not WORLD:
        return None                                         # вход не настроен — все гости
    if WORLD == "fake":
        rid = token[4:] if token.startswith("tok-") else None
    else:
        if _neg.get(_neg_key(token), 0.0) > now:            # этот токен только что не приняли — вебхук не зовём
            return None
        fut = _flight.get(token)
        if fut is None:                                     # тот же токен уже проверяется (сокет и HTTP разом) — ждём его
            fut = asyncio.ensure_future(_ask_world(token))
            _flight[token] = fut

            def landed(f, t=token):
                if _flight.get(t) is f:
                    del _flight[t]
            fut.add_done_callback(landed)
        rid = await asyncio.shield(fut)                     # ушёл один из ждущих — проверка для остальных не рвётся
    if not rid or not RID_RE.fullmatch(str(rid)):
        return None
    if len(_tok) > 5000:
        _tok.clear()
    _tok[token] = (str(rid), now + 600)
    return str(rid)


# --------------------------------------------------------------------------
# соединения
# --------------------------------------------------------------------------

class Client:
    __slots__ = ("ws", "id", "rid", "guest", "creature", "nick", "state", "vis", "known", "bucket", "bucket_t", "bad",
                 "last", "emo_t", "sess", "jumps", "closed", "city", "lvl", "fid", "ctag", "ccol", "pnick", "name")

    def __init__(self, ws: WebSocket, cid: int, rid: str, guest: bool, creature: str | None):
        self.ws, self.id, self.rid, self.guest, self.creature = ws, cid, rid, guest, creature
        self.city = "flame"
        self.nick = CREATURE_NAMES.get(creature or "") or ("Гость" if guest else "Игрок")
        self.state: list | None = None          # [x, y, z, h, m, c, k, b, a, w]
        self.vis: set[int] = set()              # кого видит сейчас
        self.known: set[int] = set()            # чьё meta уже отправлено
        self.bucket, self.bucket_t = BURST, time.monotonic()
        self.bad = 0
        self.last = time.monotonic()
        self.emo_t = float("-inf")                         # time.monotonic() бывает от старта процесса: 0.0 отсекал первую эмоцию
        self.sess = 0
        self.jumps: list[float] = []
        self.closed = False
        self.lvl = self.fid = self.ctag = self.ccol = self.pnick = None   # уровень, профиль, клан (progress, crews)
        self.name: str | None = None            # свой ник (nicks.py); есть — он же nick для комнат режимов

    def set_name(self, name: str | None) -> None:
        self.name = name or None
        self.nick = self.name or CREATURE_NAMES.get(self.creature or "") or ("Гость" if self.guest else "Игрок")
        if self.name and self.fid:
            self.pnick = self.name                          # табличка вошедшего — тоже свой ник (progress.nick_of)

    def meta(self) -> dict:
        m = {"id": self.id, "creature": self.creature, "nick": self.nick, "guest": self.guest}
        if self.name:
            m["name"] = self.name
        if self.fid:                                         # табличка: ник, уровень, тег клана; fid — карточка игрока
            m.update({"fid": self.fid, "lvl": self.lvl, "pn": self.pnick, "tag": self.ctag, "ccol": self.ccol})
        return m


clients: dict[int, Client] = {}
by_rid: dict[str, Client] = {}
_seq = itertools.count(1)
peak = 0


def origin_ok(origin: str | None) -> bool:
    # Без Origin — не браузер (смоук curl, мониторинг): браузер всегда шлёт заголовок, а не-браузер им не остановить.
    return not origin or "*" in ORIGINS or origin in ORIGINS


async def send(c: Client, obj) -> bool:
    if c.closed:
        return False
    try:
        await asyncio.wait_for(c.ws.send_text(obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False,
                                                                                         separators=(",", ":"))), 1.0)
        return True
    except Exception:                                       # noqa: BLE001 — медленный или ушедший клиент
        asyncio.get_running_loop().create_task(kick(c, 1011))
        return False


MODES = fcmodes.Modes(db, send, clients)
RIDE = fcride.Ride(clients, send, MODES.speed)


async def kick(c: Client, code: int):
    if not c.closed:
        c.closed = True
        try:
            await c.ws.close(code=code)
        except Exception:                                   # noqa: BLE001 — уже закрыт
            pass
    await drop(c)


async def drop(c: Client):
    c.closed = True
    if clients.get(c.id) is c:
        del clients[c.id]
    else:
        return
    if by_rid.get(c.rid) is c:
        del by_rid[c.rid]
    try:
        await MODES.on_leave(c)                              # гонка, комната (хозяин передаётся, раунд кончается)
    except Exception:                                       # noqa: BLE001 — уход игрока не должен ронять остальных
        log.exception("режимы: уход %s", c.id)
    try:
        await RIDE.on_leave(c)                               # водитель ушёл — пассажиры выходят; пассажир — место свободно
    except Exception:                                       # noqa: BLE001
        log.exception("поездка: уход %s", c.id)
    for o in list(clients.values()):
        o.known.discard(c.id)
        if c.id in o.vis:
            o.vis.discard(c.id)
            await send(o, {"t": "leave", "id": c.id})
    if c.sess:
        try:
            await asyncio.to_thread(db().session_end, c.sess)
        except sqlite3.Error:
            log.exception("сессия %s не закрылась в базе", c.sess)


def take(c: Client) -> bool:
    now = time.monotonic()
    c.bucket = min(BURST, c.bucket + (now - c.bucket_t) * RATE)
    c.bucket_t = now
    if c.bucket < 1:
        return False
    c.bucket -= 1
    return True


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _int(v, lo: int, hi: int, default: int = 0) -> int:
    return max(lo, min(hi, int(v))) if _num(v) else default


def on_state(c: Client, m: dict) -> bool:
    p = m.get("p")
    if not (isinstance(p, list) and len(p) == 4 and all(_num(v) for v in p)):
        return False
    if c.id in RIDE.seat_of:
        return True                                          # пассажир: его место — в машине водителя (ride.py копирует)
    x, y, z, h = (float(v) for v in p)
    mode = m.get("m") if m.get("m") in (0, 1, 2, 3, 4) else 0
    glim, alim = CITY_LIM.get(c.city, (LIM, AIR_LIM))
    lim, top = (alim, AIR_Y) if mode in (3, 4) else (glim, 500)
    if abs(x) > lim or abs(z) > lim or not -60 <= y <= top:
        return False
    car = m.get("c") or ""
    if not isinstance(car, str) or not CAR_RE.fullmatch(car):
        car = ""
    b = m.get("b")
    b = int(b) if _num(b) and 0 <= int(b) < 1_000_000 else None
    now = time.monotonic()
    if c.state and c.state[7] == b and c.state[4] == mode and math.hypot(x - c.state[0], z - c.state[2]) > JUMP_M:
        c.jumps = [t for t in c.jumps if now - t < JUMP_WIN] + [now]
        if len(c.jumps) > JUMP_FREE:
            return False
    c.state = [round(x, 2), round(y, 2), round(z, 2), round(h % (2 * math.pi), 2), mode, car,
               _int(m.get("k"), 0, 0xFFFFFF), b, _int(m.get("a"), 0, 255), _int(m.get("w"), 0, 6)]
    MODES.on_pos(c)                                          # гонка: чекпоинты и честность — по этому же потоку
    return True


async def on_emo(c: Client, m: dict) -> bool:
    k = m.get("k")
    if not (_num(k) and float(k).is_integer() and 0 <= int(k) < len(EMO)):
        return False
    now = time.monotonic()
    if now - c.emo_t < EMO_EVERY:
        return True                                          # слишком часто — молча, это не нарушение
    c.emo_t = now
    msg = json.dumps({"t": "emo", "id": c.id, "k": int(k)}, separators=(",", ":"))
    for o in [c] + [clients[i] for i in list(c.vis) if i in clients]:
        await send(o, msg)
    return True


def _nick_hi(rid: str, text) -> str | None:
    st = db()
    with st.lock:
        return nicks.on_hi(st.db, rid, text if isinstance(text, str) and len(text) <= 80 else None)


def _nick_change(rid: str, text: str) -> dict:
    st = db()
    with st.lock:
        return nicks.change(st.db, rid, text)


async def on_nick(c: Client, m: dict) -> bool:
    """Свой ник: проверка и лимиты — nicks.change; сменился — соседи получат его в meta на следующем кадре рассылки."""
    text = m.get("nick")
    if not isinstance(text, str) or len(text) > 80:
        return False                                         # не строка или простыня — не наш клиент
    try:
        res = await asyncio.to_thread(_nick_change, c.rid, text)
    except sqlite3.Error:
        log.exception("ник %s не записался", c.id)
        res = {"ok": False, "why": "Не сохранилось — попробуй ещё раз"}
    changed = res.pop("changed", False)
    await send(c, dict(res, t="nick"))
    if res.get("ok") and changed:
        c.set_name(res["nick"])
        for o in list(clients.values()):
            o.known.discard(c.id)                            # tick пришлёт meta с новым ником всем, кто рядом
    return True


# --------------------------------------------------------------------------
# рассылка ближних — 10 раз в секунду
# --------------------------------------------------------------------------

_online_t = 0.0


async def tick():
    global _online_t
    now = time.monotonic()
    for c in list(clients.values()):
        if now - c.last > SILENCE:
            await kick(c, 4003)
    await RIDE.tick()                                        # пассажиры — на места в машинах водителей, до сетки ближних
    grid: dict[tuple[int, int], list[Client]] = {}
    for c in clients.values():
        if c.state:
            grid.setdefault((int(c.state[0] // RADIUS), int(c.state[2] // RADIUS)), []).append(c)
    r2 = RADIUS * RADIUS
    jobs = []
    ts = int(time.time() * 1000)
    for c in list(clients.values()):
        if not c.state:
            continue
        x, z, b = c.state[0], c.state[2], c.state[7]
        gx, gz = int(x // RADIUS), int(z // RADIUS)
        near = []
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for o in grid.get((gx + dx, gz + dz), ()):
                    if o is c or o.state[7] != b or o.city != c.city:   # здание — то же; город — тот же
                        continue
                    d = (o.state[0] - x) ** 2 + (o.state[2] - z) ** 2
                    if d <= r2:
                        near.append((d, o))
        near.sort(key=lambda t: t[0])
        near = [o for _, o in near[:MAX_VIS]]
        ids = {o.id for o in near}
        gone = sorted(c.vis - ids)
        c.vis = ids
        if not near and not gone:
            continue
        meta = []
        for o in near:
            if o.id not in c.known:
                c.known.add(o.id)
                meta.append(o.meta())
        msg = {"t": "w", "ts": ts, "ps": [[o.id] + o.state for o in near]}
        if gone:
            msg["x"] = gone
        if meta:
            msg["meta"] = meta
        jobs.append(send(c, msg))
    if now - _online_t > ONLINE_EVERY:
        _online_t = now
        n = json.dumps({"t": "online", "n": len(clients)})
        jobs += [send(c, n) for c in list(clients.values())]
    if jobs:
        await asyncio.gather(*jobs)
    await MODES.tick(now)


async def ticker():
    while True:
        t0 = time.monotonic()
        try:
            await tick()
        except Exception as e:                              # noqa: BLE001 — рассылка не должна умирать
            log.exception("кадр рассылки упал")
            fcerrors.record_server(db(), "tick", e, traceback.format_exc())
        await asyncio.sleep(max(0.01, TICK - (time.monotonic() - t0)))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db()
    MODES.db()                                               # таблицы режимов (honest — и для топа)
    task = asyncio.create_task(ticker())
    log.info("fcg: база %s, вход %s, до %d соединений", DB_PATH, WORLD or "только гости", MAX_CONN)
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="fcg — Флейм-Сити онлайн", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])
app.include_router(MODES.router())


@app.middleware("http")
async def limit_body(request: Request, call_next):
    n = request.headers.get("content-length")
    path = request.url.path    # кадр фоторежима — до 1,5 МБ, правка с сайта (contrib.py) — до 1,4 МБ
    cap = media.PHOTO_MAX + 4096 if path == "/g/photo" else contrib.BODY_MAX if path == "/g/contrib" else \
        fcerrors.REPORT_MAX if path == "/g/report" else SAVE_MAX + 8192
    if n and n.isdigit() and int(n) > cap:
        return Response('{"detail":"слишком большой запрос"}', status_code=413, media_type="application/json")
    try:
        return await call_next(request)
    except Exception as e:                                  # noqa: BLE001 — необработанное: в сводку ошибок (errors.py), дальше 500
        fcerrors.record_server(db(), path, e, traceback.format_exc())
        raise


_hello = [0]                  # сокеты от accept до hi (и проверки токена) — тоже занимают место под MAX_CONN


async def _greet(ws: WebSocket) -> tuple[Client, dict] | None:
    """Ждём hi (HI_WAIT), проверяем токен, заводим Client. None — сокет закрыт (молчал, мусор, ушёл)."""
    try:
        first = await asyncio.wait_for(ws.receive_text(), timeout=HI_WAIT)
        hi = json.loads(first) if len(first) <= FRAME_MAX else None
    except Exception:                                       # noqa: BLE001 — молчит, мусор, ушёл
        hi = None
    if not isinstance(hi, dict) or hi.get("t") != "hi":
        try:
            await ws.close(code=4002)
        except RuntimeError:                                 # клиент ушёл раньше (смоук curl после 101) — закрывать нечего
            pass
        return None
    rid = await verify(hi.get("token") or "")
    guest = rid is None
    if guest:
        g = hi.get("guest")
        rid = g if isinstance(g, str) and GUEST_RE.fullmatch(g) else "g-" + secrets.token_hex(5)
    cre = hi.get("creature")
    cre = cre if isinstance(cre, str) and CRE_RE.fullmatch(cre) else None
    old = by_rid.get(rid)
    if old:
        await kick(old, 4000)                                # тот же игрок открыл вторую вкладку — старая уходит
    c = Client(ws, next(_seq), rid, guest, cre)
    c.city = hi.get("city") if hi.get("city") in CITY_LIM else "flame"
    clients[c.id] = c                                        # отсюда место считает clients, а не _hello
    by_rid[rid] = c
    return c, hi


@app.websocket("/g/ws")
async def ws_endpoint(ws: WebSocket):
    global peak
    if not origin_ok(ws.headers.get("origin")):
        await ws.close(code=1008)
        return
    await ws.accept()
    # Считаем и тех, кто ещё не прислал hi: раньше 200 молчащих сокетов не занимали ни одного места (аудит M-4).
    if len(clients) + _hello[0] >= MAX_CONN:
        await ws.close(code=1013)                            # «попробуй позже» — клиент сам переподключится с паузой
        return
    _hello[0] += 1
    try:
        got = await _greet(ws)
    finally:
        _hello[0] -= 1
    if got is None:
        return
    c, hi = got
    rid, guest, cre = c.rid, c.guest, c.creature
    peak = max(peak, len(clients))
    try:
        c.sess = await asyncio.to_thread(db().session_start, rid, guest)
        c.set_name(await asyncio.to_thread(_nick_hi, rid, hi.get("nick")))
        await asyncio.to_thread(fcstats.on_join, db(), rid, guest, len(clients))   # «город в цифрах» (stats.py)
        if not guest:
            await asyncio.to_thread(db().touch, rid, cre)
            await _fill_meta(c)
            if isinstance(hi.get("d"), str):                 # район игрока для рейтинга (по дому; менять — раз в неделю)
                await asyncio.to_thread(MODES.set_district, rid, hi.get("d"))
    except sqlite3.Error:
        log.exception("база игры не записала сессию")
    await send(c, {"t": "welcome", "id": c.id, "online": len(clients), "guest": guest, "emo": EMO, "modes": 1, "ride": 1,
                   "fid": c.fid, "lvl": c.lvl, "tag": c.ctag, "name": c.name})
    try:
        while not c.closed:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            raw = msg.get("text")
            if raw is None:
                raw = msg.get("bytes") or b""
            # размер — сразу после приёма, до разбора: огромный кадр — не игрок, держать такой сокет незачем
            # (uvicorn сам принимает до --ws-max-size, по умолчанию 16 МБ — порог ставит выкладка)
            if len(raw) > FRAME_MAX:
                await kick(c, 1009)
                break
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", "replace")
            c.last = time.monotonic()
            ok = False
            if len(raw) <= MSG_MAX and take(c):
                try:
                    m = json.loads(raw)
                except ValueError:
                    m = None
                if isinstance(m, dict):
                    t = m.get("t")
                    if t == "s":
                        prev = c.state
                        ok = on_state(c, m)
                        if ok:
                            await RIDE.after_state(c, prev, m)       # водитель: позиция пассажирам; вышел — высадить
                    elif t == "emo":
                        ok = await on_emo(c, m)
                    elif t == "nick":
                        ok = await on_nick(c, m)
                    elif t == "ping":
                        ok = True
                    elif t == "race":
                        a = m.get("a")
                        ok = (await MODES.race_start(c, m.get("id")) if a == "start" else
                              await MODES.race_quit(c) if a == "quit" else False)
                    elif t == "room":
                        ok = await MODES.room_msg(c, m)
                    elif t == "coop":
                        ok = await MODES.coop_msg(c, m)
                    elif t in ("who", "friends", "friend", "locate"):
                        ok = await MODES.social(c, m)
                    elif t == "dist":
                        ok = c.guest or await asyncio.to_thread(MODES.set_district, c.rid, m.get("d")) or True
                    elif t == "ride":
                        ok = await RIDE.msg(c, m)
            if not ok:
                c.bad += 1
                if c.bad > BAD_LIMIT:
                    await kick(c, 4008)
                    break
    except Exception as e:                                  # noqa: BLE001 — обрыв посреди кадра
        # разрыв связи — обычное дело; остальное — настоящая ошибка сервера, в сводку ошибок (errors.py)
        if not _disconnect(e):
            fcerrors.record_server(db(), "/g/ws", e, traceback.format_exc())
    finally:
        await drop(c)


def _disconnect(e: BaseException) -> bool:
    n = type(e).__name__
    return n in ("WebSocketDisconnect", "ClientDisconnected", "CancelledError") or n.startswith("ConnectionClosed") or \
        (isinstance(e, RuntimeError) and "close" in str(e).lower())


# --------------------------------------------------------------------------
# HTTP: здоровье, счётчики, топ, сохранение
# --------------------------------------------------------------------------

@app.get("/g/health")
def health():
    return {"ok": True, "online": len(clients)}


@app.get("/g/stats")
def stats(resp: Response):
    """Город в цифрах (stats.py) — страница статуса и «Сделать правку». Прежние поля online/peak/players_total — те же."""
    resp.headers["Cache-Control"] = "public, max-age=10"
    cities: dict[str, int] = {}
    for c in list(clients.values()):
        cities[c.city] = cities.get(c.city, 0) + 1
    return fcstats.snapshot(db(), len(clients), cities, peak)


_VER_RE = re.compile(r"[0-9a-f]{7,40}")


@app.post("/g/admin/announce")
async def announce(request: Request):
    """Новая версия города (tools/deploy/pull-live.sh): всем в онлайне — «новая правка, перезагрузка через N с»
    (client/fupdate.js). server=true — следом перезапустится и игровой сервер. Ключ — X-Admin-Key, без него 404."""
    key, got = fcmodes.admin_key(), request.headers.get("x-admin-key") or ""
    if not key or not secrets.compare_digest(got, key):
        raise HTTPException(404, "Not Found")
    body = await _body(request)
    v = str(body.get("v") or "")
    if not _VER_RE.fullmatch(v):
        raise HTTPException(400, "v — sha выпуска")
    sec = body.get("in") if isinstance(body.get("in"), int) else 10
    msg = {"t": "upd", "v": v, "in": max(3, min(sec, 60)), "server": bool(body.get("server"))}
    sent = await asyncio.gather(*(send(c, msg) for c in list(clients.values())))   # медленный не держит остальных
    return {"sent": sum(1 for x in sent if x)}


@app.get("/g/top")
def top(resp: Response):
    resp.headers["Cache-Control"] = "public, max-age=60"
    return {"top": db().top(20)}


_saved_at: dict[str, float] = {}


async def _body(request: Request) -> dict:
    raw = await request.body()
    if len(raw) > SAVE_MAX + 8192:
        raise HTTPException(413, "слишком большой запрос")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "не JSON") from None
    if not isinstance(body, dict):
        raise HTTPException(400, "ждём объект")
    return body


@app.post("/g/save")
async def save(request: Request):
    body = await _body(request)
    rid = await verify(body.get("token") or "")
    if not rid:
        raise HTTPException(401, "нужен вход в аккаунт")
    data = body.get("save")
    if not isinstance(data, dict):
        raise HTTPException(400, "save — объект")
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode()) > SAVE_MAX:
        raise HTTPException(413, "сохранение больше 64 КБ")
    now = time.monotonic()
    if now - _saved_at.get(rid, -1e9) < SAVE_EVERY:
        raise HTTPException(429, "не чаще раза в 10 секунд")
    _saved_at[rid] = now
    if len(_saved_at) > 20000:
        _saved_at.clear()
    st = data.get("stats") if isinstance(data.get("stats"), dict) else {}
    money = _int(st.get("earned"), 0, 2_000_000_000)
    playmin = float(st.get("playMin")) if _num(st.get("playMin")) else 0.0
    cre = body.get("creature")
    cre = cre if isinstance(cre, str) and CRE_RE.fullmatch(cre) else None
    # честность: прирост денег и статистики — по бюджету времени игры; нечестное не пишем, отдаём последнее честное
    ok, back, why = await asyncio.to_thread(MODES.check_save, rid, data)
    if not ok:
        log.info("сохранение %s отклонено: %s", rid, why)
        return {"ok": False, "rolled": back is not None, "save": back, "why": why}
    await asyncio.to_thread(db().save, rid, cre, text, money, max(0.0, min(playmin, 1e7)))
    try:
        await asyncio.to_thread(progress.on_save, db(), rid, data)     # состояние для рейтинга
    except sqlite3.Error:
        log.exception("состояние %s не пересчиталось", rid)
    return {"ok": True}


@app.post("/g/load")
async def load(request: Request):
    body = await _body(request)
    rid = await verify(body.get("token") or "")
    if not rid:
        raise HTTPException(401, "нужен вход в аккаунт")
    return {"save": await asyncio.to_thread(db().load, rid)}


# --------------------------------------------------------------------------
# недвижимость: владение настоящими зданиями обоих городов, бизнесы с сотрудниками-агентами, сезон «Передел»
# (realty.py, 22.11.2026) и старые ручки домов поверх него (homes.py, v2). Модули лежат рядом — путь кладём явно:
# тесты грузят app.py по пути файла, а не пакетом. Касса бизнеса и продажа здания — кредитом честности (MODES.credit).
# --------------------------------------------------------------------------
import sys as _sys  # noqa: E402
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import homes  # noqa: E402
import realty  # noqa: E402


def where(rid: str):
    """Где игрок в онлайне: (город, x, z) — для «касса только у здания»; не в онлайне — None (сервер не знает)."""
    c = by_rid.get(rid)
    if not c or c.closed or not c.state:
        return None
    return (c.city, float(c.state[0]), float(c.state[2]))


app.include_router(homes.make_router(db, verify, _body, MODES))
app.include_router(realty.make_router(db, verify, _body, where, MODES))

# Фоторежим и календарь недели: кадры для сторис — рядом с базой, папка photos/ (FC_PHOTOS — своя),
# календарь — из сида недели (media.py, events.py; клиент — client/fphoto.js, fevents.js).
PHOTOS = os.environ.get("FC_PHOTOS") or os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "photos")
app.include_router(media.make_router(verify, lambda: PHOTOS))
app.include_router(fcevents.router())
# Ошибки у игроков (client/ferr.js) и необработанные исключения сервера — сводка по отпечаткам в той же базе (errors.py)
REPORTS = os.environ.get("FC_REPORTS") or os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "reports")
app.include_router(fcerrors.make_router(db, fcmodes.admin_key, lambda: REPORTS))

# Правки без GitHub (страница contribute.html и навык для ИИ): очередь — папка contrib/ рядом с базой (FC_CONTRIB — своя),
# забирает её GitHub Actions по ключу FC_CONTRIB_KEY (contrib.py, .github/workflows/contrib-intake.yml). Почта автора и
# письма о статусе — в базе (contribmail.py, /g/admin/contrib/outbox), отправляет с хоста tools/deploy/city-mail.sh.
CONTRIB_DIR = os.environ.get("FC_CONTRIB") or os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "contrib")
app.include_router(contrib.make_router(lambda: CONTRIB_DIR, db, fcmodes.admin_key))
# «Рядом с игроками» (crowd.py, 25.11.2026): GET /g/crowd — центр самой людной кучки города на клетке «who» (20 м) и
# сколько в ней; без номеров и ников. Клиент — client/fcrowd.js: карточка старта и «👥 К игрокам» на карте.
import crowd  # noqa: E402
app.include_router(crowd.make_router(lambda: clients, tuple(CITY_LIM)))

# Уровни, рейтинги, достижения, кланы, война за районы (22.11.2026): progress.py, crews.py, war.py. Уровень и тег клана —
# в табличке над головой (Client.meta); сменились — сбрасываем «известность» у соседей, и tick пришлёт meta заново.
import progress  # noqa: E402
import crews  # noqa: E402
import war  # noqa: E402


async def _fill_meta(c: Client) -> None:
    try:
        m = await asyncio.to_thread(progress.meta_of, db(), c.rid)
    except sqlite3.Error:
        log.exception("профиль %s", c.rid)
        return
    c.fid, c.lvl, c.pnick, c.ctag, c.ccol = m["fid"], m["lvl"], m["nick"], m["tag"], m["ccol"]
    c.set_name(c.name)                                       # свой ник поверх ника из «Рейтинга»


async def refresh_meta(rids) -> None:
    for rid in set(rids):
        c = by_rid.get(rid)
        if not c or c.closed or c.guest:
            continue
        old = (c.lvl, c.ctag, c.pnick, c.ccol)
        await _fill_meta(c)
        if (c.lvl, c.ctag, c.pnick, c.ccol) == old:
            continue
        for o in list(clients.values()):
            o.known.discard(c.id)
        await send(c, {"t": "prog", "lvl": c.lvl, "tag": c.ctag, "nick": c.pnick})


async def push(rids, msg: dict) -> None:
    """Кадр игрокам в онлайне (клан: чат, просьба о помощи, приглашение) — вместо опроса сервера."""
    text = json.dumps(msg, ensure_ascii=False, separators=(",", ":"))
    for rid in set(rids):
        c = by_rid.get(rid)
        if c and not c.closed:
            await send(c, text)


def is_online(rid: str) -> bool:
    c = by_rid.get(rid)
    return bool(c and not c.closed)


fcmodes.RACE_HOOKS.append(lambda st, rid, weekly, rank: progress.on_race(st, rid, weekly, rank))
app.include_router(progress.make_router(db, verify, _body, MODES, refresh_meta))
app.include_router(crews.make_router(db, verify, _body, MODES, push, is_online, refresh_meta))
app.include_router(war.make_router(db, verify, _body, where))
