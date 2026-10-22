// Tiny notification sounds made with the Web Audio API (no audio files).
// The AudioContext is created on the first user click, because browsers block audio before that.

let ctx = null;

export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
  return !!ctx;
}

// One soft note: frequency glide from f1 to f2, short attack/release so it never clicks.
function note({ at, f1, f2 = f1, dur, type = 'sine', gain = 0.14 }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f1, at);
  if (f2 !== f1) osc.frequency.exponentialRampToValueAtTime(f2, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

const SOUNDS = {
  // "เมี้ยว?" — two rising notes; Claude is waiting for you
  waiting: (t) => {
    note({ at: t, f1: 620, f2: 700, dur: 0.14, type: 'triangle', gain: 0.16 });
    note({ at: t + 0.16, f1: 820, f2: 1040, dur: 0.24, type: 'triangle', gain: 0.16 });
  },
  // short soft fall
  error: (t) => {
    note({ at: t, f1: 440, f2: 300, dur: 0.18, type: 'triangle', gain: 0.13 });
    note({ at: t + 0.2, f1: 330, f2: 220, dur: 0.26, type: 'triangle', gain: 0.13 });
  },
  // soft "prrr" when a cat is petted: a quick low flutter
  purr: (t) => {
    for (let i = 0; i < 7; i++) note({ at: t + i * 0.07, f1: 92 + (i % 2) * 8, dur: 0.06, type: 'triangle', gain: 0.05 });
  },
  // one clear bell
  completed: (t) => {
    note({ at: t, f1: 1319, dur: 0.45, gain: 0.12 });
    note({ at: t, f1: 2637, dur: 0.25, gain: 0.03 });
  },
};

export function playSound(kind) {
  if (!ctx || ctx.state !== 'running' || !SOUNDS[kind]) return false;
  SOUNDS[kind](ctx.currentTime + 0.01);
  return true;
}
