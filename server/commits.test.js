// Unit tests with hand-written git log text and time entries (no real repos, no Redmine).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractTickets, groupCommits, matchCommits, loadGitConfig, scanCommits } from './commits.js';

test('extractTickets reads the commit styles used in our repos', () => {
  assert.deepEqual(extractTickets('Task #104498: ET001 NEWCASE #ai-work'), [104498]);
  assert.deepEqual(extractTickets('Defect #106873 : [SIT][OPay#5][PO] ข้อความไม่ตรง FS'), [106873]);
  assert.deepEqual(extractTickets('REDMIND-87507,89635 [add] x'), [87507, 89635]);
  assert.deepEqual(extractTickets('REDMIND-[88371,88303,88301] process'), [88371, 88303, 88301]);
  assert.deepEqual(extractTickets('REDMIND-88371 , 88303,88301 process'), [88371, 88303, 88301]);
  assert.deepEqual(extractTickets('Task # 85804,85805 [income] config'), [85804, 85805]);
  assert.deepEqual(extractTickets('#93602[New Loan]LoanWsLoanRegisterV1ESBService (new service)'), [93602]);
  assert.deepEqual(extractTickets('[#97472][SIT][OPay#5] #ai-work ลงชื่อผู้กดปุ่ม'), [97472]);
  assert.deepEqual(extractTickets('#97476 FR-036 : แยกไฟล์'), [97476]);
});

test('extractTickets ignores numbers without a lead-in and never slices longer numbers', () => {
  assert.deepEqual(extractTickets('Task #104421 : flag ตาม review #42 #ai-work'), [104421]);
  assert.deepEqual(extractTickets('fix kafka config 20250263'), []);
  assert.deepEqual(extractTickets('Task 20250263 UR code'), []);
  assert.deepEqual(extractTickets('Task #12 too short'), []);
  assert.deepEqual(extractTickets('#3141'), []);
  assert.deepEqual(extractTickets('fix OPay#55555 typo'), []);
  assert.deepEqual(extractTickets(null), []);
});

test('groupCommits dedupes branches, filters on author day and counts commits without a ticket', () => {
  const logs = [
    { repo: 'a', text: '2026-10-14|Task #1001: x\n2026-10-14|Task #1001: x\n2026-10-15|Task #1001: y\n2026-08-01|Task #1001: old rebased\n2026-10-15|no ticket here\n' },
    { repo: 'b', text: '2026-10-13|Defect #1001 : z\n2026-10-13|Task #2002,2003 both\nnot a log line\n' },
  ];
  const { tickets, noTicket } = groupCommits(logs, '2026-10-01', '2026-10-15');
  assert.equal(noTicket, 1);
  const t = tickets.get(1001);
  assert.equal(t.commits, 3);
  assert.deepEqual([...t.repos].sort(), ['a', 'b']);
  assert.deepEqual([...t.days].sort(), ['2026-10-13', '2026-10-14', '2026-10-15']);
  assert.equal(tickets.get(2002).commits, 1);
  assert.equal(tickets.get(2003).commits, 1);
});

test('matchCommits flags tickets with no log; any log in the range counts', () => {
  const scan = {
    tickets: new Map([
      [1, { repos: new Set(['a']), commits: 2, days: new Set(['2026-10-10', '2026-10-14']) }], // logged 10th only
      [2, { repos: new Set(['a']), commits: 1, days: new Set(['2026-10-12']) }],               // never logged
      [3, { repos: new Set(['b']), commits: 1, days: new Set(['2026-10-12']) }],               // logged later
    ]),
    noTicket: 4, scanned: 2, missing: ['gone'],
  };
  const entries = [
    { issue: { id: 1 }, hours: 3, spent_on: '2026-10-10' },
    { issue: { id: 3 }, hours: 1.5, spent_on: '2026-10-12' },
    { issue: { id: 3 }, hours: 2, spent_on: '2026-10-13' },
    { issue: { id: 9 }, hours: 8, spent_on: '2026-10-13' }, // logged, no commit: not part of this list
    { hours: 1, spent_on: '2026-10-13' },                   // no issue
  ];
  const r = matchCommits(scan, entries);
  assert.deepEqual(r.tickets.map((t) => [t.id, t.state]), [[2, 'none'], [1, 'ok'], [3, 'ok']]);
  const three = r.tickets.find((t) => t.id === 3);
  assert.equal(three.hours, 3.5);
  assert.equal(three.loggedDays, 2);
  assert.equal(three.lastLog, '2026-10-13');
  assert.equal(r.total, 3);
  assert.equal(r.noTicket, 4);
  assert.deepEqual(r.missing, ['gone']);
});

test('matchCommits output carries no commit subjects', () => {
  const logs = [{ repo: 'a', text: '2026-10-14|Task #1001: password=hunter2 secret stuff\n' }];
  const r = matchCommits({ ...groupCommits(logs, '2026-10-01', '2026-10-15'), scanned: 1, missing: [] }, []);
  assert.ok(!JSON.stringify(r).includes('hunter2'));
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('loadGitConfig prefers git.json, falls back to the report config, needs author + repos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-git-'));
  const own = path.join(dir, 'git.json');
  const report = path.join(dir, 'report.json');
  fs.writeFileSync(report, JSON.stringify({ employee: 'x', git_author: 'me.x', repos: ['/r/one/', 3, '/r/two'] }));
  assert.deepEqual(loadGitConfig([[own, 'file'], [report, 'dev-work-report']]),
    { author: 'me.x', repos: ['/r/one', '/r/two'], source: 'dev-work-report' });
  fs.writeFileSync(own, JSON.stringify({ author: 'mine', repos: [] }));
  assert.equal(loadGitConfig([[own, 'file']]), null);
  fs.writeFileSync(own, JSON.stringify({ author: 'mine', repos: ['/r/x'] }));
  assert.equal(loadGitConfig([[own, 'file'], [report, 'dev-work-report']]).source, 'file');
  fs.rmSync(dir, { recursive: true });
});

test('scanCommits reads a real temporary repo and reports missing ones by folder name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-repo-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-14T10:00:00', GIT_COMMITTER_DATE: '2026-10-14T10:00:00' } });
  git('init', '-q');
  git('-c', 'user.name=Neko Test', '-c', 'user.email=neko@test', 'commit', '-q', '--allow-empty', '-m', 'Task #5555: hello');
  git('-c', 'user.name=Someone Else', '-c', 'user.email=else@test', 'commit', '-q', '--allow-empty', '-m', 'Task #6666: not mine');
  const r = await scanCommits({ author: 'neko@test', repos: [dir, path.join(dir, 'nope')] }, '2026-10-01', '2026-10-15');
  assert.deepEqual([...r.tickets.keys()], [5555]);
  assert.equal(r.scanned, 1);
  assert.deepEqual(r.missing, ['nope']);
  fs.rmSync(dir, { recursive: true });
});
