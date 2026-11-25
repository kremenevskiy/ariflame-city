"""Ник игрока — как его зовут в городе (25.11.2026).

Задача: «при старте писать свой юзернейм, как-то называть себя, и потом его можно было изменить — чтобы тебя было видно
другим, не «Гость»». Ник выбирает сам игрок (гость и вошедший): он над головой у других, в «Онлайн», на карте, в друзьях,
комнатах режимов, рейтингах, клане и таблицах гонок. Нет своего ника — как раньше: у вошедшего ник из «Рейтинга»
(progress.nick_of: слово + число), у гостя — «Гость».

Хранение: таблица nicks по rid — у вошедшего переживает перезагрузку и смену устройства; у гостя запись по его id «g-…»
(клиент держит копию в localStorage и шлёт её в hi: пустую запись сервер заполняет ею после той же проверки). Гостевые
записи без смен дольше GUEST_TTL стираются (как сессии старше 60 дней).

Проверка — только здесь, клиенту не верим: NFKC, пробелы схлопнуты и обрезаны, 2–20 знаков, буквы (кириллица и латиница),
цифры, пробел и «_-.», хотя бы одна буква; без ссылок, @ и телефонов; занятые игрой имена (RESERVED — Макс, Патруль «Щит»,
админ и модератор, имя проекта) — без учёта регистра, похожих латинских букв и транслита; мат и политика — тот же фильтр,
что у чата клана (crews.clean), своего списка слов нет. Смена — не чаще раза в EVERY с и не больше DAY_N в сутки (по
UTC+3, как потолки опыта). Одинаковые ники разрешены: ник — подпись, не адрес; rid наружу не уходит.

Связь: сокет — hi.nick (копия с устройства), welcome.name (что записано), кадр {t:"nick", nick} → {t:"nick", ok, nick |
why, wait?}; соседи получают новый ник в meta (app.py сбрасывает им «известность»).
"""
from __future__ import annotations

import re
import time
import unicodedata

NICK_MIN, NICK_MAX = 2, 20
EVERY = 30.0                  # секунд между сменами
DAY_N = 10                    # смен в сутки
TZ = 3 * 3600                 # сутки — по Минску/Москве, как в progress.py
GUEST_TTL = 60 * 86400

# Кириллица (с белорусскими і/ў и украинскими ї/є/ґ), латиница, цифры, пробел, «_-.»
ALLOWED = re.compile(r"[A-Za-z0-9Ѐ-џҐґ _.\-]+")
LETTER = re.compile(r"[A-Za-zЀ-џҐґ]")
# домены в нике («name.gg», «shop.ru»): «Mr.Bean» и «А.Пушкин» — можно; t.me, www., телефоны и @ ловит crews.clean
DOMAIN = re.compile(r"[a-z0-9]\.(com|ru|by|net|org|io|me|su|xyz|gg|cc|tv|co|app|fun|ly|to|be|ua|kz|pro|info|site|"
                    r"online|shop|link|top|dev|uk|de|pl|ws|biz|club|live|store|space)\b", re.I)
# Имена, которые носит сама игра. Целиком (после снятия пробелов, «_-.» и цифр): «Макс 2» — нельзя, «Максим» — можно.
RESERVED = ["Макс", "Max", "Патруль", "Patrul", "Щит", "Shchit"]
# Служебные — нигде внутри ника: «SuperAdmin», «Модератор Влад», «ariflame_fan».
STAFF = ["Админ", "Admin", "Модератор", "Moderator", "Ariflame", "Арифлейм", "Флейм-Сити", "FlameCity"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS nicks (
    rid TEXT PRIMARY KEY, nick TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0, day INTEGER NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
"""


def _forms(text: str) -> set[str]:
    """Все написания одного слова: без пробелов и знаков, похожие латинские буквы → русские, транслит, без повторов
    (crews._forms — те же правила, что у фильтра чата)."""
    import crews
    return set(crews._forms(re.sub(r"[\s_.\-]", "", text)))


_RES: list[set[str]] = []
_STAFF: list[str] = []


def _reserved_sets() -> tuple[list[set[str]], list[str]]:
    if not _RES:
        _RES.extend(_forms(x) for x in RESERVED)
        for x in STAFF:
            _STAFF.extend(f for f in _forms(x) if len(f) >= 4)
    return _RES, _STAFF


def reserved(nick: str) -> bool:
    res, staff = _reserved_sets()
    forms = _forms(nick) | _forms(re.sub(r"\d", "", nick))      # «Макс2» и «Макс 007» — тоже Макс; «0» как «о» — тоже
    if any(forms & r for r in res):
        return True
    # служебное слово — в начале или в конце ника либо отдельным словом: «SuperAdmin», «Admin_Vlad», «Влад модератор»;
    # в середине слова — нет («Бадминтон»)
    for part in [nick] + [p for p in re.split(r"[\s_.\-]+", nick) if p]:
        for f in _forms(part) | _forms(re.sub(r"\d", "", part)) | _forms(part.replace("1", "i")):
            if any(f.startswith(s) or f.endswith(s) for s in staff):
                return True
    return False


def check(text) -> tuple[str | None, str | None]:
    """(ник, None) — можно; (None, почему) — нельзя. Почему — короткая фраза для игрока."""
    if not isinstance(text, str):
        return None, "Ник — строка"
    s = unicodedata.normalize("NFKC", text)
    s = "".join(ch for ch in s if unicodedata.category(ch)[0] != "C" or ch.isspace())   # невидимые и управляющие
    s = re.sub(r"\s+", " ", s).strip()
    if not NICK_MIN <= len(s) <= NICK_MAX:
        return None, f"Ник — от {NICK_MIN} до {NICK_MAX} знаков"
    if not ALLOWED.fullmatch(s):
        return None, "Только буквы, цифры, пробел и _ - ."
    if not LETTER.search(s):
        return None, "Нужна хотя бы одна буква"
    if DOMAIN.search(s):
        return None, "Без ссылок, @ и телефонов"
    import crews
    why = crews.clean(s)
    if why:
        return None, "Без ссылок, @ и телефонов" if why.startswith("без ссылок") else why[0].upper() + why[1:]
    if reserved(s):
        return None, "Это имя занято игрой — выбери другое"
    return s, None


# ---------------------------------------------------------------------------------------------------------------
# база (db — под store.lock у вызывающего)
# ---------------------------------------------------------------------------------------------------------------
def ensure(db) -> None:
    db.executescript(SCHEMA)
    db.execute("DELETE FROM nicks WHERE rid LIKE 'g-%' AND updated_at < ?", (int(time.time()) - GUEST_TTL,))


def get(db, rid: str) -> str | None:
    if not rid:
        return None
    r = db.execute("SELECT nick FROM nicks WHERE rid = ?", (rid,)).fetchone()
    return r["nick"] if r else None


def _day(now: float) -> int:
    return int((now + TZ) // 86400)


def change(db, rid: str, text, now: float | None = None) -> dict:
    """Сменить ник: {ok, nick, changed} или {ok: False, why, wait?}. Тот же ник ещё раз — не смена (лимиты не тратит)."""
    now = time.time() if now is None else now
    nick, why = check(text)
    if not nick:
        return {"ok": False, "why": why}
    r = db.execute("SELECT * FROM nicks WHERE rid = ?", (rid,)).fetchone()
    if r and r["nick"] == nick:
        return {"ok": True, "nick": nick, "changed": False}
    day = _day(now)
    if r:
        wait = EVERY - (now - int(r["at"]))
        if wait > 0:
            return {"ok": False, "why": f"Ник можно менять раз в {int(EVERY)} секунд", "wait": int(wait) + 1}
        if int(r["day"]) == day and int(r["n"]) >= DAY_N:
            return {"ok": False, "why": "На сегодня хватит — сменить ник можно завтра"}
    n = int(r["n"]) + 1 if r and int(r["day"]) == day else 1
    db.execute("""INSERT INTO nicks (rid, nick, at, day, n, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(rid) DO UPDATE SET nick = excluded.nick, at = excluded.at, day = excluded.day, n = excluded.n,
                    updated_at = excluded.updated_at""", (rid, nick, int(now), day, n, int(now)))
    return {"ok": True, "nick": nick, "changed": True}


def on_hi(db, rid: str, text) -> str | None:
    """Ник при входе в онлайн: записанный; нет записи — копия с устройства (hi.nick), если проходит проверку. Копия с
    устройства лимиты смен не тратит: это не смена, а перенос (гость вошёл в аккаунт, база гостей почищена)."""
    cur = get(db, rid)
    if cur or text is None:
        return cur
    nick, _why = check(text)
    if not nick:
        return None
    now = int(time.time())
    db.execute("INSERT OR IGNORE INTO nicks (rid, nick, at, day, n, updated_at) VALUES (?, ?, 0, 0, 0, ?)", (rid, nick, now))
    return get(db, rid)


def shown(db, rid: str) -> str | None:
    """Как игрока видят другие, когда его нет в онлайне (друзья): свой ник, иначе ник из «Рейтинга», иначе None."""
    n = get(db, rid)
    if n:
        return n
    r = db.execute("SELECT * FROM prog WHERE rid = ?", (rid,)).fetchone() if _has_prog(db) else None
    if not r:
        return None
    import progress
    return progress.nick_of(r)


def _has_prog(db) -> bool:
    return bool(db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prog'").fetchone())
