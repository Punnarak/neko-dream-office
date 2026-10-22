// "ความมีชีวิต" — decoration that follows the real clock and real events, never a status of its own.
// Pure helpers here (tested in lively.test.js); the drawing lives in components/Lively.jsx.

// Part of the day for the window sky and the room light, from the local clock.
// dawn 05:00–07:00 · day 07:00–16:30 · dusk 16:30–18:30 · night otherwise
export function dayPhase(now) {
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= 300 && m < 420) return 'dawn';
  if (m >= 420 && m < 990) return 'day';
  if (m >= 990 && m < 1110) return 'dusk';
  return 'night';
}

// Wall-clock hand angles in degrees (0 = 12 o'clock, clockwise).
export function clockAngles(now) {
  const d = new Date(now);
  const min = d.getMinutes() + d.getSeconds() / 60;
  return { hour: ((d.getHours() % 12) + min / 60) * 30, minute: min * 6 };
}

// Idle acts a desk cat may do now and then while nothing real happens at its desk.
export const IDLE_ACTS = ['yawn', 'stretch', 'groom', 'look'];
const ACT_POSES = new Set(['awake', 'sleep']); // never over busy / alert / error / off: those are real

// Pick one cat (key) and one act, or null. `poses` = { catKey: pose }; `rand` = Math.random-like.
export function pickIdleAct(poses, rand = Math.random) {
  const keys = Object.keys(poses).filter((k) => ACT_POSES.has(poses[k]));
  if (!keys.length) return null;
  const key = keys[Math.floor(rand() * keys.length) % keys.length];
  // a sleeping cat only stretches or yawns in its sleep
  const acts = poses[key] === 'sleep' ? ['yawn', 'stretch'] : IDLE_ACTS;
  return { key, act: acts[Math.floor(rand() * acts.length) % acts.length] };
}

// The reaction a real hook event earns on the manager cat, or null.
export function eventAct(item) {
  if (!item) return null;
  if (item.event === 'Stop') return 'stretch';      // turn finished: stretch
  if (item.event === 'SubagentStart') return 'look'; // someone walks in: look over
  return null;
}

// Celebrate once per day when today's logged hours reach the target.
// `done` = the date it last fired. Returns the date to store, or null.
export function partyDue(todayHours, target, today, done) {
  return Number.isFinite(todayHours) && todayHours >= target && today && done !== today ? today : null;
}

// Meeting state for the room: the sign on the wall and the clock's bell. `cal` = calendarDay(...).
export function meetingMood(cal) {
  const e = cal?.next;
  if (!e) return null;
  if (e.state === 'now') return { kind: 'now', title: e.title, until: e.end };
  if (e.state === 'soon') return { kind: 'soon', title: e.title, inMin: e.inMin, at: e.start };
  return null;
}
