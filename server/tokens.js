// Real token usage per local calendar day, across ALL transcripts under ~/.claude/projects
// (main sessions and subagents), for the "🪙 tokens" tab.
//
// Same rules as usage.js (whose parser and reader this reuses): only *.jsonl files whose real path is
// inside ~/.claude/projects, only the numeric `message.usage` fields + message id + timestamp of
// assistant entries are kept; prompts, replies and tool results are never stored, sent or logged.
// Each reply is counted once, by message.id (then requestId), even when it appears in several files
// (a resumed session copies earlier replies into its new transcript); the latest entry wins.
// A reply is bucketed by the local date of its own `timestamp`.
//
// Cost: one background scan at startup (files last modified before the range are skipped), then
// incremental reads from each file's last byte offset. index.js refreshes it at most every ~60 s and
// only while a page is open.

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_ROOT, safeTranscriptPath, readAppended, splitLines, usageEntry } from './usage.js';
import { timeRange } from './redmine.js';

const RANGE_DAYS = 28;
const MAX_DEPTH = 4;           // <root>/<project>/<session>/subagents/agent-<id>.jsonl
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localMidnight = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const yieldToLoop = () => new Promise((r) => setImmediate(r));

export class DailyTokens {
  constructor({ root = DEFAULT_ROOT, now = () => Date.now(), maxIds = 200_000, maxFiles = 5000, onUpdate = () => {} } = {}) {
    this.root = root;
    this.now = now;
    this.maxIds = maxIds;
    this.maxFiles = maxFiles;
    this.onUpdate = onUpdate;
    this.files = new Map(); // real path -> { offset, acc: { partial, lines } }
    this.ids = new Map();   // reply id -> [day, counted, cacheRead]
    this.days = new Map();  // YYYY-MM-DD -> [counted, cacheRead]
    this.running = null;
    this.lastStartAt = 0;
    this.updatedAt = null;
    this.lastSent = '';
  }

  // Oldest day kept: the 28-day chart, this week (Mon–Sun) and this calendar month.
  #from() { return timeRange(new Date(this.now())).from; }

  // Re-read appended data now (one run at a time). Resolves when done.
  refresh() {
    if (this.running) return this.running;
    this.lastStartAt = this.now();
    this.running = this.#run().finally(() => { this.running = null; });
    return this.running;
  }

  // The periodic tick: refresh unless one started less than minGapMs ago.
  refreshIfDue(minGapMs = 55_000) {
    if (this.running || this.now() - this.lastStartAt < minGapMs) return this.running;
    return this.refresh();
  }

  async #run() {
    const from = this.#from();
    const fromMs = localMidnight(from);
    for (const file of await this.#list()) {
      let f = this.files.get(file);
      let st;
      try { st = await fs.promises.stat(file); } catch { this.files.delete(file); continue; }
      if (!f) {
        if (st.mtimeMs < fromMs || this.files.size >= this.maxFiles) continue; // nothing in range
        f = { offset: 0, acc: { partial: '', lines: 0 } };
        this.files.set(file, f);
      }
      if (st.size === f.offset) continue;
      await readAppended(file, f, (text) => this.#feed(file, f, text, from), () => { f.acc = { partial: '', lines: 0 }; });
      await yieldToLoop();
    }
    this.#prune(from);
    this.updatedAt = this.now();
    this.#emit();
  }

  #feed(file, f, text, from) {
    for (const line of splitLines(f.acc, text)) {
      f.acc.lines++;
      const e = usageEntry(line, `${file}:${f.acc.lines}`);
      if (e && e.at !== null) this.add(e, from);
    }
  }

  // One reply (exported shape of usageEntry). Exposed for tests.
  add({ id, u: [input, output, cacheCreation, cacheRead], at }, from = this.#from()) {
    const day = ymd(new Date(at));
    if (day < from) return;
    const prev = this.ids.get(id);
    if (prev) this.#bump(prev[0], -prev[1], -prev[2]);
    else if (this.ids.size >= this.maxIds) this.ids.delete(this.ids.keys().next().value); // forget the oldest id
    const counted = input + output + cacheCreation;
    this.ids.set(id, [day, counted, cacheRead]);
    this.#bump(day, counted, cacheRead);
  }

  #bump(day, counted, cacheRead) {
    const d = this.days.get(day) || [0, 0];
    d[0] += counted;
    d[1] += cacheRead;
    this.days.set(day, d);
  }

  #prune(from) {
    for (const day of this.days.keys()) if (day < from) this.days.delete(day);
    for (const [id, v] of this.ids) if (v[0] < from) this.ids.delete(id);
  }

  // Every *.jsonl under root that passes the path guard (real path inside root). Symlinked
  // directories are not followed.
  async #list() {
    const out = new Set();
    const walk = async (dir, depth) => {
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < MAX_DEPTH) await walk(p, depth + 1); }
        else if (e.name.endsWith('.jsonl')) { const real = safeTranscriptPath(p, this.root); if (real) out.add(real); }
      }
    };
    await walk(this.root, 0);
    return [...out];
  }

  snapshot() {
    const now = new Date(this.now());
    const { today, weekStart, monthStart } = timeRange(now);
    const daily = [];
    for (let i = RANGE_DAYS - 1; i >= 0; i--) {
      const date = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
      const [counted, cacheRead] = this.days.get(date) || [0, 0];
      daily.push({ date, counted, cacheRead });
    }
    const sum = (start) => {
      let counted = 0, cacheRead = 0;
      for (const [day, [c, r]] of this.days) if (day >= start && day <= today) { counted += c; cacheRead += r; }
      return { counted, cacheRead };
    };
    return {
      today: sum(today), week: sum(weekStart), month: sum(monthStart), daily,
      weekStart, monthStart, updatedAt: this.updatedAt, ready: this.updatedAt !== null,
    };
  }

  #emit() {
    const snap = this.snapshot();
    const key = JSON.stringify([snap.daily, snap.month, snap.week]);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.onUpdate(snap);
  }

  stop() { this.files.clear(); this.ids.clear(); this.days.clear(); }
}
