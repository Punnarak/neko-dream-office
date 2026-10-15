// Per-scene drawings for "ธีมห้อง". OfficeBackdrop, Cat and Kitten draw the shared layout and ask the
// active scene for each slot below; a slot a scene leaves out falls back to the office drawing.
// Decoration only: slots get the same pose/active flags the office drawings get, nothing more.
//
// Slots — room (1000×620 svg): pattern, flag(x, y, i), sky, windowExtra, shelfItem(i, row), lamp(x),
//   plant(x, y, s), floorLeft · cat (120×120 svg): back, body(accent), hat(accent), desk, props[name](accent, active)
//   · kitten: back, body, hat(line), item — the main kitten keeps its crown and gets `item` instead of `hat`.

const INK = '#4a3b52';
const GOLD = '#ffd86b';
const CANDY = ['#f4a6c1', '#9ad8c8', '#b6a7ea', '#f8c99a', '#a8c8f0', '#f6dfa8'];

const sparkle = (x, y, s, fill = GOLD) => (
  <path d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}z`} fill={fill} />
);
const star = (x, y, r, fill = GOLD, extra = {}) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const d = i % 2 ? r * 0.45 : r;
    return `${(x + d * Math.cos(a)).toFixed(1)},${(y + d * Math.sin(a)).toFixed(1)}`;
  });
  return <polygon points={pts.join(' ')} fill={fill} {...extra} />;
};
const flower = (x, y, r, fill) => (
  <g>
    {[0, 72, 144, 216, 288].map((a) => (
      <circle key={a} cx={x + r * Math.cos((a * Math.PI) / 180)} cy={y + r * Math.sin((a * Math.PI) / 180)} r={r * 0.75} fill={fill} />
    ))}
    <circle cx={x} cy={y} r={r * 0.6} fill={GOLD} />
  </g>
);
const steam = (x, y) => (
  <path d={`M${x} ${y}q-3-4 0-7q3-4 0-7M${x + 6} ${y + 1}q-3-4 0-7q3-4 0-7`} fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="1.4" strokeLinecap="round" />
);

function Plant({ x, y, s }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-8 -30q-30-30-18-62q14 22 18 62zM8 -30q30-30 18-62q-14 22-18 62zM0 -34q0-40 0-70q12 34 0 70z" fill="var(--leaf)" />
      <path d="M-22 -34h44l-6 34h-32z" fill="var(--pot)" />
    </g>
  );
}

// ---------- office: the original room (also the fallback for every slot) ----------
const office = {
  pattern: (
    <>
      <circle cx="11" cy="11" r="2.4" fill="var(--wall-dot)" />
      <path d="M33 30l2.4 1.8-.9-2.8 2.4-1.7h-3l-.9-2.8-.9 2.8h-3l2.4 1.7-.9 2.8z" fill="var(--wall-dot)" />
    </>
  ),
  flag: (x, y, i) => <path d={`M${x - 14} ${y}L${x + 14} ${y}L${x} ${y + 24}z`} fill={CANDY[i % CANDY.length]} />,
  sky: (
    <>
      <rect width="210" height="150" rx="12" fill="url(#sky)" />
      <circle cx="160" cy="40" r="17" fill="var(--sun)" />
      <g fill="#ffffffcc"><ellipse cx="60" cy="58" rx="28" ry="10" /><ellipse cx="80" cy="50" rx="18" ry="10" /><ellipse cx="150" cy="105" rx="24" ry="8" /></g>
      <g fill="#fff"><circle cx="30" cy="25" r="1.6" /><circle cx="110" cy="20" r="1.4" /><circle cx="185" cy="80" r="1.4" /></g>
    </>
  ),
  shelfItem: (i, r) => <rect x={6 + i * 18} y={14 + ((i + r) % 3) * 6} width="14" height={52 - ((i + r) % 3) * 6} rx="2" fill={CANDY[i]} />,
  lamp: (x) => (
    <g>
      <path d={`M${x} 0V40`} stroke="var(--string)" strokeWidth="2" />
      <circle cx={x} cy="88" r="60" fill="url(#lampglow)" />
      <path d={`M${x - 24} 62q24-34 48 0z`} fill="var(--lamp)" />
      <circle cx={x} cy="64" r="6" fill="#fff3b8" />
    </g>
  ),
  plant: (x, y, s) => <Plant x={x} y={y} s={s} />,
  floorLeft: ( // cat tree
    <g transform="translate(18 470)">
      <rect x="28" y="0" width="16" height="120" fill="var(--wood-dark)" />
      <rect x="0" y="-10" width="72" height="18" rx="9" fill="var(--rug)" />
      <rect x="-6" y="112" width="84" height="16" rx="8" fill="var(--rug)" />
      <circle cx="60" cy="40" r="7" fill="#f4a6c1" /><path d="M60 8V33" stroke="#4a3b52" strokeWidth="1.5" />
    </g>
  ),
};

// ---------- โรงเรียนเวทมนตร์: night sky, floating candles, potion shelf, wizard hats ----------
const POTIONS = ['#b6a7ea', '#9ad8c8', '#f4a6c1', GOLD, '#8fb3e8', '#e5707f'];
const HAT = '#5b4f9e';
const magic = {
  pattern: (
    <>
      {sparkle(11, 11, 3.4, 'var(--wall-dot)')}
      <path d="M33 26a6 6 0 1 0 5 9 4.6 4.6 0 1 1-5-9z" fill="var(--wall-dot)" />
    </>
  ),
  flag: (x, y, i) => (
    <g>
      <path d={`M${x} ${y}v${8 + (i % 3) * 5}`} stroke="var(--string)" strokeWidth="1.2" />
      {star(x, y + 16 + (i % 3) * 5, 9, i % 2 ? GOLD : '#d8ccff')}
    </g>
  ),
  sky: (
    <>
      <rect width="210" height="150" rx="12" fill="#3a3478" />
      <rect width="210" height="150" rx="12" fill="url(#sky)" opacity=".25" />
      <path d="M150 22a20 20 0 1 0 16 30 15 15 0 1 1-16-30z" fill="#fff1b8" />
      {sparkle(40, 30, 5, '#fff')}{sparkle(95, 110, 4, '#fff')}{sparkle(185, 120, 3.5, '#fff')}
      <g fill="#fff"><circle cx="70" cy="22" r="1.4" /><circle cx="120" cy="60" r="1.6" /><circle cx="25" cy="95" r="1.2" /><circle cx="60" cy="130" r="1.3" /></g>
      <path d="M140 118l40-14" stroke="#fff" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  shelfItem: (i, r) => {
    const x = 6 + i * 18;
    const c = POTIONS[(i + r * 2) % POTIONS.length];
    return (i + r) % 2 ? (
      <g>
        <rect x={x + 5} y="36" width="4" height="10" fill="#fffaf0aa" />
        <rect x={x + 4.5} y="32" width="5" height="5" rx="1" fill="#b98b67" />
        <circle cx={x + 7} cy="56" r="8" fill={c} stroke={INK} strokeWidth=".8" />
        <circle cx={x + 4.5} cy="53" r="2" fill="#fff" opacity=".6" />
      </g>
    ) : (
      <g>
        <rect x={x + 1} y="30" width="12" height="36" rx="3" fill={c} stroke={INK} strokeWidth=".8" />
        <rect x={x + 4} y="22" width="6" height="9" rx="1.5" fill="#fffaf0aa" />
        {star(x + 7, 46, 3.5, '#fff')}
      </g>
    );
  },
  lamp: (x) => ( // floating candle
    <g>
      <circle cx={x} cy="64" r="44" fill="url(#lampglow)" />
      <rect x={x - 6} y="52" width="12" height="30" rx="2" fill="#fff8e6" stroke="#e8d7b8" strokeWidth="1" />
      <path d={`M${x - 6} 56q3 3 3 8`} stroke="#e8d7b8" strokeWidth="2" fill="none" />
      <path d={`M${x} 36q6 8 0 14q-6-6 0-14z`} fill="#ffb84d" />
      <path d={`M${x} 41q3 4 0 8q-3-4 0-8z`} fill="#fff1b8" />
    </g>
  ),
  floorLeft: ( // big cauldron + broom
    <g transform="translate(18 470)">
      <path d="M78 10L104 118" stroke="#b98b67" strokeWidth="5" strokeLinecap="round" />
      <path d="M96 100l-8 24h28l-6-26z" fill="#e8c37f" stroke="#b98b67" strokeWidth="1.5" />
      <ellipse cx="40" cy="92" rx="42" ry="32" fill="#3d3550" />
      <ellipse cx="40" cy="64" rx="40" ry="10" fill="#7fd6a0" stroke="#2b2438" strokeWidth="5" />
      <g fill="#b6f0c9"><circle cx="28" cy="52" r="6" /><circle cx="48" cy="44" r="4" /><circle cx="58" cy="56" r="3" /></g>
      <path d="M10 122l8-10M70 122l-8-10" stroke="#2b2438" strokeWidth="5" strokeLinecap="round" />
    </g>
  ),
  cat: {
    back: <path d="M34 78q-8 22-4 34h60q4-12-4-34z" fill={HAT} stroke={INK} strokeWidth="1" />, // cape
    hat: (accent) => (
      <g stroke={INK} strokeWidth="1" strokeLinejoin="round">
        <path d="M42 35L57 4q3-4 6 0L78 35z" fill={HAT} />
        <path d="M44 31q16 5 32 0l1.6 4.5q-17.6 5-35.2 0z" fill={accent} />
        <ellipse cx="60" cy="36" rx="25" ry="5" fill={HAT} />
        {star(61, 19, 5, GOLD, { stroke: 'none' })}
      </g>
    ),
    desk: ( // scalloped tablecloth with stars
      <g>
        <path d={`M4 103h112v9${Array.from({ length: 8 }, () => 'q-7 6-14 0').join('')}z`} fill={HAT} />
        {sparkle(24, 109, 2.2)}{sparkle(60, 108, 2.2)}{sparkle(96, 109, 2.2)}
      </g>
    ),
    props: {
      Mochi: (accent, active) => ( // spellbook
        <g>
          <path d="M68 104l19-6 19 6" stroke={HAT} strokeWidth="3" fill="none" />
          <path d="M70 101l17-6 17 6v3l-17-5-17 5z" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <path d="M75 99l8-2.5M91 96.5l8 2.5" stroke={accent} strokeWidth="1.2" />
          {active && <g>{sparkle(80, 88, 3)}{sparkle(95, 84, 2.4)}</g>}
        </g>
      ),
      Miso: (accent, active) => ( // crystal ball
        <g>
          <path d="M82 104l3-6h14l3 6z" fill="#8c6a55" />
          <circle cx="92" cy="89" r="10" fill={active ? '#e9dcff' : '#cfc4f5'} fillOpacity=".9" stroke={INK} strokeWidth="1" />
          {active && <path d="M87 91q5-6 10 0q-5 4-10 0z" fill={accent} opacity=".7" />}
          <circle cx="88" cy="85" r="2.6" fill="#fff" opacity=".8" />
        </g>
      ),
      Luna: (accent) => ( // star chart
        <g>
          <rect x="72" y="86" width="32" height="17" rx="2" fill="#f4e6c4" stroke={INK} strokeWidth="1" />
          <path d="M77 98l7-6 7 4 8-6" stroke={accent} strokeWidth="1" fill="none" />
          <g fill={HAT}><circle cx="77" cy="98" r="1.6" /><circle cx="84" cy="92" r="1.6" /><circle cx="91" cy="96" r="1.6" /><circle cx="99" cy="90" r="1.6" /></g>
        </g>
      ),
      Pudding: (accent, active) => ( // cauldron
        <g>
          <ellipse cx="90" cy="97" rx="13" ry="8" fill="#3d3550" />
          <ellipse cx="90" cy="91" rx="12" ry="3.4" fill="#7fd6a0" stroke="#2b2438" strokeWidth="2" />
          <g fill="#b6f0c9"><circle cx="86" cy="86" r="2.4" />{active && <><circle cx="93" cy="82" r="1.8" /><circle cx="89" cy="77" r="1.3" /></>}</g>
          <path d="M98 78l-6 12" stroke="#b98b67" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      ),
      Pixel: (accent) => ( // potion flasks
        <g stroke={INK} strokeWidth=".9">
          <rect x="81.5" y="85" width="5" height="6" fill="#fffaf0" />
          <circle cx="84" cy="97" r="6.5" fill="#9ad8c8" />
          <rect x="93" y="88" width="9" height="15" rx="2" fill="#f4a6c1" />
          <rect x="95.5" y="83" width="4" height="5.5" fill={accent} />
        </g>
      ),
      Nori: (accent, active) => ( // candle + scroll
        <g>
          <ellipse cx="92" cy="103" rx="8" ry="2" fill="#b98b67" />
          <rect x="88" y="88" width="8" height="15" rx="1.5" fill="#fff8e6" stroke={INK} strokeWidth=".8" />
          <path d="M92 76q5 6 0 11q-5-5 0-11z" fill={active ? '#ffb84d' : GOLD} />
          <rect x="16" y="90" width="18" height="13" rx="2" fill="#f4e6c4" stroke={INK} strokeWidth=".8" />
          <path d="M19 94h12M19 98h8" stroke={accent} strokeWidth="1" />
        </g>
      ),
    },
  },
  kitten: {
    hat: (line) => (
      <g stroke={line} strokeWidth="1" strokeLinejoin="round">
        <path d="M46 33L59 5q2-3 4 0L74 33z" fill={HAT} />
        <ellipse cx="60" cy="34" rx="20" ry="4.5" fill={HAT} />
        {star(61, 21, 4, GOLD, { stroke: 'none' })}
      </g>
    ),
    item: ( // wand
      <g>
        <path d="M84 110L99 88" stroke="#8c6a55" strokeWidth="2.6" strokeLinecap="round" />
        {star(100, 85, 6)}
      </g>
    ),
  },
};

// ---------- ป่าแฟรี่: mossy room, leaves, mushrooms, flower crowns, little wings, tree-stump desks ----------
const LEAVES = ['#8fd0a8', '#b6dd8f', '#6fbf95'];
const PETALS = ['#f4a6c1', '#d8ccff', '#ffd2a8'];
const wings = (cx, cy, rx, ry) => (
  <g fill="#eaf7ff" fillOpacity=".9" stroke="#9ec9e8" strokeWidth="1">
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(-28 ${cx} ${cy})`} />
    <ellipse cx={120 - cx} cy={cy} rx={rx} ry={ry} transform={`rotate(28 ${120 - cx} ${cy})`} />
    <ellipse cx={cx + 4} cy={cy + ry * 1.4} rx={rx * 0.6} ry={ry * 0.6} transform={`rotate(20 ${cx + 4} ${cy + ry * 1.4})`} />
    <ellipse cx={116 - cx} cy={cy + ry * 1.4} rx={rx * 0.6} ry={ry * 0.6} transform={`rotate(-20 ${116 - cx} ${cy + ry * 1.4})`} />
  </g>
);
const mushroom = (x, y, h, cap) => (
  <g>
    <rect x={x - 3} y={y - h} width="6" height={h} rx="2" fill="#fff4e0" />
    <path d={`M${x - 9} ${y - h + 1}q9-14 18 0z`} fill={cap} />
    <g fill="#fff"><circle cx={x - 3} cy={y - h - 3} r="1.4" /><circle cx={x + 3} cy={y - h - 5} r="1.1" /></g>
  </g>
);
const fairy = {
  pattern: (
    <>
      <path d="M6 16q0-10 10-10q0 10-10 10z" fill="var(--wall-dot)" />
      <g fill="var(--wall-dot)"><circle cx="33" cy="28" r="2" /><circle cx="37" cy="31" r="2" /><circle cx="29" cy="31" r="2" /><circle cx="35" cy="35" r="2" /><circle cx="31" cy="35" r="2" /></g>
    </>
  ),
  flag: (x, y, i) => (i % 2
    ? <g>{flower(x, y + 9, 5, PETALS[i % 3])}</g>
    : <path d={`M${x} ${y}q-12 12 0 26q12-14 0-26z`} fill={LEAVES[(i / 2) % 3]} />),
  sky: (
    <>
      <rect width="210" height="150" rx="12" fill="url(#sky)" />
      <circle cx="160" cy="36" r="15" fill="var(--sun)" />
      <path d="M0 110q50-30 105-5t105-15V138q0 12-12 12H12q-12 0-12-12z" fill="#8fd0a8" />
      <path d="M0 128q60-20 120 0t90-6V138q0 12-12 12H12q-12 0-12-12z" fill="#6fbf95" />
      <g fill="#4f9c78"><path d="M30 118l12-34 12 34z" /><path d="M150 112l10-28 10 28z" /><path d="M172 116l8-22 8 22z" /></g>
    </>
  ),
  shelfItem: (i, r) => {
    const x = 6 + i * 18;
    return (i + r) % 2
      ? mushroom(x + 7, 66, 12 + ((i + r) % 3) * 4, PETALS[(i + r) % 3] === '#ffd2a8' ? '#e5707f' : PETALS[(i + r) % 3])
      : (
        <g>
          <path d={`M${x + 1} 54h12l-2 12h-8z`} fill="var(--pot)" />
          <path d={`M${x + 7} 54v-12`} stroke="#6fbf95" strokeWidth="1.5" />
          {flower(x + 7, 40, 3.4, PETALS[(i + r) % 3])}
        </g>
      );
  },
  lamp: (x) => ( // bellflower lantern + fireflies
    <g>
      <path d={`M${x} 0V40`} stroke="#6fbf95" strokeWidth="2" />
      <path d={`M${x} 38q10-4 14 4`} stroke="#6fbf95" strokeWidth="2" fill="none" />
      <circle cx={x} cy="78" r="50" fill="url(#lampglow)" />
      <path d={`M${x - 16} 44q16-8 32 0q0 14-6 22l-5-4-5 5-5-5-5 4q-6-8-6-22z`} fill="var(--lamp)" />
      <circle cx={x} cy="68" r="5" fill="#fff3b8" />
      <g fill="#fff3b8"><circle cx={x - 40} cy="96" r="2.2" /><circle cx={x + 34} cy="110" r="1.8" /><circle cx={x + 52} cy="84" r="1.4" /></g>
    </g>
  ),
  plant: (x, y, s) => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {mushroom(-12, 0, 26, '#e5707f')}{mushroom(12, 0, 16, '#f4a6c1')}
      <path d="M-24 0q4-14 8 0M18 0q3-10 6 0" stroke="#6fbf95" strokeWidth="3" fill="none" />
    </g>
  ),
  floorLeft: ( // big toadstool stool + flowers
    <g transform="translate(18 470)">
      <rect x="22" y="10" width="28" height="112" rx="10" fill="#fff4e0" stroke="#e8d7b8" strokeWidth="2" />
      <path d="M-8 24q44-58 88 0q-44 10-88 0z" fill="#e5707f" />
      <g fill="#fff"><circle cx="20" cy="6" r="5" /><circle cx="44" cy="-6" r="6" /><circle cx="62" cy="10" r="4" /></g>
      <path d="M0 124q6-20 10 0M62 124q5-16 10 0" stroke="#6fbf95" strokeWidth="4" fill="none" />
      {flower(80, 104, 6, '#d8ccff')}
    </g>
  ),
  cat: {
    back: wings(28, 70, 15, 8),
    hat: () => ( // flower crown
      <g>
        <path d="M38 44q22-16 44 0" stroke="#6fbf95" strokeWidth="3" fill="none" />
        {flower(42, 41, 3.2, '#f4a6c1')}{flower(51, 35.5, 3.2, '#d8ccff')}{flower(60, 33.5, 3.4, '#ffd2a8')}
        {flower(69, 35.5, 3.2, '#f4a6c1')}{flower(78, 41, 3.2, '#d8ccff')}
      </g>
    ),
    desk: ( // tree stump: bark lines, rings on top, grass at the foot
      <g>
        <ellipse cx="60" cy="100" rx="34" ry="2.6" fill="none" stroke="var(--desk)" strokeWidth="1" opacity=".6" />
        <ellipse cx="60" cy="100" rx="18" ry="1.4" fill="none" stroke="var(--desk)" strokeWidth="1" opacity=".6" />
        <path d="M16 106v12M34 107v11M58 106v12M80 107v11M100 106v12" stroke="#00000026" strokeWidth="2" strokeLinecap="round" />
        <path d="M4 119l3-8 3 8 3-10 3 10M104 119l3-9 3 9 3-7 3 7" stroke="#6fbf95" strokeWidth="2" fill="none" strokeLinejoin="round" />
      </g>
    ),
    props: {
      Mochi: (accent, active) => ( // leaf notebook
        <g>
          <path d="M72 103q2-16 30-14q-2 16-30 14z" fill="#9fd6a8" stroke={INK} strokeWidth="1" />
          <path d="M74 102q12-6 26-12" stroke="#4f9c78" strokeWidth="1" fill="none" />
          {active && sparkle(100, 84, 3)}
        </g>
      ),
      Miso: (accent, active) => ( // dandelion + firefly
        <g>
          <path d="M92 104q-2-10 0-16" stroke="#6fbf95" strokeWidth="2" fill="none" />
          <circle cx="92" cy="85" r="8" fill="#fff" fillOpacity=".85" stroke="#cfd8e0" strokeDasharray="2 2" />
          <circle cx="92" cy="85" r="2" fill={GOLD} />
          {active && <circle cx="80" cy="82" r="2.4" fill="#fff3b8" stroke={GOLD} />}
        </g>
      ),
      Luna: (accent) => ( // mushrooms as a little bar chart
        <g>{mushroom(78, 104, 6, accent)}{mushroom(89, 104, 10, '#f4a6c1')}{mushroom(100, 104, 14, '#e5707f')}</g>
      ),
      Pudding: (accent) => ( // flower pot
        <g>
          <path d="M80 104l-2-10h20l-2 10z" fill="var(--pot)" />
          <path d="M84 94v-8M92 94v-11" stroke="#6fbf95" strokeWidth="1.6" />
          {flower(84, 84, 3, '#f4a6c1')}{flower(92, 80, 3, accent)}
        </g>
      ),
      Pixel: () => ( // ladybug on a leaf
        <g>
          <ellipse cx="88" cy="100" rx="13" ry="4.5" fill="#8fd0a8" stroke={INK} strokeWidth=".8" />
          <circle cx="90" cy="95" r="5" fill="#e5707f" stroke={INK} strokeWidth=".8" />
          <path d="M90 90v10" stroke={INK} strokeWidth=".8" />
          <g fill={INK}><circle cx="87.5" cy="94" r="1" /><circle cx="92.5" cy="96" r="1" /><circle cx="90" cy="89.6" r="1.8" /></g>
        </g>
      ),
      Nori: (accent) => ( // acorn cup + leaf note
        <g>
          <path d="M84 92h14v5a7 7 0 0 1-14 0z" fill="#c99a62" stroke={INK} strokeWidth=".8" />
          <ellipse cx="91" cy="92" rx="8" ry="2.4" fill="#8c6a55" />
          <path d="M16 102q2-14 18-12q-2 14-18 12z" fill="#b6dd8f" stroke={INK} strokeWidth=".8" />
          <path d="M19 99l11-6" stroke={accent} strokeWidth="1" />
        </g>
      ),
    },
  },
  kitten: {
    back: wings(36, 86, 11, 6),
    hat: () => <g>{flower(76, 34, 3.4, '#f4a6c1')}{flower(68, 30, 2.6, '#d8ccff')}</g>,
  },
};

// ---------- คาเฟ่: cream walls, string lights, cups on the shelf, aprons, chalk menu board ----------
const APRON = '#a8745a';
const cafe = {
  pattern: (
    <>
      <ellipse cx="11" cy="11" rx="3.4" ry="4.6" fill="var(--wall-dot)" transform="rotate(30 11 11)" />
      <path d="M33 34l-4-4a2.3 2.3 0 0 1 4-2.6a2.3 2.3 0 0 1 4 2.6z" fill="var(--wall-dot)" />
    </>
  ),
  flag: (x, y) => (
    <g>
      <rect x={x - 3} y={y} width="6" height="6" rx="1" fill="#6b4a3a" />
      <circle cx={x} cy={y + 18} r="14" fill="url(#lampglow)" />
      <ellipse cx={x} cy={y + 13} rx="5" ry="7" fill="#ffe6a3" />
    </g>
  ),
  windowExtra: ( // striped awning over the window
    <g>
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d={`M${-20 + i * 31.25} -18h31.25v22q-15.6 10-31.25 0z`} fill={i % 2 ? '#fffaf0' : 'var(--curtain)'} />
      ))}
    </g>
  ),
  shelfItem: (i, r) => {
    const x = 6 + i * 18;
    return (i + r) % 2 ? (
      <g>
        <path d={`M${x + 14} 56q5 0 5 4t-5 4`} fill="none" stroke="#fffaf0" strokeWidth="2" />
        <rect x={x} y="52" width="14" height="14" rx="3" fill={CANDY[i]} />
      </g>
    ) : (
      <g>
        <rect x={x} y="32" width="14" height="34" rx="3" fill="#ffffff8c" stroke="#fffaf0" />
        <rect x={x + 1} y={44 + ((i + r) % 3) * 4} width="12" height={21 - ((i + r) % 3) * 4} rx="2" fill="#7a4e38" />
        <rect x={x + 2} y="28" width="10" height="5" rx="1.5" fill="var(--wood-dark)" />
      </g>
    );
  },
  lamp: (x) => ( // dome pendant
    <g>
      <path d={`M${x} 0V44`} stroke="var(--string)" strokeWidth="2" />
      <circle cx={x} cy="88" r="58" fill="url(#lampglow)" />
      <path d={`M${x - 24} 66q24-36 48 0z`} fill="#6b4a3a" />
      <circle cx={x} cy="67" r="6" fill="#fff3b8" />
    </g>
  ),
  floorLeft: ( // little café table + chair
    <g transform="translate(18 470)">
      <path d="M8 40v84M8 70h30v54" stroke="#6b4a3a" strokeWidth="5" fill="none" strokeLinecap="round" />
      <rect x="-2" y="64" width="44" height="8" rx="4" fill="var(--wood)" />
      <path d="M70 34v86M54 122h32" stroke="#6b4a3a" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="70" cy="32" rx="34" ry="8" fill="var(--wood)" />
      <path d="M62 26v-10h14v10z" fill="#fffaf0" stroke={INK} strokeWidth="1" />
      {steam(66, 12)}
    </g>
  ),
  cat: {
    body: () => ( // apron
      <g>
        <path d="M46 78h28l3 20H43z" fill={APRON} stroke={INK} strokeWidth="1" />
        <rect x="54" y="86" width="12" height="7" rx="1.5" fill="#00000022" />
      </g>
    ),
    desk: ( // counter: marble top, panelled front
      <g fill="none" stroke="#ffffff59" strokeWidth="1.4">
        <rect x="10" y="107" width="30" height="9" rx="2" /><rect x="45" y="107" width="30" height="9" rx="2" /><rect x="80" y="107" width="30" height="9" rx="2" />
      </g>
    ),
    props: {
      Mochi: (accent, active) => ( // order pad + pencil
        <g>
          <rect x="76" y="86" width="20" height="17" rx="1.5" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <path d="M79 91h14M79 95h10M79 99h12" stroke={active ? accent : '#c9b8a8'} strokeWidth="1" />
          <path d="M100 84l-6 18" stroke="#e8b04f" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      ),
      Miso: () => ( // bean jar
        <g>
          <rect x="80" y="84" width="18" height="20" rx="3" fill="#ffffffaa" stroke={INK} strokeWidth="1" />
          <rect x="82" y="81" width="14" height="4" rx="1.5" fill="#8c6a55" />
          <g fill="#7a4e38">
            <ellipse cx="85" cy="99" rx="2" ry="2.8" /><ellipse cx="90" cy="100" rx="2" ry="2.8" /><ellipse cx="94" cy="98" rx="2" ry="2.8" />
            <ellipse cx="87" cy="94" rx="2" ry="2.8" /><ellipse cx="92" cy="93" rx="2" ry="2.8" />
          </g>
        </g>
      ),
      Luna: () => ( // cake slice
        <g>
          <ellipse cx="88" cy="103" rx="15" ry="2.6" fill="#fffaf0" stroke={INK} strokeWidth=".8" />
          <path d="M75 102h26v-8l-26-4z" fill="#fde3cf" stroke={INK} strokeWidth=".8" />
          <path d="M75 90l26 4" stroke="#f4a6c1" strokeWidth="3" strokeLinecap="round" />
          <circle cx="90" cy="89" r="3" fill="#e5707f" />
        </g>
      ),
      Pudding: (accent, active) => ( // latte with heart art
        <g>
          <ellipse cx="88" cy="103" rx="13" ry="2.6" fill="#fffaf0" stroke={INK} strokeWidth=".8" />
          <path d="M78 92h20v4a10 7 0 0 1-20 0z" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <ellipse cx="88" cy="92" rx="10" ry="2.4" fill="#c99a62" />
          <path d="M88 93.4l-2-1.6a1 1 0 0 1 2-1a1 1 0 0 1 2 1z" fill="#fff" />
          {active && steam(85, 86)}
        </g>
      ),
      Pixel: (accent, active) => ( // espresso machine
        <g>
          <rect x="76" y="80" width="26" height="24" rx="3" fill="#a9b8c2" stroke={INK} strokeWidth="1" />
          <rect x="79" y="83" width="8" height="5" rx="1" fill={accent} />
          <rect x="85" y="89" width="10" height="3" rx="1" fill={INK} />
          <rect x="86.5" y="96" width="7" height="7" rx="1.2" fill="#fffaf0" />
          {active && <path d="M90 92v3" stroke="#7a4e38" strokeWidth="1.4" />}
        </g>
      ),
      Nori: () => ( // coffee mug + croissant
        <g>
          <rect x="84" y="88" width="14" height="15" rx="3" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <path d="M98 92q5 0 5 4t-5 4" fill="none" stroke={INK} strokeWidth="1.4" />
          <rect x="85.5" y="89.5" width="11" height="3" rx="1" fill="#7a4e38" />
          <path d="M14 102q10-16 20 0q-10-5-20 0z" fill="#e8b46a" stroke={INK} strokeWidth=".8" />
          <path d="M20 97l2 3M26 95v4M31 97l-2 3" stroke="#b98b67" strokeWidth="1" />
        </g>
      ),
    },
  },
  kitten: {
    body: (
      <g>
        <path d="M51 86h18l2 14H49z" fill={APRON} stroke={INK} strokeWidth=".8" />
      </g>
    ),
    item: <g>{steam(92, 98)}<path d="M88 100h10v6a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z" fill="#fffaf0" stroke={INK} strokeWidth=".8" /></g>,
  },
};

// ---------- ครัว: tiled walls, copper pendants, jars, chef hats, cabinet counters, stove ----------
const kitchen = {
  pattern: (
    <>
      <path d="M0 0H44V44" fill="none" stroke="var(--wall-dot)" strokeWidth="2.4" />
      <circle cx="22" cy="22" r="2" fill="var(--wall-dot)" />
    </>
  ),
  flag: (x, y, i) => (i % 2
    ? <path d={`M${x} ${y}q-6 10 -2 22q4-6 6-20z`} fill="#e5707f" stroke="#6fbf95" strokeWidth="1.5" /> // chili
    : <g><path d={`M${x} ${y}v4`} stroke="var(--string)" strokeWidth="1.5" /><path d={`M${x} ${y + 4}q-11 8-6 16h12q5-8-6-16z`} fill="#fffaf0" stroke="#e6d6c8" /></g>), // garlic
  windowExtra: ( // herb pots on the sill
    <g transform="translate(0 150)">
      {[40, 105, 170].map((x, i) => (
        <g key={x}>
          <path d={`M${x - 10} -8q-6-16 2-24M${x} -8v-26M${x + 10} -8q6-16-2-24`} stroke="var(--leaf)" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d={`M${x - 13} -10h26l-3 12h-20z`} fill={['var(--pot)', '#a8c8f0', '#f6dfa8'][i]} />
        </g>
      ))}
    </g>
  ),
  shelfItem: (i, r) => {
    const x = 6 + i * 18;
    const h = 22 + ((i + r) % 3) * 6;
    return (
      <g>
        <rect x={x} y={66 - h} width="14" height={h} rx="3" fill="#ffffff99" stroke="#fffaf0" />
        <rect x={x + 1} y={66 - h * 0.6} width="12" height={h * 0.6 - 1} rx="2" fill={CANDY[(i + r) % CANDY.length]} />
        <rect x={x - 1} y={62 - h} width="16" height="5" rx="2" fill={['#e5707f', '#6fbf95', '#e8b04f'][(i + r) % 3]} />
      </g>
    );
  },
  lamp: (x) => ( // copper pendant
    <g>
      <path d={`M${x} 0V44`} stroke="var(--string)" strokeWidth="2" />
      <circle cx={x} cy="88" r="58" fill="url(#lampglow)" />
      <path d={`M${x - 20} 66L${x - 8} 44h16L${x + 20} 66z`} fill="#d9915f" />
      <circle cx={x} cy="67" r="5.5" fill="#fff3b8" />
    </g>
  ),
  floorLeft: ( // stove with a pot
    <g transform="translate(18 470)">
      <rect x="-4" y="20" width="96" height="104" rx="6" fill="#dfe6eb" stroke="#a9b8c2" strokeWidth="2" />
      <rect x="8" y="50" width="72" height="50" rx="5" fill="#4a5560" />
      <rect x="16" y="58" width="56" height="10" rx="3" fill="#ffb84d" opacity=".5" />
      <path d="M20 38h48" stroke="#a9b8c2" strokeWidth="4" strokeLinecap="round" />
      <g fill="#4a5560"><circle cx="14" cy="30" r="3" /><circle cx="26" cy="30" r="3" /><circle cx="62" cy="30" r="3" /><circle cx="74" cy="30" r="3" /></g>
      <rect x="18" y="-10" width="48" height="30" rx="5" fill="#a9b8c2" stroke="#7d8d99" strokeWidth="2" />
      <rect x="14" y="-14" width="56" height="7" rx="3" fill="#7d8d99" />
      <path d="M32 -20q-6-8 0-14q6-8 0-14M50 -20q-6-8 0-14q6-8 0-14" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  cat: {
    body: () => ( // white apron + red neckerchief
      <g>
        <path d="M46 78h28l3 20H43z" fill="#fffaf0" stroke={INK} strokeWidth="1" />
        <path d="M50 78l10 9 10-9z" fill="#e5707f" stroke={INK} strokeWidth=".8" />
      </g>
    ),
    hat: () => ( // toque
      <g fill="#fff" stroke={INK} strokeWidth="1" strokeLinejoin="round">
        <path d="M45 28q-9-1-8-9q1-8 11-7q2-8 12-8q10 0 12 8q10-1 11 7q1 8-8 9z" />
        <rect x="45" y="27" width="30" height="9" rx="2" />
        <path d="M54 27v-6M66 27v-6" stroke="#e6d6c8" />
      </g>
    ),
    desk: ( // cabinet doors with knobs
      <g>
        <g fill="none" stroke="#ffffff66" strokeWidth="1.4"><rect x="10" y="107" width="48" height="9" rx="2" /><rect x="62" y="107" width="48" height="9" rx="2" /></g>
        <g fill="#ffffffaa"><circle cx="54" cy="111.5" r="1.4" /><circle cx="66" cy="111.5" r="1.4" /></g>
      </g>
    ),
    props: {
      Mochi: (accent, active) => ( // cutting board + carrot
        <g>
          <rect x="72" y="97" width="32" height="7" rx="3" fill="#d9ab84" stroke={INK} strokeWidth=".8" />
          <path d="M76 96l15-6 2 4z" fill="#f0a060" />
          <path d="M91 90l4-4M92 91l5-1" stroke="#6fbf95" strokeWidth="1.4" />
          <g fill="#f0a060">{active && <><circle cx="97" cy="99.5" r="2" /><circle cx="101" cy="99.5" r="2" /></>}</g>
        </g>
      ),
      Miso: () => ( // spice jars
        <g stroke={INK} strokeWidth=".8">
          {[[78, '#e5707f'], [88, '#e8b04f'], [98, '#6fbf95']].map(([x, c], i) => (
            <g key={x}>
              <rect x={x - 4} y={92 - i * 2} width="8" height={12 + i * 2} rx="1.5" fill="#fffaf0" />
              <rect x={x - 4.5} y={89 - i * 2} width="9" height="3.5" rx="1" fill={c} />
            </g>
          ))}
        </g>
      ),
      Luna: (accent) => ( // measuring cups as a bar chart
        <g stroke={INK} strokeWidth=".8">
          <rect x="74" y="97" width="8" height="7" rx="1" fill={accent} />
          <rect x="85" y="92" width="8" height="12" rx="1" fill={accent} />
          <rect x="96" y="87" width="8" height="17" rx="1" fill={accent} />
          <path d="M76 100h4M87 96h4M98 91h4M87 99h4M98 95h4M98 99h4" stroke="#fff" />
        </g>
      ),
      Pudding: (accent, active) => ( // mixing bowl + whisk
        <g>
          <path d={active ? 'M94 92l8-12' : 'M95 92l4-14'} stroke="#a9b8c2" strokeWidth="2" strokeLinecap="round" />
          <path d="M76 92h26a13 10 0 0 1-26 0z" fill="#f4a6c1" stroke={INK} strokeWidth="1" />
          <ellipse cx="89" cy="92" rx="13" ry="2.4" fill="#fffaf0" stroke={INK} strokeWidth=".8" />
        </g>
      ),
      Pixel: () => ( // frying pan + egg
        <g>
          <path d="M97 98l11-5" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <ellipse cx="86" cy="100" rx="13" ry="4.5" fill="#4a5560" />
          <ellipse cx="86" cy="99" rx="7" ry="2.6" fill="#fff" />
          <circle cx="87" cy="98.6" r="1.8" fill={GOLD} />
        </g>
      ),
      Nori: (accent, active) => ( // stock pot + recipe card
        <g>
          <rect x="82" y="90" width="20" height="13" rx="2" fill="#a9b8c2" stroke={INK} strokeWidth="1" />
          <rect x="80" y="87" width="24" height="4" rx="1.5" fill="#7d8d99" />
          <path d="M80 94h-3M104 94h3" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          {active && steam(88, 85)}
          <rect x="16" y="88" width="18" height="15" rx="2" fill="#fffaf0" stroke={INK} strokeWidth="1" />
          <rect x="16" y="88" width="18" height="4" rx="1.5" fill="#e5707f" />
          <path d="M19 96h12M19 99.5h9" stroke={accent} strokeWidth="1" />
        </g>
      ),
    },
  },
  kitten: {
    hat: (line) => (
      <g fill="#fff" stroke={line} strokeWidth=".9" strokeLinejoin="round">
        <path d="M48 28q-7-1-6-8q1-6 9-5q2-7 9-7q7 0 9 7q8-1 9 5q1 7-6 8z" />
        <rect x="48" y="27" width="24" height="7" rx="2" />
      </g>
    ),
    item: ( // wooden spoon
      <g>
        <path d="M86 110L98 90" stroke="#b98b67" strokeWidth="2.6" strokeLinecap="round" />
        <ellipse cx="100" cy="86" rx="3.6" ry="5.4" fill="#d9ab84" transform="rotate(30 100 86)" />
      </g>
    ),
  },
};

export const DECOR = { office, magic, fairy, cafe, kitchen };

// Room slots for a scene, office drawings filling any gaps.
export const roomDecor = (scene) => ({ ...office, cat: {}, kitten: {}, ...DECOR[scene] });
