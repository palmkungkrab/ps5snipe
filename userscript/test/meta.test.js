'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'ps5watch.user.js');
const text = fs.readFileSync(FILE, 'utf8');
const RAW = 'https://raw.githubusercontent.com/palmkungkrab/ps5snipe/main/userscript/ps5watch.user.js';

function metaLines() {
  const m = text.match(/\/\/ ==UserScript==\r?\n([\s\S]*?)\/\/ ==\/UserScript==/);
  assert.ok(m, 'metadata block present');
  return m[1].split(/\r?\n/).map((l) => l.replace(/^\/\/\s?/, '').replace(/\s+/g, ' ').trim());
}

test('metadata block has the required lines', () => {
  const lines = metaLines();
  const has = (s) => assert.ok(lines.includes(s), `missing: ${s}`);
  has('@name PS5 watch (laptop)');
  has('@namespace https://github.com/palmkungkrab/ps5snipe');
  assert.ok(lines.some((l) => /^@version \d+\.\d+\.\d+$/.test(l)), 'semver @version');
  has('@match https://www.powerbuy.co.th/*');
  has('@match https://www.bnn.in.th/*');
  has('@match https://www.jib.co.th/*');
  has('@grant GM_getValue');
  has('@grant GM_setValue');
  has('@grant GM_xmlhttpRequest');
  has('@connect discord.com');
  has('@connect discordapp.com');
  has('@connect hc-ping.com');
  has('@run-at document-idle');
  has('@noframes');
  has('@updateURL ' + RAW);
  has('@downloadURL ' + RAW);
});

test('no secrets in the file', () => {
  assert.doesNotMatch(text, /discord(app)?\.com\/api\/webhooks\/\d+\//);
  assert.doesNotMatch(text, /hc-ping\.com\/[A-Za-z0-9_-]{8,}/);
});

test('status box shadow root is closed and never read back (settings form holds the webhook)', () => {
  const attaches = text.match(/attachShadow\([^)]*\)/g) || [];
  assert.deepEqual(attaches, ["attachShadow({ mode: 'closed' })"]);
  assert.doesNotMatch(text, /\.shadowRoot\b/);
});

test('non-watcher pills are passive, so they never cover a checkout button', () => {
  assert.match(text, /const pill = \(text\) => paint\(PS5W\.renderBox\(\{[^}]*passive: true[^}]*\}\)\);/);
  const pillCalls = text.match(/\bpill\('[^']*'\)/g) || [];
  assert.ok(pillCalls.length >= 2, 'already-watching pills go through pill()');
  assert.match(text, /const showOtherPill = \(\) => pill\(/);
});

test('store table', () => {
  const PS5W = require('../ps5watch.user.js');
  assert.equal(PS5W.storeForHost('www.powerbuy.co.th').name, 'Powerbuy');
  assert.equal(PS5W.storeForHost('example.com'), null);
  assert.equal(PS5W.watchUrl(PS5W.STORES.banana), 'https://www.bnn.in.th/th/p?q=playstation%205#ps5watch');
  assert.equal(PS5W.STORES.jib.hcSlug, 'jib');
  assert.equal(PS5W.STORES.banana.hcSlug, 'banana-it');
  assert.equal(PS5W.storeForHost('www.dotlife.store').name, 'Dotlife');
  assert.equal(PS5W.STORES.dotlife.hcSlug, 'dotlife');
  assert.equal(PS5W.watchUrl(PS5W.STORES.dotlife), 'https://www.dotlife.store/digital-lifestyle/gaming-toy/gaming-console.html?brand%5Bfilter%5D=SONY%2C481#ps5watch');
});
