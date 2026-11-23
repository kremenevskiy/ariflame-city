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
    fcg._tok.clear()
    yield
    fcg._tok.clear()


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
