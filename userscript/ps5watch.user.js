// ==UserScript==
// @name         PS5 watch (laptop)
// @namespace    https://github.com/palmkungkrab/ps5snipe
// @version      1.2.1
// @description  Watches Powerbuy, Banana IT, JIB, Dotlife and Makro PRO for PS5 consoles from real Chrome tabs
// @match        https://www.powerbuy.co.th/*
// @match        https://www.bnn.in.th/*
// @match        https://www.jib.co.th/*
// @match        https://www.dotlife.store/*
// @match        https://www.makro.pro/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      discord.com
// @connect      discordapp.com
// @connect      hc-ping.com
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/palmkungkrab/ps5snipe/main/userscript/ps5watch.user.js
// @downloadURL  https://raw.githubusercontent.com/palmkungkrab/ps5snipe/main/userscript/ps5watch.user.js
// ==/UserScript==

/* Layout: metadata, pure core `PS5W` (Node-testable), browser-only bootstrap().
   Later tasks add sections to PS5W. */

const PS5W = {};

// ---------------------------------------------------------------- stores
PS5W.STORES = {
  powerbuy: { key: 'powerbuy', name: 'Powerbuy', host: 'www.powerbuy.co.th', searchPath: '/th/search/ps5', hcSlug: 'powerbuy' },
  banana: { key: 'banana', name: 'Banana IT', host: 'www.bnn.in.th', searchPath: '/th/p?q=playstation%205', hcSlug: 'banana-it' },
  jib: { key: 'jib', name: 'JIB', host: 'www.jib.co.th', searchPath: '/web/product/product_search/0?str_search=playstation%205', hcSlug: 'jib' },
  // The page HTML has no products: they come from iStudio's GraphQL feed (cross-origin). It needs the dotlife
  // store code (without it: 200 and an empty list) and refuses cookies. Gaming Console category, brand SONY.
  dotlife: {
    key: 'dotlife',
    name: 'Dotlife',
    host: 'www.dotlife.store',
    // page=1 included: without it the PWA rewrites the URL to add it and drops #ps5watch (seen live 2026-11-27).
    searchPath: '/digital-lifestyle/gaming-toy/gaming-console.html?brand%5Bfilter%5D=SONY%2C481&page=1',
    hcSlug: 'dotlife',
    feed: {
      url: 'https://apim.istudio.store/graphql',
      storeCode: 'dth',
      query: '{products(filter:{category_uid:{eq:"MTY5NQ=="},brand:{eq:"481"}},pageSize:40){total_count items{__typename name url_key url_suffix stock_status only_x_left_in_stock price_range{minimum_price{final_price{value currency}}}}}}',
    },
  },
  // Server-rendered search page (Next.js): product data with a stock flag is in __NEXT_DATA__, like Powerbuy.
  // No /th prefix: Thai is the default language, and the app rewrites /th/... to /... and drops #ps5watch (seen live).
  makro: { key: 'makro', name: 'Makro PRO', host: 'www.makro.pro', searchPath: '/c/search?q=ps5', hcSlug: 'makro' },
};

PS5W.storeForHost = function storeForHost(host) {
  return Object.values(PS5W.STORES).find((s) => s.host === host) || null;
};

PS5W.watchUrl = function watchUrl(store) {
  return `https://${store.host}${store.searchPath}#ps5watch`;
};

// A feed store's one request: GET with our query, its store code, and no cookies (the feed refuses them).
PS5W.feedRequest = function feedRequest(store) {
  const { url, storeCode, query } = store.feed;
  return {
    url: `${url}?query=${encodeURIComponent(query)}`,
    init: { credentials: 'omit', headers: { Store: storeCode } },
  };
};

// ---------------------------------------------------------------- matching
// Port of ps5snipe/matching.py (same patterns, case-insensitive).
PS5W.DEFAULT_INCLUDE = [
  /play\s*station\s*®?\s*5/i,
  /\bps\s*5\b/i,
];

// At least one must also match, so games/accessories that merely mention PS5 are skipped.
PS5W.DEFAULT_REQUIRE = [
  /console/i,
  /คอนโซล/i,
  /เครื่องเล่นเกม/i,
  /\bcfi-\d{4}/i,
  /\basia-\d{5}\b/i,
  /\bps\s*5\s*pro\b/i,
  /playstation\s*®?\s*5\s*pro/i,
  /\bslim\b.*\b(digital|disc)\b/i,
  /\b(digital|disc)\s+edition\b/i,
];

PS5W.DEFAULT_EXCLUDE = [
  /disc\s*drive/i, /ไดรฟ์/i, /vertical\s*stand/i, /ขาตั้ง/i, /\bstand\b/i,
  /\bcover\b/i, /ฝาครอบ/i, /\bcase\b/i, /เคส/i, /\bskin\b/i, /สติ๊กเกอร์/i, /ฟิล์ม/i,
  /charging/i, /charger/i, /แท่นชาร์จ/i, /headset/i, /หูฟัง/i, /\bpulse\b/i,
  /\bvr\s*2\b/i, /portal/i, /แผ่นเกม/i, /\becas-/i, /\bpcas-/i, /\bcfi-z/i,
  /remote/i, /รีโมท/i, /cooling/i, /พัดลม/i, /\bbag\b/i, /กระเป๋า/i,
];

// A title that names a controller is a controller, unless it also carries a sign only a console
// listing has (Powerbuy sells "DualSense ... ASIA-00500" and "... สำหรับคอนโซล PS5" controllers).
// Same rule as ps5snipe/matching.py.
PS5W.CONTROLLER_RE = /controller|คอนโทรลเลอร์|dualsense|จอย/i;
PS5W.CONSOLE_SIGN_RE = /\bbundle\b|\bcfi-[127]\d{3}|\b\d+\s*(tb|gb)\b|\bdigital\b|\bdisc\b|\b2nd\b|จอย\s*2\s*ตัว|\bchassis\b|game\s*console/i;

const squashSpaces = (s) => String(s || '').split(/\s+/).filter(Boolean).join(' ');

// An accessory word, or a controller without a console sign: never a console, whatever else the title says.
PS5W.isAccessory = function isAccessory(title) {
  const t = squashSpaces(title);
  if (PS5W.DEFAULT_EXCLUDE.some((r) => r.test(t))) return true;
  return PS5W.CONTROLLER_RE.test(t) && !PS5W.CONSOLE_SIGN_RE.test(t);
};

PS5W.isConsole = function isConsole(title) {
  const t = squashSpaces(title);
  if (!t) return false;
  if (!PS5W.DEFAULT_INCLUDE.some((r) => r.test(t))) return false;
  if (!PS5W.DEFAULT_REQUIRE.some((r) => r.test(t))) return false;
  return !PS5W.isAccessory(t);
};

// ---------------------------------------------------------------- alerts
// Port of ps5snipe/state.py should_alert + mark_gone. Pure: returns new objects.
PS5W.RENOTIFY_MS = 900000;

PS5W.nextAlerts = function nextAlerts(items, products, now, renotifyMs) {
  const out = {};
  for (const url of Object.keys(items || {})) out[url] = { ...items[url] };
  const alerts = [];
  const seen = new Set();
  for (const p of products) {
    seen.add(p.url);
    const was = out[p.url] ? out[p.url].available : undefined;
    const rec = { ...(out[p.url] || {}), title: p.title, seen: now };
    out[p.url] = rec;
    if (p.available === null || p.available === undefined) {
      if (!('available' in rec)) rec.available = null;
      continue;
    }
    rec.available = p.available;
    if (p.available !== true) {
      if (was === true) rec.wentOut = now;
      continue;
    }
    if (was !== true || (renotifyMs > 0 && now - (rec.notified || 0) >= renotifyMs)) {
      rec.notified = now;
      alerts.push(p);
    }
  }
  // After a good check, a known in-stock URL that vanished from the list can't be bought.
  // Unlike Python's mark_gone this applies to an empty list too (Banana lists only buyable items).
  for (const url of Object.keys(out)) {
    if (!seen.has(url) && out[url].available === true) {
      out[url].available = false;
      out[url].wentOut = now;
    }
  }
  return { items: out, alerts };
};

PS5W.loadItems = function loadItems(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) { return {}; }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};

// ---------------------------------------------------------------- decisions
PS5W.INTERVAL_MS = 60000;
PS5W.JITTER_MS = 10000;
PS5W.STUCK_RETRY_MS = 300000;
PS5W.LOCK_STALE_MS = 180000;
PS5W.HEARTBEAT_MS = 15000;

// Block handling: reload once, then "needs you" once, then "watching again" on the first good check.
PS5W.blockStep = function blockStep(flags, blocked) {
  const f = flags || {};
  const reloaded = f.reloaded === true;
  const stuck = f.stuck === true;
  if (!blocked) {
    return {
      action: stuck ? 'recovered' : 'continue',
      flags: { reloaded: false, stuck: false },
    };
  }
  if (!reloaded) return { action: 'reload', flags: { reloaded: true, stuck: false } };
  if (!stuck) return { action: 'needsYou', flags: { reloaded: true, stuck: true } };
  return { action: 'stillStuck', flags: { reloaded: true, stuck: true } };
};

// random in [0,1): normal = INTERVAL +/- JITTER (never under 50 s); stuck = fixed retry.
PS5W.nextDelayMs = function nextDelayMs(kind, random) {
  if (kind === 'stuck') return PS5W.STUCK_RETRY_MS;
  return PS5W.INTERVAL_MS - PS5W.JITTER_MS + Math.floor(random * 2 * PS5W.JITTER_MS);
};

// Heartbeat lock { id, ts }: another tab's fresh lock means it watches; anything else, we do.
PS5W.lockDecision = function lockDecision(lock, myId, now) {
  if (!lock || typeof lock !== 'object') return 'mine';
  if (typeof lock.id !== 'string' || typeof lock.ts !== 'number') return 'mine';
  if (lock.id === myId) return 'mine';
  return now - lock.ts > PS5W.LOCK_STALE_MS ? 'mine' : 'other';
};

// First check after a page load (including the block reload): wait out a normal gap since the last check started.
// Never more than one normal gap, so a clock that moved backwards can't stall the first check.
PS5W.firstDelayMs = function firstDelayMs(lastCheckAt, now, random) {
  if (!Number.isFinite(lastCheckAt)) return 0;
  const gap = PS5W.nextDelayMs('normal', random);
  return Math.min(Math.max(0, lastCheckAt + gap - now), gap);
};

// A tab watches only on its store's watch page with #ps5watch. Path only: stores may rewrite the query.
PS5W.isWatcherLocation = function isWatcherLocation(loc, store) {
  return loc.hash === '#ps5watch' && loc.pathname === new URL(PS5W.watchUrl(store)).pathname;
};

// ---------------------------------------------------------------- messages
// Payloads mirror ps5snipe/notify.py (Discord.in_stock / info).
PS5W.LABEL = '💻 laptop';

PS5W.buildInStock = function buildInStock(product, storeName, userId) {
  return {
    content: `<@${userId}> 🟢 **PS5 IN STOCK at ${storeName}!** ${PS5W.LABEL} ${product.url}`,
    embeds: [{
      title: String(product.title).slice(0, 250),
      url: product.url,
      color: 0x2ECC71,
      fields: [
        { name: 'Store', value: storeName, inline: true },
        { name: 'Price', value: product.price || '-', inline: true },
        { name: 'Detected by', value: product.reason || '-', inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { users: [userId] },
  };
};

// A blocked check's why: only a challenge page or HTTP 403/429 means "prove you're human".
PS5W.isHumanCheck = function isHumanCheck(why) {
  const w = String(why == null ? '' : why);
  return w.startsWith('challenge page') || w === 'HTTP 403' || w === 'HTTP 429';
};

const UNKNOWN_WHY = 'still stuck after a reload';

PS5W.buildNeedsYou = function buildNeedsYou(storeName, userId, why) {
  const line2 = PS5W.isHumanCheck(why)
    ? `${storeName} is asking whether you're human. The tab reloaded once and is still stuck, so **${storeName} is NOT being watched**. `
      + `Solve the check on the ${storeName} tab on the laptop and watching restarts by itself.`
    : `${storeName} is NOT being watched: ${why || UNKNOWN_WHY}. If the ${storeName} tab on the laptop looks normal, reload it once. `
      + 'If this keeps happening, the script needs an update.';
  return {
    content: `<@${userId}> ⚠️ **${storeName} needs you** ${PS5W.LABEL}\n${line2}`,
    allowed_mentions: { users: [userId] },
  };
};

PS5W.buildWatchingAgain = function buildWatchingAgain(storeName) {
  return {
    content: `✅ ${storeName} is being watched again ${PS5W.LABEL}`,
    allowed_mentions: { parse: [] },
  };
};

PS5W.buildTest = function buildTest(store, userId) {
  return PS5W.buildInStock({
    title: 'Test notification from ps5watch (not a real restock)',
    url: PS5W.watchUrl(store).replace('#ps5watch', ''),
    price: '฿0',
    reason: 'test ping button',
    available: true,
  }, `TEST (${store.name})`, userId);
};

PS5W.hcUrl = function hcUrl(key, slug) {
  return `https://hc-ping.com/${key}/${slug}`;
};

// ---------------------------------------------------------------- settings
PS5W.cleanSettings = function cleanSettings(raw) {
  const r = raw || {};
  const settings = {
    webhook: String(r.webhook == null ? '' : r.webhook).trim(),
    userId: String(r.userId == null ? '' : r.userId).trim(),
    hcKey: String(r.hcKey == null ? '' : r.hcKey).trim(),
  };
  const errors = [];
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(settings.webhook)) errors.push('Discord webhook link');
  if (!/^\d{17,20}$/.test(settings.userId)) errors.push('Discord user ID');
  if (!/^[A-Za-z0-9_-]{8,}$/.test(settings.hcKey)) errors.push('Healthchecks ping key');
  return { settings, errors };
};

// ---------------------------------------------------------------- render
// Pure: return strings. The browser layer puts BOX_CSS + renderBox() in a shadow root.
PS5W.escapeHtml = function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};

PS5W.tabTitle = function tabTitle(mode, storeName) {
  if (mode === 'stock') return `🔥 IN STOCK · ${storeName}`;
  if (mode === 'warn') return `⚠️ Needs you · ${storeName}`;
  if (mode === 'setup') return '⚙️ Set up · PS5 watch';
  return `🟢 PS5 watch · ${storeName}`;
};

PS5W.BOX_CSS = `
.box { position:fixed; right:10px; bottom:10px; z-index:2147483647; width:310px; box-sizing:border-box; background:#111; color:#eee; font:12px/1.45 system-ui,sans-serif; padding:10px 12px; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.4); }
.box .hd { display:flex; justify-content:space-between; align-items:center; font-weight:700; font-size:13px; }
.box .x { background:none; border:0; color:#9ca3af; cursor:pointer; font-size:14px; padding:0 2px; }
.box .st { margin-top:6px; padding:6px 8px; border-radius:6px; background:#1f2937; }
.box .st.stock { background:#14532d; color:#bbf7d0; font-weight:700; }
.box .st.warn { background:#713f12; color:#fde68a; }
.box .err { margin-top:4px; color:#fca5a5; }
.box ul { list-style:none; margin:8px 0 0; padding:0; }
.box li { display:flex; justify-content:space-between; gap:8px; padding:3px 0; border-bottom:1px solid #222; }
.box li.dim { opacity:.5; }
.box li a { color:#86efac; }
.box .ft { margin-top:8px; display:flex; justify-content:space-between; align-items:center; color:#9ca3af; gap:6px; }
.box .ok { color:#86efac; }
.box button.b { background:#2d2d2d; color:#eee; border:1px solid #444; border-radius:6px; padding:3px 8px; font:inherit; cursor:pointer; }
.box label { display:block; color:#9ca3af; font-size:11px; }
.box input { width:100%; box-sizing:border-box; background:#1f1f1f; border:1px solid #444; color:#eee; border-radius:6px; padding:4px 6px; font:inherit; margin:2px 0 6px; }
.box .hint { color:#9ca3af; font-size:11px; margin:6px 0 8px; }
.box .errs { color:#fca5a5; font-size:11px; margin:0 0 6px; }
.pill { position:fixed; right:10px; bottom:10px; z-index:2147483647; background:#111; color:#eee; border:1px solid #444; border-radius:999px; padding:5px 12px; font:12px/1.4 system-ui,sans-serif; cursor:pointer; box-shadow:0 4px 16px rgba(0,0,0,.4); }
.pill.stock { background:#14532d; color:#bbf7d0; font-weight:700; }
.pill.warn { background:#713f12; color:#fde68a; }
.pill.passive { pointer-events:none; cursor:default; }
`;

function pad2(n) { return String(n).padStart(2, '0'); }
function clock(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function productList(products, dim) {
  const rows = (products || []).map((p) => {
    const mark = p.available === true ? '✅' : p.available === false ? '❌' : '❔';
    const open = p.available === true
      ? ` · <a href="${PS5W.escapeHtml(p.url)}" target="_blank" rel="noopener">open</a>` : '';
    const price = p.price ? PS5W.escapeHtml(p.price) : '';
    return `<li${dim ? ' class="dim"' : ''}><span>${mark} ${PS5W.escapeHtml(p.title)}</span><span>${price}${open}</span></li>`;
  });
  return `<ul>${rows.join('')}</ul>`;
}

PS5W.renderBox = function renderBox(view) {
  const esc = PS5W.escapeHtml;
  const mode = view.mode;
  const store = esc(view.storeName);
  if (mode === 'pill') {
    // Passive (non-watcher tabs): text only, clicks pass through to the store page (checkout buttons).
    if (view.passive) return `<div class="pill passive">${esc(view.pillText)}</div>`;
    return `<button class="pill" data-act="expand">${esc(view.pillText)}</button>`;
  }
  const hd = `<div class="hd"><span>🎮 PS5 watch · ${store}</span><button class="x" title="Shrink" data-act="shrink">✕</button></div>`;
  if (mode === 'setup') {
    const s = view.settings || {};
    const errs = (view.errors || []).length
      ? `<div class="errs">Check: ${view.errors.map(esc).join(', ')}</div>` : '';
    return `<div class="box">${hd}
<div class="hint">First time on this browser: paste these once. They're saved in this browser only, never in the public repo.</div>${errs}
<label>Discord webhook link</label><input name="webhook" value="${esc(s.webhook)}" placeholder="https://discord.com/api/webhooks/…">
<label>Your Discord user ID (for the @mention)</label><input name="userId" value="${esc(s.userId)}" placeholder="1234567890…">
<label>Healthchecks ping key (one key; checks named powerbuy, banana-it, jib, dotlife, makro)</label><input name="hcKey" value="${esc(s.hcKey)}" placeholder="abc123…">
<div class="ft"><span>Shared by all store tabs</span><span><button class="b" data-act="test">Test ping</button> <button class="b" data-act="save">Save</button></span></div></div>`;
  }
  const time = view.lastCheck ? clock(view.lastCheck) : '';
  let st;
  if (mode === 'stock') {
    const hit = (view.products || []).find((p) => p.available === true);
    st = `<div class="st stock">🔥 ${hit ? esc(hit.title) : 'A PS5'} is IN STOCK${time ? ` · checked ${time}` : ''}`;
  } else if (mode === 'warn') {
    st = PS5W.isHumanCheck(view.why)
      ? `<div class="st warn">⚠️ ${store} is asking if you're human. Reloaded once, still stuck.<br>Solve the check on this tab and watching restarts by itself.`
      : `<div class="st warn">⚠️ ${store} is NOT being watched: ${esc(view.why || UNKNOWN_WHY)}.<br>`
        + 'If this tab looks normal, reload it once. If this keeps happening, the script needs an update.';
  } else {
    st = `<div class="st">🟢 ${time ? `Checked ${time} · next check in about 60 s` : 'Watching'}`;
  }
  if (view.error) st += `<div class="err">${esc(view.error)}</div>`;
  st += '</div>';
  const hc = mode === 'warn' ? 'Healthchecks: paused' : `Healthchecks ${view.hcOk ? '✓' : '✗'}`;
  const dc = `Discord ${view.discordOk ? '✓' : '✗'}`;
  const okCls = (view.discordOk && (view.hcOk || mode === 'warn')) ? ' class="ok"' : '';
  return `<div class="box">${hd}${st}${productList(view.products, mode === 'warn')}
<div class="ft"><span${okCls}>${dc} · ${hc}</span><span><button class="b" data-act="test">Test ping</button> <button class="b" data-act="settings">Settings</button></span></div></div>`;
};

// ---------------------------------------------------------------- shared helpers
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return String(s).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return Object.prototype.hasOwnProperty.call(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    try { return String.fromCodePoint(cp); } catch (e) { return m; }
  });
}

function tagAttrs(tag) {
  const out = {};
  const re = /([^\s"'<>\/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]);
  }
  return out;
}

// Every <a href> in raw HTML. label = inner text + title attr + inner alt attrs.
function anchorList(html) {
  const out = [];
  const re = /<a\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const attrs = tagAttrs(m[1]);
    if (attrs.href === undefined) continue;
    const alts = [];
    const imgRe = /<img\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
    let im;
    while ((im = imgRe.exec(m[2]))) {
      const a = tagAttrs(im[1]).alt;
      if (a) alts.push(a);
    }
    const text = decodeEntities(m[2].replace(/<[^>]*>/g, ' '));
    const label = [text, attrs.title, ...alts].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    out.push({ href: attrs.href, label, inner: m[2] });
  }
  return out;
}

PS5W.anchors = function anchors(html) {
  return anchorList(html).map((a) => ({ href: a.href, label: a.label }));
};

// Absolute http(s) URL without query/hash, or null for anything else.
PS5W.normalizeUrl = function normalizeUrl(href, origin) {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (!h || h.startsWith('#')) return null;
  try {
    const u = new URL(h, origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.search = '';
    u.hash = '';
    return u.href;
  } catch (e) {
    return null;
  }
};

PS5W.formatPrice = function formatPrice(value) {
  const s = String(value === null || value === undefined ? '' : value).replace(/[฿,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(parseFloat(s));
  return n > 0 ? `฿${n.toLocaleString('en-US')}` : null;
};

// Port of BLOCK_TITLES (ps5snipe/checkers/browser.py:41).
PS5W.BLOCK_TITLES = /just a moment|attention required|access denied|verify you are human|please wait|security check|ddos|captcha|robot/i;

PS5W.isBlockedPage = function isBlockedPage(status, html) {
  if ([403, 429, 503].includes(status)) return true;
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  return !!t && PS5W.BLOCK_TITLES.test(t[1]);
};

// null when the page is usable, else a why string: block status/title, or any other non-2xx status.
PS5W.pageProblem = function pageProblem(status, html) {
  if ([403, 429, 503].includes(status)) return `HTTP ${status}`;
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  const title = t ? t[1].replace(/\s+/g, ' ').trim() : '';
  if (PS5W.BLOCK_TITLES.test(title)) return `challenge page: ${title}`;
  if (!(status >= 200 && status < 300)) return `HTTP ${status}`;
  return null;
};

// ---------------------------------------------------------------- stores: JIB parsers
PS5W.JIB_GAP_MS = 1500;
PS5W.JIB_MAX_PRODUCTS = 12;

// Ports of IN_STOCK_SCHEMA / OUT_SCHEMA (browser.py:44-45).
const IN_STOCK_SCHEMA = ['instock', 'preorder', 'presale', 'limitedavailability', 'onlineonly', 'instoreonly', 'backorder'];
const OUT_SCHEMA = ['outofstock', 'soldout', 'discontinued'];

function walk(obj, out) {
  if (Array.isArray(obj)) obj.forEach((v) => walk(v, out));
  else if (obj && typeof obj === 'object') {
    out.push(obj);
    Object.values(obj).forEach((v) => walk(v, out));
  }
  return out;
}

function schemaTypes(node) {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x) => typeof x === 'string').map((x) => x.toLowerCase());
}

PS5W.decideSchema = function decideSchema(values) {
  const norm = values.filter(Boolean)
    .map((v) => String(v).toLowerCase().split('/').pop().replace(/_/g, '').replace(/ /g, ''));
  if (norm.some((v) => IN_STOCK_SCHEMA.includes(v))) return true;
  if (norm.some((v) => OUT_SCHEMA.includes(v))) return false;
  return null;
};

PS5W.parseJsonld = function parseJsonld(blobs) {
  const avail = [];
  let price = null;
  let name = null;
  for (const raw of blobs) {
    let data;
    try { data = JSON.parse(String(raw).trim()); } catch (e) { continue; }
    for (const node of walk(data, [])) {
      const types = schemaTypes(node);
      if (types.includes('product') || types.includes('productgroup')) name = name || node.name || null;
      if ('availability' in node) {
        avail.push(String(node.availability));
        const p = PS5W.formatPrice(node.price || node.lowPrice);
        if (p && !price) price = p;
      }
    }
  }
  return { available: PS5W.decideSchema(avail), price, name };
};

PS5W.parseJibSearch = function parseJibSearch(status, html, origin, selfUrl) {
  const problem = PS5W.pageProblem(status, html);
  if (problem) return { blocked: true, why: problem };
  if (!/\/web\/product\/readProduct\//.test(String(html || ''))) return { blocked: true, why: 'not the normal search page' };
  const host = new URL(origin).host;
  const self = PS5W.normalizeUrl(selfUrl || PS5W.STORES.jib.searchPath, origin);
  const byUrl = new Map();
  for (const a of PS5W.anchors(html)) {
    const url = PS5W.normalizeUrl(a.href, origin);
    if (!url || new URL(url).host !== host || url === self || !PS5W.isConsole(a.label)) continue;
    const prev = byUrl.get(url);
    if (!prev || a.label.length > prev.title.length) byUrl.set(url, { url, title: a.label });
  }
  return { blocked: false, links: [...byUrl.values()].slice(0, PS5W.JIB_MAX_PRODUCTS) };
};

PS5W.parseJibProduct = function parseJibProduct(status, html, url, fallbackTitle) {
  const problem = PS5W.pageProblem(status, html);
  if (problem && PS5W.isBlockedPage(status, html)) return { blocked: true, why: problem };
  if (problem) return { blocked: false, product: { title: fallbackTitle, url, price: null, available: null, reason: problem } };
  const src = String(html || '');
  const blobs = [];
  const ldRe = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(src))) blobs.push(m[1]);
  const ld = PS5W.parseJsonld(blobs);
  const product = { title: ld.name || fallbackTitle, url, price: ld.price, available: ld.available, reason: 'schema.org JSON-LD' };
  if (product.available === null) {
    const micro = [];
    const tagRe = /<[a-z]+\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
    while ((m = tagRe.exec(src))) {
      const attrs = tagAttrs(m[0]);
      if ((attrs.itemprop || '').toLowerCase() === 'availability') micro.push(attrs.content || attrs.href || '');
    }
    product.available = PS5W.decideSchema(micro);
    product.reason = product.available === null ? 'no stock signal found' : 'schema.org microdata';
  }
  return { blocked: false, product };
};

// ---------------------------------------------------------------- stores: Powerbuy and Banana IT parsers
// Port of OOS_RE (browser.py:31).
PS5W.OOS_RE = /สินค้าหมด|หมดชั่วคราว|หมดสต็อก|หมดสต๊อก|ไม่มีสินค้า|สินค้าไม่พร้อมจำหน่าย|แจ้งเตือนเมื่อ(?:สินค้า|มีสินค้า)|out\s*of\s*stock|sold\s*out|currently\s*unavailable|not\s*available|notify\s*me|temporarily\s*unavailable/i;

const NOT_NORMAL = 'not the normal search page';

// Powerbuy field names come from a third-party script and our fixture is synthetic, so check them before trusting them.
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const finiteStock = (v) => (typeof v === 'number' && Number.isFinite(v))
  || (nonEmptyString(v) && Number.isFinite(Number(v)));
const hasDeliveryKey = (p) => 'canDelivery' in p || 'canPickup' in p;
const pbShapeOk = (p) => !!p && typeof p === 'object'
  && nonEmptyString(p.name) && nonEmptyString(p.slugname) && finiteStock(p.stockAvail) && hasDeliveryKey(p);

// Powerbuy search page: __NEXT_DATA__ -> props.pageProps.productListData.products.
PS5W.parsePowerbuy = function parsePowerbuy(status, html, origin) {
  const problem = PS5W.pageProblem(status, html);
  if (problem) return { blocked: true, why: problem };
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  let list = null;
  if (m) {
    try { list = JSON.parse(m[1]).props.pageProps.productListData.products; } catch (e) { list = null; }
  }
  if (!Array.isArray(list)) return { blocked: true, why: NOT_NORMAL };
  // Not one entry has the fields we read: a renamed field would otherwise look like "every console sold out".
  if (list.length && !list.some(pbShapeOk)) return { blocked: true, why: 'Powerbuy product fields changed' };
  const byUrl = new Map();
  for (const p of list) {
    if (!p || typeof p !== 'object' || !nonEmptyString(p.name) || !PS5W.isConsole(p.name)) continue;
    if (!nonEmptyString(p.slugname)) continue; // no slug, no URL key of its own
    const url = PS5W.normalizeUrl(`${origin}/th/product/${p.slugname.trim()}`, origin);
    if (!url || byUrl.has(url)) continue;
    const known = finiteStock(p.stockAvail) && hasDeliveryKey(p);
    byUrl.set(url, {
      title: p.name,
      url,
      price: PS5W.formatPrice(p.priceSort),
      available: known ? Number(p.stockAvail) > 0 && !!(p.canDelivery || p.canPickup) : null,
      reason: known ? 'search page stock flag' : 'stock fields missing',
    });
  }
  return { blocked: false, products: [...byUrl.values()] };
};

function cardText(inner) {
  return decodeEntities(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Inner HTML of the <div> whose open tag ends at `from`, up to its matching </div>.
function divBody(html, from) {
  const re = /<div\b(?:"[^"]*"|'[^']*'|[^>"'])*>|<\/div\s*>/gi;
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index);
  }
  return html.slice(from);
}

// Name: the product-name div (its title, else its text); else the first titled <div> with no <img> inside
// (a badge or label); else the text before the first baht sign.
function bananaTitle(inner, text) {
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const divRe = /<div\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
  let fallback = '';
  let t;
  while ((t = divRe.exec(inner))) {
    const attrs = tagAttrs(t[0]);
    const title = squash(attrs.title);
    if (/(^|\s)product-name(\s|$)/.test(attrs.class || '')) {
      const name = title || cardText(divBody(inner, divRe.lastIndex));
      if (name) return name;
    }
    if (title && !fallback && !/<img\b/i.test(divBody(inner, divRe.lastIndex))) fallback = title;
  }
  return fallback || text.split('฿')[0].trim();
}

// "Save ฿300" badges are not prices.
const SAVING_RE = /(?:ประหยัด(?:ไป)?|you\s*save|save)\s*฿\s*[\d,]+(?:\.\d+)?/gi;

// First baht amount outside <del>/<s>/<strike> (old crossed-out price) and savings badges.
function bananaPrice(inner) {
  const live = inner.replace(/<(del|s|strike)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const m = /฿\s*([\d,]+(?:\.\d+)?)/.exec(cardText(live).replace(SAVING_RE, ' '));
  return m ? PS5W.formatPrice(m[1]) : null;
}

// A search-result card that reads as a product (any product): a name and a baht price inside the link.
const bananaCardParses = (a) => a.href.includes('ref=search-result')
  && !!bananaTitle(a.inner, cardText(a.inner)) && !!bananaPrice(a.inner);

// Banana IT search page: cards are <a href="/th/p/...?ref=search-result">. It lists only items ready to sell.
// Normal only if at least one card parses, so a markup change can't pass as "no consoles in stock".
PS5W.parseBanana = function parseBanana(status, html, origin) {
  const problem = PS5W.pageProblem(status, html);
  if (problem) return { blocked: true, why: problem };
  const all = anchorList(html);
  if (!all.some(bananaCardParses)) return { blocked: true, why: NOT_NORMAL };
  const byUrl = new Map();
  for (const a of all) {
    if (!a.href.includes('/th/p/')) continue;
    const text = cardText(a.inner);
    if (!text.includes('฿')) continue;
    const title = bananaTitle(a.inner, text);
    const url = PS5W.normalizeUrl(a.href, origin);
    if (!url || byUrl.has(url) || !PS5W.isConsole(title)) continue;
    byUrl.set(url, {
      title,
      url,
      price: bananaPrice(a.inner),
      available: !PS5W.OOS_RE.test(text),
      reason: 'search card text',
    });
  }
  return { blocked: false, products: [...byUrl.values()] };
};

// Dotlife feed reply (JSON). stock_status is what the page's button follows: IN_STOCK shows "ใส่ตะกร้า",
// OUT_OF_STOCK shows "สินค้าออนไลน์หมด". The category lists sold-out consoles too, so an empty list is not normal.
const dlShapeOk = (i) => !!i && typeof i === 'object'
  && nonEmptyString(i.name) && nonEmptyString(i.url_key) && nonEmptyString(i.stock_status);
const DL_AVAILABLE = { IN_STOCK: true, OUT_OF_STOCK: false };

function dlPrice(item) {
  const min = item.price_range && item.price_range.minimum_price;
  const final = min && min.final_price;
  return PS5W.formatPrice(final ? final.value : null);
}

PS5W.parseDotlife = function parseDotlife(status, text, origin) {
  const problem = PS5W.pageProblem(status, text);
  if (problem) return { blocked: true, why: problem };
  let reply;
  try { reply = JSON.parse(String(text)); } catch (e) { return { blocked: true, why: 'dotlife feed is not JSON' }; }
  if (reply && Array.isArray(reply.errors) && reply.errors.length) {
    const first = reply.errors[0];
    return { blocked: true, why: `dotlife feed error: ${first && first.message ? first.message : 'unknown'}` };
  }
  const products = reply && reply.data && reply.data.products;
  const items = products && products.items;
  if (!Array.isArray(items)) return { blocked: true, why: 'dotlife feed fields changed' };
  if (!items.length) return { blocked: true, why: 'dotlife feed listed no products' };
  if (!items.some(dlShapeOk)) return { blocked: true, why: 'dotlife product fields changed' };
  const byUrl = new Map();
  for (const i of items) {
    if (!i || typeof i !== 'object' || !nonEmptyString(i.name) || !nonEmptyString(i.url_key)) continue;
    if (!PS5W.isConsole(i.name)) continue;
    const suffix = typeof i.url_suffix === 'string' ? i.url_suffix : '.html';
    const url = PS5W.normalizeUrl(`${origin}/${i.url_key.trim()}${suffix}`, origin);
    if (!url || byUrl.has(url)) continue;
    const known = Object.prototype.hasOwnProperty.call(DL_AVAILABLE, i.stock_status);
    byUrl.set(url, {
      title: i.name,
      url,
      price: dlPrice(i),
      available: known ? DL_AVAILABLE[i.stock_status] : null,
      reason: known ? 'feed stock_status' : 'stock fields missing',
    });
  }
  // This list always holds consoles: none recognised means renamed listings, not "all sold out".
  if (!byUrl.size) return { blocked: true, why: 'dotlife feed listed no consoles' };
  return { blocked: false, products: [...byUrl.values()] };
};

// Makro PRO search page: __NEXT_DATA__ -> props.pageProps.initialSearchResult.hits[].document.
// Each product has a Thai title and an English titleEn; inStock is 1 or 0. In-stock items come first and sold-out
// consoles fall off the first page, so a normal page often lists no console at all. Marketplace sellers count too.
const mkId = (d) => [d.productId, d.id].find(nonEmptyString) || null;
const mkTitles = (d) => [d.title, d.titleEn].filter(nonEmptyString);
const mkShapeOk = (d) => !!d && typeof d === 'object' && mkTitles(d).length > 0 && !!mkId(d) && typeof d.inStock === 'number';

PS5W.parseMakro = function parseMakro(status, html, origin) {
  const problem = PS5W.pageProblem(status, html);
  if (problem) return { blocked: true, why: problem };
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  let hits = null;
  if (m) {
    try { hits = JSON.parse(m[1]).props.pageProps.initialSearchResult.hits; } catch (e) { hits = null; }
  }
  if (!Array.isArray(hits)) return { blocked: true, why: NOT_NORMAL };
  // "ps5" always finds accessories: an empty list means the search broke, not "nothing in stock".
  if (!hits.length) return { blocked: true, why: 'Makro search listed no products' };
  const docs = hits.map((h) => (h && typeof h === 'object' ? h.document : null));
  if (!docs.some(mkShapeOk)) return { blocked: true, why: 'Makro product fields changed' };
  const byUrl = new Map();
  for (const d of docs) {
    if (!d || typeof d !== 'object' || !mkId(d)) continue;
    // Either title may name the console (Thai titles often spell PlayStation in Thai); an accessory word in either
    // rules it out (the stand's Thai title says "for the PS5 console", its English one says "Vertical Stand").
    const titles = mkTitles(d);
    if (!titles.some(PS5W.isConsole) || titles.some(PS5W.isAccessory)) continue;
    const url = PS5W.normalizeUrl(`${origin}/th/p/${mkId(d).trim()}`, origin);
    if (!url || byUrl.has(url)) continue;
    const known = d.inStock === 1 || d.inStock === 0;
    const seller = nonEmptyString(d.seller) ? ` · sold by ${d.seller.trim()}` : '';
    byUrl.set(url, {
      title: titles[0],
      url,
      price: PS5W.formatPrice(d.displayPrice),
      available: known ? d.inStock === 1 : null,
      reason: known ? `search page stock flag${seller}` : 'stock fields missing',
    });
  }
  return { blocked: false, products: [...byUrl.values()] };
};

// ---------------------------------------------------------------- runner
// env: { fetchText(url, init?)->Promise<{status,text}>, sleep(ms), now(), random(), getItems(slug), setItems(slug, items),
//        getFlags(), setFlags(flags), settings(), postDiscord(payload)->Promise<boolean>,
//        pingHealthchecks(slug)->Promise<boolean>, reload(), render(view) }

PS5W.MAX_RETRY_AFTER_MS = 30000;

// Up to 4 tries. 2xx -> true; 429 -> wait retryAfterMs (or 2 s; at most 30 s); throw -> wait 1, 2, 4 s; other status -> false.
PS5W.postWithRetry = async function postWithRetry(sendOnce, sleep) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const last = attempt === 3;
    let res;
    try {
      res = await sendOnce();
    } catch (e) {
      if (!last) await sleep(2 ** attempt * 1000);
      continue;
    }
    const status = res && res.status;
    if (status >= 200 && status < 300) return true;
    if (status !== 429) return false;
    if (!last) await sleep(Math.min(res.retryAfterMs || 2000, PS5W.MAX_RETRY_AFTER_MS));
  }
  return false;
};

// A webhook reply as postWithRetry wants it. Discord's 429 body has retry_after in seconds.
PS5W.discordReply = function discordReply(status, text) {
  let retryAfterMs = 0;
  if (status === 429) {
    try {
      const s = JSON.parse(text).retry_after;
      if (typeof s === 'number' && s > 0) retryAfterMs = Math.min(Math.ceil(s * 1000), PS5W.MAX_RETRY_AFTER_MS);
    } catch (e) { /* no usable body: postWithRetry waits 2 s */ }
  }
  return { status, retryAfterMs };
};

const SEARCH_PARSERS = { powerbuy: 'parsePowerbuy', banana: 'parseBanana', makro: 'parseMakro' };

// env.fetchText, with its rejection marked as a network error (anything else that throws is not one).
async function fetchPage(env, url, init) {
  try {
    return await env.fetchText(url, init);
  } catch (e) {
    const err = new Error(e && e.message ? e.message : String(e));
    err.network = true;
    throw err;
  }
}

// Fetch and parse one store. A rejected fetch rejects with err.network set.
PS5W.checkStore = async function checkStore(env, store) {
  const origin = `https://${store.host}`;
  if (store.feed) {
    const req = PS5W.feedRequest(store);
    const reply = await fetchPage(env, req.url, req.init);
    return PS5W.parseDotlife(reply.status, reply.text, origin);
  }
  const searchUrl = origin + store.searchPath;
  const page = await fetchPage(env, searchUrl);
  if (SEARCH_PARSERS[store.key]) return PS5W[SEARCH_PARSERS[store.key]](page.status, page.text, origin);
  const search = PS5W.parseJibSearch(page.status, page.text, origin, searchUrl);
  if (search.blocked) return search;
  const products = [];
  for (let i = 0; i < search.links.length; i++) {
    if (i > 0) await env.sleep(PS5W.JIB_GAP_MS);
    const link = search.links[i];
    const res = await fetchPage(env, link.url);
    const r = PS5W.parseJibProduct(res.status, res.text, link.url, link.title);
    if (r.blocked) return r;
    products.push(r.product);
  }
  return { blocked: false, products };
};

// Per-env memory: last non-setup view and the Discord result carried between rounds.
const MEMORY = new WeakMap();
function memoryOf(env) {
  if (!MEMORY.has(env)) MEMORY.set(env, { view: null, discordOk: true });
  return MEMORY.get(env);
}

async function settled(promiseFn) {
  try { return (await promiseFn()) === true; } catch (e) { return false; }
}

// Valid settings, or null after showing the setup box (never posts with a bad webhook or empty user ID).
function usableSettings(env, store) {
  const { settings, errors } = PS5W.cleanSettings(env.settings());
  if (!errors.length) return settings;
  env.render({ mode: 'setup', storeName: store.name, errors, settings });
  return null;
}

function show(env, mem, view) {
  mem.view = view;
  env.render(view);
}

// One round. Returns { delayMs } for the next round, or null when the loop stops (tab reloading, or no settings).
PS5W.runCheck = async function runCheck(env, store) {
  const mem = memoryOf(env);
  const settings = usableSettings(env, store);
  if (!settings) return null;
  const prev = mem.view;
  const flags = env.getFlags();
  let result;
  try {
    result = await PS5W.checkStore(env, store);
  } catch (e) {
    const mode = prev ? prev.mode : (flags && flags.stuck === true ? 'warn' : 'ok');
    show(env, mem, {
      mode,
      storeName: store.name,
      lastCheck: prev ? prev.lastCheck : null,
      products: prev ? prev.products : [],
      discordOk: mem.discordOk,
      hcOk: false,
      why: prev ? prev.why : undefined,
      error: `${e && e.network ? 'network error' : 'check failed'}: ${e && e.message ? e.message : e}`,
    });
    return { delayMs: PS5W.nextDelayMs('normal', env.random()) };
  }

  const step = PS5W.blockStep(flags, result.blocked);
  env.setFlags(step.flags);
  if (step.action === 'reload') {
    env.reload();
    return null;
  }
  const post = (payload) => settled(() => env.postDiscord(payload));

  if (result.blocked) {
    if (step.action === 'needsYou') mem.discordOk = await post(PS5W.buildNeedsYou(store.name, settings.userId, result.why));
    show(env, mem, {
      mode: 'warn',
      storeName: store.name,
      lastCheck: prev ? prev.lastCheck : null,
      products: prev ? prev.products : [],
      discordOk: mem.discordOk,
      hcOk: false,
      why: result.why,
      error: `blocked: ${result.why}`,
    });
    return { delayMs: PS5W.STUCK_RETRY_MS };
  }

  const now = env.now();
  const next = PS5W.nextAlerts(PS5W.loadItems(env.getItems(store.hcSlug)), result.products, now, PS5W.RENOTIFY_MS);
  env.setItems(store.hcSlug, next.items);
  const payloads = next.alerts.map((p) => PS5W.buildInStock(p, store.name, settings.userId));
  if (step.action === 'recovered') payloads.push(PS5W.buildWatchingAgain(store.name));
  if (payloads.length) {
    let allOk = true;
    for (const payload of payloads) {
      if (!(await post(payload))) allOk = false;
    }
    mem.discordOk = allOk;
  }
  const hcOk = await settled(() => env.pingHealthchecks(store.hcSlug));
  show(env, mem, {
    mode: result.products.some((p) => p.available === true) ? 'stock' : 'ok',
    storeName: store.name,
    lastCheck: now,
    products: result.products,
    discordOk: mem.discordOk,
    hcOk,
  });
  return { delayMs: PS5W.nextDelayMs('normal', env.random()) };
};

// The box's Test ping. Resolves the Discord result (false when settings are unusable; the setup box is shown).
PS5W.sendTest = async function sendTest(env, store) {
  const mem = memoryOf(env);
  const settings = usableSettings(env, store);
  if (!settings) return false;
  const ok = await settled(() => env.postDiscord(PS5W.buildTest(store, settings.userId)));
  mem.discordOk = ok;
  if (mem.view) show(env, mem, { ...mem.view, discordOk: ok });
  return ok;
};

// Text of the shrunk box.
PS5W.pillText = function pillText(view) {
  if (view.mode === 'stock') return `🔥 IN STOCK · ${view.storeName}`;
  if (view.mode === 'warn') return `⚠️ Needs you · ${view.storeName}`;
  if (view.mode === 'setup') return '⚙️ Set up';
  if (!view.lastCheck) return `🟢 ${view.storeName}`;
  const d = new Date(view.lastCheck);
  return `🟢 ${view.storeName} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// ---------------------------------------------------------------- browser
// Thin layer over the core: storage, timers, the shadow-root box, GM requests. Checked live (not by Node tests).
/* global GM_getValue, GM_setValue, GM_xmlhttpRequest */
function bootstrap() {
  const store = PS5W.storeForHost(location.host);
  if (!store) return;
  const OTHER_RETRY_MS = 60000;
  const LOCK_KEY = 'ps5watch-lock';

  // Every storage read falls back to a default; every write is best effort.
  const read = (fn, fallback) => {
    try { const v = fn(); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
  };
  const write = (fn) => { try { fn(); } catch (e) { /* storage blocked or full: keep watching */ } };
  const readJson = (getStorage, key, fallback) => read(() => JSON.parse(getStorage().getItem(key)), fallback);
  const readSettings = () => read(() => GM_getValue('settings', null), null);
  const tabId = read(() => {
    let id = sessionStorage.getItem('ps5watch-tab-id');
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('ps5watch-tab-id', id);
    }
    return id;
  }, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const lockNow = () => PS5W.lockDecision(readJson(() => localStorage, LOCK_KEY, null), tabId, Date.now());

  // Closed root, kept only in this closure: store page scripts can't reach the settings form (it holds the webhook).
  // The host gets no id or attributes.
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  document.documentElement.appendChild(host);
  const paint = (html) => { root.innerHTML = `<style>${PS5W.BOX_CSS}</style>${html}`; };
  const pill = (text) => paint(PS5W.renderBox({ mode: 'pill', storeName: store.name, pillText: text, passive: true }));

  // Any other tab of the store (shopping, checkout): never checks, never reloads, never touches the title.
  const showOtherPill = () => pill(lockNow() === 'other' ? 'PS5 watch running in another tab' : 'PS5 watch: no watcher tab open');
  const asNonWatcher = () => {
    showOtherPill();
    setInterval(showOtherPill, OTHER_RETRY_MS);
  };
  const onWatchPage = () => PS5W.isWatcherLocation(location, store);
  if (!onWatchPage()) {
    asNonWatcher();
    return;
  }

  const LAST_CHECK_KEY = 'ps5watch-last-check'; // start time of the last check; survives the block reload
  let holding = false; // this tab owns the lock
  let left = false; // the tab moved off the watch page (in-page navigation): it never watches again
  let heartbeat = null;
  let running = false; // the check loop is scheduled or in flight
  let loopTimer = null;
  let settingsTimer = null;
  let editing = false; // the settings form is on screen: loop renders update the title only
  let shown = null; // view currently drawn
  let lastWatch = null; // last non-setup view from the core

  const isMin = () => read(() => sessionStorage.getItem('ps5watch-min'), '') === '1';
  const draw = (view) => {
    shown = view;
    paint(isMin()
      ? PS5W.renderBox({ mode: 'pill', storeName: store.name, pillText: PS5W.pillText(view) })
      : PS5W.renderBox(view));
  };
  const setupView = (settings, errors) => ({ mode: 'setup', storeName: store.name, settings, errors });
  const waitingView = () => ({ mode: 'ok', storeName: store.name, lastCheck: null, products: [], discordOk: true, hcOk: true });

  function gmRequest(details) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 15000,
        ...details,
        onload: resolve,
        onerror: () => reject(new Error('request failed')),
        ontimeout: () => reject(new Error('request timed out')),
        onabort: () => reject(new Error('request aborted')),
      });
    });
  }

  const env = {
    fetchText: async (url, init) => {
      // A stalled request becomes a network error after 30 s instead of hanging the loop.
      // init goes last and overrides the defaults: the Dotlife feed must send no cookies (it refuses them).
      const r = await fetch(url, { cache: 'no-store', credentials: 'include', signal: AbortSignal.timeout(30000), ...init });
      return { status: r.status, text: await r.text() };
    },
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    now: () => Date.now(),
    random: () => Math.random(),
    getItems: (slug) => read(() => GM_getValue(`items:${slug}`, {}), {}),
    setItems: (slug, items) => write(() => GM_setValue(`items:${slug}`, items)),
    getFlags: () => readJson(() => sessionStorage, 'ps5watch-flags', {}),
    setFlags: (flags) => write(() => sessionStorage.setItem('ps5watch-flags', JSON.stringify(flags))),
    settings: readSettings,
    postDiscord: (payload) => PS5W.postWithRetry(async () => {
      const r = await gmRequest({
        method: 'POST',
        url: PS5W.cleanSettings(readSettings()).settings.webhook,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
      });
      return PS5W.discordReply(r.status, r.responseText);
    }, env.sleep),
    pingHealthchecks: async (slug) => {
      try {
        const r = await gmRequest({ method: 'GET', url: PS5W.hcUrl(PS5W.cleanSettings(readSettings()).settings.hcKey, slug) });
        return r.status >= 200 && r.status < 300;
      } catch (e) {
        return false;
      }
    },
    reload: () => {
      // Never reload a page Palm moved to inside this tab (product, cart, checkout).
      if (!onWatchPage()) {
        leave();
        return;
      }
      location.reload();
    },
    render: (view) => {
      if (left) return;
      document.title = PS5W.tabTitle(view.mode, store.name);
      if (view.mode === 'setup') {
        editing = true;
        draw(view);
        return;
      }
      lastWatch = view;
      if (!editing) draw(view);
    },
  };

  function stopHolding() {
    holding = false;
    running = false;
    clearInterval(heartbeat);
    pill('PS5 watch already watching in another tab');
    setTimeout(claim, OTHER_RETRY_MS);
  }

  // The tab moved off the watch page without a page load: stop for good, free our lock, never reload.
  function leave() {
    if (left) return;
    left = true;
    holding = false;
    running = false;
    clearTimeout(loopTimer);
    clearTimeout(settingsTimer);
    clearInterval(heartbeat);
    write(() => {
      const lock = JSON.parse(localStorage.getItem(LOCK_KEY));
      if (lock && lock.id === tabId) localStorage.removeItem(LOCK_KEY);
    });
    asNonWatcher();
  }

  async function tick() {
    loopTimer = null;
    if (!onWatchPage()) {
      leave();
      return;
    }
    if (lockNow() !== 'mine') {
      stopHolding();
      return;
    }
    // Stamp the start before any fetch, so a reload mid-check still spaces the next one.
    if (!PS5W.cleanSettings(readSettings()).errors.length) {
      write(() => sessionStorage.setItem(LAST_CHECK_KEY, String(Date.now())));
    }
    let r;
    try {
      r = await PS5W.runCheck(env, store);
    } catch (e) {
      r = { delayMs: PS5W.nextDelayMs('normal', Math.random()) }; // never let the loop die
    }
    if (!holding) return;
    if (r) {
      loopTimer = setTimeout(tick, r.delayMs);
    } else {
      running = false; // reloading, or waiting for settings (another tab may save them)
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(waitForSettings, OTHER_RETRY_MS);
    }
  }

  // First check: at once on a fresh tab, otherwise a normal gap after the last check started (block reload included).
  function start() {
    if (running || !holding) return;
    running = true;
    const delay = PS5W.firstDelayMs(readJson(() => sessionStorage, LAST_CHECK_KEY, undefined), Date.now(), Math.random());
    if (delay <= 0) {
      tick();
      return;
    }
    if (!editing) draw(lastWatch || waitingView());
    loopTimer = setTimeout(tick, delay);
  }

  function waitForSettings() {
    if (running || !holding) return;
    if (!PS5W.cleanSettings(readSettings()).errors.length) {
      editing = false;
      start();
      return;
    }
    settingsTimer = setTimeout(waitForSettings, OTHER_RETRY_MS);
  }

  function claim() {
    if (left) return;
    if (!onWatchPage()) {
      leave();
      return;
    }
    if (lockNow() !== 'mine') {
      pill('PS5 watch already watching in another tab');
      setTimeout(claim, OTHER_RETRY_MS);
      return;
    }
    const writeLock = () => write(() => localStorage.setItem(LOCK_KEY, JSON.stringify({ id: tabId, ts: Date.now() })));
    holding = true;
    writeLock();
    heartbeat = setInterval(() => { if (lockNow() === 'mine') writeLock(); }, PS5W.HEARTBEAT_MS);
    start();
  }

  // Save: show the errors, or store the settings and make sure the loop runs.
  function saveForm() {
    const value = (name) => { const el = root.querySelector(`input[name="${name}"]`); return el ? el.value : ''; };
    const { settings, errors } = PS5W.cleanSettings({ webhook: value('webhook'), userId: value('userId'), hcKey: value('hcKey') });
    if (errors.length) {
      draw(setupView(settings, errors));
      return false;
    }
    write(() => GM_setValue('settings', settings));
    editing = false;
    draw(lastWatch || waitingView());
    start();
    return true;
  }

  root.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!btn || !holding) return;
    const act = btn.getAttribute('data-act');
    if (act === 'save') saveForm();
    else if (act === 'test') {
      // From the form, Test saves first, so a test only ever uses stored, valid settings.
      if (editing && !saveForm()) return;
      PS5W.sendTest(env, store);
    } else if (act === 'settings') {
      editing = true;
      draw(setupView(PS5W.cleanSettings(readSettings()).settings, []));
    } else if (act === 'shrink' || act === 'expand') {
      write(() => sessionStorage.setItem('ps5watch-min', act === 'shrink' ? '1' : '0'));
      if (shown) draw(shown);
    }
  });

  claim();
}

if (typeof module === 'object' && module.exports) module.exports = PS5W; else bootstrap();
