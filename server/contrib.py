"""Правки без GitHub: человек со своим ИИ (ChatGPT, Claude, любой) делает правку игры, сайт принимает её сюда, а GitHub
Actions (.github/workflows/contrib-intake.yml) раз в 15 минут забирает новые, накладывает на свежий main, прогоняет
сторож содержания и открывает pull request. Дальше — обычный путь: CI, отчёт со снимками, ревью мейнтейнера, выкатка.

Задача 24.11: «скилл, который любой скопирует в свой ChatGPT, даже без GitHub… и ручка, чтобы PR хотя бы просто
появился у нас». Страница — client/contribute.html, навык для ИИ — client/dev/ (tools/build.cjs собирает пакет кода).

  POST /g/contrib            {title, idea, author?, contact?, tool?, agree: true, и правка — одно из:
                              patch (git diff) | files [{path, content}] | zip (base64 архива с файлами по путям репо)}
                             → 200 {id, status} / 400 что не так / 413 велико / 429 часто / 507 очередь полна
  GET  /g/contrib/<id>       → {id, title, status, pr_url?, reason?, created, updated} — без автора и контакта
  GET  /g/contrib/pending    заголовок X-Contrib-Key = FC_CONTRIB_KEY → {items: [...]} (контакт не отдаётся)
  POST /g/contrib/<id>/result  (тот же ключ) {status: taken|pr|rejected|pending, pr_url?, reason?}
  статусы: pending → taken (забрали) → pr (открыт PR) | rejected (причина — человеку на странице)

Защита: входа не нужно (правку может прислать любой); правка — только текстовые файлы в client/ и docs/ (не vendor,
не config.js, не данные карты Минска), без бинарных патчей и «..»; размеры ограничены; не чаще IP_N за час с адреса и
TOTAL_N в сутки на сервер; в очереди — не больше QUEUE_FILES/QUEUE_BYTES. Слова и ссылки проверяет сторож содержания
в contrib-intake (те же списки, что в CI). Номер правки — случайный (12 знаков): статус видит только тот, у кого ссылка.
Контакт автора хранится только здесь, в PR не попадает. Ключ выключен (FC_CONTRIB_KEY пуст) — очередь не отдаётся.

Подключает app.py: `app.include_router(contrib.make_router(lambda: CONTRIB_DIR))`.
"""
from __future__ import annotations

import base64
import binascii
import hmac
import io
import json
import os
import posixpath
import re
import secrets
import time
import zipfile
from collections import deque

from fastapi import APIRouter, HTTPException, Request

from clientip import client_ip  # адрес — из прокси-заголовков, разобранных uvicorn, а не левый X-Forwarded-For (M-2)

BODY_MAX = 1_400_000             # байт запроса: zip в base64 (+33%) или текст правки
PATCH_MAX = 400_000              # знаков в git diff
FILE_MAX, FILES_MAX, FILES_TOTAL = 300_000, 40, 800_000
ZIP_MAX, ZIP_ENTRIES, ZIP_UNPACKED = 1_000_000, 80, 2_000_000
IP_N, IP_WIN = 6, 3600.0         # правок с адреса за час
TOTAL_N, TOTAL_WIN = 300, 86400.0
QUEUE_FILES, QUEUE_BYTES = 2000, 400 * 1024 * 1024
KEEP = 60 * 86400                # закрытые (pr / rejected) правки хранятся 60 дней

ID_RE = re.compile(r"[A-Za-z0-9_-]{12}")
# что можно менять правкой с сайта: код и данные игры, документы; расширения — только текст
PATH_RE = re.compile(r"(client|docs)/[A-Za-z0-9._/-]{1,180}")
EXT_OK = (".js", ".json", ".html", ".css", ".md", ".txt", ".svg")
DENY = ("client/vendor/", "client/minsk/", "client/config.js")
STATUSES = ("pending", "taken", "pr", "rejected")

_hits: dict[str, deque] = {}
_total: deque = deque()


def key() -> str:
    return (os.environ.get("FC_CONTRIB_KEY") or "").strip()


def clean_path(p: str) -> str:
    """Путь файла правки в репо или HTTPException(400). Архивы ИИ часто кладут всё в папку «проект/…» — срезаем её."""
    if not isinstance(p, str):
        raise HTTPException(400, "путь файла — строка")
    p = p.replace("\\", "/").strip()
    if ".." in p.split("/"):
        raise HTTPException(400, f"файл «{p[:80]}»: путь с «..» не принимается")
    while p.startswith("./"):
        p = p[2:]
    if "//" in p:
        raise HTTPException(400, f"файл «{p[:80]}»: двойная косая в пути")
    p = posixpath.normpath(p) if p else p          # «client/./vendor/…» — тот же vendor (аудит 24.11.2026)
    for root in ("client/", "docs/"):
        i = p.find("/" + root)
        if not p.startswith(root) and i >= 0:
            p = p[i + 1:]
    if ".." in p.split("/") or "//" in p or not PATH_RE.fullmatch(p):
        raise HTTPException(400, f"файл «{p[:80]}»: менять можно только client/… и docs/…")
    if p.startswith(DENY) or p in DENY:
        raise HTTPException(400, f"файл «{p[:80]}» правкой с сайта не меняется (движок, настройки выкладки, данные карты)")
    if not p.lower().endswith(EXT_OK):
        raise HTTPException(400, f"файл «{p[:80]}»: только текстовые файлы ({', '.join(EXT_OK)}); картинки — ссылкой в описании")
    return p


def check_patch(patch: str) -> list[str]:
    """Файлы из git diff (проверенные пути); пустой список или бинарный патч — 400."""
    if len(patch) > PATCH_MAX:
        raise HTTPException(413, "правка больше 400 КБ — разбейте на несколько")
    if "GIT binary patch" in patch or "\x00" in patch:
        raise HTTPException(400, "бинарные изменения не принимаются — только текст")
    # правило «только лучше»: правкой с сайта игру дорабатывают, а не вычищают — удалять файлы нельзя
    if re.search(r"^(deleted file mode|\+\+\+ /dev/null)", patch, re.M):
        raise HTTPException(400, "правка удаляет файл — так нельзя: с сайта игру только улучшают (чинят, дорабатывают, добавляют)")
    paths: list[str] = []
    sections = heads = 0
    for line in patch.splitlines():
        # git apply берёт имя и из «diff --git a/X b/Y» (раздел без ---/+++), умеет переименования, смену режима и
        # символические ссылки — всё это мимо проверки путей и сторожа. С сайта — только правка содержимого обычных
        # файлов: новые файлы — 100644, без rename/copy/mode (аудит 24.11.2026).
        if line.startswith("diff --git "):
            sections += 1
            m = re.match(r"diff --git a/(\S+) b/(\S+)$", line)
            if not m:
                raise HTTPException(400, "непонятный заголовок раздела: пути с пробелами не принимаются")
            for p in m.groups():
                cp = clean_path(p)
                if cp not in paths:
                    paths.append(cp)
            continue
        if line.startswith(("rename ", "copy ", "old mode", "new mode", "similarity index", "dissimilarity index")) or \
                (line.startswith("new file mode") and line.strip() != "new file mode 100644"):
            raise HTTPException(400, "переименования, смена режима и ссылки не принимаются — только правка файлов")
        if line.startswith("+++ "):
            heads += 1
        if line.startswith(("+++ ", "--- ")):
            p = line[4:].split("\t")[0].strip()
            if p == "/dev/null":
                continue
            if p.startswith(("a/", "b/")):
                p = p[2:]
            cp = clean_path(p)
            if cp not in paths:
                paths.append(cp)
    if sections and heads < sections:
        raise HTTPException(400, "в каждом разделе нужны строки «--- a/…» и «+++ b/…» (пустые файлы не принимаются)")
    if not paths:
        raise HTTPException(400, "это не похоже на git diff: нет строк «--- a/…» и «+++ b/…»")
    return paths


def check_files(files) -> list[dict]:
    if not isinstance(files, list) or not files:
        raise HTTPException(400, "files — список {path, content}")
    if len(files) > FILES_MAX:
        raise HTTPException(413, f"больше {FILES_MAX} файлов — разбейте правку")
    out, total, seen = [], 0, set()
    for f in files:
        if not isinstance(f, dict) or not isinstance(f.get("content"), str):
            raise HTTPException(400, "каждый файл — {path, content: текст}")
        p, c = clean_path(f.get("path")), f["content"]
        if p in seen:
            raise HTTPException(400, f"файл «{p}» дважды")
        if "\x00" in c:
            raise HTTPException(400, f"файл «{p}» не текстовый")
        if len(c) > FILE_MAX:
            raise HTTPException(413, f"файл «{p}» больше 300 КБ")
        total += len(c)
        seen.add(p)
        out.append({"path": p, "content": c})
    if total > FILES_TOTAL:
        raise HTTPException(413, "файлы вместе больше 800 КБ — разбейте правку")
    return out


def unzip(b64: str) -> tuple[list[dict], str]:
    """Файлы из архива (zip в base64) и текст CHANGE.md/README, если ИИ положил описание в корень."""
    if not isinstance(b64, str) or len(b64) > ZIP_MAX * 4 // 3 + 8:
        raise HTTPException(413, "архив больше 1 МБ")
    try:
        raw = base64.b64decode(b64.split(",", 1)[-1], validate=False)
        z = zipfile.ZipFile(io.BytesIO(raw))
        infos = z.infolist()
    except (binascii.Error, zipfile.BadZipFile, ValueError):
        raise HTTPException(400, "архив не открывается — нужен .zip") from None
    if len(infos) > ZIP_ENTRIES:
        raise HTTPException(413, f"в архиве больше {ZIP_ENTRIES} файлов")
    files, note, unpacked = [], "", 0
    for i in infos:
        n = i.filename.replace("\\", "/")
        base = n.rsplit("/", 1)[-1]
        if i.is_dir() or n.startswith("__MACOSX/") or base.startswith(".") or not base:
            continue
        unpacked += i.file_size
        if unpacked > ZIP_UNPACKED or i.file_size > FILE_MAX:
            raise HTTPException(413, "архив слишком большой в распакованном виде")
        data = z.read(i)
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(400, f"«{base}» не текстовый файл — картинки и бинарные файлы не принимаются") from None
        # описание правки (CHANGE.md, README.txt…) в корне архива или в его единственной папке — это текст для PR, не файл игры
        if base.lower().endswith((".md", ".txt")) and "client/" not in n and "docs/" not in n and n.strip("/").count("/") <= 1:
            note = (note + "\n\n" + text).strip()[:4000]
            continue
        files.append({"path": n, "content": text})
    if not files:
        raise HTTPException(400, "в архиве нет файлов игры (client/… или docs/…)")
    return check_files(files), note


def _limit(ip: str) -> None:
    now = time.time()
    q = _hits.setdefault(ip, deque())
    while q and now - q[0] > IP_WIN:
        q.popleft()
    while _total and now - _total[0] > TOTAL_WIN:
        _total.popleft()
    if len(q) >= IP_N:
        raise HTTPException(429, "много правок с одного адреса — попробуйте через час")
    if len(_total) >= TOTAL_N:
        raise HTTPException(429, "сегодня правок очень много — попробуйте завтра")
    q.append(now)
    _total.append(now)
    if len(_hits) > 5000:                       # старые адреса не копим
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > IP_WIN][:2500]:
            _hits.pop(k, None)


def _text(body: dict, name: str, lo: int, hi: int, need: bool = True) -> str:
    v = body.get(name)
    if v is None or v == "":
        if need:
            raise HTTPException(400, f"не заполнено: {name}")
        return ""
    if not isinstance(v, str):
        raise HTTPException(400, f"{name} — строка")
    v = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", v).strip()
    if len(v) < lo or len(v) > hi:
        raise HTTPException(400, f"{name}: от {lo} до {hi} знаков")
    return v


def _public(d: dict) -> dict:
    out = {k: d.get(k) for k in ("id", "title", "status", "pr_url", "reason", "created", "updated")}
    out["files"] = d.get("paths") or [f["path"] for f in d.get("files") or []]
    return out


def make_router(contrib_dir) -> APIRouter:
    """contrib_dir() → папка очереди (создаётся при первой правке)."""
    rt = APIRouter()

    def path(cid: str) -> str:
        return os.path.join(contrib_dir(), cid + ".json")

    def load(cid: str) -> dict:
        if not ID_RE.fullmatch(cid or ""):
            raise HTTPException(404, "нет такой правки")
        try:
            with open(path(cid), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            raise HTTPException(404, "нет такой правки") from None

    def save(d: dict) -> None:
        os.makedirs(contrib_dir(), exist_ok=True)
        tmp = path(d["id"]) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
        os.replace(tmp, path(d["id"]))

    def queue_usage() -> tuple[int, int]:
        n = size = 0
        now = time.time()
        try:
            names = os.listdir(contrib_dir())
        except OSError:
            return 0, 0
        for name in names:
            if not name.endswith(".json"):
                continue
            p = os.path.join(contrib_dir(), name)
            try:
                st = os.stat(p)
            except OSError:
                continue
            if now - st.st_mtime > KEEP:            # старые закрытые правки — убираем (открытые к этому времени давно взяты)
                try:
                    with open(p, encoding="utf-8") as f:
                        if json.load(f).get("status") in ("pr", "rejected"):
                            os.remove(p)
                            continue
                except (OSError, ValueError):
                    pass
            n += 1
            size += st.st_size
        return n, size

    def need_key(request: Request) -> None:
        k = key()
        got = request.headers.get("x-contrib-key") or ""
        if not k or not hmac.compare_digest(k.encode(), got.encode()):
            raise HTTPException(404, "нет")

    @rt.post("/g/contrib")
    async def submit(request: Request):
        raw = await request.body()
        if len(raw) > BODY_MAX:
            raise HTTPException(413, "правка больше 1 МБ — разбейте на несколько")
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            raise HTTPException(400, "не JSON") from None
        if not isinstance(body, dict):
            raise HTTPException(400, "ждём объект")
        if body.get("agree") is not True:
            raise HTTPException(400, "нужно согласие с правилами и лицензией вклада")
        title = _text(body, "title", 4, 90)
        idea = _text(body, "idea", 10, 3000)
        author = _text(body, "author", 1, 40, need=False)
        contact = _text(body, "contact", 3, 80, need=False)
        tool = _text(body, "tool", 1, 60, need=False)
        kinds = [k for k in ("patch", "files", "zip") if body.get(k)]
        if len(kinds) != 1:
            raise HTTPException(400, "нужна сама правка: git diff, файлы или .zip — что-то одно")
        d = {"id": secrets.token_urlsafe(9)[:12], "title": title, "idea": idea, "author": author, "contact": contact,
             "tool": tool, "status": "pending", "created": int(time.time()), "updated": int(time.time())}
        if kinds[0] == "patch":
            if not isinstance(body["patch"], str):
                raise HTTPException(400, "patch — текст git diff")
            d["paths"] = check_patch(body["patch"])
            d["patch"] = body["patch"]
        elif kinds[0] == "files":
            d["files"] = check_files(body["files"])
        else:
            d["files"], note = unzip(body["zip"])
            if note:
                d["note"] = note
        n, size = queue_usage()
        if n >= QUEUE_FILES or size >= QUEUE_BYTES:
            raise HTTPException(507, "очередь правок переполнена — попробуйте позже")
        _limit(client_ip(request))
        save(d)
        return {"id": d["id"], "status": d["status"], "files": _public(d)["files"]}

    @rt.get("/g/contrib/pending")
    def pending(request: Request):
        need_key(request)
        items = []
        try:
            names = sorted(os.listdir(contrib_dir()))
        except OSError:
            names = []
        for name in names:
            if not name.endswith(".json"):
                continue
            try:
                with open(os.path.join(contrib_dir(), name), encoding="utf-8") as f:
                    d = json.load(f)
            except (OSError, ValueError):
                continue
            if d.get("status") == "pending":
                d.pop("contact", None)
                items.append(d)
        items.sort(key=lambda d: d.get("created", 0))
        return {"items": items[:20]}

    @rt.get("/g/contrib/{cid}")
    def status(cid: str):
        return _public(load(cid))

    @rt.post("/g/contrib/{cid}/result")
    async def result(cid: str, request: Request):
        need_key(request)
        d = load(cid)
        try:
            body = json.loads(await request.body() or b"{}")
        except ValueError:
            raise HTTPException(400, "не JSON") from None
        st = body.get("status") if isinstance(body, dict) else None
        if st not in STATUSES:                  # pending — вернуть в очередь, если у забравшего сломалась сеть или git
            raise HTTPException(400, "status: pending | taken | pr | rejected")
        d["status"] = st
        url = body.get("pr_url")
        if st == "pr":
            if not isinstance(url, str) or not re.fullmatch(r"https://github\.com/[\w.-]+/[\w.-]+/pull/\d+", url):
                raise HTTPException(400, "pr_url — ссылка на PR")
            d["pr_url"] = url
        reason = body.get("reason")
        if isinstance(reason, str) and reason.strip():
            d["reason"] = reason.strip()[:500]
        d["updated"] = int(time.time())
        save(d)
        return _public(d)

    return rt
