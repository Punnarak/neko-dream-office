// Adds / removes Neko Dream Office HTTP hooks in ~/.claude/settings.json.
// - Always writes a timestamped backup before changing anything.
// - Only touches hook entries whose URL is our /hook endpoint; everything else is left as-is.
//
// usage: node scripts/install-hooks.js install|uninstall|status [--settings <path>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.NEKO_PORT || 4777);
const HOOK_URL = `http://127.0.0.1:${PORT}/hook`;
const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStart', 'SubagentStop', 'Notification', 'Stop', 'StopFailure', 'SessionEnd',
];

const args = process.argv.slice(2);
const cmd = args[0] || 'status';
const i = args.indexOf('--settings');
const SETTINGS = i >= 0 ? path.resolve(args[i + 1]) : path.join(os.homedir(), '.claude', 'settings.json');

const MARKER = '# neko-dream-office';
// Claude Code does not run HTTP hooks for SessionStart, so that one event posts via curl instead.
// async + output discarded: it never delays startup or adds text to Claude's context.
const SESSION_START_CMD =
  `curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' --data-binary @- ${HOOK_URL} || true ${MARKER}`;

const isOurs = (h) =>
  (h?.type === 'http' && typeof h.url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/hook$/.test(h.url)) ||
  (h?.type === 'command' && typeof h.command === 'string' && h.command.endsWith(MARKER));

function load() {
  if (!fs.existsSync(SETTINGS)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
}

function backup() {
  if (!fs.existsSync(SETTINGS)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${SETTINGS}.bak-neko-${stamp}`;
  fs.copyFileSync(SETTINGS, dest);
  fs.chmodSync(dest, 0o600);
  return dest;
}

function save(obj) {
  const tmp = `${SETTINGS}.neko-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS);
}

// Remove our hook entries; drop matcher groups that become empty because of it.
function strip(settings) {
  const hooks = settings.hooks || {};
  let removed = 0;
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    hooks[ev] = hooks[ev]
      .map((g) => {
        if (!Array.isArray(g?.hooks)) return g;
        const kept = g.hooks.filter((h) => !isOurs(h));
        removed += g.hooks.length - kept.length;
        return kept.length === g.hooks.length ? g : kept.length ? { ...g, hooks: kept } : null;
      })
      .filter(Boolean);
    if (hooks[ev].length === 0) delete hooks[ev];
  }
  return removed;
}

function status(settings) {
  const found = [];
  for (const [ev, groups] of Object.entries(settings.hooks || {})) {
    for (const g of groups || []) for (const h of g?.hooks || []) if (isOurs(h)) found.push(`${ev} -> ${h.type} ${h.url ?? HOOK_URL}`);
  }
  return found;
}

const settings = load();

if (cmd === 'status') {
  const found = status(settings);
  console.log(`settings: ${SETTINGS}`);
  console.log(found.length ? `installed (${found.length}):\n  ${found.join('\n  ')}` : 'not installed');
} else if (cmd === 'install') {
  const bak = backup();
  strip(settings); // idempotent: replace any previous install
  settings.hooks ||= {};
  for (const ev of EVENTS) {
    settings.hooks[ev] ||= [];
    const hook = ev === 'SessionStart'
      ? { type: 'command', command: SESSION_START_CMD, async: true, timeout: 5 }
      : { type: 'http', url: HOOK_URL, timeout: 2 };
    settings.hooks[ev].push({ hooks: [hook] });
  }
  save(settings);
  console.log(`backup:   ${bak ?? '(no existing file)'}`);
  console.log(`updated:  ${SETTINGS}`);
  console.log(`added HTTP hooks -> ${HOOK_URL} for: ${EVENTS.join(', ')}`);
  console.log('Existing hooks were not modified. New Claude Code sessions pick this up; restart running ones.');
} else if (cmd === 'uninstall') {
  const n = status(settings).length;
  if (!n) { console.log('nothing to remove'); process.exit(0); }
  const bak = backup();
  strip(settings);
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  save(settings);
  console.log(`backup:  ${bak}`);
  console.log(`removed ${n} Neko hook entries from ${SETTINGS}`);
} else {
  console.error('usage: install-hooks.js install|uninstall|status [--settings <path>]');
  process.exit(2);
}
