const test = require('node:test');
const assert = require('node:assert/strict');
const PS5W = require('../ps5watch.user.js');

test('timing constants', () => {
  assert.equal(PS5W.INTERVAL_MS, 60000);
  assert.equal(PS5W.JITTER_MS, 10000);
  assert.equal(PS5W.STUCK_RETRY_MS, 300000);
  assert.equal(PS5W.LOCK_STALE_MS, 180000);
  assert.equal(PS5W.HEARTBEAT_MS, 15000);
});

const F = (reloaded, stuck) => ({ reloaded, stuck });
const rows = [
  [{}, false, 'continue', F(false, false)],
  [{}, true, 'reload', F(true, false)],
  [{ reloaded: true }, true, 'needsYou', F(true, true)],
  [{ reloaded: true, stuck: true }, true, 'stillStuck', F(true, true)],
  [{ reloaded: true, stuck: true }, false, 'recovered', F(false, false)],
  [{ reloaded: true }, false, 'continue', F(false, false)],
];
for (const [flags, blocked, action, out] of rows) {
  test(`blockStep ${JSON.stringify(flags)} blocked=${blocked} -> ${action}`, () => {
    const r = PS5W.blockStep(flags, blocked);
    assert.equal(r.action, action);
    assert.deepEqual(r.flags, out);
  });
}

test('blockStep does not mutate its input', () => {
  const input = { reloaded: true };
  const r = PS5W.blockStep(input, true);
  assert.deepEqual(input, { reloaded: true });
  assert.notEqual(r.flags, input);
});

test('nextDelayMs normal spans 50s..70s', () => {
  assert.equal(PS5W.nextDelayMs('normal', 0), 50000);
  assert.equal(PS5W.nextDelayMs('normal', 0.5), 60000);
  assert.ok(PS5W.nextDelayMs('normal', 0.999) < 70000);
  assert.ok(PS5W.nextDelayMs('normal', 0) >= 50000);
});

test('nextDelayMs stuck is 300s regardless of random', () => {
  assert.equal(PS5W.nextDelayMs('stuck', 0), 300000);
  assert.equal(PS5W.nextDelayMs('stuck', 0.999), 300000);
});

test('lockDecision', () => {
  const now = 1000000;
  assert.equal(PS5W.lockDecision(null, 'a', now), 'mine');
  assert.equal(PS5W.lockDecision({ id: 'b', ts: now - 10000 }, 'a', now), 'other');
  assert.equal(PS5W.lockDecision({ id: 'b', ts: now - 180001 }, 'a', now), 'mine');
  assert.equal(PS5W.lockDecision({ id: 'a', ts: now - 10 }, 'a', now), 'mine');
  assert.equal(PS5W.lockDecision('x', 'a', now), 'mine');
  assert.equal(PS5W.lockDecision({}, 'a', now), 'mine');
});

test('firstDelayMs: the first check after a load waits out the normal gap since the last check', () => {
  const now = 1700000000000;
  assert.equal(PS5W.firstDelayMs(now - 10000, now, 0.5), 50000);
  assert.equal(PS5W.firstDelayMs(now - 120000, now, 0.5), 0);
  assert.equal(PS5W.firstDelayMs(now - 55000, now, 0), 0);
  assert.equal(PS5W.firstDelayMs(undefined, now, 0.5), 0);
  assert.equal(PS5W.firstDelayMs(null, now, 0.5), 0);
  assert.equal(PS5W.firstDelayMs(NaN, now, 0.5), 0);
  assert.equal(PS5W.firstDelayMs(Infinity, now, 0.5), 0);
  assert.equal(PS5W.firstDelayMs('1699999990000', now, 0.5), 0);
});

test('isWatcherLocation: #ps5watch on the store watch path only (query ignored)', () => {
  const loc = (pathname, hash, search = '') => ({ pathname, hash, search });
  const pb = PS5W.STORES.powerbuy;
  assert.equal(PS5W.isWatcherLocation(loc('/th/search/ps5', '#ps5watch'), pb), true);
  assert.equal(PS5W.isWatcherLocation(loc('/th/search/ps5', ''), pb), false);
  assert.equal(PS5W.isWatcherLocation(loc('/th/search/ps5', '#other'), pb), false);
  assert.equal(PS5W.isWatcherLocation(loc('/th/product/x', '#ps5watch'), pb), false);
  assert.equal(PS5W.isWatcherLocation(loc('/th/cart', '#ps5watch'), pb), false);
  assert.equal(PS5W.isWatcherLocation(loc('/th/search/ps5', '#ps5watch', '?sort=price'), pb), true);
  const bn = PS5W.STORES.banana;
  assert.equal(PS5W.isWatcherLocation(loc('/th/p', '#ps5watch', '?q=playstation+5'), bn), true);
  assert.equal(PS5W.isWatcherLocation(loc('/th/p/ps5-slim-console', '#ps5watch'), bn), false);
  const jib = PS5W.STORES.jib;
  assert.equal(PS5W.isWatcherLocation(loc('/web/product/product_search/0', '#ps5watch', '?str_search=ps5'), jib), true);
  assert.equal(PS5W.isWatcherLocation(loc('/web/product/readProduct/82892/1652/x', '#ps5watch'), jib), false);
  assert.equal(PS5W.isWatcherLocation(loc('/th/search/ps5', '#ps5watch'), jib), false);
});
