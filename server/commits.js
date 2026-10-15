// Which Redmine tickets my git commits mention, and whether I logged time on them.
// Reads `git log` of local repos only (no network). Only ticket ids, repo folder names, commit
// counts and days leave this module — never commit subjects, author names or full paths.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const CONFIG_FILE = path.join(os.homedir(), '.config', 'neko-dream-office', 'git.json');
// The dev-work-report skill already lists the repos and git author; reused read-only when git.json is absent.
const REPORT_CONFIG = path.join(os.homedir(), '.claude', 'skills', 'dev-work-report', 'config.json');
const GIT_TIMEOUT_MS = 10_000;
const GIT_CONCURRENCY = 3;
const MAX_REPOS = 30;
const MAX_TICKETS = 60;

// { author, repos } from git.json, else from the dev-work-report config. Only these two fields are read.
export function loadGitConfig(files = [[CONFIG_FILE, 'file'], [REPORT_CONFIG, 'dev-work-report']]) {
  for (const [file, source] of files) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      const author = typeof cfg.author === 'string' ? cfg.author : cfg.git_author;
      const repos = Array.isArray(cfg.repos) ? cfg.repos.filter((r) => typeof r === 'string' && r.trim()) : [];
      if (typeof author === 'string' && author.trim() && repos.length) {
        return { author: author.trim(), repos: repos.slice(0, MAX_REPOS).map((r) => r.replace(/\/+$/, '')), source };
      }
    } catch { /* missing or unreadable: try the next one */ }
  }
  return null;
}

// Ticket references as our commits write them, e.g.
//   "Task #104498: …", "Defect #106873 : …", "REDMIND-87507,89635 [add]…",
//   "REDMIND-[88371,88303] …", "Task # 85804,85805 …", "#93602[New Loan] …", "[#97472][SIT] …".
// A lead-in word, then every 4–6 digit number while the text still looks like a list.
// "review #42" is not a lead-in, and whole tokens only, so "20250263" never becomes "202502".
const LEADIN = /(?:REDMIND|REDMINE|Task|Issue|TICKET|Defect|Bug|Feature|Support)\s*[-#:[]?\s*/gi;
const NUMBER_TAIL = /^[\s,[\]#]*((?<!\d)\d{4,6}(?!\d))/;
// Bare "#93602[New Loan]…", "[#97472][SIT]…", "#97473 : …": a # at a word start with 5–6 digits.
// Shorter ones ("#3141", "review #42", "OPay#5") are more likely MR/PR or other numbers.
const BARE_HASH = /(?:^|[\s[(])#(\d{5,6})(?!\d)/g;

export function extractTickets(subject) {
  if (typeof subject !== 'string') return [];
  const found = [];
  for (const m of subject.matchAll(LEADIN)) {
    let tail = subject.slice(m.index + m[0].length);
    for (let n = NUMBER_TAIL.exec(tail); n; n = NUMBER_TAIL.exec(tail)) {
      found.push(Number(n[1]));
      tail = tail.slice(n[0].length);
    }
  }
  for (const m of subject.matchAll(BARE_HASH)) found.push(Number(m[1]));
  return [...new Set(found)];
}

function gitLog(repo, author, from) {
  // --since filters on commit date (≥ author date), so nothing written on/after `from` is missed;
  // rebased/cherry-picked older work is dropped below on the author date.
  const args = ['-C', repo, 'log', '--all', '--no-merges', `--since=${from} 00:00`, `--author=${author}`, '--date=short', '--pretty=%ad|%s'];
  return new Promise((resolve) => {
    execFile('git', args, { timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// Group commits by ticket. The same work often sits on several branches (--all):
// one commit per (repo, day, subject) so counts stay honest.
export function groupCommits(logs, from, to) {
  const tickets = new Map();
  const seen = new Set();
  let noTicket = 0;
  for (const { repo, text } of logs) {
    for (const line of text.split('\n')) {
      const bar = line.indexOf('|');
      if (bar < 0) continue;
      const day = line.slice(0, bar);
      const subject = line.slice(bar + 1);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from || day > to) continue;
      const key = `${repo}|${day}|${subject}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ids = extractTickets(subject);
      if (!ids.length) { noTicket++; continue; }
      for (const id of ids) {
        const t = tickets.get(id) || { repos: new Set(), commits: 0, days: new Set() };
        t.repos.add(repo);
        t.commits++;
        t.days.add(day);
        tickets.set(id, t);
      }
    }
  }
  return { tickets, noTicket };
}

export async function scanCommits(config, from, to) {
  const queue = config.repos.slice();
  const logs = [];
  const missing = [];
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      const text = await gitLog(repo, config.author, from);
      if (text === null) missing.push(path.basename(repo));
      else logs.push({ repo: path.basename(repo), text });
    }
  };
  await Promise.all(Array.from({ length: Math.min(GIT_CONCURRENCY, queue.length) }, worker));
  return { ...groupCommits(logs, from, to), scanned: logs.length, missing: missing.sort() };
}

// Join commits with my own time entries over the same days.
//   none — commits, but no time logged on that ticket in the range
//   ok   — some time logged on it in the range (any day)
export function matchCommits(scan, entries) {
  const logged = new Map();
  for (const e of entries || []) {
    const id = Number(e?.issue?.id);
    const h = Number(e?.hours);
    if (!Number.isInteger(id) || !Number.isFinite(h) || typeof e.spent_on !== 'string') continue;
    const l = logged.get(id) || { hours: 0, days: new Set() };
    l.hours += h;
    l.days.add(e.spent_on);
    logged.set(id, l);
  }
  const rank = { none: 0, ok: 1 };
  const tickets = [...scan.tickets].map(([id, c]) => {
    const days = [...c.days].sort();
    const l = logged.get(id);
    const lastCommit = days.at(-1);
    const lastLog = l ? [...l.days].sort().at(-1) : null;
    const state = l ? 'ok' : 'none';
    return {
      id, repos: [...c.repos].sort(), commits: c.commits, days, lastCommit,
      hours: l ? Math.round(l.hours * 100) / 100 : 0, loggedDays: l ? l.days.size : 0, lastLog, state,
    };
  });
  tickets.sort((a, b) => rank[a.state] - rank[b.state] || b.lastCommit.localeCompare(a.lastCommit) || b.id - a.id);
  return { tickets: tickets.slice(0, MAX_TICKETS), total: tickets.length, noTicket: scan.noTicket, scanned: scan.scanned, missing: scan.missing };
}
