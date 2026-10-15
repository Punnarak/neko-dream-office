// Open Redmine issues assigned to the current user.
// The backend fetches them (the API key never reaches the browser) and pushes a
// trimmed list over the WebSocket. Fetches only while at least one page is open.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clean } from './sanitize.js';
import { loadGitConfig, scanCommits, matchCommits } from './commits.js';

const CONFIG_FILE = path.join(os.homedir(), '.config', 'neko-dream-office', 'redmine.json');
const TIMEOUT_MS = 10_000;
const MANUAL_GAP_MS = 30_000;
const MAX_ISSUES = 50;
const ACTIVITY_PER_REFRESH = 10; // issue detail requests (journals) per refresh, at most
const ACTIVITY_CONCURRENCY = 3;
const GONE_KEEP_MS = 24 * 60 * 60 * 1000;

// REDMINE_URL / REDMINE_API_KEY are the only environment variables this server reads.
export function loadConfig(env = process.env, file = CONFIG_FILE) {
  if (env.REDMINE_URL && env.REDMINE_API_KEY) {
    return { url: env.REDMINE_URL, apiKey: env.REDMINE_API_KEY, source: 'env' };
  }
  try {
    const st = fs.statSync(file);
    if ((st.mode & 0o077) !== 0) console.warn(`[neko] ${file} is readable by other users — run: chmod 600 ${file}`);
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cfg.url && cfg.apiKey) return { url: String(cfg.url), apiKey: String(cfg.apiKey), source: 'file' };
  } catch { /* no config file */ }
  return null;
}

const name = (o) => (o && typeof o.name === 'string' ? clean(o.name, 80) : null);
const hours = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Keep only what the card shows. Never description, journals or attachments.
export function mapIssue(raw, baseUrl) {
  const id = Number(raw?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    subject: clean(raw.subject || '', 120),
    project: name(raw.project),
    tracker: name(raw.tracker),
    status: name(raw.status),
    priority: name(raw.priority),
    priorityId: Number(raw.priority?.id) || null,
    dueDate: isDate(raw.due_date),
    updatedOn: typeof raw.updated_on === 'string' ? raw.updated_on : null,
    doneRatio: Number.isFinite(raw.done_ratio) ? Math.max(0, Math.min(100, raw.done_ratio)) : null,
    spentHours: hours(raw.spent_hours),
    estimatedHours: hours(raw.estimated_hours),
    url: `${baseUrl}/issues/${id}`,
  };
}

// What happened last on an issue, from its newest journal. Keeps only the time, whether I did it,
// and which kinds of change it was — never the comment text, the changed values or anyone's name.
const DETAIL_KIND = { status_id: 'status', assigned_to_id: 'assignee', priority_id: 'priority', due_date: 'due' };
const KIND_ORDER = ['comment', 'assignee', 'status', 'priority', 'due', 'other'];
const sameId = (a, b) => a != null && b != null && Number(a) === Number(b);

export function lastActivityOf(issue, myId) {
  const journals = Array.isArray(issue?.journals) ? issue.journals : [];
  let last = null;
  for (const j of journals) {
    if (!j || typeof j.created_on !== 'string') continue;
    if (!last || j.created_on >= last.created_on) last = j;
  }
  const by = (user) => (myId == null || !user ? null : sameId(user.id, myId));
  if (!last) {
    // No journal yet: the only activity is the creation.
    const at = typeof issue?.created_on === 'string' ? issue.created_on : typeof issue?.updated_on === 'string' ? issue.updated_on : null;
    return at ? { at, byMe: by(issue.author), kinds: ['other'] } : null;
  }
  const kinds = new Set();
  if (typeof last.notes === 'string' && last.notes.trim()) kinds.add('comment');
  for (const d of Array.isArray(last.details) ? last.details : []) {
    kinds.add((d?.property === 'attr' && DETAIL_KIND[d.name]) || 'other');
  }
  if (!kinds.size) kinds.add('other');
  return { at: last.created_on, byMe: by(last.user), kinds: KIND_ORDER.filter((k) => kinds.has(k)) };
}

const RANGE_DAYS = 28; // daily chart: today and the 27 days before it
const MAX_LOG = 300;

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Dates the time fetch must cover: the chart range, this week and this calendar month (local).
export function timeRange(now = new Date()) {
  const today = ymd(now);
  const weekStart = ymd(addDays(now, -((now.getDay() + 6) % 7)));
  const rangeStart = ymd(addDays(now, -(RANGE_DAYS - 1)));
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const from = [rangeStart, weekStart, monthStart].sort()[0];
  return { today, weekStart, rangeStart, monthStart, from };
}

// Same rule as the dev-work-report skill (gather_period.py is_leave): activity named exactly "Leave".
export const isLeave = (e) => e?.activity?.name === 'Leave';

// Sum my logged time for today, this week (Mon–Sun), this month and per day for the last 28 days
// (zero-filled), and keep a trimmed log of the entries.
// Comments are the user's own notes: shortened and redacted like everything else.
export function summarizeTime(entries, now = new Date()) {
  const { today, weekStart, rangeStart, monthStart, from } = timeRange(now);
  let todayHours = 0;
  let weekHours = 0;
  let monthHours = 0;
  const perDay = new Map();
  const byIssue = new Map();
  const leave = new Map(); // spent_on -> hours logged under the "Leave" activity
  const log = [];
  for (const e of entries) {
    const h = hours(e?.hours);
    if (h === null || !isDate(e.spent_on) || e.spent_on < from || e.spent_on > today) continue;
    if (e.spent_on >= weekStart) weekHours += h;
    if (e.spent_on >= monthStart) monthHours += h;
    if (e.spent_on >= rangeStart) perDay.set(e.spent_on, (perDay.get(e.spent_on) || 0) + h);
    if (isLeave(e)) leave.set(e.spent_on, (leave.get(e.spent_on) || 0) + h);
    log.push({
      id: Number(e.id) || null,
      spentOn: e.spent_on,
      createdOn: typeof e.created_on === 'string' ? e.created_on : null,
      issueId: Number(e.issue?.id) || null,
      activity: name(e.activity),
      activityId: Number(e.activity?.id) || null,
      hours: h,
      comment: e.comments ? clean(e.comments, 120) : '',
    });
    if (e.spent_on !== today) continue;
    todayHours += h;
    const id = Number(e.issue?.id) || 0;
    byIssue.set(id, (byIssue.get(id) || 0) + h);
  }
  const round = (n) => Math.round(n * 100) / 100;
  const daily = [];
  for (let i = RANGE_DAYS - 1; i >= 0; i--) {
    const date = ymd(addDays(now, -i));
    daily.push({ date, hours: round(perDay.get(date) || 0) });
  }
  return {
    today, weekStart, monthStart, rangeStart,
    todayHours: round(todayHours), weekHours: round(weekHours), monthHours: round(monthHours),
    daily,
    // Days with time under the "Leave" activity (dates + hours only). Their hours still count in the totals above.
    leaveDays: [...leave].sort(([a], [b]) => a.localeCompare(b)).map(([date, h]) => ({ date, hours: round(h) })),
    log: log.sort((a, b) => b.spentOn.localeCompare(a.spentOn) || (b.createdOn || '').localeCompare(a.createdOn || '')).slice(0, MAX_LOG),
    logTotal: log.length,
    subjects: {},
    todayByIssue: [...byIssue].map(([issueId, h]) => ({ issueId: issueId || null, hours: round(h) })).sort((a, b) => b.hours - a.hours),
  };
}

function describeError(e) {
  const code = e?.cause?.code || e?.code;
  if (e?.name === 'TimeoutError') return `หมดเวลา ${TIMEOUT_MS / 1000} วินาที`;
  if (code && /CERT|SSL|TLS/i.test(code)) return `TLS: ใบรับรองของ Redmine ตรวจไม่ผ่าน (${code})`;
  return clean(code || e?.message || 'unknown error', 160);
}

export class RedmineFeed {
  constructor({ config = loadConfig(), git, intervalMs, onUpdate = () => {}, extraIssueIds = () => [] } = {}) {
    this.config = config;
    this.git = git !== undefined ? git : config ? loadGitConfig() : null; // { author, repos } or null
    this.baseUrl = config ? config.url.replace(/\/+$/, '') : null;
    this.intervalMs = Math.max(60_000, intervalMs || 300_000);
    this.onUpdate = onUpdate;
    this.extraIssueIds = extraIssueIds; // tickets Claude worked on: their subjects are looked up too
    this.timer = null;
    this.lastAttemptAt = 0;
    this.inFlight = null;
    this.myId = null;            // my numeric user id (only the number is kept)
    this.activity = new Map();   // issue id -> { updatedOn, lastActivity }
    this.wanted = new Set();     // issue ids whose newest journal still has to be read
    this.prev = null;            // last good list: id -> { updatedOn, subject }, plus whether it was complete
    this.data = { configured: !!config, baseUrl: this.baseUrl, issues: [], total: 0, gone: [], time: null, timeError: null, fetchedAt: null, error: null, errorAt: null, loading: false };
  }

  snapshot() { return this.data; }

  // Called when the number of open pages changes.
  setActive(active) {
    if (!this.config) return;
    if (active && !this.timer) {
      if (!this.data.fetchedAt || Date.now() - this.data.fetchedAt >= this.intervalMs) this.refresh();
      this.timer = setInterval(() => this.refresh(), this.intervalMs);
      this.timer.unref();
    } else if (!active && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Manual refresh from the page. Returns false when called too soon.
  requestRefresh() {
    if (!this.config || Date.now() - this.lastAttemptAt < MANUAL_GAP_MS) return false;
    this.refresh();
    return true;
  }

  refresh() {
    if (!this.config || this.inFlight) return this.inFlight;
    this.lastAttemptAt = Date.now();
    this.set({ loading: true });
    // Logged time is optional: if only that call fails, the issue list still updates.
    this.inFlight = Promise.all([this.fetchIssues(), this.fetchTime().then((time) => ({ time }), (e) => ({ timeError: describeError(e) }))])
      .then(async ([issues, t]) => {
        const gone = this.trackGone(issues, Date.now());
        // "what happened last" is optional: a failure here never hides the list
        try { await this.fetchActivity(issues.list); } catch { /* keep what is cached */ }
        this.set({
          issues: issues.list.map((i) => ({ ...i, lastActivity: this.activityFor(i) })), total: issues.total, gone,
          fetchedAt: Date.now(), error: null, errorAt: null, time: t.time ?? this.data.time, timeError: t.timeError ?? null,
        });
      })
      .catch((e) => this.set({ error: describeError(e), errorAt: Date.now() }))
      .finally(() => { this.inFlight = null; this.set({ loading: false }); });
    return this.inFlight;
  }

  async get(pathAndQuery) {
    const res = await fetch(`${this.baseUrl}${pathAndQuery}`, {
      headers: { 'X-Redmine-API-Key': this.config.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'HTTP 401 — API key ไม่ถูกต้อง' : `HTTP ${res.status}`);
    return res.json();
  }

  async fetchTime() {
    const now = new Date();
    const { from, today, weekStart } = timeRange(now);
    const entries = [];
    // ≤10 pages (1000 entries) covers ~31 days of normal logging; anything beyond is left out.
    for (let offset = 0; offset < 1000; offset += 100) {
      const body = await this.get(`/time_entries.json?user_id=me&from=${from}&to=${today}&limit=100&offset=${offset}`);
      const page = Array.isArray(body.time_entries) ? body.time_entries : [];
      entries.push(...page);
      if (page.length < 100 || entries.length >= body.total_count) break;
    }
    const time = summarizeTime(entries, now);
    // This week (Mon–today): tickets my commits mention with no time logged on them this week (local git only).
    // Only those are sent; `checked` counts every ticket the week's commits mention.
    if (this.git) {
      try {
        const m = matchCommits(await scanCommits(this.git, weekStart, today), entries.filter((e) => e?.spent_on >= weekStart));
        time.commits = {
          from: weekStart, source: this.git.source, checked: m.total, scanned: m.scanned, missing: m.missing, noTicket: m.noTicket,
          tickets: m.tickets.filter((t) => t.state === 'none'),
        };
      } catch { time.commits = null; /* optional, like the subjects below */ }
    }
    // Subjects for logged and committed issues, including ones not assigned to me (one extra request, ≤100 ids).
    const commitIds = (time.commits?.tickets || []).map((t) => t.id);
    let extra = [];
    try { extra = this.extraIssueIds().filter((id) => Number.isInteger(id) && id > 0); } catch { /* optional */ }
    const ids = [...new Set([...commitIds, ...extra, ...time.log.map((l) => l.issueId).filter(Boolean)])].slice(0, 100);
    if (ids.length) {
      try {
        const body = await this.get(`/issues.json?issue_id=${ids.join(',')}&status_id=*&limit=100`);
        for (const i of body.issues || []) if (Number.isInteger(i.id)) time.subjects[i.id] = clean(i.subject || '', 120);
        // an id in a commit message that Redmine does not return: a typo, or a ticket I cannot see
        if (time.commits) for (const t of time.commits.tickets) t.found = t.id in time.subjects;
      } catch { /* subjects are optional */ }
    }
    return time;
  }

  async fetchIssues() {
    const body = await this.get(`/issues.json?assigned_to_id=me&status_id=open&sort=updated_on:desc&limit=${MAX_ISSUES}`);
    const list = (Array.isArray(body.issues) ? body.issues : []).map((i) => mapIssue(i, this.baseUrl)).filter(Boolean);
    return { list, total: Number.isInteger(body.total_count) ? body.total_count : list.length };
  }

  // Issues that were in my open list last time and are not now (closed or reassigned), kept for 24 h.
  // Only compared when both lists were complete (≤ MAX_ISSUES), so the 50-issue cut never looks like a close.
  trackGone({ list, total }, now) {
    const complete = total <= list.length;
    const cur = new Map(list.map((i) => [i.id, { updatedOn: i.updatedOn, subject: i.subject }]));
    let gone = (this.data.gone || []).filter((g) => now - g.at < GONE_KEEP_MS && !cur.has(g.id));
    if (this.prev?.complete && complete) {
      const known = new Set(gone.map((g) => g.id));
      for (const [id, p] of this.prev.map) if (!cur.has(id) && !known.has(id)) gone.push({ id, subject: p.subject, at: now });
    }
    // which issues to read the newest journal of: first time the 10 most recently updated, then whatever changed
    if (!this.prev) {
      for (const i of list.slice(0, ACTIVITY_PER_REFRESH)) this.wanted.add(i.id);
    } else {
      for (const i of list) if (this.prev.map.get(i.id)?.updatedOn !== i.updatedOn) this.wanted.add(i.id);
    }
    for (const id of this.wanted) if (!cur.has(id)) this.wanted.delete(id);
    for (const id of this.activity.keys()) if (!cur.has(id)) this.activity.delete(id);
    this.prev = { map: cur, complete };
    return gone.sort((a, b) => b.at - a.at).slice(0, MAX_ISSUES);
  }

  activityFor(issue) {
    const c = this.activity.get(issue.id);
    return c && c.updatedOn === issue.updatedOn ? c.lastActivity : null;
  }

  async fetchMyId() {
    if (this.myId !== null) return this.myId;
    try {
      const id = Number((await this.get('/users/current.json'))?.user?.id);
      if (Number.isInteger(id) && id > 0) this.myId = id;
    } catch { /* try again next refresh; byMe stays unknown meanwhile */ }
    return this.myId;
  }

  // Read the newest journal of changed issues (≤10 per refresh, 3 at a time). Cached by updated_on.
  async fetchActivity(list) {
    const todo = list.filter((i) => this.wanted.has(i.id)).slice(0, ACTIVITY_PER_REFRESH);
    if (!todo.length) return;
    const myId = await this.fetchMyId();
    const queue = todo.slice();
    const worker = async () => {
      for (let i = queue.shift(); i; i = queue.shift()) {
        try {
          const body = await this.get(`/issues/${i.id}.json?include=journals`);
          const issue = body?.issue;
          // the issue may have changed again between the two requests: cache under the time it reports
          const updatedOn = typeof issue?.updated_on === 'string' ? issue.updated_on : i.updatedOn;
          this.activity.set(i.id, { updatedOn, lastActivity: lastActivityOf(issue, myId) });
          // without my id, byMe is unknown: read it again once the id is known
          if (updatedOn === i.updatedOn && myId !== null) this.wanted.delete(i.id);
        } catch { /* stays wanted, retried next refresh */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ACTIVITY_CONCURRENCY, queue.length) }, worker));
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    this.onUpdate(this.data);
  }
}
