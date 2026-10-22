// Unit tests for the decorative "lively" helpers (fixed clocks, a seeded random).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayPhase, clockAngles, pickIdleAct, eventAct, partyDue, meetingMood } from './lively.js';

const at = (h, m = 0) => new Date(2026, 9, 22, h, m).getTime();

test('dayPhase follows the local clock', () => {
  assert.equal(dayPhase(at(4, 59)), 'night');
  assert.equal(dayPhase(at(5, 0)), 'dawn');
  assert.equal(dayPhase(at(7, 0)), 'day');
  assert.equal(dayPhase(at(16, 29)), 'day');
  assert.equal(dayPhase(at(16, 30)), 'dusk');
  assert.equal(dayPhase(at(18, 30)), 'night');
  assert.equal(dayPhase(at(23, 0)), 'night');
});

test('clockAngles', () => {
  assert.deepEqual(clockAngles(at(3, 0)), { hour: 90, minute: 0 });
  assert.deepEqual(clockAngles(at(15, 30)), { hour: 105, minute: 180 });
  assert.equal(clockAngles(at(0, 0)).hour, 0);
});

test('pickIdleAct never touches cats in a real state', () => {
  assert.equal(pickIdleAct({ a: 'busy', b: 'alert', c: 'error', d: 'off' }), null);
  assert.deepEqual(pickIdleAct({ a: 'busy', b: 'awake' }, () => 0), { key: 'b', act: 'yawn' });
  for (let i = 0; i < 50; i++) {
    const r = pickIdleAct({ s: 'sleep' }, Math.random);
    assert.ok(['yawn', 'stretch'].includes(r.act));
  }
  assert.ok(pickIdleAct({ a: 'awake' }, () => 0.9999));
});

test('eventAct / partyDue / meetingMood', () => {
  assert.equal(eventAct({ event: 'Stop' }), 'stretch');
  assert.equal(eventAct({ event: 'PreToolUse' }), null);
  assert.equal(eventAct(null), null);
  assert.equal(partyDue(8, 8, '2026-10-22', ''), '2026-10-22');
  assert.equal(partyDue(8.5, 8, '2026-10-22', '2026-10-22'), null);
  assert.equal(partyDue(7.9, 8, '2026-10-22', ''), null);
  assert.equal(partyDue(undefined, 8, '2026-10-22', ''), null);
  assert.deepEqual(meetingMood({ next: { state: 'now', title: 'x', end: 5 } }), { kind: 'now', title: 'x', until: 5 });
  assert.deepEqual(meetingMood({ next: { state: 'soon', title: 'y', inMin: 4, start: 9 } }), { kind: 'soon', title: 'y', inMin: 4, at: 9 });
  assert.equal(meetingMood({ next: { state: 'later' } }), null);
  assert.equal(meetingMood(null), null);
});
