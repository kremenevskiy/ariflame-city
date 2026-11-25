"""Ошибки у игроков (server/errors.py): приём пачки с клиента, сводка по отпечаткам, лимиты, админ-ручки, исключения
самого сервера. Без сети: база — во временной папке, ключ админки — тестовый.

    python -m pytest server/tests/test_errors.py -q
"""
from __future__ import annotations

import base64
import importlib.util
import os
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
_tmp = tempfile.mkdtemp(prefix="fcg-err-")
os.environ.setdefault("FC_DB", os.path.join(_tmp, "game.db"))
os.environ["FC_WORLD"] = "fake"
os.environ.setdefault("FC_ADMIN_KEY", "test-admin-key")

_spec = importlib.util.spec_from_file_location("fcg_app_errors", GAME / "app.py")
fcg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fcg)
import errors  # noqa: E402  — app.py кладёт папку службы в sys.path

from fastapi.testclient import TestClient  # noqa: E402

ADMIN = {"x-admin-key": os.environ["FC_ADMIN_KEY"]}


def item(msg="TypeError: cars[5] is undefined", kind="js", **kw):
    d = {"kind": kind, "msg": msg, "stack": "TypeError: x\n    at upd (https://city.ariflame.com/fcars.js?v=1:120:7)",
         "ctx": {"v": "abc1234", "phone": True, "ua": "Safari/17 · iPhone OS 17_4", "pos": [100, -50], "rid": "secret"}}
    d.update(kw)
    return d


def fresh():
    errors._sid_hits.clear()
    errors._total.clear()
    errors._srv_last.clear()


def test_fingerprint_ignores_numbers_and_urls():
    a = errors.fingerprint("js", "Cannot read 'x' of undefined at 12:5 https://a.b/c.js?v=1", "at f (fcars.js:120:7)")
    b = errors.fingerprint("js", "Cannot read 'x' of undefined at 99:1 https://a.b/c.js?v=2", "at g (fcars.js:120:9)")
    c = errors.fingerprint("js", "Cannot read 'x' of undefined", "at f (fmain.js:10:1)")
    assert a == b and a != c


def test_report_dedup_and_summary():
    fresh()
    with TestClient(fcg.app) as tc:
        assert tc.post("/g/err", json={"sid": "sess000001", "items": [item(), item(n=3)]}).status_code == 204
        assert tc.post("/g/err", json={"sid": "sess000002", "items": [item(msg="TypeError: cars[17] is undefined")]}).status_code == 204
        r = tc.get("/g/admin/errors", headers=ADMIN)
        assert r.status_code == 200
        rows = [x for x in r.json()["items"] if x["kind"] == "js"]
        assert len(rows) == 1                                   # другое число — та же ошибка: один отпечаток
        row = rows[0]
        assert row["n"] == 5 and row["sessions"] == 2 and row["top"] == "fcars.js:120"
        assert row["devices"] == {"phone": 5} and row["versions"] == ["abc1234"]
        d = tc.get(f"/g/admin/errors/{row['fp']}", headers=ADMIN).json()
        assert len(d["recent"]) == 3 and d["recent"][0]["sid"] in ("sess000001", "sess000002")
        assert d["head"]["sample"]["ctx"]["pos"] == [100, -50]


def test_bad_input_rejected():
    fresh()
    with TestClient(fcg.app) as tc:
        assert tc.post("/g/err", content=b"not json").status_code == 400
        assert tc.post("/g/err", json={"sid": "x", "items": [item()]}).status_code == 400          # короткий sid
        assert tc.post("/g/err", json={"sid": "../../etc", "items": [item()]}).status_code == 400
        assert tc.post("/g/err", json={"sid": "sess000003"}).status_code == 400
        big = {"sid": "sess000003", "items": [item(stack="a" * 40000)]}
        assert tc.post("/g/err", json=big).status_code == 413
        # вид «server» клиенту нельзя, неизвестный вид и пустое сообщение — молча мимо
        assert tc.post("/g/err", json={"sid": "sess000003", "items": [item(kind="server"), item(kind="evil"), item(msg="")]}).status_code == 204
        assert not [x for x in tc.get("/g/admin/errors", headers=ADMIN).json()["items"] if x["kind"] in ("server", "evil")]


def test_ctx_cleaned():
    c = errors._clean_ctx({"v": "1", "nested": {"a": 1}, "long": "x" * 500, "pos": [1, 2], "big": [1, 2, 3, 4, 5], "huge": 1e12,
                           **{f"k{i}": i for i in range(40)}})
    assert "nested" not in c and len(c["long"]) == 120 and c["pos"] == [1, 2] and "big" not in c and "huge" not in c
    assert len(c) <= 24


def test_rate_limit_per_session():
    fresh()
    with TestClient(fcg.app) as tc:
        codes = [tc.post("/g/err", json={"sid": "flood00001", "items": [item(msg=f"e{i}") for i in range(20)]}).status_code
                 for _ in range(4)]
        assert codes == [204, 204, 204, 429]                    # 60 событий в час на сессию
        assert tc.post("/g/err", json={"sid": "other00001", "items": [item()]}).status_code == 204


def test_admin_needs_key():
    with TestClient(fcg.app) as tc:
        assert tc.get("/g/admin/errors").status_code == 404
        assert tc.get("/g/admin/errors", headers={"x-admin-key": "wrong"}).status_code == 404
        assert tc.get("/g/admin/errors/0123456789abcdef").status_code == 404
        assert tc.get("/g/admin/errors/zzz", headers=ADMIN).status_code == 404


def test_server_exception_recorded_once_per_window():
    fresh()

    async def boom():
        raise ValueError("сломалось 42")

    fcg.app.add_api_route("/g/__boom", boom)
    with TestClient(fcg.app, raise_server_exceptions=False) as tc:
        assert tc.get("/g/__boom").status_code == 500
        assert tc.get("/g/__boom").status_code == 500           # второй раз в окне 10 с — только счётчик
        rows = [x for x in tc.get("/g/admin/errors?kind=server", headers=ADMIN).json()["items"] if x["msg"].startswith("ValueError")]
        assert len(rows) == 1 and rows[0]["n"] == 1 and rows[0]["top"].startswith("test_errors.py:")
        assert rows[0]["devices"] == {"desktop": 1} and rows[0]["versions"] == ["server"]


def test_recent_ring_trimmed(monkeypatch):
    fresh()
    monkeypatch.setattr(errors, "RECENT_KEEP", 5)
    st = fcg.db()
    errors.ensure(st)
    for i in range(12):
        errors.record(st, "ring000001", {"kind": "js", "msg": f"m{i}", "ctx": {}})
    with st.lock:
        n = st.db.execute("SELECT count(*) FROM err_recent").fetchone()[0]
    assert n <= 6


JPG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 200).decode()


def test_problem_report_roundtrip(tmp_path, monkeypatch):
    """«Сообщить о проблеме»: код R-XXXX, текст, данные и снимок — только админке; лимит на сеанс."""
    errors._rep_hits.clear()
    errors._rep_all.clear()
    monkeypatch.setattr(fcg, "REPORTS", str(tmp_path / "rep"))
    data = {"text": "не могу пройти между домами", "player": {"x": 4519.2, "z": -3251.4, "mode": "foot"},
            "place": {"district": "Маяк Минска", "city": "minsk"}, "ctx": {"v": "abc1234"}, "log": [[1.2, "warn", "x"]]}
    with TestClient(fcg.app) as tc:
        r = tc.post("/g/report", json={"sid": "rep0000001", "data": data, "shot": JPG})
        assert r.status_code == 200, r.text
        code = r.json()["code"]
        assert code.startswith("R-") and len(code) == 6
        assert tc.get("/g/admin/reports").status_code == 404
        lst = tc.get("/g/admin/reports", headers=ADMIN).json()["items"]
        assert lst[0]["code"] == code and lst[0]["where"] == [4519.2, -3251.4] and lst[0]["district"] == "Маяк Минска"
        one = tc.get(f"/g/admin/reports/{code}", headers=ADMIN).json()
        assert one["text"] == data["text"] and one["data"]["log"] == data["log"] and one["shot"] is True
        img = tc.get(f"/g/admin/reports/{code}.jpg", headers=ADMIN)
        assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and img.content[:3] == b"\xff\xd8\xff"
        assert tc.get(f"/g/admin/reports/{code}.jpg").status_code == 404
        # не JPEG, кривой sid, слишком большой снимок — отказ
        assert tc.post("/g/report", json={"sid": "rep0000001", "data": data, "shot": base64.b64encode(b"<svg>").decode()}).status_code == 400
        assert tc.post("/g/report", json={"sid": "../x", "data": data}).status_code == 400
        assert tc.post("/g/report", json={"sid": "rep0000002", "data": data, "shot": "A" * (errors.REPORT_SHOT + 4)}).status_code == 413
        codes = [tc.post("/g/report", json={"sid": "rep0000003", "data": data}).status_code for _ in range(errors.REPORT_SID_N + 1)]
        assert codes[-1] == 429 and codes[0] == 200
