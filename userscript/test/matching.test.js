'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PS5W = require('../ps5watch.user.js');

const yes = [
  'PlayStation®5 Console – 1TB (CFI-2118 A01)',
  'PlayStation®5 Digital Edition – 825GB (CFI-2118 B01)',
  'New PlayStation 5 Console (SLIM) - Digital Edition 2nd DualSense bundle (ASIA-00480)',
  'SONY เครื่องเล่นเกมคอนโซล PlayStation 5 Slim Digital Edition (1TB)',
  'GAME CONSOLE (เครื่องเล่นเกมคอนโซล) SONY PLAYSTATION 5 PRO - 2TB NEW MODEL',
  'PS5 Pro 2TB',
  // a console bundle that also ships a controller is still a console
  'PlayStation 5 Slim Console + 2nd DualSense Wireless Controller Bundle',
];
const no = [
  // real Powerbuy controller titles that pinged as consoles on 2026-11-26 (bundle SKU / "for PS5 console")
  'PS5 DualSense PC Ready คอนโทรลเลอร์ไร้สาย + USB Cable (สี Midnight Black) รุ่น ASIA-00500',
  'คอนโทรลเลอร์ไร้สาย (สี Cosmic Red ) รุ่น DualSense สำหรับคอนโซล PS5',
  'DualSense Wireless Controller for PS5 Console (White)',
  'PlayStation 5 Disc Drive (SLIM) (CFI-ZDD1G)',
  'PlayStation 5  Vertical Stand (SLIM) (CFI-ZVS1P)',
  'DualSense® Wireless Controller: CFI-ZCT1G (Metallic color)',
  'PlayStation®VR2 : CFI-ZVR1 G',
  'PlayStation®5 Spider-Man 2 Standard Edition (ECAS-00050E)',
  'SONY แผ่นเกม PS5 Spider-Man 2',
  'PlayStation Portal Remote Player',
  'Xbox Series X Console',
  'เคส PS5 Slim Digital Edition',
];

test('isConsole accepts consoles', () => {
  for (const t of yes) assert.equal(PS5W.isConsole(t), true, t);
});
test('isConsole rejects accessories, games and other consoles', () => {
  for (const t of no) assert.equal(PS5W.isConsole(t), false, t);
});
test('isConsole: empty and non-string are false', () => {
  assert.equal(PS5W.isConsole(''), false);
  assert.equal(PS5W.isConsole('   '), false);
  assert.equal(PS5W.isConsole(null), false);
  assert.equal(PS5W.isConsole(undefined), false);
});
