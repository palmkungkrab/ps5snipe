"""PS5 stock watcher for Thai online stores -> Discord ping.

    python -m ps5snipe                  # run forever
    python -m ps5snipe --once           # one round, print what was found
    python -m ps5snipe --test-notify    # send a test ping to Discord
"""
from __future__ import annotations

import argparse
import logging
import os
import random
import signal
import sys
import threading
import time
from pathlib import Path

import yaml

from .checkers import browser as browser_checker
from .checkers import shopify as shopify_checker
from .matching import Matcher
from .models import Product, SiteBlocked
from .notify import Discord
from .state import State

log = logging.getLogger("ps5snipe")


def load_dotenv(path: str = ".env"):
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def check_site(site: dict, matcher: Matcher, browser, debug_dir) -> list[Product]:
    kind = site.get("type", "browser")
    if kind == "shopify":
        return shopify_checker.check(site, matcher)
    if kind == "browser":
        return browser_checker.check(site, matcher, browser, debug_dir=debug_dir)
    raise ValueError(f"unknown site type {kind!r} for {site.get('name')}")


def positive_int(value: str) -> int:
    """argparse type: a whole number of 1 or more."""
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError("must be 1 or more")
    return n


def resolve_warn_after(cfg: dict, override: int | None) -> int:
    """--warn-after wins over warn_after_failures in config.yaml (default 5)."""
    return override if override is not None else int(cfg.get("warn_after_failures", 5))


def blocked_warning(name: str, error: object, fails: int) -> str:
    """Discord text when a site has blocked the checker `fails` times in a row."""
    return (f"⚠️ {name} has blocked the checker {fails} checks in a row ({error}). It is NOT being watched "
            f"right now. On GitHub this is usually a blocked server IP that clears on the next run; if it keeps "
            f"happening, run ps5snipe from a home connection. On a home PC, run once with --headful to get past "
            f"the check.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="ps5snipe", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-c", "--config", default="config.yaml")
    ap.add_argument("--once", action="store_true", help="check every site once, print results, exit")
    ap.add_argument("--site", action="append", help="only check sites with this name (repeatable)")
    ap.add_argument("--test-notify", action="store_true", help="send a test message to Discord and exit")
    ap.add_argument("--dry-run", action="store_true", help="don't post to Discord, just log")
    ap.add_argument("--debug-dir", help="save HTML+screenshot of pages where stock could not be determined")
    ap.add_argument("--headful", action="store_true", help="show the browser window (helps with Cloudflare)")
    ap.add_argument("--duration", type=float, default=0,
                    help="stop after this many seconds (for scheduled runs, e.g. GitHub Actions)")
    ap.add_argument("--no-start-message", action="store_true", help="don't post the 'started' message to Discord")
    ap.add_argument("--warn-after", type=positive_int,
                    help="warn on Discord after N failures in a row (overrides warn_after_failures)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.CRITICAL)  # playwright noise on Ctrl+C

    load_dotenv()
    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    discord = Discord(os.environ.get("DISCORD_WEBHOOK_URL"), os.environ.get("DISCORD_USER_ID"),
                      dry_run=args.dry_run)

    if args.test_notify:
        ok = discord.in_stock(Product("TEST", "Test notification from ps5snipe (not a real restock)",
                                      "https://store.sony.co.th/collections/playstation", True,
                                      price="฿0", reason="--test-notify"))
        print("sent" if ok else "FAILED (check the webhook URL)")
        return 0 if ok else 1

    matcher = Matcher.from_config(cfg.get("match"))
    sites = [s for s in cfg["sites"] if s.get("enabled", True)]
    if args.site:
        wanted = {n.lower() for n in args.site}
        sites = [s for s in cfg["sites"] if s["name"].lower() in wanted]
    if not sites:
        log.error("no sites to check")
        return 1

    bcfg = dict(cfg.get("browser", {}))
    if args.headful:
        bcfg["headless"] = False
    browser = browser_checker.Browser(bcfg)
    state = State(cfg.get("state_file", "state.json"))
    default_interval = float(cfg.get("interval_seconds", 60))
    renotify = float(cfg.get("renotify_minutes", 15))
    warn_after = resolve_warn_after(cfg, args.warn_after)
    notify_sold_out = bool(cfg.get("notify_sold_out", False))
    next_run = {s["name"]: 0.0 for s in sites}

    stop = {"flag": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))

    if not args.once:
        log.info("watching %d sites: %s", len(sites), ", ".join(s["name"] for s in sites))
        if not args.no_start_message:
            discord.info(f"👀 ps5snipe started, watching: {', '.join(s['name'] for s in sites)}")

    lock = threading.Lock()

    def run_site(site: dict):
        name = site["name"]
        t0 = time.time()
        try:
            products = check_site(site, matcher, browser, args.debug_dir)
        except SiteBlocked as e:
            with lock:
                fails = state.site_result(name, False, str(e))
            log.warning("%s: BLOCKED (%s) [%d in a row]", name, e, fails)
            if fails == warn_after:
                discord.info(blocked_warning(name, e, fails))
            return
        except Exception as e:
            with lock:
                fails = state.site_result(name, False, repr(e))
            log.warning("%s: error %r [%d in a row]", name, e, fails)
            if site.get("type", "browser") == "browser" and "closed" in str(e).lower():
                browser.close()  # browser crashed: relaunch on the next check
            if args.verbose:
                log.exception("traceback")
            if fails == warn_after:
                discord.info(f"⚠️ {name} check has failed {fails} times in a row: {e!r}")
            return

        summary = {True: 0, False: 0, None: 0}
        with lock:
            state.site_result(name, True)
            for p in products:
                summary[p.available] += 1
                if args.once or args.verbose:
                    log.info("  [%-8s] %s | %s | %s | %s", p.status, p.site, p.title[:70], p.price or "-", p.reason)
                if state.should_alert(p, renotify):
                    log.info("🟢 IN STOCK: %s %s %s", p.site, p.title, p.url)
                    discord.in_stock(p)
                elif notify_sold_out and state.just_sold_out(p):
                    discord.sold_out(p)
            state.save()
        log.info("%s: %d consoles (%d in stock, %d sold out, %d unknown) in %.1fs",
                 name, len(products), summary[True], summary[False], summary[None], time.time() - t0)
        if not products:
            log.warning("%s: no PS5 consoles found on the page(s) - check URLs / run with --debug-dir debug", name)

    deadline = time.time() + args.duration if args.duration > 0 else 0

    def loop(group: list):
        """Run each site in `group` whenever its interval is up."""
        while not stop["flag"]:
            if deadline and time.time() >= deadline:
                return
            for site in group:
                if stop["flag"]:
                    break
                if time.time() < next_run[site["name"]]:
                    continue
                interval = float(site.get("interval_seconds", default_interval))
                next_run[site["name"]] = time.time() + interval * random.uniform(0.85, 1.15)
                run_site(site)
            if args.once:
                return
            time.sleep(1)

    # Fast HTTP sites (Shopify) get their own thread so slow browser sites never delay them.
    # Playwright's sync API is single-threaded, so all browser sites share the main thread.
    http_sites = [s for s in sites if s.get("type") == "shopify"]
    browser_sites = [s for s in sites if s.get("type") != "shopify"]
    worker = None
    if http_sites:
        worker = threading.Thread(target=loop, args=(http_sites,), daemon=True, name="http-sites")
        worker.start()
    try:
        loop(browser_sites)
        while worker and worker.is_alive() and (args.once or not browser_sites):
            worker.join(1)
    except KeyboardInterrupt:
        stop["flag"] = True
    finally:
        stop["flag"] = True
        if worker:
            worker.join(30)
        browser.close()
        with lock:
            state.save()
    return 0


if __name__ == "__main__":
    sys.exit(main())
