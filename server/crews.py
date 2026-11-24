"""Кланы игроков Флейм-Сити и Минска 1:1: состав и роли, общак, штаб, чат, помощь друг другу, цели недели.

Задача: «рейтинги, лидерборды, захваты… как в Rise of Kingdoms — всё из ресёрча». Ресёрч
(territory_ownership_business_mechanics.md, раздел 4 и п. 3, 5, 17; cis_rp_games_and_virality.md, п. 17 «семьи»):
держит сообщество с общей целью — альянс с ролями, кнопка «Помоги» (соклановцы ускоряют таймеры друг друга),
штаб в нежилом ориентире (не госорганы, мемориалы, храмы), общие цели недели с общей наградой, война за районы по
расписанию (war.py). Ничего за настоящие деньги: создать клан — игровые $, награды — игровые $ и опыт.

Правила: создать — с 5-го уровня (progress.py) и CREATE_COST игровых $ (списывает клиент, сервер сверяет с последним
честным сохранением и пишет «долгом» — modes.debit, как и взнос в общак); до 30 человек; роли — лидер (один),
заместители (до 4), участники. Вступить — сразу (клан открыт), по заявке (лидер/зам. решает) или по приглашению. После ухода — пауза LEAVE_WAIT до другого клана (чтобы не прыгать за
наградами). Тег 2–4 буквы/цифры (уникален без учёта похожих латинских и русских букв), название 3–24 знака.
Чат — готовые фразы и эмоции, плюс короткий текст до 120 знаков: не чаще раза в 3 с и 20 за 10 мин, фильтр мата,
политики и ссылок (clean). Общак — взносы игровыми $ (до 100 000 в сутки, не больше наличных из честного сохранения);
вывести себе нельзя — только на улучшение штаба. Помощь (RoK «помощь»): игрок просит о помощи бизнесу, каждый
соклановец раз нажимает «помочь» — бизнес получает +3 мин выработки и +3% сырья (до HELP_MAX помощей на просьбу,
HELP_DAY нажатий в сутки у помогающего). Цели недели — три из шести (детерминированно по клану и неделе), награда каждому,
кто был в клане к выполнению. Наружу — fid, ник, вид существа, уровень, роль; ни rid, ни имён агентов.

Таблицы: crews, crew_mem, crew_req (заявки и приглашения), crew_chat, crew_help, crew_goal, crew_claim, crew_left.
HTTP — в make_router (README службы, раздел «Уровни, рейтинги, кланы, война за районы»).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
import unicodedata

from fastapi import APIRouter, HTTPException, Request, Response

CREW_MAX = 30
DEPUTY_MAX = 4
CREATE_LVL = 5
CREATE_COST = 25000
LEAVE_WAIT = 12 * 3600
ASK_MAX = 5                     # заявок от игрока сразу
ACT_EVERY = 0.6                 # пауза между действиями одного игрока (тесты ставят 0)
INV_TTL = 7 * 86400
CHAT_KEEP = 200
TEXT_MAX = 120
SAY_EVERY, SAY_WIN, SAY_N = 3.0, 600.0, 20
GIVE_MIN, GIVE_DAY = 100, 100000
HQ_COST = {2: 150000, 3: 400000}  # улучшение штаба из общака
HELP_MAX, HELP_DAY, HELP_ASK_DAY, HELP_TTL = 8, 25, 5, 8 * 3600
HELP_SEC, HELP_STOCK = 180.0, 3.0
GOAL_PAY, GOAL_XP, ALL_PAY = 5000, 300, 8000
HOLD_PAY, HOLD_XP, HOLD_MAX = 3000, 100, 10
COLORS = [0xE63946, 0xF4A261, 0xE9C46A, 0x2FBF71, 0x2A9D8F, 0x4CC9F0, 0x4361EE, 0x9B5DE5, 0xF15BB5, 0xADB5BD]
EMBLEMS = ["🔥", "⚡", "🐺", "🦅", "🐻", "🦊", "🐍", "🦁", "💎", "👑", "⚓", "🚀", "🎲", "🛡️", "🌙", "☀️"]
PRESETS = ["Всем привет!", "Все в штаб!", "Нужна помощь с бизнесом", "Окно войны начинается!", "Держим флаг!",
           "Отличная работа!", "Кто в гонку?", "Скинулся в общак", "Спасибо!", "Иду на помощь", "Берём соседний район",
           "До завтра!"]
EMOTES = ["🔥", "👍", "😂", "🤝", "💪", "🏁", "💰", "🚩"]
MODES_JOIN = ("open", "req", "closed")
GOALS = {
    "infl": ("⚔️", "Набрать влияние в районах", lambda n: 1500 + 200 * n),
    "help": ("🤝", "Помочь друг другу", lambda n: 8 + 3 * n),
    "biz": ("💰", "Собрать $ с бизнесов", lambda n: 80000 + 20000 * n),
    "xp": ("⭐", "Набрать опыта вместе", lambda n: 6000 + 2000 * n),
    "bank": ("🏦", "Пополнить общак на $", lambda n: 25000 + 5000 * n),
    "race": ("🏁", "Пройти гонок", lambda n: 4 + 2 * n),
}
ROLE_NAME = {"leader": "лидер", "deputy": "заместитель", "member": "участник"}
# штаб — нежилой ориентир, но не госорганы, мемориалы, храмы, школы, больницы (клиент их и не продаёт; это вторая стена)
HQ_BAD = re.compile(r"храм|церк|собор|костел|костёл|часовн|мечет|синагог|монастыр|мемориал|памятн|кладбищ|министер|"
                    r"администрац|исполком|правительств|парламент|суд\b|прокурат|милиц|полиц|кгб|мвд|посольств|"  # guard:allow
                    r"школ|гимназ|лицей|детск|больниц|поликлин|госпитал", re.I)

SCHEMA = """
CREATE TABLE IF NOT EXISTS crews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT NOT NULL, tag_key TEXT NOT NULL, name TEXT NOT NULL,
    color INTEGER NOT NULL DEFAULT 0, emblem INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'req',
    leader TEXT NOT NULL, founder TEXT NOT NULL, bank INTEGER NOT NULL DEFAULT 0, bank_total INTEGER NOT NULL DEFAULT 0,
    hq_city TEXT, hq_key TEXT, hq_x REAL, hq_z REAL, hq_dist TEXT, hq_addr TEXT, hq_lvl INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, gone INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS crews_tag ON crews (tag_key) WHERE gone = 0;
CREATE TABLE IF NOT EXISTS crew_mem (rid TEXT PRIMARY KEY, crew INTEGER NOT NULL, role TEXT NOT NULL,
    joined INTEGER NOT NULL, given INTEGER NOT NULL DEFAULT 0, give_day INTEGER NOT NULL DEFAULT 0,
    give_today INTEGER NOT NULL DEFAULT 0, helps INTEGER NOT NULL DEFAULT 0, help_day INTEGER NOT NULL DEFAULT 0,
    help_today INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS crew_mem_crew ON crew_mem (crew);
CREATE TABLE IF NOT EXISTS crew_req (crew INTEGER NOT NULL, rid TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (crew, rid, kind));
CREATE TABLE IF NOT EXISTS crew_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, crew INTEGER NOT NULL, rid TEXT,
    at INTEGER NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS crew_chat_crew ON crew_chat (crew, id);
CREATE TABLE IF NOT EXISTS crew_help (id INTEGER PRIMARY KEY AUTOINCREMENT, crew INTEGER NOT NULL, rid TEXT NOT NULL,
    city TEXT NOT NULL, bkey TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, need INTEGER NOT NULL,
    got INTEGER NOT NULL DEFAULT 0, who TEXT NOT NULL DEFAULT '[]', done INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS crew_help_crew ON crew_help (crew, done);
CREATE TABLE IF NOT EXISTS crew_goal (crew INTEGER NOT NULL, week INTEGER NOT NULL, goal TEXT NOT NULL,
    prog REAL NOT NULL DEFAULT 0, need REAL NOT NULL, done_at INTEGER, PRIMARY KEY (crew, week, goal));
CREATE TABLE IF NOT EXISTS crew_claim (crew INTEGER NOT NULL, week INTEGER NOT NULL, what TEXT NOT NULL, rid TEXT NOT NULL,
    at INTEGER NOT NULL, PRIMARY KEY (crew, week, what, rid));
CREATE TABLE IF NOT EXISTS crew_left (rid TEXT PRIMARY KEY, at INTEGER NOT NULL);
"""
_ok: set[int] = set()
_say: dict[str, list[float]] = {}


def ensure_tables(db) -> None:
    if id(db) in _ok:
        return
    db.executescript(SCHEMA)
    _ok.add(id(db))


def ensure(store) -> None:
    import progress
    import war
    progress.ensure(store)
    with store.lock:
        ensure_tables(store.db)
        war.ensure_tables(store.db)


def week_of(now: float) -> int:
    import modes
    return modes.week_of(now)


# ---------------------------------------------------------------------------------------------------------------
# фильтр текста: мат, политика и экстремизм (Беларусь — ст. 130, 341, 361-1, 367–369 УК РБ), ссылки и телефоны
# ---------------------------------------------------------------------------------------------------------------
_LOOK = str.maketrans({"a": "а", "b": "в", "c": "с", "e": "е", "h": "н", "k": "к", "m": "м", "o": "о", "p": "р",
                       "t": "т", "x": "х", "y": "у", "u": "и", "3": "з", "0": "о", "4": "ч", "6": "б", "@": "а",
                       "ё": "е", "$": "с"})
_TRANS = [("sch", "щ"), ("shh", "щ"), ("zh", "ж"), ("ch", "ч"), ("sh", "ш"), ("ya", "я"), ("yu", "ю"), ("yo", "е"),
          ("kh", "х"), ("ts", "ц"), ("a", "а"), ("b", "б"), ("v", "в"), ("g", "г"), ("d", "д"), ("e", "е"),
          ("z", "з"), ("i", "и"), ("j", "й"), ("k", "к"), ("l", "л"), ("m", "м"), ("n", "н"), ("o", "о"), ("p", "п"),
          ("r", "р"), ("s", "с"), ("t", "т"), ("u", "у"), ("f", "ф"), ("h", "х"), ("x", "х"), ("c", "к"), ("y", "ы"),
          ("w", "в"), ("q", "к")]
_ROOTS = ["хуй", "хуе", "хуя", "хуи", "хуё", "пизд", "пезд", "ебат", "ебан", "ебал", "ебуч", "еблан", "ебло", "ебну",  # guard:allow
          "заеб", "наеб", "уеба", "выеб", "проеб", "долбоеб", "отъеб", "съеб", "бляд", "блят", "пидор", "пидар", "педераст",  # guard:allow
          "гандон", "гондон", "залуп", "мудак", "мудил", "шлюх", "сучар", "дроч", "манда", "мраз",  # guard:allow
          "гитлер", "хайль", "свастик", "лукашенк", "путин", "зеленск", "навальн", "тихановск", "пагоня",  # guard:allow
          "жывебеларусь", "живебеларусь", "славаукраин", "игил", "террор"]
_WORDS = {"бля", "сука", "суки", "сучка", "сучара", "чмо", "шалава", "педик", "бчб", "сво", "zov", "нацист", "fuck",  # guard:allow
          "shit", "cunt", "bitch", "whore", "faggot", "nigger", "nigga", "pussy", "asshole", "porn", "порно", "секс"}  # guard:allow
_PHRASES = ["1488", "жывебеларусь", "живебеларусь", "славаукраин", "зигхайль", "siegheil", "zigheil", "славароссии", "смертьврагам"]  # guard:allow
_EN = ["fuck", "shit", "cunt", "bitch", "nigg", "fagg", "whore", "asshole", "porn"]  # guard:allow
_LINK = re.compile(r"https?:|www\.|\.(com|ru|by|net|org|io|me|su|xyz)\b|t\.me|tg://|telegram|@[a-z0-9_]{3,}|\d[\d\s\-()]{5,}\d",
                   re.I)


def _collapse(s: str) -> str:
    out = []
    for ch in s:
        if not out or out[-1] != ch:
            out.append(ch)
    return "".join(out)


def _forms(text: str) -> list[str]:
    low = unicodedata.normalize("NFKC", text).lower().replace("ё", "е")
    tokens = re.findall(r"[\w@$]+", low)
    # буквы через пробел («х у й») — склеиваем подряд идущие одиночные
    merged, run = [], ""
    for t in tokens:
        if len(t) == 1:
            run += t
        else:
            if run:
                merged.append(run)
                run = ""
            merged.append(t)
    if run:
        merged.append(run)
    out = []
    for t in merged:
        a = _collapse(re.sub(r"[_\W]", "", t.translate(_LOOK)))
        b = t
        for k, v in _TRANS:
            b = b.replace(k, v)
        b = _collapse(re.sub(r"[_\W]", "", b.replace("ё", "е")))
        out += [a, b, _collapse(re.sub(r"[_\W]", "", t))]
    return out


def clean(text: str) -> str | None:
    """None — можно; строка — почему нельзя (показываем игроку)."""
    if _LINK.search(text or ""):
        return "без ссылок, ников и телефонов"
    forms = _forms(text or "")
    for f in forms:
        if f in _WORDS or any(r in f for r in _ROOTS) or any(r in f for r in _EN):
            return "без мата и политики — переформулируй"
    whole = "".join(re.findall(r"\w", unicodedata.normalize("NFKC", text or "").lower().replace("ё", "е")))
    if any(p in whole for p in _PHRASES):                # лозунги из нескольких слов
        return "без мата и политики — переформулируй"
    return None


def tag_key(tag: str) -> str:
    """Уникальность тега без учёта похожих латинских и русских букв (BOSS = ВОSS)."""
    return tag.lower().translate(_LOOK)


# ---------------------------------------------------------------------------------------------------------------
# чтение (db — под store.lock у вызывающего)
# ---------------------------------------------------------------------------------------------------------------
def crew_of(db, rid: str) -> dict | None:
    ensure_tables(db)
    r = db.execute("""SELECT c.*, m.role, m.joined FROM crew_mem m JOIN crews c ON c.id = m.crew
                      WHERE m.rid = ? AND c.gone = 0""", (rid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["emblem_i"] = d["emblem"]
    d["emblem"] = EMBLEMS[int(d["emblem"]) % len(EMBLEMS)]
    d["color"] = "#%06x" % COLORS[int(d["color"]) % len(COLORS)]
    return d


def card(db, crew_id) -> dict | None:
    if crew_id is None:
        return None
    ensure_tables(db)
    r = db.execute("SELECT * FROM crews WHERE id = ? AND gone = 0", (crew_id,)).fetchone()
    if not r:
        return None
    n = db.execute("SELECT count(*) AS n FROM crew_mem WHERE crew = ?", (crew_id,)).fetchone()["n"]
    import war
    return {"id": int(r["id"]), "tag": r["tag"], "name": r["name"], "color": "#%06x" % COLORS[int(r["color"]) % len(COLORS)],
            "emblem": EMBLEMS[int(r["emblem"]) % len(EMBLEMS)], "n": int(n), "mode": r["mode"],
            "held": len(war.held_by(db, int(r["id"]))), "hq": bool(r["hq_key"])}


def _members(db, crew: int) -> list:
    return db.execute("""SELECT m.*, p.fid, p.nick_w, p.nick_n, p.lvl, pl.creature, pl.updated_at FROM crew_mem m
                         LEFT JOIN prog p ON p.rid = m.rid LEFT JOIN players pl ON pl.rid = m.rid
                         WHERE m.crew = ? ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'deputy' THEN 1 ELSE 2 END,
                         p.lvl DESC""", (crew,)).fetchall()


def power(db, crew: int) -> int:
    import war
    lv = db.execute("""SELECT COALESCE(sum(p.lvl), 0) AS s FROM crew_mem m LEFT JOIN prog p ON p.rid = m.rid
                       WHERE m.crew = ?""", (crew,)).fetchone()["s"]
    c = db.execute("SELECT hq_lvl FROM crews WHERE id = ?", (crew,)).fetchone()
    return int(lv) * 10 + len(war.held_by(db, crew)) * 1000 + (int(c["hq_lvl"]) * 500 if c else 0)


def power_rows(db, scope: str, city: str, now: float) -> list[tuple]:
    import war
    ensure_tables(db)
    war.ensure_tables(db)
    if scope == "week":
        cw = "" if city == "all" else " AND w.city = ?"
        rows = db.execute(f"""SELECT w.crew AS id, sum(w.pts) AS v FROM war_pts w JOIN crews c ON c.id = w.crew AND c.gone = 0
                              WHERE w.week = ?{cw} GROUP BY w.crew ORDER BY v DESC LIMIT 500""",
                          (week_of(now),) + (() if city == "all" else (city,))).fetchall()
        return [(int(x["id"]), float(x["v"])) for x in rows if x["v"] > 0]
    out = [(int(x["id"]), float(power(db, int(x["id"])))) for x in db.execute("SELECT id FROM crews WHERE gone = 0")]
    if city != "all":
        keep = {int(x["crew"]) for x in db.execute("""SELECT DISTINCT m.crew FROM crew_mem m JOIN prog_city c
                                                      ON c.rid = m.rid AND c.city = ?""", (city,))}
        keep |= {int(x["crew"]) for x in db.execute("SELECT crew FROM war_hold WHERE city = ? AND crew IS NOT NULL", (city,))}
        out = [x for x in out if x[0] in keep]
    out.sort(key=lambda x: -x[1])
    return out[:500]


# ---------------------------------------------------------------------------------------------------------------
# цели недели (goal_add зовут progress/war/realty-крючки — с чужой блокировкой)
# ---------------------------------------------------------------------------------------------------------------
def _goals(db, crew: int, wk: int) -> list:
    rows = db.execute("SELECT * FROM crew_goal WHERE crew = ? AND week = ?", (crew, wk)).fetchall()
    if rows:
        return rows
    n = db.execute("SELECT count(*) AS n FROM crew_mem WHERE crew = ?", (crew,)).fetchone()["n"]
    keys = sorted(GOALS, key=lambda k: hashlib.sha256(f"{crew}:{wk}:{k}".encode()).hexdigest())[:3]
    for k in keys:
        db.execute("INSERT OR IGNORE INTO crew_goal (crew, week, goal, prog, need) VALUES (?, ?, ?, 0, ?)",
                   (crew, wk, k, float(GOALS[k][2](max(3, int(n))))))     # не меньше чем на троих: клан из одного не «фармит»
    return db.execute("SELECT * FROM crew_goal WHERE crew = ? AND week = ?", (crew, wk)).fetchall()


def goal_add(db, rid: str, kind: str, amount: float, now: float | None = None) -> None:
    if amount <= 0:
        return
    ensure_tables(db)
    now = time.time() if now is None else now
    m = db.execute("SELECT crew FROM crew_mem WHERE rid = ?", (rid,)).fetchone()
    if not m:
        return
    wk = week_of(now)
    for g in _goals(db, int(m["crew"]), wk):
        if g["goal"] != kind or g["done_at"]:
            continue
        p = float(g["prog"]) + float(amount)
        db.execute("UPDATE crew_goal SET prog = ?, done_at = ? WHERE crew = ? AND week = ? AND goal = ?",
                   (min(p, float(g["need"])), int(now) if p >= float(g["need"]) else None, int(m["crew"]), wk, kind))
        if p >= float(g["need"]):
            _sys(db, int(m["crew"]), f"🎯 Цель недели выполнена: {GOALS[kind][1]} — заберите награду во вкладке «Цели»", now)


# ---------------------------------------------------------------------------------------------------------------
# действия (под store.lock)
# ---------------------------------------------------------------------------------------------------------------
def _sys(db, crew: int, text: str, now: float) -> None:
    db.execute("INSERT INTO crew_chat (crew, rid, at, k, v) VALUES (?, NULL, ?, 's', ?)", (crew, int(now), text))


def _trim_chat(db, crew: int) -> None:
    db.execute("""DELETE FROM crew_chat WHERE crew = ? AND id <= (SELECT id FROM crew_chat WHERE crew = ?
                  ORDER BY id DESC LIMIT 1 OFFSET ?)""", (crew, crew, CHAT_KEEP))


def _nick(db, rid: str) -> str:
    import progress
    return progress.nick_of(progress.row_of(db, rid))


def _honest_money(db, rid: str) -> float | None:
    try:
        h = db.execute("SELECT save FROM honest WHERE rid = ?", (rid,)).fetchone()
    except Exception:                               # noqa: BLE001 — таблицы режимов нет (тесты)
        return None
    if not h or not h["save"]:
        return None
    try:
        v = json.loads(h["save"]).get("money")
    except (ValueError, AttributeError):
        return None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _me(db, rid: str):
    m = db.execute("""SELECT m.*, c.leader FROM crew_mem m JOIN crews c ON c.id = m.crew AND c.gone = 0 WHERE m.rid = ?""",
                   (rid,)).fetchone()
    if not m:
        raise HTTPException(404, "ты не в клане")
    return m


def _boss(m, deputy_ok: bool = True) -> None:
    if m["role"] == "leader" or (deputy_ok and m["role"] == "deputy"):
        return
    raise HTTPException(403, "это может только лидер" + (" или заместитель" if deputy_ok else ""))


def _rid_by_fid(db, fid) -> str:
    if not isinstance(fid, str) or not re.fullmatch(r"[0-9a-f]{12}", fid):
        raise HTTPException(400, "fid — игрок")
    r = db.execute("SELECT rid FROM prog WHERE fid = ?", (fid,)).fetchone()
    if not r:
        raise HTTPException(404, "такого игрока нет")
    return r["rid"]


def _join(db, crew: int, rid: str, now: float, role: str = "member") -> None:
    n = db.execute("SELECT count(*) AS n FROM crew_mem WHERE crew = ?", (crew,)).fetchone()["n"]
    if n >= CREW_MAX:
        raise HTTPException(403, f"в клане уже {CREW_MAX} человек")
    db.execute("INSERT INTO crew_mem (rid, crew, role, joined) VALUES (?, ?, ?, ?)", (rid, crew, role, int(now)))
    db.execute("DELETE FROM crew_req WHERE rid = ?", (rid,))
    _sys(db, crew, f"👋 {_nick(db, rid)} в клане", now)


def _free(db, rid: str, now: float) -> None:
    if db.execute("SELECT 1 FROM crew_mem m JOIN crews c ON c.id = m.crew AND c.gone = 0 WHERE m.rid = ?", (rid,)).fetchone():
        raise HTTPException(409, "ты уже в клане — сначала выйди")
    db.execute("DELETE FROM crew_mem WHERE rid = ?", (rid,))         # хвост распущенного клана
    left = db.execute("SELECT at FROM crew_left WHERE rid = ?", (rid,)).fetchone()
    if left and now - int(left["at"]) < LEAVE_WAIT:
        h = int((LEAVE_WAIT - (now - int(left["at"]))) // 3600) + 1
        raise HTTPException(429, f"после ухода из клана — пауза 12 ч (ещё ~{h} ч)")


def create(store, rid: str, tag: str, name: str, color: int, emblem: int, mode: str, now: float | None = None) -> dict:
    import progress
    now = time.time() if now is None else now
    tag = (tag or "").strip().upper()
    name = re.sub(r"\s+", " ", (name or "").strip())
    if not re.fullmatch(r"[A-Z0-9А-ЯЁ]{2,4}", tag):
        raise HTTPException(400, "тег — 2–4 буквы или цифры")
    if not (3 <= len(name) <= 24) or not re.fullmatch(r"[\w\s\-«»\"'.!]+", name):
        raise HTTPException(400, "название — 3–24 знака: буквы, цифры, пробел, дефис, кавычки")
    why = clean(tag) or clean(name)
    if why:
        raise HTTPException(400, why)
    with store.lock:
        db = store.db
        ensure_tables(db)
        r = progress.row_of(db, rid, now)
        if int(r["lvl"]) < CREATE_LVL:
            raise HTTPException(403, f"создать клан можно с {CREATE_LVL}-го уровня")
        _free(db, rid, now)
        money = _honest_money(db, rid)
        if money is not None and money < CREATE_COST:
            raise HTTPException(402, f"нужно ${CREATE_COST:,} наличными".replace(",", " "))
        if db.execute("SELECT 1 FROM crews WHERE tag_key = ? AND gone = 0", (tag_key(tag),)).fetchone():
            raise HTTPException(409, "такой тег уже занят")
        cur = db.execute("""INSERT INTO crews (tag, tag_key, name, color, emblem, mode, leader, founder, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                         (tag, tag_key(tag), name, int(color) % len(COLORS), int(emblem) % len(EMBLEMS),
                          mode if mode in MODES_JOIN else "req", rid, rid, int(now)))
        cid = int(cur.lastrowid)
        _join(db, cid, rid, now, "leader")
        t = progress._js(r["titles"], [])
        if "founder" not in t:
            t.append("founder")
            db.execute("UPDATE prog SET titles = ? WHERE rid = ?", (json.dumps(t), rid))
        progress._changed.add(rid)
    return {"ok": True, "id": cid, "cost": CREATE_COST}


def join(store, rid: str, crew: int, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        c = db.execute("SELECT * FROM crews WHERE id = ? AND gone = 0", (crew,)).fetchone()
        if not c:
            raise HTTPException(404, "клана нет")
        _free(db, rid, now)
        inv = db.execute("SELECT at FROM crew_req WHERE crew = ? AND rid = ? AND kind = 'inv'", (crew, rid)).fetchone()
        if c["mode"] == "open" or (inv and now - int(inv["at"]) < INV_TTL):
            _join(db, crew, rid, now)
            import progress
            progress._changed.add(rid)
            return {"ok": True, "joined": True}
        if c["mode"] == "closed":
            raise HTTPException(403, "клан закрыт — только по приглашению")
        if db.execute("SELECT count(*) AS n FROM crew_req WHERE rid = ? AND kind = 'ask'", (rid,)).fetchone()["n"] >= ASK_MAX:
            raise HTTPException(429, "много заявок сразу — дождись ответа")
        db.execute("INSERT OR REPLACE INTO crew_req (crew, rid, kind, at) VALUES (?, ?, 'ask', ?)", (crew, rid, int(now)))
        _sys(db, crew, f"📨 Заявка в клан от {_nick(db, rid)}", now)
    return {"ok": True, "joined": False, "asked": True}


def leave(store, rid: str, now: float | None = None) -> dict:
    import progress
    import war
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        crew = int(m["crew"])
        db.execute("DELETE FROM crew_mem WHERE rid = ?", (rid,))
        db.execute("INSERT OR REPLACE INTO crew_left (rid, at) VALUES (?, ?)", (rid, int(now)))
        rest = db.execute("""SELECT rid FROM crew_mem WHERE crew = ? ORDER BY CASE role WHEN 'deputy' THEN 0 ELSE 1 END,
                             joined LIMIT 1""", (crew,)).fetchone()
        gone = False
        if m["role"] == "leader":
            if rest:
                db.execute("UPDATE crew_mem SET role = 'leader' WHERE rid = ?", (rest["rid"],))
                db.execute("UPDATE crews SET leader = ? WHERE id = ?", (rest["rid"], crew))
                _sys(db, crew, f"👑 Лидер ушёл — теперь клан ведёт {_nick(db, rest['rid'])}", now)
            else:
                db.execute("UPDATE crews SET gone = 1 WHERE id = ?", (crew,))
                war.drop_crew(db, crew)
                gone = True
        if not gone:
            _sys(db, crew, f"🚪 {_nick(db, rid)} вышел из клана", now)
        progress._changed.add(rid)
    return {"ok": True, "disbanded": gone}


def disband(store, rid: str, now: float | None = None) -> dict:
    import progress
    import war
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        _boss(m, deputy_ok=False)
        crew = int(m["crew"])
        rids = [x["rid"] for x in db.execute("SELECT rid FROM crew_mem WHERE crew = ?", (crew,))]
        db.execute("UPDATE crews SET gone = 1 WHERE id = ?", (crew,))
        db.execute("DELETE FROM crew_mem WHERE crew = ?", (crew,))
        db.execute("DELETE FROM crew_req WHERE crew = ?", (crew,))
        war.drop_crew(db, crew)
        progress._changed.update(rids)
    return {"ok": True, "rids": rids}


def invite(store, rid: str, fid: str, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        _boss(m)
        who = _rid_by_fid(db, fid)
        if db.execute("SELECT 1 FROM crew_mem m JOIN crews c ON c.id = m.crew AND c.gone = 0 WHERE m.rid = ?", (who,)).fetchone():
            raise HTTPException(409, "игрок уже в клане")
        db.execute("INSERT OR REPLACE INTO crew_req (crew, rid, kind, at) VALUES (?, ?, 'inv', ?)", (int(m["crew"]), who, int(now)))
    return {"ok": True, "rid": who}


def decide(store, rid: str, fid: str, yes: bool, now: float | None = None) -> dict:
    """Лидер или заместитель отвечает на заявку."""
    import progress
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        _boss(m)
        who = _rid_by_fid(db, fid)
        crew = int(m["crew"])
        if not db.execute("SELECT 1 FROM crew_req WHERE crew = ? AND rid = ? AND kind = 'ask'", (crew, who)).fetchone():
            raise HTTPException(404, "заявки нет")
        db.execute("DELETE FROM crew_req WHERE crew = ? AND rid = ? AND kind = 'ask'", (crew, who))
        if yes:
            try:
                _free(db, who, now)
            except HTTPException:
                raise HTTPException(409, "игрок уже в другом клане или на паузе после ухода") from None
            _join(db, crew, who, now)
            progress._changed.add(who)
    return {"ok": True, "rid": who}


def answer(store, rid: str, crew: int, yes: bool, now: float | None = None) -> dict:
    """Игрок отвечает на приглашение."""
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        inv = db.execute("SELECT at FROM crew_req WHERE crew = ? AND rid = ? AND kind = 'inv'", (crew, rid)).fetchone()
        if not inv:
            raise HTTPException(404, "приглашения нет")
        if not yes or now - int(inv["at"]) >= INV_TTL:
            db.execute("DELETE FROM crew_req WHERE crew = ? AND rid = ? AND kind = 'inv'", (crew, rid))
            return {"ok": not yes, "joined": False, "why": "приглашение истекло" if yes else ""}
    return join(store, rid, crew, now)                   # приглашение снимет сам _join


def set_role(store, rid: str, fid: str, role: str, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    if role not in ROLE_NAME:
        raise HTTPException(400, "role — leader, deputy или member")
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        _boss(m, deputy_ok=False)
        who = _rid_by_fid(db, fid)
        crew = int(m["crew"])
        t = db.execute("SELECT role FROM crew_mem WHERE rid = ? AND crew = ?", (who, crew)).fetchone()
        if not t or who == rid:
            raise HTTPException(404, "это не соклановец")
        if role == "deputy" and t["role"] != "deputy" and db.execute(
                "SELECT count(*) AS n FROM crew_mem WHERE crew = ? AND role = 'deputy'", (crew,)).fetchone()["n"] >= DEPUTY_MAX:
            raise HTTPException(403, f"заместителей не больше {DEPUTY_MAX}")
        if role == "leader":
            db.execute("UPDATE crew_mem SET role = 'deputy' WHERE rid = ?", (rid,))
            db.execute("UPDATE crews SET leader = ? WHERE id = ?", (who, crew))
        db.execute("UPDATE crew_mem SET role = ? WHERE rid = ?", (role, who))
        _sys(db, crew, f"🎖️ {_nick(db, who)} теперь {ROLE_NAME[role]}", now)
    return {"ok": True}


def kick(store, rid: str, fid: str, now: float | None = None) -> dict:
    import progress
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        _boss(m)
        who = _rid_by_fid(db, fid)
        t = db.execute("SELECT role FROM crew_mem WHERE rid = ? AND crew = ?", (who, int(m["crew"]))).fetchone()
        if not t or who == rid:
            raise HTTPException(404, "это не соклановец")
        if t["role"] == "leader" or (t["role"] == "deputy" and m["role"] != "leader"):
            raise HTTPException(403, "заместителя исключает только лидер")
        db.execute("DELETE FROM crew_mem WHERE rid = ?", (who,))
        db.execute("INSERT OR REPLACE INTO crew_left (rid, at) VALUES (?, ?)", (who, int(now)))
        _sys(db, int(m["crew"]), f"🚪 {_nick(db, who)} исключён из клана", now)
        progress._changed.add(who)
    return {"ok": True, "rid": who}


def edit(store, rid: str, body: dict, now: float | None = None) -> dict:
    import progress
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        _boss(m, deputy_ok=False)
        crew = int(m["crew"])
        sets, args = [], []
        name = body.get("name")
        if isinstance(name, str) and name.strip():
            name = re.sub(r"\s+", " ", name.strip())
            if not (3 <= len(name) <= 24) or not re.fullmatch(r"[\w\s\-«»\"'.!]+", name):
                raise HTTPException(400, "название — 3–24 знака")
            why = clean(name)
            if why:
                raise HTTPException(400, why)
            sets.append("name = ?")
            args.append(name)
        for k, n in (("color", len(COLORS)), ("emblem", len(EMBLEMS))):
            v = body.get(k)
            if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < n:
                sets.append(f"{k} = ?")
                args.append(v)
        if body.get("mode") in MODES_JOIN:
            sets.append("mode = ?")
            args.append(body["mode"])
        if sets:
            db.execute(f"UPDATE crews SET {', '.join(sets)} WHERE id = ?", args + [crew])
            progress._changed.update(x["rid"] for x in db.execute("SELECT rid FROM crew_mem WHERE crew = ?", (crew,)))
    return {"ok": True}


def say(store, rid: str, k: str, v, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    if k == "p" and isinstance(v, int) and 0 <= v < len(PRESETS):
        text = PRESETS[v]
    elif k == "e" and isinstance(v, int) and 0 <= v < len(EMOTES):
        text = EMOTES[v]
    elif k == "t" and isinstance(v, str):
        text = re.sub(r"\s+", " ", v).strip()
        if not text or len(text) > TEXT_MAX:
            raise HTTPException(400, f"сообщение — до {TEXT_MAX} знаков")
        why = clean(text)
        if why:
            raise HTTPException(400, why)
    else:
        raise HTTPException(400, "k — p (фраза), e (эмоция) или t (текст)")
    hist = [t for t in _say.get(rid, []) if now - t < SAY_WIN]
    if hist and now - hist[-1] < SAY_EVERY:
        raise HTTPException(429, "не так быстро")
    if len(hist) >= SAY_N:
        raise HTTPException(429, "много сообщений — передохни пару минут")
    hist.append(now)
    _say[rid] = hist
    if len(_say) > 20000:
        _say.clear()
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        crew = int(m["crew"])
        cur = db.execute("INSERT INTO crew_chat (crew, rid, at, k, v) VALUES (?, ?, ?, ?, ?)",
                         (crew, rid, int(now), "t" if k == "t" else k, text))
        _trim_chat(db, crew)
        msg = _msg(db, db.execute("SELECT * FROM crew_chat WHERE id = ?", (cur.lastrowid,)).fetchone())
    return {"ok": True, "msg": msg, "crew": crew}


def _msg(db, r) -> dict:
    import progress
    out = {"id": int(r["id"]), "at": int(r["at"]), "k": r["k"], "v": r["v"]}
    if r["rid"]:
        p = progress.row_of(db, r["rid"])
        cre = db.execute("SELECT creature FROM players WHERE rid = ?", (r["rid"],)).fetchone()
        out.update({"fid": p["fid"], "nick": progress.nick_of(p), "cre": cre["creature"] if cre else None})
    return out


def chat(db, crew: int, after: int = 0, n: int = 50) -> list[dict]:
    rows = db.execute("SELECT * FROM crew_chat WHERE crew = ? AND id > ? ORDER BY id DESC LIMIT ?", (crew, after, n)).fetchall()
    return [_msg(db, r) for r in reversed(rows)]


def give(store, rid: str, amount, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    if not isinstance(amount, int) or isinstance(amount, bool) or not GIVE_MIN <= amount <= GIVE_DAY:
        raise HTTPException(400, f"взнос — от ${GIVE_MIN} до ${GIVE_DAY:,}".replace(",", " "))
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        day = int(now // 86400)
        today = int(m["give_today"]) if int(m["give_day"]) == day else 0
        if today + amount > GIVE_DAY:
            raise HTTPException(429, f"в общак — не больше ${GIVE_DAY:,} в сутки".replace(",", " "))
        money = _honest_money(db, rid)
        if money is not None and money + 1 < amount:
            raise HTTPException(402, "столько наличных нет")
        crew = int(m["crew"])
        db.execute("UPDATE crew_mem SET given = given + ?, give_day = ?, give_today = ? WHERE rid = ?",
                   (amount, day, today + amount, rid))
        db.execute("UPDATE crews SET bank = bank + ?, bank_total = bank_total + ? WHERE id = ?", (amount, amount, crew))
        goal_add(db, rid, "bank", amount, now)
        _sys(db, crew, f"🏦 {_nick(db, rid)} положил ${amount:,} в общак".replace(",", " "), now)
        bank = db.execute("SELECT bank FROM crews WHERE id = ?", (crew,)).fetchone()["bank"]
    return {"ok": True, "paid": amount, "bank": int(bank)}


def set_hq(store, rid: str, city: str, key: str | None, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        _boss(m)
        crew = int(m["crew"])
        if key is None:
            db.execute("""UPDATE crews SET hq_city = NULL, hq_key = NULL, hq_x = NULL, hq_z = NULL, hq_dist = NULL,
                          hq_addr = NULL WHERE id = ?""", (crew,))
            return {"ok": True, "hq": None}
        p = db.execute("""SELECT p.* FROM props p JOIN crew_mem m ON m.rid = p.owner_rid AND m.crew = ?
                          WHERE p.city = ? AND p.bkey = ?""", (crew, city, key)).fetchone()
        if not p:
            raise HTTPException(404, "штаб — только в здании соклановца")
        if p["cls"] != "com" or not int(p["landmark"]):
            raise HTTPException(403, "штаб — в нежилом ориентире (высотка, ТЦ, известное здание), не в жилом доме")
        if HQ_BAD.search(p["addr"] or "") or HQ_BAD.search(p["name"] or ""):
            raise HTTPException(403, "здесь штаб ставить нельзя")
        lvl = db.execute("SELECT hq_lvl FROM crews WHERE id = ?", (crew,)).fetchone()["hq_lvl"]
        db.execute("""UPDATE crews SET hq_city = ?, hq_key = ?, hq_x = ?, hq_z = ?, hq_dist = ?, hq_addr = ?, hq_lvl = ?
                      WHERE id = ?""", (city, key, p["x"], p["z"], p["dist"], p["addr"], max(1, int(lvl or 0)), crew))
        _sys(db, crew, f"🏢 Штаб клана: {p['addr'] or 'здание ' + key}", now)
    return {"ok": True}


def hq_up(store, rid: str, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        _boss(m, deputy_ok=False)
        crew = int(m["crew"])
        c = db.execute("SELECT bank, hq_lvl, hq_key FROM crews WHERE id = ?", (crew,)).fetchone()
        if not c["hq_key"]:
            raise HTTPException(400, "сначала поставь штаб")
        nxt = int(c["hq_lvl"]) + 1
        if nxt not in HQ_COST:
            raise HTTPException(400, "штаб и так максимальный")
        if int(c["bank"]) < HQ_COST[nxt]:
            raise HTTPException(402, f"в общаке не хватает: нужно ${HQ_COST[nxt]:,}".replace(",", " "))
        db.execute("UPDATE crews SET bank = bank - ?, hq_lvl = ? WHERE id = ?", (HQ_COST[nxt], nxt, crew))
        _sys(db, crew, f"🏗️ Штаб улучшен до {nxt}-го уровня", now)
    return {"ok": True, "lvl": nxt}


def help_ask(store, rid: str, city: str, key: str, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        crew = int(m["crew"])
        b = db.execute("SELECT name FROM biz WHERE city = ? AND bkey = ? AND owner_rid = ?", (city, key, rid)).fetchone()
        if not b:
            raise HTTPException(404, "это не твой бизнес")
        db.execute("UPDATE crew_help SET done = 1 WHERE done = 0 AND at < ?", (int(now - HELP_TTL),))
        if db.execute("SELECT 1 FROM crew_help WHERE crew = ? AND city = ? AND bkey = ? AND done = 0",
                      (crew, city, key)).fetchone():
            raise HTTPException(409, "просьба по этому бизнесу уже висит")
        n_today = db.execute("SELECT count(*) AS n FROM crew_help WHERE rid = ? AND at >= ?",
                             (rid, int(now // 86400 * 86400))).fetchone()["n"]
        if n_today >= HELP_ASK_DAY:
            raise HTTPException(429, f"просить помощь — до {HELP_ASK_DAY} раз в сутки")
        n = db.execute("SELECT count(*) AS n FROM crew_mem WHERE crew = ?", (crew,)).fetchone()["n"]
        need = max(1, min(HELP_MAX, int(n) - 1))
        cur = db.execute("INSERT INTO crew_help (crew, rid, city, bkey, name, at, need) VALUES (?, ?, ?, ?, ?, ?, ?)",
                         (crew, rid, city, key, b["name"], int(now), need))
        _sys(db, crew, f"🙏 {_nick(db, rid)} просит помочь: {b['name']}", now)
    return {"ok": True, "id": int(cur.lastrowid), "need": need, "crew": crew}


def help_give(store, rid: str, hid: int, now: float | None = None) -> dict:
    """Помочь соклановцу: его бизнес получает +3 мин выработки (как будто таймер прошёл раньше) и +3% сырья."""
    import progress
    import realty
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        h = db.execute("SELECT * FROM crew_help WHERE id = ? AND crew = ?", (hid, int(m["crew"]))).fetchone()
        if not h or int(h["done"]) or now - int(h["at"]) > HELP_TTL:
            raise HTTPException(404, "просьба уже закрыта")
        if h["rid"] == rid:
            raise HTTPException(403, "себе помочь нельзя — попроси соклановцев")
        who = json.loads(h["who"] or "[]")
        if rid in who:
            raise HTTPException(409, "ты уже помог этой просьбе")
        day = int(now // 86400)
        today = int(m["help_today"]) if int(m["help_day"]) == day else 0
        if today >= HELP_DAY:
            raise HTTPException(429, f"помогать — до {HELP_DAY} раз в сутки")
        b = realty._load_biz(db, h["city"], h["bkey"])
        if not b or b["owner_rid"] != h["rid"]:
            db.execute("UPDATE crew_help SET done = 1 WHERE id = ?", (hid,))
            raise HTTPException(404, "бизнеса больше нет")
        realty._sim(b, now)
        b["sim_at"] = now - HELP_SEC                   # таймер выработки — на 3 минуты вперёд
        b["stock"] = min(100.0, float(b["stock"]) + HELP_STOCK)
        realty._save_biz(db, b)
        who.append(rid)
        got = int(h["got"]) + 1
        db.execute("UPDATE crew_help SET got = ?, who = ?, done = ? WHERE id = ?",
                   (got, json.dumps(who), int(got >= int(h["need"])), hid))
        db.execute("UPDATE crew_mem SET helps = helps + 1, help_day = ?, help_today = ? WHERE rid = ?", (day, today + 1, rid))
        goal_add(db, rid, "help", 1, now)
        x = progress.xp(db, rid, "help", h["city"], now)
        if int(db.execute("SELECT helps FROM crew_mem WHERE rid = ?", (rid,)).fetchone()["helps"]) >= 100:
            r = progress.row_of(db, rid)
            t = progress._js(r["titles"], [])
            if "helper" not in t:
                t.append("helper")
                db.execute("UPDATE prog SET titles = ? WHERE rid = ?", (json.dumps(t), rid))
    return {"ok": True, "got": got, "need": int(h["need"]), "xp": x, "owner": h["rid"]}


def claim(store, rid: str, what: str, credit=None, now: float | None = None) -> dict:
    """Награда: «goal:<цель>» (цель недели выполнена), «all» (все три), «hold» (клан держит районы — раз в неделю)."""
    import progress
    import war
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        m = _me(db, rid)
        crew, wk = int(m["crew"]), week_of(now)
        if db.execute("SELECT 1 FROM crew_claim WHERE crew = ? AND week = ? AND what = ? AND rid = ?",
                      (crew, wk, what, rid)).fetchone():
            raise HTTPException(409, "уже забрал")
        goals = {g["goal"]: g for g in _goals(db, crew, wk)}
        if what.startswith("goal:"):
            g = goals.get(what[5:])
            if not g or not g["done_at"]:
                raise HTTPException(403, "цель ещё не выполнена")
            if int(m["joined"]) > int(g["done_at"]):
                raise HTTPException(403, "награда — тем, кто был в клане к выполнению")
            pay, x = GOAL_PAY, GOAL_XP
        elif what == "all":
            if len(goals) < 3 or not all(g["done_at"] for g in goals.values()):
                raise HTTPException(403, "сначала все три цели недели")
            if int(m["joined"]) > max(int(g["done_at"]) for g in goals.values()):
                raise HTTPException(403, "награда — тем, кто был в клане к выполнению")
            pay, x = ALL_PAY, GOAL_XP
        elif what == "hold":
            n = min(HOLD_MAX, len(war.held_by(db, crew)))
            if not n:
                raise HTTPException(403, "клан пока не держит районов")
            if now - int(m["joined"]) < 86400:
                raise HTTPException(403, "награда за районы — через сутки после вступления")
            pay, x = HOLD_PAY * n, HOLD_XP * n
        else:
            raise HTTPException(400, "what — goal:<цель>, all или hold")
        db.execute("INSERT INTO crew_claim (crew, week, what, rid, at) VALUES (?, ?, ?, ?, ?)", (crew, wk, what, rid, int(now)))
        got = progress.xp(db, rid, "crew", None, now, amount=x)
    if credit:
        credit(rid, pay)
    return {"ok": True, "paid": pay, "xp": got}


# ---------------------------------------------------------------------------------------------------------------
# состояние
# ---------------------------------------------------------------------------------------------------------------
def public_crew(store, crew: int, online=None) -> dict | None:
    import progress
    import war
    with store.lock:
        db = store.db
        ensure_tables(db)
        c = card(db, crew)
        if not c:
            return None
        r = db.execute("SELECT * FROM crews WHERE id = ?", (crew,)).fetchone()
        mem = []
        for x in _members(db, crew):
            p = progress.row_of(db, x["rid"])
            mem.append({"fid": p["fid"], "nick": progress.nick_of(p), "cre": x["creature"], "lvl": int(p["lvl"]),
                        "role": x["role"], "online": bool(online and online(x["rid"]))})
        c.update({"members": mem, "power": power(db, crew), "hq_city": r["hq_city"], "hq_dist": r["hq_dist"],
                  "hq_lvl": int(r["hq_lvl"]), "created": int(r["created_at"]),
                  "districts": [{"city": a, "d": b} for a, b in war.held_by(db, crew)]})
    return c


def state(store, rid: str, online=None, now: float | None = None) -> dict:
    """Всё о своём клане (или приглашения, если клана нет)."""
    import progress
    import war
    now = time.time() if now is None else now
    with store.lock:
        db = store.db
        ensure_tables(db)
        r = progress.row_of(db, rid, now)
        m = db.execute("SELECT m.* FROM crew_mem m JOIN crews c ON c.id = m.crew AND c.gone = 0 WHERE m.rid = ?",
                       (rid,)).fetchone()
        base = {"lvl": int(r["lvl"]), "create_lvl": CREATE_LVL, "create_cost": CREATE_COST, "max": CREW_MAX,
                "presets": PRESETS, "emotes": EMOTES, "colors": ["#%06x" % c for c in COLORS], "emblems": EMBLEMS,
                "goals_def": {k: [v[0], v[1]] for k, v in GOALS.items()}, "hq_cost": HQ_COST, "text_max": TEXT_MAX}
        left = db.execute("SELECT at FROM crew_left WHERE rid = ?", (rid,)).fetchone()
        base["wait"] = max(0, int(LEAVE_WAIT - (now - int(left["at"])))) if left else 0
        if not m:
            inv = db.execute("""SELECT q.crew, q.at FROM crew_req q JOIN crews c ON c.id = q.crew AND c.gone = 0
                                WHERE q.rid = ? AND q.kind = 'inv' AND q.at > ?""", (rid, int(now - INV_TTL))).fetchall()
            asks = [int(x["crew"]) for x in db.execute("SELECT crew FROM crew_req WHERE rid = ? AND kind = 'ask'", (rid,))]
            base.update({"crew": None, "invites": [card(db, int(x["crew"])) for x in inv], "asked": asks})
            return base
        crew = int(m["crew"])
        c = db.execute("SELECT * FROM crews WHERE id = ?", (crew,)).fetchone()
        # штаб продан или ушёл из клана вместе с владельцем — снимаем
        if c["hq_key"] and not db.execute("""SELECT 1 FROM props p JOIN crew_mem mm ON mm.rid = p.owner_rid AND mm.crew = ?
                                             WHERE p.city = ? AND p.bkey = ?""", (crew, c["hq_city"], c["hq_key"])).fetchone():
            db.execute("UPDATE crews SET hq_city = NULL, hq_key = NULL, hq_dist = NULL WHERE id = ?", (crew,))
            c = db.execute("SELECT * FROM crews WHERE id = ?", (crew,)).fetchone()
        mem = []
        for x in _members(db, crew):
            p = progress.row_of(db, x["rid"])
            mem.append({"fid": p["fid"], "nick": progress.nick_of(p), "cre": x["creature"], "lvl": int(p["lvl"]),
                        "role": x["role"], "given": int(x["given"]), "helps": int(x["helps"]), "joined": int(x["joined"]),
                        "me": x["rid"] == rid, "online": bool(online and online(x["rid"])),
                        "seen": int(x["updated_at"]) if x["updated_at"] else None})
        wk = week_of(now)
        goals = []
        claimed = {x["what"] for x in db.execute("SELECT what FROM crew_claim WHERE crew = ? AND week = ? AND rid = ?",
                                                 (crew, wk, rid))}
        for g in _goals(db, crew, wk):
            ic, name, _f = GOALS[g["goal"]]
            goals.append({"id": g["goal"], "icon": ic, "name": name, "prog": round(float(g["prog"])), "need": round(float(g["need"])),
                          "done": bool(g["done_at"]), "claimed": ("goal:" + g["goal"]) in claimed,
                          "can": bool(g["done_at"]) and int(m["joined"]) <= int(g["done_at"] or 0)})
        db.execute("UPDATE crew_help SET done = 1 WHERE done = 0 AND at < ?", (int(now - HELP_TTL),))
        helps = []
        for h in db.execute("SELECT * FROM crew_help WHERE crew = ? AND done = 0 ORDER BY id DESC LIMIT 30", (crew,)):
            p = progress.row_of(db, h["rid"])
            who = json.loads(h["who"] or "[]")
            helps.append({"id": int(h["id"]), "nick": progress.nick_of(p), "fid": p["fid"], "name": h["name"],
                          "city": h["city"], "key": h["bkey"], "got": int(h["got"]), "need": int(h["need"]),
                          "mine": h["rid"] == rid, "helped": rid in who, "at": int(h["at"])})
        asks = []
        if m["role"] in ("leader", "deputy"):
            for q in db.execute("SELECT rid, at FROM crew_req WHERE crew = ? AND kind = 'ask' ORDER BY at", (crew,)):
                p = progress.row_of(db, q["rid"])
                cre = db.execute("SELECT creature FROM players WHERE rid = ?", (q["rid"],)).fetchone()
                asks.append({"fid": p["fid"], "nick": progress.nick_of(p), "lvl": int(p["lvl"]), "cre": cre["creature"] if cre else None})
        day = int(now // 86400)
        held = war.held_by(db, crew)
        base.update({
            "crew": dict(card(db, crew), bank=int(c["bank"]), bank_total=int(c["bank_total"]), power=power(db, crew),
                         hq={"city": c["hq_city"], "key": c["hq_key"], "x": c["hq_x"], "z": c["hq_z"], "dist": c["hq_dist"],
                             "addr": c["hq_addr"], "lvl": int(c["hq_lvl"])} if c["hq_key"] else None,
                         color_i=int(c["color"]), emblem_i=int(c["emblem"]), created=int(c["created_at"])),
            "role": m["role"], "members": mem, "goals": goals, "all_claimed": "all" in claimed,
            "hold_claimed": "hold" in claimed, "held": [{"city": a, "d": b} for a, b in held],
            "hold_pay": HOLD_PAY * min(HOLD_MAX, len(held)), "helps": helps, "asks": asks,
            "help_today": int(m["help_today"]) if int(m["help_day"]) == day else 0, "help_day": HELP_DAY,
            "give_today": int(m["give_today"]) if int(m["give_day"]) == day else 0, "give_day": GIVE_DAY,
            "chat": chat(db, crew), "goal_pay": GOAL_PAY, "all_pay": ALL_PAY})
        return base


def rids_of(store, crew: int) -> list[str]:
    with store.lock:
        ensure_tables(store.db)
        return [x["rid"] for x in store.db.execute("SELECT rid FROM crew_mem WHERE crew = ?", (crew,))]


def browse(store, q: str = "", n: int = 30) -> list[dict]:
    with store.lock:
        db = store.db
        ensure_tables(db)
        if q:
            key = tag_key(q.strip())[:24]
            rows = db.execute("""SELECT id FROM crews WHERE gone = 0 AND (tag_key LIKE ? OR lower(name) LIKE ?) LIMIT 50""",
                              (key + "%", "%" + q.strip().lower()[:24] + "%")).fetchall()
            ids = [int(x["id"]) for x in rows]
        else:
            ids = [int(x["id"]) for x in db.execute("SELECT id FROM crews WHERE gone = 0")]
        out = [dict(card(db, i), power=power(db, i)) for i in ids]
    out = [x for x in out if x]
    out.sort(key=lambda x: -x["power"])
    return out[:n]


# ---------------------------------------------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------------------------------------------
def make_router(get_store, verify, read_body, modes_obj=None, push=None, online=None, changed=None) -> APIRouter:
    """push(rids, msg) — async: кадр соклановцам в онлайне; online(rid) → bool; changed(rids) — async: тег над головой."""
    import progress
    r = APIRouter()
    credit = getattr(modes_obj, "credit", None)
    debit = getattr(modes_obj, "debit", None)                # основание и взнос клиент списывает сам — долгом (H-2)
    acted: dict[str, float] = {}

    async def who(body: dict) -> str:
        rid = await verify(body.get("token") or "")
        if not rid:
            raise HTTPException(401, "войди своим агентом — клан держится за ним")
        return rid

    def throttle(rid: str) -> None:
        now = time.monotonic()
        if now - acted.get(rid, -1e9) < ACT_EVERY:
            raise HTTPException(429, "не так быстро")
        acted[rid] = now
        if len(acted) > 30000:
            acted.clear()

    async def after(crew: int | None = None, msg: dict | None = None, extra: list[str] | None = None) -> None:
        ch = progress.take_changed()
        if ch and changed:
            await changed(ch)
        if push and crew and msg:
            rids = await asyncio.to_thread(rids_of, get_store(), crew)
            await push(rids + (extra or []), msg)

    def st():
        s = get_store()
        ensure(s)
        return s

    def crew_id_of(rid: str) -> int | None:
        s = st()
        with s.lock:
            c = crew_of(s.db, rid)
        return int(c["id"]) if c else None

    @r.post("/g/crew/me")
    async def me(request: Request):
        body = await read_body(request)
        rid = await who(body)
        return await asyncio.to_thread(state, st(), rid, online)

    @r.get("/g/crews")
    async def crews_list(resp: Response, q: str = ""):
        resp.headers["Cache-Control"] = "public, max-age=20"
        return {"crews": await asyncio.to_thread(browse, st(), q[:24])}

    @r.get("/g/crew")
    async def crew_get(resp: Response, id: int = 0):
        c = await asyncio.to_thread(public_crew, st(), id, online)
        if not c:
            raise HTTPException(404, "клана нет")
        resp.headers["Cache-Control"] = "public, max-age=20"
        return c

    @r.post("/g/crew/create")
    async def c_create(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        col, emb = body.get("color"), body.get("emblem")
        out = await asyncio.to_thread(create, st(), rid, body.get("tag") or "", body.get("name") or "",
                                      col if isinstance(col, int) else 0, emb if isinstance(emb, int) else 0,
                                      body.get("mode") or "req")
        if debit:
            await asyncio.to_thread(debit, rid, out["cost"])
        await after()
        return out

    @r.post("/g/crew/join")
    async def c_join(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        cid = body.get("id")
        if not isinstance(cid, int):
            raise HTTPException(400, "id — клан")
        out = await asyncio.to_thread(join, st(), rid, cid)
        await after(cid, {"t": "crew", "e": "join" if out.get("joined") else "ask"})
        return out

    @r.post("/g/crew/leave")
    async def c_leave(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        cid = await asyncio.to_thread(crew_id_of, rid)
        out = await asyncio.to_thread(leave, st(), rid)
        await after(cid, {"t": "crew", "e": "members"})
        return out

    @r.post("/g/crew/disband")
    async def c_disband(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        out = await asyncio.to_thread(disband, st(), rid)
        if push:
            await push(out.pop("rids", []), {"t": "crew", "e": "gone"})
        await after()
        return out

    @r.post("/g/crew/invite")
    async def c_invite(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        out = await asyncio.to_thread(invite, st(), rid, body.get("fid"))
        if push:
            await push([out.pop("rid")], {"t": "crew", "e": "invite"})
        return out

    @r.post("/g/crew/decide")
    async def c_decide(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        out = await asyncio.to_thread(decide, st(), rid, body.get("fid"), body.get("yes") is True)
        await after(await asyncio.to_thread(crew_id_of, rid), {"t": "crew", "e": "members"}, [out.pop("rid")])
        return out

    @r.post("/g/crew/answer")
    async def c_answer(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        cid = body.get("id")
        if not isinstance(cid, int):
            raise HTTPException(400, "id — клан")
        out = await asyncio.to_thread(answer, st(), rid, cid, body.get("yes") is True)
        await after(cid if out.get("joined") else None, {"t": "crew", "e": "members"})
        return out

    @r.post("/g/crew/role")
    async def c_role(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        out = await asyncio.to_thread(set_role, st(), rid, body.get("fid"), body.get("role"))
        await after(await asyncio.to_thread(crew_id_of, rid), {"t": "crew", "e": "members"})
        return out

    @r.post("/g/crew/kick")
    async def c_kick(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        out = await asyncio.to_thread(kick, st(), rid, body.get("fid"))
        await after(await asyncio.to_thread(crew_id_of, rid), {"t": "crew", "e": "members"}, [out.pop("rid")])
        return out

    @r.post("/g/crew/edit")
    async def c_edit(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        out = await asyncio.to_thread(edit, st(), rid, body)
        await after(await asyncio.to_thread(crew_id_of, rid), {"t": "crew", "e": "edit"})
        return out

    @r.post("/g/crew/say")
    async def c_say(request: Request):
        body = await read_body(request)
        rid = await who(body)
        out = await asyncio.to_thread(say, st(), rid, body.get("k"), body.get("v"))
        await after(out.pop("crew"), {"t": "crew", "e": "chat", "m": out["msg"]})
        return out

    @r.post("/g/crew/chat")
    async def c_chat(request: Request):
        body = await read_body(request)
        rid = await who(body)
        a = body.get("after")
        a = a if isinstance(a, int) and a >= 0 else 0

        def run():
            s = st()
            with s.lock:
                c = crew_of(s.db, rid)
                if not c:
                    raise HTTPException(404, "ты не в клане")
                return {"chat": chat(s.db, int(c["id"]), a)}
        return await asyncio.to_thread(run)

    @r.post("/g/crew/give")
    async def c_give(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        out = await asyncio.to_thread(give, st(), rid, body.get("amount"))
        if debit:
            await asyncio.to_thread(debit, rid, out["paid"])
        await after(await asyncio.to_thread(crew_id_of, rid), {"t": "crew", "e": "bank", "bank": out["bank"]})
        return out

    @r.post("/g/crew/hq")
    async def c_hq(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        city, key = body.get("city"), body.get("key")
        if body.get("clear") is True:
            key = None
        elif city not in ("flame", "minsk") or not isinstance(key, str) or len(key) > 24:
            raise HTTPException(400, "city и key — здание")
        out = await asyncio.to_thread(set_hq, st(), rid, city or "flame", key)
        await after(await asyncio.to_thread(crew_id_of, rid), {"t": "crew", "e": "hq"})
        return out

    @r.post("/g/crew/hqup")
    async def c_hqup(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        out = await asyncio.to_thread(hq_up, st(), rid)
        await after(await asyncio.to_thread(crew_id_of, rid), {"t": "crew", "e": "hq"})
        return out

    @r.post("/g/crew/help/ask")
    async def c_help_ask(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        city, key = body.get("city"), body.get("key")
        if city not in ("flame", "minsk") or not isinstance(key, str) or len(key) > 24:
            raise HTTPException(400, "city и key — бизнес")
        out = await asyncio.to_thread(help_ask, st(), rid, city, key)
        await after(out.pop("crew"), {"t": "crew", "e": "help", "id": out["id"]})
        return out

    @r.post("/g/crew/help/give")
    async def c_help_give(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        hid = body.get("id")
        if not isinstance(hid, int):
            raise HTTPException(400, "id — просьба")
        out = await asyncio.to_thread(help_give, st(), rid, hid)
        if push:
            nick = await asyncio.to_thread(_locked_nick, st(), rid)
            await push([out.pop("owner")], {"t": "crew", "e": "helped", "nick": nick, "got": out["got"], "need": out["need"]})
        await after()
        return out

    @r.post("/g/crew/claim")
    async def c_claim(request: Request):
        body = await read_body(request)
        rid = await who(body)
        throttle(rid)
        what = body.get("what")
        if not isinstance(what, str) or len(what) > 16:
            raise HTTPException(400, "what — награда")
        out = await asyncio.to_thread(claim, st(), rid, what, credit)
        await after()
        return out

    return r


def _locked_nick(store, rid: str) -> str:
    with store.lock:
        return _nick(store.db, rid)
