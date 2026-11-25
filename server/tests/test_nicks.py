"""Ник игрока (server/nicks.py, app.py on_nick): проверка, фильтр, занятые имена, лимиты смен, хранение (вошедший — по
rid, гость — по своему id и копии с устройства в hi.nick) и то, что другой игрок получает ник в meta, в «Онлайн» и в
рейтинге — без rid.

    python -m pytest server/tests/test_nicks.py -q
"""
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
os.environ["FC_DB"] = os.path.join(tempfile.mkdtemp(prefix="fcg-nick-"), "game.db")
os.environ["FC_WORLD"] = "fake"
os.environ["FC_ORIGINS"] = "https://game.example.org"

_spec = importlib.util.spec_from_file_location("fcg_app_nicks", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)

import crews as C  # noqa: E402  — app.py кладёт папку службы в sys.path
import nicks as N  # noqa: E402
import progress as PG  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

ORIGIN = {"origin": "https://game.example.org"}
A, RA = "tok-0000aaaa", "0000aaaa"
B, RB = "tok-0000bbbb", "0000bbbb"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(fcg, "TICK", 0.03)
    monkeypatch.setattr(PG, "SYNC_EVERY", 0.0)
    fcg._tok.clear()
    PG._cache.clear()
    with TestClient(fcg.app) as c:
        st = fcg.db()
        PG.ensure(st)
        fcg.MODES.db()
        with st.lock:
            st.db.execute("DELETE FROM nicks")
            st.db.execute("DELETE FROM prog")
        yield c
    assert not fcg.clients, "соединения не закрылись"


def hello(ws, **kw):
    ws.send_json(dict({"t": "hi", "creature": "lis", "v": 1}, **kw))
    w = ws.receive_json()
    assert w["t"] == "welcome"
    return w


def wait(cond, sec=2.0):
    end = time.time() + sec
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def until(ws, pred, tries=80):
    for _ in range(tries):
        m = ws.receive_json()
        if pred(m):
            return m
    return None


# ------------------------------------------------------------------ проверка
def test_check_shape():
    assert N.check("  Влад   Огонёк  ") == ("Влад Огонёк", None)        # обрезано, пробелы схлопнуты
    assert N.check("Кот_Василий")[0] == "Кот_Василий"
    assert N.check("Mr.Bean")[0] == "Mr.Bean" and N.check("Kot-99")[0] == "Kot-99"
    assert N.check("Ўладзімір")[0] == "Ўладзімір"                        # белорусские буквы — кириллица
    assert N.check("Ｖｌａｄ")[0] == "Vlad"                                  # широкие буквы — NFKC
    assert N.check("Вл​ад")[0] == "Влад"                              # невидимый пробел вырезан
    for bad, why in (("a", "от 2 до 20"), ("x" * 21, "от 2 до 20"), ("   ", "от 2 до 20"), ("Вася😀", "Только буквы"),
                     ("Вася@", "Только буквы"), ("<b>Вася</b>", "Только буквы"), ("007", "хотя бы одна буква"),
                     ("---", "хотя бы одна буква"), (42, "строка"), (None, "строка")):
        nick, msg = N.check(bad)
        assert nick is None and why in msg, (bad, msg)


def test_check_links_and_handles():
    for bad in ("name.gg", "shop.ru", "t.me", "www.site", "Игрок 1234567", "vk.com"):
        nick, why = N.check(bad)
        assert nick is None and why == "Без ссылок, @ и телефонов", bad
    assert N.check("@handle")[0] is None                                   # @ — не из набора знаков


def test_check_reserved_names():
    for bad in ("Макс", "МАКС", "макс 2", "Max", "MAKC", "Maks", "Патруль", "Щит", "Админ", "admin", "Аdmin",  # А кириллицей
                "SuperAdmin", "Admin_Vlad", "Adm1n", "Модератор Влад", "Moderator", "Ariflame", "ariflame fan",
                "Флейм-Сити", "Flame City", "FlameCity2"):
        nick, why = N.check(bad)
        assert nick is None and "занято" in why, bad
    for ok in ("Максим", "Maxim", "Патрульный", "Щитов", "Бадминтон", "Модерн", "Флейм", "Сити"):
        assert N.check(ok)[0] == ok, ok


def test_check_uses_chat_filter():
    # фильтр — тот же, что у чата клана (crews.clean): своего списка слов у ников нет
    for bad in ("сука", "С у к а", "asshole", "pussy"):  # guard:allow
        nick, why = N.check(bad)
        assert nick is None and "мата" in why, bad
        assert C.clean(bad), bad
    assert N.check("Хуан")[0] == "Хуан" and N.check("Hubert")[0] == "Hubert" and N.check("Nigel")[0] == "Nigel"


# ------------------------------------------------------------------ лимиты
def test_change_rate_limit_and_day_cap():
    st = fcg.db()
    t0 = 1_800_000_000.0
    with st.lock:
        db = st.db
        db.execute("DELETE FROM nicks")
        r = N.change(db, RA, "Огонёк", t0)
        assert r == {"ok": True, "nick": "Огонёк", "changed": True}
        assert N.change(db, RA, " Огонёк ", t0 + 1) == {"ok": True, "nick": "Огонёк", "changed": False}   # тот же — не смена
        r = N.change(db, RA, "Искра", t0 + 5)
        assert not r["ok"] and r["wait"] == 26 and "30 секунд" in r["why"]
        assert N.get(db, RA) == "Огонёк"
        bad = N.change(db, RA, "Админ", t0 + 100)
        assert not bad["ok"] and "занято" in bad["why"]                   # отказ проверки лимит не тратит
        t = t0 + 31
        for i in range(N.DAY_N - 1):                                       # всего DAY_N смен в сутки
            assert N.change(db, RA, f"Искра {i}", t)["ok"]
            t += 31
        r = N.change(db, RA, "Ещё один", t)
        assert not r["ok"] and "завтра" in r["why"]
        assert N.change(db, RA, "Завтра", t0 + 86400 * 2)["ok"]
        db.execute("DELETE FROM nicks")


# ------------------------------------------------------------------ сокет: свой ник и что видят другие
def test_ws_nick_reaches_other_player(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a, client.websocket_connect("/g/ws", headers=ORIGIN) as b:
        wa = hello(a, token=A)
        wb = hello(b, guest="g-nickview")
        assert wa["name"] is None and wb["name"] is None
        a.send_json({"t": "s", "p": [0, 0.2, 0, 0], "m": 0})
        b.send_json({"t": "s", "p": [10, 0.2, 0, 0], "m": 0})
        CA, CB = fcg.clients[wa["id"]], fcg.clients[wb["id"]]
        assert wait(lambda: CA.vis == {CB.id} and CB.vis == {CA.id})
        first = until(b, lambda m: m["t"] == "w" and m.get("meta"))
        assert first and "name" not in first["meta"][0]                   # ника ещё нет — как раньше

        a.send_json({"t": "nick", "nick": "Админ"})
        r = until(a, lambda m: m["t"] == "nick")
        assert r["ok"] is False and "занято" in r["why"]
        a.send_json({"t": "nick", "nick": "  Огонёк  Минска "})
        r = until(a, lambda m: m["t"] == "nick")
        assert r == {"t": "nick", "ok": True, "nick": "Огонёк Минска"}
        # b получает новый meta соседа: ник — в name и в pn (табличка), rid наружу не уходит
        m = until(b, lambda m: m["t"] == "w" and any(x.get("name") for x in m.get("meta", [])))
        assert m, "сосед не получил ник"
        meta = [x for x in m["meta"] if x["id"] == CA.id][0]
        assert meta["name"] == "Огонёк Минска" and meta["pn"] == "Огонёк Минска" and meta["nick"] == "Огонёк Минска"
        assert RA not in json.dumps(m)
        # «Онлайн»: who — тот же ник
        b.send_json({"t": "who", "q": 5})
        who = until(b, lambda m: m["t"] == "who" and m.get("q") == 5)
        row = [p for p in who["ps"] if p["id"] == CA.id][0]
        assert row["name"] == "Огонёк Минска" and RA not in json.dumps(who)
        # смена чаще раза в 30 с — отказ с ожиданием, ник прежний
        a.send_json({"t": "nick", "nick": "Искра"})
        r = until(a, lambda m: m["t"] == "nick")
        assert r["ok"] is False and r["wait"] > 0 and CA.name == "Огонёк Минска"
        # гость тоже может назвать себя
        b.send_json({"t": "nick", "nick": "Вася"})
        assert until(b, lambda m: m["t"] == "nick")["nick"] == "Вася"
        m = until(a, lambda m: m["t"] == "w" and any(x.get("name") == "Вася" for x in m.get("meta", [])))
        assert m and [x for x in m["meta"] if x["id"] == CB.id][0]["guest"] is True


def test_ws_junk_nick_counts_as_bad(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as ws:
        cid = hello(ws, guest="g-junk")["id"]
        ws.send_json({"t": "nick", "nick": 5})
        ws.send_json({"t": "nick", "nick": "x" * 90})
        assert wait(lambda: fcg.clients[cid].bad == 2)


def test_logged_in_nick_survives_reconnect_and_shows_in_ranks(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a:
        hello(a, token=A)
        a.send_json({"t": "nick", "nick": "Огонёк"})
        assert until(a, lambda m: m["t"] == "nick")["ok"]
    # другое устройство: копия с устройства (hi.nick) записанный ник не перебивает
    with client.websocket_connect("/g/ws", headers=ORIGIN) as a:
        assert hello(a, token=A, nick="Другой")["name"] == "Огонёк"
    me = client.post("/g/prog/me", json={"token": A}).json()
    assert me["nick"] == "Огонёк" and me["name"] == "Огонёк"
    st = fcg.db()
    with st.lock:
        PG.xp(st.db, RA, "crew", "flame", amount=5000)
    PG._cache.clear()
    rows = client.get("/g/ranks?board=level&scope=all&city=all").json()["rows"]
    assert rows[0]["nick"] == "Огонёк" and RA not in json.dumps(rows)
    prof = client.get("/g/profile?fid=" + me["fid"]).json()
    assert prof["nick"] == "Огонёк" and "name" not in prof               # публичная карточка — только ник


def test_guest_hi_nick_adopted_once(client):
    with client.websocket_connect("/g/ws", headers=ORIGIN) as g:
        assert hello(g, guest="g-dev1", nick="  Вася  Пупкин ")["name"] == "Вася Пупкин"
    with client.websocket_connect("/g/ws", headers=ORIGIN) as g:
        assert hello(g, guest="g-dev1", nick="Петя")["name"] == "Вася Пупкин"     # записанный — главнее
    with client.websocket_connect("/g/ws", headers=ORIGIN) as g:
        assert hello(g, guest="g-dev2", nick="Admin")["name"] is None             # копия с устройства — та же проверка
    with client.websocket_connect("/g/ws", headers=ORIGIN) as g:
        w = hello(g, guest="g-dev3", nick="Лиса")
        assert w["name"] == "Лиса"
        g.send_json({"t": "nick", "nick": "Лисичка"})                            # перенос с устройства лимит не тратит
        assert until(g, lambda m: m["t"] == "nick")["ok"]


def test_offline_friend_shows_nick(client):
    st = fcg.db()
    with st.lock:
        N.change(st.db, RB, "Друг Боря")
        st.db.execute("INSERT OR IGNORE INTO friends (a, b, at) VALUES (?, ?, 0), (?, ?, 0)", (RA, RB, RB, RA))
    try:
        with client.websocket_connect("/g/ws", headers=ORIGIN) as a:
            hello(a, token=A)
            a.send_json({"t": "friends", "q": 3})
            fr = until(a, lambda m: m["t"] == "friends")
            assert [f["name"] for f in fr["ps"]] == ["Друг Боря"] and RB not in json.dumps(fr)
    finally:
        with st.lock:
            st.db.execute("DELETE FROM friends")
