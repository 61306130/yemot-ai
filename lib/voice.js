// קול טבעי: הופך טקסט לשמע בקול עברי של מיקרוסופט (דרך שירות ההקראה של דפדפן Edge),
// מעלה את הקובץ לימות ומחזיר הודעת f- להשמעה.
// זה שירות לא רשמי - אם הוא נכשל, חוזרים אוטומטית להקראה הרגילה של ימות (t-).
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { createHash } from 'node:crypto';
import { currentToken } from './systems.js';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { hasDb, sql, ensureSchema } from './db.js';
import { getSettings } from './store.js';
import { googleAuthHeaders, hasServiceAccount } from './gauth.js';
import { bg } from './bg.js';
import { reserveCredit, releaseCredit, creditOn, creditStatus, PRICE } from './credit.js';

const DEFAULT_VOICE = process.env.VOICE_NAME || 'he-IL-AvriNeural'; // קול גבר. אחרים: he-IL-HilaNeural (אישה), google (Google Translate)
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
      `&total=${parts.length}&idx=${i}&textlen=${q.length}&q=${encodeURIComponent(q)}`;
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
  return speedUp(Buffer.concat(bufs), rate);
}

// בחירת מנוע: גוגל, ואם נכשל - חזרה אוטומטית לקול של מיקרוסופט (אברי, גבר)
// האצת קובץ קול בלי לשנות את גובה הקול (ffmpeg atempo). אם נכשל - מחזירים את המקור.
async function speedUp(buf, rate) {
  if (!rate || !ffmpegPath) return buf;
  const factor = Math.max(0.7, Math.min(1.6, 1 + rate / 100)).toFixed(2);
  try {
    return await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-filter:a', `atempo=${factor}`, '-ac', '1', '-b:a', '48k', '-f', 'mp3', 'pipe:1']);
      const out = [];
      const t = setTimeout(() => (p.kill('SIGKILL'), reject(new Error('ffmpeg: חריגת זמן'))), 8000);
      p.stdout.on('data', (d) => out.push(d));
      p.stderr.on('data', () => {});
      p.on('error', (e) => (clearTimeout(t), reject(e)));
      p.on('close', (code) => {
        clearTimeout(t);
        const res = Buffer.concat(out);
        code === 0 && res.length > 500 ? resolve(res) : reject(new Error('ffmpeg: קוד ' + code));
      });
      p.stdin.on('error', () => {});
      p.stdin.end(buf);
    });
  } catch (e) {
    console.error('האצת קול נכשלה, משתמש בקובץ המקורי:', String(e?.message || e).slice(0, 150));
    return buf;
  }
}

// ---------- Google Cloud Text-to-Speech (קולות Chirp 3: HD) ----------
// מפתח אחד: GOOGLE_TTS_API_KEY (חשבון הניסיון).
// קודם 950 אלף תווים בחודש מתוך המכסה החינמית (מיליון), ואחר כך - רק כשקופת הקרדיט פעילה (lib/credit.js) -
// על חשבון הקרדיט, עם הגבול הקשיח המשותף. כשאין מקום - הקול של מיקרוסופט.
// כל הספירות במסד, בפעולה אטומית, *לפני* הפנייה לגוגל. בלי מסד - אין Chirp בכלל.
// חשבון שירות (GOOGLE_SERVICE_ACCOUNT) עדיף - יש פרויקטים שבהם Text-to-Speech לא מקבל מפתח API
const CLOUD_KEYS = [process.env.GOOGLE_TTS_API_KEY].map((k) => String(k || '').trim()).filter(Boolean);
if (!CLOUD_KEYS.length && hasServiceAccount) CLOUD_KEYS.push('');
const FREE_CHARS = 950000;
const isCloudVoice = (v) => /^[a-z]{2}-[A-Z]{2}-Chirp/.test(String(v || ''));
// החודש לפי שעון קליפורניה (כך גוגל סופרים חיוב)
const monthNow = () => new Date().toLocaleString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7);
// גוגל סופרים כל תו, כולל רווחים וניקוד. length של JS סופר כל סימן ניקוד וכל רווח, ואמוג'י כשניים - כלומר לא פחות מגוגל
const charsOf = (t) => String(t).length;

let ttsTableReady = null;
function usageTable() {
  return (ttsTableReady ||= sql`create table if not exists tts_usage (month text, idx int, chars bigint not null default 0, primary key (month, idx))`
    .catch((e) => { ttsTableReady = null; throw e; }));
}
// שמירת מקום לפני הקראה. מחזיר {free} או {paid} (כמה נשמר מהקופה), או null אם אין מקום
async function reserve(idx, n) {
  if (!hasDb) return null;
  try {
    await usageTable();
    const m = monthNow();
    await sql`insert into tts_usage (month, idx, chars) values (${m}, ${idx}, 0) on conflict do nothing`;
    const free = await sql`update tts_usage set chars = chars + ${n}
      where month = ${m} and idx = ${idx} and chars + ${n} <= ${FREE_CHARS} returning chars`;
    if (free.length) return { free: n };
    const paid = await reserveCredit(n * PRICE.ttsChar);
    if (!paid) return null;
    await sql`update tts_usage set chars = chars + ${n} where month = ${m} and idx = ${idx}`.catch(() => {});
    return { paid, n };
  } catch (e) {
    console.error('tts_usage:', e.message);
    return null; // לא הצלחנו לספור - לא מסתכנים
  }
}
// החזרה - רק כשגוגל החזירו שגיאה מפורשת (בקשה שנכשלה לא מחויבת)
function release(idx, r) {
  if (!r) return;
  const n = r.free || r.n || 0;
  sql`update tts_usage set chars = greatest(0, chars - ${n}) where month = ${monthNow()} and idx = ${idx}`.catch(() => {});
  if (r.paid) releaseCredit(r.paid);
}
async function usageNow() {
  if (!hasDb) return CLOUD_KEYS.map(() => FREE_CHARS);
  try {
    await usageTable();
    const rows = await sql`select idx, chars from tts_usage where month = ${monthNow()}`;
    return CLOUD_KEYS.map((_, i) => Number(rows.find((r) => r.idx === i)?.chars || 0));
  } catch {
    return CLOUD_KEYS.map(() => FREE_CHARS);
  }
}
// האם יש מקום לטקסט הזה (בלי לשמור - רק לבחירת קול). הבדיקה האמיתית היא ב-reserve
async function cloudHasRoom(n) {
  if (!CLOUD_KEYS.length || !hasDb) return false;
  if ((await usageNow()).some((c) => c + n <= FREE_CHARS)) return true;
  if (!creditOn) return false;
  const st = await creditStatus();
  return st.on && st.spentUsd + n * PRICE.ttsChar * 1.2 <= st.capUsd;
}
export async function cloudTtsUsage() {
  return { month: monthNow(), keys: CLOUD_KEYS.length, chars: CLOUD_KEYS.length ? await usageNow() : [], free: FREE_CHARS, credit: await creditStatus() };
}

class QuotaFull extends Error {}

async function cloudTts(text, voice, rate = 0) {
  if (!CLOUD_KEYS.length) throw new Error('חסר GOOGLE_TTS_API_KEY');
  text = String(text).slice(0, 4500);
  const n = charsOf(text);
  const call = async (key, withRate) =>
    fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', ...(await googleAuthHeaders(key)) },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voice.slice(0, 5), name: voice },
        audioConfig: { audioEncoding: 'MP3', ...(withRate && rate ? { speakingRate: Math.max(0.7, Math.min(1.6, 1 + rate / 100)) } : {}) },
      }),
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.audioContent) {
        const e = new Error(`Cloud TTS ${r.status}: ${String(d?.error?.message || '').slice(0, 160)}`);
        e.status = r.status;
        throw e;
      }
      return Buffer.from(d.audioContent, 'base64');
    });
  let lastErr = new QuotaFull('המכסה החודשית של Chirp נגמרה בכל המפתחות');
  for (let i = 0; i < CLOUD_KEYS.length; i++) {
    const r = await reserve(i, n);
    if (!r) continue; // אין מקום במפתח הזה - לא נוגעים בו
    try {
      return await call(CLOUD_KEYS[i], !!rate);
    } catch (e) {
      // שגיאה מפורשת מגוגל = לא חויב. שגיאת רשת / זמן - לא יודעים, אז לא מחזירים (צד בטוח)
      if (e.status) release(i, r);
      // אם הקול לא תומך בשינוי מהירות - מנסים פעם אחת בלי, ומאיצים בעצמנו
      let r2;
      if (rate && e.status === 400 && /speaking_?rate|speakingRate/i.test(String(e.message)) && (r2 = await reserve(i, n))) {
        try { return await speedUp(await call(CLOUD_KEYS[i], false), rate); } catch (e2) { if (e2.status) release(i, r2); lastErr = e2; continue; }
      }
      lastErr = e;
      if (![400, 401, 403, 429].includes(e.status)) throw e;
    }
  }
  throw lastErr;
}

// rate = שינוי מהירות באחוזים (0 = רגיל, 20 = מהר ב-20%)
async function synthesize(text, voice = DEFAULT_VOICE, rate = 0, opts = {}) {
  if (isCloudVoice(voice)) {
    try {
      return await cloudTts(text, voice, rate);
    } catch (e) {
      if (!(e instanceof QuotaFull)) {
        console.error('קול Chirp נכשל, עובר לאברי:', String(e?.message || e).slice(0, 200));
        import('./store.js').then((m) => m.logError('chirp-fail', `${voice} · ${String(text).length} תווים: ${String(e?.message || e).slice(0, 300)}`)).catch(() => {});
      }
      const buf = await edgeTts(text, FALLBACK_VOICE, rate, opts);
      buf.fallback = true; // לא שומרים במטמון, כדי שבפעם הבאה ינסה שוב את Chirp
      return buf;
    }
  }
  if (voice === GOOGLE_VOICE) {
    try {
      return await googleTts(text, rate);
    } catch (e) {
      console.error('קול גוגל נכשל, עובר לאברי:', String(e?.message || e).slice(0, 150));
      return edgeTts(text, FALLBACK_VOICE, rate, opts);
    }
  }
  return edgeTts(text, voice, rate, opts);
}
const rateOf = (cfg) => Math.max(-30, Math.min(60, Number(cfg?.['voice.rate']) || 0));

// לבדיקת קול באתר: מחזיר את השמע עצמו ואיזה מנוע באמת הקריא (כדי לדעת אם גוגל נפל לגיבוי)
export async function previewVoice(text, voice, rate = 0) {
  if (isCloudVoice(voice)) {
    try {
      return { audio: await cloudTts(text, voice, rate), engine: voice };
    } catch (e) {
      return { audio: await edgeTts(text, FALLBACK_VOICE, rate), engine: 'fallback', error: String(e?.message || e) };
    }
  }
  if (voice === GOOGLE_VOICE) {
    try {
      return { audio: await googleTts(text, rate), engine: 'google' };
    } catch (e) {
      return { audio: await edgeTts(text, FALLBACK_VOICE, rate), engine: 'fallback', error: String(e?.message || e) };
    }
  }
  return { audio: await edgeTts(text, voice, rate), engine: voice };
}

// long=true: הקראה ברקע (לא בזמן שמתקשר מחכה) - מותר לה לקחת יותר זמן
async function edgeTts(text, voice = DEFAULT_VOICE, rate = 0, { long = false } = {}) {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: long ? 10000 : 6000, synthesisTimeoutMs: long ? 40000 : 8000 });
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(cleanForSpeech(text), rate ? { rate: `${rate > 0 ? '+' : ''}${rate}%` } : undefined);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('הקראה: חריגת זמן')), long ? 45000 : 12000);
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
export async function speakToPath(text, path, token) {
  const cfg = await getSettings().catch(() => ({}));
  // הודעות תפריט ארוכות - מותר לקחת יותר זמן (לא מתקשר שמחכה)
  const audio = await synthesize(text, cfg['voice.name'] || DEFAULT_VOICE, rateOf(cfg), { long: true });
  const clean = path.replace(/^ivr2:/, '').replace(/\.wav$/, '');
  return uploadToYemot(audio, null, `ivr2:${clean.startsWith('/') ? clean : '/' + clean}.wav`, token || currentToken() || process.env.YEMOT_TOKEN);
}

// רישום כל קובץ שהועלה, כדי שהניקוי האוטומטי יידע מה חדש ואסור למחוק
function trackFile(name, tok) {
  if (!hasDb) return;
  const sys = String(tok || '').split(':')[0];
  ensureTable()
    .then(() => sql`insert into voice_files (name, sys) values (${String(name)}, ${sys})
      on conflict (name, sys) do update set created_at = now()`)
    .catch(() => {});
}
export const VOICE_FOLDER = FOLDER;

let tableReady = null;
function ensureTable() {
  if (!hasDb) return Promise.resolve();
  return (tableReady ||= createTables().catch((e) => ((tableReady = null), Promise.reject(e))));
}
async function createTables() {
  await ensureSchema();
  await sql`create table if not exists voice_cache (
    key text primary key, file text not null, created_at timestamptz not null default now())`;
  await sql`create table if not exists voice_files (
    name text not null, sys text not null, created_at timestamptz not null default now(), primary key (name, sys))`;
}

/**
 * מחזיר הודעה לימות: f-<קובץ> בקול טבעי, או t-<טקסט> אם הקול הטבעי לא זמין.
 * cache=true: טקסט קבוע (תפריטים, מהדורה) - נוצר פעם אחת ונשמר.
 * name: שם קבוע לקובץ (למשל לתשובות בשיחה), כדי שלא יצטברו אלפי קבצים.
 */
// voice: קול מסוים להודעה הזו (למשל קול באנגלית בתרגומון). ברירת מחדל: הקול שנבחר באתר
// background=true (רק עם cache): אם ההודעה עוד לא מוקלטת - עונים מיד בהקראה של ימות,
// ומקליטים ברקע אחרי התשובה. כך מתקשר אף פעם לא מחכה להקלטה, והבא בתור כבר שומע את הקול הטבעי.
const pendingBg = globalThis.__voiceBg || (globalThis.__voiceBg = new Set());
export async function say(text, { cache = false, name, token, voice, background = false, long = false } = {}) {
  // token: טוקן של מערכת ימות אחרת (למשל מערכת ההצבעה). ברירת מחדל: המערכת הראשית
  const tok = token || currentToken() || process.env.YEMOT_TOKEN;
  text = String(text || '').trim();
  if (!text) return 't-';
  const cfg = await getSettings().catch(() => ({}));
  let VOICE = voice || cfg['voice.name'] || DEFAULT_VOICE;
  if (DISABLED || cfg['voice.enabled'] === false || Date.now() < state.pauseUntil || !tok) return plainTts(text);

  const RATE = rateOf(cfg);
  // Chirp שהמכסה החודשית שלו נגמרה - הקול של מיקרוסופט (ונשמר במטמון כאברי, לא כ-Chirp)
  if (isCloudVoice(VOICE) && !(await cloudHasRoom(charsOf(text)))) VOICE = FALLBACK_VOICE;
  const key = `${VOICE}|${RATE ? RATE + '|' : ''}${text}` + (tok !== process.env.YEMOT_TOKEN ? `|${digits(tok, 6)}` : '');
  // ימות משמיע רק קבצים עם שם מספרי - שם עם אותיות הופך למספר קבוע
  const fileName = name ? (/^\d+$/.test(name) ? name : digits(name, 10)) : digits(key, 10);
  const ref = `f-${FOLDER}/${fileName}`;

  if (cache) {
    if (memCache.get(key)) return memCache.get(key);
    if (hasDb) {
      try {
        await ensureTable();
        // תקרת זמן: אם המסד תקוע - ממשיכים בלי מטמון במקום לתקוע את השיחה
        const [row] = await Promise.race([
          sql`select file from voice_cache where key = ${key}`,
          new Promise((_, rej) => setTimeout(() => rej(new Error('מטמון: חריגת זמן')), 3000)),
        ]);
        if (row && /^f-[^ ]*\/\d+$/.test(row.file)) return memCache.set(key, row.file).get(key); // שמות ישנים עם אותיות - נוצרים מחדש
      } catch (e) {
        console.error('קול: מטמון', e.message);
      }
    }
  }

  if (background && cache) {
    if (!pendingBg.has(key)) {
      pendingBg.add(key);
      const job = () =>
        generate(text, VOICE, RATE, fileName, tok, key, ref, cache, true)
          .catch((e) => console.error('קול ברקע נכשל:', String(e?.message || e).slice(0, 200)))
          .finally(() => pendingBg.delete(key));
      bg(job);
    }
    return plainTts(text);
  }

  try {
    return await generate(text, VOICE, RATE, fileName, tok, key, ref, cache, long);
  } catch (err) {
    state.fails++;
    if (state.fails >= 3) {
      state.pauseUntil = Date.now() + 2 * 60 * 1000;
      import('./store.js').then((m) => m.logError('voice-pause', 'קול: 3 כישלונות ברצף - הקראה של ימות ל-2 דקות')).catch(() => {});
      state.fails = 0;
      console.error('קול: 3 כישלונות ברצף - עובר להקראה של ימות ל-10 דקות');
    }
    console.error('קול: נכשל, משתמש בהקראה של ימות:', String(err?.message || err).slice(0, 200));
    import('./store.js').then((m) => m.logError('voice-fail', `${VOICE}: ${String(err?.message || err).slice(0, 300)}`)).catch(() => {});
    return plainTts(text);
  }
}

async function generate(text, VOICE, RATE, fileName, tok, key, ref, cache, long) {
  {
    const t = Date.now();
    const audio = await synthesize(text, VOICE, RATE, { long });
    await uploadToYemot(audio, fileName, undefined, tok);
    state.fails = 0;
    console.log(`קול: ${text.length} תווים, ${Date.now() - t}ms -> ${ref}`);
    trackFile(fileName, tok);
    if (cache && !audio.fallback) {
      memCache.set(key, ref);
      if (hasDb) {
        await sql`insert into voice_cache (key, file) values (${key}, ${ref})
          on conflict (key) do update set file = excluded.file, created_at = now()`.catch(() => {});
      }
    }
    return ref;
  }
}

// שם קובץ קבוע לכל שיחה (מתחלף בין שניים), כדי לא למלא את התיקייה
export function callFileName(callId, n) {
  return digits('call|' + callId, 9) + String(n % 2);
}

// בדיקה: הקראה קצרה ב-Chirp (נספרת במכסה כרגיל) + מצב המכסה
export async function testCloudTts(voice = 'he-IL-Chirp3-HD-Charon') {
  const t = Date.now();
  try {
    const buf = await cloudTts('שלום, כאן בוטי.', voice, 0);
    return { ok: true, bytes: buf.length, ms: Date.now() - t, usage: await cloudTtsUsage() };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 300), keys: CLOUD_KEYS.length, usage: await cloudTtsUsage().catch(() => null) };
  }
}
