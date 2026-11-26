# Dotlife on the laptop watcher: design (2026-11-26)

Short design for a small change. Palm approved it in chat on 2026-11-26 ("okok").

## Why
Dotlife (www.dotlife.store) sells PS5s, and nothing watches it. GitHub's servers and our robot browser
both get Cloudflare HTTP 403 there. Palm's own Chrome loads the console page fine. Palm wants
dotlife added to the laptop userscript (`userscript/ps5watch.user.js`) next to Powerbuy, Banana IT
and JIB, so a dotlife restock pings Discord the same way.

**Success:** a PS5 console turning buyable online at dotlife pings Discord within about 2 minutes.
If the dotlife tab stops checking, Healthchecks (slug `dotlife`) says so.

## Goals / non-goals / anti-goals
- **Goals**
  - A fourth watcher tab, on dotlife's Sony console page, checks once a minute (same loop, box,
    Discord and Healthchecks as the other stores).
  - "Buyable" means exactly what the page shows. "ใส่ตะกร้า" (add to cart) counts as buyable;
    "สินค้าออนไลน์หมด" (sold out online) does not.
- **Non-goals**
  - Other dotlife categories, or iStudio's own store.
  - Any change to how the other three stores are checked.
- **Anti-goals** (from the laptop watcher design; still hold)
  - Reloading the page every minute. The only reload is the existing one ordinary reload on a block.
  - Disguising anything. The request is the same kind the page makes itself, from the same tab.
  - A watcher that goes quiet or says "all sold out" when it actually can't read the store.

## What we found (live, laptop Chrome, 2026-11-26)
- The page HTML has no products; it is a Magento PWA Studio storefront. The products come from iStudio's
  GraphQL feed `https://apim.istudio.store/graphql`, which is **cross-origin** (not dotlife.store).
- Requests are GET `?query=…` with the header **`Store: dth`** (dotlife TH store view).
  - **Without the header the feed answers 200 with an empty list.** It does not return an error.
  - **`credentials: 'include'` fails** ("Failed to fetch"; CORS refuses credentials).
  - `credentials: 'omit'` works.
- A wrong field name also answers HTTP 200, with `{"errors":[…]}`.
- Sony consoles = filter `{category_uid:{eq:"MTY5NQ=="}, brand:{eq:"481"}}` (Gaming Console, SONY).
  On 2026-11-26 this returned 3 consoles, all `OUT_OF_STOCK`.
- **`stock_status` drives the button.** On 5 products checked:
  - `IN_STOCK` showed "ใส่ตะกร้า".
  - `OUT_OF_STOCK` showed "สินค้าออนไลน์หมด".
  - `only_x_left_in_stock` is >0 exactly when IN_STOCK.
  - The Amasty label on the consoles is only "0% Installment".
- Product page URL = `https://www.dotlife.store/` + `url_key` + `url_suffix` (`.html`). These match the
  page's own links.
- The page also links `sony-ps5-console-pro.html`. That url_key returns no product in store `dth`, so
  it is a stale menu link, not a hidden console.

## Approaches
1. **Picked: the dotlife watcher tab asks the feed directly.** Once a minute, page `fetch` of our own
   small query (Sony console category), with `Store: dth` and no cookies. No reload. Tiny request,
   and it reads the exact field the page uses.
2. Reload the page and read the rendered cards. Rejected: a full reload per check is an anti-goal.
3. Ask the feed from another store's tab (Tampermonkey `GM_xmlhttpRequest` + `@connect`).
   Rejected: the request would no longer come from dotlife's own page.

Scope of the question, inside approach 1:
- **Picked: category + Sony brand.** This is the page Palm watches, 3 items, no noise.
- Brand only (58 Sony items) would catch a console filed in another category. It costs paging and
  pulls in headphones and games for the console filter to sort out.
- Text search is noisy: "playstation 5" returns AirPods and speakers.
- Revisit if a new console ever shows up outside Gaming Console.

## Design
- `PS5W.STORES.dotlife`:
  - name **Dotlife**, host `www.dotlife.store`
  - searchPath `/digital-lifestyle/gaming-toy/gaming-console.html?brand%5Bfilter%5D=SONY%2C481`
    (the watcher bookmark; `isWatcherLocation` compares only the path and `#ps5watch`)
  - `hcSlug: 'dotlife'`
  - plus the feed details: URL, store code `dth`, and our query.
- `checkStore`: a store with a feed fetches the feed URL with `{ credentials: 'omit', headers: { Store: 'dth' } }`
  and hands the reply to `parseDotlife`.
  - The other stores are unchanged.
  - `env.fetchText(url, init)` gains an optional `init`, merged over today's defaults
    (`cache: 'no-store'`, 30 s timeout).
- `parseDotlife(status, text, origin)` returns the same shape as the other parsers. Anything not
  normal comes back **blocked with a why**, so it shows "needs you" and never looks like "all sold out":
  - 403/429/503, other non-2xx, or a challenge page: the existing `pageProblem`.
  - Not JSON → `dotlife feed is not JSON`.
  - `errors` present → `dotlife feed error: <first message>`.
  - `data.products.items` missing or not a list → `dotlife feed fields changed`.
  - **Empty list** → `dotlife feed listed no products`. The page always lists sold-out consoles,
    so empty means a wrong store code or a moved category.
  - No item has `name`, `url_key` and `stock_status` → `dotlife product fields changed`.
- Per item:
  - Keep it only if `PS5W.isConsole(name)` (the same console filter, so controllers never count).
  - `available`: `IN_STOCK` → true, `OUT_OF_STOCK` → false, anything else → null (`stock fields missing`).
  - `reason: 'feed stock_status'`.
  - Price from `price_range.minimum_price.final_price.value`.
- Metadata: add `@match https://www.dotlife.store/*`. No `@connect` is needed, because this is a page
  `fetch`, not a GM request. Bump `@version` 1.0.1 → 1.1.0.
- Docs (`userscript/README.md`): a fourth watcher bookmark, and a Healthchecks check whose **slug is
  set** to `dotlife`.

## Left to the builder
- The exact GraphQL field list. At least `name url_key url_suffix stock_status only_x_left_in_stock`
  and the final price.
- A real feed reply saved as a test fixture.
- Box wording for the new whys, consistent with the existing ones.
- Live check on the laptop after install: the box goes green and lists 3 consoles, and Healthchecks
  `dotlife` turns green.
