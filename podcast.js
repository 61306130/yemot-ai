// שלוחת הפודקאסט: מוצא את "התוכנית המלאה" האחרונה של ינון ובן ב-103FM
// ומעלה אותה לשלוחה בימות המשיח (כמה קבצים, כי ימות מגבילה ל-50MB לקובץ).
import { hasDb, sql, ensureSchema } from './db.js';

const RSS_URL = 'https://103fm.maariv.co.il/rss/mediarss.aspx?programId=262';
const YEMOT_API = 'https://www.call2all.co.il/ym/api/';
const EXT = process.env.PODCAST_EXT || '2'; // מספר השלוחה בימות

// ---------- מציאת הפרק האחרון ----------
export async function findLatestEpisode() {
  const res = await fetch(RSS_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  const xml = await res.text();
  for (const item of xml.split('<item>').slice(1)) {
    const title = clean(item.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    if (!/התוכנית המלאה/.test(title)) continue;
    const url = item.match(/<enclosure[^>]*url="([^"]+)"/)?.[1];
    if (!url) continue;
    const pubDate = clean(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]);
    return { title, url, pubDate };
  }
  throw new Error('לא נמצאה "התוכנית המלאה" בפיד');
}

function clean(s = '') {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
}

// ---------- רישום במסד הנתונים ----------
async function ensurePodcastTable() {
  if (!hasDb) return;
  await ensureSchema();
  await sql`
    create table if not exists podcast_log (
      id bigserial primary key,
      title text, url text, status text, message text,
      bytes bigint, seconds int,
      started_at timestamptz not null default now(),
      finished_at timestamptz
    )`;
}

async function alreadyUploaded(url) {
  if (!hasDb) return false;
  const rows = await sql`select 1 from podcast_log where url = ${url} and status = 'ok' limit 1`;
  return rows.length > 0;
}

// ---------- העלאה לימות ----------
async function yemotPost(endpoint, form) {
  const res = await fetch(YEMOT_API + endpoint, {
    method: 'POST',
    ...(form ? { body: form } : {}),
    signal: AbortSignal.timeout(240000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`ימות החזירה תשובה לא צפויה (${res.status}): ${text.slice(0, 200)}`);
  }
  if (data.responseStatus && data.responseStatus !== 'OK') {
    throw new Error(`ימות: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

// כל תוכנית מתווספת לשלוחה (ארכיון), בלי למחוק את הקודמות.
// ימות מנגנת מהקובץ הגבוה לנמוך, לכן מעלים בסדר הפוך עם מספור אוטומטי:
// קודם החלק האחרון, אחריו האמצעי, אחריו הראשון, ובסוף הודעת הפתיחה עם התאריך.
// כך כל תוכנית מקבלת מספרים גבוהים מהקודמת, ומתנגנת מההתחלה לסוף, והחדשה ביותר ראשונה.
const MAX_PART = 45 * 1024 * 1024; // ימות מגבילה ל-50MB לקובץ

async function uploadToYemot(url, log, ep) {
  const token = process.env.YEMOT_TOKEN;
  const folder = `ivr2:/${EXT}/`;

  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`הורדה נכשלה (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  const total = data.length;
  const parts = Math.max(1, Math.ceil(total / MAX_PART));
  const partSize = Math.ceil(total / parts);
  log(`הורד: ${(total / 1048576).toFixed(1)}MB, ${parts} חלקים`);

  for (let i = parts - 1; i >= 0; i--) {
    const buf = data.subarray(i * partSize, Math.min(total, (i + 1) * partSize));
    const form = new FormData();
    form.append('token', token);
    form.append('path', folder);
    form.append('autoNumbering', 'true');
    form.append('convertAudio', '1');
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), `part${i + 1}.mp3`);
    const t = Date.now();
    const r = await yemotPost('UploadFile', form);
    log(`חלק ${i + 1} הועלה (${Math.round((Date.now() - t) / 1000)} שנ'): ${r.path || ''}`);
  }

  // הודעת פתיחה (הקראה) - הקובץ הגבוה ביותר, כך שתושמע לפני התוכנית
  try {
    const date = (ep.title.match(/\d{1,2}\.\d{1,2}\.\d{2,4}/) || [''])[0];
    const text = `ינון ובן. התוכנית המלאה מתאריך ${date.replace(/\./g, ' ')}`;
    const form = new FormData();
    form.append('token', token);
    form.append('path', folder);
    form.append('autoNumbering', 'true');
    form.append('tts', '1');
    form.append('file', new Blob([text], { type: 'text/plain' }), 'intro.tts');
    const r = await yemotPost('UploadFile', form);
    log(`הודעת פתיחה הועלתה: ${r.path || ''}`);
  } catch (e) {
    log('הודעת הפתיחה לא הועלתה (לא קריטי): ' + String(e.message).slice(0, 150));
  }
  return total;
}

// ---------- הפעולה הראשית ----------
export async function runPodcast({ force = false } = {}) {
  const lines = [];
  const log = (m) => {
    console.log('פודקאסט:', m);
    lines.push(m);
  };
  const started = Date.now();
  await ensurePodcastTable();

  const ep = await findLatestEpisode();
  log(`נמצא: ${ep.title}`);

  if (!force && (await alreadyUploaded(ep.url))) {
    log('הפרק הזה כבר הועלה, אין מה לעשות');
    return { status: 'skip', episode: ep, log: lines };
  }

  let id;
  if (hasDb) {
    [{ id }] = await sql`
      insert into podcast_log (title, url, status) values (${ep.title}, ${ep.url}, 'running')
      returning id`;
  }
  try {
    const bytes = await uploadToYemot(ep.url, log, ep);
    const seconds = Math.round((Date.now() - started) / 1000);
    log(`הועלה בהצלחה תוך ${seconds} שניות`);
    if (hasDb) {
      await sql`update podcast_log set status='ok', bytes=${bytes}, seconds=${seconds},
        message=${lines.join('\n')}, finished_at=now() where id=${id}`;
    }
    return { status: 'ok', episode: ep, log: lines };
  } catch (err) {
    log('שגיאה: ' + (err?.message || err));
    if (hasDb) {
      await sql`update podcast_log set status='error', message=${lines.join('\n')},
        finished_at=now() where id=${id}`;
    }
    return { status: 'error', episode: ep, log: lines };
  }
}
