'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PS5W = require('../ps5watch.user.js');

const T = new Date(2026, 10, 26, 20, 41, 7).getTime();
const A = { title: 'PS5 Digital Edition', url: 'https://example.test/digital', price: '฿18,790', available: true };
const B = { title: 'PS5 Pro 2TB', url: 'https://example.test/pro', price: '฿26,990', available: false };
const base = { storeName: 'Powerbuy', lastCheck: T, products: [A, B], discordOk: true, hcOk: true };

test('tabTitle values', () => {
  assert.equal(PS5W.tabTitle('ok', 'Powerbuy'), '🟢 PS5 watch · Powerbuy');
  assert.equal(PS5W.tabTitle('stock', 'Powerbuy'), '🔥 IN STOCK · Powerbuy');
  assert.equal(PS5W.tabTitle('warn', 'Powerbuy'), '⚠️ Needs you · Powerbuy');
  assert.equal(PS5W.tabTitle('setup', 'Powerbuy'), '⚙️ Set up · PS5 watch');
});

test('escapeHtml escapes & < > " \' and tolerates null', () => {
  assert.equal(PS5W.escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(PS5W.escapeHtml(null), '');
});

test('stock view: IN STOCK, tick, href, safe link', () => {
  const h = PS5W.renderBox({ ...base, mode: 'stock' });
  assert.match(h, /IN STOCK/);
  assert.match(h, /✅/);
  assert.match(h, /href="https:\/\/example\.test\/digital"/);
  assert.match(h, /target="_blank" rel="noopener"/);
  assert.match(h, /class="st stock"/);
});

test('ok view: sold-out cross, footer ticks, local HH:MM:SS, no open link', () => {
  const h = PS5W.renderBox({ ...base, mode: 'ok', products: [B] });
  assert.match(h, /❌/);
  assert.match(h, /Discord ✓/);
  assert.match(h, /Healthchecks ✓/);
  assert.match(h, /20:41:07/);
  assert.doesNotMatch(h, /href=/);
  assert.match(h, /data-act="test"/);
  assert.match(h, /data-act="settings"/);
  assert.match(h, /data-act="shrink"/);
});

test('zero-padded time and failing footer', () => {
  const h = PS5W.renderBox({ ...base, mode: 'ok', lastCheck: new Date(2026, 10, 26, 3, 4, 5).getTime(), discordOk: false, hcOk: false });
  assert.match(h, /03:04:05/);
  assert.match(h, /Discord ✗/);
  assert.match(h, /Healthchecks ✗/);
});

test('unknown availability shows ❔', () => {
  const h = PS5W.renderBox({ ...base, mode: 'ok', products: [{ ...B, available: null }] });
  assert.match(h, /❔/);
});

test('warn view: human check text, Healthchecks paused, dimmed list', () => {
  for (const why of ['HTTP 403', 'HTTP 429', 'challenge page: Just a moment...']) {
    const h = PS5W.renderBox({ ...base, mode: 'warn', why });
    assert.match(h, /asking if you're human/, why);
    assert.match(h, /Healthchecks: paused/);
    assert.doesNotMatch(h, /Healthchecks ✓/);
    assert.match(h, /class="st warn"/);
    assert.match(h, /<li class="dim">/);
  }
});

test('warn view: any other cause names it and asks for one reload, not a human check', () => {
  const h = PS5W.renderBox({ ...base, mode: 'warn', why: 'not the normal search page' });
  assert.match(h, /Powerbuy is NOT being watched: not the normal search page\./);
  assert.match(h, /If this tab looks normal, reload it once\. If this keeps happening, the script needs an update\./);
  assert.doesNotMatch(h, /human/);
  assert.match(h, /Healthchecks: paused/);
});

test('warn view and needs you without a cause (network error right after a stuck reload) never say "undefined"', () => {
  const h = PS5W.renderBox({ ...base, mode: 'warn' });
  assert.match(h, /Powerbuy is NOT being watched: still stuck after a reload\./);
  assert.doesNotMatch(h, /undefined|human/);
  const m = PS5W.buildNeedsYou('Powerbuy', '42');
  assert.match(m.content, /Powerbuy is NOT being watched: still stuck after a reload\./);
  assert.doesNotMatch(m.content, /undefined/);
});

test('warn view: the cause is escaped', () => {
  const h = PS5W.renderBox({ ...base, mode: 'warn', why: '<img src=x onerror=alert(1)>' });
  assert.match(h, /NOT being watched: &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(h, /<img/);
});

test('error line is shown and escaped', () => {
  const h = PS5W.renderBox({ ...base, mode: 'ok', error: '<b>net down</b>' });
  assert.match(h, /&lt;b&gt;net down&lt;\/b&gt;/);
  assert.doesNotMatch(h, /<b>net down/);
});

test('setup view: three inputs, save and test buttons, hint', () => {
  const h = PS5W.renderBox({ mode: 'setup', storeName: 'Powerbuy' });
  for (const n of ['webhook', 'userId', 'hcKey']) assert.match(h, new RegExp(`<input[^>]*name="${n}"`));
  assert.match(h, /data-act="save"/);
  assert.match(h, /data-act="test"/);
  assert.match(h, /never in the public repo/);
});

test('setup view lists errors and prefills settings, escaped', () => {
  const h = PS5W.renderBox({
    mode: 'setup', storeName: 'Powerbuy', errors: ['Discord <user> ID'],
    settings: { webhook: 'x"y', userId: 'uid1', hcKey: 'key1' },
  });
  assert.match(h, /Discord &lt;user&gt; ID/);
  assert.match(h, /value="x&quot;y"/);
  assert.match(h, /value="uid1"/);
  assert.match(h, /value="key1"/);
});

test('pill view: text and expand button, no list', () => {
  const h = PS5W.renderBox({ ...base, mode: 'pill', pillText: '🟢 Powerbuy · 20:41' });
  assert.match(h, /🟢 Powerbuy · 20:41/);
  assert.match(h, /data-act="expand"/);
  assert.doesNotMatch(h, /passive/);
  assert.doesNotMatch(h, /<ul>/);
});

test('passive pill (other tabs): plain text that never takes a click', () => {
  const h = PS5W.renderBox({ mode: 'pill', storeName: 'Powerbuy', pillText: 'PS5 watch running in another tab', passive: true });
  assert.match(h, /PS5 watch running in another tab/);
  assert.match(h, /class="pill passive"/);
  assert.doesNotMatch(h, /data-act/);
  assert.doesNotMatch(h, /<button/);
  assert.match(PS5W.BOX_CSS, /\.pill\.passive\s*\{[^}]*pointer-events:\s*none/);
});

test('hostile product strings are escaped', () => {
  const evil = { title: '<img src=x onerror=alert(1)>&', url: 'https://e.test/?a="b"&c=<d>', price: "<b>'", available: true };
  const h = PS5W.renderBox({ ...base, mode: 'stock', products: [evil] });
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;&amp;'));
  assert.doesNotMatch(h, /<img/);
  assert.doesNotMatch(h, /href="[^"]*"[^>]*"b"/);
  assert.ok(h.includes('&quot;b&quot;'));
});

test('BOX_CSS is a scoped string with fixed positioning', () => {
  assert.equal(typeof PS5W.BOX_CSS, 'string');
  assert.match(PS5W.BOX_CSS, /position:\s*fixed/);
  assert.match(PS5W.BOX_CSS, /#111/);
});
