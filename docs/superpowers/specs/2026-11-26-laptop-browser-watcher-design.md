# Laptop browser watcher: design (2026-11-26)

## Why
On 2026-11-26 Powerbuy restocked PS5s and nothing pinged: nothing was watching Powerbuy.
- GitHub can't: Powerbuy, Banana IT and dotlife block GitHub's servers.
- Our robot browser can't either. Playwright's headless Chromium got Cloudflare HTTP 403 on its first
  request from Palm's home connection (tested 2026-11-25 and again 2026-11-26 18:32).
- JIB is checked from GitHub, but about 5% of the time a run's server IP is on JIB's blocklist.
  On 2026-11-26 15:09–20:24, 3 of 60 runs were blocked for their whole 6 minutes, roughly
  15 minutes with JIB unwatched.

A userscript Palm found (Google Doc "script ps5") checks these same stores from inside a real
browser tab, and doesn't get blocked the way our robot browser does. Cloudflare sees a real
person's browser. When it wants a check, the person passes it by hand. Palm wants the same, so
drops at these stores are caught before scalpers get them.

**Success:** a restock at Powerbuy, Banana IT or JIB pings Palm's Discord within about 2 minutes.
If the laptop watcher stops for any reason, Palm finds out within about 10 minutes.

## Goals / non-goals / anti-goals
- **Goals**
  - Palm's laptop watches **Powerbuy, Banana IT and JIB** from a real Chrome window.
  - Pings go to the same Discord channel as today, labelled with where they came from.
  - A stopped watcher is noticed (Healthchecks.io).
- **Non-goals**
  - Sony on the laptop. The home IP gets HTTP 429 from Sony, and it's Palm's manual-checkout IP.
  - Changing which stores GitHub watches.
  - Auto-buying.
  - Surviving a Windows reboot without Palm logging in.
- **Anti-goals.** Any of these makes it a failure even if it works.
  - **Disguising automation to get past bot protection.** No user-agent or fingerprint changes,
    no stealth plugins, no solving challenges by script, no proxies, and no handing a cleared
    cookie to a robot browser. Agreed with Palm 2026-11-25/26. The only automatic thing on a
    block is one ordinary page reload.
  - **Making the home IP look abusive.** No checks more often than every 45 s (the doc's script
    warns about this), and no full page reloads per check.
  - **A watcher that stops silently.**
  - **Secrets in the public repo.**

## Constraints
- The repo `palmkungkrab/ps5snipe` is **public**. The Discord webhook, Palm's Discord user ID and
  the Healthchecks ping key live only in the browser (Tampermonkey storage).
- Laptop: Windows 11, Chrome 158 (default browser), Node 24 (for tests). Power settings from
  2026-11-25 are still on: lid close does nothing while plugged in, and hibernate is off.
- On 2026-11-26 the laptop's real Chrome loaded Powerbuy, and even logged in, from the same home IP
  where the robot gets 403. So the 403s are about the robot client, not an IP ban.
- **Every message in Palm's Discord channel buzzes Palm's phone** (Palm, 2026-11-26). So
  Healthchecks' built-in Discord alert, which has no @mention, is enough for the "watcher stopped"
  alarm.
- Tampermonkey on Chrome 138+ only runs scripts once its **"Allow User Scripts"** switch is turned
  on, on the extension's details page.
  https://www.tampermonkey.net/faq.php?q=Q209 ·
  https://developer.chrome.com/docs/extensions/reference/api/userScripts
- **Chrome Memory Saver** can deactivate background tabs. Settings → Performance has an
  "Always keep these sites active" list. https://support.google.com/chrome/answer/12929150
- **Chrome throttles timers in hidden tabs**: chained timers wake at most about once a minute
  after the tab has been hidden a while. So a 60 s interval really runs every 60–120 s, which is
  accepted. https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- **Healthchecks.io free plan:** 20 checks; no more than 5 pings per minute per check; ping URL
  `https://hc-ping.com/<project-ping-key>/<check-slug>` via GET/HEAD/POST. Discord alerts are a
  built-in integration, connected through Discord's own authorisation flow.
  https://healthchecks.io/pricing/ · https://healthchecks.io/docs/http_api/ ·
  https://healthchecks.io/docs/configuring_checks/ ·
  https://github.com/healthchecks/healthchecks/issues/1006

## Approaches
- **A. Userscript in one tab per store (picked by Palm).** Tampermonkey runs our script in a
  normal Chrome tab on each store. About once a minute it fetches the store's PS5 search page from
  inside the tab (same-origin `fetch`), reads stock, pings Discord and checks in with Healthchecks.
  It's the same shape as the doc's script, which already works on these stores. It's the smallest
  build and easy to update.
- B. Own unpacked Chrome extension that can also reopen or reload store tabs. Rejected: much more
  code; Chrome keeps warning about unpacked extensions; Healthchecks already covers the main thing
  it adds (knowing the watcher stopped).
- C. Reload the whole page every minute and read the screen. Rejected: pulls every image and
  script each minute, so it looks more abusive and gets blocked sooner.

## Design

### Where things live
- `userscript/ps5watch.user.js`: one file, installed in Tampermonkey from its raw GitHub URL.
  `@updateURL`/`@downloadURL` point there, so a push to `main` reaches the laptop through
  Tampermonkey's own update check.
- `@match` covers `https://www.powerbuy.co.th/*`, `https://www.bnn.in.th/*` and
  `https://www.jib.co.th/*`. `@grant` covers `GM_getValue`, `GM_setValue` and
  `GM_xmlhttpRequest`. `@connect` covers `discord.com` and `hc-ping.com`. Discord and
  Healthchecks calls go through `GM_xmlhttpRequest`, so CORS doesn't apply.
- The pure logic (console matching, each store's parser, alert decisions, message building) must
  run under Node with no dependencies. Tests live in `userscript/test/*.test.js`, run with
  `node --test userscript/test`, using saved HTML/JSON fixtures in `userscript/test/fixtures/`.
  The browser-only part (timers, the status box, GM calls) stays a thin layer on top.

### Stores (one watcher tab each)
| Store | What one check fetches | In stock when | Notes |
|---|---|---|---|
| Powerbuy | `GET /th/search/ps5`, read the `<script id="__NEXT_DATA__">` JSON → `props.pageProps.productListData.products[]` | `stockAvail > 0` and (`canDelivery` or `canPickup`) | Fields and path are taken from the doc's script; we couldn't confirm them ourselves (blocked). Title `name`, price `priceSort`, URL `/th/product/<slugname>`. |
| Banana IT | `GET /th/p?q=playstation%205` (search page), links `a[href*="/th/p/"]` whose text has `฿` | card text has no `สินค้าหมด` / `out of stock` | From the doc's script; it says the default search lists only items ready to sell. Our category URL showed 0 consoles on 2026-11-25. |
| JIB | the same search page GitHub uses (`/web/product/product_search/0?str_search=playstation%205`) → console product links → each product page's schema.org `Product` JSON-LD | same rule as ps5snipe's browser checker (`decide_from_page`/`parse_jsonld` in `ps5snipe/checkers/browser.py`) | Product pages fetched one after another, about 1.5 s apart. |

- **Which products count:** port `ps5snipe/matching.py` (`DEFAULT_INCLUDE`, `DEFAULT_REQUIRE`,
  `DEFAULT_EXCLUDE`, `is_console`) to JS. The Node tests reuse the title cases from
  `tests/test_logic.py`.
- **dotlife** is not in this build. It's added later only if Palm's one-time test (open the dotlife
  PS5 page in normal Chrome; no block page) passes.

### One check
1. Fetch the store's page(s) as in the table above.
2. **Blocked** = HTTP 403/429/503, or the page isn't the store's normal page. Examples: no
   `__NEXT_DATA__` on Powerbuy, a challenge page, or no search-result structure. A normal page that
   simply lists no consoles is **not** blocked. It is a good check in which every known console of
   that store is sold out.
3. Not blocked: decide each console's state, as in "When to ping" below.
4. Update the status box.
5. Check in with Healthchecks (`GET https://hc-ping.com/<key>/<slug>`). Slugs: `powerbuy`,
   `banana-it`, `jib`.
6. Next check in 60 s ± 10 s.

### When to ping (mirrors `ps5snipe/state.py`)
- Ping when a console goes from not-in-stock (or never seen) to in stock.
- While it stays in stock, ping again every 15 min.
- "Couldn't tell" keeps the last known state (no flapping).
- After any good check, a known console missing from the page counts as sold out, so it pings the
  moment it returns. This applies even when the page lists no consoles at all. (Claude's call after
  the builder check.) Banana's search lists only items ready to sell, so "no consoles" is its normal
  sold-out state. Treating that as a hiccup would leave a sold-out console marked in stock and
  silence the next drop's ping. The worst case the other way is an early repeat ping, never a miss.
  This differs on purpose from `state.mark_gone`, which skips an empty feed.
- Kept in Tampermonkey storage per store, so a tab reload doesn't re-ping.

### When a store blocks
- **First blocked check:** reload the tab once (a flag in `sessionStorage` stops reload loops).
  A real browser often passes Cloudflare's automatic check on its own.
- **Still blocked after that reload:**
  - Post "needs you" (with @mention) once.
  - Show the warning state.
  - Stop checking in with Healthchecks. Healthchecks green therefore means "this store is being
    watched", and Healthchecks nudges Palm again if it stays stuck for about 10 min.
  - Retry every 5 min instead of every minute, to avoid hammering.
- **The first good check after that:** post "watching again" (no @mention), clear the flags and go
  back to normal.

### Discord messages (approved mockup: `.tmp/mockups/laptop-watcher.html`, style 2A)
- **In stock:** same payload as `Discord.in_stock` in `ps5snipe/notify.py`. The content reads
  `<@id> 🟢 **PS5 IN STOCK at {store}!** 💻 laptop {url}`, followed by the green embed (title + link,
  Store, Price, Detected by, timestamp). `allowed_mentions` is limited to Palm's ID. Retry on
  HTTP 429 as the Python code does.
- **Needs you:** `<@id> ⚠️ **{store} needs you** 💻 laptop`, plus one line saying the store isn't
  watched until the check on that tab is solved.
- **Watching again:** `✅ {store} is being watched again 💻 laptop` (no mention).
- **Test ping:** the box's "Test ping" button sends a clearly marked test, like `--test-notify`.
- **GitHub side:** ps5snipe gets a `--source TEXT` option, put into the in-stock headline the same
  way. `watch.yml` passes `--source "☁️ GitHub"`. Runs without the option look exactly like
  today.

### Status box (approved mockup 1A)
- **Watching tab:** a dark panel, bottom-right, styled like the doc's box. It shows:
  - store name and status line (last check time / IN STOCK / needs you)
  - the consoles it saw, each with ✅/❌ and price
  - "Discord ✓ · Healthchecks ✓"
  - Test ping and Settings buttons
  - ✕ shrinks it to a small pill.
- **Tab title:** `🟢 PS5 watch · {store}`, `🔥 IN STOCK · {store}`, `⚠️ Needs you · {store}`.
- **Settings:** Discord webhook link, Palm's Discord user ID and the Healthchecks ping key. Entered
  once and shared by all store tabs. The panel shows this form on first run.
- **Only marked watcher tabs watch** (Claude's call after the builder check).
  - A tab watches only if it was opened on its store's watcher address: the search page with
    `#ps5watch` on the end, kept as three bookmarks.
  - Any other tab of the store (Palm shopping or checking out) never checks and never reloads. It
    shows only a small "PS5 watch running in another tab" pill.
  - So a block at drop time can never reload Palm's cart or checkout page.
  - A closed watcher tab is not taken over by another tab; Healthchecks reports it.
  - If two marked tabs of the same store are open, the one that started first watches. It uses a
    `localStorage` heartbeat lock, stale after 3 min, because hidden tabs wake only about once a
    minute. The other marked tab shows "already watching in another tab".

### Laptop setup (written up as `userscript/README.md`, linked from the main README)
1. Install Tampermonkey in Chrome and turn on **Allow User Scripts** on its details page.
2. Install the script from its raw GitHub URL.
3. Make a Healthchecks.io account with three checks named `powerbuy`, `banana-it` and `jib`. For
   each: period 5 min, grace 5 min. Connect the Discord integration.
4. Bookmark the three watcher addresses (each store's search page plus `#ps5watch`). Open them in
   one Chrome window. Paste the settings in one of them and send a test ping.
5. Add the three sites to Chrome's **Always keep these sites active** list.
6. Set Chrome to **Continue where you left off** and to start at sign-in, so a reboot followed by a
   sign-in brings the tabs back.
7. Keep the laptop plugged in. Closing the lid is fine.

### Other changes
- README: the store table and "who watches what" become
  - GitHub = Sony Store TH + JIB
  - laptop browser = Powerbuy + Banana IT + JIB.
  `config.yaml` comments stay true (the robot browser stays off for those stores).
- `.gitignore`: add `.tmp/` (mockups).
- Memory note `laptop-home-runner` gets updated: the laptop is back, as a browser watcher.

## Left to the builder
- Exact JS structure and how the Node-testable part is exported.
- Fixture capture. Fixtures are saved from the real pages in Palm's browser during the build,
  because our robot can't fetch Powerbuy.
- How the status box is drawn, as long as it matches mockup 1A.
- Small timing values not fixed above, kept within the anti-goals.

## Verification
- **Tests:** `node --test userscript/test` and `pytest` both pass.
- **On the laptop**, with all three tabs open for 30+ minutes:
  - each tab's box shows checks every 1–2 min
  - Healthchecks shows all three checks green
  - "Test ping" arrives in Discord with the 💻 laptop label.
- **Silent-stop test:** closing one tab turns its Healthchecks check red and posts to Discord
  within about 10 min.
- **GitHub label** (Claude's call after the builder check; no workflow changes just to test it):
  - locally, `python -m ps5snipe --test-notify --source "☁️ GitHub" --dry-run` logs the headline
    with the label
  - a pytest checks that `watch.yml` passes `--source "☁️ GitHub"`
  - the next real GitHub in-stock ping shows it.
