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

// ---- Resolved but not merged: branches with work on my tickets that the default branch does not have ----

const MAX_BRANCHES = 300; // per repo; each one costs a quick local `git log`
const BRANCH_TICKET = /(?<!\d)\d{5,6}(?!\d)/g; // Redmine ids here are 5–6 digits ("ticket/212" is not one)
// Per (repo, base tip, branch tip): every ticket the branch's own commits mention, and how many there are.
// A branch is logged again only when it or the default branch moves. Ticket ids and counts only.
const branchCache = new Map();
const MAX_CACHE = 5000;

// Local read-only git: execFile, no shell, no network. Resolves stdout, or null on any failure.
export function runGit(repo, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', repo, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// origin/HEAD when the clone knows it, else the first of origin/master, origin/main, master, main that exists.
async function defaultBranch(repo, git) {
  const head = (await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))?.trim();
  if (head) return head;
  for (const ref of ['origin/master', 'origin/main', 'master', 'main']) {
    if ((await git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) !== null) return ref;
  }
  return null;
}

// Branches not merged into `base`, one per name: "origin/x" and local "x" count once (the one further ahead wins).
async function unmergedIn(repo, git, wanted) {
  const base = await defaultBranch(repo, git);
  if (!base) return [];
  // Full ref names so remote HEAD pointers are easy to skip.
  const baseSha = (await git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]))?.trim();
  const out = await git(repo, ['branch', '-a', '--no-merged', base, '--format=%(objectname) %(refname)']);
  if (out === null) return [];
  const short = base.replace(/^origin\//, '');
  const refs = new Map(); // display name -> [{ ref, sha }] to log
  for (const line of out.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [sha, full = ''] = line.split(' ');
    if (!full || full.endsWith('/HEAD')) continue;
    const ref = full.replace(/^refs\/(heads|remotes)\//, '');
    const name = ref.replace(/^origin\//, '');
    if (name === short) continue; // local copy of the default branch
    if (!refs.has(name)) refs.set(name, []);
    refs.get(name).push({ ref, sha });
  }
  const found = [];
  for (const [name, list] of [...refs].slice(0, MAX_BRANCHES)) {
    let best = null;
    for (const { ref, sha } of list) {
      const key = `${repo}|${baseSha}|${ref}|${sha}`;
      let hit = baseSha ? branchCache.get(key) : null;
      if (!hit) {
        const log = await git(repo, ['log', `${base}..${ref}`, '--no-merges', '--pretty=%s']);
        if (log === null) continue;
        const subjects = log.split('\n').filter(Boolean);
        const ids = new Set([...name.matchAll(BRANCH_TICKET)].map((m) => Number(m[0])));
        for (const s of subjects) for (const id of extractTickets(s)) ids.add(id);
        hit = { ids: [...ids], ahead: subjects.length };
        if (baseSha) {
          if (branchCache.size >= MAX_CACHE) branchCache.clear();
          branchCache.set(key, hit);
        }
      }
      const tickets = hit.ids.filter((id) => wanted.has(id));
      if (tickets.length && (!best || hit.ahead > best.ahead)) best = { tickets, ahead: hit.ahead };
    }
    if (best) found.push({ name, base: short, ...best });
  }
  return found;
}

// Map ticketId -> [{ repo, branch, base, ahead }] for the given tickets only. Never `git fetch`: what the
// local clone knows of origin is what counts. Only folder names, branch names and counts leave this module.
export async function scanUnmerged(config, ticketIds, git = runGit) {
  const wanted = new Set((ticketIds || []).filter((id) => Number.isInteger(id) && id > 0));
  const result = new Map();
  if (!wanted.size || !config?.repos?.length) return result;
  const queue = config.repos.slice();
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      let branches = [];
      try { branches = await unmergedIn(repo, git, wanted); } catch { /* one broken repo never hides the others */ }
      for (const b of branches) {
        for (const id of b.tickets) {
          if (!result.has(id)) result.set(id, []);
          result.get(id).push({ repo: path.basename(repo), branch: b.name.slice(0, 60), base: b.base.slice(0, 60), ahead: b.ahead });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(GIT_CONCURRENCY, queue.length) }, worker));
  for (const list of result.values()) list.sort((a, b) => b.ahead - a.ahead || a.repo.localeCompare(b.repo) || a.branch.localeCompare(b.branch));
  return result;
}
