"""Generic checker for normal web shops, driven by a real Chromium (Playwright).

Works for sites behind Cloudflare (Powerbuy, Banana, dotlife ...) as long as the
machine running it is not on a blocked IP. A home connection in Thailand is best.

How it works:
  1. Open each listing/category/search URL, collect every link whose text looks
     like a PS5 console (see matching.py).
  2. Open each product page (plus any `product_urls` from config) and decide
     availability, in this order:
       a. site-specific CSS selectors from config (in_stock_selector / out_of_stock_selector)
       b. schema.org JSON-LD / microdata `availability`   (most shops have it)
       c. "sold out" badges or buy buttons close to the product title (Thai + English)
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Iterable, List, Optional
from urllib.parse import urldefrag, urlsplit

from ..matching import Matcher
from ..models import Product, SiteBlocked

log = logging.getLogger(__name__)

OOS_RE = re.compile(
    r"สินค้าหมด|หมดชั่วคราว|หมดสต็อก|หมดสต๊อก|ไม่มีสินค้า|สินค้าไม่พร้อมจำหน่าย|แจ้งเตือนเมื่อ(?:สินค้า|มีสินค้า)"
    r"|out\s*of\s*stock|sold\s*out|currently\s*unavailable|not\s*available|notify\s*me|temporarily\s*unavailable",
    re.I,
)
BUY_RE = re.compile(
    r"เพิ่ม(?:ลง|ใส่)?(?:ใน)?(?:รถเข็น|ตะกร้า)|หยิบใส่ตะกร้า|ใส่ตะกร้า|ใส่รถเข็น|ซื้อเลย|ซื้อทันที|ซื้อสินค้า|สั่งซื้อ|จองเลย|สั่งจอง|พรีออเดอร์"
    r"|add\s*to\s*(?:cart|bag|basket)|buy\s*(?:it\s*)?now|pre-?order|checkout",
    re.I,
)
BLOCK_TITLES = re.compile(r"just a moment|attention required|access denied|verify you are human|"
                          r"please wait|security check|ddos|captcha|robot", re.I)

IN_STOCK_SCHEMA = ("instock", "preorder", "presale", "limitedavailability", "onlineonly", "instoreonly", "backorder")
OUT_SCHEMA = ("outofstock", "soldout", "discontinued")

COLLECT_LINKS_JS = r"""
() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const img = a.querySelector('img');
    const label = [a.innerText, a.getAttribute('title'), a.getAttribute('aria-label'), img && img.getAttribute('alt')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    let card = a;
    for (let i = 0; i < 6 && card.parentElement; i++) {
      if ((card.parentElement.innerText || '').length > 700) break;
      card = card.parentElement;
    }
    out.push({href: a.href, label: label.slice(0, 300),
              card: (card.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 700)});
  }
  return out;
}
"""

PRODUCT_PAGE_JS = r"""
(sel) => {
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const top = (el) => el.getBoundingClientRect().top + window.scrollY;
  const res = {ld: [], micro: [], buttons: [], badges: [], h1: '', title: document.title, sel_in: null, sel_out: null};
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) res.ld.push(s.textContent);
  for (const m of document.querySelectorAll('[itemprop=availability], meta[property$="availability"], meta[name$="availability"]'))
    res.micro.push(m.getAttribute('content') || m.getAttribute('href') || m.textContent || '');
  const h1 = document.querySelector('h1');
  res.h1 = h1 ? h1.innerText.replace(/\s+/g, ' ').trim() : '';
  const anchor = h1 && vis(h1) ? top(h1) : 0;
  const near = (el) => Math.abs(top(el) - anchor) < 1200;
  for (const b of document.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a[class*=cart], a[class*=buy], a[id*=cart], a[id*=buy]')) {
    if (!vis(b) || !near(b)) continue;
    const s = getComputedStyle(b);
    const disabled = !!(b.disabled || b.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/i.test(b.className) || s.pointerEvents === 'none');
    res.buttons.push({text: (b.innerText || b.value || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80), disabled});
  }
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 3) continue;
    const t = (el.innerText || '').trim();
    if (!t || t.length > 60) continue;
    if (!vis(el) || !near(el)) continue;
    res.badges.push(t.replace(/\s+/g, ' '));
    if (res.badges.length > 400) break;
  }
  if (sel.in_stock) { const e = document.querySelector(sel.in_stock); res.sel_in = !!(e && vis(e)); }
  if (sel.out_of_stock) { const e = document.querySelector(sel.out_of_stock); res.sel_out = !!(e && vis(e)); }
  return res;
}
"""


# ---------------------------------------------------------------- JSON-LD helpers
def _walk(obj) -> Iterable[dict]:
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _types(d: dict) -> List[str]:
    t = d.get("@type", [])
    return [x.lower() for x in (t if isinstance(t, list) else [t]) if isinstance(x, str)]


def parse_jsonld(blobs: List[str]) -> tuple[Optional[bool], Optional[str], Optional[str]]:
    """Return (available, price, name) from schema.org Product data."""
    avail_values, price, name = [], None, None
    for raw in blobs:
        try:
            data = json.loads(raw.strip())
        except (ValueError, AttributeError):
            continue
        for node in _walk(data):
            if "product" in _types(node) or "productgroup" in _types(node):
                name = name or node.get("name")
            if "availability" in node:
                avail_values.append(str(node["availability"]))
                p = node.get("price") or node.get("lowPrice")
                if p and not price:
                    price = f"฿{p}"
    return _decide_schema(avail_values), price, name


def _decide_schema(values: List[str]) -> Optional[bool]:
    norm = [v.lower().rsplit("/", 1)[-1].replace("_", "").replace(" ", "") for v in values if v]
    if any(v in IN_STOCK_SCHEMA for v in norm):
        return True
    if any(v in OUT_SCHEMA for v in norm):
        return False
    return None


def decide_from_page(info: dict) -> tuple[Optional[bool], str]:
    """Pure function (unit-tested) turning the scraped page info into a verdict."""
    if info.get("sel_out"):
        return False, "out_of_stock_selector matched"
    if info.get("sel_in"):
        return True, "in_stock_selector matched"
    avail, _, _ = parse_jsonld(info.get("ld", []))
    if avail is not None:
        return avail, "schema.org JSON-LD"
    micro = _decide_schema(info.get("micro", []))
    if micro is not None:
        return micro, "schema.org microdata"
    buttons = info.get("buttons", [])
    if any(OOS_RE.search(b["text"]) for b in buttons):
        return False, "sold-out button"
    if any(OOS_RE.search(t) for t in info.get("badges", [])):
        return False, "sold-out label near title"
    if any(BUY_RE.search(b["text"]) and not b["disabled"] for b in buttons):
        return True, "enabled buy button"
    if any(BUY_RE.search(b["text"]) and b["disabled"] for b in buttons):
        return False, "buy button disabled"
    return None, "no stock signal found"


def guess_from_card(text: str) -> Optional[bool]:
    if OOS_RE.search(text or ""):
        return False
    if BUY_RE.search(text or ""):
        return True
    return None


# ---------------------------------------------------------------- browser driver
class Browser:
    """One persistent Chromium shared by all browser-based sites."""

    def __init__(self, cfg: dict):
        self.cfg = cfg or {}
        self._pw = None
        self._ctx = None

    def _start(self):
        from playwright.sync_api import sync_playwright  # imported lazily: optional dependency

        self._pw = sync_playwright().start()
        profile = Path(self.cfg.get("profile_dir", "browser-profile")).resolve()
        profile.mkdir(parents=True, exist_ok=True)
        kwargs = dict(
            user_data_dir=str(profile),
            headless=bool(self.cfg.get("headless", True)),
            locale="th-TH",
            timezone_id="Asia/Bangkok",
            viewport={"width": 1366, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        exe = self.cfg.get("executable_path") or os.environ.get("PS5SNIPE_CHROMIUM")
        if exe:
            kwargs["executable_path"] = exe
        elif self.cfg.get("channel"):
            kwargs["channel"] = self.cfg["channel"]  # e.g. "chrome" to use installed Google Chrome
        self._ctx = self._pw.chromium.launch_persistent_context(**kwargs)
        self._ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        if self.cfg.get("block_images", True):
            self._ctx.route("**/*", lambda route: route.abort()
                            if route.request.resource_type in ("image", "media", "font") else route.continue_())

    @property
    def ctx(self):
        if self._ctx is None:
            self._start()
        return self._ctx

    def close(self):
        """Shut the browser down (never raises). The next open() starts a fresh one."""
        for fn in (lambda: self._ctx and self._ctx.close(), lambda: self._pw and self._pw.stop()):
            try:
                fn()
            except Exception as e:
                log.debug("browser close: %s", e)
        self._ctx = self._pw = None

    def open(self, url: str, wait_ms: int = 2500, settle: bool = True):
        page = self.ctx.new_page()
        resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
        # give Cloudflare's JS challenge a moment to clear
        deadline = time.time() + 20
        while BLOCK_TITLES.search(page.title() or "") and time.time() < deadline:
            page.wait_for_timeout(1000)
        if BLOCK_TITLES.search(page.title() or "") or (resp is not None and resp.status in (403, 429, 503)
                                                        and "cloudflare" in (page.content()[:20000].lower())):
            status = resp.status if resp is not None else "?"
            page.close()
            raise SiteBlocked(f"bot protection on {url} (HTTP {status})")
        if settle:
            self.settle(page, wait_ms)
        return page

    @staticmethod
    def settle(page, wait_ms: int):
        """Wait for client-side rendering (React/Vue shops) to finish."""
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        page.wait_for_timeout(wait_ms)


def _same_site(href: str, site_urls: List[str]) -> bool:
    host = urlsplit(href).netloc.lower().removeprefix("www.")
    return any(host.endswith(urlsplit(u).netloc.lower().removeprefix("www.")) for u in site_urls)


def _dump_debug(page, site: str, label: str, debug_dir: Optional[str]):
    if not debug_dir:
        return
    d = Path(debug_dir)
    d.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^a-zA-Z0-9]+", "_", f"{site}_{label}")[:80]
    try:
        (d / f"{stem}.html").write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(d / f"{stem}.png"), full_page=False)
    except Exception as e:  # debugging must never break checking
        log.debug("debug dump failed: %s", e)


def check(site: dict, matcher: Matcher, browser: Browser, debug_dir: Optional[str] = None) -> List[Product]:
    name = site["name"]
    sel = {"in_stock": site.get("in_stock_selector"), "out_of_stock": site.get("out_of_stock_selector")}
    max_products = int(site.get("max_products", 12))
    verify = site.get("verify_product_pages", True)

    # url -> (title, card guess)
    candidates: dict[str, tuple[str, Optional[bool]]] = {}
    for url in site.get("product_urls", []) or []:
        candidates[url] = ("", None)

    for listing in site.get("urls", []) or []:
        page = browser.open(listing, wait_ms=int(site.get("wait_ms", 2500)))
        try:
            for _ in range(int(site.get("scrolls", 3))):  # trigger lazy loading
                page.mouse.wheel(0, 2500)
                page.wait_for_timeout(700)
            links = page.evaluate(COLLECT_LINKS_JS)
            found = 0
            for link in links:
                href = urldefrag(link["href"])[0]
                if not href.startswith("http") or not _same_site(href, site["urls"]) or href == listing:
                    continue
                if not (site.get("watch_all") or matcher.is_console(link["label"])):
                    continue
                prev_title = candidates.get(href, ("", None))[0]
                title = link["label"] if len(link["label"]) > len(prev_title) else prev_title
                candidates[href] = (title, guess_from_card(link["card"]))
                found += 1
            log.debug("%s: %d console links on %s (of %d links)", name, found, listing, len(links))
            if not found:
                _dump_debug(page, name, "listing_no_match", debug_dir)
        finally:
            page.close()

    results: List[Product] = []
    for url, (title, card_guess) in list(candidates.items())[:max_products]:
        if not verify:
            results.append(Product(name, title, url, card_guess, reason="listing card text"))
            continue
        try:
            page = browser.open(url, settle=False)
        except SiteBlocked:
            raise
        except Exception as e:
            log.warning("%s: failed to open %s: %s", name, url, e)
            results.append(Product(name, title or url, url, card_guess, reason=f"listing card (page error: {e})"))
            continue
        try:
            # Fast path: most shops put schema.org data in the server HTML.
            page.wait_for_timeout(500)
            info = page.evaluate(PRODUCT_PAGE_JS, sel)
            available, reason = decide_from_page(info)
            if available is None or not reason.startswith(("schema", "in_stock_sel", "out_of_stock_sel")):
                # client-rendered page or only visual hints: let it finish rendering and look again
                browser.settle(page, int(site.get("wait_ms", 2500)))
                info = page.evaluate(PRODUCT_PAGE_JS, sel)
                available, reason = decide_from_page(info)
            _, price, ld_name = parse_jsonld(info.get("ld", []))
            real_title = ld_name or info.get("h1") or title or info.get("title") or url
            if available is None and card_guess is not None:
                available, reason = card_guess, "listing card text"
            if available is None:
                _dump_debug(page, name, "product_unknown_" + url.rsplit("/", 1)[-1], debug_dir)
            # A product_url given in config is checked regardless of its title.
            results.append(Product(name, real_title, url, available, price=price, reason=reason))
        finally:
            page.close()
    return results
