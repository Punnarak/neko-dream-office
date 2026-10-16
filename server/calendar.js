// Today's meetings for the "วันนี้" card, from iCal (.ics) feeds the user lists in
//   ~/.config/neko-dream-office/calendar.json
//   {"calendars":[{"name":"งาน","url":"https://…/calendar.ics"},{"name":"ส่วนตัว","file":"~/cal.ics"}]}
// Feed URLs are secrets (anyone with the link can read the calendar): they stay in the backend and are
// never sent to the page or logged. The page gets only start/end, title and location of today's and
// tomorrow's events — never descriptions, attendees, organizers or meeting links.
// Fetches only while at least one page is open, like the Redmine feed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clean } from './sanitize.js';

export const CALENDAR_FILE = path.join(os.homedir(), '.config', 'neko-dream-office', 'calendar.json');
const MAX_CALENDARS = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_EVENTS = 60;
const MAX_STEPS = 20_000; // recurrence candidates per event, so a broken rule cannot spin

// ---- config ----

export function loadCalendarConfig(file = CALENDAR_FILE) {
  let cfg;
  try {
    const st = fs.statSync(file);
    if ((st.mode & 0o077) !== 0) console.warn(`[neko] ${file} is readable by other users — run: chmod 600 ${file}`);
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
  const list = Array.isArray(cfg) ? cfg : Array.isArray(cfg?.calendars) ? cfg.calendars : [];
  const out = [];
  for (const c of list.slice(0, MAX_CALENDARS)) {
    const name = typeof c?.name === 'string' ? clean(c.name.trim(), 30) : '';
    let src = null;
    if (typeof c?.url === 'string') {
      const url = c.url.trim().replace(/^webcal:\/\//i, 'https://');
      if (/^https?:\/\/\S{1,2000}$/i.test(url)) src = { url };
    } else if (typeof c?.file === 'string' && c.file.trim()) {
      src = { file: c.file.trim().replace(/^~(?=$|\/)/, os.homedir()) };
    }
    if (src) out.push({ name: name || `ปฏิทิน ${out.length + 1}`, ...src });
  }
  return out.length ? out : null;
}

// ---- iCalendar text -> components ----

const unescapeText = (v) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// One content line -> { name, params, value }. Parameter values may be quoted and hold ':' or ';'.
export function parseLine(line) {
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const parts = head.match(/("[^"]*"|[^;])+/g) || [];
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: (parts[0] || '').toUpperCase(), params, value: line.slice(i + 1) };
}

// Text -> nested { type, props: [{name, params, value}], children: [] } (only what we need).
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const root = { type: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const raw of lines) {
    if (!raw) continue;
    const p = parseLine(raw);
    if (!p) continue;
    const top = stack[stack.length - 1];
    if (p.name === 'BEGIN') {
      const comp = { type: p.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(comp);
      stack.push(comp);
    } else if (p.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      top.props.push(p);
    }
  }
  return root;
}

const prop = (comp, name) => comp.props.find((p) => p.name === name) || null;
const allComps = (comp, type, out = []) => {
  for (const c of comp.children) { if (c.type === type) out.push(c); allComps(c, type, out); }
  return out;
};

// ---- time zones ----

// Outlook / Exchange feeds name zones the Windows way.
const WINDOWS_ZONES = {
  'SE Asia Standard Time': 'Asia/Bangkok', 'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai', 'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul',
  'India Standard Time': 'Asia/Kolkata', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC', 'Coordinated Universal Time': 'UTC', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
};

const zoneOk = new Map();
function ianaZone(tzid) {
  if (!tzid) return null;
  const name = WINDOWS_ZONES[tzid] || tzid.replace(/^\/[^/]*\/[^/]*\//, ''); // "/mozilla.org/20050126_1/Asia/Bangkok"
  if (!zoneOk.has(name)) {
    let ok = true;
    try { new Intl.DateTimeFormat('en-US', { timeZone: name }); } catch { ok = false; }
    zoneOk.set(name, ok);
  }
  return zoneOk.get(name) ? name : null;
}

const fmtCache = new Map();
// Offset (ms) of `zone` from UTC at instant `ms`.
function zoneOffset(zone, ms) {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

// "+0700" / "-0330" -> ms
const parseOffset = (v) => {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(String(v || '').trim());
  return m ? (m[1] === '-' ? -1 : 1) * ((+m[2] * 60 + +m[3]) * 60 + +(m[4] || 0)) * 1000 : null;
};

// Wall-clock fields in a zone -> epoch ms. `zone` is { iana } | { fixed: ms } | null (= this machine's time).
export function wallToMs(w, zone) {
  if (zone?.utc) return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  if (zone?.iana) {
    const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
    let ms = guess - zoneOffset(zone.iana, guess);
    ms = guess - zoneOffset(zone.iana, ms); // second pass settles DST edges
    return ms;
  }
  if (zone && Number.isFinite(zone.fixed)) return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - zone.fixed;
  return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime();
}

// DTSTART-like property -> { wall, allDay, zone } or null.
function readDate(p, vtz) {
  if (!p) return null;
  const v = p.value.trim().split(',')[0];
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const wall = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  if (!m[4] || p.params.VALUE === 'DATE') return { wall: { ...wall, h: 0, mi: 0, s: 0 }, allDay: true, zone: null };
  if (m[7]) return { wall, allDay: false, zone: { utc: true } };
  const tzid = p.params.TZID;
  const iana = ianaZone(tzid);
  if (iana) return { wall, allDay: false, zone: { iana } };
  if (tzid && vtz.has(tzid)) return { wall, allDay: false, zone: { fixed: vtz.get(tzid) } };
  return { wall, allDay: false, zone: null };
}

// VTIMEZONE blocks with names Intl does not know: use their standard offset (no DST rules).
function vtimezones(root) {
  const out = new Map();
  for (const tz of allComps(root, 'VTIMEZONE')) {
    const id = prop(tz, 'TZID')?.value;
    const std = tz.children.find((c) => c.type === 'STANDARD') || tz.children[0];
    const off = std ? parseOffset(prop(std, 'TZOFFSETTO')?.value) : null;
    if (id && off !== null) out.set(id, off);
  }
  return out;
}

// "PT1H30M" / "P1D" -> ms
export function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const ms = ((((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60 + +(m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ---- recurrence (the common subset: DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL,
// BYDAY, BYMONTHDAY, BYMONTH) ----

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000; // days since epoch, for date math
const fromDayNum = (n) => { const t = new Date(n * 86_400_000); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function parseRule(v) {
  const r = {};
  for (const part of String(v || '').split(';')) {
    const [k, val] = part.split('=');
    if (k && val !== undefined) r[k.trim().toUpperCase()] = val.trim().toUpperCase();
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ)) return null;
  return {
    freq: r.FREQ,
    interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
    count: r.COUNT ? Math.max(0, parseInt(r.COUNT, 10) || 0) : null,
    until: r.UNTIL || null,
    byDay: r.BYDAY ? r.BYDAY.split(',').map((x) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x)).filter(Boolean).map((x) => ({ n: x[1] ? +x[1] : 0, day: DAYS.indexOf(x[2]) })) : [],
    byMonthDay: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number).filter((n) => n && Math.abs(n) <= 31) : [],
    byMonth: r.BYMONTH ? r.BYMONTH.split(',').map(Number).filter((n) => n >= 1 && n <= 12) : [],
  };
}

// The days of one month a MONTHLY/YEARLY rule picks, sorted.
function monthDays(rule, y, m, startDay) {
  const len = daysIn(y, m);
  const out = new Set();
  for (const md of rule.byMonthDay) { const d = md > 0 ? md : len + md + 1; if (d >= 1 && d <= len) out.add(d); }
  for (const { n, day } of rule.byDay) {
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const all = [];
    for (let d = 1 + ((day - firstDow + 7) % 7); d <= len; d += 7) all.push(d);
    if (n === 0) all.forEach((d) => out.add(d));
    else { const d = n > 0 ? all[n - 1] : all[all.length + n]; if (d) out.add(d); }
  }
  if (!rule.byMonthDay.length && !rule.byDay.length && startDay <= len) out.add(startDay);
  return [...out].sort((a, b) => a - b);
}

// Start dates ({y,m,d}) of a rule, from the first one on, in order. Stops by itself after MAX_STEPS.
export function* ruleDates(rule, s) {
  const start = dayNum(s.y, s.m, s.d);
  let steps = 0;
  if (rule.freq === 'DAILY') {
    for (let n = start; steps++ < MAX_STEPS; n += rule.interval) yield fromDayNum(n);
  } else if (rule.freq === 'WEEKLY') {
    const sDow = new Date(start * 86_400_000).getUTCDay();
    const monday = start - ((sDow + 6) % 7); // week starts on Monday (WKST=MO, the default)
    const offs = (rule.byDay.length ? rule.byDay.map((b) => b.day) : [sDow]).map((d) => (d + 6) % 7).sort((a, b) => a - b);
    for (let w = monday; steps < MAX_STEPS; w += 7 * rule.interval) {
      for (const o of offs) { steps++; if (w + o >= start) yield fromDayNum(w + o); }
    }
  } else {
    const months = rule.freq === 'YEARLY' ? (rule.byMonth.length ? rule.byMonth : [s.m]) : null;
    for (let k = 0; steps < MAX_STEPS; k += rule.interval) {
      const list = rule.freq === 'MONTHLY'
        ? [{ y: s.y + Math.floor((s.m - 1 + k) / 12), m: ((s.m - 1 + k) % 12) + 1 }]
        : months.map((m) => ({ y: s.y + k, m }));
      for (const { y, m } of list) {
        if (rule.freq === 'MONTHLY' && rule.byMonth.length && !rule.byMonth.includes(m)) { steps++; continue; }
        // YEARLY without BYDAY/BYMONTHDAY repeats on the start's day of month
        for (const d of monthDays(rule, y, m, s.d)) { steps++; if (dayNum(y, m, d) >= start) yield { y, m, d }; }
      }
      steps++;
    }
  }
}

// ---- events -> occurrences inside [from, to) ----

const dateKey = (w) => `${w.y}${String(w.m).padStart(2, '0')}${String(w.d).padStart(2, '0')}`;

// Parsed calendar -> [{ start, end, allDay, title, location, uid }] overlapping [from, to), sorted.
export function eventsBetween(root, from, to) {
  const vtz = vtimezones(root);
  const out = [];
  const events = allComps(root, 'VEVENT');
  // Moved / edited single occurrences (RECURRENCE-ID) replace the generated ones of the same UID.
  const moved = new Map();
  for (const ev of events) {
    const rid = readDate(prop(ev, 'RECURRENCE-ID'), vtz);
    const uid = prop(ev, 'UID')?.value || '';
    if (!rid) continue;
    if (!moved.has(uid)) moved.set(uid, new Set());
    moved.get(uid).add(rid.allDay ? dateKey(rid.wall) : wallToMs(rid.wall, rid.zone));
  }
  for (const ev of events) {
    if ((prop(ev, 'STATUS')?.value || '').trim().toUpperCase() === 'CANCELLED') continue;
    const st = readDate(prop(ev, 'DTSTART'), vtz);
    if (!st) continue;
    const uid = prop(ev, 'UID')?.value || '';
    const endP = readDate(prop(ev, 'DTEND'), vtz);
    const dur = parseDuration(prop(ev, 'DURATION')?.value);
    const toMs = (w) => wallToMs(w, st.zone);
    const firstStart = toMs(st.wall);
    const length = endP ? Math.max(0, wallToMs(endP.wall, endP.zone) - firstStart)
      : dur !== null ? Math.max(0, dur) : st.allDay ? 86_400_000 : 0;
    const base = {
      allDay: st.allDay,
      title: clean(unescapeText(prop(ev, 'SUMMARY')?.value || ''), 100) || '(ไม่มีชื่อ)',
      location: clean(unescapeText(prop(ev, 'LOCATION')?.value || ''), 60) || null,
      uid,
    };
    const push = (startMs) => {
      // all-day events keep their calendar days whatever the zone (DST cannot shift them by an hour)
      const end = st.allDay ? startMs + Math.round(length / 86_400_000) * 86_400_000 : startMs + length;
      if (startMs < to && (end > from || (end === startMs && startMs >= from))) out.push({ start: startMs, end, ...base });
    };
    const ruleP = prop(ev, 'RRULE');
    const rule = ruleP && !prop(ev, 'RECURRENCE-ID') ? parseRule(ruleP.value) : null;
    if (!rule) { push(firstStart); continue; }

    const exdates = new Set();
    for (const p of ev.props.filter((x) => x.name === 'EXDATE')) {
      for (const v of p.value.split(',')) {
        const d = readDate({ ...p, value: v }, vtz);
        if (d) exdates.add(d.allDay || st.allDay ? dateKey(d.wall) : wallToMs(d.wall, d.zone));
      }
    }
    const skip = moved.get(uid);
    let until = null;
    if (rule.until) {
      const u = readDate({ name: 'UNTIL', params: {}, value: rule.until }, vtz);
      if (u) until = u.allDay ? wallToMs({ ...u.wall, h: 23, mi: 59, s: 59 }, st.allDay ? null : st.zone) : wallToMs(u.wall, u.zone);
    }
    let n = 0;
    for (const day of ruleDates(rule, st.wall)) {
      const w = { ...st.wall, y: day.y, m: day.m, d: day.d };
      const ms = toMs(w);
      if (until !== null && ms > until) break;
      if (rule.count !== null && n >= rule.count) break;
      n++;
      if (ms >= to) break;
      const key = st.allDay ? dateKey(w) : ms;
      if (exdates.has(key) || skip?.has(key)) continue;
      push(ms);
    }
  }
  return out.sort((a, b) => a.start - b.start || b.allDay - a.allDay || a.title.localeCompare(b.title));
}

// Local midnight today and two days later: today's and tomorrow's events.
export function windowOf(now = Date.now()) {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { from, to: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2).getTime() };
}

// ---- fetching ----

async function readLimited(res) {
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_BYTES) throw new Error('ไฟล์ใหญ่เกินไป');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error('ไฟล์ใหญ่เกินไป'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// One calendar's text. Errors say what went wrong without the URL (it is a secret).
export async function loadText(cal, fetchImpl = fetch) {
  if (cal.file) {
    let st;
    try { st = fs.statSync(cal.file); } catch { throw new Error('ไม่พบไฟล์'); }
    if (!st.isFile()) throw new Error('ไม่ใช่ไฟล์');
    if (st.size > MAX_BYTES) throw new Error('ไฟล์ใหญ่เกินไป');
    return fs.readFileSync(cal.file, 'utf8');
  }
  let res;
  try {
    res = await fetchImpl(cal.url, { headers: { Accept: 'text/calendar, */*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(e?.name === 'TimeoutError' ? 'หมดเวลาเชื่อมต่อ' : 'เชื่อมต่อไม่ได้');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readLimited(res);
}

// Normalized { name, url } from what the page sent, or null.
export function calendarFromInput(input) {
  const url = typeof input?.url === 'string' ? input.url.trim().replace(/^webcal:\/\//i, 'https://') : '';
  if (!/^https?:\/\/\S{1,2000}$/i.test(url)) return null;
  const name = typeof input?.name === 'string' ? clean(input.name.trim(), 30) : '';
  return { name: name || 'ปฏิทิน', url };
}

// Writes the config (owner-only: the URLs are secrets). Atomic: a temp file renamed over the old one.
export function saveCalendarConfig(calendars, file = CALENDAR_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ calendars }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export class CalendarFeed {
  constructor({ config, file = CALENDAR_FILE, intervalMs, onUpdate = () => {}, fetchImpl = fetch } = {}) {
    this.file = file;
    this.config = config !== undefined ? config : loadCalendarConfig(file);
    this.active = false;
    this.intervalMs = Math.max(60_000, intervalMs || 900_000);
    this.onUpdate = onUpdate;
    this.fetchImpl = fetchImpl;
    this.timer = null;
    this.inFlight = null;
    this.day = null;
    this.data = this.emptyData();
  }

  emptyData() {
    return { configured: !!this.config, events: [], calendars: (this.config || []).map((c) => ({ name: c.name, error: null })), fetchedAt: null };
  }

  // The page's "เชื่อมต่อปฏิทิน" form: fetch the feed once, and only when it really is a calendar
  // save it and start showing it. Returns { ok } or { ok: false, error } (never the URL).
  async connect(input) {
    const cal = calendarFromInput(input);
    if (!cal) return { ok: false, error: 'ลิงก์ต้องขึ้นต้นด้วย https://, http:// หรือ webcal://' };
    let text;
    try { text = await loadText(cal, this.fetchImpl); }
    catch (e) { return { ok: false, error: `ดึงปฏิทินไม่ได้: ${clean(e?.message || '', 60)}` }; }
    if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, error: 'ลิงก์นี้ไม่ใช่ไฟล์ iCal (.ics)' };
    const list = [...(this.config || []).filter((c) => c.url !== cal.url), cal].slice(-MAX_CALENDARS);
    try { saveCalendarConfig(list, this.file); }
    catch { return { ok: false, error: 'บันทึก calendar.json ไม่ได้' }; }
    this.config = loadCalendarConfig(this.file);
    this.day = null;
    this.data = this.emptyData();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.active) this.setActive(true); // fetches now and keeps the schedule
    else this.onUpdate(this.data);
    return { ok: true };
  }

  snapshot() { return this.data; }

  setActive(active) {
    this.active = active;
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

  // Called on the backend's periodic tick: after midnight the window moves, so fetch again.
  checkDay(now = Date.now()) {
    const { from } = windowOf(now);
    if (this.config && this.timer && this.day !== null && this.day !== from) this.refresh();
  }

  refresh(now = () => Date.now()) {
    if (!this.config || this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      const { from, to } = windowOf(now());
      const results = await Promise.all(this.config.map(async (cal) => {
        try {
          const events = eventsBetween(parseIcs(await loadText(cal, this.fetchImpl)), from, to);
          return { name: cal.name, error: null, events };
        } catch (e) {
          return { name: cal.name, error: clean(e?.message || 'อ่านไม่ได้', 60), events: null };
        }
      }));
      const prevByCal = new Map();
      for (const e of this.data.events) { if (!prevByCal.has(e.cal)) prevByCal.set(e.cal, []); prevByCal.get(e.cal).push(e); }
      const events = [];
      for (const [i, r] of results.entries()) {
        // a failed fetch keeps the last good events of that calendar (they are still today's)
        const list = r.events ? r.events.map(({ uid, ...e }) => ({ ...e, cal: i })) : (this.day === from ? prevByCal.get(i) || [] : []);
        events.push(...list);
      }
      events.sort((a, b) => a.start - b.start || b.allDay - a.allDay);
      this.day = from;
      this.data = {
        configured: true,
        events: events.slice(0, MAX_EVENTS),
        calendars: results.map((r) => ({ name: r.name, error: r.error })),
        fetchedAt: Date.now(),
      };
      this.onUpdate(this.data);
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}
