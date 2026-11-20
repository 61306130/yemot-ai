// מערכות ימות של משתמשים שהקימו אצלנו את השירותים (שלוחת "פתיחת מערכת").
// כל בקשה מימות מזוהה לפי מפתח סודי (k) שנשמר בהגדרות השלוחות של המערכת,
// וכל קבצי הקול וההקלטות עוברים דרך הטוקן של אותה מערכת.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { sql, hasDb, ensureSchema } from './db.js';

const als = globalThis.__systemAls || (globalThis.__systemAls = new AsyncLocalStorage());

// הטוקן של המערכת שממנה הגיעה הבקשה הנוכחית (או null = המערכת הראשית)
export function currentToken() {
  return als.getStore()?.token || null;
}
export function currentSystem() {
  return als.getStore() || null;
}
// לקרוא בתוך ה-handler עצמו (לא בתוך פונקציה עטופה) - כך ההקשר נשמר לכל ההמשך של הבקשה
export function enterSystem(ctx) {
  als.enterWith(ctx || {});
}

let ready = null;
function ensure() {
  if (!hasDb) return Promise.resolve();
  return (ready ||= (async () => {
    await ensureSchema();
    await sql`
      create table if not exists systems (
        did text primary key,
        password text not null,
        key text unique not null,
        owner_phone text,
        owner_name text,
        status text not null default 'active',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        last_seen timestamptz,
        calls int not null default 0,
        last_error text
      )`;
  })().catch((e) => ((ready = null), Promise.reject(e))));
}

// מזהה את המערכת לפי k. מחזיר הקשר לבקשה, או { denied: 'הודעה' } אם המערכת מושבתת/לא מוכרת
export async function resolveSystem(p) {
  const k = String(p?.k || '').trim();
  if (!k || !hasDb) return {};
  await ensure();
  const [s] = await sql`select did, password, status from systems where key = ${k}`;
  if (!s) return { denied: 'המערכת הזו אינה רשומה בשירות. אפשר להקים אותה מחדש דרך שלוחת פתיחת המערכת.' };
  if (s.status !== 'active') return { denied: 'השירות במערכת הזו מושבת כרגע.' };
  // שיחה חדשה = בקשה בלי תשובות קודמות
  const fresh = !Object.keys(p).some((key) => /^[a-z]{1,3}\d+$/i.test(key));
  sql`update systems set last_seen = now(), calls = calls + ${fresh ? 1 : 0} where did = ${s.did}`.catch(() => {});
  return { did: s.did, token: `${s.did}:${s.password}` };
}

const API = 'https://www.call2all.co.il/ym/api/';
async function yemot(cmd, params, method = 'GET') {
  const body = new URLSearchParams(params);
  const res = await fetch(method === 'POST' ? API + cmd : `${API}${cmd}?${body}`, {
    method,
    ...(method === 'POST' ? { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return res.json().catch(() => ({}));
}

// בדיקה שמספר המערכת והסיסמה נכונים
export async function checkLogin(did, password) {
  const r = await yemot('Login', { username: did, password });
  return r.responseStatus === 'OK';
}

async function writeFile(token, what, contents) {
  const r = await yemot('UploadTextFile', { token, what, contents }, 'POST');
  if (r.responseStatus !== 'OK') throw new Error(`כתיבת ${what} נכשלה: ${r.message || r.responseStatus || 'אין תשובה'}`);
}

export const SERVICES = [
  { ext: 1, title: 'העוזר החכם', route: 'yemot' },
  { ext: 2, title: 'מהדורת חדשות', route: 'news' },
  { ext: 3, title: 'בוט התחבורה', route: 'transit' },
  { ext: 4, title: 'התרגומון', route: 'translate' },
];

export const SYSTEM_MENU_TEXT =
  'שלום וברוכים הבאים! לעוזר החכם, הקישו אחת. למהדורת חדשות עדכנית, הקישו שתיים. ' +
  'לבוט התחבורה החכם, הקישו שלוש. לתרגומון החכם, הקישו ארבע. ' +
  'המערכת הוקמה באמצעות שש, אחת, שלוש, אפס. מערכות טלפוניה.';

// הקמה: שמירה במסד, הגדרת התפריט הראשי ו-4 השלוחות במערכת של המשתמש
export async function provisionSystem({ did, password, ownerPhone, ownerName, baseUrl, speakMenu }) {
  await ensure();
  const [existing] = await sql`select key from systems where did = ${did}`;
  const key = existing?.key || randomBytes(12).toString('hex');
  const token = `${did}:${password}`;
  await sql`
    insert into systems (did, password, key, owner_phone, owner_name, status)
    values (${did}, ${password}, ${key}, ${ownerPhone || null}, ${ownerName || null}, 'active')
    on conflict (did) do update set password = excluded.password, owner_phone = excluded.owner_phone,
      owner_name = coalesce(excluded.owner_name, systems.owner_name), status = 'active', updated_at = now(), last_error = null`;
  try {
    await writeFile(token, 'ivr2:/ext.ini', 'type=menu\ntitle=תפריט ראשי');
    for (const s of SERVICES) {
      await writeFile(
        token,
        `ivr2:/${s.ext}/ext.ini`,
        [`type=api`, `title=${s.title}`, `api_link=${baseUrl}/api/${s.route}`, `api_add_0=k=${key}`].join('\n')
      );
    }
    // הודעת התפריט בקול טבעי. אם הקול לא זמין - ימות תקריא את הטקסט בעצמה
    let spoken = false;
    if (speakMenu) {
      try { await speakMenu(SYSTEM_MENU_TEXT, '/M1000', token); spoken = true; } catch (e) { console.error('תפריט בקול טבעי נכשל:', String(e?.message || e).slice(0, 150)); }
    }
    if (!spoken) await writeFile(token, 'ivr2:/M1000.tts', SYSTEM_MENU_TEXT);
  } catch (e) {
    await sql`update systems set last_error = ${String(e?.message || e).slice(0, 300)} where did = ${did}`.catch(() => {});
    throw e;
  }
  return { key };
}

// ----- לאתר הניהול -----
export async function listSystems() {
  if (!hasDb) return [];
  await ensure();
  return sql`select did, password, owner_phone, coalesce(owner_name,'') as owner_name, status, created_at,
    updated_at, last_seen, calls, coalesce(last_error,'') as last_error from systems order by created_at desc`;
}
export async function setSystemStatus(did, status) {
  await ensure();
  await sql`update systems set status = ${status === 'active' ? 'active' : 'disabled'}, updated_at = now() where did = ${did}`;
}
export async function deleteSystem(did) {
  await ensure();
  await sql`delete from systems where did = ${did}`;
}
export async function systemTokens() {
  if (!hasDb) return [];
  await ensure();
  return (await sql`select did, password from systems where status = 'active'`).map((s) => `${s.did}:${s.password}`);
}
