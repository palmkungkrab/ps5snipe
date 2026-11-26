# Dotlife watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The laptop userscript watches Dotlife's Sony console list through iStudio's GraphQL feed and pings
Discord when a PS5 console becomes buyable online.

**Architecture:** A new store entry carries its feed details. `checkStore` sends one feed request for it,
with the `Store: dth` header and no cookies, instead of fetching an HTML search page. A pure parser,
`parseDotlife`, turns the JSON into the same product list every other parser returns. Everything after
that (alerts, box, Healthchecks, block handling) is the existing code, unchanged.

**Tech Stack:** Plain JS userscript (Tampermonkey), Node's built-in test runner. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-dotlife-watcher-design.md`

## Global Constraints

- Feed: `https://apim.istudio.store/graphql`, GET with a single `query` param, header `Store: dth`, `credentials: 'omit'`.
- Query, verbatim (live-tested 2026-11-26; it produced `userscript/test/fixtures/dotlife-feed.json`):
  `{products(filter:{category_uid:{eq:"MTY5NQ=="},brand:{eq:"481"}},pageSize:40){total_count items{__typename name url_key url_suffix stock_status only_x_left_in_stock price_range{minimum_price{final_price{value currency}}}}}}`
- Store entry:
  - key `dotlife`, name `Dotlife`, host `www.dotlife.store`, hcSlug `dotlife`
  - searchPath `/digital-lifestyle/gaming-toy/gaming-console.html?brand%5Bfilter%5D=SONY%2C481`
- Buyable rule: `IN_STOCK` → `true`, `OUT_OF_STOCK` → `false`, anything else → `null`.
- Product URL: `https://www.dotlife.store/` + `url_key` + `url_suffix`, where a non-string `url_suffix` means `.html`.
- Block whys, verbatim:
  - `dotlife feed is not JSON`
  - `dotlife feed error: <first message>`
  - `dotlife feed fields changed`
  - `dotlife feed listed no products`
  - `dotlife product fields changed`
- Never a page reload per check (anti-goal). No `@connect` for the feed (it's a page `fetch`).
- `@version` 1.0.1 → 1.1.0. Tests: `node --test "userscript/test/*.test.js"` from the repo root (128 pass at start).

## Review Focus

1. **Missing `Store: dth` header.** The feed answers 200 with an empty list, and that must be "needs you",
   never "all sold out" (Task 1 empty-list case; Task 2 asserts the header is sent).
2. **Cookies sent cross-origin.** `credentials: 'include'` makes the fetch fail outright, so the per-request
   `init` must override the bootstrap default (Task 2's text pin on the bootstrap `fetch` call).
3. **GraphQL errors at HTTP 200,** e.g. a renamed field: they must be blocked with the server's message (Task 1).
4. **A controller or game turning IN_STOCK** inside the Sony filter must never ping (Task 1 console-filter case).
5. **The other three stores must still send cookies,** with no `init` passed for them (Task 2 Powerbuy assertion).

---

### Task 1: Dotlife store entry, feed request, parser

**Files:**
- Modify: `userscript/ps5watch.user.js`
  - `PS5W.STORES` (~line 27)
  - new `feedRequest` next to `watchUrl` (~line 37)
  - new `parseDotlife` after `parseBanana` (~line 656)
- Create: `userscript/test/dotlife.test.js`
- Modify: `userscript/test/meta.test.js` ("store table" test)
- Fixture (already captured, real reply): `userscript/test/fixtures/dotlife-feed.json`

**Interfaces:**
- Produces:
  - `PS5W.STORES.dotlife = { key, name, host, searchPath, hcSlug, feed: { url, storeCode, query } }`
  - `PS5W.feedRequest(store) -> { url: string, init: { credentials: 'omit', headers: { Store: string } } }`
  - `PS5W.parseDotlife(status: number, text: string, origin: string) -> { blocked: true, why: string } | { blocked: false, products: Array<{ title, url, price, available, reason }> }`

- [ ] **Step 1: Write the failing tests** in `userscript/test/dotlife.test.js`. They use the same header
  requires as `jib.test.js`, plus these helpers:
  - `const DL = 'https://www.dotlife.store'`
  - `feed` = the fixture text
  - `feedWith(edit)` = parse the fixture, call `edit(items)` on `data.products.items`, re-stringify

```js
test('Dotlife feed (real reply 2026-11-26): 3 consoles, all sold out online', () => {
  const r = PS5W.parseDotlife(200, feed, DL);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.products.map((p) => [p.title, p.url, p.price, p.available, p.reason]), [
    ['Sony PS5 Console (E Chassis)', 'https://www.dotlife.store/sony-ps5-console-e-chassis.html', '฿20,990', false, 'feed stock_status'],
    ['Sony PS5 Console Digital Edition (E Chassis)', 'https://www.dotlife.store/sony-ps5-console-digital-edition-e-chassis.html', '฿18,790', false, 'feed stock_status'],
    ['Sony PS5 Console (D Chassis) Slim Bundle NBA 2K26', 'https://www.dotlife.store/sony-ps5-console-d-chassis-bundle-nba-2k26.html', '฿18,690', false, 'feed stock_status'],
  ]);
});

test('Dotlife: IN_STOCK is buyable; any other status is unknown', () => {
  const r = PS5W.parseDotlife(200, feedWith((it) => { it[0].stock_status = 'IN_STOCK'; it[1].stock_status = 'PRE_ORDER'; delete it[2].stock_status; }), DL);
  assert.deepEqual(r.products.map((p) => [p.available, p.reason]),
    [[true, 'feed stock_status'], [null, 'stock fields missing'], [null, 'stock fields missing']]);
});

test('Dotlife: controllers and games in the Sony list never count', () => {
  const r = PS5W.parseDotlife(200, feedWith((it) => {
    it.push({ ...it[0], name: 'PS5 Controller DualSense Wireless (New Version)', url_key: 'ps5-dualsense-new', stock_status: 'IN_STOCK' });
    it.push({ ...it[0], name: 'แผ่นเกม PS5 : Marvel’s Wolverine', url_key: 'ps5-wolverine', stock_status: 'IN_STOCK' });
  }), DL);
  assert.equal(r.products.length, 3);
  assert.ok(r.products.every((p) => p.available === false));
});

test('Dotlife: no url_suffix means .html; no price means null; a repeated product is listed once', () => {
  const r = PS5W.parseDotlife(200, feedWith((it) => { delete it[0].url_suffix; delete it[0].price_range; it.push({ ...it[1] }); }), DL);
  assert.equal(r.products.length, 3);
  assert.equal(r.products[0].url, 'https://www.dotlife.store/sony-ps5-console-e-chassis.html');
  assert.equal(r.products[0].price, null);
});

test('Dotlife: anything but a normal reply is blocked with a why', () => {
  const empty = JSON.stringify({ data: { products: { total_count: 0, items: [] } } });
  const cases = [
    [403, feed, 'HTTP 403'],
    [500, feed, 'HTTP 500'],
    [200, '<html><head><title>Just a moment...</title></head></html>', 'challenge page: Just a moment...'],
    [200, 'not json', 'dotlife feed is not JSON'],
    [200, JSON.stringify({ errors: [{ message: 'Cannot query field "x" on type "ProductInterface".' }] }),
      'dotlife feed error: Cannot query field "x" on type "ProductInterface".'],
    [200, 'null', 'dotlife feed fields changed'],
    [200, JSON.stringify({ data: { products: null } }), 'dotlife feed fields changed'],
    [200, empty, 'dotlife feed listed no products'],
    [200, feedWith((it) => it.forEach((i) => { delete i.url_key; })), 'dotlife product fields changed'],
  ];
  for (const [status, text, why] of cases) {
    assert.deepEqual(PS5W.parseDotlife(status, text, DL), { blocked: true, why }, why);
  }
});

test('Dotlife feed request: our small query, store dth, no cookies', () => {
  const req = PS5W.feedRequest(PS5W.STORES.dotlife);
  const u = new URL(req.url);
  assert.equal(u.origin + u.pathname, 'https://apim.istudio.store/graphql');
  assert.deepEqual([...u.searchParams.keys()], ['query']);
  assert.equal(u.searchParams.get('query'), PS5W.STORES.dotlife.feed.query);
  assert.match(u.searchParams.get('query'), /category_uid:\{eq:"MTY5NQ=="\},brand:\{eq:"481"\}/);
  assert.deepEqual(req.init, { credentials: 'omit', headers: { Store: 'dth' } });
});
```

  In `meta.test.js` "store table", add:
  - `assert.equal(PS5W.storeForHost('www.dotlife.store').name, 'Dotlife');`
  - `assert.equal(PS5W.STORES.dotlife.hcSlug, 'dotlife');`
  - `assert.equal(PS5W.watchUrl(PS5W.STORES.dotlife), 'https://www.dotlife.store/digital-lifestyle/gaming-toy/gaming-console.html?brand%5Bfilter%5D=SONY%2C481#ps5watch');`

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test "userscript/test/*.test.js"`
  Expected: the new dotlife and store-table tests FAIL (`PS5W.parseDotlife is not a function` /
  `Cannot read properties of undefined`). The 128 existing tests still pass.

- [ ] **Step 3: Implement** in `userscript/ps5watch.user.js`, with the values from Global Constraints:
  - `STORES.dotlife`.
  - `feedRequest(store)`: `url` = `feed.url + '?query=' + encodeURIComponent(feed.query)`.
  - `parseDotlife`, following `parsePowerbuy`'s structure. Checks, in order:
    1. `PS5W.pageProblem`
    2. `JSON.parse` (catch → not JSON)
    3. a non-empty `errors` array → `dotlife feed error: ${errors[0].message}`
    4. `data.products.items` not an array (guard every hop, `null` included) → fields changed
    5. empty list → listed no products
    6. no item with non-empty string `name`, `url_key` and `stock_status` → product fields changed

    Then, per item:
    - skip it unless `name` and `url_key` are non-empty strings and `PS5W.isConsole(name)`
    - build the URL through `PS5W.normalizeUrl`, de-duplicated by URL in a `Map` (as Powerbuy does)
    - price via `PS5W.formatPrice(item.price_range?.minimum_price?.final_price?.value)`. Optional
      chaining is fine (Chrome and Node 24); `?.` is not used elsewhere in the file, so a guarded
      helper is equally fine.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test "userscript/test/*.test.js"`
  Expected: all pass (128 + 6 new tests; the store-table test grows in place).

- [ ] **Step 5: Commit**
```bash
git add userscript/ps5watch.user.js userscript/test/dotlife.test.js userscript/test/meta.test.js userscript/test/fixtures/dotlife-feed.json
git commit -m "feat(userscript): Dotlife feed parser and store entry"
```

### Task 2: Wire the feed into the check, metadata, docs

**Files:**
- Modify: `userscript/ps5watch.user.js`:
  - `fetchPage` (~line 699) and `checkStore` (~line 710)
  - the runner `env` comment (~line 659)
  - bootstrap `env.fetchText` (~line 927)
  - metadata block (lines 1-19)
- Modify: `userscript/test/runner.test.js` (`fakeEnv` + new tests), `userscript/test/meta.test.js`
- Modify: `userscript/README.md`, `README.md` (root)

**Interfaces:**
- Consumes: `PS5W.feedRequest`, `PS5W.parseDotlife`, `PS5W.STORES.dotlife` (Task 1)
- Produces:
  - `env.fetchText(url, init?)`: `init` is merged last over the defaults.
  - `fetchPage(env, url, init?)` passes `init` through.

- [ ] **Step 1: Write the failing tests.**
  - In `runner.test.js`, extend `fakeEnv`: add `fetchInit: []` to `calls`, and make it
    `fetchText: async (url, init) => { calls.fetch.push(url); calls.fetchInit.push(init); return env.page(url); }`.
  - `const DOT = PS5W.STORES.dotlife;` and `dlFeed` = the fixture text.

```js
test('Dotlife: one feed request with the store code and no cookies, then the parser', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: dlFeed });
  const res = await PS5W.checkStore(env, DOT);
  assert.deepEqual(env.calls.fetch, [PS5W.feedRequest(DOT).url]);
  assert.deepEqual(env.calls.fetchInit, [{ credentials: 'omit', headers: { Store: 'dth' } }]);
  assert.equal(res.blocked, false);
  assert.equal(res.products.length, 3);
});

test('Dotlife: an empty feed list is "needs you", never "all sold out"', async () => {
  const env = fakeEnv();
  env.state.flags = { reloaded: true, stuck: false };
  env.page = () => ({ status: 200, text: JSON.stringify({ data: { products: { total_count: 0, items: [] } } }) });
  await PS5W.runCheck(env, DOT);
  assert.equal(lastRender(env).mode, 'warn');
  assert.equal(lastRender(env).why, 'dotlife feed listed no products');
  assert.equal(env.calls.post.length, 1);
  assert.equal(env.calls.setItems.length, 0);
});

test('Dotlife: IN_STOCK pings once with the product link', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: dlFeed.replace('"OUT_OF_STOCK"', '"IN_STOCK"') });
  await PS5W.runCheck(env, DOT);
  assert.equal(lastRender(env).mode, 'stock');
  assert.equal(env.calls.post.length, 1);
  assert.match(JSON.stringify(env.calls.post[0]), /sony-ps5-console-e-chassis\.html/);
  assert.deepEqual(env.calls.ping, ['dotlife']);
});
```

  - In the existing first Powerbuy `checkStore`/`runCheck` test, add `assert.deepEqual(env.calls.fetchInit, [undefined]);`
    (the other stores keep the default cookies).
  - In `meta.test.js`:
    - add `has('@match https://www.dotlife.store/*');` to the metadata test
    - add a text pin:
      `assert.match(text, /fetch\(url, \{ cache: 'no-store', credentials: 'include', signal: AbortSignal\.timeout\(30000\), \.\.\.init \}\)/);`
      with test name `'page fetch: a per-request init overrides the defaults (the Dotlife feed must not send cookies)'`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test "userscript/test/*.test.js"`
  Expected: the new runner tests FAIL (checkStore treats Dotlife as JIB and fetches the HTML page), and
  the two meta checks FAIL.

- [ ] **Step 3: Implement**
  - `fetchPage(env, url, init)` → `env.fetchText(url, init)`.
  - `checkStore`: before the `SEARCH_PARSERS` line, if `store.feed`, call `PS5W.feedRequest(store)`, then
    `fetchPage(env, req.url, req.init)`, and return `PS5W.parseDotlife(page.status, page.text, origin)`.
  - Update the runner `env` comment to `fetchText(url, init?)`.
  - Bootstrap: `fetchText: async (url, init) => { const r = await fetch(url, { cache: 'no-store', credentials: 'include', signal: AbortSignal.timeout(30000), ...init }); … }`.
    The single line must match the meta pin, and its comment must say `init` overrides (the feed sends no cookies).
  - Metadata: add `// @match        https://www.dotlife.store/*` after the JIB match, and set `@version 1.1.0`.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test "userscript/test/*.test.js"`
  Expected: all pass, 0 failures.

- [ ] **Step 5: Docs**
  - `userscript/README.md`:
    - The intro reads "Powerbuy, Banana IT, JIB and Dotlife".
    - Healthchecks step 2 says four checks, adding `dotlife`; step 4's slug list and the "must end in" list add `/dotlife`.
    - Section 3 becomes "four watcher bookmarks", with a table row
      `| Dotlife | \`https://www.dotlife.store/digital-lifestyle/gaming-toy/gaming-console.html?brand%5Bfilter%5D=SONY%2C481#ps5watch\` |`.
    - "three tabs" → "four tabs" everywhere (lines ~46, ~57, ~117).
  - Root `README.md`:
    - The dotlife table row becomes "real Chrome tab on the laptop (userscript, iStudio's product feed)" with
      ✅ "real Chrome gets through; headless Chromium is blocked".
    - "dotlife stays off." is replaced by "The laptop watches dotlife."
    - Line ~18 "The laptop browser = Powerbuy + Banana IT + JIB + Dotlife".
    - Line ~100 "(Powerbuy, Banana IT, Dotlife)".
    - The Laptop browser watcher section: "watches Powerbuy, Banana IT, JIB and Dotlife from four Chrome tabs".
  - Check: `grep -n -i "three\|dotlife" README.md userscript/README.md`. No stale "three tabs" and no "dotlife is off" remain.

- [ ] **Step 6: Commit**
```bash
git add userscript/ps5watch.user.js userscript/test/runner.test.js userscript/test/meta.test.js userscript/README.md README.md
git commit -m "feat(userscript): watch Dotlife via its product feed (1.1.0)"
```

### Task 3: Ship and live check (needs Palm)

This runs on the laptop (`LAPTOP-FJIU5L3Q`), the same machine as the watcher Chrome.

- [ ] **Step 1: Push.** Ask Palm first. Tampermonkey updates from the raw GitHub URL on `main`.
  Run: `git push origin main`
- [ ] **Step 2: Update the script.** In Tampermonkey, use "check for userscript updates", or open the raw link
  and click Update. Confirm the dashboard shows `1.1.0`.
- [ ] **Step 3: Healthchecks.**
  - Create a check named `dotlife` with Period 5 min and Grace 5 min.
  - **Set its slug to `dotlife`** (renaming doesn't).
  - Confirm the Ping URL row ends in `/dotlife`.
- [ ] **Step 4: Open the Dotlife watcher bookmark.**
  - Expected: within a minute the box is green and lists 3 consoles as sold out, and Healthchecks `dotlife` is green.
  - Also check the other three tabs still go green, which means they still fetch with cookies.
