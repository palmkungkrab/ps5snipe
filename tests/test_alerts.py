"""A product vanishing from a store feed, and the one-tap buy link in the ping."""
import pytest

from ps5snipe import notify
from ps5snipe.__main__ import main
from ps5snipe.checkers import browser as browser_checker
from ps5snipe.checkers import shopify as shopify_checker
from ps5snipe.matching import Matcher
from ps5snipe.models import Product
from ps5snipe.state import State

DISC = "https://shop.test/products/ps5-disc"
DIGITAL = "https://shop.test/products/ps5-digital"


class FakeResponse:
    def __init__(self, data):
        self._data = data
        self.status_code = 200
        self.ok = True
        self.url = "https://shop.test/collections/console/products.json"
        self.headers = {"content-type": "application/json"}
        self.text = ""

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


class FakeShopifySession:
    """Serves one products.json page (Shopify's real field names), then an empty page."""

    def __init__(self, products):
        self.products = products

    def get(self, url, **kwargs):
        return FakeResponse({"products": self.products if "page=1" in url else []})


def shopify_product(handle, title, variants):
    return {"id": hash(handle) & 0xFFFF, "title": title, "handle": handle, "vendor": "Sony",
            "product_type": "Console", "published_at": "2024-02-12T10:00:04+07:00",
            "variants": [{"id": vid, "title": "Default Title", "sku": f"SKU{vid}", "available": avail,
                          "price": price} for vid, avail, price in variants]}


DISC_IN = shopify_product("ps5-disc", "PlayStation®5 Console – 1TB (CFI-2118 A01)",
                          [(111, False, "19790.00"), (222, True, "19790.00")])
DIGITAL_OUT = shopify_product("ps5-digital", "PlayStation®5 Digital Edition – 825GB (CFI-2118 B01)",
                              [(333, False, "17790.00")])


# ------------------------------------------------------------ vanished from the feed
def test_vanished_product_pings_again_when_it_returns(tmp_path):
    s = State(str(tmp_path / "s.json"))
    disc, digital = Product("Sony", "Disc", DISC, True), Product("Sony", "Digital", DIGITAL, False)
    jib = Product("JIB", "PS5", "https://jib.test/ps5", True)
    for p in (disc, digital, jib):
        s.should_alert(p, 15)

    s.mark_gone("Sony", {DIGITAL})  # the disc edition is no longer in Sony's feed

    assert s.items[DISC]["available"] is False
    assert s.items["https://jib.test/ps5"]["available"] is True  # other sites untouched
    assert s.should_alert(disc, 15) is True  # back in stock 1 minute later -> ping, not 15 min of silence


def test_empty_feed_does_not_mark_everything_gone(tmp_path):
    s = State(str(tmp_path / "s.json"))
    s.should_alert(Product("Sony", "Disc", DISC, True), 15)
    s.mark_gone("Sony", set())  # zero consoles at all is a feed hiccup, not a sell-out
    assert s.items[DISC]["available"] is True


def write_config(tmp_path, site_type):
    cfg = tmp_path / "config.yaml"
    cfg.write_text(f"state_file: {(tmp_path / 's.json').as_posix()}\n"
                   f"sites:\n  - name: Shop\n    type: {site_type}\n"
                   f"    urls: [https://shop.test/collections/console]\n", encoding="utf-8")
    return str(cfg)


def test_run_marks_product_missing_from_shopify_feed_as_gone(tmp_path, monkeypatch):
    feeds = iter([[DISC_IN, DIGITAL_OUT], [DIGITAL_OUT]])
    monkeypatch.setattr(shopify_checker.requests, "Session", lambda: FakeShopifySession(next(feeds)))
    cfg = write_config(tmp_path, "shopify")

    main(["-c", cfg, "--once", "--dry-run"])
    assert State(str(tmp_path / "s.json")).items[DISC]["available"] is True
    main(["-c", cfg, "--once", "--dry-run"])
    assert State(str(tmp_path / "s.json")).items[DISC]["available"] is False


def test_run_keeps_browser_products_missing_from_listing(tmp_path, monkeypatch):
    # browser listings are capped (max_products) and lazy-loaded: missing there doesn't mean gone
    results = iter([[Product("Shop", "Disc", DISC, True)], [Product("Shop", "Digital", DIGITAL, False)]])
    monkeypatch.setattr(browser_checker, "check", lambda *a, **k: next(results))
    cfg = write_config(tmp_path, "browser")

    main(["-c", cfg, "--once", "--dry-run"])
    main(["-c", cfg, "--once", "--dry-run"])
    assert State(str(tmp_path / "s.json")).items[DISC]["available"] is True


# ------------------------------------------------------------ one-tap buy link
def test_shopify_buy_link_adds_first_buyable_variant_to_cart():
    site = {"name": "Sony", "urls": ["https://shop.test/collections/console"]}
    got = {p.url: p for p in shopify_checker.check(site, Matcher(), FakeShopifySession([DISC_IN, DIGITAL_OUT]))}
    assert got[DISC].buy_url == "https://shop.test/cart/222:1"
    assert got[DIGITAL].buy_url is None  # sold out: nothing to buy


def test_in_stock_ping_carries_buy_link(monkeypatch):
    posted = []

    def fake_post(url, json, timeout):
        posted.append(json)
        return FakeResponse({})

    monkeypatch.setattr(notify.requests, "post", fake_post)
    d = notify.Discord("https://discord.test/webhook", "42")

    d.in_stock(Product("Sony", "PS5 Disc", DISC, True, buy_url="https://shop.test/cart/222:1"))
    d.in_stock(Product("JIB", "PS5", "https://jib.test/ps5", True))

    assert "https://shop.test/cart/222:1" in posted[0]["content"]
    assert "Buy now" in posted[0]["content"]
    assert "Buy now" not in posted[1]["content"]  # no link when the store can't do one-tap checkout
