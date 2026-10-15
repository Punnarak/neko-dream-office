// How long Claude actually worked, per Redmine ticket and day — a hint for logging time.
// "Working" = the session status was working / using a tool between two hook events (not waiting
// for you, not idle). Overlapping sessions on the same ticket are counted once (intervals are merged).
//
// The ticket of a session comes from, in order:
//   1. the newest prompt that mentions one ("ตรวจสอบ Redmine #104498", ".../issues/104498")
//   2. a 5–6 digit number in the git branch name of the session's folder ("task-104421")
//   3. the newest commit subject, on a branch that is not master/main/develop
// Only ticket numbers, project folder names and time intervals are kept or saved —
// never prompt text, branch names or commit subjects.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { extractTickets } from './commits.js';

export const CLAUDE_TIME_FILE = path.join(os.homedir(), '.config', 'neko-dream-office', 'claude-time.json');
const ACTIVE = new Set(['working', 'tool']);
const MAX_GAP_MS = 15 * 60 * 1000; // a silent gap counts this much at most (killed terminal, sleeping laptop)
const KEEP_DAYS = 35;
const MAX_KEYS_PER_DAY = 100;
const MAX_SESSIONS = 50;
const GIT_TTL_MS = 60_000;
const GIT_TIMEOUT_MS = 3000;
const DEFAULT_BRANCHES = new Set(['master', 'main', 'develop', 'dev', 'HEAD']);
const MIN_TICKET = 10_000; // Redmine ids here are 5–6 digits; "ticket/1022" branches are something else

const ymd = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nextMidnight = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};
const valid = (id) => (Number.isInteger(id) && id >= MIN_TICKET && id < 10_000_000 ? id : null);

export function promptTicket(prompt) {
  if (typeof prompt !== 'string') return null;
  const url = /\/issues\/(\d{5,7})(?!\d)/.exec(prompt);
  if (url) return valid(Number(url[1]));
  for (const id of extractTickets(prompt)) if (valid(id)) return id;
  return null;
}

export function branchTicket(branch) {
  const m = typeof branch === 'string' && /(?<!\d)(\d{5,6})(?!\d)/.exec(branch);
  return m ? valid(Number(m[1])) : null;
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (err, out) => resolve(err ? null : out.trim()));
  });
}

// { id, source: 'branch' | 'commit' } for a folder, or null.
export async function gitTicket(cwd, git = runGit) {
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch) return null;
  const id = branchTicket(branch);
  if (id) return { id, source: 'branch' };
  if (DEFAULT_BRANCHES.has(branch)) return null;
  const subject = await git(cwd, ['log', '-1', '--pretty=%s']);
  for (const t of extractTickets(subject || '')) if (valid(t)) return { id: t, source: 'commit' };
  return null;
}

// Add [s, e] to a sorted list of disjoint intervals, merging overlaps.
export function mergeInterval(list, s, e) {
  const out = [];
  let cur = [s, e];
  let placed = false;
  for (const iv of list) {
    if (iv[1] < cur[0]) out.push(iv);
    else if (iv[0] > cur[1]) { if (!placed) { out.push(cur); placed = true; } out.push(iv); }
    else cur = [Math.min(iv[0], cur[0]), Math.max(iv[1], cur[1])];
  }
  if (!placed) out.push(cur);
  return out;
}

const total = (list) => list.reduce((n, [s, e]) => n + (e - s), 0);

export class ClaudeTime {
  constructor({ file = CLAUDE_TIME_FILE, now = () => Date.now(), git = runGit, onUpdate = () => {}, onTicket = () => {}, saveDelayMs = 30_000, notifyDelayMs = 5_000 } = {}) {
    this.file = file;
    this.now = now;
    this.git = git;
    this.onUpdate = onUpdate;
    this.onTicket = onTicket;
    this.saveDelayMs = saveDelayMs;
    this.notifyDelayMs = notifyDelayMs;
    this.days = new Map(); // 'YYYY-MM-DD' -> Map(key -> [[start, end], …])   key = '104498' | 'p:<project>'
    this.sessions = new Map(); // session id -> { lastAt, active, cwd, project, prompt, git, gitAt, gitPending }
    this.saveTimer = null;
    this.notifyTimer = null;
    this.updatedAt = null;
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [date, keys] of Object.entries(data?.days || {})) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !keys || typeof keys !== 'object') continue;
        const map = new Map();
        for (const [key, list] of Object.entries(keys).slice(0, MAX_KEYS_PER_DAY)) {
          if (!/^(\d{5,7}|p:.{0,60})$/.test(key) || !Array.isArray(list)) continue;
          let merged = [];
          for (const iv of list) {
            if (Array.isArray(iv) && Number.isFinite(iv[0]) && Number.isFinite(iv[1]) && iv[1] > iv[0]) merged = mergeInterval(merged, iv[0], iv[1]);
          }
          if (merged.length) map.set(key, merged);
        }
        if (map.size) this.days.set(date, map);
      }
      this.#prune();
    } catch { /* no file yet, or unreadable: start empty */ }
  }

  // Called for every accepted hook event, with the public session as it is after the event.
  observe(raw, session) {
    if (!session?.id) return;
    const at = this.now();
    let r = this.sessions.get(session.id);
    if (!r) {
      r = { lastAt: null, active: false, cwd: null, project: null, prompt: null, git: null, gitAt: 0, gitPending: false };
      this.sessions.set(session.id, r);
      this.#pruneSessions();
    }
    // the time since the previous event belongs to the ticket the session had until now
    if (r.active && r.lastAt !== null && at > r.lastAt) this.#add(this.#key(r), r.lastAt, Math.min(at, r.lastAt + MAX_GAP_MS));

    const before = this.ticketOf(session.id);
    if (raw?.hook_event_name === 'UserPromptSubmit') {
      const id = promptTicket(raw.prompt);
      if (id) r.prompt = id;
    }
    if (typeof raw?.cwd === 'string' && raw.cwd && raw.cwd !== r.cwd) {
      r.cwd = raw.cwd;
      r.git = null;
      r.gitAt = 0;
    }
    r.project = session.project || r.project;
    r.active = ACTIVE.has(session.status);
    r.lastAt = at;
    if (r.cwd && !r.gitPending && at - r.gitAt >= GIT_TTL_MS) this.#refreshGit(session.id, r);
    if (!sameTicket(before, this.ticketOf(session.id))) this.onTicket(session.id, this.ticketOf(session.id));
  }

  // { id, source: 'prompt' | 'branch' | 'commit' } or null.
  ticketOf(sessionId) {
    const r = this.sessions.get(sessionId);
    if (!r) return null;
    return r.prompt ? { id: r.prompt, source: 'prompt' } : r.git;
  }

  // [{ date, items: [{ ticket, project, ms }] }], newest day first, biggest item first.
  snapshot() {
    const days = [...this.days].sort(([a], [b]) => b.localeCompare(a)).map(([date, map]) => ({
      date,
      items: [...map].map(([key, list]) => (key.startsWith('p:')
        ? { ticket: null, project: key.slice(2) || null, ms: total(list) }
        : { ticket: Number(key), project: null, ms: total(list) })).sort((a, b) => b.ms - a.ms),
    }));
    return { days, updatedAt: this.updatedAt };
  }

  // Tickets worth a subject lookup in Redmine, most recent first.
  ticketIds(limit = 40) {
    const ids = [];
    for (const [, map] of [...this.days].sort(([a], [b]) => b.localeCompare(a))) {
      for (const key of map.keys()) if (!key.startsWith('p:') && !ids.includes(Number(key))) ids.push(Number(key));
    }
    return ids.slice(0, limit);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const days = {};
    for (const [date, map] of this.days) days[date] = Object.fromEntries(map);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, days }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.warn(`[neko] could not save ${this.file}: ${e.message}`);
    }
  }

  stop() {
    clearTimeout(this.notifyTimer);
    if (this.saveTimer) this.flush();
  }

  #key(r) {
    const t = r.prompt || r.git?.id;
    return t ? String(t) : `p:${(r.project || '').slice(0, 60)}`;
  }

  #add(key, s, e) {
    while (s < e) {
      const end = Math.min(e, nextMidnight(s));
      const date = ymd(s);
      let map = this.days.get(date);
      if (!map) { map = new Map(); this.days.set(date, map); this.#prune(); }
      if (map.has(key) || map.size < MAX_KEYS_PER_DAY) map.set(key, mergeInterval(map.get(key) || [], s, end));
      s = end;
    }
    this.updatedAt = this.now();
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => this.flush(), this.saveDelayMs);
      this.saveTimer.unref?.();
    }
    if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => { this.notifyTimer = null; this.onUpdate(this.snapshot()); }, this.notifyDelayMs);
      this.notifyTimer.unref?.();
    }
  }

  #refreshGit(sessionId, r) {
    r.gitPending = true;
    const cwd = r.cwd;
    gitTicket(cwd, this.git).then((t) => {
      r.gitPending = false;
      r.gitAt = this.now();
      if (r.cwd !== cwd || sameTicket(r.git, t)) return;
      const before = this.ticketOf(sessionId);
      r.git = t;
      if (!sameTicket(before, this.ticketOf(sessionId))) this.onTicket(sessionId, this.ticketOf(sessionId));
    }, () => { r.gitPending = false; r.gitAt = this.now(); });
  }

  #prune() {
    const cutoff = ymd(this.now() - KEEP_DAYS * 86_400_000);
    for (const date of this.days.keys()) if (date < cutoff) this.days.delete(date);
  }

  #pruneSessions() {
    if (this.sessions.size <= MAX_SESSIONS) return;
    const oldest = [...this.sessions].sort(([, a], [, b]) => (a.lastAt ?? 0) - (b.lastAt ?? 0));
    for (const [id] of oldest.slice(0, this.sessions.size - MAX_SESSIONS)) this.sessions.delete(id);
  }
}

function sameTicket(a, b) {
  return (a?.id ?? null) === (b?.id ?? null) && (a?.source ?? null) === (b?.source ?? null);
}
