"""Фото из фоторежима Флейм-Сити — короткоживущие публичные ссылки для сторис Telegram и «скачать».

Задача: «то, что будут стримить и клипать — вау, это мой город». Telegram shareToStory
(Bot API 7.8) и downloadFile (8.0) берут картинку только по публичной HTTPS-ссылке, поэтому клиент (client/fphoto.js)
кладёт кадр сюда и получает адрес на 48 часов.

  POST /g/photo   тело — сам JPEG/WebP (Content-Type image/jpeg|image/webp), токен игрока — заголовок X-FC-Token
                  → 200 {id, url, expires_at} / 401 гость / 413 больше PHOTO_MAX / 415 не картинка / 429 часто / 507 диск
  GET|HEAD /g/p/<id>.jpg|.webp   сам файл (Cache-Control на сутки, CORS *, noindex) / 404 — нет или истёк срок

Защита: только вошедшие (тот же токен, что у /g/save), сигнатура файла (FF D8 FF / RIFF…WEBP)
и размеры кадра из заголовка (SOF / VP8*) — от 240 до 4096 пикселей; имя — случайное (16 знаков), никакого текста
игрока в имени и пути нет; не чаще PLAYER_N кадров за PLAYER_WIN на игрока, IP_N за час на адрес и TOTAL_N за час на
весь сервер; файлов не больше DISK_FILES и DISK_BYTES. Срок — TTL (48 ч): истёкшие сметаются при выгрузках и раз в
SWEEP_EVERY, при отдаче истёкший удаляется сразу. Папка — FC_PHOTOS или photos/ рядом с базой (FC_DB).

Подключает app.py: `app.include_router(media.make_router(verify, photos_dir))`.
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from clientip import client_ip  # адрес — из прокси-заголовков, разобранных uvicorn, а не левый X-Forwarded-For (M-2)

PHOTO_MAX = 1_500_000            # байт: сторис 1080×1920 в JPEG ~0,4–0,9 МБ
PHOTO_MIN = 4_000
TTL = 48 * 3600
PLAYER_N, PLAYER_WIN = 6, 600.0  # кадров на игрока за 10 минут
IP_N, IP_WIN = 40, 3600.0        # на адрес за час (за общим прокси/NAT адрес бывает общий — запас)
TOTAL_N, TOTAL_WIN = 600, 3600.0  # на весь сервер за час
DISK_FILES, DISK_BYTES = 4000, 800 * 1024 * 1024
DIM_MIN, DIM_MAX = 240, 4096
SWEEP_EVERY = 300.0
# Публичный адрес сервера в ссылках на кадр (Telegram берёт картинку только по HTTPS). Пусто — адрес из запроса
# (за обратным прокси uvicorn нужен --proxy-headers, иначе схема будет http).
PUBLIC = os.environ.get("FC_PUBLIC", "").rstrip("/")

NAME_RE = re.compile(r"([A-Za-z0-9_-]{16})\.(jpg|webp)")
TYPES = {"jpg": "image/jpeg", "webp": "image/webp"}

_hits: dict[str, deque] = {}
_state = {"swept": 0.0, "files": 0, "bytes": 0}


def jpeg_size(b: bytes) -> tuple[int, int] | None:
    """Ширина и высота из маркера SOF; None — не JPEG или кадра нет до начала данных."""
    if b[:3] != b"\xff\xd8\xff":
        return None
    i, n = 2, len(b)
    while i + 9 < n:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m == 0xFF:
            i += 1
            continue
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        if m == 0xDA or m == 0xD9:                  # данные или конец раньше кадра — битый
            return None
        seg = int.from_bytes(b[i + 2:i + 4], "big")
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(b[i + 7:i + 9], "big"), int.from_bytes(b[i + 5:i + 7], "big")
        if seg < 2:
            return None
        i += 2 + seg
    return None


def webp_size(b: bytes) -> tuple[int, int] | None:
    if len(b) < 30 or b[:4] != b"RIFF" or b[8:12] != b"WEBP":
        return None
    ch = b[12:16]
    if ch == b"VP8 " and b[23:26] == b"\x9d\x01\x2a":
        return int.from_bytes(b[26:28], "little") & 0x3FFF, int.from_bytes(b[28:30], "little") & 0x3FFF
    if ch == b"VP8L" and b[20] == 0x2F:
        v = int.from_bytes(b[21:25], "little")
        return (v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1
    if ch == b"VP8X":
        return int.from_bytes(b[24:27], "little") + 1, int.from_bytes(b[27:30], "little") + 1
    return None


def sniff(b: bytes) -> tuple[str, tuple[int, int]] | None:
    """(расширение, (ширина, высота)) по содержимому, а не по заголовку запроса."""
    s = jpeg_size(b)
    if s:
        return "jpg", s
    s = webp_size(b)
    if s:
        return "webp", s
    return None


def _allow(key: str, n: int, win: float, now: float) -> bool:
    q = _hits.get(key)
    if q is None:
        if len(_hits) > 50000:
            _hits.clear()
        q = _hits[key] = deque()
    while q and now - q[0] > win:
        q.popleft()
    if len(q) >= n:
        return False
    q.append(now)
    return True


def sweep(folder: str, now: float | None = None) -> None:
    """Удалить истёкшие и пересчитать, сколько лежит."""
    now = time.time() if now is None else now
    files = size = 0
    try:
        names = os.listdir(folder)
    except FileNotFoundError:
        names = []
    for name in names:
        p = os.path.join(folder, name)
        try:
            st = os.stat(p)
        except FileNotFoundError:
            continue
        if now - st.st_mtime > TTL or (name.endswith(".part") and now - st.st_mtime > 60):
            try:
                os.remove(p)
            except OSError:
                pass
            continue
        files += 1
        size += st.st_size
    _state.update(swept=time.monotonic(), files=files, bytes=size)


def make_router(verify, photos_dir) -> APIRouter:
    """verify(token) → rid | None — та же проверка, что у /g/save; photos_dir() → папка файлов."""
    rt = APIRouter()

    @rt.post("/g/photo")
    async def upload(request: Request):
        auth = request.headers.get("authorization") or ""
        tok = request.headers.get("x-fc-token") or (auth[7:] if auth.lower().startswith("bearer ") else "")
        rid = await verify(tok)
        if not rid:
            raise HTTPException(401, "нужен вход в аккаунт")
        n = request.headers.get("content-length")
        if n and n.isdigit() and int(n) > PHOTO_MAX:
            raise HTTPException(413, "кадр больше 1,5 МБ")
        ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
        if ctype not in ("image/jpeg", "image/webp"):
            raise HTTPException(415, "ждём image/jpeg или image/webp")
        buf, total = [], 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > PHOTO_MAX:
                raise HTTPException(413, "кадр больше 1,5 МБ")
            buf.append(chunk)
        data = b"".join(buf)
        if len(data) < PHOTO_MIN:
            raise HTTPException(415, "пустой кадр")
        kind = sniff(data)
        if not kind or TYPES[kind[0]] != ctype:
            raise HTTPException(415, "это не JPEG/WebP")
        w, h = kind[1]
        if not (DIM_MIN <= w <= DIM_MAX and DIM_MIN <= h <= DIM_MAX):
            raise HTTPException(415, "размер кадра вне 240–4096 пикселей")
        now = time.monotonic()
        if not _allow("r:" + rid, PLAYER_N, PLAYER_WIN, now):
            raise HTTPException(429, "не больше 6 кадров за 10 минут")
        if not _allow("i:" + client_ip(request), IP_N, IP_WIN, now) or not _allow("*", TOTAL_N, TOTAL_WIN, now):
            raise HTTPException(429, "слишком много кадров — попробуй позже")
        folder = photos_dir()
        os.makedirs(folder, exist_ok=True)
        if now - _state["swept"] > SWEEP_EVERY:
            await asyncio.to_thread(sweep, folder)
        if _state["files"] >= DISK_FILES or _state["bytes"] + len(data) > DISK_BYTES:
            raise HTTPException(507, "хранилище кадров заполнено — попробуй позже")
        pid = secrets.token_urlsafe(12)            # 16 знаков [A-Za-z0-9_-]
        name = f"{pid}.{kind[0]}"
        path = os.path.join(folder, name)

        def write():
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.chmod(tmp, 0o644)
            os.replace(tmp, path)
        await asyncio.to_thread(write)
        _state["files"] += 1
        _state["bytes"] += len(data)
        base = PUBLIC or str(request.base_url).rstrip("/")
        return {"id": pid, "url": f"{base}/g/p/{name}", "expires_at": int(time.time() + TTL), "w": w, "h": h}

    @rt.api_route("/g/p/{name}", methods=["GET", "HEAD"])
    def photo(name: str):
        m = NAME_RE.fullmatch(name)
        if not m:
            raise HTTPException(404, "нет такого кадра")
        path = os.path.join(photos_dir(), name)
        try:
            st = os.stat(path)
        except FileNotFoundError:
            raise HTTPException(404, "нет такого кадра") from None
        if time.time() - st.st_mtime > TTL:
            try:
                os.remove(path)
            except OSError:
                pass
            raise HTTPException(404, "срок кадра истёк")
        return FileResponse(path, media_type=TYPES[m.group(2)], headers={
            "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*",
            "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
            "Content-Disposition": f'inline; filename="flame-city-{m.group(1)[:6]}.{m.group(2)}"'})

    return rt
