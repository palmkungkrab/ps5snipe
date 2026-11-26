# ps5snipe 🎮

Watches Thai online stores for **PS5 console** restocks and pings you on **Discord** (with an `@mention`) the moment one can be bought.

| Store | How it's checked | Status |
|---|---|---|
| [Sony Store TH](https://store.sony.co.th/collections/playstation) | Shopify JSON feed, every ~30s | ✅ works on GitHub Actions; ❌ HTTP 429 from our Thai home IP |
| [JIB](https://www.jib.co.th/) | GitHub Actions (headless Chromium + schema.org stock data) **and** the laptop browser | ✅ works on both (watched twice on purpose) |
| [Powerbuy](https://www.powerbuy.co.th/th/category/game/game-console/playstation) | real Chrome tab on the laptop (userscript) | ✅ real Chrome gets through; headless Chromium is blocked |
| [Banana IT](https://www.bnn.in.th/th/p/gaming-gear/console/playstation-0) | real Chrome tab on the laptop (userscript) | ✅ real Chrome gets through; blocks GitHub |
| [dotlife](https://www.dotlife.store/) | headless Chromium | ❌ Cloudflare blocks it even from a Thai home IP (off) |
| Lazada | headless Chromium | 🧪 disabled by default (captcha-heavy) |

Powerbuy, Banana and dotlife are the official PS5 retailers listed on
[playstation.com/th-th/ps5/buy-now](https://www.playstation.com/th-th/ps5/buy-now/). They block cloud/datacenter IPs
and automated browsers. dotlife stays off.

**Who watches what:** GitHub Actions = Sony Store TH + JIB. The laptop browser = Powerbuy + Banana IT + JIB.
JIB is watched twice on purpose, so a JIB restock can ping twice. Every ping is labelled 💻 laptop or ☁️ GitHub.
The old Python laptop runner is retired. (`config.yaml` keeps every site `enabled: false`; GitHub picks its
sites with `--site`, which ignores `enabled`.)

Only **consoles** trigger alerts. Games, controllers, covers, stands, disc drives, VR2 and Portal are ignored
(see `ps5snipe/matching.py`).

## Setup

Requires Python 3.10+.

```bash
git clone <this repo> && cd ps5snipe
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
```

### Discord

1. In your server: **Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL**
2. Get your user ID: **User Settings → Advanced → Developer Mode ON**, then right-click your name → **Copy User ID**
3. Copy `.env.example` to `.env` and fill both values in:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_USER_ID=123456789012345678
```

4. Check it works: `python -m ps5snipe --test-notify` (you should get a ping).

> **Retired:** the laptop now runs the browser userscript instead (see [Laptop browser watcher](#laptop-browser-watcher)).
> The Run, 24/7 and Windows-task sections below describe the old Python laptop runner. They are kept for reference;
> every site in `config.yaml` is now `enabled: false`, so a bare `python -m ps5snipe` has nothing to check.

## Run

```bash
python -m ps5snipe --once          # one pass over every site, prints what it sees
python -m ps5snipe                 # run forever (Ctrl+C to stop)
python -m ps5snipe --site Powerbuy --once -v --debug-dir debug   # troubleshoot one site
```

What you get:
- 🟢 an `@you` ping with the product link and price when a console **comes into stock**,
  and again every `renotify_minutes` (default 15) while it stays in stock.
- ⚠️ a message (no ping) if a site keeps blocking or failing (`warn_after_failures`, or `--warn-after N` for one run), so you know it's not being watched.
- 👀 a startup message, so you know it's running.

### If Powerbuy / Banana show "BLOCKED"

1. Run once with a visible browser: `python -m ps5snipe --site Powerbuy --once --headful`.
   If Cloudflare asks for a click, do it. The cookie is saved in `browser-profile/` and reused.
2. Use real Google Chrome instead of bundled Chromium: set `channel: chrome` under `browser:` in `config.yaml`.
3. Make sure you're not on a VPN or cloud server.

### Keep it running 24/7

- **Windows:** from an **Administrator** PowerShell run `powershell -ExecutionPolicy Bypass -File setup-windows-task.ps1` once.
  It creates the task `ps5snipe`: it starts `run-windows.cmd` a minute after boot (no need to log in), never times out,
  keeps running on battery, and restarts ps5snipe a minute after any exit. Output goes to `logs\ps5snipe.log`.
  Only one copy can run at a time (they share `browser-profile/`), so `Stop-ScheduledTask -TaskName ps5snipe` before
  running ps5snipe by hand, and `Start-ScheduledTask -TaskName ps5snipe` afterwards.
- **Linux / Raspberry Pi:** a systemd service, or simply `tmux` / `screen`:

```ini
# /etc/systemd/system/ps5snipe.service
[Service]
WorkingDirectory=/home/pi/ps5snipe
ExecStart=/home/pi/ps5snipe/.venv/bin/python -m ps5snipe
Restart=always
[Install]
WantedBy=multi-user.target
```

## GitHub Actions: Sony Store TH + JIB

`.github/workflows/watch.yml` runs every 5 minutes on GitHub and keeps checking **Sony Store TH and JIB**
for 6 minutes per run (Sony ~every 30s, JIB ~every 60s). Runs overlap on purpose: the next one is already
checking before the previous one stops, so there is no blind gap between runs (a drop during the overlap may
ping twice). Powerbuy/Banana/dotlife block GitHub's servers, so they are covered by the laptop browser watcher (Powerbuy, Banana IT; dotlife is off).

JIB occasionally blocks a single run: each run gets a fresh GitHub server, and some of their IPs are on JIB's
blocklist. The next run usually gets a clean IP, so the workflow passes `--warn-after 10`. Because runs
overlap, each run continues the failure count of the run *two* back, so the JIB warning comes when two
alternate runs are blocked (in a lasting block, about 10–15 min in). Sony gets ~12 checks per run, so one fully
blocked Sony run is enough to warn. `--headful` doesn't help with this kind of block.

1. Repo **Settings → Secrets and variables → Actions → New repository secret**: add `DISCORD_WEBHOOK_URL`
   and `DISCORD_USER_ID`.
2. The workflow must be on the repo's **default branch**.
3. **Actions** tab → *PS5 stock watch* → **Run workflow** to test it once.
4. GitHub's own `schedule` trigger almost never fires, so the workflow doesn't use it. Instead a free
   [cron-job.org](https://cron-job.org) job starts it every 5 minutes:
   - URL: `https://api.github.com/repos/<owner>/ps5snipe/actions/workflows/watch.yml/dispatches`, method POST
   - Headers: `Authorization: Bearer <GitHub token>` (a classic token needs the `repo` scope) and
     `Accept: application/vnd.github+json`
   - Body: `{"ref":"main"}`
   - Schedule: Custom, crontab `4,9,14,19,24,29,34,39,44,49,54,59 * * * *`. Every 5 minutes, but started
     a minute early, so the moment two runs overlap lands on the :00/:05/:10 marks.

Public repos get unlimited Actions minutes. On a private repo this schedule would use up the free allowance in days.
To pause it: disable the cron-job.org job (or Actions → PS5 stock watch → ⋯ → Disable workflow).

## Laptop browser watcher

Powerbuy and Banana IT block bots, but not a real Chrome tab. A small Tampermonkey script
(`userscript/ps5watch.user.js`) watches Powerbuy, Banana IT and JIB from three Chrome tabs on the laptop.
It pings Discord, and Healthchecks.io warns you if a tab stops checking in.
Setup steps and what the messages mean: [`userscript/README.md`](userscript/README.md).

## Adding another store

Most shops need no code. Add an entry to `config.yaml`:

```yaml
  - name: My Shop
    type: browser            # or "shopify" for Shopify stores
    urls:                    # category or search pages that list PS5 consoles
      - https://example.co.th/search?q=playstation%205
    product_urls:            # optional: product pages to always watch
      - https://example.co.th/p/ps5-slim-digital
```

Then run `python -m ps5snipe --site "My Shop" --once -v --debug-dir debug`.
For each product page the checker reads stock in this order:

1. `in_stock_selector` / `out_of_stock_selector` CSS selectors, if you set them for the site
2. schema.org `availability` (JSON-LD or microdata), which most shops include
3. "สินค้าหมด / Out of stock" labels and "เพิ่มลงรถเข็น / Add to cart" buttons near the product title

If a site comes out `unknown`, open the HTML and screenshot saved in `debug/`, find the element that shows
stock, and set `in_stock_selector` / `out_of_stock_selector`.

## Config reference (`config.yaml`)

| key | default | meaning |
|---|---|---|
| `interval_seconds` | 60 | seconds between checks per site (±15% jitter). Override per site. |
| `renotify_minutes` | 15 | re-ping while still in stock (0 = once) |
| `notify_sold_out` | false | post when an item sells out again |
| `warn_after_failures` | 5 | warn on Discord after N consecutive failures (`--warn-after N` overrides it) |
| `browser.headless` | true | `false` = visible window (same as `--headful`) |
| `browser.channel` | – | `chrome` / `msedge` to use an installed browser |
| `match.extra_exclude` | – | extra regexes to ignore, e.g. `["\\bpro\\b"]` to skip PS5 Pro |

Please be polite: don't set intervals much below 30s, especially for browser-checked sites.

## Tests

```bash
pip install pytest && python -m pytest -q
```
