// שלוחת הפודקאסט: מוצא את "התוכנית המלאה" האחרונה של ינון ובן ב-103FM
// ומעלה אותה לשלוחה בימות המשיח (בחלקים, כי ימות מגבילה ל-50MB בהעלאה אחת).
import { randomUUID } from 'node:crypto';
import { hasDb, sql, ensureSchema } from './db.js';

const RSS_URL = 'https://103fm.maariv.co.il/rss/mediarss.aspx?programId=262';
const YEMOT_API = 'https://www.call2all.co.il/ym/api/';
const EXT = process.env.PODCAST_EXT || '2'; // מספר השלוחה בימות
const CHUNK = 20 * 1024 * 1024; // 20MB לכל חלק

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
    body: form,
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

async function uploadToYemot(url, log) {
  const token = process.env.YEMOT_TOKEN;
  const path = `ivr2:/${EXT}/000.wav`;
  const filename = 'yinon-ben.mp3';

  // גודל הקובץ
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
  const total = Number(head.headers.get('content-length'));
  if (!head.ok || !total) throw new Error(`לא ניתן לקבל את גודל הקובץ (${head.status})`);
  const parts = Math.ceil(total / CHUNK);
  const uuid = randomUUID();
  log(`גודל ${(total / 1048576).toFixed(1)}MB, ${parts} חלקים`);

  // הורדה בזרימה, והעלאה כל 20MB
  const res = await fetch(url, { signal: AbortSignal.timeout(280000) });
  if (!res.ok) throw new Error(`הורדה נכשלה (${res.status})`);
  const reader = res.body.getReader();
  let buffered = [];
  let bufLen = 0;
  let offset = 0;
  let index = 0;

  const sendPart = async (buf) => {
    const form = new FormData();
    form.append('token', token);
    form.append('path', path);
    form.append('convertAudio', '1');
    form.append('qquuid', uuid);
    form.append('qqpartindex', String(index));
    form.append('qqpartbyteoffset', String(offset));
    form.append('qqchunksize', String(buf.length));
    form.append('qqtotalparts', String(parts));
    form.append('qqtotalfilesize', String(total));
    form.append('qqfilename', filename);
    form.append('uploader', 'yemot-admin');
    form.append('qqfile', new Blob([buf], { type: 'audio/mpeg' }), filename);
    await yemotPost('UploadFile', form);
    log(`חלק ${index + 1}/${parts} הועלה`);
    offset += buf.length;
    index++;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buffered.push(value);
      bufLen += value.length;
    }
    while (bufLen >= CHUNK || (done && bufLen > 0)) {
      const all = Buffer.concat(buffered);
      const part = all.subarray(0, Math.min(CHUNK, all.length));
      const rest = all.subarray(part.length);
      buffered = rest.length ? [rest] : [];
      bufLen = rest.length;
      await sendPart(part);
    }
    if (done) break;
  }

  // סיום: ימות מחברת את החלקים וממירה לפורמט טלפוני
  const form = new FormData();
  form.append('token', token);
  form.append('path', path);
  form.append('convertAudio', '1');
  form.append('qquuid', uuid);
  form.append('qqfilename', filename);
  form.append('qqtotalfilesize', String(total));
  form.append('qqtotalparts', String(parts));
  const result = await yemotPost('UploadFile?done', form);
  log(`הסתיים: ${JSON.stringify(result).slice(0, 200)}`);
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
