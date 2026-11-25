import json
import time

import pytest

from ps5snipe.__main__ import blocked_warning, main, resolve_warn_after
from ps5snipe.checkers.browser import decide_from_page, guess_from_card, parse_jsonld
from ps5snipe.matching import Matcher
from ps5snipe.models import Product
from ps5snipe.state import State


def test_matcher_consoles():
    m = Matcher()
    yes = [
        "PlayStation®5 Console – 1TB (CFI-2118 A01)",
        "PlayStation®5 Digital Edition – 825GB (CFI-2118 B01)",
        "New PlayStation 5 Console (SLIM) - Digital Edition 2nd DualSense bundle (ASIA-00480)",
        "SONY เครื่องเล่นเกมคอนโซล PlayStation 5 Slim Digital Edition (1TB)",
        "GAME CONSOLE (เครื่องเล่นเกมคอนโซล) SONY PLAYSTATION 5 PRO - 2TB NEW MODEL",
        "PS5 Pro 2TB",
    ]
    no = [
        "PlayStation 5 Disc Drive (SLIM) (CFI-ZDD1G)",
        "PlayStation 5  Vertical Stand (SLIM) (CFI-ZVS1P)",
        "DualSense® Wireless Controller: CFI-ZCT1G (Metallic color)",
        "PlayStation®VR2 : CFI-ZVR1 G",
        "PlayStation®5 Spider-Man 2 Standard Edition (ECAS-00050E)",
        "SONY แผ่นเกม PS5 Spider-Man 2",
        "PlayStation Portal Remote Player",
        "Xbox Series X Console",
        "เคส PS5 Slim Digital Edition",
    ]
    for t in yes:
        assert m.is_console(t), t
    for t in no:
        assert not m.is_console(t), t


def test_matcher_extra_exclude():
    m = Matcher.from_config({"extra_exclude": [r"\bpro\b"]})
    assert not m.is_console("PS5 Pro 2TB")
    assert m.is_console("PlayStation®5 Console – 1TB (CFI-2118 A01)")


def ld(avail, price="20990"):
    return json.dumps({"@context": "https://schema.org", "@type": "Product", "name": "PS5",
                       "offers": {"@type": "Offer", "price": price, "availability": avail}})


def test_jsonld():
    assert parse_jsonld([ld("https://schema.org/InStock")]) == (True, "฿20990", "PS5")
    assert parse_jsonld([ld("http://schema.org/OutOfStock")])[0] is False
    assert parse_jsonld([ld("PreOrder")])[0] is True
    assert parse_jsonld(["not json", "{}"])[0] is None
    graph = json.dumps({"@graph": [{"@type": "Product", "name": "x",
                                    "offers": [{"@type": "Offer", "availability": "OutOfStock"},
                                               {"@type": "Offer", "availability": "InStock"}]}]})
    assert parse_jsonld([graph])[0] is True


def test_decide_from_page_priority():
    base = {"ld": [], "micro": [], "buttons": [], "badges": []}
    assert decide_from_page({**base, "ld": [ld("InStock")], "badges": ["สินค้าหมด"]})[0] is True
    assert decide_from_page({**base, "sel_out": True, "ld": [ld("InStock")]})[0] is False
    assert decide_from_page({**base, "micro": ["http://schema.org/OutOfStock"]})[0] is False
    assert decide_from_page({**base, "buttons": [{"text": "สินค้าหมดชั่วคราว", "disabled": False}]})[0] is False
    assert decide_from_page({**base, "buttons": [{"text": "เพิ่มลงรถเข็น", "disabled": False}]})[0] is True
    assert decide_from_page({**base, "buttons": [{"text": "Add to Cart", "disabled": True}]})[0] is False
    assert decide_from_page({**base, "buttons": [{"text": "ซื้อเลย", "disabled": False}],
                             "badges": ["Out of stock"]})[0] is False
    assert decide_from_page(base)[0] is None


def test_card_guess():
    assert guess_from_card("PS5 Pro ฿25,990 สินค้าหมดชั่วคราว") is False
    assert guess_from_card("PS5 Pro ฿25,990 เพิ่มลงตะกร้า") is True
    assert guess_from_card("PS5 Pro ฿25,990") is None


def test_state_alerts(tmp_path, monkeypatch):
    s = State(str(tmp_path / "s.json"))
    p = lambda a: Product("Shop", "PS5", "https://x/ps5", a)
    assert s.should_alert(p(False), 15) is False
    assert s.should_alert(p(True), 15) is True      # came in stock -> ping
    assert s.should_alert(p(True), 15) is False     # still in stock -> quiet
    now = time.time()
    monkeypatch.setattr(time, "time", lambda: now + 16 * 60)
    assert s.should_alert(p(True), 15) is True      # re-notify after 15 min
    assert s.should_alert(p(None), 15) is False
    assert s.should_alert(p(True), 15) is False     # unknown blip doesn't cause a re-ping
    assert s.should_alert(p(False), 15) is False
    assert s.just_sold_out(p(False)) is True
    s.save()
    assert State(str(tmp_path / "s.json")).items["https://x/ps5"]["available"] is False


def test_resolve_warn_after():
    assert resolve_warn_after({}, None) == 5
    assert resolve_warn_after({"warn_after_failures": 7}, None) == 7
    assert resolve_warn_after({"warn_after_failures": 7}, 10) == 10


def test_warn_after_rejects_non_positive(capsys):
    # --dry-run: if validation ever breaks, --test-notify must not post to a real webhook
    for bad in ("0", "-3"):
        with pytest.raises(SystemExit):
            main(["--warn-after", bad, "--test-notify", "--dry-run"])
        assert "must be 1 or more" in capsys.readouterr().err


def test_blocked_warning_text():
    err = "bot protection on https://www.jib.co.th/x (HTTP 403)"
    msg = blocked_warning("JIB", err, 10)
    assert msg.startswith("⚠️ JIB has blocked the checker 10 checks in a row (")
    assert err in msg
    assert "NOT being watched" in msg
    assert "home connection" in msg
    assert "--headful" not in msg
