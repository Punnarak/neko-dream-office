// Decoration that makes the room feel alive. None of it is a status: the sky and the wall clock follow
// the local clock, the meeting sign follows the iCal feed, the rest is play. Logic: ../lively.js.
import { useEffect, useRef, useState } from 'react';
import { clockOf } from '../office.js';

// Window sky overlay, drawn inside the window group of the backdrop svg (window = 210×150).
export function SkyTint({ phase }) {
  if (phase === 'day') return null;
  return (
    <g className={`sky-tint sky-${phase}`} aria-hidden="true">
      {phase === 'dawn' && <rect width="210" height="150" rx="12" fill="#ffc29e" opacity=".32" />}
      {phase === 'dusk' && <>
        <rect width="210" height="150" rx="12" fill="url(#duskSky)" opacity=".78" />
        <circle cx="150" cy="118" r="20" fill="#ff9a62" opacity=".9" />
      </>}
      {phase === 'night' && <>
        <rect width="210" height="150" rx="12" fill="#232a5c" opacity=".88" />
        <path d="M168 30a17 17 0 1 0 14 24 13 13 0 1 1-14-24z" fill="#fff6c8" />
        <g fill="#fff" className="stars">
          {[[24, 22], [62, 40], [96, 18], [128, 56], [40, 92], [84, 110], [186, 96], [150, 132], [18, 128]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 ? 1.3 : 1.9} style={{ animationDelay: `${(i * 0.7) % 3}s` }} />
          ))}
        </g>
      </>}
    </g>
  );
}

// The wall clock's hands, at the real local time. `bell` = a meeting starts within 15 minutes.
export function ClockHands({ angles, bell }) {
  return (
    <>
      <path d="M0 0V-15" transform={`rotate(${angles.hour})`} stroke="#4a3b52" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M0 0V-24" transform={`rotate(${angles.minute})`} stroke="#4a3b52" strokeWidth="2.4" strokeLinecap="round" />
      {bell && (
        <g transform="translate(0 -52)"><g className="bell">
          <path d="M-9 6q0-14 9-14t9 14l3 4h-24z" fill="#ffd86b" stroke="#4a3b52" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cy="12" r="3" fill="#4a3b52" />
        </g></g>
      )}
    </>
  );
}

// Room light by part of day + warm lamp glow after dark. Sits above the wall, below the cats.
export function RoomLight({ phase }) {
  return (
    <>
      <div className={`room-tint tint-${phase}`} aria-hidden="true" />
      {(phase === 'night' || phase === 'dusk') && <div className={`lamp-light lamp-${phase}`} aria-hidden="true" />}
    </>
  );
}

// Slowly drifting motes: fireflies after dark, otherwise the scene's own (dust, sparkles, petals, steam).
const MOTE = { office: 'dust', magic: 'sparkle', fairy: 'petal', cafe: 'steam', kitchen: 'steam' };
export function Ambient({ scene, phase }) {
  const kind = phase === 'night' ? 'firefly' : MOTE[scene] || 'dust';
  return (
    <div className={`ambient kind-${kind}`} aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className="mote" style={{ '--x': `${8 + ((i * 37) % 84)}%`, '--y': `${18 + ((i * 53) % 60)}%`, '--d': `${-(i * 2.3)}s`, '--t': `${11 + (i % 4) * 3}s` }}>
          {kind === 'sparkle' ? '✦' : null}
        </span>
      ))}
    </div>
  );
}

// While a meeting is on (or about to start) the framed wall sign turns into a meeting sign.
export function MeetingSign({ mood }) {
  if (!mood) return null;
  return (
    <div className={`meeting-sign sign-${mood.kind}`} role="status" title={mood.title}>
      <b>{mood.kind === 'now' ? '📅 ประชุมอยู่' : `🔔 อีก ${mood.inMin} นาที`}</b>
      <span>{mood.kind === 'now' ? `ถึง ${clockOf(mood.until)}` : `เริ่ม ${clockOf(mood.at)}`}</span>
      <small>{mood.title}</small>
    </div>
  );
}

// A yarn ball on the rug. Click it and it rolls away and back. Pure play.
export function YarnBall() {
  const [kick, setKick] = useState(0);
  return (
    <button className={`yarn ${kick ? `kick kick-${kick % 2}` : ''}`} onClick={() => setKick((k) => k + 1)}
      aria-label="ลูกไหมพรม (ของเล่น — กดเพื่อเตะ)" title="ลูกไหมพรม — กดเพื่อเตะ">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M30 30q8 4 9 9" fill="none" stroke="#e5707f" strokeWidth="1.6" strokeLinecap="round" />
        <g className="yarn-ball">
          <circle cx="20" cy="20" r="14" fill="#f4a6c1" stroke="#c45d7f" strokeWidth="1.4" />
          <path d="M8 14q12 6 24-6M7 22q14 4 26-10M10 30q12-2 22-18M18 34q4-12 14-20" fill="none" stroke="#c45d7f" strokeWidth="1.1" opacity=".7" />
        </g>
      </svg>
    </button>
  );
}

// Confetti for a moment (logged a full day). Removes itself.
export function Confetti({ run, onDone }) {
  useEffect(() => {
    if (!run) return undefined;
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!run) return null;
  const colors = ['#f4a6c1', '#9ad8c8', '#b6a7ea', '#ffd86b', '#a8c8f0', '#f8c99a'];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} style={{ '--x': `${(i * 29) % 100}%`, '--d': `${(i % 9) * 0.12}s`, '--r': `${(i * 47) % 360}deg`, background: colors[i % colors.length] }} />
      ))}
      <p className="party-note">🎉 วันนี้ลงเวลาครบแล้ว!</p>
    </div>
  );
}

// Hearts when the pointer strokes a cat or kitten: { hearts: { key: [{id, x}] }, pet(key) }.
// At most one heart per animal every 0.65 s; every third heart purrs (onPurr decides about sound).
export function usePetting(onPurr) {
  const [hearts, setHearts] = useState({});
  const last = useRef({});
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const pet = (key) => {
    const t = Date.now();
    if (t - (last.current[key] || 0) < 650) return;
    last.current[key] = t;
    const id = ++seq.current;
    const heart = { id, x: 25 + Math.round(Math.random() * 50) };
    setHearts((h) => ({ ...h, [key]: [...(h[key] || []).slice(-3), heart] }));
    setTimeout(() => { if (alive.current) setHearts((h) => ({ ...h, [key]: (h[key] || []).filter((x) => x.id !== id) })); }, 1400);
    if (id % 3 === 1) onPurr?.();
  };
  return { hearts, pet };
}

export function Hearts({ hearts }) {
  return (hearts || []).map((h) => <span key={h.id} className="heart" style={{ left: `${h.x}%` }} aria-hidden="true">♥</span>);
}

// Idle moves and reactions to real events for the desk cats: { catKey: act }.
// Idle: every 6–15 s one cat that is awake or asleep (never busy/alert/error) yawns, stretches, grooms
// or looks around. Event: the manager cat stretches when a turn ends, looks up when a subagent arrives.
export function useCatActs({ poses, lastEvent, sessionId, enabled, pickIdleAct, eventAct }) {
  const [acts, setActs] = useState({});
  const posesRef = useRef(poses);
  posesRef.current = poses;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const play = (key, act, ms = 2600) => {
    setActs((a) => ({ ...a, [key]: act }));
    setTimeout(() => { if (alive.current) setActs((a) => (a[key] === act ? { ...a, [key]: null } : a)); }, ms);
  };
  useEffect(() => {
    if (!enabled) return undefined;
    let t;
    const loop = () => {
      t = setTimeout(() => {
        if (document.visibilityState === 'visible') {
          const r = pickIdleAct(posesRef.current);
          if (r) play(r.key, r.act);
        }
        loop();
      }, 6000 + Math.random() * 9000);
    };
    loop();
    return () => clearTimeout(t);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled || !lastEvent || lastEvent.session?.id !== sessionId) return;
    const act = eventAct(lastEvent.item);
    if (act && posesRef.current.manage !== 'error') play('manage', act);
  }, [lastEvent]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    acts: enabled ? acts : {},
    cheer: () => { for (const k of Object.keys(posesRef.current)) play(k, 'cheer', 3200); },
  };
}
