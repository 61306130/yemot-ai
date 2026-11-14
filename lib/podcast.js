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

// התוכנית מחולקת לכמה קבצים נפרדים - כל אחד מתחת למגבלת ה-50MB של ימות.
// שלוחת השמעת קבצים מנגנת אותם ברצף מהגבוה לנמוך, כך שהמאזין שומע תוכנית אחת רציפה.
const MAX_PART = 45 * 1024 * 1024;
const MIN_PARTS = 3; // תמיד לפחות 3 קבצים, כדי שלא יישארו חלקים ישנים מתוכנית קודמת

async function uploadToYemot(url, log) {
  const token = process.env.YEMOT_TOKEN;

  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
  const total = Number(head.headers.get('content-length'));
  if (!head.ok || !total) throw new Error(`לא ניתן לקבל את גודל הקובץ (${head.status})`);
  const parts = Math.max(MIN_PARTS, Math.ceil(total / MAX_PART));
  const partSize = Math.ceil(total / parts);
  log(`גודל ${(total / 1048576).toFixed(1)}MB, ${parts} קבצים של כ-${(partSize / 1048576).toFixed(1)}MB`);

  const res = await fetch(url, { signal: AbortSignal.timeout(280000) });
  if (!res.ok) throw new Error(`הורדה נכשלה (${res.status})`);
  const reader = res.body.getReader();
  let buffered = [];
  let bufLen = 0;
  let index = 0;

  const sendPart = async (buf) => {
    // ימות מנגנת מהקובץ הגבוה לנמוך, לכן החלק הראשון מקבל את המספר הגבוה (002, 001, 000)
    const name = String(parts - 1 - index).padStart(3, '0');
    const form = new FormData();
    form.append('token', token);
    form.append('path', `ivr2:/${EXT}/${name}.wav`);
    form.append('convertAudio', '1');
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), `${name}.mp3`);
    const t = Date.now();
    const r = await yemotPost('UploadFile', form);
    log(`חלק ${index + 1} (קובץ ${name}) הועלה (${Math.round((Date.now() - t) / 1000)} שנ'): ${JSON.stringify(r).slice(0, 160)}`);
    index++;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buffered.push(value);
      bufLen += value.length;
    }
    while (bufLen >= partSize || (done && bufLen > 0)) {
      const all = Buffer.concat(buffered);
      const part = all.subarray(0, Math.min(partSize, all.length));
      const rest = all.subarray(part.length);
      buffered = rest.length ? [rest] : [];
      bufLen = rest.length;
      await sendPart(part);
    }
    if (done) break;
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
    const bytes = await uploadToYemot(ep.url, log);
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
