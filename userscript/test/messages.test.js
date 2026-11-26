'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PS5W = require('../ps5watch.user.js');

const P = { title: 'PlayStation 5 Console', url: 'https://example.test/ps5', price: '฿18,990', available: true, reason: 'cart button' };
const FAKE_HOOK = 'https://discord.com/api/webhooks/123/abc-DEF_9';
const FAKE_ID = '12345678901234567';

test('LABEL', () => assert.equal(PS5W.LABEL, '💻 laptop'));

test('buildInStock mirrors the Python in-stock payload', () => {
  const m = PS5W.buildInStock(P, 'Powerbuy', '42');
  assert.equal(m.content, '<@42> 🟢 **PS5 IN STOCK at Powerbuy!** 💻 laptop ' + P.url);
  assert.equal(m.embeds.length, 1);
  const e = m.embeds[0];
  assert.equal(e.title, P.title);
  assert.equal(e.url, P.url);
  assert.equal(e.color, 0x2ECC71);
  assert.deepEqual(e.fields, [
    { name: 'Store', value: 'Powerbuy', inline: true },
    { name: 'Price', value: '฿18,990', inline: true },
    { name: 'Detected by', value: 'cart button', inline: false },
  ]);
  assert.equal(new Date(e.timestamp).toISOString(), e.timestamp);
  assert.deepEqual(m.allowed_mentions, { users: ['42'] });
});

test('buildInStock falls back to - and cuts long titles', () => {
  const m = PS5W.buildInStock({ ...P, price: null, reason: '', title: 'x'.repeat(300) }, 'JIB', '42');
  assert.equal(m.embeds[0].title.length, 250);
  assert.equal(m.embeds[0].fields[1].value, '-');
  assert.equal(m.embeds[0].fields[2].value, '-');
});

test('buildNeedsYou', () => {
  const m = PS5W.buildNeedsYou('Powerbuy', '42');
  assert.equal(m.content,
    '<@42> ⚠️ **Powerbuy needs you** 💻 laptop\n'
    + "Powerbuy is asking whether you're human. The tab reloaded once and is still stuck, so **Powerbuy is NOT being watched**. Solve the check on the Powerbuy tab on the laptop and watching restarts by itself.");
  assert.match(m.content, /Powerbuy is NOT being watched/);
  assert.deepEqual(m.allowed_mentions, { users: ['42'] });
});

test('buildWatchingAgain', () => {
  const m = PS5W.buildWatchingAgain('Powerbuy');
  assert.equal(m.content, '✅ Powerbuy is being watched again 💻 laptop');
  assert.deepEqual(m.allowed_mentions, { parse: [] });
});

test('buildTest is clearly a test with a normal link', () => {
  const m = PS5W.buildTest(PS5W.STORES.jib, '42');
  const e = m.embeds[0];
  assert.equal(e.title, 'Test notification from ps5watch (not a real restock)');
  assert.equal(e.url, PS5W.watchUrl(PS5W.STORES.jib).replace('#ps5watch', ''));
  assert.ok(!e.url.includes('#'));
  assert.equal(e.fields[0].value, 'TEST (JIB)');
  assert.equal(e.fields[1].value, '฿0');
  assert.equal(e.fields[2].value, 'test ping button');
  assert.match(m.content, /^<@42> 🟢 \*\*PS5 IN STOCK at TEST \(JIB\)!\*\*/);
});

test('hcUrl', () => assert.equal(PS5W.hcUrl('k1', 'powerbuy'), 'https://hc-ping.com/k1/powerbuy'));

test('cleanSettings accepts good values and trims', () => {
  const r = PS5W.cleanSettings({ webhook: `  ${FAKE_HOOK}\n`, userId: ` ${FAKE_ID}\n`, hcKey: '\nabcd1234_-X ' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.settings, { webhook: FAKE_HOOK, userId: FAKE_ID, hcKey: 'abcd1234_-X' });
});

test('cleanSettings accepts discordapp.com webhooks', () => {
  const r = PS5W.cleanSettings({ webhook: 'https://discordapp.com/api/webhooks/9/a_b-C', userId: FAKE_ID, hcKey: 'abcd1234' });
  assert.deepEqual(r.errors, []);
});

test('cleanSettings reports each bad or missing field', () => {
  assert.deepEqual(PS5W.cleanSettings({}).errors, ['Discord webhook link', 'Discord user ID', 'Healthchecks ping key']);
  assert.deepEqual(PS5W.cleanSettings(undefined).errors, ['Discord webhook link', 'Discord user ID', 'Healthchecks ping key']);
  const r = PS5W.cleanSettings({ webhook: 'http://discord.com/api/webhooks/1/a', userId: '123', hcKey: 'short' });
  assert.deepEqual(r.errors, ['Discord webhook link', 'Discord user ID', 'Healthchecks ping key']);
  assert.equal(r.settings.userId, '123');
  assert.deepEqual(PS5W.cleanSettings({ webhook: FAKE_HOOK, userId: FAKE_ID, hcKey: 'abcd1234 x' }).errors, ['Healthchecks ping key']);
  assert.deepEqual(PS5W.cleanSettings({ webhook: FAKE_HOOK, userId: '1234567890123456789012', hcKey: 'abcd1234' }).errors, ['Discord user ID']);
});
