// מנגינת המתנה קצרה בזמן שבוטי חושב.
// המנגינה נוצרת כאן בקוד (צלילים פשוטים - בלי זכויות יוצרים), מועלית פעם אחת לכל מערכת ימות ונשמרת.
import { hasDb, sql } from './db.js';
import { currentToken } from './systems.js';

const VERSION = 'v2';
const FOLDER = '/9876';
const SR = 8000; // ימות עובדת ב-8kHz

// לופ קצבי של כ-8 שניות: תופים (בס, סנר, היי-האט), בס מקפץ, אקורדים קצרים ומלודיה קליטה.
// התקדמות לה מינור - פה - דו - סול (118 BPM), ומסתיים בעלייה ש"מושכת לעוד".
function makeWav() {
  const BPM = 118, beat = 60 / BPM, bars = 4, steps = bars * 16; // צעדים של שש-עשריות
  const step = beat / 4;
  const total = Math.round(SR * (steps * step + 0.25));
  const out = new Float32Array(total);
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let seed = 12345;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
  const add = (startSec, durSec, fn) => {
    const st = Math.round(startSec * SR), len = Math.round(durSec * SR);
    for (let k = 0; k < len && st + k < total; k++) out[st + k] += fn(k / SR);
  };
  const roots = [57, 53, 48, 55]; // A F C G (בס)
  const chords = [[69, 72, 76], [65, 69, 72], [64, 67, 72], [62, 67, 71]];
  // מלודיה: שש-עשריות (null = שקט). מוטיב קצר שחוזר ומשתנה, והסוף עולה
  const mel = [
    76, null, 74, 76, null, 79, null, 76, 74, null, 72, null, 74, null, null, null,
    72, null, 74, 76, null, 77, null, 76, 74, null, 72, null, 69, null, null, null,
    76, null, 74, 76, null, 79, null, 81, 79, null, 76, null, 74, null, 76, null,
    79, null, 81, null, 83, null, 84, null, 86, null, null, null, 88, null, null, null,
  ];
  for (let i = 0; i < steps; i++) {
    const t0 = i * step, bar = Math.floor(i / 16), s16 = i % 16;
    // תופים
    if (s16 % 4 === 0 || s16 === 10) add(t0, 0.25, (t) => 0.9 * Math.exp(-14 * t) * Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-30 * t)) * t)); // בס-דראם
    if (s16 === 4 || s16 === 12) add(t0, 0.18, (t) => Math.exp(-22 * t) * (0.45 * noise() + 0.3 * Math.sin(2 * Math.PI * 190 * t))); // סנר
    if (s16 % 2 === 0) { let prev = 0; add(t0, 0.05, (t) => { const n = noise(); const hp = n - prev; prev = n; return 0.12 * Math.exp(-70 * t) * hp; }); } // היי-האט
    // בס מקפץ בשמיניות
    if (s16 % 2 === 0) {
      const m = roots[bar] - 12 + (s16 % 8 === 6 ? 12 : 0);
      const f = hz(m);
      add(t0, step * 1.8, (t) => 0.32 * Math.exp(-6 * t) * (Math.sin(2 * Math.PI * f * t) + 0.33 * Math.sin(6 * Math.PI * f * t) + 0.2 * Math.sin(10 * Math.PI * f * t)));
    }
    // אקורדים קצרים על הנקישה ה"אחורית"
    if (s16 === 2 || s16 === 6 || s16 === 10 || s16 === 14) {
      for (const m of chords[bar]) { const f = hz(m); add(t0, 0.16, (t) => 0.09 * Math.exp(-18 * t) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t))); }
    }
    // מלודיה (צליל "פלאק" עם מעט הרמוניות)
    const m = mel[i];
    if (m) { const f = hz(m); add(t0, 0.35, (t) => 0.3 * Math.min(1, t / 0.005) * Math.exp(-7 * t) * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t))); }
  }
  // נרמול + דחיסה עדינה (שיישמע חזק וברור בטלפון)
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const pcm = Buffer.alloc(total * 2);
  for (let k = 0; k < total; k++) {
    const fade = Math.min(1, k / (0.05 * SR), (total - k) / (0.2 * SR));
    const x = (out[k] / peak) * 1.6;
    const v = Math.tanh(x) * 0.85 * fade;
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
