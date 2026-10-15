// Public holidays for the time tab, from an optional file the user keeps:
//   ~/.config/neko-dream-office/holidays.json   {"holidays":[{"date":"2026-10-13","name":"…"}]}
// Nothing is created automatically (copy holidays.example.json from the repo). The file is
// re-read only when its mtime changes. Invalid entries are dropped, names are trimmed/cleaned.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clean } from './sanitize.js';

export const HOLIDAYS_FILE = path.join(os.homedir(), '.config', 'neko-dream-office', 'holidays.json');
const MAX_HOLIDAYS = 500;
const MAX_BYTES = 256 * 1024;

// A real calendar date in YYYY-MM-DD form (2026-02-30 is rejected), or null.
export function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? v : null;
}

// Parsed JSON (object with `holidays`, or a bare array) -> [{ date, name }] sorted, one per date.
export function parseHolidays(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.holidays) ? data.holidays : [];
  const byDate = new Map();
  for (const h of list.slice(0, MAX_HOLIDAYS * 2)) {
    const date = validDate(h?.date);
    if (!date) continue;
    const name = typeof h.name === 'string' ? clean(h.name.replace(/\s+/g, ' ').trim(), 60) : '';
    byDate.set(date, { date, name: name || 'วันหยุด' });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_HOLIDAYS);
}

export class HolidayFile {
  constructor(file = HOLIDAYS_FILE) {
    this.file = file;
    this.mtime = null; // null = file missing (or not checked yet)
    this.list = [];
    this.error = null;
  }

  // Re-read when the file appeared, changed or disappeared. Returns true when the list changed.
  check() {
    let st = null;
    try { st = fs.statSync(this.file); } catch { /* no file: no holidays */ }
    const mtime = st && st.isFile() ? st.mtimeMs : null;
    if (mtime === this.mtime) return false;
    this.mtime = mtime;
    const before = JSON.stringify(this.list);
    if (mtime === null) { this.list = []; this.error = null; }
    else if (st.size > MAX_BYTES) { this.list = []; this.error = 'ไฟล์ใหญ่เกินไป'; }
    else {
      try { this.list = parseHolidays(JSON.parse(fs.readFileSync(this.file, 'utf8'))); this.error = null; }
      catch { this.list = []; this.error = 'อ่าน holidays.json ไม่ได้ (JSON ไม่ถูกต้อง)'; }
    }
    return JSON.stringify(this.list) !== before;
  }

  snapshot() {
    return { list: this.list, configured: this.mtime !== null, error: this.error };
  }
}
