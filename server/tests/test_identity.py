"""Личность игрока (app.verify): три режима FC_WORLD — пусто (только гости), fake (тесты), URL (вебхук POST /w/me).

Без сети: вебхук подменён httpx.MockTransport.
    python -m pytest server/tests/test_identity.py -q
"""
from __future__ import annotations

import asyncio
import importlib.util
import os
import tempfile
from pathlib import Path

import httpx
import pytest

GAME = Path(__file__).resolve().parent.parent
os.environ["FC_DB"] = os.path.join(tempfile.mkdtemp(prefix="fcg-ident-"), "game.db")
os.environ.pop("FC_WORLD", None)

_spec = importlib.util.spec_from_file_location("fcg_app_ident", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def fresh_cache():
    def clean():
        fcg._tok.clear()
        fcg._neg.clear()
        fcg._flight.clear()
        fcg._wbucket[:] = [fcg.WORLD_BURST, fcg.time.monotonic()]
    clean()
    yield
    clean()


def test_default_is_guest_only(monkeypatch):
    assert fcg.WORLD == ""                                   # без FC_WORLD — вход не настроен
    assert run(fcg.verify("tok-0000aaaa")) is None
    assert run(fcg.verify("любой-токен")) is None


def test_fake_mode(monkeypatch):
    monkeypatch.setattr(fcg, "WORLD", "fake")
    assert run(fcg.verify("tok-0000aaaa")) == "0000aaaa"
    assert run(fcg.verify("tok-не-hex")) is None
    assert run(fcg.verify("чужой")) is None


def _mock(monkeypatch, handler):
    real = httpx.AsyncClient

    def fake_client(*a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real(*a, **kw)
    monkeypatch.setattr(fcg.httpx, "AsyncClient", fake_client)


def test_webhook_mode(monkeypatch):
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        body = req.read().decode()
        if '"good"' in body:
            return httpx.Response(200, json={"rid": "0123abcd", "house": 5})
        if '"weird"' in body:
            return httpx.Response(200, json={"rid": "g-hacker"})   # не hex — не принимаем (гостевое пространство)
        return httpx.Response(401, json={"detail": "нет"})

    monkeypatch.setattr(fcg, "WORLD", "https://id.example.org/")
    _mock(monkeypatch, handler)
    assert run(fcg.verify("good")) == "0123abcd"
    assert str(seen[0].url) == "https://id.example.org/w/me"
    assert seen[0].headers["user-agent"] == fcg.WORLD_UA       # свой User-Agent: CDN режут «python-httpx»
    assert run(fcg.verify("good")) == "0123abcd" and len(seen) == 1   # кэш 10 минут — второй раз вебхук не зовём
    assert run(fcg.verify("bad")) is None
    assert run(fcg.verify("weird")) is None
    assert run(fcg.verify("")) is None and run(fcg.verify("x" * 5000)) is None


def test_webhook_down_means_guest(monkeypatch):
    def handler(req):
        raise httpx.ConnectError("нет связи", request=req)

    monkeypatch.setattr(fcg, "WORLD", "https://id.example.org")
    _mock(monkeypatch, handler)
    assert run(fcg.verify("good")) is None


def test_random_tokens_do_not_flood_the_webhook(monkeypatch):
    """Аудит M-3: случайный токен на любую ручку — запрос к сервису аккаунтов. Отказ помним, поток режем ведром."""
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(401, json={"detail": "нет"})

    monkeypatch.setattr(fcg, "WORLD", "https://id.example.org")
    _mock(monkeypatch, handler)
    for _ in range(5):                                       # один и тот же плохой токен — один запрос за NEG_TTL
        assert run(fcg.verify("junk-1")) is None
    assert len(seen) == 1
    monkeypatch.setattr(fcg, "WORLD_BURST", 10.0)
    monkeypatch.setattr(fcg, "WORLD_RATE", 0.001)
    fcg._wbucket[:] = [10.0, fcg.time.monotonic()]
    for i in range(50):                                      # 50 разных случайных — к вебхуку уходит не больше ведра
        assert run(fcg.verify(f"junk-{i + 100}")) is None
    assert len(seen) == 1 + 10


def test_outage_is_not_cached_and_good_token_still_logs_in(monkeypatch):
    state = {"down": True, "n": 0}

    def handler(req):
        state["n"] += 1
        if state["down"]:
            return httpx.Response(503, text="перезапуск")
        return httpx.Response(200, json={"rid": "0123abcd"})

    monkeypatch.setattr(fcg, "WORLD", "https://id.example.org")
    _mock(monkeypatch, handler)
    assert run(fcg.verify("good")) is None                   # сервис моргнул — игрок пока гость…
    state["down"] = False
    assert run(fcg.verify("good")) == "0123abcd"             # …но отказ не запомнен: следующий вход проходит
    assert run(fcg.verify("good")) == "0123abcd" and state["n"] == 2


def test_same_token_at_once_is_one_request(monkeypatch):
    seen = []

    async def handler(req):
        seen.append(req)
        await asyncio.sleep(0.05)
        return httpx.Response(200, json={"rid": "0123abcd"})

    monkeypatch.setattr(fcg, "WORLD", "https://id.example.org")
    _mock(monkeypatch, handler)

    async def both():
        return await asyncio.gather(*(fcg.verify("good") for _ in range(5)))
    assert run(both()) == ["0123abcd"] * 5 and len(seen) == 1
    assert not fcg._flight
