// Unit tests with a fake clock and a fake git (no real repos). Only a temp file is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeTime, promptTicket, branchTicket, gitTicket, mergeInterval } from './claudetime.js';

const MIN = 60_000;
const T0 = new Date(2026, 9, 15, 9, 0).getTime(); // 15 Oct 2026 09:00 local

function setup({ git = async () => null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-ct-'));
  let t = T0;
  const tickets = [];
  const ct = new ClaudeTime({ file: path.join(dir, 'ct.json'), now: () => t, git, onTicket: (id, tk) => tickets.push([id, tk]), saveDelayMs: 1e9, notifyDelayMs: 1e9 });
  const ev = (minutes, event, status, extra = {}) => {
    t = T0 + minutes * MIN;
    ct.observe({ hook_event_name: event, ...extra }, { id: extra.sid || 's1', project: 'proj', status });
  };
  return { ct, ev, tickets, dir, file: path.join(dir, 'ct.json') };
}
const day = (ct, date = '2026-10-15') => ct.snapshot().days.find((d) => d.date === date)?.items ?? [];

test('promptTicket: Redmine wording, URLs and lead-ins; short numbers are not tickets', () => {
  assert.equal(promptTicket('ตรวจสอบ Redmine #104498'), 104498);
  assert.equal(promptTicket('ดู https://redmine.example/issues/105123 หน่อย'), 105123);
  assert.equal(promptTicket('Task #98765: fix'), 98765);
  assert.equal(promptTicket('แก้ bug บรรทัด #42'), null);
  assert.equal(promptTicket('ticket 1022'), null);
  assert.equal(promptTicket(undefined), null);
});

test('branchTicket: 5–6 digit numbers only', () => {
  assert.equal(branchTicket('task-104421'), 104421);
  assert.equal(branchTicket('feature/REDMIND-98765-login'), 98765);
  assert.equal(branchTicket('ticket/1022'), null);
  assert.equal(branchTicket('release/20260101'), null);
});

test('gitTicket: branch first, newest commit only on a non-default branch', async () => {
  const fake = (branch, subject) => async (_cwd, args) => (args[0] === 'rev-parse' ? branch : subject);
  assert.deepEqual(await gitTicket('/r', fake('task-104421', 'Task #99999: x')), { id: 104421, source: 'branch' });
  assert.deepEqual(await gitTicket('/r', fake('ticket/212', 'Task #104498: x')), { id: 104498, source: 'commit' });
  assert.equal(await gitTicket('/r', fake('master', 'Task #104498: x')), null);
  assert.equal(await gitTicket('/r', fake(null, null)), null);
});

test('mergeInterval keeps disjoint intervals sorted and merges overlaps', () => {
  let l = mergeInterval([], 10, 20);
  l = mergeInterval(l, 30, 40);
  l = mergeInterval(l, 0, 5);
  assert.deepEqual(l, [[0, 5], [10, 20], [30, 40]]);
  assert.deepEqual(mergeInterval(l, 15, 32), [[0, 5], [10, 40]]);
});

test('counts only working/tool time, under the prompt ticket', () => {
  const { ct, ev, tickets } = setup();
  ev(0, 'SessionStart', 'idle');
  ev(1, 'UserPromptSubmit', 'working', { prompt: 'ตรวจสอบ Redmine #104498' });
  ev(3, 'PreToolUse', 'tool');
  ev(6, 'PostToolUse', 'working');
  ev(10, 'Stop', 'completed');
  ev(40, 'UserPromptSubmit', 'working', { prompt: 'ต่อเลย' }); // idle 10→40 not counted; ticket sticks
  ev(45, 'Notification', 'waiting');
  ev(55, 'PostToolUse', 'working'); // waiting for you 45→55 not counted
  ev(57, 'Stop', 'completed');
  assert.deepEqual(day(ct), [{ ticket: 104498, project: null, ms: (9 + 5 + 2) * MIN }]);
  assert.deepEqual(tickets, [['s1', { id: 104498, source: 'prompt' }]]);
  assert.deepEqual(ct.ticketOf('s1'), { id: 104498, source: 'prompt' });
});

test('no ticket: counted under the project; a silent gap is capped', () => {
  const { ct, ev } = setup();
  ev(0, 'UserPromptSubmit', 'working', { prompt: 'hi' });
  ev(60, 'Stop', 'completed'); // an hour without events counts 15 min
  assert.deepEqual(day(ct), [{ ticket: null, project: 'proj', ms: 15 * MIN }]);
});

test('two sessions on the same ticket at the same time count once', () => {
  const { ct, ev } = setup();
  ev(0, 'UserPromptSubmit', 'working', { sid: 'a', prompt: '#104498' });
  ev(0, 'UserPromptSubmit', 'working', { sid: 'b', prompt: '#104498' });
  ev(5, 'PostToolUse', 'working', { sid: 'a' });
  ev(8, 'Stop', 'completed', { sid: 'b' });
  ev(10, 'Stop', 'completed', { sid: 'a' });
  assert.deepEqual(day(ct), [{ ticket: 104498, project: null, ms: 10 * MIN }]);
});

test('work across midnight is split between the two days', () => {
  const { ct, ev } = setup();
  const toMidnight = (new Date(2026, 9, 16).getTime() - T0) / MIN; // 900 minutes
  ev(toMidnight - 5, 'UserPromptSubmit', 'working', { prompt: '#104498' });
  ev(toMidnight + 3, 'Stop', 'completed');
  assert.equal(day(ct, '2026-10-15')[0].ms, 5 * MIN);
  assert.equal(day(ct, '2026-10-16')[0].ms, 3 * MIN);
});

test('git branch ticket arrives asynchronously and is reported', async () => {
  const { ct, ev, tickets } = setup({ git: async (_c, args) => (args[0] === 'rev-parse' ? 'task-104421' : '') });
  ev(0, 'SessionStart', 'idle', { cwd: '/repo' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ct.ticketOf('s1'), { id: 104421, source: 'branch' });
  assert.deepEqual(tickets, [['s1', { id: 104421, source: 'branch' }]]);
  ev(1, 'UserPromptSubmit', 'working', { cwd: '/repo', prompt: 'go' });
  ev(4, 'Stop', 'completed', { cwd: '/repo' });
  assert.deepEqual(day(ct), [{ ticket: 104421, project: null, ms: 3 * MIN }]);
  assert.deepEqual(ct.ticketIds(), [104421]);
});

test('saves numbers only and loads them back', () => {
  const { ct, ev, file } = setup();
  ev(0, 'UserPromptSubmit', 'working', { prompt: 'ตรวจสอบ Redmine #104498 password=hunter2' });
  ev(7, 'Stop', 'completed');
  ct.flush();
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('hunter2') && !text.includes('Redmine'));
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  const again = new ClaudeTime({ file, now: () => T0 + 10 * MIN });
  again.load();
  assert.deepEqual(day(again), [{ ticket: 104498, project: null, ms: 7 * MIN }]);
});

test('load ignores malformed data and days older than 35 days', () => {
  const { file } = setup();
  fs.writeFileSync(file, JSON.stringify({ days: {
    '2026-10-14': { 104498: [[1, 2], ['x', 3], [5, 4]], 'bad key': [[1, 2]] },
    '2026-08-01': { 104498: [[1, 2]] },
    nope: {},
  } }));
  const ct = new ClaudeTime({ file, now: () => T0 });
  ct.load();
  assert.deepEqual(ct.snapshot().days, [{ date: '2026-10-14', items: [{ ticket: 104498, project: null, ms: 1 }] }]);
});
