const test = require('node:test');
const assert = require('node:assert/strict');
const PS5W = require('../ps5watch.user.js');

const R = 900000;
const U = 'https://www.bnn.in.th/th/p/ps5-console';
const prod = (over = {}) => ({ title: 'PS5 Console', url: U, price: '15990', available: true, reason: 'x', ...over });

test('RENOTIFY_MS is 15 minutes', () => {
  assert.equal(PS5W.RENOTIFY_MS, 900000);
});

test('new in-stock product alerts once and records notified', () => {
  const r = PS5W.nextAlerts({}, [prod()], 1000, R);
  assert.equal(r.alerts.length, 1);
  assert.equal(r.items[U].notified, 1000);
  assert.equal(r.items[U].available, true);
});

test('same product 60 s later does not alert; at now+R it does', () => {
  const a = PS5W.nextAlerts({}, [prod()], 1000, R);
  assert.equal(PS5W.nextAlerts(a.items, [prod()], 61000, R).alerts.length, 0);
  const c = PS5W.nextAlerts(a.items, [prod()], 1000 + R, R);
  assert.equal(c.alerts.length, 1);
  assert.equal(c.items[U].notified, 1000 + R);
});

test('available null never alerts and keeps stored availability', () => {
  const a = PS5W.nextAlerts({}, [prod()], 1000, R);
  const b = PS5W.nextAlerts(a.items, [prod({ available: null })], 2000, R);
  assert.equal(b.alerts.length, 0);
  assert.equal(b.items[U].available, true);
});

test('in -> out -> in alerts on the return and sets wentOut', () => {
  const a = PS5W.nextAlerts({}, [prod()], 1000, R);
  const b = PS5W.nextAlerts(a.items, [prod({ available: false })], 2000, R);
  assert.equal(b.items[U].available, false);
  assert.equal(b.items[U].wentOut, 2000);
  const c = PS5W.nextAlerts(b.items, [prod()], 3000, R);
  assert.equal(c.alerts.length, 1);
});

test('known in-stock URL missing from a non-empty list counts as sold out', () => {
  const a = PS5W.nextAlerts({}, [prod()], 1000, R);
  const other = prod({ url: 'https://www.bnn.in.th/th/p/other', available: false });
  const b = PS5W.nextAlerts(a.items, [other], 2000, R);
  assert.equal(b.items[U].available, false);
  assert.equal(b.items[U].wentOut, 2000);
  const c = PS5W.nextAlerts(b.items, [prod(), other], 3000, R);
  assert.equal(c.alerts.length, 1);
});

test('empty products list marks every known in-stock URL sold out', () => {
  const u2 = 'https://www.bnn.in.th/th/p/two';
  let r = PS5W.nextAlerts({}, [prod(), prod({ url: u2 })], 1000, R);
  r = PS5W.nextAlerts(r.items, [], 2000, R);
  assert.equal(r.items[U].available, false);
  assert.equal(r.items[u2].available, false);
  assert.equal(r.items[U].wentOut, 2000);
  assert.equal(r.alerts.length, 0);
});

test('nextAlerts does not mutate its input', () => {
  const a = PS5W.nextAlerts({}, [prod()], 1000, R);
  const copy = JSON.parse(JSON.stringify(a.items));
  PS5W.nextAlerts(a.items, [prod({ available: false })], 2000, R);
  PS5W.nextAlerts(a.items, [], 3000, R);
  PS5W.nextAlerts(a.items, [prod()], 1000 + R, R);
  assert.deepEqual(a.items, copy);
});

test('loadItems tolerates corrupt storage', () => {
  assert.deepEqual(PS5W.loadItems(undefined), {});
  assert.deepEqual(PS5W.loadItems(null), {});
  assert.deepEqual(PS5W.loadItems('garbage'), {});
  assert.deepEqual(PS5W.loadItems('{"u":{"available":true}}'), { u: { available: true } });
  const o = { u: { available: false } };
  assert.deepEqual(PS5W.loadItems(o), o);
});
