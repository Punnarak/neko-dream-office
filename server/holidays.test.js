// Unit tests for the holidays file parser (hand-written JSON, temp files — not the real config).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHolidays, validDate, HolidayFile } from './holidays.js';

test('validDate accepts real YYYY-MM-DD dates only', () => {
  assert.equal(validDate('2026-10-13'), '2026-10-13');
  assert.equal(validDate('2028-02-29'), '2028-02-29');
  for (const v of ['2026-02-30', '2026-13-01', '2026-1-5', '26-10-13', '2026-10-13T00:00', '', null, 20261013]) assert.equal(validDate(v), null, String(v));
});

test('parseHolidays validates, cleans names, dedupes by date and sorts', () => {
  const out = parseHolidays({ holidays: [
    { date: '2026-12-05', name: '  วันพ่อ\n แห่งชาติ  ' },
    { date: '2026-10-13', name: 'old' },
    { date: '2026-10-13', name: 'วันคล้ายวันสวรรคต ร.9' }, // the later entry for a date wins
    { date: '2026-02-30', name: 'bad date' },
    { date: '2026-10-23' },                                  // no name -> generic label
    { date: '2026-10-24', name: 'x'.repeat(200) },
    'junk', null, { name: 'no date' },
  ] });
  assert.deepEqual(out.map((h) => h.date), ['2026-10-13', '2026-10-23', '2026-10-24', '2026-12-05']);
  assert.equal(out[0].name, 'วันคล้ายวันสวรรคต ร.9');
  assert.equal(out[1].name, 'วันหยุด');
  assert.ok(out[2].name.length <= 60);
  assert.equal(out[3].name, 'วันพ่อ แห่งชาติ');
  assert.deepEqual(parseHolidays([{ date: '2026-01-01', name: 'ปีใหม่' }]), [{ date: '2026-01-01', name: 'ปีใหม่' }]);
  assert.deepEqual(parseHolidays(null), []);
  assert.deepEqual(parseHolidays({ holidays: 'nope' }), []);
});

test('the shipped example parses: 14 fixed-date 2026 holidays', () => {
  const file = new URL('../holidays.example.json', import.meta.url);
  const list = parseHolidays(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(list.length, 14);
  assert.ok(list.every((h) => h.date.startsWith('2026-')));
  assert.ok(list.some((h) => h.date === '2026-10-13'));
});

test('HolidayFile: missing file = no holidays; re-read when mtime changes; bad JSON reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-hol-'));
  const file = path.join(dir, 'holidays.json');
  const h = new HolidayFile(file);
  assert.equal(h.check(), false);
  assert.deepEqual(h.snapshot(), { list: [], configured: false, error: null });
  fs.writeFileSync(file, JSON.stringify({ holidays: [{ date: '2026-10-13', name: 'A' }] }));
  fs.utimesSync(file, new Date(1_000_000), new Date(1_000_000));
  assert.equal(h.check(), true);
  assert.equal(h.check(), false); // same mtime: not re-read
  assert.deepEqual(h.snapshot().list, [{ date: '2026-10-13', name: 'A' }]);
  fs.writeFileSync(file, '{broken');
  fs.utimesSync(file, new Date(2_000_000), new Date(2_000_000));
  assert.equal(h.check(), true);
  assert.equal(h.snapshot().list.length, 0);
  assert.match(h.snapshot().error, /JSON/);
  fs.rmSync(dir, { recursive: true });
  h.check();
  assert.deepEqual(h.snapshot(), { list: [], configured: false, error: null });
});
