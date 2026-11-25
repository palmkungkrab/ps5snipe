from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


class SiteBlocked(Exception):
    """The site answered with a bot wall / Cloudflare block instead of real content."""


@dataclass
class Product:
    site: str
    title: str
    url: str
    available: Optional[bool]  # True = can buy, False = sold out, None = could not tell
    price: Optional[str] = None
    reason: str = ""  # how availability was decided (for logs / debugging)
    extra: dict = field(default_factory=dict)
    buy_url: Optional[str] = None  # one-tap link that puts it in the cart and opens checkout

    @property
    def status(self) -> str:
        return {True: "IN STOCK", False: "sold out", None: "unknown"}[self.available]
