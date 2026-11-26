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
