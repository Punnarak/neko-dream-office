import { useEffect, useMemo, useRef, useState } from 'react';
import { useOffice, useNow, refreshRedmine } from './useOffice.js';
import { CATS, STATUS, STALE_MS, catView, categoryOf, pickDefaultSession, timeOf, ago, daysUntil, sortIssues, alertFor, notifyDecision, allowSound, agentsOf, agentLabel, kittenPlaces, chubbiness, formatTokens, CHUBBY, workStats, offDays, tokenStats, dowOf, isWeekend, fmtHours, fmtShort, agentShort, countAgents, KITTEN_NARROW, KITTEN_SPOTS_NARROW, rmAlerts, rmMarkSeen, rmParseSeen, rmFreshAlerts, rmNotifyText, claudeDay, claudeMs, logTimeUrl, suggestHours, usualActivity, isResolved, todayBrief, mergeRequestText, endOfDay, parseClock, DAY_HOURS } from './office.js';
import { unlockAudio, playSound } from './sound.js';
import { Cat, Kitten } from './components/Cat.jsx';
import { OfficeBackdrop, STATIONS } from './components/OfficeScene.jsx';
import { SCENES, flavorOf } from './scenes.js';
import { ANIMALS, animalOf, roleFor, withAnimal } from './animals.js';

const short = (id) => (id ? id.slice(0, 8) : '');

export default function App() {
  const office = useOffice();
  const now = useNow();
  const [picked, setPicked] = useState(null); // null = follow the latest active session
  const [catKey, setCatKey] = useState('manage');
  const [agentId, setAgentId] = useState(null); // a clicked kitten; null = show the selected role cat
  const [panel, setPanelState] = useState(() => readPref('neko.panel', 'cat')); // cat | tasks | time | tokens
  const setPanel = (p) => { setPanelState(p); writePref('neko.panel', p); };

  const sessions = useMemo(
    () => Object.values(office.sessions).sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0)),
    [office.sessions],
  );
  const followId = pickDefaultSession(office.sessions);
  const sessionId = picked && office.sessions[picked] ? picked : followId;
  const session = sessionId ? office.sessions[sessionId] : null;
  const live = office.conn === 'live';
  const sound = useSoundAlerts(office, sessionId);
  const notify = useDesktopNotify(office, sessionId, sound.scope, (id) => setPicked(id));
  const look = useLook();
  const cats = useMemo(() => withAnimal(CATS, look.animal), [look.animal]);
  const demo = office.mode === 'demo';
  const rmSeen = useRedmineSeen(office.redmine, demo);
  const rmNew = useMemo(() => rmAlerts(office.redmine?.issues, rmSeen.seen), [office.redmine, rmSeen.seen]);
  useRedmineAlerts(office, rmNew, rmSeen.seen, notify, sound, () => setPanel('tasks'));
  const eod = useEndOfDay(office, notify, sound, () => setPanel('time'));
  const agents = agentsOf(session);
  const agent = agentId ? agents.find((a) => a.id === agentId) : null;
  // same order as kittenPlaces(agents): it sorts the same list the same way
  const narrowPlaces = useMemo(() => {
    const byId = Object.fromEntries(kittenPlaces(agents, KITTEN_NARROW, KITTEN_SPOTS_NARROW).map((p) => [p.agent.id, p]));
    return kittenPlaces(agents).map((p) => byId[p.agent.id]);
  }, [agents]);
  // a saved tab whose data is not there (no Redmine / no token data yet) falls back to the cat panel
  const shown = { cat: true, tasks: !!office.redmine, time: !!office.redmine, tokens: !!office.tokens }[panel] ? panel : 'cat';

  return (
    <div className="app">
      {office.mode === 'demo' && (
        <div className="demo-banner" role="alert">
          DEMO MODE — ข้อมูลจำลองเพื่อดู UI เท่านั้น ไม่ได้เชื่อมต่อ Claude Code · <a href="./">กลับไปโหมด Live</a>
        </div>
      )}

      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">🐾</span>
          <div>
            <h1>Neko Dream Office</h1>
            <p className="sub">Claude Code monitor · อัปเดตตาม hook event จริง</p>
          </div>
        </div>
        <div className="top-right">
          <SoundToggle sound={sound} />
          <ThemeMenu look={look} notify={notify} sound={sound} eod={eod} />
          <ConnBadge office={office} />
        </div>
      </header>

      <nav className={`tabs ${live ? '' : 'stale-data'}`} aria-label="Sessions">
        {sessions.length === 0 && <span className="muted">{live ? 'ยังไม่มี session — รอ event แรกจาก Claude Code' : '—'}</span>}
        {sessions.map((s) => {
          const stale = s.status !== 'stopped' && now - (s.lastEventAt || 0) > STALE_MS;
          return (
            <button
              key={s.id}
              className={`tab ${s.id === sessionId ? 'on' : ''}`}
              onClick={() => setPicked(s.id)}
              title={`session ${s.id}`}
            >
              <i className={`dot tone-${stale ? 'stale' : STATUS[s.status]?.tone}`} />
              <b>{s.project || 'unknown'}</b>
              {s.ticket && <small className="tab-ticket" title={TICKET_FROM[s.ticket.source]}>#{s.ticket.id}</small>}
              <small>{short(s.id)}</small>
            </button>
          );
        })}
        {picked && (
          <button className="tab follow" onClick={() => setPicked(null)} title="ติดตาม session ที่มี event ล่าสุดอัตโนมัติ">
            ↻ ติดตามอัตโนมัติ
          </button>
        )}
      </nav>

      <main className="layout">
        <div className="left">
        <section className="room" aria-label="Office">
          <div className="scene">
            <OfficeBackdrop scene={look.scene} />
            <RoomBanner office={office} session={session} now={now} />
            <Corkboard redmine={office.redmine} now={now} fresh={Object.keys(rmNew).length} onOpen={() => setPanel('tasks')} />
            {cats.map((cat) => {
              const v = catView(cat, session, office.conn, now);
              const pos = STATIONS[cat.key];
              const flavor = flavorOf(look.scene, cat.key, v.chip); // scene word only; the real chip text stays
              return (
                <button
                  key={cat.key}
                  className={`station desk-${cat.key} ${pos.big ? 'big' : ''} ${pos.left > 60 ? 'edge-right' : ''} ${!agentId && catKey === cat.key ? 'selected' : ''}`}
                  style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                  onClick={() => { setCatKey(cat.key); setAgentId(null); setPanel('cat'); }}
                  aria-pressed={!agentId && catKey === cat.key}
                  aria-label={`${cat.name} ${cat.role}${v.chip ? ' — ' + v.chip.text : ''}`}
                >
                  <span className="bubble-slot">
                    {v.chip && (
                      <span key={v.chip.text + v.chip.tone} className={`chip bubble tone-${v.chip.tone}`}>
                        <i className="live-dot" aria-hidden="true" />
                        {flavor && <span className="flavor" aria-hidden="true">{flavor} ·</span>}
                        <span className="real">{v.chip.text}</span>
                        {v.chip.short && v.chip.short !== v.chip.text && <span className="real-short">{v.chip.short}</span>}
                      </span>
                    )}
                  </span>
                  <Cat cat={cat} pose={v.pose} scene={look.scene} animal={look.animal} />
                  <span className="plate"><b>{cat.name}</b><span>{cat.role}</span></span>
                </button>
              );
            })}
            {kittenPlaces(agents).map(({ agent: a, left, top }, i) => (
              <button
                key={`${sessionId}:${a.id}`}
                className={`kitten-spot ${a.main ? 'main' : ''} ${agentId === a.id ? 'selected' : ''}`}
                // desktop and phone layouts both come from kittenPlaces; CSS picks one by the room's width
                style={{ '--kl': `${left}%`, '--kt': `${top}%`, '--kln': `${narrowPlaces[i].left}%`, '--ktn': `${narrowPlaces[i].top}%` }}
                onClick={() => { setAgentId(a.id); setPanel('cat'); }}
                aria-pressed={agentId === a.id}
                aria-label={`agent ${agentLabel(a)} — ${a.tool ? `ใช้ ${a.tool.name}` : 'ว่าง รอบนพรม'} — ${tokenText(a.usage)}`}
                title={`${agentLabel(a)}${a.tool ? ` · ${a.tool.name}${a.tool.summary ? ` · ${a.tool.summary}` : ''}` : ' · ว่าง'} · ${tokenText(a.usage)}`}
              >
                <Kitten agent={a} pose={!live ? 'off' : a.tool ? 'busy' : 'awake'} scene={look.scene} chub={chubbiness(a.usage)} animal={look.animal} />
                <span className="kitten-tag"><span className="tag-full">{agentLabel(a)}</span><span className="tag-short" aria-hidden="true">{agentShort(a)}</span></span>
              </button>
            ))}
          </div>

          <p className="legend">
            <span className="chip tone-busy sample"><i className="live-dot" />บับเบิล</span> = สถานะจริงจาก hooks ·
            ลูกแมว = AI agent จริง (Main + subagent) นั่งข้างโต๊ะของเครื่องมือที่ใช้อยู่ ว่างแล้วรอบนพรม ·
            แมว 6 ตัวเป็นหัวหน้าโต๊ะ (บทบาท) · ห้อง ของตกแต่ง และท่านอน zzz = ตกแต่ง
          </p>
        </section>
        <div className={`feed-wrap ${live ? '' : 'stale-data'}`}><Feed feed={office.feed} sessionId={sessionId} /></div>
        </div>

        <aside className={`side ${live ? '' : 'stale-data'}`}>
          {!live && office.lastMessageAt && (
            <p className="stale-note">ข้อมูลด้านล่างเป็นข้อมูลล่าสุดก่อนการเชื่อมต่อหลุด ({timeOf(office.lastMessageAt)}) — ไม่ใช่สถานะปัจจุบัน</p>
          )}
          <TodayCard redmine={office.redmine} claudeTime={office.claudeTime} holidays={office.holidays} alerts={rmNew} now={now} eodAt={eod.at} onOpen={setPanel} />
          <PanelTabs panel={shown} setPanel={setPanel} icon={animalOf(look.animal).icon} cat={CATS.find((c) => c.key === catKey)} agentName={agentId ? (agent ? agentLabel(agent) : 'Agent') : null} redmine={office.redmine} tokens={office.tokens} now={now} fresh={Object.keys(rmNew).length} />
          {shown === 'cat' && (agentId
            ? <AgentDetails agent={agent} session={session} now={now} animal={look.animal} onBack={() => setAgentId(null)} />
            : <Details cat={cats.find((c) => c.key === catKey)} session={session} office={office} now={now} />)}
          {(shown === 'tasks' || shown === 'time') && (
            <RedmineCard view={shown} redmine={office.redmine} holidays={office.holidays} claudeTime={office.claudeTime} live={live} demo={demo} now={now} alerts={rmNew} onSeen={rmSeen.mark} />
          )}
          {shown === 'tokens' && <TokenCard tokens={office.tokens} demo={office.mode === 'demo'} />}
        </aside>
      </main>
    </div>
  );
}

// ---- Sound alerts: only for new live hook events (never on load, reconnect or the idle loop) ----

const readPref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const writePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };

function useSoundAlerts(office, viewedSessionId) {
  const [on, setOn] = useState(() => readPref('neko.sound', 'off') === 'on');
  const [scope, setScope] = useState(() => readPref('neko.soundScope', 'all')); // all | viewed
  const last = useRef({});

  // A saved "on" still needs one click/key press on the page before the browser allows audio.
  useEffect(() => {
    if (!on) return undefined;
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => { document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); };
  }, [on]);

  useEffect(() => {
    const ev = office.lastEvent;
    const kind = on ? alertFor(ev, { conn: office.conn, scope, viewedId: viewedSessionId }) : null;
    if (kind && allowSound(last.current, ev.session.id, kind, Date.now())) playSound(kind);
  }, [office.lastEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    on, scope,
    toggle: () => {
      const next = !on;
      setOn(next);
      writePref('neko.sound', next ? 'on' : 'off');
      if (next && unlockAudio()) setTimeout(() => playSound('completed'), 60); // confirm it works
    },
    setScope: (v) => { setScope(v); writePref('neko.soundScope', v); },
  };
}

// ---- Desktop notifications: opt-in, same rules as the sound, only while this tab is hidden or unfocused ----

const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;

function useDesktopNotify(office, viewedSessionId, scope, onPick) {
  const [on, setOn] = useState(() => readPref('neko.notify', 'off') === 'on');
  const [, setAsked] = useState(0); // re-render after a permission prompt
  const last = useRef({});
  const pick = useRef(onPick);
  pick.current = onPick;
  const permission = notifySupported() ? Notification.permission : 'unsupported';

  useEffect(() => {
    const ev = office.lastEvent;
    if (!notifySupported() || !ev) return;
    const d = notifyDecision(ev, {
      enabled: on, permission: Notification.permission, conn: office.conn, scope, viewedId: viewedSessionId,
      visible: document.visibilityState === 'visible' && document.hasFocus(), last: last.current, at: Date.now(),
    });
    if (!d) return;
    try {
      const n = new Notification(d.title, { body: d.body, tag: d.tag, renotify: true, silent: false });
      const id = ev.session.id;
      n.onclick = () => { window.focus(); pick.current(id); n.close(); };
    } catch { /* e.g. Android Chrome only allows notifications from a service worker */ }
  }, [office.lastEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    on: on && permission === 'granted', permission,
    // The permission prompt is only ever triggered by this click.
    toggle: async () => {
      if (!notifySupported()) return;
      if (on && Notification.permission === 'granted') { setOn(false); writePref('neko.notify', 'off'); return; }
      let p = Notification.permission;
      if (p === 'default') { try { p = await Notification.requestPermission(); } catch { p = Notification.permission; } }
      setAsked((n) => n + 1);
      const next = p === 'granted';
      setOn(next);
      writePref('neko.notify', next ? 'on' : 'off');
    },
  };
}

// ---- Redmine "มีอัปเดต": what this browser has seen, and alerts for updates found by a live refresh ----

const RM_SEEN_KEY = 'neko.rmSeen';
const saveSeen = (v) => { try { localStorage.setItem(RM_SEEN_KEY, JSON.stringify(v)); } catch { /* storage blocked: this visit only */ } };

function useRedmineSeen(redmine, demo) {
  // demo keeps its own made-up seen map in memory and never touches the real one
  const [seen, setSeen] = useState(() => (demo ? null : rmParseSeen(readPref(RM_SEEN_KEY, 'null'))));
  useEffect(() => {
    if (seen !== null || !redmine?.fetchedAt) return;
    // first ever load: everything already on the list counts as seen (no flood of "ใหม่")
    const base = demo ? (redmine.demoSeen || {}) : rmMarkSeen({}, redmine.issues);
    if (!demo) saveSeen(base);
    setSeen(base);
  }, [redmine, seen, demo]);
  // another tab of this page marked something seen
  useEffect(() => {
    if (demo) return undefined;
    const onStore = (e) => { if (e.key === RM_SEEN_KEY) setSeen(rmParseSeen(e.newValue)); };
    window.addEventListener('storage', onStore);
    return () => window.removeEventListener('storage', onStore);
  }, [demo]);
  return {
    seen,
    mark: (issues) => setSeen((cur) => {
      const next = rmMarkSeen(cur, issues);
      if (!demo) saveSeen(next);
      return next;
    }),
  };
}

// Desktop notification (and the soft bell, if sound is on) for updates that appear after a live refresh.
// A snapshot (page load / reconnect) only records what is there, so it never alerts.
const RM_NOTIFY_MAX = 3; // individual notifications per refresh; the rest become one summary
function useRedmineAlerts(office, alerts, seen, notify, sound, onOpen) {
  const known = useRef(null);
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    if (!office.redmine || seen === null) return;
    if (known.current === null || !office.redmineLive || office.mode === 'demo') {
      known.current = new Set(Object.values(alerts).map((a) => a.key));
      return;
    }
    const fresh = rmFreshAlerts(known.current, alerts);
    if (!fresh.length) return;
    if (sound.on) playSound('completed');
    const hidden = !(document.visibilityState === 'visible' && document.hasFocus());
    if (!notify.on || !hidden || !notifySupported() || Notification.permission !== 'granted') return;
    const subjects = Object.fromEntries(office.redmine.issues.map((i) => [i.id, i.subject]));
    const show = (t) => {
      try {
        const n = new Notification(t.title, { body: t.body, tag: t.tag, silent: !sound.on });
        n.onclick = () => { window.focus(); open.current(); n.close(); };
      } catch { /* e.g. Android Chrome only allows notifications from a service worker */ }
    };
    const many = fresh.length > RM_NOTIFY_MAX;
    for (const a of fresh.slice(0, many ? RM_NOTIFY_MAX - 1 : RM_NOTIFY_MAX)) show(rmNotifyText(a, subjects[a.id]));
    if (many) {
      const rest = fresh.slice(RM_NOTIFY_MAX - 1);
      show({ title: '📋 Redmine', body: `อีก ${rest.length} งานมีอัปเดต: ${rest.slice(0, 6).map((a) => `#${a.id}`).join(' ')}${rest.length > 6 ? ' …' : ''}`, tag: 'neko-rm-more' });
    }
  }, [office.redmine, alerts]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---- เย็น: one reminder per working day after the chosen time, when today is not fully logged ----

const EOD_TIMES = ['off', '16:30', '17:00', '17:30', '18:00'];
const EOD_DONE_KEY = 'neko.eodDone'; // the date it last fired, so a reload never repeats it

function useEndOfDay(office, notify, sound, onOpen) {
  const [at, setAt] = useState(() => readPref('neko.eodAt', '17:00'));
  const cur = useRef();
  cur.current = { office, notify, sound, at, onOpen };
  useEffect(() => {
    const check = () => {
      const { office: o, notify: n, sound: snd, at: when, onOpen: open } = cur.current;
      if (o.mode === 'demo' || o.conn !== 'live') return;
      const off = offDays(o.holidays?.list, readLeave(), o.redmine?.time?.leaveDays);
      const r = endOfDay({ redmine: o.redmine, claudeTime: o.claudeTime, off, now: Date.now(), at: when, done: readPref(EOD_DONE_KEY, '') });
      if (!r) return;
      writePref(EOD_DONE_KEY, r.date);
      if (snd.on) playSound('completed');
      if (!n.on || !notifySupported() || Notification.permission !== 'granted') return;
      try {
        const note = new Notification(r.title, { body: r.body, tag: r.tag, requireInteraction: true, silent: !snd.on });
        note.onclick = () => { window.focus(); open(); note.close(); };
      } catch { /* e.g. Android Chrome only allows notifications from a service worker */ }
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [office.redmine?.fetchedAt, at]); // also re-check as soon as fresh Redmine data arrives
  return { at, set: (v) => { setAt(v); writePref('neko.eodAt', v); } };
}

// ---- เช้า: what needs me today, at the top of the side panel ----

function TodayCard({ redmine, claudeTime, holidays, alerts, now, eodAt, onOpen }) {
  const [open, setOpen] = useState(() => readPref('neko.todayOpen', 'on') !== 'off');
  if (!redmine?.configured || !redmine.fetchedAt) return null;
  const off = offDays(holidays?.list, readLeave(), redmine.time?.leaveDays);
  const b = todayBrief({ redmine, claudeTime, off, alerts, now });
  const d = new Date(now);
  const eodMins = parseClock(eodAt);
  const evening = b.workday && b.now && eodMins !== null && d.getHours() * 60 + d.getMinutes() >= eodMins
    && (b.now.short > 0 || b.now.unlogged.length > 0);
  const late = b.due.filter((x) => x.days < 0).length;
  const prevTodo = b.prev && (b.prev.short > 0 || b.prev.unlogged.length > 0);
  const olderMissing = b.missing.filter((x) => x !== b.prev?.date).length;
  const todo = (late ? 1 : 0) + (b.due.length - late ? 1 : 0) + (b.updates.length ? 1 : 0) + (b.unmerged.length ? 1 : 0) + (prevTodo ? 1 : 0) + (evening ? 1 : 0);
  const tickets = (rows) => rows.slice(0, 3).map((r) => (r.ticket ? `#${r.ticket}` : r.project || '?')).join(', ') + (rows.length > 3 ? ' …' : '');
  return (
    <details className={`card today ${evening ? 'is-evening' : ''}`} open={open}
      onToggle={(e) => { setOpen(e.currentTarget.open); writePref('neko.todayOpen', e.currentTarget.open ? 'on' : 'off'); }}>
      <summary>
        <h2>{evening ? '🌙 ก่อนเลิกงาน' : '☀️ วันนี้'} <small>{longDay(b.today)}{!b.workday && ' · วันหยุด'}</small></h2>
        {todo > 0 ? <span className="due tone-warn">{todo} เรื่อง</span> : <span className="due tone-done">เรียบร้อย</span>}
      </summary>
      <ul className="today-list">
        {b.due.slice(0, 4).map((x) => (
          <li key={`due-${x.id}`}>
            <span className={`due tone-${x.days < 0 ? 'error' : 'warn'}`}>{x.days < 0 ? `เลย ${-x.days} วัน` : 'ครบวันนี้'}</span>
            {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer">#{x.id}</a> : <span>#{x.id}</span>}
            <span className="today-subj" title={x.subject}>{x.subject}</span>
          </li>
        ))}
        {b.due.length > 4 && <li><button className="link-btn" onClick={() => onOpen('tasks')}>…อีก {b.due.length - 4} งานที่ถึงกำหนด</button></li>}
        {b.updates.length > 0 && (
          <li><button className="link-btn" onClick={() => onOpen('tasks')}>
            💬 มีอัปเดต {b.updates.length} งาน: {b.updates.slice(0, 4).map((u) => `${u.icon}#${u.id}`).join(' ')}{b.updates.length > 4 ? ' …' : ''}
          </button></li>
        )}
        {b.unmerged.length > 0 && (
          <li><button className="link-btn" onClick={() => onOpen('tasks')} title={b.unmerged.map((u) => `#${u.id} ${u.subject} — ${u.repos.join(', ')}`).join('\n')}>
            🔀 Resolved แต่ยังไม่ merge {b.unmerged.length} งาน: {b.unmerged.slice(0, 4).map((u) => `#${u.id}`).join(' ')}{b.unmerged.length > 4 ? ' …' : ''}
          </button></li>
        )}
        {prevTodo && (
          <li><button className="link-btn" onClick={() => onOpen('time')}>
            ⏱ {dayLabel(b.prev.date, b.today)} ลงไว้ {fmtShort(b.prev.hours)}{b.prev.short > 0 && <> — ขาด <b>{fmtShort(b.prev.short)}</b></>}
            {b.prev.unlogged.length > 0 && <> · Claude ทำ {tickets(b.prev.unlogged)} ยังไม่ลง</>}
          </button></li>
        )}
        {olderMissing > 0 && (
          <li><button className="link-btn" onClick={() => onOpen('time')}>📅 ยังไม่ลง log {prevTodo ? 'อีก ' : ''}{olderMissing} วันทำงาน (28 วันล่าสุด)</button></li>
        )}
        {b.now && b.workday && (
          <li className={evening ? 'tone-warn' : ''}><button className="link-btn" onClick={() => onOpen('time')}>
            {evening ? '🌙' : '⏱'} วันนี้ลงแล้ว {fmtShort(b.now.hours)} / {DAY_HOURS} ชม.
            {b.now.unlogged.length > 0 && <> · Claude ทำ {tickets(b.now.unlogged)} ยังไม่ลง</>}
          </button></li>
        )}
        {todo === 0 && <li className="muted">✓ ไม่มีงานถึงกำหนด ไม่มีอัปเดตค้าง ไม่มี branch ค้าง merge และลงเวลาเมื่อวานครบแล้ว</li>}
      </ul>
    </details>
  );
}

function NotifySettings({ notify, sound }) {
  const { on, permission } = notify;
  const note = permission === 'unsupported' ? 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนบนเดสก์ท็อป'
    : permission === 'denied' ? 'เบราว์เซอร์บล็อกการแจ้งเตือนของหน้านี้ไว้ — อนุญาตในการตั้งค่าเว็บไซต์ของเบราว์เซอร์ก่อน แล้วกดเปิดอีกครั้ง'
    : on ? 'แจ้งเมื่อ Claude รอคุณ / Error / ตอบจบเทิร์น และเมื่องาน Redmine มีอัปเดตจากคนอื่น เฉพาะตอนแท็บนี้ถูกซ่อนหรือไม่ได้โฟกัส (ถ้าเห็นหน้าอยู่ ใช้เสียงแทน)'
    : 'ค่าเริ่มต้นปิด · กดเปิดแล้วเบราว์เซอร์จะถามสิทธิ์ 1 ครั้ง';
  return (
    <>
      <h3 id="set-notify">แจ้งเตือนบนเดสก์ท็อป</h3>
      <div className="seg" role="group" aria-labelledby="set-notify">
        <button className="mini-btn" aria-pressed={on} onClick={notify.toggle} disabled={permission === 'unsupported'}>
          <span aria-hidden="true">{on ? '🔔' : '🔕'}</span> {on ? 'เปิดอยู่' : 'ปิด'}
        </button>
        {on && (
          <select className="mini-btn" value={sound.scope} onChange={(e) => sound.setScope(e.target.value)} aria-label="แจ้งเตือนสำหรับ session ไหน">
            <option value="all">ทุก session</option>
            <option value="viewed">เฉพาะที่ดูอยู่</option>
          </select>
        )}
      </div>
      <p className={`pop-note ${permission === 'denied' ? 'tone-warn' : ''}`} role="status">{note}</p>
    </>
  );
}

function SoundToggle({ sound }) {
  return (
    <div className="sound">
      <button className="mini-btn" onClick={sound.toggle} aria-pressed={sound.on}
        title={sound.on ? 'ปิดเสียงแจ้งเตือน' : 'เปิดเสียงแจ้งเตือน: รอคุณตอบ / Error / ทำงานเสร็จ'}>
        {sound.on ? '🔔 เสียงเปิด' : '🔕 เสียงปิด'}
      </button>
      {sound.on && (
        <select className="mini-btn" value={sound.scope} onChange={(e) => sound.setScope(e.target.value)} aria-label="ดังสำหรับ session ไหน">
          <option value="all">ทุก session</option>
          <option value="viewed">เฉพาะที่ดูอยู่</option>
        </select>
      )}
    </div>
  );
}

// ---- Look: mode, palette and room scene as data-* on <html>; public/theme-init.js re-applies the saved
// choice before first paint. The first entry of each list is the default and means "no attribute". ----

const THEMES = [['auto', '🌗', 'อัตโนมัติ'], ['light', '☀️', 'สว่าง'], ['dark', '🌙', 'มืด']];
const PALETTES = [['pink', 'ชมพู', '#ffd6e7'], ['mint', 'มิ้นต์', '#c9f1e1'], ['lavender', 'ลาเวนเดอร์', '#e4dbff'], ['peach', 'พีช', '#ffd9c4']];
const LOOK = {
  theme: { pref: 'neko.theme', attr: 'data-theme', keys: THEMES.map(([k]) => k) },
  palette: { pref: 'neko.palette', attr: 'data-palette', keys: PALETTES.map(([k]) => k) },
  scene: { pref: 'neko.scene', attr: 'data-scene', keys: SCENES.map((x) => x.key) },
  animal: { pref: 'neko.animal', attr: 'data-animal', keys: ANIMALS.map((x) => x.key) },
};
const lookPref = (name) => { const { pref, keys } = LOOK[name]; const v = readPref(pref, keys[0]); return keys.includes(v) ? v : keys[0]; };

function applyLook(name, value) {
  const root = document.documentElement;
  const { attr, keys } = LOOK[name];
  if (value === keys[0]) root.removeAttribute(attr); else root.setAttribute(attr, value);
  if (name === 'theme') document.querySelector('meta[name=color-scheme]')?.setAttribute('content', value === 'auto' ? 'light dark' : value);
}

function useLook() {
  const [look, setLook] = useState(() => ({ theme: lookPref('theme'), palette: lookPref('palette'), scene: lookPref('scene'), animal: lookPref('animal') }));
  useEffect(() => { for (const name of Object.keys(LOOK)) applyLook(name, look[name]); }, [look]);
  return { ...look, set: (name, value) => { setLook((l) => ({ ...l, [name]: value })); writePref(LOOK[name].pref, value); } };
}

function ThemeMenu({ look, notify, sound, eod }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);

  // close on Escape (focus back to ⚙️) or a click/tap outside
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  const option = (name, key, label, content, first) => (
    <button key={key} className="mini-btn" aria-pressed={look[name] === key} aria-label={label} autoFocus={first && look[name] === key}
      onClick={() => look.set(name, key)}>
      {content}
    </button>
  );
  return (
    <div className="theme-menu" ref={wrap}>
      <button ref={btn} className="mini-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="theme-pop"
        aria-label="ตั้งค่า" title="ตั้งค่า (ธีม · การแจ้งเตือน)">⚙️</button>
      {open && (
        <div id="theme-pop" className="theme-pop" role="group" aria-label="ตั้งค่า">
          <h3 id="theme-scene">ธีมห้อง</h3>
          <div className="seg" role="group" aria-labelledby="theme-scene">
            {SCENES.map((x) => option('scene', x.key, `ธีมห้อง${x.label}`, <><span aria-hidden="true">{x.icon}</span> {x.label}</>, true))}
          </div>
          <h3 id="theme-animal">สัตว์ในห้อง</h3>
          <div className="seg" role="group" aria-labelledby="theme-animal">
            {ANIMALS.map((x) => option('animal', x.key, `สัตว์ในห้อง ${x.label}`, <><span aria-hidden="true">{x.icon}</span> {x.label}</>))}
          </div>
          <h3 id="theme-mode">โหมด</h3>
          <div className="seg" role="group" aria-labelledby="theme-mode">
            {THEMES.map(([k, icon, label]) => option('theme', k, `โหมด${label}`, <><span aria-hidden="true">{icon}</span> {label}</>))}
          </div>
          <h3 id="theme-palette">สีธีม</h3>
          <div className="seg swatches" role="group" aria-labelledby="theme-palette">
            {PALETTES.map(([k, label, color]) => option('palette', k, `สีธีม${label}`,
              <><i className="swatch" style={{ background: color }} aria-hidden="true" /> {label}</>))}
          </div>
          <NotifySettings notify={notify} sound={sound} />
          <h3 id="set-eod">เตือนก่อนเลิกงาน</h3>
          <div className="seg" role="group" aria-labelledby="set-eod">
            <select className="mini-btn" value={eod.at} onChange={(e) => eod.set(e.target.value)} aria-label="เวลาเตือนก่อนเลิกงาน">
              {EOD_TIMES.map((t) => <option key={t} value={t}>{t === 'off' ? 'ปิด' : `${t} น.`}</option>)}
            </select>
          </div>
          <p className="pop-note">วันทำงาน ถ้าลงเวลาวันนี้ยังไม่ครบ {DAY_HOURS} ชม. หรือมีงานที่ Claude ทำแต่ยังไม่ลง: การ์ด “วันนี้” ขึ้นสีส้ม และเด้งแจ้งเตือน 1 ครั้งต่อวัน (ต้องเปิดแจ้งเตือนบนเดสก์ท็อป และเปิดหน้านี้ค้างไว้){notify.on ? '' : ' — ตอนนี้แจ้งเตือนบนเดสก์ท็อปปิดอยู่'}</p>
        </div>
      )}
    </div>
  );
}

// Pill tabs above the side card. Badges give the key numbers at a glance.
function PanelTabs({ panel, setPanel, icon, cat, agentName, redmine, tokens, now, fresh }) {
  const ready = redmine?.configured && redmine.fetchedAt !== null;
  const { active, overdue } = ready ? splitIssues(redmine.issues, now) : { active: [], overdue: 0 };
  const tabs = [
    ['cat', icon, agentName || cat.name, null],
    ...(redmine ? [
      ['tasks', '📋', 'งาน', ready ? <>
        <em className={`badge ${overdue ? 'tone-error' : 'tone-calm'}`}>{active.length}</em>
        {fresh > 0 && <em className="new-dot" title={`มีอัปเดต ${fresh} งาน`} aria-label={`มีอัปเดต ${fresh} งาน`}>{fresh}</em>}
      </> : null],
      ['time', '⏱', 'เวลา', ready && redmine.time ? <em className="badge tone-done">{fmtShort(redmine.time.todayHours)}</em> : null],
    ] : []),
    ...(tokens ? [['tokens', '🪙', 'โทเคน', tokens.ready ? <em className="badge tone-warn">{formatTokens(tokens.today.counted)}</em> : null]] : []),
  ];
  return (
    <div className="panel-tabs" role="tablist" aria-label="แผงข้อมูล">
      {tabs.map(([key, icon, label, badge]) => (
        <button key={key} role="tab" aria-selected={panel === key} className={panel === key ? 'on' : ''} onClick={() => setPanel(key)} title={label}>
          <span aria-hidden="true">{icon}</span> <span className="pt-label">{label}</span> {badge}
        </button>
      ))}
    </div>
  );
}

function ConnBadge({ office }) {
  const map = {
    live: office.mode === 'demo' ? ['demo', 'DEMO'] : ['live', 'Live'],
    connecting: ['connecting', 'Connecting…'],
    disconnected: ['disconnected', 'Disconnected'],
  };
  const [cls, text] = map[office.conn];
  return (
    <div className={`conn conn-${cls}`} role="status" aria-live="polite">
      <i className="dot" /> {text}
    </div>
  );
}

function RoomBanner({ office, session, now }) {
  if (office.conn === 'disconnected') {
    return <div className="banner off">Disconnected — เชื่อมต่อ backend ไม่ได้ (127.0.0.1:4777) กำลังลองใหม่…</div>;
  }
  if (office.conn === 'connecting') return <div className="banner off">กำลังเชื่อมต่อ…</div>;
  if (!session) return <div className="banner wait">Waiting for Events — ยังไม่มี event จาก Claude Code</div>;
  const st = STATUS[session.status] || STATUS.idle;
  const stale = session.status !== 'stopped' && now - (session.lastEventAt || 0) > STALE_MS;
  return (
    <div className={`banner tone-${stale ? 'stale' : st.tone}`}>
      <b>{session.project || 'unknown'}</b> · {st.en}
      {/* phones: Nori's bubble has no room, so its agent count joins the banner (right after the status) */}
      {agentsOf(session).length > 0 && <span className="banner-agents"> · {countAgents(agentsOf(session).length)}</span>}
      {' '}— {st.th}
      {session.status === 'stopped' && session.endReason ? ` (${session.endReason})` : ''}
      {stale && <> · ไม่มี event มา {ago(session.lastEventAt, now)} (ไม่ทราบสถานะปัจจุบัน)</>}
    </div>
  );
}

function Details({ cat, session, office, now }) {
  const related = office.feed
    .filter((f) => f.sessionId === session?.id && (cat.key === 'manage' || f.category === cat.key || (cat.key === 'creative' && f.event.startsWith('Subagent'))))
    .slice(-6)
    .reverse();
  const tools = session ? session.tools.filter((t) => cat.key === 'manage' || t.category === cat.key) : [];
  const err = session?.lastError && (cat.key === 'manage' || (err_cat(session.lastError) === cat.key)) ? session.lastError : null;

  return (
    <section className="card details" aria-label="รายละเอียด">
      <h2>{cat.name} <small>{cat.role}</small></h2>
      <p className="muted small">ดูแล: {cat.tools}</p>

      {!session ? (
        <p className="muted">ยังไม่มีข้อมูล session</p>
      ) : (
        <>
          <dl className="kv">
            <dt>Session</dt><dd title={session.id}>{session.project} · {short(session.id)}</dd>
            <dt>สถานะ</dt><dd>{STATUS[session.status]?.en} · ตั้งแต่ {timeOf(session.statusSince)}</dd>
            <dt>Event ล่าสุด</dt><dd>{session.lastEvent} · {ago(session.lastEventAt, now)}ที่แล้ว</dd>
            {session.model && (<><dt>Model</dt><dd>{session.model}</dd></>)}
            {session.permissionMode && (<><dt>Permission</dt><dd>{session.permissionMode}</dd></>)}
            <dt>นับแล้ว</dt><dd>{session.prompts} คำสั่ง · {session.toolCalls} tool calls</dd>
            {session.subagents?.length > 0 && (<><dt>Subagents</dt><dd>{session.subagents.map((a) => a.type).join(', ')}</dd></>)}
          </dl>

          <h3>เครื่องมือที่กำลังทำงาน</h3>
          {tools.length === 0 ? <p className="muted small">ไม่มี</p> : (
            <ul className="tools">
              {tools.map((t) => (
                <li key={t.id}>
                  <b>{t.name}</b>{t.summary && <> · <span>{t.summary}</span></>}
                  {t.agentType && <em> (subagent: {t.agentType})</em>}
                  <small> · {ago(t.startedAt, now)}</small>
                </li>
              ))}
            </ul>
          )}

          {err && (
            <>
              <h3>ข้อผิดพลาดล่าสุด</h3>
              <p className="error-box">
                <small>{timeOf(err.at)}{err.tool ? ` · ${err.tool}` : ''}</small><br />{err.message}
              </p>
            </>
          )}

          <h3>เหตุการณ์ล่าสุดของ {cat.name}</h3>
          {related.length === 0 ? <p className="muted small">ยังไม่มี</p> : (
            <ul className="mini-feed">
              {related.map((f) => (
                <li key={f.id} className={`lv-${f.level}`}><time>{timeOf(f.at)}</time> {f.label}{f.detail && <span> — {f.detail}</span>}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// One real agent (a kitten). Only what the hooks told us: type, current tool, times and counts.
function AgentDetails({ agent, session, now, animal, onBack }) {
  const back = <button className="mini-btn" onClick={onBack}>← กลับไปหัวหน้าโต๊ะ</button>;
  if (!agent) {
    return (
      <section className="card details" aria-label="รายละเอียด agent">
        <div className="feed-head"><h2>Agent</h2>{back}</div>
        <p className="muted small">agent นี้ไม่อยู่ในออฟฟิศแล้ว (จบงาน, session หยุด หรือเปลี่ยน session ที่ดู)</p>
      </section>
    );
  }
  const desk = agent.tool ? CATS.find((c) => c.key === agent.tool.category) : null;
  return (
    <section className="card details" aria-label="รายละเอียด agent">
      <div className="feed-head">
        <h2>{agentLabel(agent)} <small>{agent.main ? 'Main agent ของ session' : 'subagent'}</small></h2>
        {back}
      </div>
      <dl className="kv">
        <dt>ประเภท</dt><dd>{agent.main ? 'main' : agent.type}</dd>
        {!agent.main && (<><dt>Agent id</dt><dd title={agent.id}>{short(agent.id)}</dd></>)}
        <dt>Session</dt><dd title={session?.id}>{session?.project} · {short(session?.id)}</dd>
        <dt>ตอนนี้</dt>
        <dd>
          {agent.tool ? <><b>{agent.tool.name}</b>{agent.tool.summary && <> · {agent.tool.summary}</>} <small className="muted">({ago(agent.tool.startedAt, now)})</small></> : 'ไม่มีเครื่องมือทำงาน — รอบนพรม'}
          {agent.running > 1 && <small className="muted"> · ทำงานพร้อมกัน {agent.running} เครื่องมือ</small>}
        </dd>
        {desk && (<><dt>นั่งที่โต๊ะ</dt><dd>{desk.name} · {roleFor(desk.role, animal)}</dd></>)}
        <dt>ทำงานมาแล้ว</dt>
        <dd>{agent.startedAt ? <>{ago(agent.startedAt, now)} <small className="muted">(เริ่ม {timeOf(agent.startedAt)})</small></>
          : <>ไม่ทราบเวลาเริ่ม <small className="muted">(เห็นครั้งแรก {timeOf(agent.firstSeenAt)})</small></>}</dd>
        <dt>Tool calls</dt><dd>{agent.toolCalls}</dd>
        <dt>Tokens</dt>
        <dd>
          {agent.usage ? (
            <>
              <b>ใช้ไป {formatTokens(agent.usage.total)} tokens</b> <small className="muted">· {CHUBBY[chubbiness(agent.usage)].th}</small>
              <small className="muted token-split">
                input {formatTokens(agent.usage.input)} · output {formatTokens(agent.usage.output)} · cache เขียน {formatTokens(agent.usage.cacheCreation)}
                <br />+ cache อ่านซ้ำ {formatTokens(agent.usage.cacheRead)} (ไม่นับ) · {agent.usage.messages} คำตอบ
              </small>
            </>
          ) : <>ยังไม่ทราบ <small className="muted">(ยังไม่ได้อ่าน transcript ของ agent นี้)</small></>}
        </dd>
        <dt>Event ล่าสุด</dt><dd>{agent.lastEventAt ? `${ago(agent.lastEventAt, now)}ที่แล้ว` : '—'}</dd>
      </dl>
      <p className="muted small">ไม่แสดง prompt หรือผลลัพธ์ของเครื่องมือ · เวลานับจาก hook event และอัปเดตทุก 30 วินาที · tokens อ่านจาก transcript จริง (input + output + cache เขียน) ยิ่งมากลูกแมวยิ่งอ้วน</p>
    </section>
  );
}

const tokenText = (u) => (u ? `ใช้ไป ${formatTokens(u.total)} tokens` : 'tokens ยังไม่ทราบ');

const err_cat = (e) => (e.tool ? categoryOf(e.tool) : 'manage');

function Feed({ feed, sessionId }) {
  const [onlyThis, setOnlyThis] = useState(false);
  const items = (onlyThis ? feed.filter((f) => f.sessionId === sessionId) : feed).slice(-60).reverse();
  return (
    <section className="card feed" aria-label="Activity Feed">
      <div className="feed-head">
        <h2>Activity Feed</h2>
        <label className="small"><input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> เฉพาะ session นี้</label>
      </div>
      {items.length === 0 ? <p className="muted small">ยังไม่มี event</p> : (
        <ol>
          {items.map((f) => (
            <li key={f.id} className={`lv-${f.level}`}>
              <time>{timeOf(f.at)}</time>
              <span className="proj">{f.project || short(f.sessionId)}</span>
              <span className="lbl">{f.label}{f.detail && <span className="det"> — {f.detail}</span>}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---- Redmine: open issues assigned to me (separate source from hooks; never drives the cats) ----

const PRIORITY_TONE = { 1: 'calm', 2: 'busy', 3: 'warn', 4: 'error', 5: 'error' };
const DAY_TARGET = 8; // hours, only for the "today" progress bar


function dueBadge(dueDate, now) {
  const d = daysUntil(dueDate, now);
  if (d === null) return null;
  if (d < 0) return { tone: 'error', text: `เลย ${-d} วัน`, group: 'overdue' };
  if (d === 0) return { tone: 'warn', text: 'วันนี้', group: 'soon' };
  if (d <= 2) return { tone: 'warn', text: d === 1 ? 'พรุ่งนี้' : `อีก ${d} วัน`, group: 'soon' };
  return { tone: 'muted', text: dueDate.slice(5).split('-').reverse().join('/'), group: 'later' };
}

function splitIssues(issues, now) {
  const active = [];
  const resolved = [];
  for (const i of sortIssues(issues)) (isResolved(i) ? resolved : active).push(i);
  const overdue = active.filter((i) => dueBadge(i.dueDate, now)?.group === 'overdue').length;
  const soon = active.filter((i) => dueBadge(i.dueDate, now)?.group === 'soon').length;
  return { active, resolved, overdue, soon };
}

function Corkboard({ redmine, now, fresh, onOpen }) {
  if (!redmine?.configured) return null;
  const hasData = redmine.fetchedAt !== null;
  const { active, overdue } = splitIssues(redmine.issues, now);
  const go = () => {
    onOpen();
    requestAnimationFrame(() => {
      const el = document.getElementById('redmine-card');
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el?.focus({ preventScroll: true });
    });
  };
  return (
    <button className={`corkboard ${redmine.error ? 'is-stale' : ''}`} onClick={go}
      aria-label={hasData ? `งาน Redmine กำลังทำ ${active.length} งาน${overdue ? `, เลยกำหนด ${overdue}` : ''}${fresh ? `, มีอัปเดต ${fresh}` : ''}` : 'งาน Redmine'}>
      <span className="pin" aria-hidden="true" />
      {fresh > 0 && <span className="cb-new" aria-hidden="true">{fresh}</span>}
      <span className="note">
        <small className="cb-label">งาน</small>
        <b>{hasData ? active.length : redmine.error ? '!' : '…'}</b>
        {overdue > 0 && <em>เลย {overdue}</em>}
        {redmine.time && <small className="cb-time">⏱ {fmtHours(redmine.time.todayHours)}</small>}
      </span>
    </button>
  );
}

function RedmineCard({ view, redmine, holidays, claudeTime, live, demo, now, alerts, onSeen }) {
  const [cooldown, setCooldown] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);

  const refresh = () => {
    setCooldown(true);
    timer.current = setTimeout(() => setCooldown(false), 30000);
    refreshRedmine()
      .then((ok) => setNote(ok ? '' : 'เพิ่งดึงไป รอ 30 วินาทีแล้วลองใหม่'))
      .catch(() => setNote('ติดต่อ backend ไม่ได้'));
  };

  if (!redmine) return null;
  const { active, resolved, overdue, soon } = splitIssues(redmine.issues, now);
  const subjects = Object.fromEntries(redmine.issues.map((i) => [i.id, i.subject]));
  const fresh = redmine.issues.filter((i) => alerts[i.id]);
  const gone = Array.isArray(redmine.gone) ? redmine.gone : [];
  const row = (i, done) => <IssueRow key={i.id} issue={i} now={now} done={done} alert={alerts[i.id]} onSeen={() => onSeen([i])}
    unmerged={done ? redmine.unmerged?.[i.id] : null} baseUrl={redmine.baseUrl} merge={redmine.merge} />;

  return (
    <section className="card redmine" id="redmine-card" tabIndex={-1} aria-label="งาน Redmine ของฉัน">
      <div className="feed-head">
        <h2>{view === 'time' ? '⏱ เวลาทำงาน' : '📋 งานของฉัน'} <small>Redmine</small></h2>
        <span className="rm-head-btns">
          {view === 'tasks' && fresh.length > 0 && (
            <button className="mini-btn rm-readall" onClick={() => onSeen(fresh)} title="ทำเครื่องหมายว่าอ่านแล้วทุกงาน (เก็บในเบราว์เซอร์นี้)">
              ✓ อ่านทั้งหมด ({fresh.length})
            </button>
          )}
          {redmine.configured && !demo && (
            <button className="mini-btn" onClick={refresh} disabled={!live || cooldown || redmine.loading}>
              {redmine.loading ? 'กำลังดึง…' : '↻ รีเฟรช'}
            </button>
          )}
        </span>
      </div>

      {!redmine.configured ? (
        <p className="muted small">
          ยังไม่ได้ตั้งค่า Redmine — ตั้ง env <code>REDMINE_URL</code> + <code>REDMINE_API_KEY</code> หรือสร้างไฟล์{' '}
          <code>~/.config/neko-dream-office/redmine.json</code> แล้ว restart backend
        </p>
      ) : (
        <>
          <p className="muted small">
            {redmine.fetchedAt ? <>ดึงล่าสุด {timeOf(redmine.fetchedAt)} ({ago(redmine.fetchedAt, now)}ที่แล้ว)</> : 'ยังไม่เคยดึงสำเร็จ'}
            {note && <> · {note}</>}
          </p>
          {redmine.error && (
            <p className="error-box"><small>{timeOf(redmine.errorAt)}</small><br />ดึงไม่สำเร็จ: {redmine.error}
              {redmine.fetchedAt && <><br />ข้อมูลด้านล่างเป็นข้อมูลเก่า</>}</p>
          )}

          <div className={redmine.error ? 'is-stale' : ''}>
            {view === 'time' && <WorkTime time={redmine.time} error={redmine.timeError} subjects={subjects} base={redmine.baseUrl} holidays={holidays} claude={claudeTime} />}
            {view === 'time' && !redmine.time && !redmine.timeError && <p className="muted small">ยังไม่มีข้อมูลเวลา</p>}

            {view === 'tasks' && <>
            {redmine.fetchedAt && (
              <div className="rm-stats">
                <span className={`stat ${overdue ? 'tone-error' : ''}`}><b>{overdue}</b>เลยกำหนด</span>
                <span className={`stat ${soon ? 'tone-warn' : ''}`}><b>{soon}</b>ใกล้ครบ</span>
                <span className="stat tone-calm"><b>{active.length}</b>กำลังทำ</span>
                <span className="stat"><b>{resolved.length}</b>รอปิด</span>
              </div>
            )}

            {redmine.fetchedAt && active.length === 0 && <p className="muted small">ไม่มีงานที่ต้องทำ 🎉</p>}
            {active.length > 0 && <ul className="issues">{active.map((i) => row(i, false))}</ul>}

            {resolved.length > 0 && (
              <details className="rm-resolved">
                <summary>
                  รอปิด / Resolved ({resolved.length}) — ทำเสร็จแล้ว รอคนตรวจปิด
                  {resolved.some((i) => alerts[i.id]) && <i className="new-dot sm" aria-label="มีอัปเดต" />}
                </summary>
                <ul className="issues">{resolved.map((i) => row(i, true))}</ul>
              </details>
            )}
            {gone.length > 0 && (
              <details className="rm-resolved rm-gone">
                <summary>ออกจากรายการ (ปิด/ย้าย) ({gone.length}) — 24 ชม. ล่าสุด</summary>
                <ul className="rm-gone-list">
                  {gone.map((g) => (
                    <li key={g.id}>
                      {redmine.baseUrl
                        ? <a href={`${redmine.baseUrl}/issues/${g.id}`} target="_blank" rel="noopener noreferrer" className="rm-id">#{g.id}</a>
                        : <span className="rm-id">#{g.id}</span>}
                      <span className="rm-gone-subj" title={g.subject}>{g.subject}</span>
                      <small className="muted">{ago(g.at, now)}ที่แล้ว</small>
                    </li>
                  ))}
                </ul>
                <p className="muted small">ไม่อยู่ในงานเปิดที่ assign ให้คุณแล้ว — ถูกปิด หรือย้ายไปให้คนอื่น</p>
              </details>
            )}
            {redmine.total > redmine.issues.length && <p className="muted small">แสดง {redmine.issues.length} จาก {redmine.total} งาน</p>}
            </>}
          </div>
        </>
      )}
    </section>
  );
}

// Copies a ready-made prompt for the user to paste into Claude Code themselves.
// The page never runs anything: it only puts text on the clipboard.
function CopyPrompt({ text, label: idle = '📋 คัดลอกคำสั่ง', title }) {
  const [state, setState] = useState('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const t = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      setState('fail');
    }
  };
  const label = state === 'done' ? '✓ คัดลอกแล้ว' : state === 'fail' ? 'คัดลอกไม่ได้' : idle;
  return (
    <button type="button" className={`rm-copy ${state}`} onClick={copy}
      title={title || `คัดลอก "${text}" ไปวางใน Claude Code`} aria-label={title || `คัดลอกคำสั่ง ${text}`}>
      {label}
    </button>
  );
}

function IssueRow({ issue: i, now, done, alert, onSeen, unmerged, baseUrl, merge }) {
  const due = done ? null : dueBadge(i.dueDate, now);
  const seen = alert ? () => onSeen() : undefined;
  const hours = i.spentHours || i.estimatedHours
    ? `⏱ ${fmtHours(i.spentHours)}${i.estimatedHours ? ` / ${fmtHours(i.estimatedHours)}` : ''}` : null;
  return (
    <li className={`${done ? 'done' : ''} ${alert ? 'has-new' : ''}`}>
      <div className="rm-top">
        <i className={`dot tone-${PRIORITY_TONE[i.priorityId] || 'calm'}`} title={`priority: ${i.priority || '-'}`} />
        <a href={i.url} target="_blank" rel="noopener noreferrer" className="rm-id" onClick={seen} onAuxClick={seen}>#{i.id}</a>
        {alert && (
          <span className={`rm-new kind-${alert.kind}`} title={alertTitle(i)}>
            <i className="new-dot sm" aria-hidden="true" />{alert.kind === 'new' ? '' : <span aria-hidden="true">{alert.icon} </span>}{alert.text}
            <button type="button" className="rm-seen" onClick={onSeen} aria-label={`ทำเครื่องหมายว่าอ่าน #${i.id} แล้ว`} title="อ่านแล้ว">✓</button>
          </span>
        )}
        <span className="rm-status">{i.status}</span>
        {due && <span className={`due tone-${due.tone}`}>{due.text}</span>}
        {unmerged?.length > 0 && (
          <span className="due tone-warn" title={`ยังไม่ merge:\n${unmerged.map((b) => `${b.repo} · ${b.branch} · ahead ${b.ahead} commits${b.base ? ` (→ ${b.base})` : ''}`).join('\n')}`}>
            🔀 ยังไม่ merge
          </span>
        )}
        <CopyPrompt text={`ตรวจสอบ Redmine #${i.id}`} />
      </div>
      {unmerged?.length > 0 && (
        <div className="rm-merge">
          <CopyPrompt text={mergeRequestText(i, unmerged, baseUrl, merge)} label="📋 คัดลอกขอ merge" title={`คัดลอกข้อความขอ merge #${i.id} (${unmerged.length} branch) ไปส่งต่อเอง`} />
        </div>
      )}
      <a href={i.url} target="_blank" rel="noopener noreferrer" className="rm-subject" title={i.subject} onClick={seen} onAuxClick={seen}>{i.subject}</a>
      <div className="rm-meta">
        {!done && i.doneRatio !== null && (
          <span className="bar" title={`${i.doneRatio}%`}><span style={{ width: `${i.doneRatio}%` }} /></span>
        )}
        {!done && i.doneRatio !== null && <span>{i.doneRatio}%</span>}
        {hours && <span>{hours}</span>}
        {i.project && <span className="rm-proj" title={i.project}>{i.project}</span>}
      </div>
    </li>
  );
}

// "updated 10:42 by someone else" — only the time and the byMe flag are known, never who or what was written.
function alertTitle(i) {
  const la = i.lastActivity;
  const at = la?.at ? new Date(la.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : null;
  if (!la) return 'อัปเดตหลังจากที่คุณเปิดดูล่าสุด';
  return `${at ? `ล่าสุด ${at} · ` : ''}${la.byMe === false ? 'โดยคนอื่น' : 'ไม่ทราบว่าใครแก้'} — คลิกเลขงานหรือ ✓ เพื่อทำเครื่องหมายว่าอ่านแล้ว`;
}

const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

function dayLabel(spentOn, today) {
  if (spentOn === today) return 'วันนี้';
  const [y, m, d] = spentOn.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((new Date(today) - new Date(spentOn)) / 86_400_000);
  return `${diff === 1 ? 'เมื่อวาน · ' : ''}${DAY_NAMES[date.getDay()]} ${d}/${m}`;
}

const DAY_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const dmy = (date) => { const [, m, d] = date.split('-').map(Number); return `${d}/${m}`; };
const longDay = (date) => { const [, m, d] = date.split('-').map(Number); return `วัน${DAY_FULL[dowOf(date)]} ${d} ${MONTHS[m - 1]}`; };

// This browser's own leave days (วันลา), kept in localStorage only — never sent anywhere.
const LEAVE_KEY = 'neko.daysOff';
function readLeave() {
  try { const v = JSON.parse(localStorage.getItem(LEAVE_KEY) || '[]'); return Array.isArray(v) ? v.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : []; }
  catch { return []; }
}
function useLeaveDays() {
  const [leave, setLeave] = useState(readLeave);
  const toggle = (date) => setLeave((cur) => {
    // keep ~2 months so the list never grows without bound
    const next = (cur.includes(date) ? cur.filter((d) => d !== date) : [...cur, date]).sort().slice(-62);
    try { localStorage.setItem(LEAVE_KEY, JSON.stringify(next)); } catch { /* storage blocked: this visit only */ }
    return next;
  });
  return [leave, toggle];
}

function WorkTime({ time, error, subjects, base, holidays, claude }) {
  const [pick, setPick] = useState(null); // a clicked bar: show only that day's log
  const [leave, toggleLeave] = useLeaveDays();
  if (!time) return error ? <p className="muted small">ดึงเวลาทำงานไม่สำเร็จ: {error}</p> : null;
  const daily = Array.isArray(time.daily) && time.daily.length ? time.daily : null;
  const sel = daily && daily.some((d) => d.date === pick) ? pick : null;
  const pct = Math.min(100, (time.todayHours / DAY_TARGET) * 100);
  const names = { ...subjects, ...(time.subjects || {}) };
  const days = [];
  for (const l of time.log || []) {
    const last = days.at(-1);
    if (last?.spentOn === l.spentOn) { last.items.push(l); last.hours += l.hours; }
    else days.push({ spentOn: l.spentOn, items: [l], hours: l.hours });
  }
  const shown = sel ? days.filter((d) => d.spentOn === sel) : days;
  const off = offDays(holidays?.list, leave, time.leaveDays);
  const stats = daily && workStats(daily, time.today, off);
  const selHours = sel ? daily.find((d) => d.date === sel).hours : 0;
  const activityId = usualActivity(time.log);
  const offNote = stats && stats.offDays.length ? ` · ไม่นับวันหยุด/วันลา ${stats.offDays.length} วัน` : '';
  return (
    <div className="worktime">
      {stats ? (
        <div className="rm-stats wt-stats">
          <span className="stat tone-done" title={fmtHours(time.todayHours)}><b>{fmtShort(time.todayHours)}</b>วันนี้</span>
          <span className="stat" title={fmtHours(time.weekHours)}><b>{fmtShort(time.weekHours)}</b>สัปดาห์นี้</span>
          <span className="stat" title={fmtHours(time.monthHours)}><b>{fmtShort(time.monthHours)}</b>เดือนนี้</span>
          <span className="stat" title={`เฉลี่ย ${fmtHours(stats.avg)} — นับเฉพาะวันทำงาน จ.–ศ. ที่ลงเวลาไว้ (${stats.avgDays} วัน ใน 28 วันล่าสุด)${offNote}`}>
            <b>{fmtShort(stats.avg)}</b>เฉลี่ย/วันทำงาน<small>จ.–ศ. ที่ลง · {stats.avgDays} วัน</small>
          </span>
          <span className={`stat ${stats.missing.length ? 'tone-warn' : 'tone-busy'}`}
            title={stats.missing.length ? `วันทำงาน จ.–ศ. ก่อนวันนี้ที่ยังเป็น 0 ชม.: ${stats.missing.map(dmy).join(', ')}${offNote}` : `ลงครบทุกวันทำงานใน 28 วันล่าสุด${offNote}`}>
            <b>{stats.missing.length} วัน</b>ยังไม่ลง log<small>จ.–ศ. ก่อนวันนี้ ไม่นับวันหยุด/ลา</small>
          </span>
        </div>
      ) : (
        <div className="wt-row">
          <span>⏱ วันนี้ลงเวลา <b>{fmtHours(time.todayHours)}</b></span>
          <span className="muted">สัปดาห์นี้ {fmtHours(time.weekHours)}</span>
        </div>
      )}
      <span className="bar big" title={`วันนี้ ${fmtHours(time.todayHours)} จาก ${DAY_TARGET} ชม.`}>
        <span style={{ width: `${pct}%` }} className={time.todayHours >= DAY_TARGET ? 'full' : ''} />
      </span>
      {error && <p className="muted small">อัปเดตเวลาไม่สำเร็จ ({error}) — แสดงค่าเดิม</p>}

      {daily && <DailyChart daily={daily} today={time.today} max={stats.max} off={off} sel={sel} onPick={(d) => setPick(d === sel ? null : d)} />}
      {daily && holidays && !holidays.configured && (
        <p className="muted small wt-hint">ยังไม่มีไฟล์วันหยุดนักขัตฤกษ์ (holidays.json — ดู README) · แตะแท่งแล้วกด “วันลา/วันหยุด” เพื่อไม่นับวันนั้น</p>
      )}
      {holidays?.error && <p className="muted small wt-hint">holidays.json: {holidays.error}</p>}
      {claude && <ClaudeWork claude={claude} date={sel || time.today} today={time.today} log={time.log} names={names} base={base} activityId={activityId} />}
      {time.commits && <CommitMatch commits={time.commits} names={names} base={base} claude={claude} activityId={activityId} />}

      {sel && (
        <div className="wt-filter">
          <span>แสดงเฉพาะ <b>{dayLabel(sel, time.today)}</b></span>
          <span className="wt-filter-btns">
            {off[sel]?.kind === 'holiday'
              ? <span className="off-tag is-holiday" title="จาก holidays.json">🎌 {off[sel].name}</span>
              : off[sel]?.kind === 'redmine'
              ? <span className="off-tag" title="ลงเวลา activity “Leave” ใน Redmine — ไม่นับเป็นวันที่ยังไม่ลง log และไม่นับในค่าเฉลี่ย">🏖 {off[sel].name}</span>
              : !isWeekend(sel) && (
                <button className="mini-btn" aria-pressed={!!off[sel]} onClick={() => toggleLeave(sel)}
                  title="เก็บไว้ในเบราว์เซอร์นี้เท่านั้น — วันนั้นจะไม่นับเป็นวันที่ยังไม่ลง log และไม่นับในค่าเฉลี่ย">
                  🏖 วันลา/วันหยุด{off[sel] ? ' ✓' : ''}
                </button>
              )}
            <button className="mini-btn" onClick={() => setPick(null)} aria-label="ล้างตัวกรอง แสดง log ทุกวัน">✕ ทุกวัน</button>
          </span>
        </div>
      )}
      {!sel && days.length === 0 && <p className="muted small">ยังไม่ได้ลงเวลาในช่วงนี้</p>}
      {sel && shown.length === 0 && (
        <p className="muted small">{selHours > 0
          ? `วันนั้นลงไว้ ${fmtHours(selHours)} แต่รายการเก่าเกินที่เก็บไว้ (เก็บ ${(time.log || []).length} รายการล่าสุด)`
          : off[sel] ? `${off[sel].name} — ไม่ได้ลงเวลา (ไม่นับเป็นวันที่ยังไม่ลง log)` : 'ไม่ได้ลงเวลาในวันนั้น'}</p>
      )}
      {shown.map((day) => (
        <details key={`${day.spentOn}${sel ? '-only' : ''}`} className="wt-day" open={sel ? true : day.spentOn === time.today}>
          <summary><span>{dayLabel(day.spentOn, time.today)}</span><span>{day.items.length} รายการ · <b>{fmtHours(day.hours)}</b></span></summary>
          <ul className="wt-log">
            {day.items.map((l, n) => (
              <li key={l.id ?? n}>
                <time title="เวลาที่ลงบันทึก">{l.createdOn ? new Date(l.createdOn).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—'}</time>
                <div className="wt-main">
                  <div className="wt-issue">
                    {l.issueId && base
                      ? <a href={`${base}/issues/${l.issueId}`} target="_blank" rel="noopener noreferrer">#{l.issueId}</a>
                      : <span>{l.issueId ? `#${l.issueId}` : 'ไม่ระบุ issue'}</span>}
                    {names[l.issueId] && <span className="wt-subj" title={names[l.issueId]}>{names[l.issueId]}</span>}
                  </div>
                  {(l.activity || l.comment) && (
                    <small className="muted wt-note" title={l.comment}>{l.activity && <span className="wt-act">{l.activity}</span>}{l.comment}</small>
                  )}
                </div>
                <b>{fmtHours(l.hours)}</b>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

// This week's tickets that my commits mention (local git log) but I logged no time on in Redmine.
// "⏱ ลงเวลา" only opens Redmine's own form in a new tab: nothing is logged from here.
function CommitMatch({ commits: c, names, base, claude, activityId }) {
  const tickets = Array.isArray(c.tickets) ? c.tickets : [];
  const span = (days) => (days.length > 1 ? `${dmy(days[0])}–${dmy(days.at(-1))}` : dmy(days[0]));
  return (
    <details className="wt-commits" open={tickets.length > 0}>
      <summary>
        <span>🔗 มี commit แต่ยังไม่ลงเวลา <small className="muted">สัปดาห์นี้ ตั้งแต่ {dmy(c.from)}</small></span>
        <span className="wt-commit-sum">
          {tickets.length > 0
            ? <span className="due tone-error">{tickets.length} งาน</span>
            : c.checked > 0 && <span className="due tone-done">ครบ</span>}
        </span>
      </summary>
      {tickets.length === 0 && (
        <p className="muted small">{c.checked > 0 ? `ลงเวลาครบทุกงานที่ commit สัปดาห์นี้ (${c.checked} งาน)` : 'สัปดาห์นี้ยังไม่มี commit ที่อ้างเลขงาน'}</p>
      )}
      <ul className="wt-commit-list">
        {tickets.map((t) => (
          <li key={t.id}>
            <div className="wt-issue">
              {base
                ? <a href={`${base}/issues/${t.id}`} target="_blank" rel="noopener noreferrer">#{t.id}</a>
                : <span>#{t.id}</span>}
              <span className="wt-subj" title={names[t.id] || ''}>
                {names[t.id] || (t.found === false ? <i className="muted">ไม่พบใน Redmine (เลขผิด หรือไม่มีสิทธิ์ดู)</i> : '')}
              </span>
            </div>
            <small className="muted wt-note">{t.repos.join(', ')} · {t.commits} commit ({span(t.days)})</small>
            {base && (() => {
              // pre-filled with the last commit day and, when known, how long Claude worked on it that day
              const hours = suggestHours(claudeMs(claude, t.lastCommit, t.id));
              return (
                <a className="mini-btn wt-log-btn" href={logTimeUrl(base, { issueId: t.id, date: t.lastCommit, hours, activityId })} target="_blank" rel="noopener noreferrer"
                  title={`เปิดฟอร์มลงเวลาของ Redmine ในแท็บใหม่ — กรอกวันที่ ${dmy(t.lastCommit)}${hours ? ` และ ${fmtHours(hours)} (เวลาที่ Claude ทำ)` : ''} ไว้ให้ ตรวจแล้วกดบันทึกเอง`}>⏱ ลงเวลา</a>
              );
            })()}
          </li>
        ))}
      </ul>
      <p className="muted small">
        จาก git log ของ {c.scanned} repo ({c.source === 'dev-work-report' ? 'รายการ repo ของ dev-work-report' : 'git.json'}) เทียบกับเวลาที่คุณลงสัปดาห์นี้
        {c.checked > 0 && <> · commit อ้าง {c.checked} งาน</>}
        {c.noTicket > 0 && <> · {c.noTicket} commit ไม่ได้อ้างเลขงาน</>}
        {c.missing?.length > 0 && <> · อ่านไม่ได้: {c.missing.join(', ')}</>}
      </p>
    </details>
  );
}

const TICKET_FROM = {
  prompt: 'เลขงานจาก prompt ล่าสุดที่อ้างเลขงาน',
  branch: 'เลขงานจากชื่อ git branch',
  commit: 'เลขงานจาก commit ล่าสุดของ branch นี้',
};

// How long Claude worked (working / using a tool, from hook events) per ticket on one day,
// next to what I logged. "⏱ ลงเวลา" opens Redmine's own form pre-filled: nothing is logged from here.
function ClaudeWork({ claude, date, today, log, names, base, activityId }) {
  const rows = claudeDay(claude, date, log);
  const sum = rows.reduce((n, r) => n + r.ms, 0) / 3_600_000;
  const todo = rows.filter((r) => r.suggest).length;
  return (
    <details className="wt-commits wt-claude" open={rows.length > 0}>
      <summary>
        <span>🐾 เวลาที่ Claude ทำงาน <small className="muted">{dayLabel(date, today)}</small></span>
        <span className="wt-commit-sum">
          {rows.length > 0 && <span className="muted small">{fmtShort(sum)}</span>}
          {todo > 0 ? <span className="due tone-warn">ยังไม่ลง {todo}</span> : rows.length > 0 && <span className="due tone-done">ครบ</span>}
        </span>
      </summary>
      {rows.length === 0 && <p className="muted small">ยังไม่มีเวลาทำงานของ Claude ในวันนั้น</p>}
      <ul className="wt-commit-list">
        {rows.map((r) => (
          <li key={r.ticket ?? `p:${r.project}`}>
            <div className="wt-issue">
              {r.ticket
                ? <>{base ? <a href={`${base}/issues/${r.ticket}`} target="_blank" rel="noopener noreferrer">#{r.ticket}</a> : <span>#{r.ticket}</span>}
                    <span className="wt-subj" title={names[r.ticket] || ''}>{names[r.ticket] || ''}</span></>
                : <span className="muted" title="ไม่รู้เลขงาน: ตั้งชื่อ branch ให้มีเลขงาน หรือพิมพ์ #เลขงาน ใน prompt">ไม่ทราบเลขงาน · {r.project || 'unknown'}</span>}
            </div>
            <small className="muted wt-note">
              Claude {fmtHours(r.ms / 3_600_000)}{r.ticket && <> · ลงแล้ว {r.logged ? fmtHours(r.logged) : '0'}</>}
            </small>
            {r.suggest && base ? (
              <a className="mini-btn wt-log-btn" href={logTimeUrl(base, { issueId: r.ticket, date, hours: r.suggest, activityId })} target="_blank" rel="noopener noreferrer"
                title={`เปิดฟอร์มลงเวลาของ Redmine — กรอก ${fmtHours(r.suggest)} วันที่ ${dmy(date)} ไว้ให้ (ปัดเป็น 15 นาที) ตรวจแล้วกดบันทึกเอง`}>⏱ ลง {fmtShort(r.suggest)}</a>
            ) : r.ticket && !r.suggest ? <span className="wt-log-btn muted small" title="ลงเวลาไว้ครบหรือมากกว่าเวลาที่ Claude ทำแล้ว">✓</span> : null}
          </li>
        ))}
      </ul>
      <p className="muted small">นับเฉพาะช่วงที่ Claude กำลังทำงาน/ใช้เครื่องมือ (ไม่นับตอนรอคุณ) · หลาย session ในงานเดียวกันพร้อมกันนับครั้งเดียว · เป็นแค่ตัวช่วยประมาณ ไม่ใช่เวลาทำงานของคุณทั้งหมด</p>
    </details>
  );
}

// Logged hours for the last 28 days. Dashed line = 8 h target; holidays / leave days are hatched.
function DailyChart({ daily, today, max, off, sel, onPick }) {
  const items = daily.map((d) => {
    const o = off[d.date];
    const hours = d.hours ? fmtHours(d.hours) : o ? 'ไม่ได้ลงเวลา' : '0 ชม.';
    return {
      date: d.date, value: d.hours,
      cls: [isWeekend(d.date) && 'is-weekend', d.hours >= DAY_TARGET && 'is-full', !d.hours && 'is-zero', o && 'is-off', o?.kind === 'holiday' && 'is-holiday'],
      label: `${longDay(d.date)}${d.date === today ? ' (วันนี้)' : ''}${o ? ` — ${o.name}` : ''} ลงเวลา ${hours}`,
      readout: <>{o && <span className="off-tag">{o.kind === 'holiday' ? '🎌' : '🏖'} {o.name}</span>} {d.hours ? fmtHours(d.hours) : 'ไม่ได้ลงเวลา'}</>,
    };
  });
  return (
    <BarChart items={items} today={today} top={Math.max(DAY_TARGET + 2, Math.ceil(max))} target={DAY_TARGET} sel={sel} onPick={onPick}
      hint="28 วันล่าสุด · แตะแท่งเพื่อดู log วันนั้น"
      ariaLabel="ชั่วโมงที่ลงเวลาใน 28 วันล่าสุด แต่ละแท่งคือหนึ่งวัน กดเพื่อกรอง log"
      legend={<span className="wt-legend muted" aria-hidden="true">{Object.keys(off).length > 0 && <><i className="lg-off" /> หยุด/ลา </>}<i /> {DAY_TARGET} ชม.</span>} />
  );
}

// Shared CSS bar chart (time tab + token tab): one button per day, readout above, Monday ticks below.
function BarChart({ items, today, top, target, sel, onPick, hint, ariaLabel, legend }) {
  const [hover, setHover] = useState(null);
  const focus = hover || sel;
  const fd = focus && items.find((d) => d.date === focus);
  return (
    <div className="wt-chart">
      <div className="wt-readout">
        <span aria-live="polite">{fd
          ? <><b>{dayLabel(fd.date, today)}</b> · {fd.readout}</>
          : <span className="muted">{hint}</span>}</span>
        {legend}
      </div>
      <div className="wt-plot" role="group" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {target != null && <span className="wt-target" style={{ bottom: `${(target / top) * 100}%` }} aria-hidden="true" />}
        {items.map((d) => {
          const cls = ['wt-bar', ...d.cls, d.date === today && 'is-today'].filter(Boolean).join(' ');
          return (
            <button key={d.date} type="button" className={cls} aria-pressed={sel === d.date} aria-label={d.label} title={d.label}
              onClick={() => onPick(d.date)} onMouseEnter={() => setHover(d.date)} onFocus={() => setHover(d.date)} onBlur={() => setHover(null)}>
              <span style={{ height: `${top > 0 ? Math.min(100, (d.value / top) * 100) : 0}%` }} />
            </button>
          );
        })}
      </div>
      <div className="wt-axis" aria-hidden="true">
        {items.map((d, i) => {
          const span = Math.min(7, items.length - i); // the last Monday may have little room left
          return dowOf(d.date) === 1 && span >= 4
            ? <span key={d.date} style={{ gridColumn: `${i + 1} / span ${span}` }}>{span >= 5 ? 'จ. ' : ''}{dmy(d.date)}</span>
            : null;
        })}
      </div>
    </div>
  );
}

// ---- 🪙 Tokens: real usage per day across every transcript (server/tokens.js) ----
// counted = input + output + cache_creation (same as the kittens); cache_read is shown apart.
function TokenCard({ tokens, demo }) {
  const [pick, setPick] = useState(null);
  const daily = tokens.daily || [];
  const today = daily.at(-1)?.date;
  const st = tokenStats(daily);
  const chip = (cls, v, label, small) => (
    <span className={`stat ${cls}`} title={`${v.counted.toLocaleString()} tokens (input + output + cache เขียน) · cache อ่านซ้ำ ${v.cacheRead.toLocaleString()} (ไม่นับ)`}>
      <b>{formatTokens(v.counted)}</b>{label}{small && <small>{small}</small>}
    </span>
  );
  const items = daily.map((d) => ({
    date: d.date, value: d.counted,
    cls: [isWeekend(d.date) && 'is-weekend', !d.counted && 'is-zero'],
    label: `${longDay(d.date)}${d.date === today ? ' (วันนี้)' : ''} ใช้ ${d.counted.toLocaleString()} tokens · cache อ่านซ้ำ ${d.cacheRead.toLocaleString()} (ไม่นับ)`,
    readout: d.counted ? <><b>{formatTokens(d.counted)}</b> tokens <span className="muted">· cache อ่าน {formatTokens(d.cacheRead)}</span></> : 'ไม่ได้ใช้',
  }));
  return (
    <section className="card redmine tokens" aria-label="tokens รายวัน">
      <div className="feed-head"><h2>🪙 Tokens รายวัน <small>ทุก session ในเครื่องนี้</small></h2></div>
      <p className="muted small">{demo ? 'DEMO — ตัวเลขจำลอง ไม่ได้อ่าน transcript' : tokens.ready ? <>อัปเดต {timeOf(tokens.updatedAt)} · อ่าน transcript จริง (main + subagent) ทุก ~1 นาทีขณะเปิดหน้านี้</> : 'กำลังสแกน transcript ครั้งแรก…'}</p>
      <div className="worktime tk-box">
        <div className="rm-stats tk-stats">
          {chip('tone-warn', tokens.today, 'วันนี้')}
          {chip('', tokens.week, 'สัปดาห์นี้')}
          {chip('', tokens.month, 'เดือนนี้')}
          <span className="stat" title={`เฉลี่ยเฉพาะวันที่มีการใช้ ${st.activeDays} วัน ใน 28 วันล่าสุด`}>
            <b>{formatTokens(st.avg)}</b>เฉลี่ย/วัน<small>วันที่ใช้ · {st.activeDays} วัน</small>
          </span>
        </div>
        <p className="muted small tk-cache">cache อ่านซ้ำ (ไม่นับ): วันนี้ {formatTokens(tokens.today.cacheRead)} · เดือนนี้ {formatTokens(tokens.month.cacheRead)}</p>
        {daily.length > 0 && (
          <BarChart items={items} today={today} top={st.max * 1.08} sel={daily.some((d) => d.date === pick) ? pick : null}
            onPick={(d) => setPick(d === pick ? null : d)} hint="28 วันล่าสุด · แตะแท่งเพื่อดูตัวเลขวันนั้น"
            ariaLabel="tokens ที่ใช้ใน 28 วันล่าสุด แต่ละแท่งคือหนึ่งวัน"
            legend={<span className="wt-legend muted" aria-hidden="true">สูงสุด {formatTokens(st.max)}</span>} />
        )}
      </div>
      <p className="muted small">นับ input + output + cache เขียน (เหมือนความอ้วนของลูกแมว) · แบ่งวันตามเวลาของคำตอบ (เวลาเครื่องนี้) · ไม่อ่าน/ไม่ส่งเนื้อหาข้อความ</p>
    </section>
  );
}
