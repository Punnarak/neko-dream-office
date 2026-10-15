// Neko Dream Office backend.
// Claude Code HTTP hooks  ->  POST /hook  ->  OfficeState  ->  WebSocket /ws  ->  browser
// Listens on 127.0.0.1 only. Never executes anything it receives.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { OfficeState } from './state.js';
import { RedmineFeed } from './redmine.js';
import { UsageTracker, subagentTranscript } from './usage.js';
import { DailyTokens } from './tokens.js';
import { HolidayFile } from './holidays.js';

const HOST = process.env.NEKO_HOST || '127.0.0.1';
const PORT = Number(process.env.NEKO_PORT || 4777);
const DEBUG = process.env.NEKO_DEBUG === '1';
const MAX_BODY = 1024 * 1024;
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');

if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  console.warn(`[neko] WARNING: binding to ${HOST} exposes the monitor beyond this machine.`);
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`,
  'http://127.0.0.1:5173', 'http://localhost:5173', // vite dev server
]);

const state = new OfficeState();
// Token usage comes from the agents' transcript files, re-read (throttled) when a hook event arrives.
const usage = new UsageTracker({
  minIntervalMs: Number(process.env.NEKO_USAGE_INTERVAL || 3) * 1000,
  onUpdate: (sessionId, agentKey, totals) => {
    const session = state.setUsage(sessionId, agentKey, totals);
    if (session) broadcast({ type: 'session', session });
  },
});

// Which transcript belongs to the agent behind this event. Paths are checked by UsageTracker.
function trackUsage(payload) {
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id.slice(0, 80) : null;
  if (!sessionId || !state.sessions.has(sessionId)) return;
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id.slice(0, 80) : null;
  if (!agentId) {
    usage.track(sessionId, 'main', payload.transcript_path);
  } else {
    // SubagentStop names the file; other subagent events only carry the main transcript.
    usage.track(sessionId, agentId, payload.agent_transcript_path || subagentTranscript(payload.transcript_path, agentId));
    usage.track(sessionId, 'main', payload.transcript_path); // the main agent is waiting on it, but may have grown
  }
  usage.retain((id) => state.sessions.has(id));
}
const redmine = new RedmineFeed({
  intervalMs: Number(process.env.NEKO_REDMINE_INTERVAL || 300) * 1000,
  onUpdate: (data) => broadcast({ type: 'redmine', redmine: data }),
});

// Daily token totals across all transcripts: one background scan at startup, then incremental
// re-reads at most every TOKENS_MS and only while a page is open.
const TOKENS_MS = Math.max(30, Number(process.env.NEKO_TOKENS_INTERVAL || 60)) * 1000;
const tokens = new DailyTokens({ onUpdate: (data) => broadcast({ type: 'tokens', tokens: data }) });
// Optional holidays file, re-read when its mtime changes (checked on connect and on the same tick).
const holidays = new HolidayFile();
holidays.check();
let tick = null;
function periodic() {
  if (holidays.check()) broadcast({ type: 'holidays', holidays: holidays.snapshot() });
  void tokens.refreshIfDue(TOKENS_MS - 5000);
}
function setActive(active) {
  redmine.setActive(active);
  if (active && !tick) {
    periodic();
    tick = setInterval(periodic, TOKENS_MS);
    tick.unref();
  } else if (!active && tick) {
    clearInterval(tick);
    tick = null;
  }
}
const fullState = () => ({ ...state.snapshot(), redmine: redmine.snapshot(), tokens: tokens.snapshot(), holidays: holidays.snapshot() });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; " +
    "img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'",
};

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 413 })); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('bad json'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

async function handleHook(req, res) {
  // Claude Code posts JSON without an Origin header; a browser page cannot do that cross-site.
  if (req.headers.origin) return send(res, 403, { error: 'forbidden' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'json only' });
  }
  let payload;
  try { payload = await readJson(req); }
  catch (e) { return send(res, e.code || 400, { error: e.message }); }

  const change = state.apply(payload);
  // Always answer 200 with an empty object: hooks must never block or steer Claude.
  send(res, 200, '{}');
  if (!change) return;
  trackUsage(payload);
  // a finished turn is when today's token count grows; still at most once per tick and only with a page open
  if (tick && (change.item.event === 'Stop' || change.item.event === 'SubagentStop')) void tokens.refreshIfDue(TOKENS_MS - 5000);
  // Field NAMES only — never values, which can hold prompts, paths or tool output.
  if (DEBUG) console.log(`[neko] ${change.item.event} ${change.session.id.slice(0, 8)} ${change.session.status} agent=${typeof payload.agent_id === 'string' ? payload.agent_id.slice(0, 8) : '-'} fields=${Object.keys(payload).sort().join(',')}`);
  broadcast({ type: 'event', session: change.session, item: change.item });
}

// The page's refresh button. Only our own pages may call it; it only re-fetches the issue list.
function handleRedmineRefresh(req, res) {
  const origin = req.headers.origin || '';
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: 'forbidden' });
  res.setHeader('Access-Control-Allow-Origin', origin); // vite dev server on :5173
  if (!redmine.config) return send(res, 200, { ok: false });
  // 200 either way so a too-early click does not show up as a console error.
  return send(res, 200, { ok: redmine.requestRefresh() });
}

function serveStatic(req, res) {
  if (!fs.existsSync(DIST)) {
    return send(res, 200,
      '<!doctype html><meta charset="utf-8"><title>Neko Dream Office</title>' +
      '<p style="font-family:sans-serif">Frontend is not built yet. Run <code>npm run build</code>, ' +
      'or use <code>npm run dev:web</code> and open http://127.0.0.1:5173</p>', MIME['.html']);
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  // Reject DNS-rebinding style requests that reach us under a foreign Host name.
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 421, { error: 'bad host' });

  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/hook') {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    return void handleHook(req, res);
  }
  if (pathname === '/api/redmine/refresh') return handleRedmineRefresh(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  if (pathname === '/api/health') {
    return send(res, 200, { ok: true, clients: wss.clients.size, sessions: state.sessions.size, events: state.eventCount });
  }
  if (pathname === '/api/state') {
    if (holidays.check()) broadcast({ type: 'holidays', holidays: holidays.snapshot() });
    return send(res, 200, fullState());
  }
  return serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname !== '/ws' || !ALLOWED_HOSTS.has(req.headers.host || '') || !ALLOWED_ORIGINS.has(req.headers.origin || '')) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', () => {}); // the page is read-only; incoming messages are ignored
  ws.on('error', () => {});
  ws.on('close', () => setActive(wss.clients.size > 0));
  holidays.check();
  ws.send(JSON.stringify({ type: 'snapshot', ...fullState() }));
  setActive(true);
});

function broadcast(msg) {
  if (wss.clients.size === 0) return;
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(data);
}

// Drop dead sockets (sleeping laptop, killed tab). Cheap: one ping per client per 30s.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
heartbeat.unref();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`[neko] port ${PORT} is already in use. Set NEKO_PORT to change it.`);
  else console.error('[neko] server error:', err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[neko] Neko Dream Office listening on http://${HOST}:${PORT}  (hooks -> POST /hook, live -> /ws)`);
  console.log(redmine.config ? `[neko] Redmine: enabled (${redmine.config.source})` : '[neko] Redmine: not configured');
  const t0 = Date.now();
  tokens.refresh().then(() => console.log(`[neko] token history: scanned ${tokens.files.size} transcript files in ${Date.now() - t0} ms`));
});

function shutdown() {
  clearInterval(heartbeat);
  usage.stop();
  setActive(false);
  tokens.stop();
  for (const ws of wss.clients) ws.close(1001, 'server shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
