"""Недвижимость Флейм-Сити (server/homes.py): дом занят навсегда, пока владелец не продаст.

Без сети и Postgres: мир подменён (FC_WORLD=fake — токен «tok-<rid>» = rid), база — файл во временной папке.

    python -m pytest server/tests/test_homes.py -q
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
os.environ.setdefault("FC_DB", os.path.join(tempfile.mkdtemp(prefix="fcg-homes-"), "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ.setdefault("FC_ORIGINS", "https://game.example.org")

_spec = importlib.util.spec_from_file_location("fcg_app_homes", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import homes  # noqa: E402  — app.py кладёт папку службы в sys.path

from fastapi.testclient import TestClient  # noqa: E402

A, B, C = "tok-aaaa0001", "tok-bbbb0002", "tok-cccc0003"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(homes, "EVERY", 0.0)                  # без паузы между покупками в тестах
    fcg._tok.clear()
    homes._acted.clear()
    with TestClient(fcg.app) as c:
        homes.ensure(fcg.db())                                # сама берёт блокировку хранилища — не изнутри неё
        with fcg.db().lock:                                   # правда — props (realty.py), homes — зеркало
            for t in ("homes", "props", "biz"):
                fcg.db().db.execute(f"DELETE FROM {t}")
        yield c


def claim(c, tok, b, price=50000, kind="flat"):
    return c.post("/g/home/claim", json={"token": tok, "building": b, "price": price, "kind": kind})


def test_guest_and_bad_token_refused(client):
    assert claim(client, "", 10).status_code == 401
    assert claim(client, "garbage", 10).status_code == 401
    assert client.post("/g/home/mine", json={}).status_code == 401


def test_claim_is_unique_and_idempotent(client):
    r = claim(client, A, 10)
    assert r.status_code == 200 and r.json()["kind"] == "home"   # первый дом — главный
    again = claim(client, A, 10)
    assert again.status_code == 200 and again.json()["already"] is True
    taken = claim(client, B, 10)
    assert taken.status_code == 409
    mine_a = client.post("/g/home/mine", json={"token": A}).json()["homes"]
    assert [h["building"] for h in mine_a] == [10]
    assert client.post("/g/home/mine", json={"token": B}).json()["homes"] == []


def test_public_list_has_no_owner_identity(client):
    claim(client, A, 11)
    d = client.get("/g/homes").json()
    assert d["n"] == 1
    item = d["homes"][0]
    assert item["b"] == 11 and set(item) == {"b", "kind", "creature"}       # ни rid, ни имени


def test_limit_three(client):
    for b in (20, 21, 22):
        assert claim(client, C, b).status_code == 200
    r = claim(client, C, 23)
    assert r.status_code == 403
    kinds = {h["building"]: h["kind"] for h in client.post("/g/home/mine", json={"token": C}).json()["homes"]}
    assert kinds == {20: "home", 21: "flat", 22: "flat"}


def test_sell_frees_and_moves_main(client):
    claim(client, A, 30, price=40000)
    claim(client, A, 31, price=60000)
    assert client.post("/g/home/sell", json={"token": B, "building": 30}).status_code == 404   # чужой
    r = client.post("/g/home/sell", json={"token": A, "building": 30})
    assert r.status_code == 200 and r.json()["price"] == 40000
    left = client.post("/g/home/mine", json={"token": A}).json()["homes"]
    assert [(h["building"], h["kind"]) for h in left] == [(31, "home")]   # главным стал оставшийся
    assert claim(client, B, 30).status_code == 200                       # проданный дом снова свободен


def test_validation(client):
    assert claim(client, A, -1).status_code == 400
    assert claim(client, A, 10 ** 6).status_code == 400
    assert claim(client, A, "12").status_code == 400
    assert claim(client, A, 12, price=5).status_code == 400
    assert claim(client, A, 12, price=True).status_code == 400
    assert client.post("/g/home/claim", content=b"[1,2]", headers={"content-type": "application/json"}).status_code == 400


def test_throttle(client, monkeypatch):
    monkeypatch.setattr(homes, "EVERY", 5.0)
    assert claim(client, A, 40).status_code == 200
    assert claim(client, A, 41).status_code == 429
