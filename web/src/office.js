// Shared constants and the reducer that merges backend messages into UI state.

export const FEED_LIMIT = 100;
export const STALE_MS = 10 * 60 * 1000;

export const STATUS = {
  idle:        { en: 'Idle',           th: 'รอคำสั่ง',             tone: 'calm' },
  working:     { en: 'Working',        th: 'กำลังทำงาน',           tone: 'busy' },
  tool:        { en: 'Using Tool',     th: 'กำลังใช้เครื่องมือ',     tone: 'busy' },
  waiting:     { en: 'Needs You',      th: 'รอคุณอนุญาต',          tone: 'warn' },
  error:       { en: 'Error',          th: 'เกิดข้อผิดพลาด',        tone: 'error' },
  interrupted: { en: 'Interrupted',    th: 'ถูกขัดจังหวะ',          tone: 'warn' },
  completed:   { en: 'Turn Completed', th: 'ตอบจบเทิร์น รอคำสั่ง',  tone: 'done' },
  stopped:     { en: 'Stopped',        th: 'ปิด session แล้ว',      tone: 'off' },
};

// The six cats are office roles. Each one lights up only for real tool events in its category.
export const CATS = [
  { key: 'manage',   name: 'Nori',    role: 'Manager Cat',  fur: '#e3bf98', accent: '#c98f6b', tools: 'สถานะรวมของ session ที่เลือก' },
  { key: 'code',     name: 'Mochi',   role: 'Coding Cat',   fur: '#fff3e6', accent: '#f4a6c1', tools: 'Edit · Write · NotebookEdit' },
  { key: 'research', name: 'Miso',    role: 'Research Cat', fur: '#f8c99a', accent: '#e8925a', tools: 'WebSearch · WebFetch · MCP tools' },
  { key: 'data',     name: 'Luna',    role: 'Data Cat',     fur: '#cfc8ee', accent: '#9c8fd6', tools: 'Read · Grep · Glob' },
  { key: 'creative', name: 'Pudding', role: 'Creative Cat', fur: '#f6dfa8', accent: '#e0b14e', tools: 'Agent (สั่งงาน subagent)' },
  { key: 'qa',       name: 'Pixel',   role: 'QA Cat',       fur: '#bcd9ec', accent: '#6fa5cf', tools: 'Bash' },
];

export const initialState = {
  conn: 'connecting', // connecting | live | disconnected
  mode: 'live',       // live | demo
  serverStartedAt: null,
  sessions: {},
  feed: [],
  lastMessageAt: null,
  redmine: null,      // Redmine issues pushed by the backend (null = not received yet)
  tokens: null,       // daily token totals across all transcripts (null = not received yet)
  holidays: null,     // { list: [{ date, name }], configured, error } from the optional holidays.json
  claudeTime: null,   // { days: [{ date, items: [{ ticket, project, ms }] }] } — how long Claude worked per ticket
  lastEvent: null,    // the newest live hook event; snapshots never set it, so reloads stay silent
  redmineLive: false, // true once Redmine data came as a live push (not a snapshot): only then may it alert
};

export function reducer(state, action) {
  switch (action.type) {
    case 'conn':
      return { ...state, conn: action.conn };
    case 'mode':
      return { ...initialState, mode: action.mode, conn: action.mode === 'demo' ? 'live' : 'connecting' };
    case 'snapshot': {
      const sessions = {};
      for (const s of action.sessions) sessions[s.id] = s;
      return { ...state, conn: 'live', serverStartedAt: action.serverStartedAt, sessions, feed: action.feed.slice(-FEED_LIMIT), redmine: action.redmine ?? null, redmineLive: false, tokens: action.tokens ?? null, holidays: action.holidays ?? null, claudeTime: action.claudeTime ?? null, lastEvent: null, lastMessageAt: Date.now() };
    }
    case 'event': {
      const feed = state.feed.length >= FEED_LIMIT ? state.feed.slice(1 - FEED_LIMIT) : state.feed.slice();
      feed.push(action.item);
      return { ...state, sessions: { ...state.sessions, [action.session.id]: action.session }, feed, lastEvent: { session: action.session, item: action.item }, lastMessageAt: Date.now() };
    }
    case 'session': // a session changed without a new hook event (e.g. token usage was re-read)
      return { ...state, sessions: { ...state.sessions, [action.session.id]: action.session }, lastMessageAt: Date.now() };
    case 'redmine':
      return { ...state, redmine: action.redmine, redmineLive: true, lastMessageAt: Date.now() };
    case 'tokens':
      return { ...state, tokens: action.tokens, lastMessageAt: Date.now() };
    case 'holidays':
      return { ...state, holidays: action.holidays, lastMessageAt: Date.now() };
    case 'claudeTime':
      return { ...state, claudeTime: action.claudeTime, lastMessageAt: Date.now() };
    default:
      return state;
  }
}

// Work out what each cat should show for one session, using only that session's real data.
export function catView(cat, session, conn, now) {
  if (conn !== 'live') return { pose: 'off', chip: null };
  if (!session) return { pose: 'sleep', chip: null };

  const stale = session.status !== 'stopped' && now - (session.lastEventAt || 0) > STALE_MS;

  const agents = agentsOf(session);

  if (cat.key === 'manage') {
    const st = STATUS[session.status] || STATUS.idle;
    const pose =
      session.status === 'stopped' ? 'sleep'
      : session.status === 'error' ? 'error'
      : session.status === 'waiting' || session.status === 'interrupted' ? 'alert'
      : st.tone === 'busy' ? 'busy'
      : 'awake';
    const text = agents.length ? `${st.en} · ${countAgents(agents.length)}` : st.en;
    return { pose, chip: { tone: stale ? 'stale' : st.tone, text, short: st.en }, stale };
  }

  // A desk lead summarizes its desk: the tools running in its category and the kittens sitting there.
  const mine = session.tools.filter((t) => t.category === cat.key);
  if (mine.length) {
    const names = [...new Set(mine.map((t) => t.name))];
    const here = agents.filter((a) => a.tool?.category === cat.key).length;
    const tools = names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
    // short = the real tool text only, for phones (the kittens at the desk already show the count)
    return { pose: 'busy', chip: { tone: 'busy', text: here ? `${tools} · ${countAgents(here)}` : tools, short: tools }, tools: mine };
  }
  const err = session.status === 'error' && session.lastError;
  if (err && err.tool && categoryOf(err.tool) === cat.key) {
    return { pose: 'error', chip: { tone: 'error', text: 'Error' } };
  }
  return { pose: 'sleep', chip: null };
}

// ---- Agents as kittens ----

export const countAgents = (n) => `${n} agent${n > 1 ? 's' : ''}`;
export const agentsOf = (session) => session?.agents ?? [];
export const agentLabel = (a) => (a.main ? 'Main' : a.type || 'subagent');
// Up to 5 characters for the kitten name tag on phones (full name stays in title / aria-label):
// "general-purpose" -> "GP", "plugin:fleet-auditor" -> "FA", "Explore" -> "Expl", "Plan" -> "Plan".
export function agentShort(a) {
  const name = agentLabel(a).split(':').pop();
  if (name.length <= 5) return name;
  const words = name.split(/[-_\s]+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0].toUpperCase()).join('').slice(0, 4);
  return name.slice(0, 4);
}

// ---- Chubbiness: real token usage per agent (from its transcript; see server/usage.js) ----
// `usage.total` = input + output + cache_creation tokens (cache_read is shown but not counted:
// it is the cached prompt re-read every turn and would make every long session look the same).
// Thresholds are absolute and were picked from real transcripts on this machine: subagents are
// mostly 50k–200k, main sessions mostly 70k–900k, a few reach several million.
export const CHUBBY = [
  { max: 20_000,    key: 'slim',   th: 'ผอมเพรียว' },
  { max: 100_000,   key: 'normal', th: 'หุ่นปกติ' },
  { max: 300_000,   key: 'chubby', th: 'จ้ำม่ำ' },
  { max: 1_000_000, key: 'round',  th: 'กลมป๊อก' },
  { max: Infinity,  key: 'xround', th: 'กลมดิ๊กมาก' },
];
// -> level index 0..4, or null when usage is not known (drawn like 'normal').
export function chubbiness(usage) {
  const n = usage?.total;
  if (!Number.isFinite(n) || n < 0) return null;
  return CHUBBY.findIndex((c) => n < c.max);
}
export function formatTokens(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : n < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1).replace(/\.?0+$/, '')}M`;
}

// Where each kitten sits, in % of the scene. Desk spots start at the desk edge and line up away
// from it (dir), wrapping into a row behind after `per` kittens. Idle kittens wait on the rug.
export const KITTEN = { w: 5.6, step: 6, row: 10 };
// Phones (scene ≤ 620 px): bigger kittens, fewer per row so they stay inside the room and off the cats.
export const KITTEN_NARROW = { w: 8, step: 8.5, row: 17 };
export const KITTEN_SPOTS = {
  research: { x: 10,   y: 55, dir: -1, per: 1 },
  code:     { x: 42.8, y: 52, dir: -1, per: 3 },
  data:     { x: 82,   y: 55, dir: 1,  per: 3 },
  qa:       { x: 14,   y: 85, dir: -1, per: 2 },
  manage:   { x: 61.8, y: 89, dir: 1,  per: 2 },
  creative: { x: 88.2, y: 85, dir: 1,  per: 2 },
  rug:      { x: 36.5, y: 95, dir: 0,  per: 2 }, // dir 0 = centered on x; the open rug between Pixel and Nori
};
export const KITTEN_SPOTS_NARROW = Object.fromEntries(Object.entries(KITTEN_SPOTS).map(([k, s]) =>
  [k, { ...s, per: { code: 2, data: 2, rug: 2 }[k] ?? 1 }]));

// Main first, then subagents in the order they started (or were first seen).
const kittenOrder = (a, b) => (b.main - a.main) || ((a.startedAt ?? a.firstSeenAt ?? 0) - (b.startedAt ?? b.firstSeenAt ?? 0));

// -> [{ agent, desk, left, top }] where (left, top) is the kitten's bottom-left corner in %.
export function kittenPlaces(agents, metrics = KITTEN, spots = KITTEN_SPOTS) {
  const groups = {};
  for (const a of agents.slice().sort(kittenOrder)) {
    const desk = spots[a.tool?.category] ? a.tool.category : 'rug';
    (groups[desk] ||= []).push(a);
  }
  const out = [];
  for (const [desk, list] of Object.entries(groups)) {
    const spot = spots[desk];
    list.forEach((agent, i) => {
      const col = i % spot.per;
      const row = Math.floor(i / spot.per);
      const inRow = Math.min(spot.per, list.length - row * spot.per);
      const { step } = metrics;
      const left = spot.dir === 0 ? spot.x - (inRow * step) / 2 + col * step
        : spot.dir > 0 ? spot.x + col * step
        : spot.x - (col + 1) * step;
      out.push({ agent, desk, left: round(left), top: round(spot.y - row * metrics.row) });
    });
  }
  return out;
}
const round = (n) => Math.round(n * 100) / 100;

// Mirror of server/sanitize.js toolCategory for display names (mcp names arrive as "server/tool").
export function categoryOf(name = '') {
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return 'code';
  if (/^(WebSearch|WebFetch)$/.test(name) || name.includes('/')) return 'research';
  if (/^(Read|Grep|Glob|LS)$/.test(name)) return 'data';
  if (/^(Bash|BashOutput|KillShell)$/.test(name)) return 'qa';
  if (/^(Agent|Task)$/.test(name)) return 'creative';
  return 'manage';
}

export function pickDefaultSession(sessions) {
  const list = Object.values(sessions);
  const active = list.filter((s) => s.status !== 'stopped');
  const pool = active.length ? active : list;
  return pool.sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0))[0]?.id ?? null;
}

export const timeOf = (ms) => (ms ? new Date(ms).toLocaleTimeString('th-TH', { hour12: false }) : '—');

export function ago(ms, now) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} วิ`;
  if (s < 3600) return `${Math.floor(s / 60)} นาที`;
  return `${Math.floor(s / 3600)} ชม. ${Math.floor((s % 3600) / 60)} นาที`;
}

// Days from today (local) to a YYYY-MM-DD due date; negative = overdue.
export function daysUntil(dueDate, now) {
  if (!dueDate) return null;
  const [y, m, d] = dueDate.split('-').map(Number);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - today) / 86_400_000);
}

// Earliest due date first; issues without a due date go last, newest update first.
export function sortIssues(issues) {
  return issues.slice().sort((a, b) =>
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (b.updatedOn || '').localeCompare(a.updatedOn || ''));
}

// Which sound (if any) a new hook event deserves, judged by the status it produced.
const SOUND_EVENTS = { waiting: ['Notification'], error: ['PostToolUseFailure', 'StopFailure'], completed: ['Stop'] };
export const SOUND_PRIORITY = { waiting: 3, error: 2, completed: 1 };
export function soundFor(session, item) {
  const kind = session?.status;
  return SOUND_EVENTS[kind]?.includes(item?.event) ? kind : null;
}

// At most one sound per session every gapMs; a more important sound may cut in. Mutates `last`.
export function allowSound(last, sessionId, kind, at, gapMs = 3000) {
  const prev = last[sessionId];
  if (prev && at - prev.at < gapMs && SOUND_PRIORITY[kind] <= SOUND_PRIORITY[prev.kind]) return false;
  last[sessionId] = { kind, at };
  return true;
}

// Day-of-week for a YYYY-MM-DD string, read as a local date (0 = Sunday).
export const dowOf = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
export const isWeekend = (date) => { const w = dowOf(date); return w === 0 || w === 6; };

// Days that are not working days for the time tab: public holidays (holidays.json) and this browser's
// own leave days (localStorage). -> { 'YYYY-MM-DD': { kind: 'holiday' | 'leave', name } }
// `rmLeave` = Redmine leave days from the backend (time.leaveDays: [{ date, hours }]); they win over
// this browser's manual leave (not toggleable off), and holidays win over both.
export function offDays(holidays, leave = [], rmLeave = []) {
  const out = {};
  for (const d of leave) if (typeof d === 'string') out[d] = { kind: 'leave', name: 'วันลา/วันหยุดส่วนตัว' };
  for (const d of rmLeave || []) if (typeof d?.date === 'string') out[d.date] = { kind: 'redmine', name: 'ลา (Redmine)', hours: Number(d.hours) || 0 };
  for (const h of holidays || []) if (h?.date) out[h.date] = { kind: 'holiday', name: h.name || 'วันหยุด' };
  return out;
}

// Stats for the time tab from the backend's zero-filled `daily` list.
// avg = mean over Mon–Fri working days that have logged time (days with 0h are counted in `missing` instead).
// missing = Mon–Fri working days before today with nothing logged.
// `off` (see offDays) = holidays and leave days: they are neither missing nor part of the average.
export function workStats(daily, today, off = {}) {
  const working = (d) => !isWeekend(d.date) && !off[d.date];
  const logged = daily.filter((d) => working(d) && d.hours > 0);
  const sum = logged.reduce((s, d) => s + d.hours, 0);
  return {
    avg: logged.length ? Math.round((sum / logged.length) * 100) / 100 : 0,
    avgDays: logged.length,
    missing: daily.filter((d) => d.date < today && working(d) && d.hours === 0).map((d) => d.date),
    offDays: daily.filter((d) => !isWeekend(d.date) && off[d.date]).map((d) => d.date),
    max: daily.reduce((m, d) => Math.max(m, d.hours), 0),
  };
}

// ---- Alerts (sound + desktop notification) share one rule set ----

// Which alert (if any) a new live hook event deserves for this page: only transitions INTO
// waiting / error / completed, only while live, only for the chosen scope. Snapshots never set
// lastEvent, so a reload or reconnect never alerts.
export function alertFor(ev, { conn, scope, viewedId }) {
  if (!ev || conn !== 'live') return null;
  if (scope === 'viewed' && ev.session?.id !== viewedId) return null;
  return soundFor(ev.session, ev.item);
}

// Desktop notification: same alert rule + per-session throttle (its own `last` map), but only when
// the page is hidden or not focused (a visible page already has the sound), and only with permission.
export function notifyDecision(ev, { enabled, permission, conn, scope, viewedId, visible, last, at }) {
  if (!enabled || permission !== 'granted' || visible) return null;
  const kind = alertFor(ev, { conn, scope, viewedId });
  if (!kind || !allowSound(last, ev.session.id, kind, at)) return null;
  return { kind, ...notifyText(ev.session, kind) };
}

// Status in Thai + project folder name + short session id. Never prompt or tool content.
export function notifyText(session, kind) {
  const id = String(session?.id || '');
  const label = [session?.project, id.slice(0, 8)].filter(Boolean).join(' · ');
  const title = { waiting: '🐾 Claude รอคุณอยู่', error: '🐾 เกิดข้อผิดพลาด', completed: '🐾 ตอบจบเทิร์นแล้ว' }[kind] || '🐾 Neko Dream Office';
  return { title, body: `${STATUS[kind]?.th || kind} — ${label || 'session'}`, tag: `neko-${id}` };
}

// ---- Daily tokens (🪙 tab) ----
// avg = mean over days in the 28-day list that used any tokens (idle days are not counted).
export function tokenStats(daily) {
  const used = daily.filter((d) => d.counted > 0);
  const sum = used.reduce((s, d) => s + d.counted, 0);
  return {
    avg: used.length ? Math.round(sum / used.length) : 0,
    activeDays: used.length,
    max: daily.reduce((m, d) => Math.max(m, d.counted), 0),
  };
}

// ---- Hours: always hours + minutes, never decimal hours (8.49 h is 8 h 29 min, not "8.5") ----
const hm = (h) => { const total = Math.round((h || 0) * 60); return [Math.floor(total / 60), total % 60]; };
// 1.75 -> "1 ชม. 45 น."
export function fmtHours(h) {
  const [hh, mm] = hm(h);
  return hh && mm ? `${hh} ชม. ${mm} น.` : hh ? `${hh} ชม.` : `${mm} น.`;
}
// compact form for chips and badges: 8.49 -> "8:29 ชม.", 8 -> "8:00 ชม.", 0.17 -> "10 น."
export function fmtShort(h) {
  const [hh, mm] = hm(h);
  return hh ? `${hh}:${String(mm).padStart(2, '0')} ชม.` : `${mm} น.`;
}

// ---- Time Claude worked per ticket (🐾) and Redmine's own "log time" form ----

const HOUR_MS = 3_600_000;
const COVERED_MS = 7.5 * 60_000; // less than this still unlogged = already covered

// Hours to suggest in the form: rounded to 15 minutes, never 0 for real work.
export function suggestHours(ms) {
  return ms > 0 ? Math.max(0.25, Math.round(ms / 900_000) / 4) : null;
}

// Redmine's new-time-entry form, pre-filled. Nothing is logged until you press save there.
export function logTimeUrl(base, { issueId, date, hours, activityId } = {}) {
  if (!base) return null;
  const q = new URLSearchParams();
  if (date) q.set('time_entry[spent_on]', date);
  if (hours) q.set('time_entry[hours]', String(hours));
  if (activityId) q.set('time_entry[activity_id]', String(activityId));
  const qs = q.toString();
  return `${base}${issueId ? `/issues/${issueId}` : ''}/time_entries/new${qs ? `?${qs}` : ''}`;
}

// The activity I log most often (never "Leave"), as the form's default.
export function usualActivity(log) {
  const count = new Map();
  for (const l of log || []) if (l.activityId && l.activity !== 'Leave') count.set(l.activityId, (count.get(l.activityId) || 0) + 1);
  let best = null;
  for (const [id, n] of count) if (best === null || n > count.get(best)) best = id;
  return best;
}

// One day of Claude's work next to what I logged that day.
// [{ ticket, project, ms, logged (hours | null without a ticket), suggest (hours still to log | null) }]
export function claudeDay(claudeTime, date, log) {
  const day = claudeTime?.days?.find((d) => d.date === date);
  if (!day) return [];
  const logged = new Map();
  for (const l of log || []) if (l.spentOn === date && l.issueId) logged.set(l.issueId, (logged.get(l.issueId) || 0) + l.hours);
  return day.items.filter((i) => i.ms >= 60_000).map((i) => {
    const done = i.ticket ? logged.get(i.ticket) || 0 : null;
    const left = i.ms - (done || 0) * HOUR_MS;
    return { ...i, logged: done, suggest: left >= COVERED_MS ? suggestHours(left) : null };
  });
}

// Claude's time on one ticket on one day, in ms (0 when unknown).
export function claudeMs(claudeTime, date, ticket) {
  return claudeTime?.days?.find((d) => d.date === date)?.items.find((i) => i.ticket === ticket)?.ms || 0;
}

// ---- Today card (เช้า) and the end-of-day reminder (เย็น): only data the page already has ----

export const DAY_HOURS = 8;
export const isResolved = (i) => /resolved|รอปิด/i.test(i?.status || '');
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const isWorkday = (date, off = {}) => !isWeekend(date) && !off[date];

// The working day before `today` (skipping weekends, holidays and leave), within two weeks.
export function prevWorkday(today, off = {}) {
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 1; i <= 14; i++) {
    const date = dayOf(new Date(y, m - 1, d - i).getTime());
    if (isWorkday(date, off)) return date;
  }
  return null;
}

// Logged hours and still-unlogged Claude work of one day.
function dayStatus(time, claudeTime, date) {
  const hours = time?.daily?.find((x) => x.date === date)?.hours ?? 0;
  const unlogged = claudeDay(claudeTime, date, time?.log).filter((r) => r.suggest);
  return { date, hours, short: Math.max(0, DAY_HOURS - hours), unlogged };
}

// What needs me today. `alerts` = rmAlerts(...) (issue id -> alert). Every part may be empty.
export function todayBrief({ redmine, claudeTime, off = {}, alerts = {}, now }) {
  const time = redmine?.time;
  const today = time?.today || dayOf(now);
  const due = [];
  for (const i of redmine?.issues || []) {
    if (isResolved(i)) continue;
    const d = daysUntil(i.dueDate, now);
    if (d !== null && d <= 0) due.push({ id: i.id, subject: i.subject, url: i.url, days: d });
  }
  due.sort((a, b) => a.days - b.days || a.id - b.id);
  const subjects = Object.fromEntries((redmine?.issues || []).map((i) => [i.id, i.subject]));
  const updates = Object.entries(alerts).map(([id, a]) => ({ id: Number(id), subject: subjects[id], icon: a.icon, text: a.text }));
  const prev = time?.daily ? prevWorkday(today, off) : null;
  // Resolved, yet some branch with its work is not merged into the default branch (backend: local git only).
  const unmerged = (redmine?.issues || [])
    .filter((i) => isResolved(i) && redmine.unmerged?.[i.id]?.length)
    .map((i) => ({ id: i.id, subject: i.subject, url: i.url, repos: [...new Set(redmine.unmerged[i.id].map((b) => b.repo))] }));
  return {
    today,
    workday: isWorkday(today, off),
    due,
    updates,
    unmerged,
    prev: prev && time.daily.some((x) => x.date === prev) ? dayStatus(time, claudeTime, prev) : null,
    now: time ? dayStatus(time, claudeTime, today) : null,
    missing: time?.daily ? workStats(time.daily, today, off).missing : [],
  };
}

// ---- "ขอ merge": a ready-to-send message the user copies and pastes to whoever merges ----

// Greeting and ticket-server URL come from ~/.config/neko-dream-office/merge.json (never in the repo).
export const MERGE_GREETING = 'รบกวน Merge code ให้หน่อยครับ';

// Greeting, subject, issue url, then one line per branch: a ticket-server link for "ticket/<n>" branches,
// "<repo>: <branch>" for anything else. `branches` = redmine.unmerged[id].
export function mergeRequestText(issue, branches, baseUrl, merge = {}) {
  const url = issue?.url || (baseUrl ? `${baseUrl.replace(/\/+$/, '')}/issues/${issue?.id}` : `#${issue?.id}`);
  const lines = [merge.greeting || MERGE_GREETING, issue?.subject || `#${issue?.id}`, url];
  const seen = new Set();
  for (const b of branches || []) {
    const name = String(b.branch || '').replace(/^origin\//, '');
    const m = /^ticket\/(\d+)$/.exec(name);
    const line = m && merge.ticketServer ? `${merge.ticketServer}/${b.repo}.git/${m[1]}` : `${b.repo}: ${name}`;
    if (!seen.has(line)) { seen.add(line); lines.push(line); }
  }
  return lines.join('\n');
}

// "16:30" -> minutes after midnight, or null for "off" / garbage.
export function parseClock(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}

// The end-of-day reminder, once a working day after `at` ("17:00"), when something is still open:
// fewer than 8 h logged today, or Claude worked on a ticket I have not logged. null = nothing to say.
export function endOfDay({ redmine, claudeTime, off = {}, now, at, done }) {
  const mins = parseClock(at);
  const time = redmine?.time;
  if (mins === null || !time?.daily) return null;
  const d = new Date(now);
  const today = dayOf(now);
  if (time.today !== today || done === today || !isWorkday(today, off) || d.getHours() * 60 + d.getMinutes() < mins) return null;
  const st = dayStatus(time, claudeTime, today);
  if (st.short <= 0 && !st.unlogged.length) return null;
  const parts = [`ลงเวลาวันนี้ ${fmtShort(st.hours)} / ${DAY_HOURS} ชม.`];
  if (st.unlogged.length) {
    const list = st.unlogged.slice(0, 3).map((r) => (r.ticket ? `#${r.ticket} ${fmtShort(r.suggest)}` : `${r.project || 'ไม่ทราบเลขงาน'} ${fmtShort(r.suggest)}`));
    parts.push(`Claude ทำยังไม่ลง: ${list.join(', ')}${st.unlogged.length > 3 ? ' …' : ''}`);
  }
  return { date: today, title: '⏱ ก่อนเลิกงาน', body: parts.join(' · '), tag: 'neko-eod' };
}

// ---- Redmine "มีอัปเดต": per-browser seen map { issueId: updatedOn } vs. what the backend reports ----

export const RM_ALERT = {
  new:      { icon: '🆕', text: 'ใหม่', say: 'งานใหม่' },
  comment:  { icon: '💬', text: 'มีคนตอบ', say: 'มีคนตอบ' },
  assignee: { icon: '👤', text: 'มอบหมายใหม่', say: 'มอบหมายใหม่' },
  status:   { icon: '🔄', text: 'เปลี่ยนสถานะ', say: 'เปลี่ยนสถานะ' },
  priority: { icon: '❗', text: 'เปลี่ยนความสำคัญ', say: 'เปลี่ยนความสำคัญ' },
  due:      { icon: '📅', text: 'เปลี่ยนกำหนดส่ง', say: 'เปลี่ยนกำหนดส่ง' },
  other:    { icon: '✏️', text: 'อัปเดต', say: 'มีอัปเดต' },
};
const RM_SEEN_MAX = 300;

// null = nothing for me to look at. "new" = not in seen; "updated" = changed since seen and not by me.
export function rmAlert(issue, seen) {
  if (!issue || !seen || typeof issue.updatedOn !== 'string') return null;
  const la = issue.lastActivity;
  if (la?.byMe === true) return null;
  const mine = seen[issue.id];
  const kind = mine === undefined ? 'new' : issue.updatedOn > mine ? (RM_ALERT[la?.kinds?.[0]] ? la.kinds[0] : 'other') : null;
  return kind ? { kind, key: `${issue.id}@${issue.updatedOn}`, ...RM_ALERT[kind] } : null;
}

export function rmAlerts(issues, seen) {
  const out = {};
  for (const i of issues || []) { const a = rmAlert(i, seen); if (a) out[i.id] = a; }
  return out;
}

// Mark these issues seen at their current updatedOn; keeps the newest RM_SEEN_MAX entries.
export function rmMarkSeen(seen, issues) {
  const next = { ...(seen || {}) };
  for (const i of issues || []) if (i && typeof i.updatedOn === 'string') next[i.id] = i.updatedOn;
  const ids = Object.keys(next);
  if (ids.length <= RM_SEEN_MAX) return next;
  return Object.fromEntries(ids.map((id) => [id, next[id]]).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, RM_SEEN_MAX));
}

// Read the stored seen map; anything malformed counts as "never stored".
export function rmParseSeen(text) {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return Object.fromEntries(Object.entries(v).filter(([id, at]) => /^\d+$/.test(id) && typeof at === 'string'));
  } catch { return null; }
}

// Alerts that were not there before. known = Set of alert keys already counted (mutated).
export function rmFreshAlerts(known, alerts) {
  const fresh = [];
  for (const [id, a] of Object.entries(alerts)) if (!known.has(a.key)) { known.add(a.key); fresh.push({ id: Number(id), ...a }); }
  return fresh;
}

export function rmNotifyText(alert, subject) {
  const s = (subject || '').length > 60 ? `${subject.slice(0, 59)}…` : subject || '';
  return { title: '📋 Redmine', body: `#${alert.id} ${alert.say}${s ? ` — ${s}` : ''}`, tag: `neko-rm-${alert.id}` };
}
