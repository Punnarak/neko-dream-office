// The cozy office room. Everything drawn here is decoration; real status only
// appears in the speech-bubble chips rendered by <App> on top of each cat.
// The layout is shared by every scene ("ธีมห้อง"); the scene only swaps the slot drawings (SceneDecor.jsx).
import { roomDecor } from './SceneDecor.jsx';
import { sceneOf } from '../scenes.js';
import { SkyTint, ClockHands } from './Lively.jsx';

export const STATIONS = {
  research: { left: 8,  top: 30 },
  code:     { left: 41, top: 27 },
  data:     { left: 65, top: 30 },
  qa:       { left: 12, top: 60 },
  manage:   { left: 42, top: 60, big: true },
  creative: { left: 71, top: 60 },
};

// Layers, back to front: wall (svg) -> wall lighting -> tilted floor + rug -> floor props (svg).
// Cats, kittens and the corkboard are siblings above these, so they stay upright and clickable.
// `phase` (lively.js dayPhase), `clock` (clockAngles) and `bell` come from the real local clock and
// calendar; without them (lively off) the room is the classic still picture.
export function OfficeBackdrop({ scene, phase = 'day', clock = null, bell = false }) {
  const d = roomDecor(scene);
  const [title, motto] = sceneOf(scene).sign;
  return (
    <>
    <svg className="backdrop" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="wallpaper" width="44" height="44" patternUnits="userSpaceOnUse">{d.pattern}</pattern>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sky1)" /><stop offset="1" stopColor="var(--sky2)" />
        </linearGradient>
        <radialGradient id="lampglow">
          <stop offset="0" stopColor="#fff3b8" stopOpacity=".55" /><stop offset="1" stopColor="#fff3b8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="duskSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6d5aa8" /><stop offset=".55" stopColor="#f39a9a" /><stop offset="1" stopColor="#ffc78a" />
        </linearGradient>
      </defs>

      {/* back wall (the floor is a tilted CSS plane, see .floor in styles.css) */}
      <rect width="1000" height="380" fill="var(--wall)" />
      <rect width="1000" height="380" fill="url(#wallpaper)" />
      <rect y="372" width="1000" height="14" fill="var(--baseboard)" />
      <rect y="383" width="1000" height="3" fill="#4a3b52" opacity=".08" />
      <rect y="386" width="1000" height="234" fill="var(--floor)" />

      {/* bunting */}
      <path d="M20 26Q500 92 980 26" fill="none" stroke="var(--string)" strokeWidth="2" />
      {Array.from({ length: 13 }, (_, i) => {
        const x = 60 + i * 72;
        const y = 26 + 66 * (1 - ((x - 500) / 480) ** 2) * 0.62;
        return <g key={i}>{d.flag(x, y, i)}</g>;
      })}

      {/* window */}
      <g transform="translate(395 80)">
        <rect x="-8" y="-8" width="226" height="166" rx="18" fill="var(--frame)" />
        {d.sky}
        <SkyTint phase={phase} />
        <path d="M105 0V150M0 75H210" stroke="var(--frame)" strokeWidth="7" />
        <path d="M-14 -10Q20 70 -6 160L-24 160L-24 -10z" fill="var(--curtain)" />
        <path d="M224 -10Q190 70 216 160L234 160L234 -10z" fill="var(--curtain)" />
        <rect x="-26" y="-16" width="262" height="10" rx="5" fill="var(--wood)" />
        {d.windowExtra}
      </g>

      {/* bookshelf (right) */}
      <g transform="translate(835 70)">
        <path d="M0 4L-14 14V278L0 270z" fill="var(--wood-dark)" />
        <rect width="140" height="270" rx="8" fill="var(--wood)" />
        {[0, 1, 2].map((r) => (
          <g key={r} transform={`translate(10 ${14 + r * 86})`}>
            <rect y="66" width="120" height="8" rx="2" fill="var(--wood-dark)" />
            {Array.from({ length: 6 }, (_, i) => <g key={i}>{d.shelfItem(i, r)}</g>)}
          </g>
        ))}
      </g>

      {/* wall clock (real local time when lively is on) + framed fish */}
      <g transform="translate(300 120)"><g className={bell ? 'clock-ring' : ''}>
        <circle r="34" fill="#fffaf0" stroke="var(--wood)" strokeWidth="7" />
        {[0, 90, 180, 270].map((a) => <path key={a} d="M0 -27V-23" transform={`rotate(${a})`} stroke="#c9b9a8" strokeWidth="2" strokeLinecap="round" />)}
        {clock ? <ClockHands angles={clock} bell={bell} /> : <path d="M0 0V-20M0 0L13 8" stroke="#4a3b52" strokeWidth="3" strokeLinecap="round" />}
        <circle r="3" fill="#4a3b52" />
        <path d="M-26 -30l-10-14 16 6zM26 -30l10-14-16 6z" fill="var(--wood)" />
      </g></g>
      <g transform="translate(660 92)">
        <rect width="120" height="84" rx="8" fill="var(--wood)" />
        <rect x="8" y="8" width="104" height="68" rx="4" fill="#e8f6ff" />
        <path d="M35 42q25-22 50 0q-25 22-50 0zM85 42l14-12v24z" fill="#f8b38f" />
        <circle cx="48" cy="38" r="3" fill="#4a3b52" />
      </g>

      {/* framed text sign */}
      <g transform="translate(40 90)">
        <rect width="150" height="64" rx="12" fill="#fffaf0" stroke="var(--wood)" strokeWidth="6" />
        <text x="75" y="29" textAnchor="middle" fontSize={title.length > 10 ? 15 : 17} fontWeight="700" fill="#c77f9c">{title}</text>
        <text x="75" y="49" textAnchor="middle" fontSize="13" fill="#8a7d93">{motto}</text>
      </g>

      {/* hanging lamps */}
      {[250, 500, 750].map((x) => <g key={x}>{d.lamp(x)}</g>)}

      {/* plants */}
      {d.plant(18, 380, 1.2)}
      {d.plant(950, 380, 1)}
      {d.plant(330, 378, 0.75)}
    </svg>
    <div className="wall-light" aria-hidden="true" />
    <div className="floor" aria-hidden="true"><div className="rug" /></div>
    <svg className="backdrop props" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="floorshadow">
          <stop offset="0" stopColor="#4a3b52" stopOpacity=".28" /><stop offset="1" stopColor="#4a3b52" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="54" cy="600" rx="62" ry="12" fill="url(#floorshadow)" />
      <ellipse cx="905" cy="582" rx="46" ry="10" fill="url(#floorshadow)" />
      {/* cat tree (or the scene's floor piece) + fish snack bowl */}
      {d.floorLeft}
      <g transform="translate(905 575)">
        <ellipse rx="34" ry="12" fill="#a8c8f0" />
        <path d="M-14 -8q8-10 18 0q-8 8-18 0zM4 -8l8-6v12z" fill="#f8b38f" />
      </g>
    </svg>
    </>
  );
}
