// Real token usage per agent, read from Claude Code's own transcript files (JSONL).
//
// Hook payloads carry `transcript_path` (the main session transcript) and SubagentStop carries
// `agent_transcript_path`. A subagent's transcript lives next to the main one:
//   <projects>/<project>/<session>.jsonl                      main agent
//   <projects>/<project>/<session>/subagents/agent-<id>.jsonl  subagent <id>
//
// Only the numeric `message.usage` fields of assistant entries are kept. Message content, prompts
// and tool results are never stored, sent or logged. Only *.jsonl files whose real path is inside
// ~/.claude/projects are read. Files are read incrementally (byte offset) and at most once per
// `minIntervalMs` each, and only when a hook event asks for it — there is no polling loop.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ROOT = path.join(os.homedir(), '.claude', 'projects');
const CHUNK = 4 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_PARTIAL = 16 * 1024 * 1024; // a "line" longer than this is not a transcript entry we want

const num = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function newUsageAcc() {
  return { byId: new Map(), partial: '', lines: 0 };
}

// Split a chunk of JSONL text into whole lines. A trailing line without "\n" is kept in
// acc.partial for the next chunk.
export function splitLines(acc, text) {
  const lines = (acc.partial + text).split('\n');
  acc.partial = lines.pop();
  if (acc.partial.length > MAX_PARTIAL) acc.partial = '';
  return lines;
}

// One transcript line -> { id, u: [input, output, cacheCreation, cacheRead], at } for an assistant
// entry with usage, else null. Only numbers (and the message id / timestamp) leave this function.
// Without message.id / requestId the entry gets `fallbackId` (unique per line).
export function usageEntry(line, fallbackId) {
  if (!line.includes('"usage"')) return null; // cheap filter before parsing
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || o.type !== 'assistant') return null;
  const u = o.message?.usage;
  if (!u || typeof u !== 'object') return null;
  const id = (typeof o.message.id === 'string' && o.message.id)
    || (typeof o.requestId === 'string' && o.requestId)
    || fallbackId;
  const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  return { id, u: [num(u.input_tokens), num(u.output_tokens), num(u.cache_creation_input_tokens), num(u.cache_read_input_tokens)], at: Number.isFinite(at) ? at : null };
}

// Feed a chunk of JSONL text.
// Claude Code writes one entry per content block of a reply, each repeating the same usage,
// so entries are deduped by message.id (then requestId); the latest entry for an id wins.
export function parseUsageChunk(acc, text) {
  for (const line of splitLines(acc, text)) {
    acc.lines++;
    const e = usageEntry(line, `line:${acc.lines}`);
    if (e) acc.byId.set(e.id, e.u);
  }
  return acc;
}

// `total` is what makes a kitten chubby: input + output + cache_creation — tokens the agent
// actually took in or produced. cache_read (re-reading an already cached prompt every turn)
// dominates long sessions and is reported separately, not counted in `total`.
export function usageTotals(acc) {
  let input = 0, output = 0, cacheCreation = 0, cacheRead = 0;
  for (const [i, o, cc, cr] of acc.byId.values()) { input += i; output += o; cacheCreation += cc; cacheRead += cr; }
  return { total: input + output + cacheCreation, input, output, cacheCreation, cacheRead, messages: acc.byId.size };
}

// Real path inside root and ending in .jsonl, or null. Never throws.
export function safeTranscriptPath(p, root = DEFAULT_ROOT) {
  if (typeof p !== 'string' || !p || p.length > 4096 || !p.endsWith('.jsonl')) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(p);
    if (!real.startsWith(realRoot + path.sep) || !real.endsWith('.jsonl')) return null;
    if (!fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

// <session>.jsonl + agent id -> <session>/subagents/agent-<id>.jsonl (not checked for existence).
export function subagentTranscript(mainTranscript, agentId) {
  if (typeof mainTranscript !== 'string' || !mainTranscript.endsWith('.jsonl')) return null;
  if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(agentId)) return null;
  return path.join(mainTranscript.slice(0, -'.jsonl'.length), 'subagents', `agent-${agentId}.jsonl`);
}

export class UsageTracker {
  // onUpdate(sessionId, agentKey, totals) is called only when an agent's totals change.
  constructor({ root = DEFAULT_ROOT, minIntervalMs = 3000, now = () => Date.now(), onUpdate = () => {} } = {}) {
    this.root = root;
    this.minIntervalMs = minIntervalMs;
    this.now = now;
    this.onUpdate = onUpdate;
    this.files = new Map(); // real path -> { acc, offset, lastReadAt, timer, reading, again, owners:Set, totals }
  }

  // Ask for a (throttled) re-read of an agent's transcript. Unsafe paths are ignored.
  track(sessionId, agentKey, rawPath) {
    const real = safeTranscriptPath(rawPath, this.root);
    if (!real) return false;
    let f = this.files.get(real);
    if (!f) {
      if (this.files.size >= MAX_FILES) this.#evictOldest();
      f = { acc: newUsageAcc(), offset: 0, lastReadAt: 0, timer: null, reading: false, again: false, owners: new Set(), totals: null };
      this.files.set(real, f);
    }
    const owner = `${sessionId}\u0000${agentKey}`;
    if (!f.owners.has(owner)) {
      f.owners.add(owner);
      if (f.totals) this.onUpdate(sessionId, agentKey, f.totals); // already known: no need to wait
    }
    this.#schedule(real, f);
    return true;
  }

  forgetSession(sessionId) {
    for (const [p, f] of this.files) {
      for (const o of f.owners) if (o.startsWith(`${sessionId}\u0000`)) f.owners.delete(o);
      if (!f.owners.size) { clearTimeout(f.timer); this.files.delete(p); }
    }
  }

  // Drop files whose sessions the office no longer keeps.
  retain(hasSession) {
    const gone = new Set();
    for (const f of this.files.values()) for (const o of f.owners) { const id = o.split('\u0000')[0]; if (!hasSession(id)) gone.add(id); }
    for (const id of gone) this.forgetSession(id);
  }

  stop() {
    for (const f of this.files.values()) clearTimeout(f.timer);
    this.files.clear();
  }

  #evictOldest() {
    let oldest;
    for (const [p, f] of this.files) if (!oldest || f.lastReadAt < oldest[1].lastReadAt) oldest = [p, f];
    if (oldest) { clearTimeout(oldest[1].timer); this.files.delete(oldest[0]); }
  }

  #schedule(real, f) {
    if (f.timer) return;
    if (f.reading) { f.again = true; return; }
    const wait = Math.max(0, f.lastReadAt + this.minIntervalMs - this.now());
    f.timer = setTimeout(() => { f.timer = null; void this.#read(real, f); }, wait);
    f.timer.unref?.();
  }

  // Exposed for tests: read whatever was appended since the last read.
  async readNow(real) {
    const f = this.files.get(real);
    if (f) await this.#read(real, f);
  }

  async #read(real, f) {
    if (f.reading) { f.again = true; return; }
    f.reading = true;
    f.lastReadAt = this.now();
    try {
      await readAppended(real, f, (text) => parseUsageChunk(f.acc, text), () => { f.acc = newUsageAcc(); });
    } finally {
      f.reading = false;
    }
    if (!this.files.has(real)) return;
    const totals = usageTotals(f.acc);
    if (totals.messages && (!f.totals || f.totals.total !== totals.total || f.totals.cacheRead !== totals.cacheRead)) {
      f.totals = totals;
      for (const o of f.owners) {
        const [sessionId, agentKey] = o.split('\u0000');
        this.onUpdate(sessionId, agentKey, totals);
      }
    }
    if (f.again) { f.again = false; this.#schedule(real, f); }
  }

  get(real) {
    return this.files.get(real)?.totals ?? null;
  }
}

// Read whatever was appended to `real` since `f.offset` and hand it to onText in UTF-8-safe pieces
// (a multi-byte character cut by a chunk boundary waits for the next piece). If the file shrank
// (replaced/truncated) onReset() is called and reading starts over. Errors keep what we had.
export async function readAppended(real, f, onText, onReset = () => {}) {
  let fh;
  try {
    fh = await fs.promises.open(real, 'r');
    const { size } = await fh.stat();
    if (size < f.offset) { onReset(); f.offset = 0; }
    const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, size - f.offset)));
    while (f.offset < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - f.offset), f.offset);
      if (!bytesRead) break;
      let end = bytesRead;
      if (f.offset + bytesRead < size) { while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) end--; if (end > 0 && buf[end - 1] >= 0xc0) end--; if (end === 0) end = bytesRead; }
      onText(buf.toString('utf8', 0, end));
      f.offset += end;
    }
    return true;
  } catch {
    return false; // unreadable right now (deleted, permissions)
  } finally {
    await fh?.close().catch(() => {});
  }
}
