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
  lastEvent: null,    // the newest live hook event; snapshots never set it, so reloads stay silent
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
      return { ...state, conn: 'live', serverStartedAt: action.serverStartedAt, sessions, feed: action.feed.slice(-FEED_LIMIT), redmine: action.redmine ?? null, tokens: action.tokens ?? null, holidays: action.holidays ?? null, lastEvent: null, lastMessageAt: Date.now() };
    }
    case 'event': {
      const feed = state.feed.length >= FEED_LIMIT ? state.feed.slice(1 - FEED_LIMIT) : state.feed.slice();
      feed.push(action.item);
      return { ...state, sessions: { ...state.sessions, [action.session.id]: action.session }, feed, lastEvent: { session: action.session, item: action.item }, lastMessageAt: Date.now() };
    }
    case 'session': // a session changed without a new hook event (e.g. token usage was re-read)
      return { ...state, sessions: { ...state.sessions, [action.session.id]: action.session }, lastMessageAt: Date.now() };
    case 'redmine':
      return { ...state, redmine: action.redmine, lastMessageAt: Date.now() };
    case 'tokens':
      return { ...state, tokens: action.tokens, lastMessageAt: Date.now() };
    case 'holidays':
      return { ...state, holidays: action.holidays, lastMessageAt: Date.now() };
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
export function offDays(holidays, leave = []) {
  const out = {};
  for (const d of leave) if (typeof d === 'string') out[d] = { kind: 'leave', name: 'วันลา/วันหยุดส่วนตัว' };
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
