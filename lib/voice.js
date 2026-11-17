// קול טבעי: הופך טקסט לשמע בקול עברי של מיקרוסופט (דרך שירות ההקראה של דפדפן Edge),
// מעלה את הקובץ לימות ומחזיר הודעת f- להשמעה.
// זה שירות לא רשמי - אם הוא נכשל, חוזרים אוטומטית להקראה הרגילה של ימות (t-).
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { createHash } from 'node:crypto';
import { hasDb, sql, ensureSchema } from './db.js';
import { getSettings } from './store.js';

const DEFAULT_VOICE = process.env.VOICE_NAME || 'google'; // google = הקול של Google Translate. אחרים: he-IL-AvriNeural (גבר), he-IL-HilaNeural (אישה)
const FALLBACK_VOICE = 'he-IL-AvriNeural'; // קול גיבוי כשגוגל לא עובד
const FOLDER = process.env.VOICE_FOLDER || '/9876'; // תיקייה בימות לקבצי הקול
const DISABLED = process.env.VOICE_OFF === '1';

// אם השירות נכשל כמה פעמים ברצף - מפסיקים לנסות ל-10 דקות, כדי לא לעכב שיחות
const state = globalThis.__voiceState || (globalThis.__voiceState = { fails: 0, pauseUntil: 0 });
const memCache = globalThis.__voiceMem || (globalThis.__voiceMem = new Map());

// הקראה רגילה של ימות: בלי . - " ' & | = , בטקסט; כל משפט הודעה נפרדת
export function plainTts(text) {
  const parts = String(text)
    .replace(/[\u0591-\u05C7]/g, '') // בלי ניקוד - ההקראה של ימות לא בנויה לזה
    .replace(/(\d{1,2}):(\d{2})/g, '$1 $2') // שעות: 14:30 -> 14 30
    .replace(/(\d)\.(\d)/g, '$1 נקודה $2')
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

// ---------- הקול של Google Translate ----------
// שירות לא רשמי (כמו בספרייה הפתוחה gTTS): חינם, בלי מפתח. מגבלה של כ-200 תווים לבקשה,
// לכן מחלקים את הטקסט לחלקים ומחברים את קובצי ה-MP3.
export const GOOGLE_VOICE = 'google';

function splitForGoogle(text, max = 190) {
  const out = [];
  const sentences = String(text).split(/(?<=[.!?,:;])\s+/);
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const sen of sentences) {
    if ((cur + ' ' + sen).trim().length <= max) { cur = (cur + ' ' + sen).trim(); continue; }
    push();
    if (sen.length <= max) { cur = sen; continue; }
    for (const w of sen.split(/\s+/)) {
      if ((cur + ' ' + w).trim().length > max) push();
      cur = (cur + ' ' + w).trim();
    }
  }
  push();
  return out;
}

async function googleTts(text, rate = 0) {
  const parts = splitForGoogle(cleanForSpeech(text));
  if (!parts.length) throw new Error('גוגל: טקסט ריק');
  const fetchPart = async (q, i) => {
    const url =
      'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=iw' +
      `&total=${parts.length}&idx=${i}&textlen=${q.length}&ttsspeed=${(1 + rate / 100).toFixed(2)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Referer: 'https://translate.google.com/' },
      signal: AbortSignal.timeout(8000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 200 || !(res.headers.get('content-type') || '').includes('audio')) {
      throw new Error(`גוגל: ${res.status}`);
    }
    return buf;
  };
  // עד 4 בקשות במקביל, ושמירה על הסדר
  const bufs = new Array(parts.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, parts.length) }, async () => {
      while (next < parts.length) {
        const i = next++;
        bufs[i] = await fetchPart(parts[i], i);
      }
    })
  );
  return Buffer.concat(bufs);
}

// בחירת מנוע: גוגל, ואם נכשל - חזרה אוטומטית לקול של מיקרוסופט (אברי, גבר)
// rate = שינוי מהירות באחוזים (0 = רגיל, 20 = מהר ב-20%)
async function synthesize(text, voice = DEFAULT_VOICE, rate = 0) {
  if (voice === GOOGLE_VOICE) {
    try {
      return await googleTts(text, rate);
    } catch (e) {
      console.error('קול גוגל נכשל, עובר לאברי:', String(e?.message || e).slice(0, 150));
      return edgeTts(text, FALLBACK_VOICE, rate);
    }
  }
  return edgeTts(text, voice, rate);
}
const rateOf = (cfg) => Math.max(-30, Math.min(60, Number(cfg?.['voice.rate']) || 0));

// לבדיקת קול באתר: מחזיר את השמע עצמו ואיזה מנוע באמת הקריא (כדי לדעת אם גוגל נפל לגיבוי)
export async function previewVoice(text, voice, rate = 0) {
  if (voice === GOOGLE_VOICE) {
    try {
      return { audio: await googleTts(text, rate), engine: 'google' };
    } catch (e) {
      return { audio: await edgeTts(text, FALLBACK_VOICE, rate), engine: 'fallback', error: String(e?.message || e) };
    }
  }
  return { audio: await edgeTts(text, voice, rate), engine: voice };
}

async function edgeTts(text, voice = DEFAULT_VOICE, rate = 0) {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 6000, synthesisTimeoutMs: 8000 });
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(cleanForSpeech(text), rate ? { rate: `${rate > 0 ? '+' : ''}${rate}%` } : undefined);
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

async function uploadToYemot(buf, name, fullPath, token = process.env.YEMOT_TOKEN) {
  const form = new FormData();
  form.append('token', token);
  form.append('path', fullPath || `ivr2:${FOLDER}/${name}.wav`);
  form.append('convertAudio', '1');
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), `${name}.mp3`);
  const res = await fetch('https://www.call2all.co.il/ym/api/UploadFile', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (data.responseStatus !== 'OK') throw new Error('העלאת קול נכשלה: ' + JSON.stringify(data).slice(0, 200));
  return data;
}

// יצירת קובץ קול ושמירתו בנתיב מסוים בימות (למשל הודעת תפריט: /M1000)
export async function speakToPath(text, path) {
  const cfg = await getSettings().catch(() => ({}));
  const audio = await synthesize(text, cfg['voice.name'] || DEFAULT_VOICE, rateOf(cfg));
  const clean = path.replace(/^ivr2:/, '').replace(/\.wav$/, '');
  return uploadToYemot(audio, null, `ivr2:${clean.startsWith('/') ? clean : '/' + clean}.wav`);
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
export async function say(text, { cache = false, name, token } = {}) {
  // token: טוקן של מערכת ימות אחרת (למשל מערכת ההצבעה). ברירת מחדל: המערכת הראשית
  const tok = token || process.env.YEMOT_TOKEN;
  text = String(text || '').trim();
  if (!text) return 't-';
  const cfg = await getSettings().catch(() => ({}));
  const VOICE = cfg['voice.name'] || DEFAULT_VOICE;
  if (DISABLED || cfg['voice.enabled'] === false || Date.now() < state.pauseUntil || !tok) return plainTts(text);

  const RATE = rateOf(cfg);
  const key = `${VOICE}|${RATE ? RATE + '|' : ''}${text}` + (token ? `|${digits(token, 6)}` : '');
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
    const audio = await synthesize(text, VOICE, RATE);
    await uploadToYemot(audio, fileName, undefined, tok);
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
