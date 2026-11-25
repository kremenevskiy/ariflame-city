"""Письма тем, кто прислал правку с сайта (25.11.2026, слово владельца: «чтобы люди знали, кто законтрибьютил»).

По желанию человек оставляет на contribute.html почту — и получает письмо, когда правка стала pull request, когда её
приняли, когда она уже в городе, или когда её отклонили. Почта необязательна, нигде не показывается и стирается после
последнего письма.

Почта лежит только здесь, в SQLite (contrib_mail), отдельно от очереди правок: JSON правки из папки contrib/ целиком
уходит в GitHub Actions (contrib-intake.yml), поэтому адресу там не место — по построению, а не фильтром на выходе.
Письма на отправку — таблица contrib_outbox: игровой сервер их только складывает (у контейнера игры нет интернета),
отправляет tools/deploy/city-mail.sh с хоста через Resend и отмечает отправленным.

  GET  /g/admin/contrib/outbox              X-Admin-Key → {items: [{mid, cid, status, to, subject, text, html, created}]}
  POST /g/admin/contrib/outbox/<mid>/sent   X-Admin-Key, {result?: sent | bounced} → {ok, erased}

Сроки: адрес стирается, как только ушло письмо об окончательном статусе (live / rejected / closed) или письмо не
дошло (bounced); у каждого отправленного письма адрес стирается сразу. Письмо, которое не отправили за OUTBOX_TTL, —
выбрасывается (с адресом, если статус окончательный); адрес правки, так и не дошедшей до конца, живёт не дольше
MAIL_KEEP. Чтобы чужой адрес не завалили письмами: на один адрес — не больше MAIL_N правок с письмами в сутки, ссылки
из названия и ника в письмо не попадают.

Подключает contrib.make_router: `contribmail.make_router(store, admin_key)` и `remember` / `enqueue` из contrib.py.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import secrets
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request

EMAIL_MAX = 120
MAIL_N, MAIL_WIN = 5, 86400.0     # правок с письмами на один адрес за сутки (дальше правка принимается, но без писем)
OUTBOX_TTL = 14 * 86400           # письмо, которое не отправили за две недели, — выбрасываем
MAIL_KEEP = 180 * 86400           # адрес правки без окончательного статуса — не дольше полугода
SENT_KEEP = 30 * 86400            # отправленные (уже без адреса) — для разбора, потом удаляем
OUTBOX_PAGE = 50

NOTIFY = ("pr", "merged", "live", "rejected", "closed")
FINAL = ("live", "rejected", "closed")
RESULTS = ("sent", "bounced")

# строго и только латиницей: почтовые сервисы игроков — gmail/yandex/mail.ru; «%», кавычки, пробелы, запятые и
# несколько «@» не пропускаем — адрес уходит в API отправки, второго получателя туда не подсунуть
EMAIL_RE = re.compile(r"[a-z0-9_](?:[a-z0-9._+-]{0,62}[a-z0-9_-])?"
                      r"@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{1,59})")

SCHEMA = """
CREATE TABLE IF NOT EXISTS contrib_mail (
    cid TEXT PRIMARY KEY, email TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contrib_outbox (
    mid INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, status TEXT NOT NULL, rcpt TEXT,
    subject TEXT NOT NULL, text TEXT NOT NULL, html TEXT NOT NULL,
    created INTEGER NOT NULL, done INTEGER, result TEXT,
    UNIQUE (cid, status)
);
CREATE INDEX IF NOT EXISTS contrib_outbox_wait ON contrib_outbox (done, mid);
"""

_mail_hits: dict[str, deque] = {}


def site() -> str:
    return (os.environ.get("FC_SITE") or "https://city.ariflame.com").strip().rstrip("/")


def clean_email(v) -> str:
    """Почта из формы: пусто — "", иначе адрес строчными или HTTPException(400)."""
    if v is None or v == "":
        return ""
    if not isinstance(v, str):
        raise HTTPException(400, "почта — строка")
    e = v.strip().lower()
    if not e:
        return ""
    if len(e) > EMAIL_MAX or ".." in e or not EMAIL_RE.fullmatch(e):
        raise HTTPException(400, "почта: похоже, в адресе ошибка — нужен вид name@example.com, латиницей")
    return e


def mask(e: str) -> str:
    """v***@gmail.com — для журналов."""
    local, _, dom = (e or "").partition("@")
    return (local[:1] or "?") + "***@" + (dom or "?")


def _plain(s, n: int) -> str:
    """Чужой текст в письмо: одной строкой, без ссылок (письмо не должно стать рассылкой чужих адресов)."""
    s = " ".join(str(s or "").split())
    s = re.sub(r"(?i)\b(?:https?://|www\.)\S+", "…", s)
    return s[:n].strip()


def compose(d: dict, status: str, base: str | None = None) -> tuple[str, str, str]:
    """Письмо о статусе правки → (тема, текст, html). Коротко, тепло, на «ты» — как страница contribute.html."""
    base = base or site()
    title = _plain(d.get("title"), 90) or "без названия"
    nick = _plain(d.get("author"), 40)
    page = f"{base}/contribute.html#{d.get('id', '')}"
    again = f"{base}/contribute.html"
    pr = d.get("pr_url") or ""
    reason = _plain(d.get("reason"), 500).rstrip(". ")
    hi = f"Привет, {nick}!" if nick else "Привет!"
    if status == "pr":
        subj = f"Флейм-Сити: правка «{title}» на проверке"
        body = [hi, f"Твоя правка «{title}» стала pull request. Проверки уже гоняют игру на компьютере и телефоне, "
                    "а мейнтейнер посмотрит её сам.",
                ("Pull request", pr), ("Статус правки", page),
                "Напишем ещё раз, когда правку примут или если что-то пойдёт не так."]
    elif status == "merged":
        subj = f"Флейм-Сити: правку «{title}» приняли"
        body = [hi, f"Мейнтейнер принял твою правку «{title}» — она уже в коде игры. Через несколько минут она уедет "
                    "в город у всех, и мы напишем ещё раз.",
                ("Pull request", pr), ("Статус правки", page)]
    elif status == "live":
        subj = f"Флейм-Сити: твоя правка «{title}» в городе"
        body = [hi, f"Твоя правка «{title}» уже в игре — у всех, кто открывает город. Спасибо, что строишь "
                    "Флейм-Сити вместе с нами!",
                ("Зайди посмотреть", base + "/"), ("Pull request", pr),
                "Есть ещё идея — твой ИИ знает, как её сделать.", ("Новая правка", again)]
    elif status == "rejected":
        subj = f"Флейм-Сити: правка «{title}» не прошла проверку"
        body = [hi, f"Правку «{title}» не получилось принять.",
                f"Почему: {reason or 'она не прошла автоматические проверки'}.",
                "Покажи эту причину своему ИИ — он поправит правку, — и отправь её заново.", ("Отправить снова", again)]
    elif status == "closed":
        subj = f"Флейм-Сити: правку «{title}» пока не взяли"
        body = [hi, f"Мейнтейнер закрыл pull request с правкой «{title}» без слияния.",
                f"Почему: {reason}." if reason else "Комментария нет — загляни в pull request.",
                ("Pull request", pr),
                "Можно доработать правку со своим ИИ и прислать снова.", ("Отправить снова", again)]
    else:
        raise ValueError(status)
    foot = (f"Письмо пришло, потому что эту почту указали, отправляя правку на {again}. Её никто не видит, "
            "а после последнего письма о правке мы её удалим.")
    body = [b for b in body if not (isinstance(b, tuple) and not b[1])]
    text = "\n\n".join((f"{b[0]}: {b[1]}" if isinstance(b, tuple) else b) for b in body + ["— Флейм-Сити", foot])
    e = html.escape
    parts = [(f'<p>{e(b[0])}: <a href="{e(b[1])}">{e(b[1])}</a></p>' if isinstance(b, tuple) else f"<p>{e(b)}</p>")
             for b in body]
    htm = ('<div style="font-family:system-ui,-apple-system,\'Segoe UI\',Roboto,sans-serif;font-size:15px;'
           'line-height:1.5;color:#1d1d1f;max-width:560px">' + "".join(parts) + "<p>— Флейм-Сити</p>"
           f'<p style="color:#888;font-size:12px">{e(foot)}</p></div>')
    return subj, text, htm


def ensure(store) -> None:
    with store.lock:
        store.db.executescript(SCHEMA)


def _limit(email: str) -> bool:
    """Не больше MAIL_N правок с письмами на адрес в сутки: чужую почту не завалить, отправляя правки от её имени."""
    now = time.time()
    k = hashlib.sha256(email.encode()).hexdigest()[:16]        # в памяти — не сам адрес
    q = _mail_hits.setdefault(k, deque())
    while q and now - q[0] > MAIL_WIN:
        q.popleft()
    if len(q) >= MAIL_N:
        return False
    q.append(now)
    if len(_mail_hits) > 5000:
        for kk in [kk for kk, v in _mail_hits.items() if not v or now - v[-1] > MAIL_WIN][:2500]:
            _mail_hits.pop(kk, None)
    return True


def remember(store, cid: str, email: str) -> bool:
    """Запомнить почту правки. False — письма по ней не будет (лимит на адрес)."""
    if not email or not _limit(email):
        return False
    with store.lock:
        store.db.execute("INSERT OR REPLACE INTO contrib_mail (cid, email, created) VALUES (?, ?, ?)",
                         (cid, email, int(time.time())))
    return True


def enqueue(store, d: dict, status: str) -> bool:
    """Правка перешла в status: есть почта — письмо в очередь (одно на статус, повтор отчёта не дублирует)."""
    if status not in NOTIFY:
        return False
    with store.lock:
        r = store.db.execute("SELECT email FROM contrib_mail WHERE cid = ?", (d["id"],)).fetchone()
    if not r:
        return False
    subj, text, htm = compose(d, status)
    with store.lock:
        cur = store.db.execute("""INSERT OR IGNORE INTO contrib_outbox (cid, status, rcpt, subject, text, html, created)
                                  VALUES (?, ?, ?, ?, ?, ?, ?)""", (d["id"], status, r["email"], subj, text, htm, int(time.time())))
    return cur.rowcount > 0


def sweep(store) -> None:
    """Сроки хранения: просроченные письма — вон (с адресом, если статус окончательный), старые адреса и отправленные."""
    now = int(time.time())
    with store.lock:
        db = store.db
        old = db.execute("SELECT mid, cid, status FROM contrib_outbox WHERE done IS NULL AND created < ?",
                         (now - OUTBOX_TTL,)).fetchall()
        for r in old:
            db.execute("UPDATE contrib_outbox SET rcpt = NULL, done = ?, result = 'expired' WHERE mid = ?", (now, r["mid"]))
            if r["status"] in FINAL:
                db.execute("DELETE FROM contrib_mail WHERE cid = ?", (r["cid"],))
        db.execute("DELETE FROM contrib_mail WHERE created < ?", (now - MAIL_KEEP,))
        db.execute("DELETE FROM contrib_outbox WHERE done IS NOT NULL AND done < ?", (now - SENT_KEEP,))


def mark(store, mid: int, result: str) -> dict:
    """Письмо отправлено (sent) или адрес не принимает почту (bounced): адрес письма стираем сразу; окончательный
    статус или bounced — стираем и адрес правки (а bounced — и остальные её неотправленные письма)."""
    now = int(time.time())
    with store.lock:
        db = store.db
        r = db.execute("SELECT cid, status, done FROM contrib_outbox WHERE mid = ?", (mid,)).fetchone()
        if not r:
            raise HTTPException(404, "нет такого письма")
        if r["done"]:
            return {"ok": True, "already": True, "erased": False}
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("UPDATE contrib_outbox SET rcpt = NULL, done = ?, result = ? WHERE mid = ?", (now, result, mid))
            erased = result == "bounced" or r["status"] in FINAL
            if erased:
                db.execute("DELETE FROM contrib_mail WHERE cid = ?", (r["cid"],))
            if result == "bounced":
                db.execute("UPDATE contrib_outbox SET rcpt = NULL, done = ?, result = 'bounced' WHERE cid = ? AND done IS NULL",
                           (now, r["cid"]))
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
    return {"ok": True, "erased": erased}


def make_router(store, admin_key) -> APIRouter:
    """store() → Store с готовой схемой (contrib.make_router), admin_key() → ключ /g/admin/* (modes.admin_key)."""
    rt = APIRouter()

    def need_admin(request: Request) -> None:
        key = admin_key()
        got = request.headers.get("x-admin-key") or ""
        if not key or not secrets.compare_digest(got, key):
            raise HTTPException(404, "Not Found")

    @rt.get("/g/admin/contrib/outbox")
    def outbox(request: Request):
        need_admin(request)
        st = store()
        sweep(st)
        with st.lock:
            rows = st.db.execute("""SELECT mid, cid, status, rcpt, subject, text, html, created FROM contrib_outbox
                                    WHERE done IS NULL AND rcpt IS NOT NULL ORDER BY mid LIMIT ?""", (OUTBOX_PAGE,)).fetchall()
        return {"items": [{"mid": r["mid"], "cid": r["cid"], "status": r["status"], "to": r["rcpt"], "subject": r["subject"],
                           "text": r["text"], "html": r["html"], "created": r["created"]} for r in rows]}

    @rt.post("/g/admin/contrib/outbox/{mid}/sent")
    async def sent(mid: int, request: Request):
        need_admin(request)
        raw = await request.body()
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            raise HTTPException(400, "не JSON") from None
        result = (body.get("result") if isinstance(body, dict) else None) or "sent"
        if result not in RESULTS:
            raise HTTPException(400, "result: sent | bounced")
        return mark(store(), mid, result)

    return rt
