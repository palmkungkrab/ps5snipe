"""Decide whether a product title is a PS5 *console* (not a game, controller, cover ...)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List


DEFAULT_INCLUDE = [
    r"play\s*station\s*®?\s*5",
    r"\bps\s*5\b",
]

# At least one of these must also match, so games/accessories that merely
# mention "PS5" are skipped.
DEFAULT_REQUIRE = [
    r"console",
    r"คอนโซล",
    r"เครื่องเล่นเกม",
    r"\bcfi-\d{4}",          # console model numbers, e.g. CFI-2018, CFI-7018 (Pro)
    r"\basia-\d{5}\b",       # Sony TH bundle SKUs, e.g. ASIA-00480
    r"\bps\s*5\s*pro\b",
    r"playstation\s*®?\s*5\s*pro",
    r"\bslim\b.*\b(digital|disc)\b",
    r"\b(digital|disc)\s+edition\b",
]

DEFAULT_EXCLUDE = [
    r"disc\s*drive", r"ไดรฟ์", r"vertical\s*stand", r"ขาตั้ง", r"\bstand\b",
    r"\bcover\b", r"ฝาครอบ", r"\bcase\b", r"เคส", r"\bskin\b", r"สติ๊กเกอร์", r"ฟิล์ม",
    r"charging", r"charger", r"แท่นชาร์จ", r"headset", r"หูฟัง", r"\bpulse\b",
    r"\bvr\s*2\b", r"portal", r"แผ่นเกม", r"\becas-", r"\bpcas-", r"\bcfi-z",
    r"remote", r"รีโมท", r"cooling", r"พัดลม", r"\bbag\b", r"กระเป๋า",
]


@dataclass
class Matcher:
    include: List[str] = field(default_factory=lambda: list(DEFAULT_INCLUDE))
    require: List[str] = field(default_factory=lambda: list(DEFAULT_REQUIRE))
    exclude: List[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDE))

    def __post_init__(self):
        flags = re.IGNORECASE
        self._inc = [re.compile(p, flags) for p in self.include]
        self._req = [re.compile(p, flags) for p in self.require]
        self._exc = [re.compile(p, flags) for p in self.exclude]

    @classmethod
    def from_config(cls, cfg: dict | None) -> "Matcher":
        cfg = cfg or {}
        m = cls()
        if "include" in cfg:
            m.include = list(cfg["include"])
        if "require" in cfg:
            m.require = list(cfg["require"])
        m.exclude = list(cfg.get("exclude", m.exclude)) + list(cfg.get("extra_exclude", []))
        m.__post_init__()
        return m

    def is_console(self, title: str) -> bool:
        t = " ".join((title or "").split())
        if not t:
            return False
        if not any(r.search(t) for r in self._inc):
            return False
        if self._req and not any(r.search(t) for r in self._req):
            return False
        return not any(r.search(t) for r in self._exc)
