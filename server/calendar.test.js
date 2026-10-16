// Unit tests for the iCal reader (hand-written .ics text, temp files, a fake fetch — no real calendar).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseIcs, parseLine, parseRule, parseDuration, eventsBetween, loadCalendarConfig, CalendarFeed, wallToMs, calendarFromInput } from './calendar.js';

const ics = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const utc = (s) => Date.parse(s);
const titles = (list) => list.map((e) => e.title);

test('parseLine handles quoted params holding ":" and ";"', () => {
  assert.deepEqual(parseLine('DTSTART;TZID="Asia/Bangkok":20261015T090000'), { name: 'DTSTART', params: { TZID: 'Asia/Bangkok' }, value: '20261015T090000' });
  const p = parseLine('ATTENDEE;CN="Doe; J: x":mailto:a@b.c');
  assert.equal(p.params.CN, 'Doe; J: x');
  assert.equal(p.value, 'mailto:a@b.c');
  assert.equal(parseLine('no colon'), null);
});

test('unfolds lines, unescapes text and reads UTC / TZID / Windows zone times', () => {
  const root = parseIcs(ics(
    ev('UID:a', 'DTSTART:20261015T020000Z', 'DTEND:20261015T030000Z', 'SUMMARY:Daily\\, stand', '  up', 'LOCATION:Room 1\\;A'),
    ev('UID:b', 'DTSTART;TZID=Asia/Bangkok:20261015T130000', 'DURATION:PT30M', 'SUMMARY:Review'),
    ev('UID:c', 'DTSTART;TZID=SE Asia Standard Time:20261015T150000', 'DTEND;TZID=SE Asia Standard Time:20261015T160000', 'SUMMARY:Outlook'),
  ));
  const out = eventsBetween(root, utc('2026-10-14T17:00:00Z'), utc('2026-10-16T17:00:00Z'));
  assert.deepEqual(titles(out), ['Daily, stand up', 'Review', 'Outlook']);
  assert.equal(out[0].location, 'Room 1;A');
  assert.equal(out[1].start, utc('2026-10-15T06:00:00Z'));
  assert.equal(out[1].end - out[1].start, 30 * 60_000);
  assert.equal(out[2].start, utc('2026-10-15T08:00:00Z'));
  assert.equal(out[2].end, utc('2026-10-15T09:00:00Z'));
});

test('unknown TZID falls back to the VTIMEZONE standard offset', () => {
  const root = parseIcs(ics(
    'BEGIN:VTIMEZONE', 'TZID:Custom Zone', 'BEGIN:STANDARD', 'TZOFFSETFROM:+0700', 'TZOFFSETTO:+0700', 'END:STANDARD', 'END:VTIMEZONE',
    ev('UID:x', 'DTSTART;TZID=Custom Zone:20261015T090000', 'SUMMARY:x'),
  ));
  assert.equal(eventsBetween(root, utc('2026-10-15T00:00:00Z'), utc('2026-10-16T00:00:00Z'))[0].start, utc('2026-10-15T02:00:00Z'));
});

test('all-day events and cancelled events', () => {
  const root = parseIcs(ics(
    ev('UID:h', 'DTSTART;VALUE=DATE:20261015', 'DTEND;VALUE=DATE:20261016', 'SUMMARY:Holiday'),
    ev('UID:z', 'DTSTART:20261015T020000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone'),
  ));
  const from = new Date(2026, 9, 15).getTime();
  const out = eventsBetween(root, from, new Date(2026, 9, 17).getTime());
  assert.deepEqual(titles(out), ['Holiday']);
  assert.equal(out[0].allDay, true);
  assert.equal(out[0].start, from);
  assert.equal(out[0].end, from + 86_400_000);
});

test('weekly BYDAY recurrence with EXDATE and a moved occurrence (RECURRENCE-ID)', () => {
  const root = parseIcs(ics(
    ev('UID:w', 'DTSTART:20260901T020000Z', 'DTEND:20260901T023000Z', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', 'EXDATE:20261013T020000Z', 'SUMMARY:Sync'),
    ev('UID:w', 'RECURRENCE-ID:20261015T020000Z', 'DTSTART:20261015T070000Z', 'DTEND:20261015T073000Z', 'SUMMARY:Sync (moved)'),
  ));
  // Mon 12 – Sat 17 Oct: Tue 13 is excluded, Thu 15 is moved
  const out = eventsBetween(root, utc('2026-10-12T00:00:00Z'), utc('2026-10-18T00:00:00Z'));
  assert.deepEqual(out.map((e) => [e.title, new Date(e.start).toISOString()]), [['Sync (moved)', '2026-10-15T07:00:00.000Z']]);
});

test('COUNT, UNTIL, INTERVAL and monthly last-Friday rules', () => {
  const root = parseIcs(ics(
    ev('UID:c', 'DTSTART:20261012T010000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:count'),
    ev('UID:u', 'DTSTART:20261001T010000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261013T000000Z', 'SUMMARY:until'),
    ev('UID:m', 'DTSTART:20260130T080000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR', 'SUMMARY:month-end'),
    ev('UID:y', 'DTSTART;VALUE=DATE:20200229', 'RRULE:FREQ=YEARLY', 'SUMMARY:leap'),
  ));
  const out = eventsBetween(root, utc('2026-10-01T00:00:00Z'), utc('2026-11-01T00:00:00Z'));
  assert.equal(out.filter((e) => e.title === 'count').length, 3);
  assert.deepEqual(out.filter((e) => e.title === 'until').map((e) => new Date(e.start).getUTCDate()), [1, 3, 5, 7, 9, 11]);
  assert.deepEqual(out.filter((e) => e.title === 'month-end').map((e) => new Date(e.start).toISOString()), ['2026-10-30T08:00:00.000Z']);
  assert.equal(out.filter((e) => e.title === 'leap').length, 0);
  // an ongoing meeting that began before the window still shows
  const long = eventsBetween(parseIcs(ics(ev('UID:l', 'DTSTART:20261014T230000Z', 'DTEND:20261015T010000Z', 'SUMMARY:late'))), utc('2026-10-15T00:00:00Z'), utc('2026-10-16T00:00:00Z'));
  assert.deepEqual(titles(long), ['late']);
});

test('parseRule / parseDuration', () => {
  assert.equal(parseRule('FREQ=SECONDLY'), null);
  assert.deepEqual(parseRule('FREQ=MONTHLY;BYDAY=2TU,-1FR').byDay, [{ n: 2, day: 2 }, { n: -1, day: 5 }]);
  assert.equal(parseDuration('PT1H30M'), 90 * 60_000);
  assert.equal(parseDuration('P1D'), 86_400_000);
  assert.equal(parseDuration('junk'), null);
});

test('wallToMs keeps DST zones right', () => {
  assert.equal(wallToMs({ y: 2026, m: 7, d: 1, h: 9, mi: 0, s: 0 }, { iana: 'America/New_York' }), utc('2026-07-01T13:00:00Z'));
  assert.equal(wallToMs({ y: 2026, m: 12, d: 1, h: 9, mi: 0, s: 0 }, { iana: 'America/New_York' }), utc('2026-12-01T14:00:00Z'));
});

test('loadCalendarConfig accepts url / webcal / file entries and drops junk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-cal-'));
  const file = path.join(dir, 'calendar.json');
  fs.writeFileSync(file, JSON.stringify({ calendars: [
    { name: 'Work', url: 'webcal://example.test/a.ics' },
    { url: 'ftp://nope' },
    { name: 'Me', file: '~/x.ics' },
    'junk',
  ] }), { mode: 0o600 });
  assert.deepEqual(loadCalendarConfig(file), [
    { name: 'Work', url: 'https://example.test/a.ics' },
    { name: 'Me', file: path.join(os.homedir(), 'x.ics') },
  ]);
  assert.equal(loadCalendarConfig(path.join(dir, 'missing.json')), null);
});

test('CalendarFeed sends only trimmed events and never the URL', async () => {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const body = ics(ev('UID:1', `DTSTART;VALUE=DATE:${today}`, 'SUMMARY:Team day', 'DESCRIPTION:secret notes', 'ATTENDEE:mailto:x@y.z'));
  const secret = 'https://cal.example.test/private-abc123/basic.ics';
  const feed = new CalendarFeed({
    config: [{ name: 'Work', url: secret }, { name: 'Broken', url: 'https://down.example.test/x.ics' }],
    fetchImpl: async (url) => (url === secret ? new Response(body) : new Response('no', { status: 401 })),
  });
  await feed.refresh();
  const snap = feed.snapshot();
  assert.deepEqual(snap.events.map((e) => [e.title, e.cal, e.allDay]), [['Team day', 0, true]]);
  assert.deepEqual(snap.calendars, [{ name: 'Work', error: null }, { name: 'Broken', error: 'HTTP 401' }]);
  const json = JSON.stringify(snap);
  for (const leak of ['private-abc123', 'down.example', 'secret notes', 'x@y.z', 'uid']) assert.ok(!json.includes(leak), leak);
});

test('connect checks the link, then saves calendar.json owner-only and starts showing it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-cal-'));
  const file = path.join(dir, 'sub', 'calendar.json');
  const good = 'https://cal.example.test/secret-xyz/basic.ics';
  const updates = [];
  const feed = new CalendarFeed({
    file, onUpdate: (d) => updates.push(d),
    fetchImpl: async (url) => (url === good ? new Response(ics(ev('UID:1', 'DTSTART:20261016T020000Z', 'SUMMARY:x'))) : url.includes('html') ? new Response('<html>') : new Response('', { status: 404 })),
  });
  assert.equal(feed.snapshot().configured, false);
  assert.deepEqual(calendarFromInput({ url: 'ftp://x' }), null);
  assert.equal((await feed.connect({ url: 'javascript:alert(1)' })).ok, false);
  assert.deepEqual(await feed.connect({ url: 'https://cal.example.test/missing.ics' }), { ok: false, error: 'ดึงปฏิทินไม่ได้: HTTP 404' });
  assert.equal((await feed.connect({ url: 'https://cal.example.test/page.html' })).error, 'ลิงก์นี้ไม่ใช่ไฟล์ iCal (.ics)');
  assert.ok(!fs.existsSync(file), 'nothing saved for a bad link');
  assert.deepEqual(await feed.connect({ url: good.replace('https://', 'webcal://'), name: ' งาน ' }), { ok: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { calendars: [{ name: 'งาน', url: good }] });
  assert.equal(feed.snapshot().configured, true);
  assert.ok(updates.length > 0 && !JSON.stringify(updates).includes('secret-xyz'));
});
