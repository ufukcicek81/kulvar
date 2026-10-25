#!/usr/bin/env node
/*
 * Kulvar veri derleyici.
 * veri/ klasöründeki yarış dosyalarını okur ve uygulamanın otomatik çektiği data/sonuclar.json dosyasını üretir.
 *   .lxf          Lenex (zip içinde .lef) — Splash Meet Manager vb. zamanlama yazılımlarının dışa aktarımı
 *   .lef / .xml   Lenex XML
 *   .csv          yaris, tarih, sehir, havuz, ad, soyad, dogum_yili, cinsiyet, kulup, brans, derece
 *   rekorlar.csv  kapsam (TR/WR), havuz, cinsiyet, brans, derece, sahibi, kulup, tarih
 * Kullanım: node tools/veri-derle.mjs [veri klasörü] [çıktı dosyası]
 * Bağımlılık gerektirmez (Node 18+).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IN_DIR = path.resolve(process.argv[2] || path.join(ROOT, 'veri'));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'data', 'sonuclar.json'));

const EVENTS = new Set(['50SER', '100SER', '200SER', '400SER', '800SER', '1500SER', '50SRT', '100SRT', '200SRT',
  '50KUR', '100KUR', '200KUR', '50KEL', '100KEL', '200KEL', '100KAR', '200KAR', '400KAR']);
const STROKE = { FREE: 'SER', BACK: 'SRT', BREAST: 'KUR', FLY: 'KEL', MEDLEY: 'KAR' };

// ---------- Ortak yardımcılar ----------
function norm(s) {
  return String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/\s+/g, ' ').trim();
}
function id(prefix, ...parts) {
  return prefix + crypto.createHash('sha1').update(parts.map(norm).join('|')).digest('hex').slice(0, 10);
}
function titleCase(s) {
  return String(s || '').trim().toLocaleLowerCase('tr').replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('tr'));
}
// TAMAMI BÜYÜK HARF yazılmış adları düzelt; SK, GSK gibi kısaltmaları koru
function prettyName(s) {
  const v = String(s || '').trim().replace(/\s+/g, ' ');
  if (v !== v.toLocaleUpperCase('tr')) return v;
  return v.split(' ').map((w) => (w.length <= 3 && !/[aeıioöuü]/i.test(w.toLocaleLowerCase('tr')) ? w : titleCase(w))).join(' ');
}
function parseTime(str) {
  const v = String(str || '').trim().replace(',', '.');
  // Lenex: SS:DD:SS.ss  ·  CSV: M:SS.ss veya SS.ss
  let m = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})$/.exec(v);
  if (m) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 100 + +m[4] || null;
  m = /^(?:(\d{1,2}):)?(\d{1,2})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m || (m[1] && +m[2] >= 60)) return null;
  return ((+(m[1] || 0)) * 60 + +m[2]) * 100 + (m[3] ? +m[3].padEnd(2, '0') : 0) || null;
}
function parseEvent(str) {
  const v = norm(str).replace(/\s+/g, '');
  const m = /^(\d+)m?([a-z]+)/.exec(v);
  if (!m) return null;
  const st = m[2];
  const style = /^ser|^fre/.test(st) ? 'SER' : /^sir|^srt|^bac/.test(st) ? 'SRT' : /^kur|^bre/.test(st) ? 'KUR'
    : /^kel|^fly|^but/.test(st) ? 'KEL' : /^kar|^im|^med/.test(st) ? 'KAR' : null;
  return style && EVENTS.has(m[1] + style) ? m[1] + style : null;
}
function isoDate(s) {
  const v = String(s || '').trim().replace(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/, (x, d, mo, y) => `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// ---------- Veri deposu ----------
const store = { clubs: new Map(), swimmers: new Map(), meets: new Map(), results: new Map(), records: new Map() };
const stats = { files: 0, results: 0, skipped: 0, notes: [] };

function addClub(name, city) {
  if (!name) return '';
  const cid = id('c', name);
  if (!store.clubs.has(cid)) store.clubs.set(cid, { id: cid, name: prettyName(name), city: city || '' });
  else if (city && !store.clubs.get(cid).city) store.clubs.get(cid).city = city;
  return cid;
}
// Kimlik ad + soyad + doğum yılı + cinsiyetten üretilir; böylece aynı sporcu Lenex ve CSV'de eşleşir.
function addSwimmer({ first, last, birthYear, gender, clubId }) {
  const sid = id('s', first, last, birthYear, gender);
  const prev = store.swimmers.get(sid);
  const s = { id: sid, first: titleCase(first), last: titleCase(last), birthYear, gender, clubId: clubId || (prev && prev.clubId) || '' };
  store.swimmers.set(sid, prev ? Object.assign(prev, { clubId: s.clubId }) : s);
  return sid;
}
function addMeet(name, city, date, pool) {
  const mid = id('m', name, date, pool);
  if (!store.meets.has(mid)) store.meets.set(mid, { id: mid, name: prettyName(name), city: city || '', date, pool });
  return mid;
}
function addResult(meetId, swimmerId, event, time) {
  const rid = id('r', meetId, swimmerId, event);
  const prev = store.results.get(rid);
  if (!prev || time < prev.time) store.results.set(rid, { id: rid, meetId, swimmerId, event, time });
  stats.results++;
}

// ---------- CSV ----------
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim()));
  const head = (clean.shift() || []).map((h) => norm(h).replace(/[^a-z_]/g, ''));
  return clean.map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] || '').trim()])));
}
const pick = (o, ...keys) => { for (const k of keys) if (o[k]) return o[k]; return ''; };

function importResultsCsv(file, text) {
  for (const [i, o] of parseCsv(text).entries()) {
    const time = parseTime(pick(o, 'derece', 'sure', 'time'));
    const ev = parseEvent(pick(o, 'brans', 'event'));
    const date = isoDate(pick(o, 'tarih', 'date'));
    const by = Number(pick(o, 'dogum_yili', 'dogumyili', 'yil', 'birthyear'));
    const first = pick(o, 'ad', 'adi', 'first'), last = pick(o, 'soyad', 'soyadi', 'last');
    const meet = pick(o, 'yaris', 'yarisma', 'meet');
    if (!time || !ev || !date || !by || !first || !meet) { stats.skipped++; if (stats.notes.length < 20) stats.notes.push(`${path.basename(file)} satır ${i + 2} atlandı`); continue; }
    const pool = pick(o, 'havuz', 'pool') === '25' ? 25 : 50;
    const city = pick(o, 'sehir', 'city');
    const gender = /^(k|f|w)/i.test(pick(o, 'cinsiyet', 'gender')) ? 'K' : 'E';
    const clubId = addClub(pick(o, 'kulup', 'club'), city);
    const sid = addSwimmer({ first, last, birthYear: by, gender, clubId });
    addResult(addMeet(meet, city, date, pool), sid, ev, time);
  }
}

function importRecordsCsv(file, text) {
  for (const o of parseCsv(text)) {
    const time = parseTime(pick(o, 'derece', 'time'));
    const ev = parseEvent(pick(o, 'brans', 'event'));
    const scope = /^w|^d/i.test(pick(o, 'kapsam', 'scope')) ? 'WR' : 'TR';
    if (!time || !ev) { stats.skipped++; continue; }
    const pool = pick(o, 'havuz', 'pool') === '25' ? 25 : 50;
    const gender = /^(k|f|w)/i.test(pick(o, 'cinsiyet', 'gender')) ? 'K' : 'E';
    const rid = id('rec', scope, pool, gender, ev);
    store.records.set(rid, { id: rid, scope, pool, gender, event: ev, time, holder: pick(o, 'sahibi', 'holder'), team: pick(o, 'kulup', 'ulke', 'team'), date: isoDate(pick(o, 'tarih', 'date')) || '' });
  }
}

// ---------- Lenex ----------
function unzip(buf) {
  // Merkezi dizini bul (End of Central Directory)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip değil');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    files.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function decodeXml(buf) {
  const head = buf.subarray(0, 200).toString('latin1');
  const enc = (/encoding=["']([^"']+)/i.exec(head) || [])[1] || 'utf-8';
  try { return new TextDecoder(enc.toLowerCase()).decode(buf); } catch { return buf.toString('utf8'); }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
}

// Basit XML ağacı: { tag, attr, children }
function parseXml(text) {
  const root = { tag: '#root', attr: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attr = {};
    m[3].replace(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (x, k, a, b) => { attr[k.toLowerCase()] = unescapeXml(a ?? b); });
    const node = { tag: m[2].toUpperCase(), attr, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}
const kids = (n, tag) => (n ? n.children.filter((c) => c.tag === tag) : []);
const kid = (n, tag) => kids(n, tag)[0];
const all = (n, tag) => kids(n, tag + 'S').flatMap((c) => kids(c, tag));

function importLenex(file, xml) {
  const doc = parseXml(xml);
  const lenex = kid(doc, 'LENEX');
  if (!lenex) throw new Error('LENEX kökü yok');
  for (const meet of all(lenex, 'MEET')) {
    const course = (meet.attr.course || '').toUpperCase();
    const pool = course === 'LCM' ? 50 : course === 'SCM' ? 25 : null;
    if (!pool) { stats.notes.push(`${path.basename(file)}: ${meet.attr.name} atlandı (havuz: ${course || '?'})`); continue; }
    const sessions = all(meet, 'SESSION');
    const dates = sessions.map((s) => s.attr.date).filter(Boolean).sort();
    const date = isoDate(dates[0] || (kid(meet, 'AGEDATE') || { attr: {} }).attr.value);
    if (!date) { stats.notes.push(`${path.basename(file)}: ${meet.attr.name} tarihi yok`); continue; }
    const city = meet.attr.city || '';
    const meetId = addMeet(meet.attr.name || path.basename(file), titleCase(city), date, pool);
    // eventid -> branş kodu (bayrak yarışları hariç)
    const events = {};
    for (const s of sessions) for (const ev of all(s, 'EVENT')) {
      const st = kid(ev, 'SWIMSTYLE');
      if (!st || Number(st.attr.relaycount || 1) > 1) continue;
      const code = st.attr.distance + (STROKE[(st.attr.stroke || '').toUpperCase()] || '?');
      if (EVENTS.has(code)) events[ev.attr.eventid] = code;
    }
    for (const club of all(meet, 'CLUB')) {
      const clubName = club.attr.name || club.attr.shortname;
      const isUnattached = (club.attr.type || '').toUpperCase() === 'UNATTACHED';
      const clubId = isUnattached ? '' : addClub(clubName, '');
      for (const a of all(club, 'ATHLETE')) {
        const by = Number(String(a.attr.birthdate || '').slice(0, 4));
        if (!by || !a.attr.firstname) { stats.skipped++; continue; }
        let sid = null;
        for (const r of all(a, 'RESULT')) {
          const ev = events[r.attr.eventid];
          const status = (r.attr.status || '').toUpperCase();
          const time = parseTime(r.attr.swimtime);
          // DSQ, DNS, DNF, EXH (gösteri) vb. dereceler sıralamaya girmez
          if (!ev || !time || status) { stats.skipped++; continue; }
          sid = sid || addSwimmer({ first: a.attr.firstname, last: a.attr.lastname, birthYear: by,
            gender: (a.attr.gender || '').toUpperCase() === 'F' ? 'K' : 'E', clubId });
          addResult(meetId, sid, ev, time);
        }
      }
    }
  }
}

// ---------- Çalıştır ----------
const files = fs.existsSync(IN_DIR) ? fs.readdirSync(IN_DIR).sort() : [];
for (const f of files) {
  const full = path.join(IN_DIR, f);
  const ext = path.extname(f).toLowerCase();
  try {
    if (ext === '.lxf' || ext === '.zip') {
      for (const z of unzip(fs.readFileSync(full))) if (/\.(lef|xml)$/i.test(z.name)) importLenex(f, decodeXml(z.data));
    } else if (ext === '.lef' || ext === '.xml') importLenex(f, decodeXml(fs.readFileSync(full)));
    else if (ext === '.csv') {
      const text = decodeXml(fs.readFileSync(full));
      if (/^rekor/i.test(f)) importRecordsCsv(full, text); else importResultsCsv(full, text);
    } else continue;
    stats.files++;
  } catch (e) {
    console.error(`HATA ${f}: ${e.message}`);
    process.exitCode = 1;
  }
}

const sortBy = (arr, k) => arr.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0));
const data = {
  app: 'kulvar', format: 1,
  clubs: sortBy([...store.clubs.values()], 'id'),
  swimmers: sortBy([...store.swimmers.values()], 'id'),
  meets: sortBy([...store.meets.values()], 'date'),
  results: sortBy([...store.results.values()], 'id'),
  records: sortBy([...store.records.values()], 'id')
};
// İçerik değişmediyse dosyaya dokunma (gereksiz commit olmasın)
const body = JSON.stringify(data);
const version = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
let prev = null;
try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* ilk çalıştırma */ }
if (prev && prev.version === version) {
  console.log('Değişiklik yok.');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(Object.assign({ version, updatedAt: new Date().toISOString() }, data)) + '\n');
  console.log(`Yazıldı: ${path.relative(process.cwd(), OUT)}`);
}
console.log(`${stats.files} dosya · ${data.meets.length} yarış · ${data.swimmers.length} sporcu · ${data.clubs.length} kulüp · ${data.results.length} derece · ${data.records.length} rekor · ${stats.skipped} kayıt atlandı`);
stats.notes.forEach((n) => console.log('  - ' + n));
