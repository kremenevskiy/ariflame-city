"""Фоторежим и календарь недели (server/media.py, events.py): кадры для сторис и общий календарь.

Без сети и Postgres: мир подменён (FC_WORLD=fake — токен «tok-<rid>» = rid), база и папка кадров — во временной папке.

    python -m pytest server/tests/test_photo_events.py -q
"""
from __future__ import annotations

import importlib.util
import io
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
_tmp = tempfile.mkdtemp(prefix="fcg-photo-")
os.environ.setdefault("FC_DB", os.path.join(_tmp, "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ.setdefault("FC_ORIGINS", "https://game.example.org")

_spec = importlib.util.spec_from_file_location("fcg_app_photo", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import events as fcevents  # noqa: E402  — app.py кладёт папку службы в sys.path
import media  # noqa: E402
import modes as fcmodes  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

A, B = "tok-aaaa0001", "tok-bbbb0002"


def jpeg(w=1080, h=1920, size=20000) -> bytes:
    """Минимальный JPEG-заголовок: SOI, APP0, SOF0 с размерами, SOS, данные, EOI — парсеру сервера этого хватает."""
    app0 = b"\xff\xe0" + (16).to_bytes(2, "big") + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof = b"\xff\xc0" + (17).to_bytes(2, "big") + b"\x08" + h.to_bytes(2, "big") + w.to_bytes(2, "big") + \
        b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01"
    sos = b"\xff\xda" + (12).to_bytes(2, "big") + b"\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00"
    head = b"\xff\xd8" + app0 + sof + sos
    return head + b"\x55" * max(0, size - len(head) - 2) + b"\xff\xd9"


def post(c, body, tok=A, ctype="image/jpeg"):
    h = {"content-type": ctype}
    if tok:
        h["x-fc-token"] = tok
    return c.post("/g/photo", content=body, headers=h)


@pytest.fixture()
def client(monkeypatch):
    folder = tempfile.mkdtemp(prefix="fcg-photos-", dir=_tmp)
    monkeypatch.setattr(fcg, "PHOTOS", folder)
    fcg._tok.clear()
    media._hits.clear()
    media._state.update(swept=0.0, files=0, bytes=0)
    with TestClient(fcg.app) as c:
        c.folder = folder
        yield c


# ---- кадры ------------------------------------------------------------------------------------------------------

def test_upload_and_serve(client):
    r = post(client, jpeg())
    assert r.status_code == 200, r.text
    j = r.json()
    assert len(j["id"]) == 16 and j["url"].endswith("/g/p/" + j["id"] + ".jpg")
    assert j["w"] == 1080 and j["h"] == 1920 and j["expires_at"] > time.time() + 47 * 3600
    g = client.get("/g/p/" + j["id"] + ".jpg")
    assert g.status_code == 200 and g.headers["content-type"] == "image/jpeg"
    assert g.content == jpeg()
    assert g.headers["access-control-allow-origin"] == "*" and "noindex" in g.headers["x-robots-tag"]
    assert client.head("/g/p/" + j["id"] + ".jpg").status_code == 200
    # в папке — только случайное имя, без текста игрока
    assert os.listdir(client.folder) == [j["id"] + ".jpg"]


def test_guest_and_bad_token_refused(client):
    assert post(client, jpeg(), tok=None).status_code == 401
    assert post(client, jpeg(), tok="garbage").status_code == 401


def test_type_magic_and_size_checks(client):
    assert post(client, jpeg(), ctype="image/png").status_code == 415
    assert post(client, b"<html>" + b"x" * 9000).status_code == 415                # не та сигнатура
    assert post(client, b"\x89PNG\r\n\x1a\n" + b"x" * 9000).status_code == 415
    assert post(client, jpeg(), ctype="image/webp").status_code == 415               # заголовок врёт о типе
    assert post(client, jpeg(size=500)).status_code == 415                           # пустышка
    assert post(client, jpeg(w=100, h=100)).status_code == 415                       # кадр меньше 240
    assert post(client, jpeg(w=9000, h=1920)).status_code == 415                     # больше 4096
    big = jpeg(size=media.PHOTO_MAX + 10)
    assert post(client, big).status_code == 413


def test_webp_accepted(client):
    vp8x = b"VP8X" + (10).to_bytes(4, "little") + b"\x00\x00\x00\x00" + (1079).to_bytes(3, "little") + \
        (1919).to_bytes(3, "little")
    body = b"RIFF" + (len(vp8x) + 4 + 9000).to_bytes(4, "little") + b"WEBP" + vp8x + b"\x00" * 9000
    r = post(client, body, ctype="image/webp")
    assert r.status_code == 200, r.text
    assert r.json()["url"].endswith(".webp") and r.json()["w"] == 1080


def test_real_jpeg_from_pillow(client):
    Image = pytest.importorskip("PIL.Image")
    buf = io.BytesIO()
    Image.new("RGB", (720, 1280), (255, 140, 40)).save(buf, "JPEG", quality=80)
    assert media.jpeg_size(buf.getvalue()) == (720, 1280)
    assert post(client, buf.getvalue() + b"\x00" * 4000).status_code == 200


def test_rate_limit_per_player(client):
    for _ in range(media.PLAYER_N):
        assert post(client, jpeg()).status_code == 200
    assert post(client, jpeg()).status_code == 429
    assert post(client, jpeg(), tok=B).status_code == 200                           # другой игрок — свой счёт


def test_ttl_expiry_and_sweep(client):
    j = post(client, jpeg()).json()
    path = os.path.join(client.folder, j["id"] + ".jpg")
    old = time.time() - media.TTL - 60
    os.utime(path, (old, old))
    assert client.get("/g/p/" + j["id"] + ".jpg").status_code == 404                  # истёк — 404 и файл удалён
    assert not os.path.exists(path)
    k = post(client, jpeg()).json()
    p2 = os.path.join(client.folder, k["id"] + ".jpg")
    os.utime(p2, (old, old))
    media.sweep(client.folder)
    assert not os.path.exists(p2) and media._state["files"] == 0


def test_bad_names_404(client):
    for name in ("../game.db", "x.jpg", "AAAAAAAAAAAAAAAA.png", "AAAAAAAAAAAAAAAA.jpg"):
        assert client.get("/g/p/" + name).status_code == 404


def test_disk_cap(client, monkeypatch):
    monkeypatch.setattr(media, "DISK_FILES", 1)
    assert post(client, jpeg()).status_code == 200
    assert post(client, jpeg()).status_code == 507


def test_body_limit_middleware_lets_photo_through(client):
    # общий потолок тела запроса (64 КБ сохранения) не режет кадр, а остальные ручки — режет
    assert post(client, jpeg(size=900_000)).status_code == 200
    r = client.post("/g/save", content=b"{" + b" " * (fcg.SAVE_MAX + 9000) + b"}", headers={"content-type": "application/json"})
    assert r.status_code == 413


# ---- календарь недели ------------------------------------------------------------------------------------------

def test_calendar_deterministic_and_complete():
    w = 2967
    a, b = fcevents.calendar(w), fcevents.calendar(w)
    assert a == b
    kinds = [x["kind"] for x in a["bonuses"]]
    assert kinds == ["money", "money", "sale", "event"]
    assert a["bonuses"][0]["job"] != a["bonuses"][1]["job"]
    assert a["bonuses"][0]["mult"] == 2 and a["bonuses"][1]["mult"] == 1.5
    assert a["bonuses"][2]["pct"] in fcevents.SALE and a["bonuses"][2]["shop"] in fcevents.SHOP
    assert a["bonuses"][3]["event"] in fcevents.EVENT
    assert len(a["days"]) == 7 and a["days"][0]["date"] == a["starts"] and a["days"][6]["date"] == a["ends"]
    assert a["race"]["id"] == fcmodes.week_track(w)["id"]
    assert a["iso"].startswith("2026-W") or a["iso"].startswith("2027-W")


def test_calendar_rotates_and_monday_start():
    seen = {fcevents.calendar(w)["theme"]["name"] for w in range(2960, 2990)}
    assert len(seen) >= 4                                                              # темы меняются
    c = fcevents.calendar(2967)
    import datetime as dt
    assert dt.date.fromisoformat(c["starts"]).weekday() == 0                          # понедельник


def test_events_endpoint(client):
    r = client.get("/g/events")
    assert r.status_code == 200
    j = r.json()
    assert j["week"] == fcmodes.week_of() and 0 < j["next_in"] <= 7 * 86400
    assert len(j["bonuses"]) == 4 and len(j["days"]) == 7 and j["next"]["titles"]
    assert "max-age" in r.headers["cache-control"]
    assert j == {**fcevents.calendar(j["week"]), "next_in": j["next_in"], "next": j["next"]}
