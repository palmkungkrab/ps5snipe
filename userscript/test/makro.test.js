'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PS5W = require('../ps5watch.user.js');

const MK = 'https://www.makro.pro';
// Real search page for "ps5", captured 2026-11-27 with a plain request, trimmed to the fields the parser reads.
// Its 20 hits are accessories, games, the Portal and unrelated items: Makro lists in-stock items first and
// leaves sold-out consoles off the first page, so "no consoles" is a normal page here.
const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'makro-search.html'), 'utf8');

function mkWith(edit) {
  const m = /(<script id="__NEXT_DATA__"[^>]*>)([\s\S]*?)(<\/script>)/.exec(html);
  const data = JSON.parse(m[2]);
  edit(data.props.pageProps.initialSearchResult.hits, data);
  return html.replace(m[0], m[1] + JSON.stringify(data) + m[3]);
}

const CONSOLE = {
  id: '111222333444555',
  productId: '111222333444555',
  title: 'โซนี่ เครื่องเล่นเกม PlayStation 5 Slim Digital Edition',
  titleEn: 'SONY PlayStation 5 Console Slim Digital Edition',
  inStock: 1,
  inventoryQuantity: 1,
  displayPrice: 18790,
  seller: 'Makro',
};
const hit = (doc) => ({ document: { ...CONSOLE, ...doc }, inStock: doc && 'inStock' in doc ? doc.inStock : 1 });
const withConsole = (doc) => mkWith((hits) => hits.unshift(hit(doc)));

test('Makro (real page 2026-11-27): a normal page with no consoles on it', () => {
  // Thai stand title "ฐานแนวตั้งสําหรับคอนโซล PS5" reads as a console on its own; its English title
  // "Vertical Stand" is excluded, so it never counts. Disc drive, Portal, games, controllers: same.
  assert.deepEqual(PS5W.parseMakro(200, html, MK), { blocked: false, products: [] });
});

test('Makro: an in-stock console is buyable, with its product link, price and seller', () => {
  const r = PS5W.parseMakro(200, withConsole({}), MK);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.products, [{
    title: 'โซนี่ เครื่องเล่นเกม PlayStation 5 Slim Digital Edition',
    url: 'https://www.makro.pro/th/p/111222333444555',
    price: '฿18,790',
    available: true,
    reason: 'search page stock flag · sold by Makro',
  }]);
});

test('Makro: inStock 0 is sold out; anything else is unknown', () => {
  const avail = (doc) => PS5W.parseMakro(200, withConsole(doc), MK).products[0];
  assert.deepEqual([avail({ inStock: 0 }).available, avail({ inStock: 0 }).reason], [false, 'search page stock flag · sold by Makro']);
  assert.deepEqual([avail({ inStock: undefined }).available, avail({ inStock: undefined }).reason], [null, 'stock fields missing']);
  assert.equal(avail({ inStock: '1' }).available, null);
});

test('Makro: a marketplace seller counts too, and the alert names it', () => {
  const p = PS5W.parseMakro(200, withConsole({ seller: 'iStudio by SPVi' }), MK).products[0];
  assert.equal(p.available, true);
  assert.equal(p.reason, 'search page stock flag · sold by iStudio by SPVi');
  const noSeller = PS5W.parseMakro(200, withConsole({ seller: undefined }), MK).products[0];
  assert.equal(noSeller.reason, 'search page stock flag');
});

test('Makro: either title can name the console, but an accessory word in either title rules it out', () => {
  const isListed = (doc) => PS5W.parseMakro(200, withConsole(doc), MK).products.length === 1;
  assert.ok(isListed({ title: 'โซนี่ เพลย์สเตชัน 5 รุ่นสลิม' })); // Thai title alone not recognised; English one is
  assert.ok(isListed({ titleEn: undefined, title: 'โซนี่ คอนโซล PS5 Slim Digital Edition' }));
  assert.ok(isListed({ titleEn: '' }));
  assert.ok(!isListed({ titleEn: 'SONY PS5 and PS5 Pro Vertical Stand', title: 'โซนี่ ฐานแนวตั้งสําหรับคอนโซล PS5' }));
  assert.ok(!isListed({ titleEn: 'SONY DualSense Wireless Controller', title: 'โซนี่ คอนโซล PS5 Slim' }));
  assert.ok(!isListed({ titleEn: 'SONY Video Game PS5 Gran Turismo 7', title: 'โซนี่ แผ่นเกม PS5 Gran Turismo 7' }));
});

test('Makro: a product listed twice is listed once; a hit with no product ID is skipped', () => {
  const r = PS5W.parseMakro(200, mkWith((hits) => {
    hits.unshift(hit({}), hit({}), hit({ productId: undefined, id: undefined }));
  }), MK);
  assert.equal(r.products.length, 1);
});

test('Makro: product ID falls back to id', () => {
  const r = PS5W.parseMakro(200, withConsole({ productId: undefined, id: '999' }), MK);
  assert.equal(r.products[0].url, 'https://www.makro.pro/th/p/999');
});

test('Makro: anything but a normal search page is blocked with a why', () => {
  const NOT_NORMAL = 'not the normal search page';
  const cases = [
    [403, html, 'HTTP 403'],
    [429, html, 'HTTP 429'],
    [500, html, 'HTTP 500'],
    [200, '<html><head><title>Just a moment...</title></head></html>', 'challenge page: Just a moment...'],
    [200, '<html><head><title>Makro PRO</title></head><body>no data</body></html>', NOT_NORMAL],
    [200, mkWith((hits, data) => { delete data.props.pageProps.initialSearchResult; }), NOT_NORMAL],
    [200, mkWith((hits, data) => { data.props.pageProps.initialSearchResult.hits = null; }), NOT_NORMAL],
    // "ps5" always finds accessories; an empty list means the search broke, not "nothing in stock".
    [200, mkWith((hits) => hits.splice(0)), 'Makro search listed no products'],
    [200, mkWith((hits) => hits.forEach((h) => { h.document.stockFlag = h.document.inStock; delete h.document.inStock; })),
      'Makro product fields changed'],
    [200, mkWith((hits) => hits.forEach((h) => { delete h.document.title; delete h.document.titleEn; })),
      'Makro product fields changed'],
  ];
  for (const [status, text, why] of cases) {
    assert.deepEqual(PS5W.parseMakro(status, text, MK), { blocked: true, why }, why);
  }
});

test('Makro store entry: search for ps5, Healthchecks slug makro', () => {
  const s = PS5W.storeForHost('www.makro.pro');
  assert.equal(s.name, 'Makro PRO');
  assert.equal(s.hcSlug, 'makro');
  assert.equal(PS5W.watchUrl(s), 'https://www.makro.pro/th/c/search?q=ps5#ps5watch');
  assert.ok(PS5W.isWatcherLocation({ hash: '#ps5watch', pathname: '/th/c/search' }, s));
});

test('Makro check: one fetch of the search page, then the Makro parser', async () => {
  const fetched = [];
  const env = {
    fetchText: async (url, init) => { fetched.push([url, init]); return { status: 200, text: withConsole({}) }; },
    sleep: async () => {},
  };
  const r = await PS5W.checkStore(env, PS5W.STORES.makro);
  assert.deepEqual(fetched, [['https://www.makro.pro/th/c/search?q=ps5', undefined]]);
  assert.equal(r.blocked, false);
  assert.equal(r.products[0].available, true);
});
