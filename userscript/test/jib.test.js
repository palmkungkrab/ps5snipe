'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PS5W = require('../ps5watch.user.js');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const ld = (avail, price = '20990') => JSON.stringify({
  '@type': 'Product', name: 'PS5', offers: { '@type': 'Offer', price, availability: avail },
});
const ORIGIN = 'https://www.jib.co.th';

test('constants', () => {
  assert.equal(PS5W.JIB_GAP_MS, 1500);
  assert.equal(PS5W.JIB_MAX_PRODUCTS, 12);
});

test('parseJsonld ports test_jsonld', () => {
  assert.deepEqual(PS5W.parseJsonld([ld('https://schema.org/InStock')]), { available: true, price: '฿20,990', name: 'PS5' });
  assert.equal(PS5W.parseJsonld([ld('http://schema.org/OutOfStock')]).available, false);
  assert.equal(PS5W.parseJsonld([ld('PreOrder')]).available, true);
  assert.equal(PS5W.parseJsonld(['not json', '{}']).available, null);
  const graph = JSON.stringify({ '@graph': [{ '@type': 'Product', name: 'x', offers: [
    { '@type': 'Offer', availability: 'OutOfStock' }, { '@type': 'Offer', availability: 'InStock' }] }] });
  assert.equal(PS5W.parseJsonld([graph]).available, true);
});

test('decideSchema', () => {
  assert.equal(PS5W.decideSchema(['https://schema.org/Sold_Out']), false);
  assert.equal(PS5W.decideSchema(['Limited Availability']), true);
  assert.equal(PS5W.decideSchema([]), null);
  assert.equal(PS5W.decideSchema(['weird']), null);
});

test('parseJibSearch on the real page', () => {
  const r = PS5W.parseJibSearch(200, fx('jib-search.html'), ORIGIN);
  assert.equal(r.blocked, false);
  assert.ok(r.links.length >= 3, `links: ${r.links.length}`);
  assert.ok(r.links.length <= 12);
  const urls = r.links.map((l) => l.url);
  assert.equal(new Set(urls).size, urls.length);
  for (const l of r.links) {
    assert.ok(PS5W.isConsole(l.title), l.title);
    assert.ok(l.url.startsWith('https://www.jib.co.th/'), l.url);
    assert.ok(!l.url.includes('?') && !l.url.includes('#'));
  }
  assert.ok(urls.some((u) => u.includes('/readProduct/82892/')));
});

test('parseJibSearch drops non-console, foreign host, search page, dupes; keeps longest label; caps at 12', () => {
  const card = (id, t, host = 'www.jib.co.th') =>
    `<a href="https://${host}/web/product/readProduct/${id}/1/x">${t}</a>`;
  let html = card(1, 'PS5') + card(1, 'Sony PlayStation 5 Console Slim Digital Edition')
    + card(2, 'PlayStation 5 Console', 'evil.test') + card(3, 'Sony PS5 Dualsense Controller')
    + `<a href="${ORIGIN}/web/product/product_search/0?str_search=ps5">Sony PlayStation 5 Console</a>`
    + '<a href="javascript:void(0)">PlayStation 5 Console</a>';
  for (let i = 10; i < 30; i++) html += card(i, `Sony PlayStation 5 Console CFI-${2000 + i} Digital Edition`);
  const r = PS5W.parseJibSearch(200, html, ORIGIN, `${ORIGIN}/web/product/product_search/0?str_search=ps5`);
  assert.equal(r.links.length, 12);
  assert.equal(r.links[0].title, 'Sony PlayStation 5 Console Slim Digital Edition');
  assert.ok(!r.links.some((l) => /evil|product_search|\/3\//.test(l.url)));
});

test('parseJibProduct on the real page', () => {
  const r = PS5W.parseJibProduct(200, fx('jib-product.html'), `${ORIGIN}/web/product/readProduct/82892`, 'fallback');
  assert.equal(r.blocked, false);
  assert.equal(typeof r.product.available, 'boolean');
  assert.equal(r.product.available, false);
  assert.equal(r.product.reason, 'schema.org JSON-LD');
  assert.equal(r.product.price, '฿20,990');
  assert.ok(/PLAYSTATION 5 SLIM/.test(r.product.title));
  assert.notEqual(r.product.title, 'fallback');
  assert.equal(r.product.url, `${ORIGIN}/web/product/readProduct/82892`);
});

test('parseJibProduct microdata only', () => {
  const html = '<link itemprop="availability" href="https://schema.org/OutOfStock">';
  const r = PS5W.parseJibProduct(200, html, 'https://www.jib.co.th/p/1', 'T');
  assert.equal(r.product.available, false);
  assert.equal(r.product.reason, 'schema.org microdata');
  const m = PS5W.parseJibProduct(200, '<meta itemprop="availability" content="InStock">', 'u', 'T');
  assert.equal(m.product.available, true);
});

test('parseJibProduct without signal', () => {
  const r = PS5W.parseJibProduct(200, '<html><title>x</title></html>', 'https://www.jib.co.th/p/1', 'Fallback T');
  assert.equal(r.product.available, null);
  assert.equal(r.product.reason, 'no stock signal found');
  assert.equal(r.product.title, 'Fallback T');
});

test('blocked on both parsers', () => {
  const s = PS5W.parseJibSearch(403, fx('jib-search.html'), ORIGIN);
  assert.equal(s.blocked, true);
  assert.equal(typeof s.why, 'string');
  const p = PS5W.parseJibProduct(403, fx('jib-product.html'), 'u', 'T');
  assert.equal(p.blocked, true);
  assert.equal(PS5W.parseJibProduct(200, '<title>Just a moment...</title>', 'u', 'T').blocked, true);
});
