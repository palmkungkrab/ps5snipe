'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PS5W = require('../ps5watch.user.js');

const DL = 'https://www.dotlife.store';
// Real feed reply, captured 2026-11-26 from the laptop's Chrome with the script's own query.
const feed = fs.readFileSync(path.join(__dirname, 'fixtures', 'dotlife-feed.json'), 'utf8');
const feedWith = (edit) => {
  const j = JSON.parse(feed);
  edit(j.data.products.items);
  return JSON.stringify(j);
};

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
  const r = PS5W.parseDotlife(200, feedWith((it) => {
    it[0].stock_status = 'IN_STOCK';
    it[1].stock_status = 'PRE_ORDER';
    delete it[2].stock_status;
  }), DL);
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
  const r = PS5W.parseDotlife(200, feedWith((it) => {
    delete it[0].url_suffix;
    delete it[0].price_range;
    it.push({ ...it[1] });
  }), DL);
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
