// קול טבעי: הופך טקסט לשמע בקול עברי של מיקרוסופט (דרך שירות ההקראה של דפדפן Edge),
// מעלה את הקובץ לימות ומחזיר הודעת f- להשמעה.
// זה שירות לא רשמי - אם הוא נכשל, חוזרים אוטומטית להקראה הרגילה של ימות (t-).
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { createHash } from 'node:crypto';
import { hasDb, sql, ensureSchema } from './db.js';

const VOICE = process.env.VOICE_NAME || 'he-IL-AvriNeural'; // קול גבר. קול אישה: he-IL-HilaNeural
const FOLDER = process.env.VOICE_FOLDER || '/9876'; // תיקייה בימות לקבצי הקול
const DISABLED = process.env.VOICE_OFF === '1';

// אם השירות נכשל כמה פעמים ברצף - מפסיקים לנסות ל-10 דקות, כדי לא לעכב שיחות
const state = globalThis.__voiceState || (globalThis.__voiceState = { fails: 0, pauseUntil: 0 });
const memCache = globalThis.__voiceMem || (globalThis.__voiceMem = new Map());

// הקראה רגילה של ימות: בלי . - " ' & | = , בטקסט; כל משפט הודעה נפרדת
export function plainTts(text) {
  const parts = String(text)
    .replace(/[*#_`~>\[\]()]/g, ' ')
    .split(/[.!?\n:]+/)
    .map((s) => s.replace(/[.\-"'&|=,]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return parts.length ? parts.map((p) => 't-' + p).join('.') : 't-';
}

function digits(str, len) {
  const hex = createHash('sha1').update(String(str)).digest('hex').slice(0, 15);
  return (BigInt('0x' + hex) % 10n ** BigInt(len)).toString().padStart(len, '0');
}

function cleanForSpeech(text) {
  return String(text)
    .replace(/[*#_`~>\[\]]/g, ' ')
    .replace(/&/g, ' ו ')
    .replace(/</g, ' ')
    .replace(/>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthesize(text) {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 6000, synthesisTimeoutMs: 8000 });
  try {
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(cleanForSpeech(text));
    const chunks = [];
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('הקראה: חריגת זמן')), 12000);
      audioStream.on('data', (d) => chunks.push(Buffer.from(d)));
      audioStream.on('close', () => (clearTimeout(t), resolve()));
      audioStream.on('end', () => (clearTimeout(t), resolve()));
      audioStream.on('error', (e) => (clearTimeout(t), reject(e)));
    });
    const buf = Buffer.concat(chunks);
    if (buf.length < 500) throw new Error('הקראה: קובץ ריק');
    return buf;
  } finally {
    try {
      tts.close();
    } catch {}
  }
}

async function uploadToYemot(buf, name) {
  const form = new FormData();
  form.append('token', process.env.YEMOT_TOKEN);
  form.append('path', `ivr2:${FOLDER}/${name}.wav`);
  form.append('convertAudio', '1');
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), `${name}.mp3`);
  const res = await fetch('https://www.call2all.co.il/ym/api/UploadFile', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (data.responseStatus !== 'OK') throw new Error('העלאת קול נכשלה: ' + JSON.stringify(data).slice(0, 200));
}

async function ensureTable() {
  if (!hasDb) return;
  await ensureSchema();
  await sql`create table if not exists voice_cache (
    key text primary key, file text not null, created_at timestamptz not null default now())`;
}

/**
 * מחזיר הודעה לימות: f-<קובץ> בקול טבעי, או t-<טקסט> אם הקול הטבעי לא זמין.
 * cache=true: טקסט קבוע (תפריטים, מהדורה) - נוצר פעם אחת ונשמר.
 * name: שם קבוע לקובץ (למשל לתשובות בשיחה), כדי שלא יצטברו אלפי קבצים.
 */
export async function say(text, { cache = false, name } = {}) {
  text = String(text || '').trim();
  if (!text) return 't-';
  if (DISABLED || Date.now() < state.pauseUntil || !process.env.YEMOT_TOKEN) return plainTts(text);

  const key = `${VOICE}|${text}`;
  const fileName = name || digits(key, 10);
  const ref = `f-${FOLDER}/${fileName}`;

  if (cache) {
    if (memCache.get(key)) return memCache.get(key);
    if (hasDb) {
      try {
        await ensureTable();
        const [row] = await sql`select file from voice_cache where key = ${key}`;
        if (row) return memCache.set(key, row.file).get(key);
      } catch (e) {
        console.error('קול: מטמון', e.message);
      }
    }
  }

  try {
    const t = Date.now();
    const audio = await synthesize(text);
    await uploadToYemot(audio, fileName);
    state.fails = 0;
    console.log(`קול: ${text.length} תווים, ${Date.now() - t}ms -> ${ref}`);
    if (cache) {
      memCache.set(key, ref);
      if (hasDb) {
        await sql`insert into voice_cache (key, file) values (${key}, ${ref})
          on conflict (key) do update set file = excluded.file, created_at = now()`.catch(() => {});
      }
    }
    return ref;
  } catch (err) {
    state.fails++;
    if (state.fails >= 3) {
      state.pauseUntil = Date.now() + 10 * 60 * 1000;
      state.fails = 0;
      console.error('קול: 3 כישלונות ברצף - עובר להקראה של ימות ל-10 דקות');
    }
    console.error('קול: נכשל, משתמש בהקראה של ימות:', String(err?.message || err).slice(0, 200));
    return plainTts(text);
  }
}

// שם קובץ קבוע לכל שיחה (מתחלף בין שניים), כדי לא למלא את התיקייה
export function callFileName(callId, n) {
  return digits('call|' + callId, 9) + String(n % 2);
}
