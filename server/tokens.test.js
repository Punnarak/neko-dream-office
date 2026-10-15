// Unit tests for daily token bucketing, with hand-written JSONL in a temp dir (SIMULATED — not real transcripts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DailyTokens } from './tokens.js';

const U = (input, output, cc, cr) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cc, cache_read_input_tokens: cr });
const entry = (id, at, u, extra = {}) => JSON.stringify({
  type: 'assistant', requestId: `req-${id}`, timestamp: new Date(at).toISOString(), ...extra,
  message: { id, role: 'assistant', content: [{ type: 'text', text: 'SECRET reply words' }], usage: u },
}) + '\n';
const local = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const day = (snap, date) => snap.daily.find((d) => d.date === date);

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-tok-'));
  fs.mkdirSync(path.join(root, 'proj', 'sess1', 'subagents'), { recursive: true });
  return root;
}

test('buckets replies by local calendar day, around midnight', async () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'proj', 'sess1.jsonl'),
    entry('a', local(2026, 10, 13, 23, 59), U(1, 10, 100, 5000)) +
    entry('b', local(2026, 10, 14, 0, 1), U(2, 20, 200, 7000)) +
    JSON.stringify({ type: 'user', timestamp: new Date(local(2026, 10, 14)).toISOString(), message: { content: 'usage', usage: U(9e6, 0, 0, 0) } }) + '\n');
  const t = new DailyTokens({ root, now: () => local(2026, 10, 14, 15) });
  await t.refresh();
  const s = t.snapshot();
  assert.equal(s.daily.length, 28);
  assert.equal(s.daily.at(-1).date, '2026-10-14');
  assert.deepEqual(day(s, '2026-10-13'), { date: '2026-10-13', counted: 111, cacheRead: 5000 });
  assert.deepEqual(day(s, '2026-10-14'), { date: '2026-10-14', counted: 222, cacheRead: 7000 });
  assert.deepEqual(s.today, { counted: 222, cacheRead: 7000 });
  assert.equal(s.week.counted, 333);   // Mon 12 Oct – today
  assert.equal(s.month.counted, 333);
  assert.ok(!JSON.stringify(s).includes('SECRET'));
  fs.rmSync(root, { recursive: true });
});

test('UTC timestamps land on the local day (TZ=Asia/Bangkok, +07:00)', async () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Asia/Bangkok';
  try {
    const root = tmpRoot();
    // 17:30Z on the 13th is 00:30 on the 14th in Bangkok; 16:59Z is still 23:59 on the 13th
    const raw = (id, iso, n) => JSON.stringify({ type: 'assistant', timestamp: iso, message: { id, usage: U(n, 0, 0, 0) } }) + '\n';
    fs.writeFileSync(path.join(root, 'proj', 'x.jsonl'), raw('late', '2026-10-13T16:59:00Z', 5) + raw('early', '2026-10-13T17:30:00Z', 7));
    const t = new DailyTokens({ root, now: () => Date.parse('2026-10-14T05:00:00Z') });
    await t.refresh();
    const s = t.snapshot();
    assert.equal(day(s, '2026-10-13').counted, 5);
    assert.equal(day(s, '2026-10-14').counted, 7);
    fs.rmSync(root, { recursive: true });
  } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
});

test('dedupes a reply repeated in one file and copied into another (main + subagent / resumed session)', async () => {
  const root = tmpRoot();
  const at = local(2026, 10, 14, 9);
  fs.writeFileSync(path.join(root, 'proj', 'sess1.jsonl'), entry('m1', at, U(1, 2, 3, 4)).repeat(3) + entry('m2', at, U(10, 0, 0, 0)));
  fs.writeFileSync(path.join(root, 'proj', 'sess2.jsonl'), entry('m1', at, U(1, 2, 3, 4))); // resumed copy
  fs.writeFileSync(path.join(root, 'proj', 'sess1', 'subagents', 'agent-x.jsonl'), entry('s1', at, U(100, 0, 0, 0)));
  const t = new DailyTokens({ root, now: () => local(2026, 10, 14, 18) });
  await t.refresh();
  assert.deepEqual(t.snapshot().today, { counted: 116, cacheRead: 4 });
  fs.rmSync(root, { recursive: true });
});

test('incremental by byte offset; partial last line waits; old files and outside paths are skipped', async () => {
  const root = tmpRoot();
  const now = local(2026, 10, 14, 18);
  const file = path.join(root, 'proj', 'sess1.jsonl');
  const line2 = entry('m2', now - 1000, U(0, 50, 0, 0));
  fs.writeFileSync(file, entry('m1', now - 5000, U(0, 5, 0, 0)) + line2.slice(0, 30));
  // last modified 40 days ago -> skipped without reading
  const old = path.join(root, 'proj', 'old.jsonl');
  fs.writeFileSync(old, entry('o1', now, U(9999, 0, 0, 0)));
  fs.utimesSync(old, new Date(now - 40 * 864e5), new Date(now - 40 * 864e5));
  // a symlink pointing outside the root and a non-jsonl file are ignored
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-out-'));
  fs.writeFileSync(path.join(outside, 'evil.jsonl'), entry('e1', now, U(7777, 0, 0, 0)));
  fs.symlinkSync(path.join(outside, 'evil.jsonl'), path.join(root, 'proj', 'link.jsonl'));
  fs.writeFileSync(path.join(root, 'proj', 'notes.txt'), entry('n1', now, U(5555, 0, 0, 0)));

  const t = new DailyTokens({ root, now: () => now });
  await t.refresh();
  assert.equal(t.snapshot().today.counted, 5);
  const offset = t.files.get(fs.realpathSync(file)).offset;
  fs.appendFileSync(file, line2.slice(30));
  await t.refresh();
  assert.equal(t.snapshot().today.counted, 55);
  assert.ok(t.files.get(fs.realpathSync(file)).offset > offset);
  assert.equal(t.files.size, 1);
  fs.rmSync(root, { recursive: true });
  fs.rmSync(outside, { recursive: true });
});

test('replies older than the range are dropped; the range rolls over at local midnight; refreshIfDue throttles', async () => {
  const root = tmpRoot();
  let now = local(2026, 10, 14, 18);
  fs.writeFileSync(path.join(root, 'proj', 's.jsonl'),
    entry('old', local(2026, 8, 1), U(1000, 0, 0, 0)) + entry('d1', local(2026, 9, 17), U(1, 0, 0, 0)) + entry('d2', local(2026, 10, 14), U(2, 0, 0, 0)));
  const t = new DailyTokens({ root, now: () => now });
  await t.refresh();
  let s = t.snapshot();
  assert.equal(s.daily[0].date, '2026-09-17');
  assert.equal(s.daily[0].counted, 1);
  assert.equal(s.daily.reduce((n, d) => n + d.counted, 0), 3);
  assert.ok(!t.ids.has('old'));
  assert.equal(t.refreshIfDue(60_000), null); // just ran
  now = local(2026, 10, 15, 0, 5);
  s = t.snapshot();
  assert.equal(s.daily.at(-1).date, '2026-10-15');
  assert.equal(s.today.counted, 0);
  assert.equal(s.daily.reduce((n, d) => n + d.counted, 0), 2); // 17 Sep fell out of the 28 days
  fs.rmSync(root, { recursive: true });
});
