// DEMO MODE ONLY (?demo=1). Scripted, clearly fake events for previewing the UI
// without Claude Code. Never loaded in live mode.

const SID = 'DEMO-0000-not-a-real-session';
const script = [
  ['SessionStart', 'idle', 'เริ่ม session (demo)'],
  ['UserPromptSubmit', 'working', 'ได้รับคำสั่งใหม่'],
  ['PreToolUse', 'tool', 'ใช้ Read', { name: 'Read', category: 'data', summary: 'App.jsx' }],
  ['PostToolUse', 'working', 'Read ทำงานเสร็จ'],
  ['PreToolUse', 'tool', 'ใช้ Edit', { name: 'Edit', category: 'code', summary: 'App.jsx' }],
  ['PostToolUse', 'working', 'Edit ทำงานเสร็จ'],
  ['PreToolUse', 'tool', 'ใช้ WebSearch', { name: 'WebSearch', category: 'research', summary: 'pastel palettes' }],
  ['PostToolUse', 'working', 'WebSearch ทำงานเสร็จ'],
  ['PreToolUse', 'tool', 'ใช้ Bash', { name: 'Bash', category: 'qa', summary: 'npm — run tests' }],
  ['PostToolUseFailure', 'error', 'Bash ล้มเหลว', null, 'Exit code 1 · 1 test failed (demo)'],
  ['PreToolUse', 'tool', 'ใช้ Agent', { name: 'Agent', category: 'creative', summary: 'Explore — demo' }],
  ['PostToolUse', 'working', 'Agent ทำงานเสร็จ'],
  ['Notification', 'waiting', 'รอการอนุญาตจากคุณ'],
  ['Stop', 'completed', 'ตอบจบเทิร์น รอคำสั่งถัดไป'],
];

// Demo kittens: one Explore subagent that walks between desks (null = waiting on the rug),
// plus a short-lived Plan subagent so two kittens share a desk. Fake, like everything here.
const EXPLORE_ID = 'demo-explore';
const PLAN_ID = 'demo-plan';
const explore = [undefined, undefined,
  { name: 'Read', category: 'data', summary: 'office.js' }, { name: 'Grep', category: 'data', summary: 'kitten' },
  { name: 'WebFetch', category: 'research', summary: 'example.com' }, null,
  { name: 'Bash', category: 'qa', summary: 'ls' }, { name: 'Glob', category: 'data', summary: '*.jsx' },
  null, { name: 'Edit', category: 'code', summary: 'notes.md' }, null];
const plan = { 10: null, 11: { name: 'Read', category: 'data', summary: 'README.md' } };

// FAKE token usage (demo only) so every chubbiness level shows up: Main grows from "round" past
// 1M to "very round", Explore grows from slim to chubby as it walks, Plan stays slim.
const demoUsage = (total) => {
  const cacheCreation = Math.round(total * 0.62);
  const output = Math.round(total * 0.37);
  return { total, input: total - cacheCreation - output, output, cacheCreation, cacheRead: total * 18, messages: Math.max(1, Math.round(total / 9000)), at: Date.now() };
};

export function runDemo(dispatch) {
  let i = 0;
  let seq = 0;
  let toolCalls = 0;
  let lastError;
  const createdAt = Date.now();
  dispatch({ type: 'snapshot', serverStartedAt: createdAt, sessions: [], feed: [] });
  const iso = (msAgo) => new Date(createdAt - msAgo).toISOString().replace(/\.\d+Z$/, 'Z');
  const issue = (id, subject, dueDate, priority, priorityId, status, doneRatio, updatedAgo, lastActivity = null) => ({
    id, subject, dueDate, priority, priorityId, status, doneRatio, project: 'Demo Project', tracker: 'Task', updatedOn: iso(updatedAgo), url: '#demo',
    spentHours: doneRatio / 20, estimatedHours: 5, lastActivity,
  });
  const H = 3600_000;
  // demo only: someone else replied on 1001 and moved 1003 to Feedback; 1005 is new; 1002 was my own edit
  const demoIssues = [
    issue(1001, '(demo) แก้หน้า login ให้รองรับมือถือ', new Date(createdAt + -2 * 86400000).toISOString().slice(0, 10), 'High', 3, 'In Progress', 60,
      0.4 * H, { at: iso(0.4 * H), byMe: false, kinds: ['comment'] }),
    issue(1002, '(demo) ทำรายงานสรุปยอดรายเดือน', new Date(createdAt + 1 * 86400000).toISOString().slice(0, 10), 'Normal', 2, 'New', 0,
      1 * H, { at: iso(1 * H), byMe: true, kinds: ['status'] }),
    issue(1003, '(demo) อัปเดตเอกสาร API', null, 'Low', 1, 'Feedback', 30, 2 * H, { at: iso(2 * H), byMe: false, kinds: ['status'] }),
    issue(1004, '(demo) ปรับสีปุ่มหน้าแรก', null, 'Normal', 2, 'Resolved', 100, 30 * H, { at: iso(30 * H), byMe: false, kinds: ['status'] }),
    issue(1005, '(demo) ตรวจ log การชำระเงินที่ล้มเหลว', null, 'Normal', 2, 'New', 0, 0.2 * H, { at: iso(0.2 * H), byMe: false, kinds: ['other'] }),
  ];
  const demoSeen = { 1001: iso(5 * H), 1002: iso(5 * H), 1003: iso(5 * H), 1004: iso(30 * H) };
  const demoGone = [{ id: 998, subject: '(demo) ย้ายไฟล์ config ไป vault', at: createdAt - 3 * H }];
  const demoTime = demoWorkTime(createdAt);
  dispatch({ type: 'redmine', redmine: { configured: true, baseUrl: null, issues: demoIssues, total: demoIssues.length, gone: demoGone, demoSeen, time: demoTime, timeError: null, fetchedAt: createdAt, error: null, errorAt: null, loading: false } });
  dispatch({ type: 'holidays', holidays: { list: demoHolidays(demoTime.daily), configured: true, error: null } });
  let demoTok = demoTokens(createdAt);
  dispatch({ type: 'tokens', tokens: demoTok });
  // FAKE time Claude worked per ticket (demo only)
  const M = 60_000;
  dispatch({ type: 'claudeTime', claudeTime: { updatedAt: createdAt, days: [
    { date: demoTime.today, items: [{ ticket: 1001, project: null, ms: 130 * M }, { ticket: 1005, project: null, ms: 80 * M }, { ticket: null, project: 'demo-tools', ms: 25 * M }] },
    { date: demoTime.log[2].spentOn, items: [{ ticket: 1003, project: null, ms: 190 * M }] },
  ] } });

  const subs = {};
  const step = () => {
    const n = i % script.length;
    const [event, status, label, tool, error] = script[n];
    const at = Date.now();
    if (tool) toolCalls++;
    if (error) lastError = { at, tool: 'Bash', message: error };
    if (n === 0) { delete subs[EXPLORE_ID]; delete subs[PLAN_ID]; }
    const walk = (id, type, t) => {
      if (t === undefined) { delete subs[id]; return; }
      const a = subs[id] ||= { id, type, main: false, startedAt: at, lastEventAt: at, toolCalls: 0 };
      if (t) { a.toolCalls++; a.lastEventAt = at; }
      a.running = t ? 1 : 0;
      a.usage = demoUsage(type === 'Plan' ? 12_400 : 8_000 + a.toolCalls * 38_000);
      a.tool = t ? { ...t, startedAt: at } : null;
    };
    walk(EXPLORE_ID, 'Explore', explore[n]);
    walk(PLAN_ID, 'Plan', n in plan ? plan[n] : undefined);
    const subTools = Object.values(subs).filter((a) => a.tool).map((a) => ({ id: `${a.id}-${seq}`, agentId: a.id, agentType: a.type, ...a.tool }));
    const mainTool = tool ? { id: `d${seq}`, agentId: 'main', startedAt: at, ...tool } : null;
    const main = { id: 'main', type: 'main', main: true, startedAt: createdAt, lastEventAt: at, toolCalls, running: tool ? 1 : 0, tool: mainTool, usage: demoUsage(640_000 + n * 45_000) };
    const ended = status === 'completed';
    if (ended) { delete subs[EXPLORE_ID]; delete subs[PLAN_ID]; }
    const session = {
      id: SID, project: 'demo-project', model: 'demo', status, statusSince: at, createdAt, lastEventAt: at,
      lastEvent: event, prompts: 1, toolCalls, lastError,
      subagents: Object.values(subs).map(({ id, type, startedAt }) => ({ id, type, startedAt })),
      agents: [main, ...Object.values(subs).map((a) => ({ ...a }))],
      tools: [...(mainTool ? [mainTool] : []), ...(ended ? [] : subTools)],
    };
    if (n === 0 || ended) { // FAKE: today's demo tokens grow a little each turn
      const grow = (v) => ({ counted: v.counted + 61_000, cacheRead: v.cacheRead + 900_000 });
      const daily = demoTok.daily.slice();
      daily[daily.length - 1] = { ...daily.at(-1), ...grow(daily.at(-1)) };
      demoTok = { ...demoTok, daily, today: grow(demoTok.today), week: grow(demoTok.week), month: grow(demoTok.month), updatedAt: Date.now() };
      dispatch({ type: 'tokens', tokens: demoTok });
    }
    dispatch({
      type: 'event', session,
      item: { id: ++seq, at, sessionId: SID, project: 'demo-project', event, label, detail: error || tool?.summary, level: error ? 'error' : 'info', category: tool?.category },
    });
    i++;
  };
  step();
  const id = setInterval(step, 2500);
  return () => clearInterval(id);
}

// FAKE logged time for the time tab (demo only): 28 days of made-up hours, fixed pattern,
// with a couple of empty weekdays so the "not logged" chip has something to show.
const DEMO_PATTERN = [8, 7.5, 8.5, 6, 8, 7, 8, 8, 6.5, 7, 9, 8, 7.5, 8, 7.5, 8, 8, 6.5, 8, 9, 8, 7, 8, 5.5, 9.25, 8, 7.5, 8];
const DEMO_MISSING = [6, 17]; // days ago left empty on purpose (if they are weekdays)
function demoWorkTime(at) {
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date(at);
  const day = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  const daily = [];
  for (let i = 27; i >= 0; i--) {
    const d = day(i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const h = i === 0 ? 3.5 : i === 1 ? 8.75 : weekend ? (i === 9 ? 2 : 0) : DEMO_MISSING.includes(i) ? 0 : DEMO_PATTERN[i];
    daily.push({ date: ymd(d), hours: h });
  }
  const today = ymd(now);
  const yesterday = ymd(day(1));
  const weekStart = ymd(day((now.getDay() + 6) % 7));
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const sum = (from) => daily.filter((d) => d.date >= from).reduce((s, d) => s + d.hours, 0);
  const entry = (id, spentOn, issueId, activity, hours, comment) => ({ id, spentOn, createdOn: null, issueId, activity, hours, comment });
  // FAKE Redmine leave day (demo only): the first logged weekday 12+ days ago, logged as activity "Leave".
  const leaveDay = daily.slice(0, -12).reverse().find((d) => d.hours > 0 && ![0, 6].includes(new Date(`${d.date}T00:00`).getDay()));
  const leaveDays = leaveDay ? [{ date: leaveDay.date, hours: leaveDay.hours }] : [];
  return {
    leaveDays,
    today, weekStart, monthStart, rangeStart: daily[0].date, daily,
    todayHours: 3.5, weekHours: sum(weekStart), monthHours: sum(monthStart), subjects: {}, todayByIssue: [],
    log: [
      entry(1, today, 1001, 'Development', 2.5, '(demo) ทำหน้า login'),
      entry(2, today, 1002, 'Design', 1, '(demo) ร่างรายงาน'),
      entry(3, yesterday, 1003, 'Documentation', 8.75, '(demo) เขียนเอกสาร'),
      ...daily.slice(0, -2).filter((d) => d.hours > 0).reverse()
        .map((d, n) => d.date === leaveDay?.date
          ? entry(10 + n, d.date, null, 'Leave', d.hours, '(demo) ลาพักร้อน')
          : entry(10 + n, d.date, 1001 + (n % 4), 'Development', d.hours, '(demo) งานจำลอง')),
    ],
    // FAKE commit ↔ logged time match (demo only)
    commits: {
      from: weekStart, source: 'file', scanned: 3, missing: [], noTicket: 2, checked: 4,
      tickets: [
        { id: 1005, repos: ['demo-api'], commits: 3, days: [today], lastCommit: today, hours: 0, loggedDays: 0, lastLog: null, state: 'none', found: true },
        { id: 99999, repos: ['demo-web'], commits: 1, days: [today], lastCommit: today, hours: 0, loggedDays: 0, lastLog: null, state: 'none', found: false },
      ],
    },
  };
}

// FAKE holiday (demo only): one empty weekday in the chart is a "(demo) holiday" so the hatched style shows.
function demoHolidays(daily) {
  const d = daily.slice(0, -1).reverse().find((x) => x.hours === 0 && ![0, 6].includes(new Date(`${x.date}T12:00`).getDay()));
  return d ? [{ date: d.date, name: '(demo) วันหยุดตัวอย่าง' }] : [];
}

// FAKE daily token totals (demo only): a made-up 28-day pattern, quieter on weekends.
const DEMO_TOKENS = [820, 1240, 960, 0, 0, 1530, 1110, 640, 1880, 1320, 90, 0, 1720, 980, 1260, 2140, 1450, 0, 310, 1190, 1640, 870, 1380, 1910, 0, 0, 1460, 720];
function demoTokens(at) {
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date(at);
  const daily = DEMO_TOKENS.map((k, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (27 - i));
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const counted = (weekend ? Math.round(k / 4) : k) * 1000;
    return { date: ymd(d), counted, cacheRead: counted * 23 };
  });
  const weekStart = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const sum = (from) => daily.filter((d) => d.date >= from).reduce((s, d) => ({ counted: s.counted + d.counted, cacheRead: s.cacheRead + d.cacheRead }), { counted: 0, cacheRead: 0 });
  return { daily, today: sum(daily.at(-1).date), week: sum(weekStart), month: sum(monthStart), weekStart, monthStart, updatedAt: at, ready: true };
}
