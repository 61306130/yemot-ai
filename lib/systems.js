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
    // ניטור: שימוש יומי לפי שירות, ומצב בריאות של כל מערכת
    await sql`create table if not exists system_usage (
      did text not null, day date not null, service text not null,
      calls int not null default 0, errors int not null default 0,
      primary key (did, day, service))`;
    await sql`alter table systems add column if not exists health text`;
    await sql`alter table systems add column if not exists health_at timestamptz`;
    await sql`alter table systems add column if not exists health_detail text`;
  })().catch((e) => ((ready = null), Promise.reject(e))));
}

// מזהה את המערכת לפי k. מחזיר הקשר לבקשה, או { denied: 'הודעה' } אם המערכת מושבתת/לא מוכרת
export async function resolveSystem(p, request) {
  const k = String(p?.k || '').trim();
  if (!k || !hasDb) return {};
  // כשמוגדר PROXY_SECRET - מערכות משתמשים מתקבלות רק דרך כתובת הביניים (Cloudflare), לא ישירות
  const secret = process.env.PROXY_SECRET;
  if (secret && request?.headers?.get('x-proxy-key') !== secret) {
    return { denied: 'הגישה לשירות נחסמה. פנו למנהל הקו.' };
  }
  await ensure();
  const [s] = await sql`select did, password, status from systems where key = ${k}`;
  if (!s) return { denied: 'המערכת הזו אינה רשומה בשירות. אפשר להקים אותה מחדש דרך שלוחת פתיחת המערכת.' };
  if (s.status !== 'active') return { denied: 'השירות במערכת הזו מושבת כרגע.' };
  // שיחה חדשה = בקשה בלי תשובות קודמות
  const fresh = !Object.keys(p).some((key) => /^[a-z]{1,3}\d+$/i.test(key));
  const service = serviceOf(request);
  sql`update systems set last_seen = now(), calls = calls + ${fresh ? 1 : 0} where did = ${s.did}`.catch(() => {});
  if (fresh) {
    sql`insert into system_usage (did, day, service, calls) values (${s.did}, ${today()}, ${service}, 1)
      on conflict (did, day, service) do update set calls = system_usage.calls + 1`.catch(() => {});
  }
  return { did: s.did, token: `${s.did}:${s.password}`, service };
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
function serviceOf(request) {
  try { return new URL(request.url).pathname.replace(/^\/api\//, '').split('/')[0] || 'other'; } catch { return 'other'; }
}

// נקרא מיומן השגיאות: שגיאה בזמן בקשה של מערכת משתמש נספרת אצלה
export function countSystemError() {
  const ctx = als.getStore();
  if (!ctx?.did || !hasDb) return;
  sql`insert into system_usage (did, day, service, errors) values (${ctx.did}, ${today()}, ${ctx.service || 'other'}, 1)
    on conflict (did, day, service) do update set errors = system_usage.errors + 1`.catch(() => {});
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
  'לפתיחת מערכת משלכם עם כל השירותים האלה, הקישו כוכבית. ' +
  'המערכת הוקמה באמצעות שש, אחת, שלוש, אפס. מערכות טלפוניה.';

// כתיבת כל ההגדרות למערכת של משתמש: תפריט ראשי (כולל כוכבית), שלוחות 1-4, שלוחת Star (פתיחת מערכת),
// והודעת התפריט בקול. בסוף בודקים שהודעת התפריט באמת קיימת במערכת.
async function writeSystemSetup(token, key, baseUrl, speakMenu) {
  await writeFile(token, 'ivr2:/ext.ini', 'type=menu\ntitle=תפריט ראשי\nstar_extension=yes');
  for (const s of SERVICES) {
    await writeFile(
      token,
      `ivr2:/${s.ext}/ext.ini`,
      (process.env.PUBLIC_BASE_URL
        ? [`type=api`, `title=${s.title}`, `api_link=${baseUrl}/${key}/${s.route}`] // כתובת אישית למערכת
        : [`type=api`, `title=${s.title}`, `api_link=${baseUrl}/api/${s.route}`, `api_add_0=k=${key}`]
      ).join('\n')
    );
  }
  // שלוחה 0 (ברירת המחדל של ימות במערכת חדשה) - נמחקת. אם אין כזו, לא קורה כלום
  await yemot('FileAction', { token, action: 'delete', what0: 'ivr2:/0' }).catch(() => {});

  // שלוחת כוכבית: פתיחת מערכת נוספת (אותו שירות כמו בקו הראשי)
  await writeFile(token, 'ivr2:/Star/ext.ini', ['type=api', 'title=פתיחת מערכת', `api_link=${baseUrl}/api/setup`].join('\n'));

  // הודעת התפריט כקובץ קול (לא TTS של ימות). עד 3 ניסיונות, ובכל ניסיון בודקים שהקובץ באמת נשמר במערכת.
  let spoken = false, lastErr = null;
  for (let attempt = 0; attempt < 3 && speakMenu && !spoken; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000));
    try {
      await speakMenu(SYSTEM_MENU_TEXT, '/M1000', token);
      const dir = await yemot('GetIVR2Dir', { token, path: 'ivr2:/' }).catch(() => ({}));
      const names = (dir.files || []).map((f) => String(f.name || '').toLowerCase());
      spoken = dir.responseStatus !== 'OK' || names.includes('m1000.wav');
      if (!spoken) lastErr = new Error('קובץ הקול של התפריט לא נמצא במערכת אחרי ההעלאה');
    } catch (e) {
      lastErr = e;
      console.error('תפריט בקול נכשל:', String(e?.message || e).slice(0, 150));
    }
  }
  if (spoken) {
    // קובץ TTS ישן של התפריט עלול לגבור על קובץ הקול - מוחקים אותו
    await yemot('FileAction', { token, action: 'delete', what0: 'ivr2:/M1000.tts' }).catch(() => {});
  } else {
    // שלא יישאר תפריט שקט: זמנית טקסט, ומסמנים שגיאה כדי לעדכן שוב מהאתר ("עדכון תפריט בכל המערכות")
    await writeFile(token, 'ivr2:/M1000.tts', SYSTEM_MENU_TEXT);
    return { menuWarning: 'הודעת התפריט לא הועלתה כקובץ קול (נשמרה זמנית כטקסט): ' + String(lastErr?.message || lastErr || '').slice(0, 150) };
  }
  return {};
}

// עדכון ההגדרות והתפריט בכל המערכות הפעילות (למשל אחרי שינוי בתפריט)
export async function refreshAllSystems({ baseUrl, speakMenu, limit = 100 } = {}) {
  if (!hasDb) return [];
  await ensure();
  const rows = await sql`select did, password, key from systems where status = 'active' order by did limit ${limit}`;
  const out = [];
  for (const r of rows) {
    try {
      const { menuWarning } = await writeSystemSetup(`${r.did}:${r.password}`, r.key, baseUrl, speakMenu);
      await sql`update systems set updated_at = now(), last_error = ${menuWarning || null} where did = ${r.did}`;
      out.push(menuWarning ? { did: r.did, ok: false, error: menuWarning } : { did: r.did, ok: true });
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 300);
      await sql`update systems set last_error = ${msg} where did = ${r.did}`.catch(() => {});
      out.push({ did: r.did, ok: false, error: msg });
    }
  }
  return out;
}

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
    // אם רק הודעת התפריט לא הועלתה כקול - ההקמה עדיין מצליחה, והבעיה נרשמת לתיקון מהאתר
    const { menuWarning } = await writeSystemSetup(token, key, baseUrl, speakMenu);
    if (menuWarning) await sql`update systems set last_error = ${menuWarning} where did = ${did}`.catch(() => {});
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

// ----- ניטור -----
// בדיקת בריאות: אפשר להתחבר עם הסיסמה, והשלוחות עדיין מצביעות אלינו עם המפתח של המערכת
export async function checkSystem(did) {
  await ensure();
  const [s] = await sql`select did, password, key from systems where did = ${did}`;
  if (!s) throw new Error('מערכת לא נמצאה');
  let health = 'ok';
  const problems = [];
  const login = await yemot('Login', { username: s.did, password: s.password }).catch(() => ({}));
  if (login.responseStatus !== 'OK') {
    health = 'bad';
    problems.push(login.message ? `התחברות נכשלה: ${login.message}` : 'התחברות נכשלה (סיסמה שונתה או שהמערכת לא קיימת)');
  } else {
    const token = `${s.did}:${s.password}`;
    const root = await yemot('GetIVR2Dir', { token, path: 'ivr2:/' }).catch(() => ({}));
    if (root.responseStatus === 'OK') {
      const files = (root.files || []).map((f) => String(f.name || '').toLowerCase());
      const dirs = (root.dirs || []).map((f) => String(f.name || ''));
      if (!files.some((n) => n.startsWith('m1000.'))) { problems.push('חסרה הודעת התפריט הראשי'); if (health === 'ok') health = 'warn'; }
      if (dirs.length && !dirs.includes('Star')) { problems.push('חסרה שלוחת הכוכבית'); if (health === 'ok') health = 'warn'; }
    }
    for (const sv of SERVICES) {
      const r = await yemot('GetTextFile', { token, what: `ivr2:/${sv.ext}/ext.ini` }).catch(() => ({}));
      if (r.responseStatus !== 'OK') { problems.push(`שלוחה ${sv.ext}: לא ניתן לקרוא את ההגדרות`); if (health === 'ok') health = 'warn'; continue; }
      const txt = String(r.contents || '');
      if (!txt.includes(s.key)) { problems.push(`שלוחה ${sv.ext} (${sv.title}) שונתה או נמחקה`); health = 'bad'; }
    }
  }
  const detail = problems.join(' · ') || 'הכול תקין';
  await sql`update systems set health = ${health}, health_at = now(), health_detail = ${detail} where did = ${did}`;
  return { did, health, detail };
}

export async function checkAllSystems({ limit = 200 } = {}) {
  if (!hasDb) return [];
  await ensure();
  const rows = await sql`select did from systems where status = 'active' order by health_at asc nulls first limit ${limit}`;
  const out = [];
  for (let i = 0; i < rows.length; i += 5) {
    out.push(...(await Promise.all(rows.slice(i, i + 5).map((r) => checkSystem(r.did).catch((e) => ({ did: r.did, health: 'unknown', detail: String(e.message) }))))));
  }
  return out;
}

export async function systemsMonitor() {
  if (!hasDb) return { systems: [], totals: {} };
  await ensure();
  const t = today();
  const systems = await sql`select did, password, owner_phone, coalesce(owner_name,'') as owner_name, status, created_at,
    updated_at, last_seen, calls, coalesce(last_error,'') as last_error, health, health_at, coalesce(health_detail,'') as health_detail
    from systems order by last_seen desc nulls last, created_at desc`;
  const usage = await sql`select did, day::text as day, service, calls, errors from system_usage
    where day >= (${t}::date - 13) order by day`;
  const errs = await sql`select did, source, left(message, 300) as message, created_at from error_log
    where did is not null and created_at > now() - interval '7 days' order by created_at desc limit 300`.catch(() => []);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(t + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 13 + i);
    return d.toISOString().slice(0, 10);
  });
  const totals = { systems: systems.length, active: 0, today: 0, week: 0, errors24h: 0, problems: 0, byDay: days.map(() => 0) };
  const weekStart = days[7];
  for (const sy of systems) {
    const u = usage.filter((x) => x.did === sy.did);
    sy.today = u.filter((x) => x.day === t).reduce((a, x) => a + x.calls, 0);
    sy.week = u.filter((x) => x.day >= weekStart).reduce((a, x) => a + x.calls, 0);
    sy.byDay = days.map((d) => u.filter((x) => x.day === d).reduce((a, x) => a + x.calls, 0));
    sy.services = {};
    for (const x of u.filter((x) => x.day >= weekStart)) sy.services[x.service] = (sy.services[x.service] || 0) + x.calls;
    sy.errorsWeek = u.filter((x) => x.day >= weekStart).reduce((a, x) => a + x.errors, 0);
    sy.recentErrors = errs.filter((e) => e.did === sy.did).slice(0, 5);
    sy.errors24h = errs.filter((e) => e.did === sy.did && Date.now() - new Date(e.created_at) < 864e5).length;
    totals.today += sy.today; totals.week += sy.week; totals.errors24h += sy.errors24h;
    sy.byDay.forEach((v, i) => (totals.byDay[i] += v));
    if (sy.status === 'active' && sy.last_seen && Date.now() - new Date(sy.last_seen) < 7 * 864e5) totals.active++;
    if (sy.status === 'active' && (sy.health === 'bad' || sy.errors24h >= 3 || sy.last_error)) totals.problems++;
  }
  totals.days = days;
  return { systems, totals };
}
