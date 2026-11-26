'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PS5W = require('../ps5watch.user.js');

test('anchors: label = inner text + title + img alt, decoded and collapsed', () => {
  const html = '<a class="x" href="/th/p/abc?utm=1">  PS5 &amp; <b>Slim</b>\n <img src="a.jpg" alt="Digital &#39;Edition&#39;"></a>'
    + '<a title="Tom &quot;T&quot; &lt;x&gt;" href=\'https://x.test/a?b=1&amp;c=2\'>go</a>'
    + '<a name="nohref">skip</a>';
  const out = PS5W.anchors(html);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { href: '/th/p/abc?utm=1', label: 'PS5 & Slim Digital \'Edition\'' });
  assert.equal(out[1].href, 'https://x.test/a?b=1&c=2');
  assert.equal(out[1].label, 'go Tom "T" <x>');
  assert.equal(PS5W.anchors('<a href="/n">&#3586;&#x0E01;</a>')[0].label, 'ขก');
});

test('normalizeUrl strips query and hash, resolves against origin', () => {
  assert.equal(PS5W.normalizeUrl('/th/p/abc?utm=1#x', 'https://www.bnn.in.th'), 'https://www.bnn.in.th/th/p/abc');
  assert.equal(PS5W.normalizeUrl('https://a.test/p/1?q=2', 'https://b.test'), 'https://a.test/p/1');
});

test('normalizeUrl returns null for non-http(s) and junk', () => {
  for (const h of ['javascript:alert(1)', 'mailto:a@b.co', '#', '', null, 'data:text/html,x', 'http://']) {
    assert.equal(PS5W.normalizeUrl(h, 'https://www.bnn.in.th'), null, String(h));
  }
});

test('formatPrice', () => {
  assert.equal(PS5W.formatPrice(18790), '฿18,790');
  assert.equal(PS5W.formatPrice('20990.00'), '฿20,990');
  assert.equal(PS5W.formatPrice('18,790'), '฿18,790');
  assert.equal(PS5W.formatPrice(null), null);
  assert.equal(PS5W.formatPrice(0), null);
  assert.equal(PS5W.formatPrice('abc'), null);
});

test('isBlockedPage', () => {
  for (const s of [403, 429, 503]) assert.equal(PS5W.isBlockedPage(s, '<title>ok</title>'), true, String(s));
  assert.equal(PS5W.isBlockedPage(200, '<html><title>Just a moment...</title>'), true);
  assert.equal(PS5W.isBlockedPage(200, '<title>Attention Required! | Cloudflare</title>'), true);
  assert.equal(PS5W.isBlockedPage(200, '<title>PlayStation 5 - Powerbuy</title>'), false);
  assert.equal(PS5W.isBlockedPage(200, '<p>no title</p>'), false);
});
