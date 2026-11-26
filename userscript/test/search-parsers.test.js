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

const PB_FIELDS_CHANGED = { blocked: true, why: 'Powerbuy product fields changed' };

test('Powerbuy shape guard: stock field renamed in every entry is blocked, not "all sold out"', () => {
  const html = pbWith((ps) => ps.forEach((p) => { p.stockQty = p.stockAvail; delete p.stockAvail; }));
  assert.deepEqual(PS5W.parsePowerbuy(200, html, PB), PB_FIELDS_CHANGED);
});

test('Powerbuy shape guard: slugname missing everywhere is blocked', () => {
  const html = pbWith((ps) => ps.forEach((p) => { delete p.slugname; }));
  assert.deepEqual(PS5W.parsePowerbuy(200, html, PB), PB_FIELDS_CHANGED);
});

test('Powerbuy shape guard: name missing everywhere is blocked', () => {
  const html = pbWith((ps) => ps.forEach((p) => { p.title = p.name; delete p.name; }));
  assert.deepEqual(PS5W.parsePowerbuy(200, html, PB), PB_FIELDS_CHANGED);
});

test('Powerbuy shape guard: both delivery keys missing everywhere is blocked', () => {
  const html = pbWith((ps) => ps.forEach((p) => { delete p.canDelivery; delete p.canPickup; }));
  assert.deepEqual(PS5W.parsePowerbuy(200, html, PB), PB_FIELDS_CHANGED);
});

test('Powerbuy shape guard: numeric-string stockAvail is accepted', () => {
  const r = PS5W.parsePowerbuy(200, pbWith((ps) => ps.forEach((p, i) => {
    p.stockAvail = String(i === 0 ? 3 : 0);
    if (i === 0) p.canDelivery = true;
  })), PB);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.products.map((p) => p.available), [true, false]);
});

test('Powerbuy: one bad console among good ones is dropped (no slug) or unknown (no stock field)', () => {
  const r = PS5W.parsePowerbuy(200, pbWith((ps) => {
    ps.push({ name: 'PlayStation 5 Pro Console (CFI-7000B01)', priceSort: 26990, stockAvail: 4, canDelivery: true, canPickup: true });
    ps.push({ name: 'PlayStation 5 Pro Console (CFI-7000B02)', priceSort: 26990, stockAvail: 4, canDelivery: true, slugname: '' });
    ps.push({ name: 'PlayStation 5 Pro Console 2TB (CFI-7022B01)', priceSort: 26990, stockQty: 4, canDelivery: true, canPickup: true, slugname: 'ps5-pro-2tb-1000008' });
    ps.push({ name: 'PlayStation 5 Slim Console Bundle (CFI-2118A01)', priceSort: 21990, stockAvail: 4, slugname: 'ps5-slim-bundle-1000009' });
  }), PB);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.products.map((p) => [p.url.replace(`${PB}/th/product/`, ''), p.available]), [
    ['playstation-5-slim-console-disc-edition-cfi-2118a01-1000001', false],
    ['playstation-5-digital-edition-cfi-2118b01-1000002', false],
    ['ps5-pro-2tb-1000008', null],
    ['ps5-slim-bundle-1000009', null],
  ]);
  assert.ok(r.products.every((p) => !p.url.endsWith('/undefined') && !p.url.endsWith('/th/product/')));
});

test('Powerbuy: two consoles with distinct slugs are two products', () => {
  const r = PS5W.parsePowerbuy(200, pbWith((ps) => {
    ps[0].stockAvail = 1; ps[0].canDelivery = true;
    ps[1].stockAvail = 1; ps[1].canPickup = true;
  }), PB);
  assert.equal(r.products.length, 2);
  assert.notEqual(r.products[0].url, r.products[1].url);
  assert.deepEqual(r.products.map((p) => p.available), [true, true]);
});

test('Powerbuy: a priceSort string is formatted', () => {
  const r = PS5W.parsePowerbuy(200, pbWith((ps) => { ps[0].priceSort = '19990.00'; ps[1].priceSort = '16,990'; }), PB);
  assert.deepEqual(r.products.map((p) => p.price), ['฿19,990', '฿16,990']);
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

test('Banana price: a "save ฿…" badge is never read as the price', () => {
  const badge = '<div class="save-up-to"><span class="label">ประหยัดไป <strong>฿2,000</strong></span></div> ';
  const card = consoleCard().replace('<div class="product-price"', `${badge}<div class="product-price"`);
  assert.ok(card.includes('฿2,000'));
  assert.equal(PS5W.parseBanana(200, withCard(card), BN).products[0].price, '฿18,790');
});

test('Banana: same product linked twice with different queries is one product', () => {
  const c = consoleCard();
  const c2 = c.replace('ref=search-result&amp;verify=1', 'ref=search-result&amp;x=2');
  assert.notEqual(c, c2);
  const r = PS5W.parseBanana(200, withCard(`${c}\n${c2}`), BN);
  assert.equal(r.products.length, 1);
});

test('Banana: price moved outside the card anchor is not the normal search page', () => {
  const moved = bnHtml.replace(/(<div class="product-price"[^>]*>[\s\S]*?<\/div>)([\s\S]*?<\/a>)/g, '$2$1');
  assert.notEqual(moved, bnHtml);
  assert.ok(moved.includes('ref=search-result'));
  assert.equal((moved.match(/<\/a><div class="product-price"/g) || []).length, 24, 'every price block now follows its card');
  assert.deepEqual(PS5W.parseBanana(200, moved, BN), { blocked: true, why: 'not the normal search page' });
});

test('Banana: cards with a price but no title are not the normal search page', () => {
  const bare = bnHtml.replace(/(<a\b[^>]*ref=search-result[^>]*>)[\s\S]*?(<div class="product-price")/g, '$1$2');
  assert.notEqual(bare, bnHtml);
  assert.ok(PS5W.anchors(bare).filter((a) => a.label.startsWith('฿')).length >= 20, 'cards keep only their price');
  assert.deepEqual(PS5W.parseBanana(200, bare, BN), { blocked: true, why: 'not the normal search page' });
});

test('Banana: a titled badge before the name div does not hide the console', () => {
  const card = consoleCard().replace('<div title="PlayStation 5 Slim Digital Edition" class="product-name"',
    '<div title="Flash Sale" class="product-badge">Flash Sale</div> <div title="PlayStation 5 Slim Digital Edition" class="product-name"');
  assert.ok(card.includes('Flash Sale'));
  const r = PS5W.parseBanana(200, withCard(card), BN);
  assert.equal(r.products.length, 1);
  assert.equal(r.products[0].title, 'PlayStation 5 Slim Digital Edition');
  assert.strictEqual(r.products[0].available, true);
});

test('Banana title fallback: name class renamed, an image badge with a title is skipped', () => {
  const card = consoleCard()
    .replace('class="product-name"', 'class="item-title"')
    .replace('<div title="PlayStation 5 Slim Digital Edition"',
      '<div title="Flash Sale"><img src="https://example.test/flash.png" alt=""></div> <div title="PlayStation 5 Slim Digital Edition"');
  const r = PS5W.parseBanana(200, withCard(card), BN);
  assert.equal(r.products.length, 1);
  assert.equal(r.products[0].title, 'PlayStation 5 Slim Digital Edition');
});

test('Banana title fallback: no titled div, the text before the price is the title', () => {
  const card = '<a href="/th/p/ps5-slim-digital-1?ref=search-result"><div>PlayStation 5 Slim Digital Edition</div>'
    + '<div class="product-price"><span class="price">฿18,790</span></div></a>';
  const r = PS5W.parseBanana(200, withCard(card), BN);
  assert.deepEqual(r.products.map((p) => [p.title, p.price]), [['PlayStation 5 Slim Digital Edition', '฿18,790']]);
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
