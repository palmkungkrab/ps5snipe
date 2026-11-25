# ps5snipe 🎮

Watches Thai online stores for **PS5 console** restocks and pings you on **Discord** (with an `@mention`) the moment one can be bought.

| Store | How it's checked | Status |
|---|---|---|
| [Sony Store TH](https://store.sony.co.th/collections/playstation) | Shopify JSON feed, every ~30s | ✅ tested |
| [JIB](https://www.jib.co.th/) | headless Chromium + schema.org stock data | ✅ tested |
| [Powerbuy](https://www.powerbuy.co.th/th/category/game/game-console/playstation) | headless Chromium | ⚠️ Cloudflare: needs a non-datacenter IP |
| [Banana IT](https://www.bnn.in.th/th/p/gaming-gear/console/playstation-0) | headless Chromium | ⚠️ Cloudflare: needs a non-datacenter IP |
| [dotlife](https://www.dotlife.store/) | headless Chromium | ⚠️ Cloudflare: needs a non-datacenter IP |
| Lazada | headless Chromium | 🧪 disabled by default (captcha-heavy) |

Powerbuy, Banana and dotlife are the official PS5 retailers listed on
[playstation.com/th-th/ps5/buy-now](https://www.playstation.com/th-th/ps5/buy-now/). They block cloud/datacenter IPs,
so **run ps5snipe on your own PC or a home server in Thailand**. Free cloud runners like GitHub Actions
will get blocked by Powerbuy.

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

- **Windows:** create a Task Scheduler task "At log on" running `C:\path\to\ps5snipe\.venv\Scripts\python.exe -m ps5snipe`, with "Start in" set to the ps5snipe folder.
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

### GitHub Actions (backup while your PC is off)

`.github/workflows/watch.yml` runs every 5 minutes on GitHub and keeps checking **Sony Store TH and JIB**
for 4 minutes per run (Sony ~every 30s, JIB ~every 60s). Powerbuy/Banana/dotlife block GitHub's servers, so
they are only covered by your PC.

JIB occasionally blocks a single run: each run gets a fresh GitHub server, and some of their IPs are on JIB's
blocklist. The next run usually gets a clean IP, so the workflow passes `--warn-after 10` and only warns when JIB
stays blocked for 2–3 runs in a row (about 10–15 min). `--headful` doesn't help with this kind of block.

1. Repo **Settings → Secrets and variables → Actions → New repository secret**: add `DISCORD_WEBHOOK_URL`
   and `DISCORD_USER_ID`.
2. The workflow must be on the repo's **default branch** (scheduled workflows only run there).
3. **Actions** tab → *PS5 stock watch* → **Run workflow** to test it once.

Public repos get unlimited Actions minutes. On a private repo this schedule would use up the free allowance in days.
To pause it: Actions → PS5 stock watch → ⋯ → Disable workflow.

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
