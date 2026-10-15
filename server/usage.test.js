// Unit tests for the transcript usage parser and path guard, with hand-written JSONL lines.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newUsageAcc, parseUsageChunk, usageTotals, safeTranscriptPath, subagentTranscript, UsageTracker } from './usage.js';
import { OfficeState } from './state.js';

const line = (id, u, extra = {}) => JSON.stringify({
  type: 'assistant', requestId: `req-${id}`, ...extra,
  message: { id, role: 'assistant', content: [{ type: 'text', text: 'SECRET prompt words' }], usage: u },
}) + '\n';
const U = (input, output, cc, cr) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, service_tier: 'standard' });

test('dedupes repeated entries of one reply by message.id', () => {
  const acc = newUsageAcc();
  // one reply split into 3 content-block entries, each repeating the same usage
  parseUsageChunk(acc, line('m1', U(10, 100, 1000, 50000)).repeat(3) + line('m2', U(5, 20, 0, 60000)));
  const t = usageTotals(acc);
  assert.equal(t.messages, 2);
  assert.equal(t.input, 15);
  assert.equal(t.output, 120);
  assert.equal(t.cacheCreation, 1000);
  assert.equal(t.cacheRead, 110000);
});

test('total excludes cache_read', () => {
  const acc = parseUsageChunk(newUsageAcc(), line('m1', U(1, 2, 3, 999999)));
  assert.equal(usageTotals(acc).total, 6);
});

test('falls back to requestId when message.id is missing; ignores non-assistant and junk', () => {
  const noId = JSON.stringify({ type: 'assistant', requestId: 'r9', message: { usage: U(1, 1, 0, 0) } }) + '\n';
  const user = JSON.stringify({ type: 'user', message: { usage: U(500, 500, 0, 0), content: 'usage' } }) + '\n';
  const acc = parseUsageChunk(newUsageAcc(), noId + noId + user + '{"usage": broken\n' + 'not json "usage"\n');
  assert.deepEqual([usageTotals(acc).messages, usageTotals(acc).total], [1, 2]);
});

test('ignores negative, non-numeric and missing fields', () => {
  const acc = parseUsageChunk(newUsageAcc(), line('m1', { input_tokens: -5, output_tokens: '9', cache_creation_input_tokens: 7 }));
  assert.equal(usageTotals(acc).total, 7);
});

test('keeps a partial last line until it is completed', () => {
  const full = line('m1', U(1, 10, 0, 0));
  const acc = newUsageAcc();
  parseUsageChunk(acc, full.slice(0, 40));
  assert.equal(usageTotals(acc).messages, 0);
  parseUsageChunk(acc, full.slice(40, -1)); // still no newline
  assert.equal(usageTotals(acc).messages, 0);
  parseUsageChunk(acc, '\n');
  assert.equal(usageTotals(acc).total, 11);
});

test('keeps only numbers — no content survives in the accumulator or totals', () => {
  const acc = parseUsageChunk(newUsageAcc(), line('m1', U(1, 2, 3, 4)));
  assert.ok(!JSON.stringify([...acc.byId.values(), usageTotals(acc)]).includes('SECRET'));
});

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-usage-'));
  const root = path.join(dir, 'projects');
  fs.mkdirSync(path.join(root, 'proj', 'sess', 'subagents'), { recursive: true });
  return { dir, root };
}

test('path guard: only .jsonl files whose real path is inside root', () => {
  const { dir, root } = tmpRoot();
  const ok = path.join(root, 'proj', 'sess.jsonl');
  fs.writeFileSync(ok, '');
  const outside = path.join(dir, 'outside.jsonl');
  fs.writeFileSync(outside, '');
  const notJsonl = path.join(root, 'proj', 'x.txt');
  fs.writeFileSync(notJsonl, '');
  const link = path.join(root, 'proj', 'link.jsonl');
  fs.symlinkSync(outside, link);
  const linkToTxt = path.join(root, 'proj', 'txt.jsonl');
  fs.symlinkSync(notJsonl, linkToTxt);

  assert.equal(safeTranscriptPath(ok, root), fs.realpathSync(ok));
  assert.equal(safeTranscriptPath(outside, root), null);
  assert.equal(safeTranscriptPath(notJsonl, root), null);
  assert.equal(safeTranscriptPath(link, root), null, 'symlink pointing outside root');
  assert.equal(safeTranscriptPath(linkToTxt, root), null, 'symlink to a non-.jsonl file');
  assert.equal(safeTranscriptPath(path.join(root, 'proj', '..', '..', 'outside.jsonl'), root), null);
  assert.equal(safeTranscriptPath(path.join(root, 'proj', 'missing.jsonl'), root), null);
  assert.equal(safeTranscriptPath(path.join(root, 'proj'), root), null);
  assert.equal(safeTranscriptPath(undefined, root), null);
  assert.equal(safeTranscriptPath({}, root), null);
});

test('subagent transcript path is derived from the main one; bad agent ids are refused', () => {
  assert.equal(subagentTranscript('/r/p/sess.jsonl', 'a1b2'), path.join('/r/p/sess', 'subagents', 'agent-a1b2.jsonl'));
  assert.equal(subagentTranscript('/r/p/sess.jsonl', '../../x'), null);
  assert.equal(subagentTranscript('/r/p/sess.txt', 'a1'), null);
});

test('tracker reads incrementally, handles a growing partial line, and reports changes', async () => {
  const { root } = tmpRoot();
  const file = path.join(root, 'proj', 'sess.jsonl');
  const a = line('m1', U(1, 10, 100, 5000));
  const b = line('m2', U(2, 20, 200, 6000));
  fs.writeFileSync(file, a + b.slice(0, 30));
  const updates = [];
  const tracker = new UsageTracker({ root, minIntervalMs: 0, onUpdate: (...args) => updates.push(args) });
  assert.equal(tracker.track('S', 'main', file), true);
  assert.equal(tracker.track('S', 'main', path.join(root, '..', 'nope.jsonl')), false);
  const real = fs.realpathSync(file);
  await tracker.readNow(real);
  assert.equal(tracker.get(real).total, 111);
  fs.appendFileSync(file, b.slice(30) + a); // completes m2, then m1 repeated (dedupe)
  await tracker.readNow(real);
  assert.equal(tracker.get(real).total, 333);
  assert.equal(tracker.get(real).cacheRead, 11000);
  assert.deepEqual(updates.map(([s, k, t]) => [s, k, t.total]), [['S', 'main', 111], ['S', 'main', 333]]);
  tracker.stop();
});

test('state attaches usage to the right agent and keeps it when SubagentStart repeats', () => {
  const st = new OfficeState(() => 1000);
  st.apply({ hook_event_name: 'SessionStart', session_id: 'S', cwd: '/p' });
  st.apply({ hook_event_name: 'SubagentStart', session_id: 'S', agent_id: 'a1', agent_type: 'Explore' });
  const totals = { total: 30, input: 1, output: 9, cacheCreation: 20, cacheRead: 999, messages: 2 };
  assert.ok(st.setUsage('S', 'a1', totals));
  assert.ok(st.setUsage('S', 'main', { ...totals, total: 7 }));
  assert.equal(st.setUsage('S', 'ghost', totals), null);
  assert.equal(st.setUsage('nope', 'main', totals), null);
  st.apply({ hook_event_name: 'SubagentStart', session_id: 'S', agent_id: 'a1', agent_type: 'Explore' });
  const agents = st.snapshot().sessions[0].agents;
  assert.equal(agents.find((a) => a.main).usage.total, 7);
  assert.equal(agents.find((a) => a.id === 'a1').usage.total, 30);
  st.apply({ hook_event_name: 'SubagentStart', session_id: 'S', agent_id: 'a2', agent_type: 'Plan' });
  assert.equal(st.snapshot().sessions[0].agents.find((a) => a.id === 'a2').usage, null, 'unknown stays null');
});
