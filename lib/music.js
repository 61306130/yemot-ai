// מנגינת המתנה קצרה בזמן שבוטי חושב.
// המנגינה נוצרת כאן בקוד (צלילים פשוטים - בלי זכויות יוצרים), מועלית פעם אחת לכל מערכת ימות ונשמרת.
import { hasDb, sql } from './db.js';
import { currentToken } from './systems.js';

const VERSION = 'v3';
const FOLDER = '/9876';
const SR = 8000; // ימות עובדת ב-8kHz

// לופ אנרגטי (128 BPM, 4 תיבות): בס-דראם על כל נקישה, קלאפ, היי-האט פתוח באופבית, בס מתגלגל בשש-עשריות,
// ארפג'ו עולה, ובתיבה האחרונה תופים מתגברים + "רייזר" שעולה למעלה - תחושה שעוד רגע זה מגיע.
function makeWav() {
  const BPM = 128, beat = 60 / BPM, bars = 4, steps = bars * 16, step = beat / 4;
  const total = Math.round(SR * (steps * step + 0.15));
  const out = new Float32Array(total);
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let seed = 987;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
  const add = (t0, dur, fn) => {
    const st = Math.round(t0 * SR), len = Math.round(dur * SR);
    for (let k = 0; k < len && st + k < total; k++) out[st + k] += fn(k / SR);
  };
  const roots = [45, 41, 48, 43]; // A F C G
  const arps = [[69, 72, 76, 81], [65, 69, 72, 77], [67, 72, 76, 79], [67, 71, 74, 79]];
  for (let i = 0; i < steps; i++) {
    const t0 = i * step, bar = Math.floor(i / 16), s16 = i % 16, last = bar === bars - 1;
    // בס-דראם על כל רבע
    if (s16 % 4 === 0) add(t0, 0.22, (t) => 1.0 * Math.exp(-16 * t) * Math.sin(2 * Math.PI * (50 + 110 * Math.exp(-35 * t)) * t));
    // קלאפ על 2 ו-4; בתיבה האחרונה - תופים מתגברים בשש-עשריות
    if (s16 === 4 || s16 === 12 || (last && s16 >= 8)) {
      const g = last && s16 >= 8 ? 0.35 + 0.08 * (s16 - 8) : 0.6;
      add(t0, 0.14, (t) => g * Math.exp(-28 * t) * (noise() * 0.9 + 0.3 * Math.sin(2 * Math.PI * 210 * t)));
    }
    // היי-האט: סגור בשמיניות, פתוח באופבית
    { let prev = 0; const open = s16 % 4 === 2; if (s16 % 2 === 0) add(t0, open ? 0.12 : 0.04, (t) => { const n = noise(); const hp = n - prev; prev = n; return (open ? 0.22 : 0.12) * Math.exp((open ? -22 : -80) * t) * hp; }); }
    // בס מתגלגל (שש-עשריות, אוקטבות)
    { const f = hz(roots[bar] + (s16 % 2 ? 12 : 0)); add(t0, step * 0.95, (t) => 0.38 * Math.exp(-9 * t) * Math.tanh(3 * Math.sin(2 * Math.PI * f * t))); }
    // ארפג'ו בשש-עשריות, עולה אוקטבה בחצי השני של כל תיבה
    { const ch = arps[bar]; const m = ch[s16 % 4] + (s16 >= 8 ? 12 : 0) + (last && s16 >= 12 ? 5 : 0); const f = hz(m);
      add(t0, 0.13, (t) => 0.2 * Math.exp(-18 * t) * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.3 * Math.sin(6 * Math.PI * f * t))); }
  }
  // רייזר בתיבה האחרונה: רעש שמתחזק וצליל שעולה
  { const t0 = 3 * 16 * step, dur = 16 * step; let ph = 0;
    add(t0, dur, (t) => { const x = t / dur; ph += 2 * Math.PI * (300 + 1500 * x * x) / SR; return x * x * (0.25 * noise() + 0.22 * Math.sin(ph)); }); }
  // נרמול + דחיסה (חזק וברור בטלפון)
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const pcm = Buffer.alloc(total * 2);
  for (let k = 0; k < total; k++) {
    const fade = Math.min(1, k / (0.02 * SR), (total - k) / (0.08 * SR));
    const v = Math.tanh((out[k] / peak) * 2.0) * 0.9 * fade;
    pcm.writeInt16LE(Math.round(v * 32767), k * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export { makeWav as makeHoldWav };

const mem = globalThis.__holdMusic || (globalThis.__holdMusic = new Map());
const numName = (s) => {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1e10;
  return String(h).padStart(10, '0');
};

// מחזיר הפניה לקובץ (f-/9876/...) במערכת של הבקשה הנוכחית
export async function holdMusic(token = currentToken() || process.env.YEMOT_TOKEN) {
  if (!token) return null;
  const sys = String(token).split(':')[0];
  const key = `music|${VERSION}|${sys}`;
  if (mem.has(key)) return mem.get(key);
  if (hasDb) {
    const [row] = await sql`select file from voice_cache where key = ${key}`.catch(() => []);
    if (row?.file) { mem.set(key, row.file); return row.file; }
  }
  const name = numName(key);
  const form = new FormData();
  form.append('token', token);
  form.append('path', `ivr2:${FOLDER}/${name}.wav`);
  form.append('convertAudio', '1');
  form.append('file', new Blob([makeWav()], { type: 'audio/wav' }), `${name}.wav`);
  const res = await fetch('https://www.call2all.co.il/ym/api/UploadFile', { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (data.responseStatus !== 'OK') throw new Error('העלאת מנגינה נכשלה: ' + JSON.stringify(data).slice(0, 150));
  const ref = `f-${FOLDER}/${name}`;
  mem.set(key, ref);
  if (hasDb) {
    await sql`insert into voice_cache (key, file) values (${key}, ${ref}) on conflict (key) do update set file = excluded.file`.catch(() => {});
    // שלא יימחק בניקוי הלילי
    await sql`insert into voice_files (name, sys) values (${name}, ${sys}) on conflict (name, sys) do update set created_at = now()`.catch(() => {});
  }
  return ref;
}
