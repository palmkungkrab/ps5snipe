'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PS5W = require('../ps5watch.user.js');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const PB = 'https://www.powerbuy.co.th';
const BN = 'https://www.bnn.in.th';
const pbHtml = fx('powerbuy-search.synthetic.html');

function pbWith(edit) {
  const m = /(<script id="__NEXT_DATA__"[^>]*>)([\s\S]*?)(<\/script>)/.exec(pbHtml);
  const data = JSON.parse(m[2]);
  edit(data.props.pageProps.productListData.products);
  return pbHtml.replace(m[0], m[1] + JSON.stringify(data) + m[3]);
}

test('OOS_RE matches Thai and English sold-out wording', () => {
  for (const s of ['สินค้าหมด', 'Out of stock', 'SOLD OUT', 'แจ้งเตือนเมื่อมีสินค้า', 'currently unavailable']) {
    assert.ok(PS5W.OOS_RE.test(s), s);
  }
  assert.ok(!PS5W.OOS_RE.test('PlayStation 5 Slim ฿18,790'));
});

test('Powerbuy (synthetic fixture): consoles only, all sold out', () => {
  const r = PS5W.parsePowerbuy(200, pbHtml, PB);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.products.map((p) => p.title), [
    'PlayStation 5 Slim Console Disc Edition (CFI-2118A01)',
    'PlayStation 5 Digital Edition (CFI-2118B01)',
  ]);
  for (const p of r.products) {
    assert.ok(PS5W.isConsole(p.title));
    assert.ok(p.url.startsWith('https://www.powerbuy.co.th/th/product/'), p.url);
    assert.strictEqual(p.available, false);
    assert.equal(p.reason, 'search page stock flag');
  }
  assert.equal(r.products[0].price, '฿19,990');
  assert.equal(r.products[0].url, 'https://www.powerbuy.co.th/th/product/playstation-5-slim-console-disc-edition-cfi-2118a01-1000001');
});

test('Powerbuy (synthetic fixture): stock variants', () => {
  const avail = (edit) => PS5W.parsePowerbuy(200, pbWith((ps) => edit(ps[0])), PB).products[0].available;
  assert.strictEqual(avail((p) => { p.stockAvail = 2; p.canDelivery = true; p.canPickup = false; }), true);
  assert.strictEqual(avail((p) => { p.stockAvail = 2; p.canDelivery = false; p.canPickup = true; }), true);
  assert.strictEqual(avail((p) => { p.stockAvail = 0; p.canDelivery = true; p.canPickup = true; }), false);
  assert.strictEqual(avail((p) => { p.stockAvail = 2; p.canDelivery = false; p.canPickup = false; }), false);
});

test('Powerbuy (synthetic fixture): empty products array is a normal page', () => {
  assert.deepEqual(PS5W.parsePowerbuy(200, pbWith((ps) => ps.splice(0)), PB), { blocked: false, products: [] });
});

test('Powerbuy (synthetic fixture): blocked or odd pages', () => {
  const noScript = pbHtml.replace(/<script id="__NEXT_DATA__"[\s\S]*?<\/script>/, '');
  const badJson = pbHtml.replace(/(<script id="__NEXT_DATA__"[^>]*>)[\s\S]*?(<\/script>)/, '$1{oops$2');
  const noArray = pbHtml.replace('"products":[', '"productz":[');
  assert.notEqual(noArray, pbHtml);
  const cases = [
    [403, pbHtml, 'HTTP 403'],
    [200, '<html><head><title>Just a moment...</title></head></html>', 'challenge page: Just a moment...'],
    [200, noScript, 'not the normal search page'],
    [200, badJson, 'not the normal search page'],
    [200, noArray, 'not the normal search page'],
    [500, pbHtml, 'HTTP 500'],
  ];
  for (const [status, html, why] of cases) {
    assert.deepEqual(PS5W.parsePowerbuy(status, html, PB), { blocked: true, why }, why);
  }
});

const bnHtml = fx('banana-search.html');
const withCard = (card) => bnHtml.replace('<div class="product-list">', `<div class="product-list">\n${card}`);

test('Banana real fixture: parsed, no consoles listed today', () => {
  const cards = PS5W.anchors(bnHtml).filter((a) => a.href.includes('/th/p/') && a.href.includes('ref=search-result'));
  assert.ok(cards.length >= 20, `fixture has ${cards.length} product cards`);
  const r = PS5W.parseBanana(200, bnHtml, BN);
  assert.equal(r.blocked, false);
  for (const p of r.products) {
    assert.ok(PS5W.isConsole(p.title), p.title);
    assert.ok(!p.title.includes('฿'), p.title);
  }
});

// A real card re-labelled as a console card (name and price replaced).
function consoleCard(oldPrice) {
  const m = /<a href="\/th\/p\/sony-playstation5-disc-drive[^"]*"[\s\S]*?<\/a>/.exec(bnHtml);
  assert.ok(m, 'fixture has the disc drive card');
  const named = m[0].replace(/<div title="[^"]*" class="product-name"/, '<div title="PlayStation 5 Slim Digital Edition" class="product-name"');
  assert.notEqual(named, m[0], 'name title replaced');
  const card = named.replace(/<span class="price"([^>]*)>[^<]*<\/span>/, `${oldPrice || ''}<span class="price"$1>฿18,790</span>`);
  assert.notEqual(card, named, 'price replaced');
  return card;
}

test('Banana console card: available, price, reason', () => {
  const r = PS5W.parseBanana(200, withCard(consoleCard()), BN);
  assert.equal(r.blocked, false);
  assert.equal(r.products.length, 1);
  const p = r.products[0];
  assert.equal(p.title, 'PlayStation 5 Slim Digital Edition');
  assert.strictEqual(p.available, true);
  assert.equal(p.price, '฿18,790');
  assert.equal(p.reason, 'search card text');
  assert.ok(p.url.startsWith(`${BN}/th/p/`) && !p.url.includes('?'), p.url);
});

test('Banana console card: sold-out text, and crossed-out price is ignored', () => {
  const sold = consoleCard().replace('</a>', '<div>สินค้าหมด</div></a>');
  assert.strictEqual(PS5W.parseBanana(200, withCard(sold), BN).products[0].available, false);
  const r = PS5W.parseBanana(200, withCard(consoleCard('<del>฿21,990</del> ')), BN);
  assert.equal(r.products[0].price, '฿18,790');
});

test('Banana: same product linked twice with different queries is one product', () => {
  const c = consoleCard();
  const c2 = c.replace('ref=search-result&amp;verify=1', 'ref=search-result&amp;x=2');
  assert.notEqual(c, c2);
  const r = PS5W.parseBanana(200, withCard(`${c}\n${c2}`), BN);
  assert.equal(r.products.length, 1);
});

test('Banana: blocked or odd pages', () => {
  const cases = [
    [403, bnHtml, 'HTTP 403'],
    [200, '<title>Just a moment...</title>', 'challenge page: Just a moment...'],
    [200, '<html><title>Banana</title><a href="/th/p/x">no search marker</a></html>', 'not the normal search page'],
  ];
  for (const [status, html, why] of cases) {
    assert.deepEqual(PS5W.parseBanana(status, html, BN), { blocked: true, why }, why);
  }
});
