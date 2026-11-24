// מנגינת המתנה קצרה בזמן שבוטי חושב.
// המנגינה נוצרת כאן בקוד (צלילים פשוטים - בלי זכויות יוצרים), מועלית פעם אחת לכל מערכת ימות ונשמרת.
import { hasDb, sql } from './db.js';
import { currentToken } from './systems.js';

const VERSION = 'v1';
const FOLDER = '/9876';
const SR = 8000; // ימות עובדת ב-8kHz

// ארפג'ו רך בסולם פנטטוני (כמו פעמונים/מרימבה) מעל אקורד שקט, כ-7 שניות
function makeWav() {
  const noteLen = 0.42;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const pattern = [72, 76, 79, 81, 79, 76, 74, 79, 72, 76, 79, 84, 81, 79, 76, 74];
  const total = Math.round(SR * (pattern.length * noteLen + 0.4));
  const out = new Float32Array(total);
  pattern.forEach((m, i) => {
    const f = hz(m);
    const start = Math.round(i * noteLen * SR);
    const len = Math.round(1.2 * SR);
    for (let k = 0; k < len && start + k < total; k++) {
      const t = k / SR;
      const env = Math.min(1, t / 0.01) * Math.exp(-4.5 * t);
      out[start + k] += env * (0.55 * Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(2 * Math.PI * 2 * f * t) + 0.06 * Math.sin(2 * Math.PI * 3 * f * t));
    }
  });
  // אקורד רקע שקט (דו-סול)
  for (let k = 0; k < total; k++) {
    const t = k / SR;
    out[k] += 0.07 * (Math.sin(2 * Math.PI * hz(48) * t) + Math.sin(2 * Math.PI * hz(55) * t));
  }
  // נרמול + כניסה ויציאה הדרגתיות
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const pcm = Buffer.alloc(total * 2);
  for (let k = 0; k < total; k++) {
    const fade = Math.min(1, k / (0.3 * SR), (total - k) / (0.5 * SR));
    const v = Math.max(-1, Math.min(1, (out[k] / peak) * 0.6 * fade));
    pcm.writeInt16LE(Math.round(v * 32767), k * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

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
