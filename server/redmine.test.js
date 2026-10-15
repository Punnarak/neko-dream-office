// Unit tests with hand-written Redmine payloads (not a live connection).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapIssue, loadConfig, summarizeTime, timeRange, lastActivityOf, RedmineFeed } from './redmine.js';

test('mapIssue keeps only display fields and drops description', () => {
  const raw = {
    id: 42, subject: 'Fix login', description: 'secret details', project: { id: 1, name: 'Shop' },
    tracker: { name: 'Bug' }, status: { name: 'New' }, priority: { id: 3, name: 'High' },
    due_date: '2026-10-20', updated_on: '2026-10-14T01:00:00Z', done_ratio: 40, journals: [{}],
  };
  const m = mapIssue(raw, 'https://rm.example');
  assert.deepEqual(Object.keys(m).sort(),
    ['doneRatio', 'dueDate', 'estimatedHours', 'id', 'priority', 'priorityId', 'project', 'spentHours', 'status', 'subject', 'tracker', 'updatedOn', 'url']);
  assert.equal(m.url, 'https://rm.example/issues/42');
  assert.equal(m.priorityId, 3);
  assert.ok(!JSON.stringify(m).includes('secret details'));
});

test('mapIssue trims long subjects, redacts secrets and rejects bad ids', () => {
  const m = mapIssue({ id: 7, subject: 'token=abcd1234efgh ' + 'x'.repeat(300), due_date: 'soon' }, 'u');
  assert.ok(m.subject.length <= 120);
  assert.ok(!m.subject.includes('abcd1234efgh'));
  assert.equal(m.dueDate, null);
  assert.equal(mapIssue({ id: 'x' }, 'u'), null);
});

test('loadConfig prefers env, falls back to file, else null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-rm-'));
  const file = path.join(dir, 'redmine.json');
  assert.equal(loadConfig({}, file), null);
  fs.writeFileSync(file, JSON.stringify({ url: 'https://f.example', apiKey: 'k' }), { mode: 0o600 });
  assert.equal(loadConfig({}, file).source, 'file');
  assert.equal(loadConfig({ REDMINE_URL: 'https://e.example', REDMINE_API_KEY: 'k' }, file).source, 'env');
  fs.rmSync(dir, { recursive: true });
});

test('summarizeTime sums today and this week and keeps a redacted log', () => {
  const now = new Date(2026, 9, 14, 15, 0); // Wednesday
  const t = summarizeTime([
    { spent_on: '2026-10-14', hours: 1.5, issue: { id: 5 }, comments: 'deploy password=hunter2', activity: { name: 'Dev' } },
    { spent_on: '2026-10-14', hours: 0.5, issue: { id: 5 } },
    { spent_on: '2026-10-14', hours: 1, issue: { id: 9 } },
    { spent_on: '2026-10-12', hours: 2 },             // Monday: week only
    { spent_on: '2026-10-11', hours: 8 },             // last Sunday: month/log only, not this week
    { spent_on: '2026-10-14', hours: 'x' },           // bad value: ignored
    { spent_on: '2026-10-15', hours: 4 },             // future: ignored
  ], now);
  assert.equal(t.weekStart, '2026-10-12');
  assert.equal(t.todayHours, 3);
  assert.equal(t.weekHours, 5);
  assert.deepEqual(t.todayByIssue, [{ issueId: 5, hours: 2 }, { issueId: 9, hours: 1 }]);
  assert.equal(t.monthHours, 13);
  assert.equal(t.log.length, 5);
  assert.equal(t.log[0].spentOn, '2026-10-14');
  assert.equal(t.log.at(-1).spentOn, '2026-10-11');
  assert.ok(!JSON.stringify(t).includes('hunter2'));
  assert.equal(t.log.find((l) => l.activity).activity, 'Dev');
});

test('summarizeTime daily covers 28 days, zero-filled, oldest first', () => {
  const now = new Date(2026, 9, 14, 9, 0);
  const t = summarizeTime([
    { spent_on: '2026-10-14', hours: 1 }, { spent_on: '2026-10-14', hours: 0.25 },
    { spent_on: '2026-09-17', hours: 3 },  // first day of the range
    { spent_on: '2026-09-16', hours: 5 },  // one day before the range: not in daily or month
  ], now);
  assert.equal(t.daily.length, 28);
  assert.equal(t.rangeStart, '2026-09-17');
  assert.deepEqual(t.daily[0], { date: '2026-09-17', hours: 3 });
  assert.deepEqual(t.daily.at(-1), { date: '2026-10-14', hours: 1.25 });
  assert.equal(t.daily.filter((d) => d.hours === 0).length, 26);
  assert.equal(new Set(t.daily.map((d) => d.date)).size, 28);
  assert.equal(t.monthHours, 1.25);
  assert.equal(t.todayHours, 1.25);
  assert.deepEqual(summarizeTime([], now).daily.map((d) => d.hours), Array(28).fill(0));
});

test('summarizeTime month and week boundaries', () => {
  // Thursday 1 Oct 2026: week started in September, month started today.
  const t = summarizeTime([
    { spent_on: '2026-10-01', hours: 2 },
    { spent_on: '2026-09-30', hours: 3 },  // Wednesday: this week, last month
    { spent_on: '2026-09-28', hours: 1 },  // Monday: this week
    { spent_on: '2026-09-27', hours: 7 },  // Sunday before: neither
  ], new Date(2026, 9, 1, 12));
  assert.equal(t.weekStart, '2026-09-28');
  assert.equal(t.monthStart, '2026-10-01');
  assert.equal(t.weekHours, 6);
  assert.equal(t.monthHours, 2);
  assert.equal(t.todayHours, 2);
  // Monday → week is just today.
  const m = summarizeTime([{ spent_on: '2026-10-12', hours: 4 }, { spent_on: '2026-10-11', hours: 4 }], new Date(2026, 9, 12));
  assert.equal(m.weekStart, '2026-10-12');
  assert.equal(m.weekHours, 4);
  assert.equal(m.monthHours, 8);
});

test('timeRange reaches back to month start when it is older than 28 days', () => {
  const r = timeRange(new Date(2026, 9, 31)); // Saturday 31 Oct
  assert.equal(r.rangeStart, '2026-10-04');
  assert.equal(r.monthStart, '2026-10-01');
  assert.equal(r.from, '2026-10-01');
  const t = summarizeTime([{ spent_on: '2026-10-01', hours: 2 }, { spent_on: '2026-10-31', hours: 1 }], new Date(2026, 9, 31));
  assert.equal(t.monthHours, 3);
  assert.equal(t.daily[0].date, '2026-10-04');
  assert.equal(t.log.length, 2);
  // Crossing a year boundary.
  const y = timeRange(new Date(2027, 0, 2));
  assert.equal(y.rangeStart, '2026-12-06');
  assert.equal(y.weekStart, '2026-12-28');
  assert.equal(y.from, '2026-12-06');
});

test('summarizeTime caps the log', () => {
  const now = new Date(2026, 9, 14);
  const many = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, spent_on: '2026-10-13', hours: 0.1 }));
  const t = summarizeTime(many, now);
  assert.equal(t.log.length, 300);
  assert.equal(t.logTotal, 400);
  assert.equal(t.daily.at(-2).hours, 40);
});

// ---- "มีอัปเดต": newest journal + issues that left my list (hand-written fake payloads, no live Redmine) ----

test('lastActivityOf keeps only time, byMe and kinds — never notes, values or names', () => {
  const issue = {
    id: 5, created_on: '2026-10-01T00:00:00Z', author: { id: 9, name: 'Somchai' },
    journals: [
      { id: 1, user: { id: 7, name: 'Me' }, created_on: '2026-10-02T00:00:00Z', notes: 'old', details: [] },
      { id: 2, user: { id: 9, name: 'Somchai' }, created_on: '2026-10-03T00:00:00Z', notes: 'password=hunter2 please check',
        details: [{ property: 'attr', name: 'status_id', old_value: '1', new_value: '2' },
          { property: 'attr', name: 'assigned_to_id', old_value: '3', new_value: '7' },
          { property: 'attachment', name: '12', new_value: 'secret.pdf' }] },
    ],
  };
  const a = lastActivityOf(issue, 7);
  assert.deepEqual(a, { at: '2026-10-03T00:00:00Z', byMe: false, kinds: ['comment', 'assignee', 'status', 'other'] });
  const text = JSON.stringify(a);
  for (const bad of ['hunter2', 'Somchai', 'secret.pdf', 'please']) assert.ok(!text.includes(bad), bad);
  assert.equal(lastActivityOf(issue, 9).byMe, true);
  assert.equal(lastActivityOf(issue, null).byMe, null); // my id unknown
});

test('lastActivityOf: priority/due, empty notes, no journals', () => {
  const j = (details, notes = '') => ({ journals: [{ user: { id: 1 }, created_on: '2026-10-05T00:00:00Z', notes, details }] });
  assert.deepEqual(lastActivityOf(j([{ property: 'attr', name: 'priority_id' }, { property: 'attr', name: 'due_date' }], '  '), 1).kinds, ['priority', 'due']);
  assert.deepEqual(lastActivityOf(j([]), 1).kinds, ['other']);
  assert.deepEqual(lastActivityOf({ created_on: '2026-10-01T00:00:00Z', author: { id: 1 }, journals: [] }, 1),
    { at: '2026-10-01T00:00:00Z', byMe: true, kinds: ['other'] });
  assert.equal(lastActivityOf({}, 1), null);
});

// A feed whose HTTP calls are answered by a fake Redmine held in memory.
function fakeFeed(rm) {
  const feed = new RedmineFeed({ config: { url: 'https://rm.example', apiKey: 'k' } });
  feed.calls = [];
  feed.fetchTime = async () => null;
  feed.get = async (p) => {
    feed.calls.push(p);
    if (p === '/users/current.json') return { user: { id: 7, login: 'me', mail: 'me@x', api_key: 'zzz' } };
    if (p.startsWith('/issues.json')) return { issues: rm.list.map(({ journals, ...i }) => i), total_count: rm.total ?? rm.list.length };
    const m = p.match(/^\/issues\/(\d+)\.json\?include=journals$/);
    if (m) return { issue: rm.list.find((i) => i.id === Number(m[1])) };
    throw new Error('unexpected ' + p);
  };
  return feed;
}
const fakeIssue = (id, updated, journals = []) => ({ id, subject: `S${id}`, updated_on: updated, created_on: '2026-09-01T00:00:00Z', author: { id: 7 }, journals });
const detailCalls = (f) => f.calls.filter((c) => /^\/issues\/\d+/.test(c)).length;

test('fake Redmine: first refresh reads only the 10 most recently updated, then only changed issues', async () => {
  const rm = { list: Array.from({ length: 14 }, (_, n) => fakeIssue(100 + n, `2026-10-${String(14 - n).padStart(2, '0')}T00:00:00Z`)) };
  const f = fakeFeed(rm);
  await f.refresh();
  assert.equal(detailCalls(f), 10);
  assert.equal(f.calls.filter((c) => c === '/users/current.json').length, 1);
  assert.equal(f.data.issues.filter((i) => i.lastActivity).length, 10);
  assert.equal(f.myId, 7);
  assert.ok(!JSON.stringify(f.data).includes('zzz') && !JSON.stringify(f.data).includes('me@x'));

  // nothing changed: no detail requests, cached activity stays
  f.calls = [];
  await f.refresh();
  assert.equal(detailCalls(f), 0);
  assert.equal(f.data.issues.filter((i) => i.lastActivity).length, 10);

  // someone else comments on #113 (was never read): only that one is fetched, users/current is not asked again
  rm.list[13] = fakeIssue(113, '2026-10-15T00:00:00Z', [{ user: { id: 9 }, created_on: '2026-10-15T00:00:00Z', notes: 'hi', details: [] }]);
  f.calls = [];
  await f.refresh();
  assert.deepEqual(f.calls.filter((c) => !c.startsWith('/issues.json')), ['/issues/113.json?include=journals']);
  assert.deepEqual(f.data.issues.find((i) => i.id === 113).lastActivity, { at: '2026-10-15T00:00:00Z', byMe: false, kinds: ['comment'] });
});

test('fake Redmine: issues that leave my list are reported as gone for 24 h', async () => {
  const rm = { list: [fakeIssue(1, '2026-10-14T00:00:00Z'), fakeIssue(2, '2026-10-13T00:00:00Z')] };
  const f = fakeFeed(rm);
  await f.refresh();
  assert.deepEqual(f.data.gone, []);
  rm.list = [rm.list[0]];
  await f.refresh();
  assert.deepEqual(f.data.gone.map(({ id, subject }) => ({ id, subject })), [{ id: 2, subject: 'S2' }]);
  // back in the list → no longer gone; and old entries expire
  rm.list.push(fakeIssue(2, '2026-10-15T00:00:00Z'));
  await f.refresh();
  assert.deepEqual(f.data.gone, []);
  f.data.gone = [{ id: 3, subject: 'S3', at: Date.now() - 25 * 3600_000 }];
  await f.refresh();
  assert.deepEqual(f.data.gone, []);
});

test('fake Redmine: no gone report when the list is cut at 50', async () => {
  const rm = { list: [fakeIssue(1, '2026-10-14T00:00:00Z'), fakeIssue(2, '2026-10-13T00:00:00Z')], total: 80 };
  const f = fakeFeed(rm);
  await f.refresh();
  rm.list = [rm.list[0]];
  await f.refresh();
  assert.deepEqual(f.data.gone, []);
});

test('fake Redmine: a failing detail request is retried later and never breaks the list', async () => {
  const rm = { list: [fakeIssue(1, '2026-10-14T00:00:00Z')] };
  const f = fakeFeed(rm);
  const realGet = f.get;
  f.get = async (p) => { if (p.startsWith('/issues/1.json')) throw new Error('HTTP 403'); return realGet(p); };
  await f.refresh();
  assert.equal(f.data.error, null);
  assert.equal(f.data.issues[0].lastActivity, null);
  f.get = realGet;
  await f.refresh();
  assert.ok(f.data.issues[0].lastActivity);
});

test('summarizeTime marks days with "Leave" activity as leaveDays (hours still in totals, no comments)', () => {
  const now = new Date(2026, 9, 14, 15, 0); // Wednesday
  const t = summarizeTime([
    { spent_on: '2026-10-13', hours: 4, activity: { name: 'Leave' }, comments: 'ลาป่วย secret' },
    { spent_on: '2026-10-13', hours: 4, activity: { name: 'Leave' } },
    { spent_on: '2026-10-12', hours: 8, activity: { name: 'Development' } },
    { spent_on: '2026-10-09', hours: 2, activity: { name: 'leave' } },   // case differs: not leave (same as is_leave)
    { spent_on: '2026-10-01', hours: 8, activity: { name: 'Leave' } },   // month start: still in range
    { spent_on: '2026-10-15', hours: 8, activity: { name: 'Leave' } },   // future: ignored
    { spent_on: '2026-10-07', hours: 'x', activity: { name: 'Leave' } }, // bad hours: ignored
  ], now);
  assert.deepEqual(t.leaveDays, [{ date: '2026-10-01', hours: 8 }, { date: '2026-10-13', hours: 8 }]);
  assert.equal(t.weekHours, 16);   // leave hours stay in the totals
  assert.equal(t.daily.find((d) => d.date === '2026-10-13').hours, 8);
  assert.ok(!JSON.stringify(t.leaveDays).includes('secret'));
  assert.deepEqual(summarizeTime([], now).leaveDays, []);
});
