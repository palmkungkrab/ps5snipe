"""Shopify stores (store.sony.co.th) expose a public JSON feed with per-variant stock."""
from __future__ import annotations

import logging
from typing import List
from urllib.parse import urlsplit

import requests

from ..matching import Matcher
from ..models import Product, SiteBlocked

log = logging.getLogger(__name__)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


def _feed_url(collection_url: str, page: int) -> str:
    parts = urlsplit(collection_url)
    path = parts.path.rstrip("/")
    return f"{parts.scheme}://{parts.netloc}{path}/products.json?limit=250&page={page}"


def check(site: dict, matcher: Matcher, session: requests.Session | None = None) -> List[Product]:
    session = session or requests.Session()
    name = site["name"]
    products: dict[str, Product] = {}

    for collection_url in site["urls"]:
        base = "{0.scheme}://{0.netloc}".format(urlsplit(collection_url))
        for page in range(1, 6):
            r = session.get(_feed_url(collection_url, page), timeout=20,
                            headers={"User-Agent": UA, "Accept": "application/json"})
            if r.status_code in (403, 429, 503):
                raise SiteBlocked(f"HTTP {r.status_code} from {r.url}")
            r.raise_for_status()
            items = r.json().get("products", [])
            if not items:
                break
            for p in items:
                title = p.get("title", "")
                if not (site.get("watch_all") or matcher.is_console(title)):
                    continue
                variants = p.get("variants") or []
                # price 0.00 = placeholder listings, not really buyable
                buyable = [v for v in variants if v.get("available") and float(v.get("price") or 0) > 0]
                prices = sorted({v.get("price") for v in variants if v.get("price")})
                url = f"{base}/products/{p['handle']}"
                products[url] = Product(
                    site=name, title=title, url=url,
                    available=bool(buyable),
                    price=(f"฿{prices[0]}" if prices else None),
                    reason=f"shopify variants available={len(buyable)}/{len(variants)}",
                    # Shopify cart permalink: adds the variant and goes straight to checkout
                    # https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks
                    buy_url=(f"{base}/cart/{buyable[0]['id']}:1" if buyable else None),
                )
            if len(items) < 250:
                break
    return list(products.values())
