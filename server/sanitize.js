// Turns raw hook payloads into small, display-safe values.
// Nothing here ever returns prompt text, tool output, or environment values.

import path from 'node:path';

const MAX_TEXT = 200;

const SECRET_PATTERNS = [
  // key=value / key: value where the key looks sensitive
  /\b([A-Za-z0-9_.-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|apikey|auth|credential|private[_-]?key|session[_-]?id|cookie)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
  // Authorization headers
  /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // user:pass@host in URLs
  /(\/\/)[^\s/:@]+:[^\s/@]+@/g,
  // well-known key prefixes
  /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AKIA|AIza)[-_A-Za-z0-9]{12,}/g,
  // long opaque tokens (hex/base64-ish)
  /\b[A-Za-z0-9+/_-]{32,}={0,2}/g,
];

export function redact(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  // Bearer/Basic first, otherwise "Authorization: Bearer x" redacts only the word "Bearer".
  out = out.replace(SECRET_PATTERNS[1], (_, scheme) => `${scheme} [redacted]`);
  out = out.replace(SECRET_PATTERNS[0], (_, k, sep, v) => (v === '[redacted]' ? _ : `${k}${sep}[redacted]`));
  out = out.replace(SECRET_PATTERNS[2], '$1[redacted]@');
  out = out.replace(SECRET_PATTERNS[3], '[redacted]');
  out = out.replace(SECRET_PATTERNS[4], '[redacted]');
  return out;
}

// Strip ANSI escapes / control chars, collapse whitespace, cap length, redact.
export function clean(text, max = MAX_TEXT) {
  if (typeof text !== 'string') return '';
  let s = text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = redact(s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function str(v, max = 120) {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function base(p) {
  return typeof p === 'string' && p ? path.basename(p).slice(0, 80) : undefined;
}

function host(u) {
  try { return new URL(u).hostname; } catch { return undefined; }
}

// First real program name in a shell command, skipping VAR=value prefixes and sudo/env wrappers.
function commandName(cmd) {
  if (typeof cmd !== 'string') return undefined;
  const words = cmd.trim().split(/\s+/);
  for (const w of words) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (w === 'sudo' || w === 'env' || w === 'time' || w === 'rtk') continue;
    return path.basename(w).replace(/[^\w.+-]/g, '').slice(0, 40) || undefined;
  }
  return undefined;
}

// A short, non-sensitive description of what a tool call is touching.
export function summarizeTool(toolName, input) {
  const i = input && typeof input === 'object' ? input : {};
  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return base(i.file_path);
    case 'NotebookEdit':
      return base(i.notebook_path);
    case 'Bash': {
      const name = commandName(i.command);
      const desc = i.description ? clean(i.description, 80) : '';
      return [name, desc].filter(Boolean).join(' — ') || undefined;
    }
    case 'Grep':
    case 'Glob':
      return i.pattern ? clean(String(i.pattern), 40) : undefined;
    case 'WebFetch':
      return host(i.url);
    case 'WebSearch':
      return i.query ? clean(String(i.query), 60) : undefined;
    case 'Agent':
    case 'Task':
      return [str(i.subagent_type, 40), i.description ? clean(i.description, 60) : '']
        .filter(Boolean).join(' — ') || undefined;
    default:
      return undefined;
  }
}

// Which office role a tool belongs to. Purely presentational.
export function toolCategory(toolName = '') {
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(toolName)) return 'code';
  if (/^(WebSearch|WebFetch)$/.test(toolName)) return 'research';
  if (/^(Read|Grep|Glob|LS)$/.test(toolName)) return 'data';
  if (/^(Bash|BashOutput|KillShell)$/.test(toolName)) return 'qa';
  if (/^(Agent|Task)$/.test(toolName)) return 'creative';
  if (toolName.startsWith('mcp__')) return 'research';
  return 'manage';
}

export function displayToolName(toolName) {
  if (typeof toolName !== 'string') return 'unknown';
  const m = toolName.match(/^mcp__(.+?)__(.+)$/);
  return (m ? `${m[1]}/${m[2]}` : toolName).slice(0, 60);
}
