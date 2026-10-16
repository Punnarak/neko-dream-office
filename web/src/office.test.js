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

test('offDays merges Redmine leave days: not missing, not averaged, beat manual leave, lose to holidays', () => {
  const daily = [
    { date: '2026-10-12', hours: 8 },   // Mon: Redmine leave (8 h "Leave") -> excluded from the average
    { date: '2026-10-13', hours: 0 },   // Tue: Redmine leave with 0 h in daily (outside range edge) -> not missing
    { date: '2026-10-14', hours: 6 },   // Wed: normal day
    { date: '2026-10-15', hours: 0 },   // Thu: holiday + Redmine leave -> holiday wins
    { date: '2026-10-16', hours: 0 },   // Fri: really missing
    { date: '2026-10-19', hours: 0 },   // Mon = today
  ];
  const rm = [{ date: '2026-10-12', hours: 8 }, { date: '2026-10-13', hours: 4 }, { date: '2026-10-15', hours: 8 }, { hours: 1 }, null];
  const off = offDays([{ date: '2026-10-15', name: 'H' }], ['2026-10-12'], rm);
  assert.equal(off['2026-10-12'].kind, 'redmine');   // also toggled manually: Redmine wins
  assert.equal(off['2026-10-12'].name, 'ลา (Redmine)');
  assert.equal(off['2026-10-13'].hours, 4);
  assert.equal(off['2026-10-15'].kind, 'holiday');
  const s = workStats(daily, '2026-10-19', off);
  assert.deepEqual(s.missing, ['2026-10-16']);
  assert.equal(s.avg, 6);
  assert.equal(s.avgDays, 1);
  assert.deepEqual(s.offDays, ['2026-10-12', '2026-10-13', '2026-10-15']);
  assert.deepEqual(offDays([], [], undefined), {});
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

// Redmine "มีอัปเดต" (SIMULATED issues and seen maps, hand-written — not live Redmine data).
import { rmAlert, rmAlerts, rmMarkSeen, rmParseSeen, rmFreshAlerts, rmNotifyText } from './office.js';
const rmi = (id, updatedOn, lastActivity) => ({ id, subject: `S${id}`, updatedOn, lastActivity });
test('simulated: rmAlert new / updated / by me / seen', () => {
  const seen = { 1: '2026-10-10T00:00:00Z', 2: '2026-10-10T00:00:00Z', 3: '2026-10-10T00:00:00Z' };
  assert.equal(rmAlert(rmi(9, '2026-10-12T00:00:00Z'), seen).kind, 'new');
  assert.equal(rmAlert(rmi(1, '2026-10-12T00:00:00Z', { byMe: false, kinds: ['comment', 'status'] }), seen).kind, 'comment');
  assert.equal(rmAlert(rmi(2, '2026-10-12T00:00:00Z', null), seen).kind, 'other'); // activity not read yet
  assert.equal(rmAlert(rmi(2, '2026-10-12T00:00:00Z', { byMe: true, kinds: ['comment'] }), seen), null);
  assert.equal(rmAlert(rmi(9, '2026-10-12T00:00:00Z', { byMe: true, kinds: ['other'] }), seen), null); // I created it
  assert.equal(rmAlert(rmi(3, '2026-10-10T00:00:00Z', { byMe: false, kinds: ['comment'] }), seen), null);
  assert.equal(rmAlert(rmi(3, '2026-10-12T00:00:00Z', { byMe: null, kinds: ['assignee'] }), seen).text, 'มอบหมายใหม่');
  assert.equal(rmAlert(rmi(3, '2026-10-12T00:00:00Z'), null), null); // no seen map yet = no flood
});
test('simulated: mark seen, parse, fresh alerts and notification text', () => {
  const issues = [rmi(1, '2026-10-12T00:00:00Z'), rmi(2, '2026-10-13T00:00:00Z')];
  const seen = rmMarkSeen({}, issues);
  assert.deepEqual(rmAlerts(issues, seen), {});
  assert.deepEqual(rmParseSeen(JSON.stringify(seen)), { 1: '2026-10-12T00:00:00Z', 2: '2026-10-13T00:00:00Z' });
  assert.equal(rmParseSeen('[1]'), null);
  assert.equal(rmParseSeen('{bad'), null);
  assert.deepEqual(rmParseSeen('{"x":"a","5":3,"6":"b"}'), { 6: 'b' });
  const big = rmMarkSeen({}, Array.from({ length: 350 }, (_, n) => rmi(n + 1, `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`)));
  assert.equal(Object.keys(big).length, 300);
  const known = new Set();
  const a = rmAlerts([rmi(1, '2026-10-14T00:00:00Z', { byMe: false, kinds: ['comment'] })], seen);
  assert.equal(rmFreshAlerts(known, a).length, 1);
  assert.equal(rmFreshAlerts(known, a).length, 0); // the same update never alerts twice
  const n = rmNotifyText({ id: 1, say: 'มีคนตอบ' }, 'x'.repeat(100));
  assert.equal(n.title, '📋 Redmine');
  assert.ok(n.body.startsWith('#1 มีคนตอบ — ') && n.body.length < 80);
});
test('redmineLive: only a live push may alert, a snapshot resets it', () => {
  let s = reducer(initialState, { type: 'redmine', redmine: { issues: [] } });
  assert.equal(s.redmineLive, true);
  s = reducer(s, { type: 'snapshot', sessions: [], feed: [], redmine: { issues: [] } });
  assert.equal(s.redmineLive, false);
});

import { suggestHours, logTimeUrl, usualActivity, claudeDay, claudeMs } from './office.js';
test('suggestHours rounds to 15 minutes, never 0 for real work', () => {
  assert.equal(suggestHours(0), null);
  assert.equal(suggestHours(3 * 60_000), 0.25);
  assert.equal(suggestHours(130 * 60_000), 2.25);
  assert.equal(suggestHours(127 * 60_000), 2.0);
});
test('logTimeUrl pre-fills Redmine\'s own form', () => {
  assert.equal(logTimeUrl(null, { issueId: 1 }), null);
  assert.equal(logTimeUrl('https://rm', { issueId: 104498, date: '2026-10-15', hours: 2.25, activityId: 9 }),
    'https://rm/issues/104498/time_entries/new?time_entry%5Bspent_on%5D=2026-10-15&time_entry%5Bhours%5D=2.25&time_entry%5Bactivity_id%5D=9');
  assert.equal(logTimeUrl('https://rm', { issueId: 5 }), 'https://rm/issues/5/time_entries/new');
  assert.equal(logTimeUrl('https://rm', { date: '2026-10-15' }), 'https://rm/time_entries/new?time_entry%5Bspent_on%5D=2026-10-15');
});
test('usualActivity: most used, never Leave', () => {
  const log = [{ activityId: 3, activity: 'Leave' }, { activityId: 3, activity: 'Leave' }, { activityId: 9, activity: 'Dev' }, { activityId: 9, activity: 'Dev' }, { activityId: 4, activity: 'Doc' }];
  assert.equal(usualActivity(log), 9);
  assert.equal(usualActivity([]), null);
});
test('claudeDay: what is still unlogged per ticket', () => {
  const M = 60_000;
  const ct = { days: [{ date: '2026-10-15', items: [
    { ticket: 1, project: null, ms: 130 * M }, { ticket: 2, project: null, ms: 80 * M },
    { ticket: 3, project: null, ms: 65 * M }, { ticket: null, project: 'x', ms: 25 * M }, { ticket: 4, project: null, ms: 30_000 },
  ] }] };
  const log = [{ spentOn: '2026-10-15', issueId: 1, hours: 2.5 }, { spentOn: '2026-10-15', issueId: 3, hours: 1 }, { spentOn: '2026-10-14', issueId: 2, hours: 5 }];
  assert.deepEqual(claudeDay(ct, '2026-10-15', log).map((r) => [r.ticket, r.logged, r.suggest]),
    [[1, 2.5, null], [2, 0, 1.25], [3, 1, null], [null, null, 0.5]]); // 5 min left on #3 counts as covered; <1 min dropped
  assert.deepEqual(claudeDay(ct, '2026-10-16', log), []);
  assert.equal(claudeMs(ct, '2026-10-15', 2), 80 * M);
  assert.equal(claudeMs(null, '2026-10-15', 2), 0);
});

import { todayBrief, endOfDay, prevWorkday, parseClock, isResolved, mergeRequestText, MERGE_GREETING } from './office.js';
const at = (h, m = 0) => new Date(2026, 9, 15, h, m).getTime(); // Thu 15 Oct 2026
const M60 = 3_600_000;
const rm = {
  issues: [
    { id: 1, subject: 'late', status: 'In Progress', dueDate: '2026-10-13', url: 'u1' },
    { id: 2, subject: 'today', status: 'New', dueDate: '2026-10-15', url: 'u2' },
    { id: 3, subject: 'later', status: 'New', dueDate: '2026-10-20' },
    { id: 4, subject: 'done', status: 'Resolved', dueDate: '2026-10-01' },
  ],
  time: {
    today: '2026-10-15',
    daily: [{ date: '2026-10-12', hours: 8 }, { date: '2026-10-13', hours: 0 }, { date: '2026-10-14', hours: 6 }, { date: '2026-10-15', hours: 3.5 }],
    log: [{ spentOn: '2026-10-15', issueId: 1, hours: 2 }],
  },
};
const ct = { days: [
  { date: '2026-10-15', items: [{ ticket: 1, project: null, ms: 2 * M60 }, { ticket: 2, project: null, ms: 1.25 * M60 }] },
  { date: '2026-10-14', items: [{ ticket: 3, project: null, ms: 0.5 * M60 }] },
] };

test('prevWorkday skips weekends and days off', () => {
  assert.equal(prevWorkday('2026-10-19'), '2026-10-16'); // Mon -> Fri
  assert.equal(prevWorkday('2026-10-15', { '2026-10-14': {} }), '2026-10-13');
});
test('parseClock', () => {
  assert.equal(parseClock('17:00'), 1020);
  assert.equal(parseClock('off'), null);
  assert.equal(parseClock('25:00'), null);
});
test('todayBrief: due, updates, yesterday and today', () => {
  const b = todayBrief({ redmine: rm, claudeTime: ct, alerts: { 3: { icon: '💬', text: 'มีคนตอบ' } }, now: at(9) });
  assert.deepEqual(b.due.map((d) => [d.id, d.days]), [[1, -2], [2, 0]]);
  assert.deepEqual(b.updates, [{ id: 3, subject: 'later', icon: '💬', text: 'มีคนตอบ' }]);
  assert.equal(b.prev.date, '2026-10-14');
  assert.equal(b.prev.short, 2);
  assert.deepEqual(b.prev.unlogged.map((r) => [r.ticket, r.suggest]), [[3, 0.5]]);
  assert.deepEqual(b.now.unlogged.map((r) => r.ticket), [2]);
  assert.deepEqual(b.missing, ['2026-10-13']);
  assert.equal(b.workday, true);
  assert.ok(isResolved({ status: 'Resolved' }));
  const empty = todayBrief({ redmine: null, claudeTime: null, now: at(9) });
  assert.deepEqual([empty.due, empty.updates, empty.prev, empty.now, empty.missing, empty.unmerged], [[], [], null, null, [], []]);
});
test('endOfDay: once, after the time, on a working day, only when something is open', () => {
  const base = { redmine: rm, claudeTime: ct, at: '17:00' };
  assert.equal(endOfDay({ ...base, now: at(16, 59) }), null);
  const r = endOfDay({ ...base, now: at(17, 5) });
  assert.equal(r.date, '2026-10-15');
  assert.equal(r.body, 'ลงเวลาวันนี้ 3:30 ชม. / 8 ชม. · Claude ทำยังไม่ลง: #2 1:15 ชม.');
  assert.equal(endOfDay({ ...base, now: at(17, 5), done: '2026-10-15' }), null);
  assert.equal(endOfDay({ ...base, now: at(17, 5), at: 'off' }), null);
  assert.equal(endOfDay({ ...base, now: at(17, 5), off: { '2026-10-15': { kind: 'holiday' } } }), null);
  const full = { ...rm, time: { ...rm.time, daily: [{ date: '2026-10-15', hours: 8 }], log: [{ spentOn: '2026-10-15', issueId: 1, hours: 2 }, { spentOn: '2026-10-15', issueId: 2, hours: 1.25 }] } };
  assert.equal(endOfDay({ ...base, redmine: full, now: at(18) }), null);
  assert.equal(endOfDay({ ...base, redmine: { ...rm, time: { ...rm.time, today: '2026-10-14' } }, now: at(18) }), null); // stale data
});

test('todayBrief: Resolved issues with unmerged branches', () => {
  const unmerged = {
    4: [{ repo: 'api', branch: 'ticket/212', base: 'master', ahead: 2 }, { repo: 'api', branch: 'task-4', base: 'master', ahead: 1 }, { repo: 'web', branch: 'x', base: 'main', ahead: 1 }],
    1: [{ repo: 'api', branch: 'y', base: 'master', ahead: 1 }], // not Resolved: ignored
  };
  const b = todayBrief({ redmine: { ...rm, unmerged }, claudeTime: null, now: at(9) });
  assert.deepEqual(b.unmerged, [{ id: 4, subject: 'done', url: undefined, repos: ['api', 'web'] }]);
  assert.deepEqual(todayBrief({ redmine: rm, claudeTime: null, now: at(9) }).unmerged, []);
});

test('mergeRequestText: greeting, subject, url, then one line per branch', () => {
  const issue = { id: 12345, subject: '(test) fix login', url: 'https://rm.example/issues/12345' };
  const branches = [
    { repo: 'app-a', branch: 'ticket/212', ahead: 3 },
    { repo: 'app-a', branch: 'origin/ticket/212', ahead: 3 }, // same line once
    { repo: 'app-b', branch: 'task-12345', ahead: 1 },
  ];
  const merge = { greeting: 'please merge', ticketServer: 'https://git.example/tickets' };
  assert.equal(mergeRequestText(issue, branches, 'https://rm.example', merge), [
    'please merge', '(test) fix login', 'https://rm.example/issues/12345',
    'https://git.example/tickets/app-a.git/212', 'app-b: task-12345',
  ].join('\n'));
  // no merge.json: default greeting, and ticket/<n> branches are written as repo: branch
  assert.deepEqual(mergeRequestText(issue, branches.slice(0, 1), 'https://rm.example').split('\n'),
    [MERGE_GREETING, '(test) fix login', 'https://rm.example/issues/12345', 'app-a: ticket/212']);
  assert.equal(mergeRequestText({ id: 5, subject: 's' }, [], 'https://rm.example/').split('\n')[2], 'https://rm.example/issues/5');
});

test('calendarDay: today\'s meetings with past / now / soon / later, and tomorrow', async () => {
  const { calendarDay } = await import('./office.js');
  const at = (h, m = 0, dd = 0) => new Date(2026, 9, 15 + dd, h, m).getTime();
  const now = at(10, 50);
  const cal = { configured: true, fetchedAt: now, calendars: [{ name: 'Work', error: null }, { name: 'Me', error: 'HTTP 401' }], events: [
    { start: at(0), end: at(0, 0, 1), allDay: true, title: 'Team day', location: null, cal: 0 },
    { start: at(9), end: at(9, 30), allDay: false, title: 'Standup', location: null, cal: 0 },
    { start: at(10, 30), end: at(11), allDay: false, title: 'Review', location: 'Room 2', cal: 0 },
    { start: at(11, 0), end: at(12), allDay: false, title: 'Planning', location: null, cal: 0 },
    { start: at(14), end: at(15), allDay: false, title: 'Retro', location: null, cal: 0 },
    { start: at(9, 0, 1), end: at(10, 0, 1), allDay: false, title: 'Tomorrow sync', location: null, cal: 0 },
  ] };
  const c = calendarDay(cal, now);
  assert.deepEqual(c.events.map((e) => [e.title, e.state]), [['Team day', 'allday'], ['Standup', 'past'], ['Review', 'now'], ['Planning', 'soon'], ['Retro', 'later']]);
  assert.equal(c.events[3].inMin, 10);
  assert.equal(c.next.title, 'Review');
  assert.equal(c.left, 3);
  assert.deepEqual(c.tomorrow.map((e) => e.title), ['Tomorrow sync']);
  assert.deepEqual(c.errors.map((e) => e.name), ['Me']);
  assert.equal(c.events[1].calName, 'Work');
  assert.equal(calendarDay({ configured: false }, now), null);
});

test('meetingsDue: timed meetings starting within the lead time, once each', async () => {
  const { meetingsDue, meetingKey } = await import('./office.js');
  const now = Date.UTC(2026, 9, 16, 3, 0);
  const m = (min, title, allDay = false) => ({ start: now + min * 60_000, end: now + (min + 30) * 60_000, allDay, title, cal: 0 });
  const cal = { configured: true, events: [m(-5, 'started'), m(3, 'soon'), m(5, 'edge'), m(6, 'later'), m(2, 'all', true)] };
  assert.deepEqual(meetingsDue(cal, now, 5).map((e) => e.title), ['soon', 'edge']);
  assert.deepEqual(meetingsDue(cal, now, 5, new Set([meetingKey(cal.events[1])])).map((e) => e.title), ['edge']);
  assert.deepEqual(meetingsDue(cal, now, 0), []);
  assert.deepEqual(meetingsDue(null, now, 5), []);
});
