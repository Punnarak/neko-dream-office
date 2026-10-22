// A small hand-drawn SVG cat at its desk. Pose comes from real state; the
// elements marked "decor" (zzz, sparkles, sweat) are decorative only.

import { DECOR } from './SceneDecor.jsx';

const PINK = '#f7a8be';
const HEADWEAR = ['Pudding', 'Luna']; // hidden when the scene gives every cat a hat
const INK = '#4a3b52';

// ---- animal parts (animals.js). Drawn in the desk cat's coordinates (head centre 60,57);
// the kitten reuses them through KITTEN_HEAD, its head being a little bigger and 1px lower.
const mirror = (el) => <>{el}<g transform="translate(120 0) scale(-1 1)">{el}</g></>;
const KITTEN_HEAD = 'translate(60 58) scale(1.07 1.09) translate(-60 -57)';

// Ears behind the head.
const EARS = {
  cat: (fur, line) => <>
    <path d="M36 46L40 22l15 14z" fill={fur} stroke={line} strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M84 46L80 22 65 36z" fill={fur} stroke={line} strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M40 40l2-11 7 7z M80 40l-2-11-7 7z" fill={PINK} />
  </>,
  fox: (fur, line) => mirror(<>
    <path d="M34 48L35 13l22 21z" fill={fur} stroke={line} strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M38 41l.5-19 11 11z" fill="#fff6ec" opacity=".85" />
    <path d="M35 21l0-8 7 7z" fill={line} opacity=".55" />
  </>),
  bear: (fur, line) => mirror(<>
    <circle cx="38" cy="37" r="9" fill={fur} stroke={line} strokeWidth="1.2" />
    <circle cx="38.5" cy="37.5" r="4.6" fill={PINK} opacity=".7" />
  </>),
  bunny: (fur, line) => mirror(<>
    <ellipse cx="48" cy="21" rx="7" ry="17" transform="rotate(-10 48 21)" fill={fur} stroke={line} strokeWidth="1.2" />
    <ellipse cx="48" cy="22" rx="3.4" ry="12.5" transform="rotate(-10 48 22)" fill={PINK} opacity=".8" />
  </>),
  dog: () => null, // floppy ears hang in front of the head: FRONT_EARS
};

// Ears in front of the head (dog only).
const FRONT_EARS = {
  dog: (fur, line, accent) => mirror(
    <path d="M38 37q-11 1-12 19q0 10 7 9q7-2 9-14z" fill={accent} stroke={line} strokeWidth="1.2" strokeLinejoin="round" />,
  ),
};

// Nose + mouth. `sad` = the error frown.
const smile = (line, sad) => (sad ? 'M55 70q5-4 10 0' : 'M55 67q2.5 3 5 0q2.5 3 5 0');
const MUZZLES = {
  cat: (line, sad) => <>
    <path d="M58 63h4l-2 2.5z" fill={PINK} />
    <path d={smile(line, sad)} fill="none" stroke={line} strokeWidth="1.4" strokeLinecap="round" />
  </>,
  dog: (line, sad) => <>
    <ellipse cx="60" cy="66" rx="10" ry="7" fill="#fff" opacity=".5" />
    <ellipse cx="60" cy="63" rx="3.8" ry="2.8" fill={INK} />
    <path d={`M60 65.5v1.5 ${smile(line, sad)}`} fill="none" stroke={line} strokeWidth="1.4" strokeLinecap="round" />
  </>,
  bear: (line, sad) => <>
    <ellipse cx="60" cy="66" rx="9" ry="7" fill="#fff7ec" opacity=".75" />
    <ellipse cx="60" cy="62.8" rx="3.4" ry="2.5" fill={INK} />
    <path d={`M60 65v2 ${smile(line, sad)}`} fill="none" stroke={line} strokeWidth="1.4" strokeLinecap="round" />
  </>,
  bunny: (line, sad) => <>
    <path d="M58 63h4l-2 2.5z" fill={PINK} />
    <rect x="58" y="68" width="4" height="3.2" rx=".8" fill="#fff" stroke={line} strokeWidth=".8" />
    <path d={sad ? 'M55 70q5-4 10 0' : 'M60 65.5v2.5M60 68q-3 2.2-5 0M60 68q3 2.2 5 0'} fill="none" stroke={line} strokeWidth="1.3" strokeLinecap="round" />
  </>,
  fox: (line, sad) => <>
    <path d="M33 60q14 1 27 9q13-8 27-9q-4 15-27 17q-23-2-27-17z" fill="#fff" opacity=".7" />
    <ellipse cx="60" cy="63" rx="3" ry="2.2" fill={INK} />
    <path d={`M60 65v1.5 ${smile(line, sad)}`} fill="none" stroke={line} strokeWidth="1.4" strokeLinecap="round" />
  </>,
};

// Tails: desk cat (sitting) and kitten (standing) have different spots.
const TAILS = {
  cat: { desk: (fur) => <path d="M84 92q22-2 16-24" fill="none" stroke={fur} strokeWidth="7" strokeLinecap="round" />,
    kitten: (fur) => <path d="M78 104q20 0 18-20" fill="none" stroke={fur} strokeWidth="6" strokeLinecap="round" /> },
  dog: { desk: (fur) => <path className="wag" d="M84 92q14-2 13-15" fill="none" stroke={fur} strokeWidth="6" strokeLinecap="round" />,
    kitten: (fur) => <path className="wag" d="M78 102q13 0 12-12" fill="none" stroke={fur} strokeWidth="5" strokeLinecap="round" /> },
  fox: { desk: (fur, line) => <>
    <path d="M82 97q27 2 22-28q-5-4-8 1q1 17-15 18z" fill={fur} stroke={line} strokeWidth="1.1" strokeLinejoin="round" />
    <path d="M104 69q-5-4-8 1l1.5 5q5-2 6.5-6z" fill="#fff" />
  </>, kitten: (fur, line) => <>
    <path d="M76 106q25 2 20-25q-5-3-7 1q1 15-14 16z" fill={fur} stroke={line} strokeWidth="1.1" strokeLinejoin="round" />
    <path d="M96 81q-5-3-7 1l1.4 4.5q4.5-1.8 5.6-5.5z" fill="#fff" />
  </> },
  bunny: { desk: (fur, line) => <circle cx="86" cy="98" r="6.5" fill="#fff" stroke={line} strokeWidth="1" />,
    kitten: (fur, line) => <circle cx="80" cy="105" r="5.5" fill="#fff" stroke={line} strokeWidth="1" /> },
  bear: { desk: (fur, line) => <circle cx="86" cy="98" r="5" fill={fur} stroke={line} strokeWidth="1" />,
    kitten: (fur, line) => <circle cx="80" cy="105" r="4.2" fill={fur} stroke={line} strokeWidth="1" /> },
};

const partsOf = (animal) => {
  const a = EARS[animal] ? animal : 'cat';
  return { ears: EARS[a], frontEars: FRONT_EARS[a], muzzle: MUZZLES[a], tail: TAILS[a] };
};

function Eyes({ pose }) {
  if (pose === 'sleep' || pose === 'off') {
    return (
      <g stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round">
        <path d="M43 57q5 5 10 0" />
        <path d="M67 57q5 5 10 0" />
      </g>
    );
  }
  if (pose === 'error') {
    return (
      <g stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M44 53l7 4-7 4" />
        <path d="M76 53l-7 4 7 4" />
      </g>
    );
  }
  const r = pose === 'alert' ? 5.2 : pose === 'busy' ? 3.8 : 4.4;
  return (
    <g fill={INK} className="eyes">
      <ellipse cx="48" cy="57" rx={r} ry={r + 0.8} />
      <ellipse cx="72" cy="57" rx={r} ry={r + 0.8} />
      <circle cx="49.6" cy="55" r="1.5" fill="#fff" />
      <circle cx="73.6" cy="55" r="1.5" fill="#fff" />
    </g>
  );
}

function Accessory({ name, accent }) {
  switch (name) {
    case 'Mochi': // round glasses
      return (
        <g stroke={INK} strokeWidth="1.6" fill="rgba(255,255,255,.35)">
          <circle cx="48" cy="57" r="8" /><circle cx="72" cy="57" r="8" /><path d="M56 57h8" fill="none" />
        </g>
      );
    case 'Nori': // little tie
      return <path d="M60 76l-5 4 5 14 5-14z" fill={accent} stroke={INK} strokeWidth="1" />;
    case 'Pudding': // beret
      return (
        <g>
          <ellipse cx="66" cy="34" rx="17" ry="7" fill={accent} transform="rotate(-12 66 34)" />
          <circle cx="68" cy="26" r="2.4" fill={accent} />
        </g>
      );
    case 'Pixel': // headset
      return (
        <g fill="none" stroke={INK} strokeWidth="2">
          <path d="M33 56q0-30 27-30t27 30" />
          <rect x="29" y="52" width="7" height="11" rx="3" fill={accent} />
          <rect x="84" y="52" width="7" height="11" rx="3" fill={accent} />
        </g>
      );
    case 'Luna': // crescent clip
      return <path d="M80 36a7 7 0 1 0 6 9 5.5 5.5 0 1 1-6-9z" fill="#fff6b8" stroke={INK} strokeWidth="0.8" />;
    case 'Miso': // scarf
      return <path d="M40 75q20 9 40 0l-2 6q-18 7-36 0z" fill={accent} />;
    default:
      return null;
  }
}

function DeskProp({ name, accent, active }) {
  switch (name) {
    case 'Mochi':
      return (
        <g>
          <rect x="70" y="84" width="34" height="20" rx="3" fill="#6b5b7a" />
          <rect x="73" y="87" width="28" height="14" rx="2" fill={active ? '#c9f2e3' : '#8f80a0'} className="screen" />
          {active && <g stroke="#3d8f74" strokeWidth="1.5"><path d="M76 91h10M76 95h16M76 99h7" /></g>}
        </g>
      );
    case 'Miso':
      return (
        <g>
          <path d="M72 100l14-6 14 6v4l-14-5-14 5z" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <circle cx="98" cy="88" r="6" fill="rgba(200,235,255,.6)" stroke={INK} strokeWidth="1.6" />
          <path d="M102 92l5 5" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      );
    case 'Luna':
      return (
        <g>
          <rect x="74" y="86" width="30" height="18" rx="2" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <rect x="78" y="96" width="4" height="6" fill={accent} /><rect x="85" y="92" width="4" height="10" fill={accent} />
          <rect x="92" y="89" width="4" height="13" fill={accent} /><rect x="99" y="94" width="3" height="8" fill={accent} />
        </g>
      );
    case 'Pudding':
      return (
        <g>
          <ellipse cx="88" cy="99" rx="15" ry="7" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <circle cx="82" cy="98" r="2.4" fill="#f7a8be" /><circle cx="88" cy="96" r="2.4" fill="#9ad8c8" /><circle cx="94" cy="99" r="2.4" fill="#b6a7ea" />
          <path d="M100 84l-8 12" stroke="#a07050" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      );
    case 'Pixel':
      return (
        <g>
          <rect x="78" y="84" width="22" height="20" rx="2" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <rect x="84" y="82" width="10" height="4" rx="1" fill={accent} />
          <path d="M82 93l3 3 5-6M82 100h12" stroke="#3d8f74" strokeWidth="1.6" fill="none" />
        </g>
      );
    default: // Nori: mug
      return (
        <g>
          <rect x="84" y="88" width="14" height="15" rx="3" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <path d="M98 92q5 0 5 4t-5 4" fill="none" stroke={INK} strokeWidth="1.4" />
          <rect x="16" y="88" width="18" height="15" rx="2" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <path d="M19 93h12M19 97h9" stroke={INK} strokeWidth="1" />
        </g>
      );
  }
}

// `act` = a decorative idle move (lively.js): yawn | stretch | groom | look | cheer. Never a status.
export function Cat({ cat, pose, scene, animal = 'cat', act = null }) {
  const busy = pose === 'busy';
  const p = partsOf(animal);
  const sc = DECOR[scene]?.cat || {}; // scene accessories/desk/props; office = none of these
  const Prop = sc.props?.[cat.name];
  return (
    <svg viewBox="0 0 120 120" className={`cat pose-${pose} ${act ? `act-${act}` : ''}`} role="img" aria-label={`${cat.name} ${cat.role}`}>
      {sc.back}
      {/* tail */}
      <g className="sway">{p.tail.desk(cat.fur, INK)}</g>
      {/* body + head (the "breathe" group rises a little, decor only) */}
      <g className="breathe">
      <ellipse cx="60" cy="88" rx="25" ry="19" fill={cat.fur} stroke={INK} strokeWidth="1.2" />
      {sc.body?.(cat.accent)}
      <g className="head">
      <g className="ears">{p.ears(cat.fur, INK)}</g>
      <ellipse cx="60" cy="57" rx="28" ry="23" fill={cat.fur} stroke={INK} strokeWidth="1.2" />
      {p.frontEars?.(cat.fur, INK, cat.accent)}
      <ellipse cx="41" cy="66" rx="5" ry="3" fill={PINK} opacity=".55" />
      <ellipse cx="79" cy="66" rx="5" ry="3" fill={PINK} opacity=".55" />
      {p.muzzle(INK, pose === 'error')}
      <Eyes pose={pose} />
      {!(sc.hat && HEADWEAR.includes(cat.name)) && <Accessory name={cat.name} accent={cat.accent} />}
      {sc.hat?.(cat.accent)}
      {act === 'yawn' && <ellipse className="yawn" cx="60" cy="69" rx="4.5" ry="5.5" fill="#b0506a" stroke={INK} strokeWidth="1" />}
      </g>
      </g>
      {/* desk: lit top face receding toward the wall + shaded front face */}
      <path d="M13 95H107L116 105H4z" fill="var(--desk-top)" strokeLinejoin="round" stroke="var(--desk-top)" strokeWidth="2" />
      <rect x="4" y="104" width="112" height="15" rx="3" fill="var(--desk)" />
      <rect x="4" y="104" width="112" height="1.6" fill="#fff" opacity=".4" />
      <rect x="4" y="112" width="112" height="7" rx="3" fill="#4a3b52" opacity=".14" />
      {sc.desk}
      {Prop ? Prop(cat.accent, busy) : <DeskProp name={cat.name} accent={cat.accent} active={busy} />}
      {/* paws on the desk edge — they tap only while a real tool is running */}
      <ellipse className="paw paw-l" cx="48" cy="103" rx="6" ry="4" fill={cat.fur} stroke={INK} strokeWidth="1" />
      <ellipse className="paw paw-r" cx="66" cy="103" rx="6" ry="4" fill={cat.fur} stroke={INK} strokeWidth="1" />
      {act === 'groom' && <ellipse className="groom-paw" cx="74" cy="72" rx="6" ry="4.5" fill={cat.fur} stroke={INK} strokeWidth="1" />}

      {/* decorative only */}
      <g className="decor" aria-hidden="true">
        {pose === 'sleep' && <text x="86" y="30" className="zzz">z<tspan dx="2" dy="-6" fontSize="9">z</tspan></text>}
        {pose === 'error' && <path d="M88 38q4 6 0 9q-4-3 0-9z" fill="#9fd3f7" />}
        {pose === 'alert' && <text x="88" y="32" className="bang">!</text>}
        {busy && <g fill="#ffd86b"><path d="M20 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><circle cx="100" cy="22" r="2" /></g>}
        {act === 'groom' && <g fill="#9ad8f0"><circle cx="86" cy="62" r="1.6" /><circle cx="90" cy="56" r="1.2" /></g>}
        {act === 'cheer' && <g fill="#ffd86b"><path d="M16 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><path d="M100 16l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" /></g>}
      </g>
    </svg>
  );
}

// A small kitten for one real agent: big head, tiny body, no desk. The main agent wears a
// crown and has its own fur; subagents get a collar. Fur colour is decoration only.
const KITTEN_FURS = [['#fde3cf', '#f4a6c1'], ['#d9ecf7', '#6fa5cf'], ['#e6f2d8', '#7fbf8f'], ['#efe2fa', '#9c8fd6'], ['#fff1c9', '#e0b14e'], ['#f9d9d2', '#e5707f']];
export const MAIN_KITTEN = ['#4a3b52', '#ffd86b'];

export function kittenFur(agent) {
  if (agent.main) return MAIN_KITTEN;
  let h = 0;
  for (const ch of agent.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return KITTEN_FURS[h % KITTEN_FURS.length];
}

// Body size per chubbiness level (office.js CHUBBY: slim → very round); null (usage unknown) = normal.
// Only the body widens — the head, the hit area and the kitten's footprint in the scene stay the same.
const KITTEN_BODY = [[15, 13], [19, 14], [23, 15], [26.5, 16], [30, 17.5]];

export function Kitten({ agent, pose, scene, chub = null, animal = 'cat' }) {
  const p = partsOf(animal);
  const [fur, accent] = kittenFur(agent);
  const dark = agent.main;
  const line = dark ? '#2b2131' : INK;
  const sc = DECOR[scene]?.kitten || {}; // the main kitten keeps its crown and holds the scene item instead of a hat
  const [rx, ry] = KITTEN_BODY[chub ?? 1];
  const pawX = rx * 0.42;
  return (
    <svg viewBox="14 8 92 108" className={`kitten pose-${pose} chub-${chub ?? 'unknown'}`} aria-hidden="true">
      {sc.back}
      {/* tail — follows the side of the body */}
      <g className="tail" style={{ transform: `translateX(${rx - 19}px)` }}><g className="sway">{p.tail.kitten(fur, line)}</g></g>
      {/* body (width = real token usage) + belly + paws */}
      <ellipse className="bod" cx="60" cy="98" style={{ rx: `${rx}px`, ry: `${ry}px` }} rx={rx} ry={ry} fill={fur} stroke={line} strokeWidth="1.2" />
      {chub >= 2 && <ellipse className="bod" cx="60" cy="101" style={{ rx: `${rx * 0.55}px`, ry: `${ry * 0.55}px` }} rx={rx * 0.55} ry={ry * 0.55} fill="#fff" opacity={dark ? 0.16 : 0.42} />}
      <ellipse className="paw paw-l" style={{ cx: `${60 - pawX}px` }} cx={60 - pawX} cy="110" rx="5" ry="3.5" fill={fur} stroke={line} strokeWidth="1" />
      <ellipse className="paw paw-r" style={{ cx: `${60 + pawX}px` }} cx={60 + pawX} cy="110" rx="5" ry="3.5" fill={fur} stroke={line} strokeWidth="1" />
      {sc.body}
      {/* ears + head */}
      <g transform={KITTEN_HEAD}>{p.ears(fur, line)}</g>
      <ellipse cx="60" cy="58" rx="30" ry="25" fill={fur} stroke={line} strokeWidth="1.2" />
      {p.frontEars && <g transform={KITTEN_HEAD}>{p.frontEars(fur, line, accent)}</g>}
      {dark && <path d="M60 36l-6 10h12z" fill="#fff" opacity=".9" />}
      <ellipse cx="40" cy="67" rx="5" ry="3" fill={PINK} opacity=".6" />
      <ellipse cx="80" cy="67" rx="5" ry="3" fill={PINK} opacity=".6" />
      {dark && pose !== 'off' && <g fill="#fff"><circle cx="48" cy="57" r="7" /><circle cx="72" cy="57" r="7" /></g>}
      <g transform="translate(0 1)">{p.muzzle(dark ? '#fff' : INK, false)}</g>
      <Eyes pose={pose} />
      {agent.main ? (
        <g>
          <path d="M45 30l4-12 6 8 5-11 5 11 6-8 4 12z" fill={accent} stroke={line} strokeWidth="1" strokeLinejoin="round" />
          {sc.item}
        </g>
      ) : (
        <g>
          <path d="M43 82q17 7 34 0" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" />
          <circle cx="60" cy="87" r="3" fill="#ffd86b" stroke={INK} strokeWidth=".8" />
          {sc.hat?.(line)}
        </g>
      )}
    </svg>
  );
}
