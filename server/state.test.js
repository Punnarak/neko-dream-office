// Unit tests with hand-written hook payloads. These check the mapping logic only;
// the live end-to-end check is done against a real Claude Code session (see README).

import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficeState } from './state.js';
import { clean, summarizeTool } from './sanitize.js';

const base = (event, extra = {}) => ({ hook_event_name: event, session_id: 'S1', cwd: '/home/u/proj', ...extra });

test('event sequence drives status', () => {
  const st = new OfficeState();
  assert.equal(st.apply(base('SessionStart', { source: 'startup' })).session.status, 'idle');
  assert.equal(st.apply(base('UserPromptSubmit', { prompt: 'secret plan' })).session.status, 'working');
  const pre = st.apply(base('PreToolUse', { tool_name: 'Edit', tool_use_id: 'a', tool_input: { file_path: '/x/y/app.js' } }));
  assert.equal(pre.session.status, 'tool');
  assert.equal(pre.session.tools[0].summary, 'app.js');
  assert.equal(st.apply(base('PostToolUse', { tool_name: 'Edit', tool_use_id: 'a', tool_response: 'BIG' })).session.status, 'working');
  st.apply(base('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'npm test' } }));
  const fail = st.apply(base('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'b', error: 'exit 1' }));
  assert.equal(fail.session.status, 'error');
  assert.equal(fail.session.lastError.message, 'exit 1');
  assert.equal(st.apply(base('Stop')).session.status, 'completed');
  assert.equal(st.apply(base('SessionEnd', { reason: 'prompt_input_exit' })).session.status, 'stopped');
});

test('prompt text and tool output never reach the snapshot', () => {
  const st = new OfficeState();
  st.apply(base('UserPromptSubmit', { prompt: 'my password is hunter2' }));
  st.apply(base('PostToolUse', { tool_name: 'Read', tool_response: { content: 'TOPSECRETFILE' } }));
  const json = JSON.stringify(st.snapshot());
  assert.ok(!json.includes('hunter2'));
  assert.ok(!json.includes('TOPSECRETFILE'));
});

test('sessions stay separate', () => {
  const st = new OfficeState();
  st.apply(base('PreToolUse', { tool_name: 'Read', tool_use_id: 'r' }));
  st.apply({ ...base('Stop'), session_id: 'S2' });
  const snap = st.snapshot();
  assert.equal(snap.sessions.length, 2);
  assert.equal(snap.sessions.find((s) => s.id === 'S1').status, 'tool');
  assert.equal(snap.sessions.find((s) => s.id === 'S2').status, 'completed');
});

test('unknown events and missing session ids are ignored', () => {
  const st = new OfficeState();
  assert.equal(st.apply({ hook_event_name: 'Bogus', session_id: 'x' }), null);
  assert.equal(st.apply({ hook_event_name: 'Stop' }), null);
  assert.equal(st.snapshot().sessions.length, 0);
});

test('interrupt is not reported as an error', () => {
  const st = new OfficeState();
  const r = st.apply(base('PostToolUseFailure', { tool_name: 'Bash', is_interrupt: true, error: 'x' }));
  assert.equal(r.session.status, 'interrupted');
  assert.equal(r.session.lastError, undefined);
});

test('feed is capped at 100', () => {
  const st = new OfficeState();
  for (let i = 0; i < 150; i++) st.apply(base('Notification', { notification_type: 'idle_prompt' }));
  assert.equal(st.snapshot().feed.length, 100);
});

test('redaction', () => {
  assert.equal(clean('API_KEY=abc123 ok'), 'API_KEY=[redacted] ok');
  assert.equal(clean('curl -H "Authorization: Bearer abcdefghijkl"').includes('abcdefghijkl'), false);
  assert.equal(clean('https://user:pw@host/x'), 'https://[redacted]@host/x');
  assert.equal(clean('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(summarizeTool('Bash', { command: 'PGPASSWORD=x psql -c "select 1"' }), 'psql');
  assert.equal(summarizeTool('WebFetch', { url: 'https://example.com/a?token=1' }), 'example.com');
});

// ---- Agents (SIMULATED: hand-written payloads shaped like Claude Code 2.1 hooks, not a live session) ----

const sub = (event, id, type, extra = {}) => base(event, { agent_id: id, agent_type: type, ...extra });
const agentsOf = (r) => r.session.agents;

test('simulated: main agent owns tool events without agent_id', () => {
  const st = new OfficeState();
  st.apply(base('UserPromptSubmit', { prompt: 'x' }));
  const r = st.apply(base('PreToolUse', { tool_name: 'Read', tool_use_id: 'm1', tool_input: { file_path: '/a/b/c.md' } }));
  assert.deepEqual(agentsOf(r).map((a) => a.id), ['main']);
  const main = agentsOf(r)[0];
  assert.equal(main.main, true);
  assert.equal(main.tool.name, 'Read');
  assert.equal(main.tool.category, 'data');
  assert.equal(main.tool.summary, 'c.md');
  assert.equal(main.toolCalls, 1);
  const done = st.apply(base('PostToolUse', { tool_name: 'Read', tool_use_id: 'm1' }));
  assert.equal(agentsOf(done)[0].tool, null);
});

test('simulated: subagent lifecycle — start, tools, stop', () => {
  const st = new OfficeState();
  st.apply(base('UserPromptSubmit', { prompt: 'x' }));
  st.apply(base('PreToolUse', { tool_name: 'Agent', tool_use_id: 'ag' }));
  let r = st.apply(sub('SubagentStart', 'A1', 'Explore'));
  assert.deepEqual(agentsOf(r).map((a) => [a.id, a.type]), [['main', 'main'], ['A1', 'Explore']]);
  assert.equal(agentsOf(r)[0].tool.category, 'creative'); // main is still waiting on its Agent tool

  r = st.apply(sub('PreToolUse', 'A1', 'Explore', { tool_name: 'Grep', tool_use_id: 'g1', tool_input: { pattern: 'foo' } }));
  const a1 = agentsOf(r).find((a) => a.id === 'A1');
  assert.equal(a1.tool.name, 'Grep');
  assert.equal(a1.tool.category, 'data');
  assert.equal(a1.toolCalls, 1);
  assert.equal(agentsOf(r).find((a) => a.id === 'main').toolCalls, 1); // the Agent call only

  r = st.apply(sub('PostToolUse', 'A1', 'Explore', { tool_name: 'Grep', tool_use_id: 'g1' }));
  assert.equal(agentsOf(r).find((a) => a.id === 'A1').tool, null);

  st.apply(sub('PreToolUse', 'A1', 'Explore', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'ls' } }));
  r = st.apply(sub('SubagentStop', 'A1', 'Explore'));
  assert.deepEqual(agentsOf(r).map((a) => a.id), ['main']);
  assert.ok(!r.session.tools.some((t) => t.id === 'b1'), 'tools of a stopped subagent are dropped');
});

test('simulated: Stop and SessionEnd remove subagents', () => {
  const st = new OfficeState();
  st.apply(sub('SubagentStart', 'A1', 'Explore'));
  st.apply(sub('SubagentStart', 'A2', 'Plan'));
  assert.equal(st.apply(base('Notification', { notification_type: 'x' })).session.agents.length, 3);
  assert.deepEqual(agentsOf(st.apply(base('Stop'))).map((a) => a.id), ['main']);

  st.apply(sub('SubagentStart', 'A3', 'Explore'));
  const end = st.apply(base('SessionEnd', { reason: 'other' }));
  assert.deepEqual(end.session.agents, []);
  assert.deepEqual(end.session.subagents, []);
});

test('simulated: parallel subagents keep their own tools', () => {
  const st = new OfficeState();
  st.apply(sub('SubagentStart', 'A1', 'Explore'));
  st.apply(sub('SubagentStart', 'A2', 'general-purpose'));
  st.apply(sub('PreToolUse', 'A1', 'Explore', { tool_name: 'Read', tool_use_id: 'r1' }));
  const r = st.apply(sub('PreToolUse', 'A2', 'general-purpose', { tool_name: 'WebFetch', tool_use_id: 'w1', tool_input: { url: 'https://example.com/x' } }));
  const byId = Object.fromEntries(agentsOf(r).map((a) => [a.id, a]));
  assert.equal(byId.A1.tool.category, 'data');
  assert.equal(byId.A2.tool.category, 'research');
  assert.equal(byId.A2.tool.summary, 'example.com');
  assert.equal(byId.main.tool, null);
});

test('simulated: no agent is invented — only main without any agent_id', () => {
  const st = new OfficeState();
  st.apply(base('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b', agent_type: 'Explore' })); // type without id → still main
  const r = st.apply(base('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b' }));
  assert.deepEqual(agentsOf(r).map((a) => a.id), ['main']);
  // PostToolUse for an unknown agent id does not create one
  const p = st.apply(sub('PostToolUse', 'ghost', 'Explore', { tool_name: 'Read' }));
  assert.deepEqual(agentsOf(p).map((a) => a.id), ['main']);
});

test('simulated: tool event from a subagent we missed the start of is shown with unknown start', () => {
  const st = new OfficeState();
  const r = st.apply(sub('PreToolUse', 'late', 'Explore', { tool_name: 'Glob', tool_use_id: 'x' }));
  const a = agentsOf(r).find((x) => x.id === 'late');
  assert.equal(a.type, 'Explore');
  assert.equal(a.startedAt, undefined);
  assert.ok(a.firstSeenAt);
});

test('simulated: agent list never carries prompts or tool output', () => {
  const st = new OfficeState();
  st.apply(sub('SubagentStart', 'A1', 'Explore', { prompt: 'find the hunter2 secret' }));
  st.apply(sub('PreToolUse', 'A1', 'Explore', { tool_name: 'Read', tool_use_id: 'r', tool_input: { file_path: '/x/notes.txt' } }));
  st.apply(sub('PostToolUse', 'A1', 'Explore', { tool_name: 'Read', tool_use_id: 'r', tool_response: { content: 'TOPSECRETFILE' } }));
  st.apply(sub('SubagentStop', 'A1', 'Explore', { last_assistant_message: 'LASTMSG' }));
  const json = JSON.stringify(st.snapshot());
  for (const secret of ['hunter2', 'TOPSECRETFILE', 'LASTMSG']) assert.ok(!json.includes(secret), secret);
});
