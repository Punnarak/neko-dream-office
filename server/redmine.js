// Open Redmine issues assigned to the current user.
// The backend fetches them (the API key never reaches the browser) and pushes a
// trimmed list over the WebSocket. Fetches only while at least one page is open.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clean } from './sanitize.js';

const CONFIG_FILE = path.join(os.homedir(), '.config', 'neko-dream-office', 'redmine.json');
const TIMEOUT_MS = 10_000;
const MANUAL_GAP_MS = 30_000;
const MAX_ISSUES = 50;

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
  const log = [];
  for (const e of entries) {
    const h = hours(e?.hours);
    if (h === null || !isDate(e.spent_on) || e.spent_on < from || e.spent_on > today) continue;
    if (e.spent_on >= weekStart) weekHours += h;
    if (e.spent_on >= monthStart) monthHours += h;
    if (e.spent_on >= rangeStart) perDay.set(e.spent_on, (perDay.get(e.spent_on) || 0) + h);
    log.push({
      id: Number(e.id) || null,
      spentOn: e.spent_on,
      createdOn: typeof e.created_on === 'string' ? e.created_on : null,
      issueId: Number(e.issue?.id) || null,
      activity: name(e.activity),
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
  constructor({ config = loadConfig(), intervalMs, onUpdate = () => {} } = {}) {
    this.config = config;
    this.baseUrl = config ? config.url.replace(/\/+$/, '') : null;
    this.intervalMs = Math.max(60_000, intervalMs || 300_000);
    this.onUpdate = onUpdate;
    this.timer = null;
    this.lastAttemptAt = 0;
    this.inFlight = null;
    this.data = { configured: !!config, baseUrl: this.baseUrl, issues: [], total: 0, time: null, timeError: null, fetchedAt: null, error: null, errorAt: null, loading: false };
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
      .then(([issues, t]) => this.set({
        issues: issues.list, total: issues.total, fetchedAt: Date.now(), error: null, errorAt: null,
        time: t.time ?? this.data.time, timeError: t.timeError ?? null,
      }))
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
    const { from, today } = timeRange(now);
    const entries = [];
    // ≤10 pages (1000 entries) covers ~31 days of normal logging; anything beyond is left out.
    for (let offset = 0; offset < 1000; offset += 100) {
      const body = await this.get(`/time_entries.json?user_id=me&from=${from}&to=${today}&limit=100&offset=${offset}`);
      const page = Array.isArray(body.time_entries) ? body.time_entries : [];
      entries.push(...page);
      if (page.length < 100 || entries.length >= body.total_count) break;
    }
    const time = summarizeTime(entries, now);
    // Subjects for logged issues, including ones not assigned to me (one extra request, ≤50 ids).
    const ids = [...new Set(time.log.map((l) => l.issueId).filter(Boolean))].slice(0, 50);
    if (ids.length) {
      try {
        const body = await this.get(`/issues.json?issue_id=${ids.join(',')}&status_id=*&limit=50`);
        for (const i of body.issues || []) if (Number.isInteger(i.id)) time.subjects[i.id] = clean(i.subject || '', 120);
      } catch { /* subjects are optional */ }
    }
    return time;
  }

  async fetchIssues() {
    const body = await this.get(`/issues.json?assigned_to_id=me&status_id=open&sort=updated_on:desc&limit=${MAX_ISSUES}`);
    const list = (Array.isArray(body.issues) ? body.issues : []).map((i) => mapIssue(i, this.baseUrl)).filter(Boolean);
    return { list, total: Number.isInteger(body.total_count) ? body.total_count : list.length };
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    this.onUpdate(this.data);
  }
}
