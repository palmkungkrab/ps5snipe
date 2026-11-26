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

// ---------------------------------------------------------------- (later tasks add sections here)

// ---------------------------------------------------------------- browser
function bootstrap() {}

if (typeof module === 'object' && module.exports) module.exports = PS5W; else bootstrap();
