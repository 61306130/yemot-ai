// ניקוי אוטומטי (רץ פעם ביום מ-Vercel Cron, ואפשר גם מהאתר):
// 1. קבצי קול ישנים בתיקיית הקול בימות (בכל מערכת שהמערכת מעלה אליה)
// 2. תמלולים: נשארות 30 השיחות האחרונות של כל מתקשר, הישנות יותר נמחקות
// 3. נתונים זמניים: מצבי שיחה, יומן שגיאות ישן, מטמון קול ישן
import { sql, hasDb, ensureSchema } from './db.js';
import { VOICE_FOLDER } from './voice.js';
import { setSettings } from './store.js';

const API = 'https://www.call2all.co.il/ym/api/';
export const KEEP_CALLS_PER_CALLER = 30;
const KEEP_FILES_DAYS = 2; // קובץ קול שהועלה ביומיים האחרונים לא נמחק (אולי שיחה פעילה)
const CACHE_DAYS = 30; // הודעות קבועות שלא נוצרו מחדש 30 יום - נמחקות ונוצרות שוב כשצריך

async function yemot(cmd, params) {
  const res = await fetch(API + cmd + '?' + new URLSearchParams(params), { signal: AbortSignal.timeout(30000) });
  const data = await res.json().catch(() => ({}));
  if (data.responseStatus && data.responseStatus !== 'OK') throw new Error(`${cmd}: ${data.message || data.exceptionMessage || data.responseStatus}`);
  return data;
}

async function cleanYemotFolder(token, keep, deadline) {
  const sys = token.split(':')[0];
  const dir = await yemot('GetIVR2Dir', { token, path: `ivr2:${VOICE_FOLDER}`, filesLimit: '5000' });
  const files = (dir.files || [])
    .map((f) => String(f.name || ''))
    .filter((n) => /^\d+\.(wav|mp3)$/i.test(n)); // רק קבצים שהמערכת יצרה (שם מספרי)
  const doomed = files.filter((n) => !keep.has(n.replace(/\.\w+$/, '')));
  let deleted = 0;
  for (let i = 0; i < doomed.length && Date.now() < deadline; i += 80) {
    const batch = doomed.slice(i, i + 80);
    const params = { token, action: 'delete' };
    batch.forEach((n, j) => (params[`what${j}`] = `ivr2:${VOICE_FOLDER}/${n}`));
    await yemot('FileAction', params);
    deleted += batch.length;
  }
  return { system: sys, files: files.length, deleted, left: doomed.length - deleted };
}

export async function runCleanup() {
  const started = Date.now();
  const deadline = started + 200_000;
  const report = { at: new Date().toISOString(), db: {}, yemot: [] };
  if (!hasDb) return { ...report, error: 'אין מסד נתונים' };
  await ensureSchema();

  // ---- תמלולים: שומרים את 30 השיחות האחרונות של כל מתקשר ----
  const old = await sql`
    select id from (
      select id, row_number() over (partition by phone order by started_at desc) as rn from calls
    ) t where rn > ${KEEP_CALLS_PER_CALLER}`;
  if (old.length) {
    const ids = old.map((r) => r.id);
    const m = await sql`delete from messages where call_id in ${sql(ids)}`;
    const c = await sql`delete from calls where id in ${sql(ids)}`;
    report.db.messages = m.count;
    report.db.calls = c.count;
  } else {
    report.db.messages = 0;
    report.db.calls = 0;
  }

  // ---- נתונים זמניים ----
  const q = async (name, query) => {
    try { report.db[name] = (await query).count; } catch { report.db[name] = 'לא קיים'; }
  };
  await q('ivr_state', sql`delete from ivr_state where updated_at < now() - interval '2 days'`);
  await q('error_log', sql`delete from error_log where created_at < now() - interval '30 days'`);
  await q('voice_cache', sql`delete from voice_cache where created_at < now() - make_interval(days => ${CACHE_DAYS})`);
  await q('voice_files', sql`delete from voice_files where created_at < now() - interval '14 days'`);

  // ---- קבצי קול בימות ----
  let cacheRows = [], recentRows = [];
  try { cacheRows = await sql`select file from voice_cache`; } catch {}
  try { recentRows = await sql`select name from voice_files where created_at > now() - make_interval(days => ${KEEP_FILES_DAYS})`; } catch {}
  const keep = new Set([
    ...cacheRows.map((r) => String(r.file).split('/').pop()),
    ...recentRows.map((r) => String(r.name)),
  ]);
  const tokens = [...new Set([process.env.YEMOT_TOKEN, process.env.VOTE_YEMOT_TOKEN].filter(Boolean))];
  for (const token of tokens) {
    try {
      report.yemot.push(await cleanYemotFolder(token, keep, deadline));
    } catch (e) {
      report.yemot.push({ system: token.split(':')[0], error: String(e?.message || e).slice(0, 200) });
    }
  }

  report.seconds = Math.round((Date.now() - started) / 1000);
  await setSettings({ 'cleanup.last': report }).catch(() => {});
  return report;
}
