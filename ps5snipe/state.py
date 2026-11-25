"""Remembers what was in stock so you're pinged on changes, not on every poll."""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from .models import Product

log = logging.getLogger(__name__)


class State:
    def __init__(self, path: str = "state.json"):
        self.path = Path(path)
        self.items: dict = {}
        self.sites: dict = {}
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
                self.items, self.sites = data.get("items", {}), data.get("sites", {})
            except (ValueError, OSError) as e:
                log.warning("could not read %s (%s), starting fresh", self.path, e)

    def save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"items": self.items, "sites": self.sites}, ensure_ascii=False, indent=1),
                       encoding="utf-8")
        os.replace(tmp, self.path)

    def should_alert(self, p: Product, renotify_minutes: float) -> bool:
        """True when the product just came in stock, or is still in stock after the re-notify period."""
        now = time.time()
        rec = self.items.setdefault(p.url, {})
        was = rec.get("available")
        rec.update(title=p.title, site=p.site, seen=now)
        if p.available is None:  # couldn't tell this time: keep the last known state, don't flap
            return False
        rec["available"] = p.available
        if p.available is not True:
            if was is True:
                rec["went_out"] = now
            return False
        last = rec.get("notified", 0)
        if was is not True or (renotify_minutes > 0 and now - last >= renotify_minutes * 60):
            rec["notified"] = now
            return True
        return False

    def mark_gone(self, site: str, seen_urls: set) -> None:
        """Products of `site` missing from a complete feed can't be bought: count them as sold out,
        so they ping again the moment they come back. An empty feed is a hiccup, not a sell-out."""
        if not seen_urls:
            return
        now = time.time()
        for url, rec in self.items.items():
            if rec.get("site") == site and url not in seen_urls and rec.get("available") is True:
                rec["available"] = False
                rec["went_out"] = now

    def just_sold_out(self, p: Product) -> bool:
        rec = self.items.get(p.url, {})
        return p.available is False and rec.get("went_out", 0) >= rec.get("seen", 0) - 1

    def site_result(self, site: str, ok: bool, error: str = "") -> int:
        """Track consecutive failures per site; returns the current failure streak."""
        rec = self.sites.setdefault(site, {"fails": 0})
        rec["fails"] = 0 if ok else rec.get("fails", 0) + 1
        rec["last_error"] = error
        if ok:
            rec.pop("warned", None)
        return rec["fails"]
