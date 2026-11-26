// ==UserScript==
// @name         PS5 watch (laptop)
// @namespace    https://github.com/palmkungkrab/ps5snipe
// @version      0.1.0
// @description  Watches Powerbuy, Banana IT and JIB for PS5 consoles from real Chrome tabs
// @match        https://www.powerbuy.co.th/*
// @match        https://www.bnn.in.th/*
// @match        https://www.jib.co.th/*
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
};

PS5W.storeForHost = function storeForHost(host) {
  return Object.values(PS5W.STORES).find((s) => s.host === host) || null;
};

PS5W.watchUrl = function watchUrl(store) {
  return `https://${store.host}${store.searchPath}#ps5watch`;
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

PS5W.isConsole = function isConsole(title) {
  const t = String(title || '').split(/\s+/).filter(Boolean).join(' ');
  if (!t) return false;
  if (!PS5W.DEFAULT_INCLUDE.some((r) => r.test(t))) return false;
  if (!PS5W.DEFAULT_REQUIRE.some((r) => r.test(t))) return false;
  return !PS5W.DEFAULT_EXCLUDE.some((r) => r.test(t));
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

PS5W.buildNeedsYou = function buildNeedsYou(storeName, userId) {
  return {
    content: `<@${userId}> ⚠️ **${storeName} needs you** ${PS5W.LABEL}\n`
      + `${storeName} is asking whether you're human. The tab reloaded once and is still stuck, so **${storeName} is NOT being watched**. `
      + `Solve the check on the ${storeName} tab on the laptop and watching restarts by itself.`,
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
<label>Healthchecks ping key (one key; checks named powerbuy, banana-it, jib)</label><input name="hcKey" value="${esc(s.hcKey)}" placeholder="abc123…">
<div class="ft"><span>Shared by all store tabs</span><span><button class="b" data-act="test">Test ping</button> <button class="b" data-act="save">Save</button></span></div></div>`;
  }
  const time = view.lastCheck ? clock(view.lastCheck) : '';
  let st;
  if (mode === 'stock') {
    const hit = (view.products || []).find((p) => p.available === true);
    st = `<div class="st stock">🔥 ${hit ? esc(hit.title) : 'A PS5'} is IN STOCK${time ? ` · checked ${time}` : ''}`;
  } else if (mode === 'warn') {
    st = `<div class="st warn">⚠️ ${store} is asking if you're human. Reloaded once, still stuck.<br>Solve the check on this tab and watching restarts by itself.`;
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

// ---------------------------------------------------------------- (later tasks add sections here)

// ---------------------------------------------------------------- browser
function bootstrap() {}

if (typeof module === 'object' && module.exports) module.exports = PS5W; else bootstrap();
