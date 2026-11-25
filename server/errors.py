"""Ошибки у игроков (25.11.2026, слово владельца: «чтобы все баги — с телефонов, из браузера, сервера — нам приходили,
и мы понимали, у кого что ломается, кто завис, что не прорисовалось»).

Клиент (client/ferr.js) ловит падения кода, незагрузившиеся файлы, потерю WebGL, зависания, долгий старт и
«невозможные» состояния игры и шлёт их сюда пачками; сервер сам пишет сюда свои необработанные исключения (app.py).
Храним сводку по «отпечатку» (вид + сообщение без чисел + первая строка стека): сколько раз, сколько сессий, на каких
версиях и устройствах, последний пример целиком — и кольцо последних 1000 событий для подробностей.
Никаких аккаунтов, ников, rid и токенов: контекст — версия, город, качество, телефон/компьютер, браузер, экран,
режим игрока (пешком/в машине), позиция с шагом 50 м.

  POST /g/err                {sid, items: [{kind, msg, stack?, src?, line?, at?, ctx?, n?}]} → 204 / 400 / 413 / 429
  GET  /g/admin/errors       X-Admin-Key → сводка: свежие сверху (?hours=24&limit=100&kind=)
  GET  /g/admin/errors/<fp>  X-Admin-Key → последние события этого отпечатка
Лимиты: тело ≤ 32 КБ, в пачке ≤ 20; на сессию — 60 событий в час, на весь сервер — 20 000 в сутки.

Подключает app.py: `app.include_router(errors.make_router(db, fcmodes.admin_key))`; `errors.record_server(store, …)`.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request, Response

BODY_MAX = 32 * 1024
ITEMS_MAX = 20
SID_N, SID_WIN = 60, 3600.0
TOTAL_N, TOTAL_WIN = 20000, 86400.0
RECENT_KEEP = 1000
KINDS = {"js", "promise", "console", "load", "webgl", "freeze", "lowfps", "start", "state", "server"}

_sid_hits: dict[str, deque] = {}
_total: deque = deque()

SCHEMA = """
CREATE TABLE IF NOT EXISTS err_fp (
    fp TEXT PRIMARY KEY, kind TEXT NOT NULL, msg TEXT NOT NULL, top TEXT,
    first INTEGER NOT NULL, last INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, sessions INTEGER NOT NULL DEFAULT 0,
    versions TEXT, devices TEXT, sample TEXT
);
CREATE INDEX IF NOT EXISTS err_fp_last ON err_fp (last DESC);
CREATE TABLE IF NOT EXISTS err_recent (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, fp TEXT NOT NULL, sid TEXT, item TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS err_recent_fp ON err_recent (fp, id DESC);
CREATE TABLE IF NOT EXISTS err_seen (fp TEXT NOT NULL, sid TEXT NOT NULL, PRIMARY KEY (fp, sid));
"""


def _clip(v, n: int) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(v if v is not None else ""))[:n]


def _norm(msg: str) -> str:
    """Сообщение без изменчивого: адреса — до пути, числа — N, длинные id — X (одна ошибка = один отпечаток)."""
    m = re.sub(r"https?://[^\s'\")]+", lambda x: re.sub(r"[?#].*", "", x.group(0)), msg)
    m = re.sub(r"\b[0-9a-f]{12,}\b", "X", m)
    m = re.sub(r"\d+(\.\d+)?", "N", m)
    return m[:200]


def _top(stack: str) -> str:
    """Место падения в нашем коде (файл:строка) — без адреса сайта. Стек браузера — первая строка с файлом; трейсбек
    Python — самый глубокий кадр не из библиотек (site-packages)."""
    py = re.findall(r'File "([^"]+)", line (\d+)', stack or "")
    if py:
        own = [f for f in py if "site-packages" not in f[0] and "/lib/python" not in f[0]] or py
        return f"{own[-1][0].rsplit('/', 1)[-1]}:{own[-1][1]}"
    for line in (stack or "").splitlines():
        m = re.search(r"([\w.-]+\.(?:js|py))(?:\?[^:\s)]*)?:(\d+)", line)
        if m:
            return f"{m.group(1)}:{m.group(2)}"
    return ""


def fingerprint(kind: str, msg: str, stack: str) -> str:
    return hashlib.sha1(f"{kind}|{_norm(msg)}|{_top(stack)}".encode()).hexdigest()[:16]


def _limit(sid: str, n: int) -> bool:
    now = time.time()
    while _total and now - _total[0] > TOTAL_WIN:
        _total.popleft()
    q = _sid_hits.setdefault(sid, deque())
    while q and now - q[0] > SID_WIN:
        q.popleft()
    if len(q) + n > SID_N or len(_total) + n > TOTAL_N:
        return False
    for _ in range(n):
        q.append(now)
        _total.append(now)
    if len(_sid_hits) > 20000:
        for k in [k for k, v in _sid_hits.items() if not v or now - v[-1] > SID_WIN][:10000]:
            _sid_hits.pop(k, None)
    return True


def _clean_ctx(c) -> dict:
    if not isinstance(c, dict):
        return {}
    out = {}
    for k, v in list(c.items())[:24]:
        k = _clip(k, 16)
        if isinstance(v, bool) or v is None or (isinstance(v, (int, float)) and abs(v) < 1e9):
            out[k] = v
        elif isinstance(v, str):
            out[k] = _clip(v, 120)
        elif isinstance(v, list) and len(v) <= 4 and all(isinstance(x, (int, float)) for x in v):
            out[k] = v
    return out


def ensure(store) -> None:
    with store.lock:
        store.db.executescript(SCHEMA)


def record(store, sid: str, it: dict) -> str:
    """Одно событие в сводку и кольцо; вернуть отпечаток."""
    kind = it["kind"]
    fp = fingerprint(kind, it["msg"], it.get("stack", ""))
    now = int(time.time())
    ctx = it.get("ctx") or {}
    dev = "tg" if ctx.get("tg") else ("phone" if ctx.get("phone") else "desktop")
    ver = _clip(ctx.get("v") or "?", 12)
    n = max(1, min(int(it.get("n") or 1), 1000))
    with store.lock:
        r = store.db.execute("SELECT versions, devices FROM err_fp WHERE fp = ?", (fp,)).fetchone()
        vers = json.loads(r["versions"]) if r and r["versions"] else []
        devs = json.loads(r["devices"]) if r and r["devices"] else {}
        if ver not in vers:
            vers = (vers + [ver])[-5:]
        devs[dev] = devs.get(dev, 0) + n
        new_sid = store.db.execute("INSERT OR IGNORE INTO err_seen (fp, sid) VALUES (?, ?)", (fp, sid)).rowcount
        sample = json.dumps(it, ensure_ascii=False)[:6000]
        store.db.execute("""INSERT INTO err_fp (fp, kind, msg, top, first, last, n, sessions, versions, devices, sample)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(fp) DO UPDATE SET last = excluded.last, n = err_fp.n + excluded.n,
                              sessions = err_fp.sessions + excluded.sessions, versions = excluded.versions,
                              devices = excluded.devices, sample = excluded.sample""",
                         (fp, kind, it["msg"][:300], _top(it.get("stack", "")), now, now, n, new_sid,
                          json.dumps(vers), json.dumps(devs), sample))
        store.db.execute("INSERT INTO err_recent (at, fp, sid, item) VALUES (?, ?, ?, ?)", (now, fp, sid, sample))
        store.db.execute("DELETE FROM err_recent WHERE id <= (SELECT max(id) FROM err_recent) - ?", (RECENT_KEEP,))
    return fp


_srv_last: dict[str, list] = {}     # (место, тип) → [когда писали, сколько пропустили] — падение в каждом кадре не льёт базу


def record_server(store, route: str, exc: BaseException, tb: str) -> None:
    """Необработанное исключение сервера — туда же, вид «server» (сессия — «server»). Одно и то же — не чаще раза в 10 с,
    пропущенные дописываются счётчиком к следующей записи. Трейсбек — хвост (самые глубокие кадры и само исключение)."""
    key = f"{route}|{type(exc).__name__}"
    now = time.time()
    last = _srv_last.setdefault(key, [0.0, 0])
    if now - last[0] < 10:
        last[1] += 1
        return
    n, last[0], last[1] = last[1] + 1, now, 0
    try:
        record(store, "server", {"kind": "server", "msg": f"{type(exc).__name__}: {_clip(exc, 240)}", "n": n,
                                 "stack": _clip(tb[-1500:], 1500), "src": _clip(route, 120), "ctx": {"v": "server"}})
    except Exception:  # noqa: BLE001 — запись ошибки не должна ронять ответ
        pass


def make_router(db, admin_key) -> APIRouter:
    """db() → Store (app.py), admin_key() → ключ админ-ручек (modes.admin_key)."""
    rt = APIRouter()
    ready = {"ok": False}

    def store():
        st = db()
        if not ready["ok"]:
            ensure(st)
            ready["ok"] = True
        return st

    def need_admin(request: Request) -> None:
        key = admin_key()
        got = request.headers.get("x-admin-key") or ""
        if not key or not secrets.compare_digest(got, key):
            raise HTTPException(404, "Not Found")

    @rt.post("/g/err", status_code=204)
    async def report(request: Request):
        raw = await request.body()
        if len(raw) > BODY_MAX:
            raise HTTPException(413, "too large")
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            raise HTTPException(400, "bad json") from None
        if not isinstance(body, dict) or not isinstance(body.get("items"), list):
            raise HTTPException(400, "items")
        sid = _clip(body.get("sid"), 24)
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,24}", sid):
            raise HTTPException(400, "sid")
        items = []
        for it in body["items"][:ITEMS_MAX]:
            if not isinstance(it, dict) or it.get("kind") not in KINDS - {"server"}:
                continue
            msg = _clip(it.get("msg"), 300)
            if not msg:
                continue
            items.append({"kind": it["kind"], "msg": msg, "stack": _clip(it.get("stack"), 1500), "src": _clip(it.get("src"), 200),
                          "line": it.get("line") if isinstance(it.get("line"), int) else None,
                          "at": it.get("at") if isinstance(it.get("at"), (int, float)) else None,
                          "n": it.get("n") if isinstance(it.get("n"), int) else 1, "ctx": _clean_ctx(it.get("ctx"))})
        if not items:
            return Response(status_code=204)
        if not _limit(sid, len(items)):
            raise HTTPException(429, "slow down")
        st = store()
        for it in items:
            record(st, sid, it)
        return Response(status_code=204)

    @rt.get("/g/admin/errors")
    def summary(request: Request, hours: float = 24, limit: int = 100, kind: str = ""):
        need_admin(request)
        since = int(time.time() - max(0.1, min(hours, 24 * 90)) * 3600)
        q = "SELECT fp, kind, msg, top, first, last, n, sessions, versions, devices FROM err_fp WHERE last >= ?"
        args: list = [since]
        if kind:
            q += " AND kind = ?"
            args.append(kind)
        q += " ORDER BY sessions DESC, n DESC LIMIT ?"
        args.append(max(1, min(limit, 500)))
        st = store()
        with st.lock:
            rows = st.db.execute(q, args).fetchall()
        return {"since": since, "items": [{**dict(r), "versions": json.loads(r["versions"] or "[]"),
                                           "devices": json.loads(r["devices"] or "{}")} for r in rows]}

    @rt.get("/g/admin/errors/{fp}")
    def detail(fp: str, request: Request, limit: int = 20):
        need_admin(request)
        if not re.fullmatch(r"[0-9a-f]{16}", fp):
            raise HTTPException(404, "Not Found")
        st = store()
        with st.lock:
            head = st.db.execute("SELECT * FROM err_fp WHERE fp = ?", (fp,)).fetchone()
            rows = st.db.execute("SELECT at, sid, item FROM err_recent WHERE fp = ? ORDER BY id DESC LIMIT ?",
                                 (fp, max(1, min(limit, 100)))).fetchall()
        if not head:
            raise HTTPException(404, "Not Found")
        return {"head": {**dict(head), "sample": json.loads(head["sample"] or "{}")},
                "recent": [{"at": r["at"], "sid": r["sid"], "item": json.loads(r["item"])} for r in rows]}

    return rt
