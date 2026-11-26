# Laptop Browser Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tampermonkey userscript watches Powerbuy, Banana IT and JIB from real Chrome tabs on Palm's
laptop and pings Discord (labelled 💻 laptop). GitHub pings get a ☁️ GitHub label. A stopped tab is
reported by Healthchecks.io.

**Architecture:** There is one installable file, `userscript/ps5watch.user.js`. Its top half is a
pure core (`PS5W`) that Node can `require()` and test with saved real pages: matching, store parsers,
alert memory, block handling, messages and rendering. Its bottom half is a thin browser bootstrap that
wires the core to `fetch`, `GM_*` storage, `GM_xmlhttpRequest` (Discord, Healthchecks), timers and a
status box. Python changes only add a `--source` label to ps5snipe's in-stock ping.

**Tech Stack:** Plain JavaScript (Tampermonkey on Chrome 158), Node 24 built-ins (`node:test`,
`node:assert`, `node:fs`), Python 3 + pytest for the ps5snipe change.

**Spec:** `docs/superpowers/specs/2026-11-26-laptop-browser-watcher-design.md` (read it first).
Approved look: `.tmp/mockups/laptop-watcher.html` (local only, gitignored). Status box 1A,
message style 2A.

## Global Constraints

- **No disguising automation.** No user-agent or fingerprint changes, no challenge solving, no
  proxies. The only automatic action on a block is one `location.reload()`.
- Check every **60 s ± 10 s**, never under 50 s. While stuck, retry every **300 s**.
- **JIB:** product pages fetched ≥ **1.5 s** apart, at most **12** per check.
- Re-ping while still in stock every **15 min**.
- **Watcher lock:** stale after **180 s**, heartbeat every **15 s**.
- **No secrets in the repo** (it's public). The webhook, Discord user ID and Healthchecks key live
  only in Tampermonkey storage. Fixtures are captured logged out and scrubbed.
- **Exact strings**
  - labels: `💻 laptop` and `☁️ GitHub`
  - store names: `Powerbuy`, `Banana IT`, `JIB`
  - watcher marker: `#ps5watch`
  - Healthchecks slugs: `powerbuy`, `banana-it`, `jib`
  - ping URL: `https://hc-ping.com/<key>/<slug>`
- Every change to `ps5watch.user.js` bumps `@version`; Tampermonkey only updates on a higher version.
- No npm dependencies. JS tests: `node --test "userscript/test/*.test.js"`. Python tests: `pytest`.
- Windows console: run Python commands that print emoji with `PYTHONIOENCODING=utf-8`.

## Shared shapes (defined once, used by every task)

```js
// Product: url is normalized (absolute, no query, no hash)
{ title: string, url: string, price: string|null, available: true|false|null, reason: string }
// CheckResult
{ blocked: false, products: Product[] } | { blocked: true, why: string }
// Store (PS5W.STORES.powerbuy / .banana / .jib)
{ key, name, host, searchPath, hcSlug }
//   powerbuy: 'Powerbuy',  'www.powerbuy.co.th', '/th/search/ps5', 'powerbuy'
//   banana:   'Banana IT', 'www.bnn.in.th', '/th/p?q=playstation%205', 'banana-it'
//   jib:      'JIB', 'www.jib.co.th', '/web/product/product_search/0?str_search=playstation%205', 'jib'
// Items: alert memory per store, kept in GM storage under `items:<hcSlug>`
{ [url]: { title, available: true|false|null, seen: ms, notified?: ms, wentOut?: ms } }
// Flags: per tab, kept in sessionStorage
{ reloaded: boolean, stuck: boolean }
// Settings: GM storage key `settings`
{ webhook: string, userId: string, hcKey: string }
```

## Review Focus

1. **A store's product title contains HTML** (`<img onerror>`, `&`). It must render as text in the
   status box, never as markup. (Task 8)
2. **The same product is linked with different `?query` or `#hash`.** It must be one product with one
   alert memory, not a fresh ping each check. (Task 3)
3. **Price arrives as a number, as `"20990.00"` or as `"18,790"`.** It must always show as
   `฿20,990`-style, or `-` when missing. (Tasks 3, 7)
4. **Settings pasted with spaces or newlines, or one field wrong.** Values are trimmed, and the
   form names the bad field instead of saving junk. (Task 7)
5. **Discord is down, or the network drops for one check.** Watching continues. A network error
   is not a block (no reload, no "needs you"), and there's no Healthchecks ping for that check.
   (Task 9)

---

### Task 1: GitHub pings say ☁️ GitHub (Python)

**Files:**
- Modify: `ps5snipe/notify.py` (`Discord.__init__`, `Discord.in_stock`)
- Modify: `ps5snipe/__main__.py` (argparse block and the `Discord(...)` call, lines 74-98)
- Modify: `.github/workflows/watch.yml` (`env`, "Check stock" step)
- Test: `tests/test_alerts.py`, `tests/test_workflow.py`

**Interfaces:**
- Produces: `Discord(webhook_url, user_id, dry_run=False, source=None)`; CLI flag `--source TEXT`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_alerts.py
def test_in_stock_headline_carries_source_label(monkeypatch):
    sent = []
    d = notify.Discord("https://discord.test/hook", "42", source="☁️ GitHub")
    monkeypatch.setattr(d, "_post", lambda payload: sent.append(payload) or True)
    d.in_stock(Product("Sony Store TH", "PS5", "https://s.test/p", True, price="฿1"))
    assert sent[0]["content"] == "<@42> 🟢 **PS5 IN STOCK at Sony Store TH!** ☁️ GitHub https://s.test/p"

def test_in_stock_headline_without_source_is_unchanged(monkeypatch):
    sent = []
    d = notify.Discord("https://discord.test/hook", "42")
    monkeypatch.setattr(d, "_post", lambda payload: sent.append(payload) or True)
    d.in_stock(Product("Sony Store TH", "PS5", "https://s.test/p", True, price="฿1"))
    assert sent[0]["content"] == "<@42> 🟢 **PS5 IN STOCK at Sony Store TH!** https://s.test/p"

def test_cli_source_reaches_discord(monkeypatch):
    seen = {}
    class FakeDiscord:
        def __init__(self, url, uid, dry_run=False, source=None): seen["source"] = source
        def in_stock(self, p): return True
    monkeypatch.setattr("ps5snipe.__main__.Discord", FakeDiscord)
    assert main(["--test-notify", "--source", "☁️ GitHub"]) == 0
    assert seen["source"] == "☁️ GitHub"
```

```python
# tests/test_workflow.py
def test_github_pings_say_they_came_from_github():
    wf = load()
    assert wf["env"]["SOURCE_LABEL"] == "☁️ GitHub"
    run = next(s["run"] for s in wf["jobs"]["watch"]["steps"] if s.get("name") == "Check stock")
    assert """--source '"$SOURCE_LABEL"'""" in run       # watch line goes through eval
    assert '--source "$SOURCE_LABEL"' in run             # one-off test line (no eval)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -m pytest tests/test_alerts.py tests/test_workflow.py -q`

Expected: the 4 new tests FAIL (unexpected keyword `source`; no `SOURCE_LABEL`).

- [ ] **Step 3: Implement**
  - `Discord.__init__` gains `source: Optional[str] = None`, stored stripped, or `None` when empty.
  - `in_stock` content becomes
    `f"{self._mention()}🟢 **PS5 IN STOCK at {p.site}!** {label}{p.url}{buy}"`,
    with `label = f"{self.source} " if self.source else ""`.
  - `__main__`: add `--source` (help: "label shown in the in-stock headline, e.g. '☁️ GitHub'") and
    pass `source=args.source`.
  - `watch.yml`: add `SOURCE_LABEL: "☁️ GitHub"` under `env`.
    - Append `--source '"$SOURCE_LABEL"'` to the `eval python -m ps5snipe $SITES ...` line.
    - Append `--source "$SOURCE_LABEL"` to the one-off test line.
    - Add a one-line comment saying why the eval line needs the extra quotes.

- [ ] **Step 4: Run the tests to verify they pass, then check the eval quoting for real**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -m pytest -q`

Expected: all pass.

Run: `bash -c 'SOURCE_LABEL="☁️ GitHub"; eval printf "[%s]" --source '"'"'"$SOURCE_LABEL"'"'"''`

Expected: `[--source][☁️ GitHub]`, two words, with the label kept whole.

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -m ps5snipe --test-notify --source "☁️ GitHub" --dry-run`

Expected: the log line contains `PS5 IN STOCK at TEST!** ☁️ GitHub https://store.sony.co.th/...`.

- [ ] **Step 5: Commit**

```bash
git add ps5snipe/notify.py ps5snipe/__main__.py .github/workflows/watch.yml tests/test_alerts.py tests/test_workflow.py
git commit -m "feat: --source label in the in-stock headline; GitHub runs say ☁️ GitHub"
```

---

### Task 2: Userscript skeleton, metadata and console matching

**Files:**
- Create: `userscript/ps5watch.user.js`
- Test: `userscript/test/meta.test.js`, `userscript/test/matching.test.js`

**Interfaces:**
- Produces:
  - `PS5W.STORES`
  - `PS5W.storeForHost(host) -> Store|null`
  - `PS5W.watchUrl(store) -> string`, which is `https://<host><searchPath>#ps5watch`
  - `PS5W.isConsole(title) -> boolean`
- File layout used by every later task:
  1. metadata
  2. `const PS5W = {}` core, grouped by section comments
  3. `function bootstrap() {}`
  4. last line:
     `if (typeof module === 'object' && module.exports) module.exports = PS5W; else bootstrap();`

- [ ] **Step 1: Write the failing tests**
  - `meta.test.js`: read the file as text and assert the metadata block contains, line for line:
    - `@name PS5 watch (laptop)`
    - `@namespace https://github.com/palmkungkrab/ps5snipe`
    - a semver `@version`
    - `@match https://www.powerbuy.co.th/*`, `@match https://www.bnn.in.th/*`,
      `@match https://www.jib.co.th/*`
    - `@grant GM_getValue`, `@grant GM_setValue`, `@grant GM_xmlhttpRequest`
    - `@connect discord.com`, `@connect discordapp.com`, `@connect hc-ping.com`
    - `@run-at document-idle`
    - `@noframes`
    - `@updateURL` and `@downloadURL`, both
      `https://raw.githubusercontent.com/palmkungkrab/ps5snipe/main/userscript/ps5watch.user.js`

    Also add a **no-secrets guard**: the file must not match `/discord(app)?\.com\/api\/webhooks\/\d+\//`
    or `/hc-ping\.com\/[A-Za-z0-9_-]{8,}/`.
  - `meta.test.js`, store table:
    - `storeForHost('www.powerbuy.co.th').name === 'Powerbuy'`
    - `storeForHost('example.com') === null`
    - `watchUrl(STORES.banana) === 'https://www.bnn.in.th/th/p?q=playstation%205#ps5watch'`
  - `matching.test.js`: copy the `yes` and `no` title lists from `tests/test_logic.py::test_matcher_consoles`
    verbatim. Assert `isConsole` is true for every `yes` title and false for every `no` title.

- [ ] **Step 2: Run to verify fail**

Run: `node --test "userscript/test/*.test.js"`

Expected: FAIL (cannot find module `../ps5watch.user.js`).

- [ ] **Step 3: Implement.** Port `DEFAULT_INCLUDE`, `DEFAULT_REQUIRE`, `DEFAULT_EXCLUDE` and `is_console`
  from `ps5snipe/matching.py`:
  - same patterns, flag `i`
  - collapse whitespace first
  - empty title → false.

  `bootstrap()` stays an empty stub for now.

- [ ] **Step 4: Run to verify pass**

Run: `node --test "userscript/test/*.test.js"`

Expected: all pass.

- [ ] **Step 5: Commit**: `git add userscript && git commit -m "feat(userscript): skeleton, metadata, console matching"`

---

### Before Task 3: real page fixtures (controller does this with Palm)

Robots get 403 from Powerbuy, so Palm saves the pages from Chrome. Use an **Incognito** window, so no
account data lands in the public repo. For each page, open the address and press Ctrl+S. Save into
`userscript/test/fixtures/raw/`, which gets added to `.gitignore` in Task 3:
- `view-source:https://www.powerbuy.co.th/th/search/ps5` → `powerbuy-search.html`
- `view-source:https://www.bnn.in.th/th/p?q=playstation%205` → `banana-search.html`
- `view-source:https://www.jib.co.th/web/product/product_search/0?str_search=playstation%205` → `jib-search.html`
- `view-source:` of any PS5 console product page linked from that JIB search → `jib-product.html`

**The fixture is the ground truth.** If a field or path differs from the spec (which took Powerbuy's
names from the doc's script), follow the fixture and note the difference in the commit message.

---

### Task 3: Powerbuy and Banana IT parsers

**Files:**
- Modify: `userscript/ps5watch.user.js` (core: `-- shared helpers --` and `-- stores --` sections)
- Create:
  - `userscript/test/fixtures/powerbuy-search.html`, `banana-search.html`: trimmed from `raw/`
  - `block-page.html`: synthetic, `<title>Just a moment...</title>`
- Test: `userscript/test/search-parsers.test.js`
- Modify: `.gitignore` (add `userscript/test/fixtures/raw/`)

**Interfaces:**
- Consumes: `isConsole`, `STORES`.
- Produces:
  - `PS5W.anchors(html) -> [{ href, label }]`: `label` = tag-stripped inner text + `title` and
    `alt` attributes, whitespace collapsed.
  - `PS5W.normalizeUrl(href, origin) -> string`
  - `PS5W.formatPrice(value) -> string|null`
  - `PS5W.isBlockedPage(status, html) -> boolean`
  - `PS5W.OOS_RE`
  - `PS5W.parsePowerbuy(status, html, origin) -> CheckResult`
  - `PS5W.parseBanana(status, html, origin) -> CheckResult`

- [ ] **Step 1: Trim the fixtures.**
  - Powerbuy: keep a minimal HTML whose `__NEXT_DATA__` holds only the path to the products
    array, with real field names and values (all real products, including non-consoles).
  - Banana: keep the product-card markup.
  - Then run `grep -iE "@[a-z0-9-]+\.|token|session|password" userscript/test/fixtures/*.html`.
    Expected: no account data. Remove anything personal before going on.

- [ ] **Step 2: Write the failing tests**
  - **Powerbuy real fixture, status 200:**
    - `blocked === false`
    - every product: `isConsole(title)`, `url` starts with `https://www.powerbuy.co.th/th/product/`,
      `available` is boolean, `reason === 'search page stock flag'`
    - at least one non-console in the fixture was dropped.
  - **Powerbuy variants, built by editing the parsed JSON of the first console in the fixture**
    (the stock fields in the fixture; per the spec, `stockAvail`, `canDelivery`, `canPickup`):
    - stock 2 + deliverable → `true`
    - stock 0 → `false`
    - stock 2 but neither delivery nor pickup → `false`.
  - **Powerbuy, normal page with an empty products array** → `{ blocked: false, products: [] }`.
  - **Blocked:**
    - status 403 with the real HTML
    - status 200 with `block-page.html`
    - status 200 with the `__NEXT_DATA__` script removed

    Each → `blocked === true` with a `why` string.
  - **Banana real fixture** → not blocked; every product `isConsole`; no title contains `฿`.
  - **Banana console card:** take a real card from the fixture and set its text to
    `PlayStation 5 Slim Digital Edition ฿18,790`:
    - → `available === true`, `price === '฿18,790'`, `reason === 'search card text'`
    - with `สินค้าหมด` added → `false`.
  - **Review Focus 2:**
    - `normalizeUrl('/th/p/abc?utm=1#x', 'https://www.bnn.in.th') === 'https://www.bnn.in.th/th/p/abc'`
    - two cards linking the same product with different queries → one product.
  - **Review Focus 3:**
    - `formatPrice(18790) === '฿18,790'`
    - `formatPrice('20990.00') === '฿20,990'`
    - `formatPrice('18,790') === '฿18,790'`
    - `formatPrice(null)`, `formatPrice(0)` and `formatPrice('abc')` are all `null`.

- [ ] **Step 3: Run to verify fail.** Run `node --test "userscript/test/*.test.js"`. Expected: the
  new tests fail (not a function).

- [ ] **Step 4: Implement**
  - `isBlockedPage`: status in (403, 429, 503), or `<title>` matches the port of `BLOCK_TITLES` from
    `ps5snipe/checkers/browser.py:41`.
  - Powerbuy: also blocked when the `__NEXT_DATA__` JSON or its products array is missing.
  - `OOS_RE`: port of `browser.py:31`.
  - Banana: title = label text before the first `฿`.

- [ ] **Step 5: Run to verify pass**, same command. Expected: all pass.

- [ ] **Step 6: Commit**:
  `git add .gitignore userscript && git commit -m "feat(userscript): Powerbuy and Banana IT parsers"`

---

### Task 4: JIB parsers (search page + product page)

**Files:**
- Modify: `userscript/ps5watch.user.js` (core: `-- stores --`)
- Create: `userscript/test/fixtures/jib-search.html`, `jib-product.html` (trimmed from `raw/`)
- Test: `userscript/test/jib.test.js`

**Interfaces:**
- Consumes: `anchors`, `normalizeUrl`, `formatPrice`, `isBlockedPage`, `isConsole`.
- Produces:
  - `PS5W.JIB_GAP_MS = 1500`, `PS5W.JIB_MAX_PRODUCTS = 12`
  - `PS5W.parseJsonld(blobs: string[]) -> { available, price, name }`
  - `PS5W.decideSchema(values: string[]) -> true|false|null`
  - `PS5W.parseJibSearch(status, html, origin) -> { blocked:false, links:[{url,title}] } | { blocked:true, why }`
    - same-host console links only
    - deduped by normalized URL
    - first 12 kept
  - `PS5W.parseJibProduct(status, html, url, fallbackTitle) -> { blocked:false, product: Product } | { blocked:true, why }`

- [ ] **Step 1: Trim the fixtures** (keep the result cards, and the JSON-LD and microdata of the
  product page), then run the same grep as Task 3.

- [ ] **Step 2: Write the failing tests**
  - **Port `tests/test_logic.py::test_jsonld` case by case.** Prices go through `formatPrice`:
    - InStock → `{ available:true, price:'฿20,990', name:'PS5' }`
    - OutOfStock → `false`
    - PreOrder → `true`
    - `['not json','{}']` → `null`
    - `@graph` with mixed offers → `true`
  - **Real `jib-search.html`:** ≥1 link, all `isConsole(title)`, all on `https://www.jib.co.th/`,
    no duplicates, length ≤ 12.
  - **Real `jib-product.html`:** `available` is boolean (not null), `title` comes from the JSON-LD
    name, `reason === 'schema.org JSON-LD'`.
  - **Microdata only:** `<link itemprop="availability" href="https://schema.org/OutOfStock">`
    → `false`, `reason === 'schema.org microdata'`.
  - **No signal** → `available === null`, `reason === 'no stock signal found'`,
    `title === fallbackTitle`.
  - **Status 403 on either parser** → `blocked === true`.

- [ ] **Step 3: Run to verify fail.** Same command; expected: the new tests fail.

- [ ] **Step 4: Implement** as ports of `_walk`, `_types`, `parse_jsonld`, `_decide_schema`,
  `IN_STOCK_SCHEMA` and `OUT_SCHEMA` (`browser.py:44-142`). JSON-LD blobs come from
  `<script ... application/ld+json>`. Microdata comes from `itemprop="availability"`
  `content`/`href` values.

- [ ] **Step 5: Run to verify pass.**

- [ ] **Step 6: Commit**: `git commit -am "feat(userscript): JIB search and product parsers"`
  (`git add` the new fixtures first).

---

### Task 5: Alert memory (port of `ps5snipe/state.py`)

**Files:**
- Modify: `userscript/ps5watch.user.js` (core: `-- alerts --`)
- Test: `userscript/test/alerts.test.js`

**Interfaces:**
- Produces:
  - `PS5W.RENOTIFY_MS = 900000`
  - `PS5W.nextAlerts(items, products, now, renotifyMs) -> { items, alerts: Product[] }`.
    Pure: the input `items` is not mutated.
  - `PS5W.loadItems(value) -> Items`

- [ ] **Step 1: Write the failing tests.** Times in ms, `R = 900000`:
  - New in-stock product → 1 alert, and `items[url].notified === now`.
  - Same product 60 s later → 0 alerts.
  - At `now + R` → 1 alert.
  - `available: null` → 0 alerts, and the stored `available` is unchanged.
  - in → out → in → an alert on the return, and `wentOut` is set when it goes out.
  - A known in-stock URL missing from a non-empty products list → stored `available === false`,
    `wentOut === now`. When it comes back in stock → alert.
  - **Empty products list** → every known in-stock URL becomes `false`. This is the spec's
    deliberate difference from `mark_gone`.
  - **Purity:** a deep copy of the input `items` still equals the original afterwards.
  - **Corrupt storage:**
    - `loadItems(undefined)`, `loadItems(null)`, `loadItems('garbage')` → `{}`
    - `loadItems('{"u":{"available":true}}')` → `{ u: { available: true } }`
    - an object passes through unchanged.

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** with the same rules as `State.should_alert`, plus the gone rule above.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**: `git commit -am "feat(userscript): alert memory with 15-min re-ping and gone rule"`

---

### Task 6: Check-loop decisions (block handling, timing, watcher lock)

**Files:**
- Modify: `userscript/ps5watch.user.js` (core: `-- decisions --`)
- Test: `userscript/test/decisions.test.js`

**Interfaces:**
- Produces:
  - Constants: `INTERVAL_MS = 60000`, `JITTER_MS = 10000`, `STUCK_RETRY_MS = 300000`,
    `LOCK_STALE_MS = 180000`, `HEARTBEAT_MS = 15000`.
  - `PS5W.blockStep(flags, blocked: boolean) -> { action, flags }`, where `action` is one of
    `'continue' | 'recovered' | 'reload' | 'needsYou' | 'stillStuck'`.
  - `PS5W.nextDelayMs(kind: 'normal'|'stuck', random: number) -> number`
  - `PS5W.lockDecision(lock, myId, now) -> 'mine'|'other'`

- [ ] **Step 1: Write the failing tests**

| flags in | blocked | action | flags out |
|---|---|---|---|
| `{}` | false | continue | `{reloaded:false, stuck:false}` |
| `{}` | true | reload | `{reloaded:true, stuck:false}` |
| `{reloaded:true}` | true | needsYou | `{reloaded:true, stuck:true}` |
| `{reloaded:true, stuck:true}` | true | stillStuck | unchanged |
| `{reloaded:true, stuck:true}` | false | recovered | `{reloaded:false, stuck:false}` |
| `{reloaded:true}` | false | continue | `{reloaded:false, stuck:false}` |

  - `nextDelayMs`:
    - normal with random 0 → 50000; 0.5 → 60000; 0.999 → < 70000
    - stuck → 300000
    - never under 50000.
  - `lockDecision`:
    - `null` → mine
    - `{id:'b', ts:now-10000}` with myId `'a'` → other
    - `{id:'b', ts:now-180001}` → mine
    - `{id:'a', ts:now-10}` → mine
    - garbage (`'x'`, `{}`) → mine.

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**: `git commit -am "feat(userscript): block handling, timing and watcher lock decisions"`

---

### Task 7: Discord messages, Healthchecks URL and settings

**Files:**
- Modify: `userscript/ps5watch.user.js` (core: `-- messages --`, `-- settings --`)
- Test: `userscript/test/messages.test.js`

**Interfaces:**
- Consumes: `watchUrl`, `STORES`.
- Produces:
  - `PS5W.LABEL = '💻 laptop'`
  - `PS5W.buildInStock(product, storeName, userId) -> payload`
  - `PS5W.buildNeedsYou(storeName, userId) -> payload`
  - `PS5W.buildWatchingAgain(storeName) -> payload`
  - `PS5W.buildTest(store, userId) -> payload`
  - `PS5W.hcUrl(key, slug) -> string`
  - `PS5W.cleanSettings(raw) -> { settings, errors: string[] }`

- [ ] **Step 1: Write the failing tests.** Exact copy, matching `ps5snipe/notify.py` and mockup 2A /
  part 3:
  - **`buildInStock(p, 'Powerbuy', '42')`:**
    - `content === '<@42> 🟢 **PS5 IN STOCK at Powerbuy!** 💻 laptop ' + p.url`
    - `embeds[0]`: `title === p.title`, `url === p.url`, `color === 0x2ECC71`
    - fields `[Store: Powerbuy (inline), Price: p.price or '-' (inline), Detected by: p.reason or '-']`
    - `timestamp` is an ISO string
    - `allowed_mentions` deep-equals `{ users: ['42'] }`
    - a 300-character title is cut to 250.
  - **`buildNeedsYou('Powerbuy','42').content`:**
    - starts with `'<@42> ⚠️ **Powerbuy needs you** 💻 laptop'`
    - contains `'Powerbuy is NOT being watched'`
    - `allowed_mentions` deep-equals `{ users: ['42'] }`.
  - **`buildWatchingAgain('Powerbuy')`:**
    - `content === '✅ Powerbuy is being watched again 💻 laptop'`
    - `allowed_mentions` deep-equals `{ parse: [] }`.
  - **`buildTest(STORES.jib,'42')`:** an in-stock-style payload whose embed title is
    `'Test notification from ps5watch (not a real restock)'`, with price `'฿0'` and reason
    `'test ping button'`.
  - **`hcUrl('k1', 'powerbuy') === 'https://hc-ping.com/k1/powerbuy'`**
  - **Review Focus 4: `cleanSettings`**
    - Values are trimmed, including newlines.
    - `webhook` must match `^https://(discord|discordapp)\.com/api/webhooks/\d+/[\w-]+$`.
    - `userId` must match `^\d{17,20}$`.
    - `hcKey` must match `^[A-Za-z0-9_-]{8,}$`.
    - All three are required.
    - Each bad or missing field adds an error naming it (`'Discord webhook link'`,
      `'Discord user ID'`, `'Healthchecks ping key'`).

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**: `git commit -am "feat(userscript): Discord messages, Healthchecks URL, settings checks"`

---

### Task 8: Status box and tab title

**Files:**
- Modify: `userscript/ps5watch.user.js` (core: `-- render --`)
- Test: `userscript/test/render.test.js`

**Interfaces:**
- Produces:
  - `PS5W.escapeHtml(s)`
  - `PS5W.tabTitle(mode, storeName) -> string`
  - `PS5W.BOX_CSS: string`
  - `PS5W.renderBox(view) -> string`. The `view` is
    `{ mode: 'setup'|'ok'|'stock'|'warn'|'pill', storeName, lastCheck, products, discordOk, hcOk, error, pillText }`.
    In the box, `lastCheck` shows as `HH:MM:SS` local time and `error` is an optional one-line status.
  - Buttons carry `data-act="test|settings|save|shrink|expand"`. Inputs are named
    `webhook|userId|hcKey`.

- [ ] **Step 1: Write the failing tests**
  - **Tab titles:**
    - `tabTitle('ok','Powerbuy') === '🟢 PS5 watch · Powerbuy'`
    - `'stock'` → `'🔥 IN STOCK · Powerbuy'`
    - `'warn'` → `'⚠️ Needs you · Powerbuy'`
    - `'setup'` → `'⚙️ Set up · PS5 watch'`
  - **Stock view:** contains `✅`, the product URL inside an `href` and `IN STOCK`.
  - **Ok view:** a sold-out product shows `❌`, plus `Discord ✓` and `Healthchecks ✓` when both are
    true.
  - **Warn view:** contains `asking if you're human`.
  - **Setup view:** has three inputs named `webhook`, `userId`, `hcKey`, and a `data-act="save"` button.
  - **Pill view:** contains `pillText` and no `<ul>`.
  - **Review Focus 1:** a product titled `<img src=x onerror=alert(1)>&` appears as
    `&lt;img src=x onerror=alert(1)&gt;&amp;` and never as a raw `<img`.

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement.** Match mockup 1A in `.tmp/mockups/laptop-watcher.html`: dark `#111`
  panel at the bottom right, status line colours, list, footer. `BOX_CSS` holds the styles, which
  get injected into a shadow root in Task 9.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**: `git commit -am "feat(userscript): status box and tab title"`

---

### Task 9: The check loop and browser wiring

**Files:**
- Modify: `userscript/ps5watch.user.js` (core: `-- runner --`; and `bootstrap()`)
- Test: `userscript/test/runner.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `PS5W.checkStore(env, store) -> Promise<CheckResult>`
  - `PS5W.runCheck(env, store) -> Promise<{ delayMs } | null>`
    (`null` means the tab is reloading)
  - `PS5W.postWithRetry(sendOnce, sleep) -> Promise<boolean>`
  - `env` is
    `{ fetchText(url)→Promise<{status,text}>, sleep(ms), now(), random(), getItems(slug), setItems(slug, items), getFlags(), setFlags(flags), settings(), postDiscord(payload)→Promise<boolean>, pingHealthchecks(slug)→Promise<boolean>, reload(), render(view) }`.

- [ ] **Step 1: Write the failing tests.** Use a fake `env` that records calls, plus fixture HTML:
  1. **Powerbuy, one console in stock:**
     - `postDiscord` called once with a `buildInStock` payload
     - `pingHealthchecks('powerbuy')` called once
     - `setItems` called
     - last `render` mode is `'stock'`
     - `delayMs` between 50000 and 70000.
  2. **Same check again:** no `postDiscord`.
  3. **First blocked check:** `reload` called once, no post, no ping, result `null`.
  4. **Blocked with `{reloaded:true}`:**
     - one post containing `Powerbuy needs you`
     - no ping
     - `delayMs === 300000`
     - render mode `'warn'`.
  5. **Blocked again** (`stuck`): no post.
  6. **Good check after stuck:** a `watching again` post and one ping.
  7. **Review Focus 5:**
     - `postDiscord` resolves `false` → `runCheck` still resolves, still pings, `render` gets
       `discordOk: false`.
     - `fetchText` rejects (network) → no reload, no post, no ping, `delayMs` in the normal range,
       `render` gets `error` set.
  8. **JIB search with 2 console links:**
     - `fetchText` called 3 times
     - `sleep(1500)` between product fetches
     - a product page with status 403 → the whole check is blocked.
  9. **`postWithRetry`:**
     - 429 with `retryAfterMs: 1200`, then 204 → `true`, slept 1200
     - 500 → `false`
     - 4 throws → `false`.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement `checkStore` / `runCheck` / `postWithRetry`, then `bootstrap()`.** `bootstrap()`
  isn't unit-tested; it's checked live in Task 10. It does this:
  1. Find the store by `location.host`; if none, return.
  2. Mount a host `<div>` with a shadow root holding `BOX_CSS`.
  3. If `location.hash !== '#ps5watch'`:
     - show a pill: `PS5 watch running in another tab` when the `localStorage` lock is fresh,
       otherwise `PS5 watch: no watcher tab open`
     - refresh it every 60 s
     - never check, never reload.
  4. Otherwise, take the lock:
     - the tab id lives in `sessionStorage`
     - the lock lives at `localStorage['ps5watch-lock']`
     - refresh it every `HEARTBEAT_MS`
     - on `'other'`, show the pill `already watching in another tab` and retry every 60 s.
  5. With no valid settings, render the setup form. **Save** runs `cleanSettings`, then either shows
     the errors or stores the settings and starts the loop.
  6. Build `env`:
     - `fetchText` = same-origin `fetch(url, {cache:'no-store', credentials:'include'})`
     - items and settings = `GM_getValue`/`GM_setValue` (`items:<slug>`, `settings`)
     - flags = `sessionStorage`
     - `postDiscord` = `postWithRetry` over `GM_xmlhttpRequest` POST JSON to the webhook; read
       `retry_after` (seconds) from a 429
     - `pingHealthchecks` = `GM_xmlhttpRequest` GET `hcUrl`
     - `reload` = `location.reload()`
     - `render` = set `document.title` with `tabTitle`, and the shadow root's `innerHTML` with
       `renderBox`.
  7. Loop: `tick = async () => { const r = await runCheck(env, store); if (r) setTimeout(tick, r.delayMs) }`.
  8. Buttons: Test ping = `postDiscord(buildTest(...))`; shrink and expand state live in
     `sessionStorage`.
- [ ] **Step 4: Run to verify pass**, then **bump `@version` to 1.0.0**.
- [ ] **Step 5: Commit**: `git commit -am "feat(userscript): check loop, Discord/Healthchecks wiring, browser bootstrap"`

---

### Task 10: Setup guide, README, live check on the laptop

**Files:**
- Create: `userscript/README.md`
- Modify: `README.md` (store table, the "who watches what" paragraph, the GitHub Actions section
  sentence about Powerbuy/Banana/dotlife; add a "Laptop browser watcher" section linking
  `userscript/README.md`)

- [ ] **Step 1: Write `userscript/README.md`**
  - The seven laptop setup steps from the spec, with the three watcher bookmarks (each `watchUrl`).
  - Healthchecks: period 5 min, grace 5 min, Discord integration.
  - Updating: Tampermonkey pulls new versions from `main`.
  - What "needs you" and a red Healthchecks check mean, and what to do about each.
- [ ] **Step 2: Update `README.md`.**
  - New split: **GitHub = Sony Store TH + JIB** and **laptop browser = Powerbuy + Banana IT + JIB**.
    JIB is watched twice on purpose; pings say 💻 laptop or ☁️ GitHub.
  - Powerbuy and Banana rows: "real Chrome tab on the laptop (userscript)".
  - dotlife stays off.
- [ ] **Step 3: Run all tests.**
  - `node --test "userscript/test/*.test.js"` → all pass
  - `PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -m pytest -q` → all pass.
- [ ] **Step 4: Commit**: `git add README.md userscript/README.md && git commit -m "docs: laptop browser watcher setup"`
- [ ] **Step 5: Live check with Palm (controller).**
  - Install Tampermonkey and turn on **Allow User Scripts**.
  - Before merge: Tampermonkey dashboard → **+** → paste `ps5watch.user.js` → save.
  - Healthchecks setup.
  - Open the 3 bookmarks and paste the settings.
  - **Test ping** arrives with 💻 laptop.
  - Add the sites to **Always keep these sites active**.
  - Over 30 minutes: each box's last-check time moves every 1–2 min, and Healthchecks shows 3 green
    checks.
  - **Silent-stop test:** close the JIB tab. The Healthchecks "jib" check goes down, and Discord
    gets its alert within about 10 min. Then reopen the tab.

  Record the results in the final report.
