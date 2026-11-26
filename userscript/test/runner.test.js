'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PS5W = require('../ps5watch.user.js');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const USER = '123456789012345678';
const GOOD_SETTINGS = { webhook: 'https://discord.com/api/webhooks/1/x-y', userId: USER, hcKey: 'abcdefgh12' };
const PB = PS5W.STORES.powerbuy;
const BN = PS5W.STORES.banana;
const JIB = PS5W.STORES.jib;
const DOT = PS5W.STORES.dotlife;
const dlFeed = fx('dotlife-feed.json');

const pbHtml = fx('powerbuy-search.synthetic.html');
function pbWith(edit) {
  const m = /(<script id="__NEXT_DATA__"[^>]*>)([\s\S]*?)(<\/script>)/.exec(pbHtml);
  const data = JSON.parse(m[2]);
  edit(data.props.pageProps.productListData.products);
  return pbHtml.replace(m[0], m[1] + JSON.stringify(data) + m[3]);
}
const pbInStock = pbWith((ps) => { ps[0].stockAvail = 2; ps[0].canDelivery = true; });
const PB_HIT = 'https://www.powerbuy.co.th/th/product/playstation-5-slim-console-disc-edition-cfi-2118a01-1000001';
const CHALLENGE = '<html><head><title>Just a moment...</title></head></html>';

// Fake env: records every call. env.page(url) decides what fetchText returns (or throws).
function fakeEnv(over = {}) {
  const calls = { fetch: [], fetchInit: [], sleep: [], post: [], ping: [], setItems: [], setFlags: [], reload: 0, render: [] };
  const state = { items: {}, flags: {}, settings: GOOD_SETTINGS, postOk: true, now: 1700000000000, ...over };
  const env = {
    calls,
    state,
    page: () => ({ status: 200, text: pbHtml }),
    fetchText: async (url, init) => { calls.fetch.push(url); calls.fetchInit.push(init); return env.page(url); },
    sleep: async (ms) => { calls.sleep.push(ms); },
    now: () => state.now,
    random: () => 0.5,
    getItems: (slug) => state.items[slug],
    setItems: (slug, items) => { calls.setItems.push([slug, items]); state.items[slug] = items; },
    getFlags: () => state.flags,
    setFlags: (flags) => { calls.setFlags.push(flags); state.flags = flags; },
    settings: () => state.settings,
    postDiscord: async (payload) => { calls.post.push(payload); return state.postOk; },
    pingHealthchecks: async (slug) => { calls.ping.push(slug); return true; },
    reload: () => { calls.reload += 1; },
    render: (view) => { calls.render.push(view); },
  };
  return env;
}
const lastRender = (env) => env.calls.render[env.calls.render.length - 1];
const inNormalRange = (r) => r && r.delayMs >= 50000 && r.delayMs <= 70000;

test('Powerbuy, one console in stock: one in-stock post, one ping, items saved, stock box', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: pbInStock });
  const r = await PS5W.runCheck(env, PB);
  assert.deepEqual(env.calls.fetch, ['https://www.powerbuy.co.th/th/search/ps5']);
  assert.deepEqual(env.calls.fetchInit, [undefined]); // other stores keep the default fetch (cookies included)
  assert.equal(env.calls.post.length, 1);
  const p = env.calls.post[0];
  assert.equal(p.content, `<@${USER}> 🟢 **PS5 IN STOCK at Powerbuy!** 💻 laptop ${PB_HIT}`);
  assert.equal(p.embeds[0].url, PB_HIT);
  assert.deepEqual(p.allowed_mentions, { users: [USER] });
  assert.deepEqual(env.calls.ping, ['powerbuy']);
  assert.equal(env.calls.setItems.length, 1);
  assert.equal(env.calls.setItems[0][0], 'powerbuy');
  assert.equal(env.calls.setItems[0][1][PB_HIT].available, true);
  const v = lastRender(env);
  assert.equal(v.mode, 'stock');
  assert.equal(v.storeName, 'Powerbuy');
  assert.equal(v.lastCheck, env.state.now);
  assert.equal(v.products.length, 2);
  assert.equal(v.discordOk, true);
  assert.equal(v.hcOk, true);
  assert.ok(inNormalRange(r), JSON.stringify(r));
});

test('same in-stock check again: no second post', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: pbInStock });
  await PS5W.runCheck(env, PB);
  env.state.now += 60000;
  const r = await PS5W.runCheck(env, PB);
  assert.equal(env.calls.post.length, 1);
  assert.deepEqual(env.calls.ping, ['powerbuy', 'powerbuy']);
  assert.ok(inNormalRange(r));
});

test('block sequence: reload once, needs you once, stuck quiet, watching again', async () => {
  const env = fakeEnv();
  env.state.items = { powerbuy: { [PB_HIT]: { title: 'x', available: true, notified: 1 } } };
  const before = JSON.stringify(env.state.items);

  // 1. first blocked check: one reload, nothing else
  env.page = () => ({ status: 403, text: CHALLENGE });
  let r = await PS5W.runCheck(env, PB);
  assert.equal(r, null);
  assert.equal(env.calls.reload, 1);
  assert.equal(env.calls.post.length, 0);
  assert.equal(env.calls.ping.length, 0);
  assert.deepEqual(env.state.flags, { reloaded: true, stuck: false });

  // 2. still blocked after the reload: "needs you" once, warn box, 5-min retry
  r = await PS5W.runCheck(env, PB);
  assert.equal(env.calls.reload, 1);
  assert.equal(env.calls.post.length, 1);
  assert.match(env.calls.post[0].content, /Powerbuy needs you/);
  assert.match(env.calls.post[0].content, new RegExp(`^<@${USER}>`));
  assert.match(env.calls.post[0].content, /asking whether you're human/);
  assert.equal(env.calls.ping.length, 0);
  assert.equal(r.delayMs, 300000);
  assert.equal(lastRender(env).mode, 'warn');
  assert.equal(lastRender(env).why, 'HTTP 403');
  assert.deepEqual(env.state.flags, { reloaded: true, stuck: true });

  // 3. blocked again while stuck: no post, no ping, no reload
  r = await PS5W.runCheck(env, PB);
  assert.equal(env.calls.post.length, 1);
  assert.equal(env.calls.ping.length, 0);
  assert.equal(env.calls.reload, 1);
  assert.equal(r.delayMs, 300000);
  assert.equal(lastRender(env).mode, 'warn');

  // Blocked checks never touch the stored items (the gone rule must not run).
  assert.equal(env.calls.setItems.length, 0);
  assert.equal(JSON.stringify(env.state.items), before);

  // 4. good check: "watching again" post, one ping, flags cleared
  env.page = () => ({ status: 200, text: pbHtml });
  r = await PS5W.runCheck(env, PB);
  assert.equal(env.calls.post.length, 2);
  assert.match(env.calls.post[1].content, /Powerbuy is being watched again/);
  assert.deepEqual(env.calls.ping, ['powerbuy']);
  assert.deepEqual(env.state.flags, { reloaded: false, stuck: false });
  assert.equal(lastRender(env).mode, 'ok');
  assert.ok(inNormalRange(r));
});

test('needs you for a changed page names the cause instead of a human check', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: pbWith((ps) => ps.forEach((p) => { delete p.stockAvail; })) });
  assert.equal(await PS5W.runCheck(env, PB), null);
  assert.equal(env.calls.reload, 1);
  const r = await PS5W.runCheck(env, PB);
  assert.equal(r.delayMs, 300000);
  assert.equal(env.calls.post.length, 1);
  assert.equal(env.calls.post[0].content, `<@${USER}> ⚠️ **Powerbuy needs you** 💻 laptop\n`
    + 'Powerbuy is NOT being watched: Powerbuy product fields changed. If the Powerbuy tab on the laptop looks normal, '
    + 'reload it once. If this keeps happening, the script needs an update.');
  assert.equal(env.calls.ping.length, 0);
  const v = lastRender(env);
  assert.equal(v.mode, 'warn');
  assert.equal(v.why, 'Powerbuy product fields changed');

  // A network error while stuck keeps the warn box and its cause.
  env.page = () => { throw new Error('offline'); };
  await PS5W.runCheck(env, PB);
  assert.equal(lastRender(env).mode, 'warn');
  assert.equal(lastRender(env).why, 'Powerbuy product fields changed');
});

test('Discord post failing: check still resolves and pings; box shows Discord failed', async () => {
  const env = fakeEnv({ postOk: false });
  env.page = () => ({ status: 200, text: pbInStock });
  const r = await PS5W.runCheck(env, PB);
  assert.ok(inNormalRange(r));
  assert.equal(env.calls.post.length, 1);
  assert.deepEqual(env.calls.ping, ['powerbuy']);
  assert.equal(lastRender(env).discordOk, false);
});

test('Discord post rejecting counts as failed, never throws', async () => {
  const env = fakeEnv();
  env.postDiscord = async () => { throw new Error('boom'); };
  env.page = () => ({ status: 200, text: pbInStock });
  const r = await PS5W.runCheck(env, PB);
  assert.ok(inNormalRange(r));
  assert.equal(lastRender(env).discordOk, false);
});

test('discordOk keeps the previous value when nothing is posted this round', async () => {
  const env = fakeEnv({ postOk: false });
  env.page = () => ({ status: 200, text: pbInStock });
  await PS5W.runCheck(env, PB);
  env.state.now += 60000;
  await PS5W.runCheck(env, PB);
  assert.equal(env.calls.post.length, 1);
  assert.equal(lastRender(env).discordOk, false);
});

test('network error: no reload, post, ping, items or flags change; error shown; normal delay', async () => {
  const env = fakeEnv();
  env.state.flags = { reloaded: true, stuck: false };
  env.page = () => { throw new TypeError('Failed to fetch'); };
  const r = await PS5W.runCheck(env, PB);
  assert.ok(inNormalRange(r), JSON.stringify(r));
  assert.equal(env.calls.reload, 0);
  assert.equal(env.calls.post.length, 0);
  assert.equal(env.calls.ping.length, 0);
  assert.equal(env.calls.setItems.length, 0);
  assert.equal(env.calls.setFlags.length, 0);
  const v = lastRender(env);
  assert.equal(v.error, 'network error: Failed to fetch');
  assert.equal(v.mode, 'ok');
});

test('network error keeps the current mode and products of the last good check', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: pbInStock });
  await PS5W.runCheck(env, PB);
  const good = lastRender(env);
  env.page = () => { throw new Error('offline'); };
  await PS5W.runCheck(env, PB);
  const v = lastRender(env);
  assert.equal(v.mode, 'stock');
  assert.deepEqual(v.products, good.products);
  assert.equal(v.lastCheck, good.lastCheck);
  assert.equal(v.error, 'network error: offline');
});

function assertQuietFailure(env, r) {
  assert.ok(inNormalRange(r), JSON.stringify(r));
  assert.equal(env.calls.reload, 0);
  assert.equal(env.calls.post.length, 0);
  assert.equal(env.calls.ping.length, 0);
  assert.equal(env.calls.setItems.length, 0);
  assert.equal(env.calls.setFlags.length, 0);
}

test('an exception that is not from a fetch is "check failed", otherwise handled like a network error', async () => {
  const env = fakeEnv();
  env.state.flags = { reloaded: true, stuck: false };
  env.page = () => null; // the fetch resolves; reading its reply throws
  const r = await PS5W.runCheck(env, PB);
  assertQuietFailure(env, r);
  assert.match(lastRender(env).error, /^check failed: /);
  assert.doesNotMatch(lastRender(env).error, /network/);
});

test('Banana: one fetch of the search page; an empty normal page is a good check', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: fx('banana-search.html') });
  const r = await PS5W.runCheck(env, BN);
  assert.deepEqual(env.calls.fetch, ['https://www.bnn.in.th/th/p?q=playstation%205']);
  assert.deepEqual(env.calls.ping, ['banana-it']);
  assert.deepEqual(env.calls.setItems, [['banana-it', {}]]);
  assert.equal(lastRender(env).mode, 'ok');
  assert.ok(inNormalRange(r));
});

const JIB_ORIGIN = 'https://www.jib.co.th';
const JIB_SEARCH_URL = JIB_ORIGIN + JIB.searchPath;
const JIB_A = `${JIB_ORIGIN}/web/product/readProduct/111/1652/ps5-slim`;
const JIB_B = `${JIB_ORIGIN}/web/product/readProduct/222/1652/ps5-pro`;
const jibSearch2 = '<html><head><title>JIB search</title></head><body>'
  + '<a href="/web/product/readProduct/111/1652/ps5-slim">Sony PlayStation 5 Slim Console Disc Edition</a>'
  + '<a href="/web/product/readProduct/222/1652/ps5-pro">Sony PlayStation 5 Pro Console</a>'
  + '</body></html>';
const jibOut = fx('jib-product.html');
const jibIn = jibOut.replace('https://schema.org/OutOfStock', 'https://schema.org/InStock');

test('JIB: search page then each product page, 1.5 s apart', async () => {
  const env = fakeEnv();
  env.page = (url) => {
    if (url === JIB_SEARCH_URL) return { status: 200, text: jibSearch2 };
    if (url === JIB_A) return { status: 200, text: jibOut };
    if (url === JIB_B) return { status: 200, text: jibIn };
    throw new Error(`unexpected ${url}`);
  };
  const res = await PS5W.checkStore(env, JIB);
  assert.deepEqual(env.calls.fetch, [JIB_SEARCH_URL, JIB_A, JIB_B]);
  assert.deepEqual(env.calls.sleep, [1500]);
  assert.equal(res.blocked, false);
  assert.deepEqual(res.products.map((p) => [p.url, p.available]), [[JIB_A, false], [JIB_B, true]]);
});

test('JIB: a product page with HTTP 403 makes the whole check blocked', async () => {
  const env = fakeEnv();
  env.page = (url) => {
    if (url === JIB_SEARCH_URL) return { status: 200, text: jibSearch2 };
    if (url === JIB_A) return { status: 200, text: jibIn };
    return { status: 403, text: CHALLENGE };
  };
  const r = await PS5W.runCheck(env, JIB);
  assert.equal(env.calls.fetch.length, 3);
  assert.deepEqual(env.calls.sleep, [1500]);
  assert.equal(r, null);
  assert.equal(env.calls.reload, 1);
  assert.equal(env.calls.post.length, 0);
  assert.equal(env.calls.ping.length, 0);
  assert.equal(env.calls.setItems.length, 0);
});

test('JIB: a blocked search page fetches no product pages', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 503, text: CHALLENGE });
  const res = await PS5W.checkStore(env, JIB);
  assert.equal(res.blocked, true);
  assert.equal(env.calls.fetch.length, 1);
  assert.equal(env.calls.sleep.length, 0);
});

test('JIB: a product fetch rejecting is a network error; a failing sleep is "check failed"', async () => {
  const env = fakeEnv();
  env.page = (url) => {
    if (url === JIB_SEARCH_URL) return { status: 200, text: jibSearch2 };
    throw new Error('request timed out');
  };
  assertQuietFailure(env, await PS5W.runCheck(env, JIB));
  assert.equal(lastRender(env).error, 'network error: request timed out');

  const env2 = fakeEnv();
  env2.page = (url) => ({ status: 200, text: url === JIB_SEARCH_URL ? jibSearch2 : jibOut });
  env2.sleep = async () => { throw new Error('timer gone'); };
  assertQuietFailure(env2, await PS5W.runCheck(env2, JIB));
  assert.equal(lastRender(env2).error, 'check failed: timer gone');
});

test('invalid settings: no fetch, no post, setup box with errors and the saved values, loop stops', async () => {
  const env = fakeEnv({ settings: { webhook: GOOD_SETTINGS.webhook, userId: '', hcKey: GOOD_SETTINGS.hcKey } });
  env.page = () => ({ status: 200, text: pbInStock });
  const r = await PS5W.runCheck(env, PB);
  assert.equal(r, null);
  assert.equal(env.calls.fetch.length, 0);
  assert.equal(env.calls.post.length, 0);
  assert.equal(env.calls.ping.length, 0);
  const v = lastRender(env);
  assert.equal(v.mode, 'setup');
  assert.deepEqual(v.errors, ['Discord user ID']);
  assert.equal(v.settings.webhook, GOOD_SETTINGS.webhook);
  assert.equal(v.settings.userId, '');
});

test('missing settings (first run) render the setup box', async () => {
  const env = fakeEnv({ settings: undefined });
  const r = await PS5W.runCheck(env, PB);
  assert.equal(r, null);
  assert.equal(lastRender(env).mode, 'setup');
  assert.equal(env.calls.fetch.length, 0);
});

test('sendTest: invalid settings never post and show the setup box', async () => {
  const env = fakeEnv({ settings: { webhook: '', userId: '', hcKey: '' } });
  const ok = await PS5W.sendTest(env, PB);
  assert.equal(ok, false);
  assert.equal(env.calls.post.length, 0);
  const v = lastRender(env);
  assert.equal(v.mode, 'setup');
  assert.equal(v.errors.length, 3);
});

test('sendTest: posts the test payload and the box picks up the Discord result', async () => {
  const env = fakeEnv({ postOk: false });
  env.page = () => ({ status: 200, text: pbHtml });
  await PS5W.runCheck(env, PB);
  assert.equal(lastRender(env).discordOk, true);
  const ok = await PS5W.sendTest(env, PB);
  assert.equal(ok, false);
  assert.equal(env.calls.post.length, 1);
  assert.match(env.calls.post[0].content, new RegExp(`^<@${USER}> .*TEST \\(Powerbuy\\)`));
  assert.equal(lastRender(env).discordOk, false);
  assert.equal(lastRender(env).mode, 'ok');
  env.state.now += 60000;
  await PS5W.runCheck(env, PB);
  assert.equal(lastRender(env).discordOk, false);
});

test('postWithRetry: 429 waits retryAfterMs then succeeds', async () => {
  const replies = [{ status: 429, retryAfterMs: 1200 }, { status: 204 }];
  const slept = [];
  const ok = await PS5W.postWithRetry(async () => replies.shift(), async (ms) => { slept.push(ms); });
  assert.equal(ok, true);
  assert.deepEqual(slept, [1200]);
});

test('postWithRetry: 429 without retryAfterMs waits 2 s', async () => {
  const replies = [{ status: 429 }, { status: 200 }];
  const slept = [];
  assert.equal(await PS5W.postWithRetry(async () => replies.shift(), async (ms) => { slept.push(ms); }), true);
  assert.deepEqual(slept, [2000]);
});

test('postWithRetry: a huge retryAfterMs waits at most 30 s', async () => {
  const replies = [{ status: 429, retryAfterMs: 3600000 }, { status: 204 }];
  const slept = [];
  assert.equal(await PS5W.postWithRetry(async () => replies.shift(), async (ms) => { slept.push(ms); }), true);
  assert.deepEqual(slept, [30000]);
});

test('discordReply caps retry_after at 30 s', () => {
  assert.deepEqual(PS5W.discordReply(429, '{"retry_after":3600}'), { status: 429, retryAfterMs: 30000 });
  assert.deepEqual(PS5W.discordReply(429, '{"retry_after":29.5}'), { status: 429, retryAfterMs: 29500 });
});

test('postWithRetry: other HTTP errors give up at once', async () => {
  let n = 0;
  const slept = [];
  const ok = await PS5W.postWithRetry(async () => { n += 1; return { status: 500 }; }, async (ms) => { slept.push(ms); });
  assert.equal(ok, false);
  assert.equal(n, 1);
  assert.deepEqual(slept, []);
});

test('postWithRetry: 4 throws give false after backing off 1, 2, 4 s', async () => {
  let n = 0;
  const slept = [];
  const ok = await PS5W.postWithRetry(() => { n += 1; throw new Error('net'); }, async (ms) => { slept.push(ms); });
  assert.equal(ok, false);
  assert.equal(n, 4);
  assert.deepEqual(slept, [1000, 2000, 4000]);
});

test('postWithRetry: 4 rate limits give false', async () => {
  let n = 0;
  const ok = await PS5W.postWithRetry(async () => { n += 1; return { status: 429, retryAfterMs: 10 }; }, async () => {});
  assert.equal(ok, false);
  assert.equal(n, 4);
});

test('discordReply maps a webhook reply for postWithRetry (retry_after seconds -> ms on 429)', () => {
  assert.deepEqual(PS5W.discordReply(204, ''), { status: 204, retryAfterMs: 0 });
  assert.deepEqual(PS5W.discordReply(429, '{"message":"You are being rate limited.","retry_after":1.234,"global":false}'), { status: 429, retryAfterMs: 1234 });
  assert.deepEqual(PS5W.discordReply(429, 'not json'), { status: 429, retryAfterMs: 0 });
  assert.deepEqual(PS5W.discordReply(429, '{"retry_after":"x"}'), { status: 429, retryAfterMs: 0 });
  assert.deepEqual(PS5W.discordReply(400, '{"retry_after":5}'), { status: 400, retryAfterMs: 0 });
});

test('pillText by mode', () => {
  const t = new Date(2026, 10, 26, 9, 5, 7).getTime();
  assert.equal(PS5W.pillText({ mode: 'ok', storeName: 'JIB', lastCheck: t }), '🟢 JIB · 09:05');
  assert.equal(PS5W.pillText({ mode: 'ok', storeName: 'JIB', lastCheck: null }), '🟢 JIB');
  assert.equal(PS5W.pillText({ mode: 'stock', storeName: 'JIB' }), '🔥 IN STOCK · JIB');
  assert.equal(PS5W.pillText({ mode: 'warn', storeName: 'JIB' }), '⚠️ Needs you · JIB');
  assert.equal(PS5W.pillText({ mode: 'setup', storeName: 'JIB' }), '⚙️ Set up');
});

test('Dotlife: one feed request with the store code and no cookies, then the parser', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: dlFeed });
  const res = await PS5W.checkStore(env, DOT);
  assert.deepEqual(env.calls.fetch, [PS5W.feedRequest(DOT).url]);
  assert.deepEqual(env.calls.fetchInit, [{ credentials: 'omit', headers: { Store: 'dth' } }]);
  assert.equal(res.blocked, false);
  assert.equal(res.products.length, 3);
});

test('Dotlife: an empty feed list is "needs you", never "all sold out"', async () => {
  const env = fakeEnv();
  env.state.flags = { reloaded: true, stuck: false };
  env.page = () => ({ status: 200, text: JSON.stringify({ data: { products: { total_count: 0, items: [] } } }) });
  await PS5W.runCheck(env, DOT);
  assert.equal(lastRender(env).mode, 'warn');
  assert.equal(lastRender(env).why, 'dotlife feed listed no products');
  assert.equal(env.calls.post.length, 1);
  assert.equal(env.calls.setItems.length, 0);
});

test('Dotlife: IN_STOCK pings once with the product link', async () => {
  const env = fakeEnv();
  env.page = () => ({ status: 200, text: dlFeed.replace('"OUT_OF_STOCK"', '"IN_STOCK"') });
  await PS5W.runCheck(env, DOT);
  assert.equal(lastRender(env).mode, 'stock');
  assert.equal(env.calls.post.length, 1);
  assert.match(JSON.stringify(env.calls.post[0]), /sony-ps5-console-e-chassis\.html/);
  assert.deepEqual(env.calls.ping, ['dotlife']);
});
