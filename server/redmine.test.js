// Unit tests with hand-written Redmine payloads (not a live connection).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapIssue, loadConfig, summarizeTime, timeRange } from './redmine.js';

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
