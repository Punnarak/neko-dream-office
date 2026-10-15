// Unit tests for the sound-alert rules, with hand-written events (not a live connection).
import test from 'node:test'; import assert from 'node:assert/strict';
import { soundFor, allowSound, reducer, initialState } from './office.js';
test('soundFor', () => {
  assert.equal(soundFor({ status: 'completed' }, { event: 'Stop' }), 'completed');
  assert.equal(soundFor({ status: 'waiting' }, { event: 'Notification' }), 'waiting');
  assert.equal(soundFor({ status: 'error' }, { event: 'PostToolUseFailure' }), 'error');
  assert.equal(soundFor({ status: 'interrupted' }, { event: 'PostToolUseFailure' }), null);
  assert.equal(soundFor({ status: 'idle' }, { event: 'Notification' }), null);
  assert.equal(soundFor({ status: 'error' }, { event: 'PreToolUse' }), null);
});
test('allowSound', () => {
  const l = {};
  assert.ok(allowSound(l, 'a', 'completed', 0));
  assert.ok(!allowSound(l, 'a', 'completed', 1000));
  assert.ok(allowSound(l, 'a', 'waiting', 1500));
  assert.ok(allowSound(l, 'b', 'error', 1500));
  assert.ok(allowSound(l, 'a', 'completed', 5000));
});
test('snapshot clears lastEvent', () => {
  let s = reducer(initialState, { type: 'event', session: { id: 'x' }, item: { id: 1 } });
  assert.ok(s.lastEvent);
  s = reducer(s, { type: 'snapshot', sessions: [], feed: [] });
  assert.equal(s.lastEvent, null);
});

// Kittens (SIMULATED agent lists, hand-written — not from a live session).
import { kittenPlaces, catView, CATS, KITTEN } from './office.js';
const ag = (id, category, extra = {}) => ({ id, main: id === 'main', type: id === 'main' ? 'main' : 'Explore', startedAt: 1, tool: category ? { name: 'Read', category } : null, ...extra });
test('simulated: kittens sit at the desk of their tool category, idle ones on the rug', () => {
  const p = Object.fromEntries(kittenPlaces([ag('main', null), ag('A', 'data'), ag('B', 'qa')]).map((k) => [k.agent.id, k.desk]));
  assert.deepEqual(p, { main: 'rug', A: 'data', B: 'qa' });
});
test('simulated: kittens at one desk never overlap', () => {
  const list = [ag('main', 'data'), ...Array.from({ length: 7 }, (_, i) => ag(`S${i}`, 'data', { startedAt: i + 2 }))];
  const places = kittenPlaces(list);
  assert.equal(places[0].agent.id, 'main');
  for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) {
    const a = places[i]; const b = places[j];
    assert.ok(Math.abs(a.left - b.left) >= KITTEN.w || Math.abs(a.top - b.top) >= KITTEN.row - 0.01, `${a.agent.id} vs ${b.agent.id}`);
  }
});
test('simulated: desk lead summary counts the agents at its desk', () => {
  const session = { status: 'tool', lastEventAt: Date.now(), tools: [{ name: 'Read', category: 'data' }, { name: 'Read', category: 'data' }],
    agents: [ag('main', 'data'), ag('A', 'data'), ag('B', null)] };
  const luna = CATS.find((c) => c.key === 'data');
  const nori = CATS.find((c) => c.key === 'manage');
  assert.equal(catView(luna, session, 'live', Date.now()).chip.text, 'Read · 2 agents');
  assert.equal(catView(nori, session, 'live', Date.now()).chip.text, 'Using Tool · 3 agents');
  assert.equal(catView(CATS.find((c) => c.key === 'qa'), session, 'live', Date.now()).chip, null);
});
test('simulated: every kitten spot stays inside the room', () => {
  for (const desk of ['research', 'code', 'data', 'qa', 'manage', 'creative', null]) {
    const list = Array.from({ length: 6 }, (_, i) => ag(`K${i}`, desk, { startedAt: i }));
    for (const k of kittenPlaces(list)) assert.ok(k.left >= 0 && k.left + KITTEN.w <= 100 && k.top <= 100, `${desk} ${k.left},${k.top}`);
  }
});

import { workStats, isWeekend } from './office.js';
test('workStats averages logged weekdays and lists empty past weekdays', () => {
  const daily = [
    { date: '2026-10-09', hours: 8 },   // Fri
    { date: '2026-10-10', hours: 3 },   // Sat: not in avg or missing
    { date: '2026-10-11', hours: 0 },   // Sun
    { date: '2026-10-12', hours: 0 },   // Mon: missing
    { date: '2026-10-13', hours: 6 },   // Tue
    { date: '2026-10-14', hours: 0 },   // Wed = today: not missing yet
  ];
  assert.equal(isWeekend('2026-10-10'), true);
  assert.equal(isWeekend('2026-10-12'), false);
  const s = workStats(daily, '2026-10-14');
  assert.equal(s.avg, 7);
  assert.equal(s.avgDays, 2);
  assert.deepEqual(s.missing, ['2026-10-12']);
  assert.equal(s.max, 8);
  assert.deepEqual(workStats([], '2026-10-14'), { avg: 0, avgDays: 0, missing: [], offDays: [], max: 0 });
});
import { chubbiness, formatTokens } from './office.js';
test('chubbiness levels by absolute thresholds; unknown stays null', () => {
  assert.equal(chubbiness(null), null);
  assert.equal(chubbiness({}), null);
  assert.deepEqual([0, 19_999, 20_000, 99_999, 100_000, 299_999, 300_000, 999_999, 1_000_000, 9e9].map((total) => chubbiness({ total })),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});
test('formatTokens', () => {
  assert.deepEqual([0, 999, 1000, 12_345, 123_456, 1_234_567, 12_345_678].map(formatTokens),
    ['0', '999', '1k', '12.3k', '123k', '1.23M', '12.3M']);
});

import { offDays, alertFor, notifyDecision, notifyText, tokenStats } from './office.js';
test('holidays and leave days are excluded from missing-log and from the working-day average', () => {
  const daily = [
    { date: '2026-10-09', hours: 8 },   // Fri
    { date: '2026-10-12', hours: 0 },   // Mon: leave (this browser)
    { date: '2026-10-13', hours: 0 },   // Tue: public holiday from holidays.json
    { date: '2026-10-14', hours: 0 },   // Wed: really missing
    { date: '2026-10-15', hours: 2 },   // Thu: holiday with some hours logged -> not in the average
    { date: '2026-10-16', hours: 6 },   // Fri
    { date: '2026-10-17', hours: 0 },   // Sat
    { date: '2026-10-19', hours: 0 },   // Mon = today
  ];
  const off = offDays([{ date: '2026-10-13', name: 'วันคล้ายวันสวรรคต ร.9' }, { date: '2026-10-15', name: 'x' }], ['2026-10-12', 'junk', 5]);
  assert.equal(off['2026-10-13'].kind, 'holiday');
  assert.equal(off['2026-10-13'].name, 'วันคล้ายวันสวรรคต ร.9');
  assert.equal(off['2026-10-12'].kind, 'leave');
  const s = workStats(daily, '2026-10-19', off);
  assert.deepEqual(s.missing, ['2026-10-14']);
  assert.equal(s.avg, 7);       // (8 + 6) / 2 — the holiday's 2 h are not a working day
  assert.equal(s.avgDays, 2);
  assert.deepEqual(s.offDays, ['2026-10-12', '2026-10-13', '2026-10-15']);
  // a holiday that is also marked as leave stays a holiday (name from the file)
  assert.equal(offDays([{ date: '2026-10-13', name: 'H' }], ['2026-10-13'])['2026-10-13'].kind, 'holiday');
  // without the off list, the same days count as missing (old behaviour)
  assert.deepEqual(workStats(daily, '2026-10-19').missing, ['2026-10-12', '2026-10-13', '2026-10-14']);
});

// Desktop notification rules (hand-written events, not a live connection).
const ev = (status, event, id = 's1') => ({ session: { id, status, project: 'neko-dream-office' }, item: { event } });
const base = (extra = {}) => ({ enabled: true, permission: 'granted', conn: 'live', scope: 'all', viewedId: 's1', visible: false, last: {}, at: 10_000, ...extra });
test('alertFor: same trigger rules as the sound', () => {
  assert.equal(alertFor(ev('waiting', 'Notification'), { conn: 'live', scope: 'all' }), 'waiting');
  assert.equal(alertFor(ev('working', 'PreToolUse'), { conn: 'live', scope: 'all' }), null);
  assert.equal(alertFor(ev('completed', 'Stop'), { conn: 'disconnected', scope: 'all' }), null);
  assert.equal(alertFor(ev('completed', 'Stop', 's2'), { conn: 'live', scope: 'viewed', viewedId: 's1' }), null);
  assert.equal(alertFor(null, { conn: 'live', scope: 'all' }), null); // snapshot / reconnect: no lastEvent
});
test('notifyDecision: only when enabled + granted + hidden/unfocused, throttled per session with priority', () => {
  assert.equal(notifyDecision(ev('completed', 'Stop'), base()).kind, 'completed');
  assert.equal(notifyDecision(ev('completed', 'Stop'), base({ enabled: false })), null);
  assert.equal(notifyDecision(ev('completed', 'Stop'), base({ permission: 'default' })), null);
  assert.equal(notifyDecision(ev('completed', 'Stop'), base({ permission: 'denied' })), null);
  assert.equal(notifyDecision(ev('completed', 'Stop'), base({ visible: true })), null);
  assert.equal(notifyDecision(ev('completed', 'Stop'), base({ conn: 'connecting' })), null);
  assert.equal(notifyDecision(ev('interrupted', 'PostToolUseFailure'), base()), null);
  const last = {};
  assert.ok(notifyDecision(ev('completed', 'Stop'), base({ last, at: 0 })));
  assert.equal(notifyDecision(ev('completed', 'Stop'), base({ last, at: 1000 })), null);   // within 3 s
  assert.equal(notifyDecision(ev('error', 'StopFailure'), base({ last, at: 1500 })).kind, 'error'); // more important cuts in
  assert.ok(notifyDecision(ev('completed', 'Stop', 's2'), base({ last, at: 1600 })));       // other session
  assert.ok(notifyDecision(ev('completed', 'Stop'), base({ last, at: 5000 })));
  // a visible page does not use up the throttle
  const l2 = {};
  assert.equal(notifyDecision(ev('waiting', 'Notification'), base({ last: l2, visible: true })), null);
  assert.deepEqual(l2, {});
});
test('notifyText: Thai status + project + short id only, one tag per session', () => {
  const t = notifyText({ id: '1b6fde97-8f1d-4308', project: 'neko-dream-office', lastError: { message: 'SECRET' } }, 'waiting');
  assert.equal(t.body, 'รอคุณอนุญาต — neko-dream-office · 1b6fde97');
  assert.equal(t.tag, 'neko-1b6fde97-8f1d-4308');
  assert.ok(!JSON.stringify(t).includes('SECRET'));
  assert.equal(notifyText({ id: 'abc' }, 'completed').body, 'ตอบจบเทิร์น รอคำสั่ง — abc');
});
test('tokenStats averages over days with usage', () => {
  assert.deepEqual(tokenStats([{ counted: 0 }, { counted: 100 }, { counted: 300 }]), { avg: 200, activeDays: 2, max: 300 });
  assert.deepEqual(tokenStats([]), { avg: 0, activeDays: 0, max: 0 });
});

import { fmtHours, fmtShort, agentShort, KITTEN_NARROW, KITTEN_SPOTS_NARROW } from './office.js';
test('hours are shown as hours + minutes, never decimal hours', () => {
  assert.equal(fmtHours(8.49), '8 ชม. 29 น.');
  assert.equal(fmtShort(8.49), '8:29 ชม.');
  assert.equal(fmtHours(7.99), '7 ชม. 59 น.');
  assert.equal(fmtShort(7.99), '7:59 ชม.');
  assert.equal(fmtHours(0.17), '10 น.');
  assert.equal(fmtShort(0.17), '10 น.');
  assert.equal(fmtHours(59.6 / 60), '1 ชม.');      // 59.6 min rounds up to the next hour
  assert.equal(fmtShort(2 + 59.6 / 60), '3:00 ชม.');
  assert.equal(fmtShort(8), '8:00 ชม.');
  assert.equal(fmtHours(0), '0 น.');
  for (const h of [0.5, 1.25, 7.3, 8.49]) assert.ok(!/\d\.\d/.test(fmtShort(h) + fmtHours(h)), String(h));
});
test('agentShort: ≤5 chars for phone tags', () => {
  const s = (type, main = false) => agentShort({ main, type });
  assert.deepEqual([s('Explore'), s('Plan'), s('general-purpose'), s('token-optimizer:fleet-auditor'), s('x', true), s(undefined)],
    ['Expl', 'Plan', 'GP', 'FA', 'Main', 'suba']);
});
test('simulated: phone layout keeps up to 3 kittens per desk fully inside the room, 40px-tap-friendly spacing', () => {
  for (const desk of Object.keys(KITTEN_SPOTS_NARROW)) {
    const list = ['main', 'A', 'B'].map((id) => ag(id, desk === 'rug' ? null : desk));
    const places = kittenPlaces(list, KITTEN_NARROW, KITTEN_SPOTS_NARROW);
    // top = the kitten's bottom edge; a kitten + tag is ~20 % of the room's height
    for (const k of places) assert.ok(k.left >= 0 && k.left + KITTEN_NARROW.w <= 100 && k.top <= 100 && k.top >= 20, `${desk} ${k.left},${k.top}`);
    for (const a of places) for (const b of places) if (a !== b) {
      assert.ok(Math.abs(a.left - b.left) >= KITTEN_NARROW.step - 0.01 || Math.abs(a.top - b.top) >= KITTEN_NARROW.row - 0.01, `${desk} ${a.agent.id}/${b.agent.id}`);
    }
  }
});
