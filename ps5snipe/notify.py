"""Discord webhook notifications with a user @mention."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional

import requests

from .models import Product

log = logging.getLogger(__name__)


class Discord:
    def __init__(self, webhook_url: Optional[str], user_id: Optional[str], dry_run: bool = False):
        self.webhook_url = webhook_url
        self.user_id = (user_id or "").strip() or None
        self.dry_run = dry_run or not webhook_url
        if not webhook_url:
            log.warning("DISCORD_WEBHOOK_URL not set: notifications will only be printed")

    def _post(self, payload: dict) -> bool:
        if self.dry_run:
            log.info("[dry-run] would send to Discord: %s", payload.get("content") or payload)
            return True
        for attempt in range(4):
            try:
                r = requests.post(self.webhook_url, json=payload, timeout=15)
            except requests.RequestException as e:
                log.warning("Discord post failed (%s), retrying", e)
                time.sleep(2 ** attempt)
                continue
            if r.status_code == 429:  # rate limited
                retry = float(r.json().get("retry_after", 2)) if r.headers.get("content-type", "").startswith("application/json") else 2
                time.sleep(retry)
                continue
            if r.ok:
                return True
            log.error("Discord webhook HTTP %s: %s", r.status_code, r.text[:300])
            return False
        return False

    def _mention(self) -> str:
        return f"<@{self.user_id}> " if self.user_id else ""

    def _allowed(self) -> dict:
        return {"users": [self.user_id]} if self.user_id else {"parse": []}

    def in_stock(self, p: Product) -> bool:
        embed = {
            "title": p.title[:250],
            "url": p.url,
            "color": 0x2ECC71,
            "fields": [
                {"name": "Store", "value": p.site, "inline": True},
                {"name": "Price", "value": p.price or "-", "inline": True},
                {"name": "Detected by", "value": p.reason or "-", "inline": False},
            ],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        return self._post({
            "content": f"{self._mention()}🟢 **PS5 IN STOCK at {p.site}!** {p.url}",
            "embeds": [embed],
            "allowed_mentions": self._allowed(),
        })

    def sold_out(self, p: Product) -> bool:
        return self._post({
            "content": f"🔴 Sold out again at {p.site}: {p.title} {p.url}",
            "allowed_mentions": {"parse": []},
        })

    def info(self, text: str, mention: bool = False) -> bool:
        return self._post({
            "content": (self._mention() if mention else "") + text,
            "allowed_mentions": self._allowed() if mention else {"parse": []},
        })
