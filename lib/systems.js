// מערכות ימות של משתמשים שהקימו אצלנו את השירותים (שלוחת "פתיחת מערכת").
// כל בקשה מימות מזוהה לפי מפתח סודי (k) שנשמר בהגדרות השלוחות של המערכת,
// וכל קבצי הקול וההקלטות עוברים דרך הטוקן של אותה מערכת.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { cfEnabled, createSystemWorker, deleteSystemWorker } from './cfworkers.js';
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
    // עמודות חדשות - רק אם חסרות (alter table נועל את הטבלה גם כשאין מה לשנות)
    const cols = (await sql`select column_name from information_schema.columns where table_name = 'systems'`).map((r) => r.column_name);
    if (!cols.includes('worker_url')) {
      await sql`alter table systems add column if not exists worker_name text, add column if not exists worker_account text, add column if not exists worker_url text`;
    }
    if (!cols.includes('host_prefix')) {
      await sql`alter table systems add column if not exists host_prefix text unique, add column if not exists host_domain text`;
    }
    if (!cols.includes('health')) {
      await sql`alter table systems add column if not exists health text, add column if not exists health_at timestamptz, add column if not exists health_detail text`;
    }
  })().catch((e) => ((ready = null), Promise.reject(e))));
}

// מזהה את המערכת לפי k. מחזיר הקשר לבקשה, או { denied: 'הודעה' } אם המערכת מושבתת/לא מוכרת
export async function resolveSystem(p, request) {
  let k = String(p?.k || '').trim();
  const h = String(p?.h || '').trim().toLowerCase();
  if ((!k && !h) || !hasDb) return {};
  // כשמוגדר PROXY_SECRET - מערכות משתמשים מתקבלות רק דרך כתובת הביניים (Cloudflare), לא ישירות
  const secret = process.env.PROXY_SECRET;
  if (secret && request?.headers?.get('x-proxy-key') !== secret) {
    return { denied: 'הגישה לשירות נחסמה. פנו למנהל הקו.' };
  }
  await ensure();
  // כתובת עם קידומת (x8k2p.domain.site): ה-Worker מעביר את הקידומת כ-h
  if (!k && h) {
    const [byHost] = await sql`select key from systems where host_prefix = ${h}`;
    if (!byHost) return { denied: 'המערכת הזו אינה רשומה בשירות. אפשר להקים אותה מחדש דרך שלוחת פתיחת המערכת.' };
    k = byHost.key;
  }
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
  { ext: 1, title: 'בוטי', route: 'yemot' },
  { ext: 2, title: 'מהדורת חדשות', route: 'news' },
  { ext: 3, title: 'בוט התחבורה', route: 'transit' },
  { ext: 4, title: 'התרגומון', route: 'translate' },
];

export const SYSTEM_MENU_TEXT =
  'שלום, הגעתם לבוטי. לבוטי העוזר החכם, הקישו אחת. למהדורת חדשות עדכנית, הקישו שתיים. ' +
  'לבוט התחבורה החכם, הקישו שלוש. לתרגומון החכם, הקישו ארבע. ' +
  'לפתיחת מערכת משלכם עם כל השירותים האלה, הקישו כוכבית. ' +
  'המערכת הוקמה על ידי שמעיה.';

// כתיבת כל ההגדרות למערכת של משתמש: תפריט ראשי (כולל כוכבית), שלוחות 1-4, שלוחת Star (פתיחת מערכת),
// והודעת התפריט בקול. בסוף בודקים שהודעת התפריט באמת קיימת במערכת.
async function writeSystemSetup(token, key, baseUrl, speakMenu, sysUrl) {
  await writeFile(token, 'ivr2:/ext.ini', 'type=menu\ntitle=תפריט ראשי\nstar_extension=yes');
  for (const s of SERVICES) {
    await writeFile(
      token,
      `ivr2:/${s.ext}/ext.ini`,
      (sysUrl
        ? [`type=api`, `title=${s.title}`, `api_link=${sysUrl}/${s.route}`] // כתובת נפרדת למערכת (Worker משלה)
        : process.env.PUBLIC_BASE_URL
        ? [`type=api`, `title=${s.title}`, `api_link=${baseUrl}/${key}/${s.route}`] // כתובת אישית למערכת
        : [`type=api`, `title=${s.title}`, `api_link=${baseUrl}/api/${s.route}`, `api_add_0=k=${key}`]
      ).join('\n')
    );
  }
  // שלוחה 0 (ברירת המחדל של ימות במערכת חדשה) - נמחקת. אם אין כזו, לא קורה כלום
  await yemot('FileAction', { token, action: 'delete', what0: 'ivr2:/0' }).catch(() => {});

  // שלוחת כוכבית: פתיחת מערכת נוספת (אותו שירות כמו בקו הראשי)
  await writeFile(token, 'ivr2:/Star/ext.ini', ['type=api', 'title=פתיחת מערכת', `api_link=${sysUrl ? sysUrl + '/setup' : baseUrl + '/api/setup'}`].join('\n'));

  if (speakMenu === null) return {}; // רק החלפת כתובות - התפריט נשאר כמו שהוא
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

// ---------- כתובות עם קידומת על הדומיינים שלנו ----------
// כל מערכת מקבלת קידומת אקראית על אחד הדומיינים (https://x8k2p4m.fixapp.site/yemot).
// הדומיינים ב-Cloudflare, עם רשומת * ו-Route של ה-Worker (kav) על *.domain/*.
// לפעמים (סיכוי 1 מתוך מספר הדומיינים+1) המערכת מקבלת את הכתובת הרגילה של Cloudflare (kav.../<מפתח>/<שירות>).
export const DEFAULT_DOMAINS = ['fixapp.site', 'weinreich.site', 'mivzak360.site'];
async function systemDomains() {
  const { getSettings } = await import('./store.js');
  const st = await getSettings().catch(() => ({}));
  const list = Array.isArray(st['systems.domains']) ? st['systems.domains'] : DEFAULT_DOMAINS;
  const off = Array.isArray(st['systems.domainsOff']) ? st['systems.domainsOff'] : [];
  return list.filter((d) => !off.includes(d));
}
// הדומיין פעיל? (ה-Worker עונה ok על /__ping דרך קידומת כלשהי, כולל תעודת SSL)
const domainOk = globalThis.__domainOk || (globalThis.__domainOk = new Map());
export async function checkDomain(domain) {
  const c = domainOk.get(domain);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.ok;
  let ok = false;
  try {
    const r = await fetch(`https://zz${randomBytes(3).toString('hex')}.${domain}/__ping`, { signal: AbortSignal.timeout(6000) });
    ok = r.ok && (await r.text()).trim() === 'ok';
  } catch {}
  domainOk.set(domain, { ok, at: Date.now() });
  return ok;
}
const newPrefix = () => {
  const a = 'abcdefghijkmnpqrstuvwxyz', b = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = randomBytes(8);
  return a[r[0] % a.length] + Array.from(r.slice(1), (x) => b[x % b.length]).join('');
};
// מחזיר כתובת בסיס למערכת (https://prefix.domain), או null = הכתובת הרגילה של Cloudflare
async function ensureHost(did, { renew = false, domain: forceDomain } = {}) {
  const [row] = await sql`select host_prefix, host_domain from systems where did = ${did}`;
  if (row?.host_domain === 'kav' && !renew) return null;
  if (row?.host_prefix && row?.host_domain && !renew && (await checkDomain(row.host_domain))) return `https://${row.host_prefix}.${row.host_domain}`;
  const live = [];
  for (const d of forceDomain ? [forceDomain] : await systemDomains()) if (await checkDomain(d)) live.push(d);
  // בחירה: אחד הדומיינים הפעילים, או (לפעמים) הכתובת הרגילה
  const slots = forceDomain ? live : [...live, 'kav'];
  const pick = slots.length ? slots[randomBytes(1)[0] % slots.length] : 'kav';
  if (pick === 'kav') {
    await sql`update systems set host_prefix = null, host_domain = 'kav', worker_url = null where did = ${did}`;
    return null;
  }
  const prefix = newPrefix();
  const url = `https://${prefix}.${pick}`;
  await sql`update systems set host_prefix = ${prefix}, host_domain = ${pick}, worker_url = ${url} where did = ${did}`;
  return url;
}
// העברת כל המערכות מדומיין (למשל אחרי חסימה) - כל אחת מקבלת קידומת חדשה על דומיין אחר
export async function moveOffDomain(domain, { baseUrl, speakMenu } = {}) {
  await ensure();
  const rows = await sql`select did, password, key from systems where host_domain = ${domain} and status = 'active'`;
  const out = [];
  for (const r of rows) {
    try {
      const url = await ensureHost(r.did, { renew: true });
      await writeSystemSetup(`${r.did}:${r.password}`, r.key, baseUrl, null, url);
      out.push({ did: r.did, ok: true, url });
    } catch (e) { out.push({ did: r.did, ok: false, error: String(e?.message || e).slice(0, 200) }); }
  }
  return out;
}
export async function domainsStatus() {
  await ensure();
  const all = await systemDomains().catch(() => DEFAULT_DOMAINS);
  const counts = await sql`select coalesce(host_domain, 'kav') as d, count(*)::int as c from systems where status = 'active' group by 1`;
  const out = [];
  for (const d of [...new Set([...DEFAULT_DOMAINS, ...all])]) out.push({ domain: d, on: all.includes(d), live: await checkDomain(d), systems: counts.find((x) => x.d === d)?.c || 0 });
  out.push({ domain: 'kav', on: true, live: true, systems: counts.find((x) => x.d === 'kav')?.c || 0 });
  return out;
}

// כתובת נפרדת למערכת (Worker ב-Cloudflare). renew=true - כתובת חדשה (למשל אחרי חסימה)
async function ensureWorker(did, key, { renew = false } = {}) {
  if (!cfEnabled) return null;
  const [row] = await sql`select worker_name, worker_account, worker_url from systems where did = ${did}`;
  if (row?.worker_url && !renew) return row.worker_url;
  const w = await createSystemWorker(key);
  await sql`update systems set worker_name = ${w.name}, worker_account = ${w.account}, worker_url = ${w.url} where did = ${did}`;
  if (row?.worker_name) await deleteSystemWorker(row.worker_account, row.worker_name);
  return w.url;
}

// החלפת הכתובת של מערכת אחת (למשל אם נחסמה)
export async function renewSystemAddress(did, { baseUrl, speakMenu } = {}) {
  await ensure();
  const [r] = await sql`select did, password, key from systems where did = ${did}`;
  if (!r) throw new Error('מערכת לא נמצאה');
  const url = (await ensureHost(r.did, { renew: true }).catch(() => null)) || (await ensureWorker(r.did, r.key, { renew: true }));
  await writeSystemSetup(`${r.did}:${r.password}`, r.key, baseUrl, speakMenu, url);
  return { did, url };
}

// עדכון ההגדרות והתפריט בכל המערכות הפעילות (למשל אחרי שינוי בתפריט)
export async function refreshAllSystems({ baseUrl, speakMenu, limit = 100 } = {}) {
  if (!hasDb) return [];
  await ensure();
  const rows = await sql`select did, password, key from systems where status = 'active' order by did limit ${limit}`;
  const out = [];
  for (const r of rows) {
    try {
      const sysUrl = (await ensureHost(r.did).catch((e) => { console.error('כתובת:', e.message); return null; }))
        || (await ensureWorker(r.did, r.key).catch((e) => { console.error('Worker:', e.message); return null; }));
      const { menuWarning } = await writeSystemSetup(`${r.did}:${r.password}`, r.key, baseUrl, speakMenu, sysUrl);
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
    const sysUrl = (await ensureHost(did).catch((e) => { console.error('כתובת:', e.message); return null; }))
      || (await ensureWorker(did, key).catch((e) => { console.error('Worker:', e.message); return null; }));
    const { menuWarning } = await writeSystemSetup(token, key, baseUrl, speakMenu, sysUrl);
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
  // שם הבעלים: מה שנרשם בהקמה, ואם אין - השם שהקליט אצל בוטי (מתעדכן אוטומטית)
  return sql`select s.did, s.password, s.owner_phone, coalesce(nullif(s.owner_name,''), c.name, '') as owner_name, s.status, s.created_at,
    s.updated_at, s.last_seen, s.calls, coalesce(s.last_error,'') as last_error
    from systems s left join callers c on c.phone = s.owner_phone order by s.created_at desc`;
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
  const [s] = await sql`select did, password, key, worker_url from systems where did = ${did}`;
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
      if (!txt.includes(s.key) && !(s.worker_url && txt.includes(s.worker_url))) { problems.push(`שלוחה ${sv.ext} (${sv.title}) שונתה או נמחקה`); health = 'bad'; }
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
  const systems = await sql`select s.did, s.password, s.owner_phone, coalesce(nullif(s.owner_name,''), c.name, '') as owner_name, s.status, s.created_at,
    s.updated_at, s.last_seen, s.calls, coalesce(s.last_error,'') as last_error, s.health, s.health_at, coalesce(s.health_detail,'') as health_detail,
    coalesce(s.worker_url, '') as worker_url
    from systems s left join callers c on c.phone = s.owner_phone
    order by s.last_seen desc nulls last, s.created_at desc`;
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

// האם המספר הזה פתח מערכת (פעילה) - מקבל מגבלת שאלות גבוהה יותר אצל בוטי
const ownerCache = globalThis.__ownerCache || (globalThis.__ownerCache = new Map());
export async function isSystemOwner(phone) {
  if (!hasDb || !phone) return false;
  const c = ownerCache.get(phone);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.v;
  let v = false;
  try {
    await ensure();
    const [r] = await sql`select 1 from systems where owner_phone = ${phone} and status = 'active' limit 1`;
    v = Boolean(r);
  } catch {}
  ownerCache.set(phone, { v, at: Date.now() });
  return v;
}

// מעבר של כל המערכות לכתובות החדשות (בלי לגעת בתפריט)
export async function assignHostsAll({ baseUrl } = {}) {
  await ensure();
  const rows = await sql`select did, password, key from systems where status = 'active' order by did`;
  const out = [];
  for (const r of rows) {
    try {
      const url = (await ensureHost(r.did)) || null;
      await writeSystemSetup(`${r.did}:${r.password}`, r.key, baseUrl, null, url);
      out.push({ did: r.did, ok: true, url: url || 'kav' });
    } catch (e) { out.push({ did: r.did, ok: false, error: String(e?.message || e).slice(0, 200) }); }
  }
  return out;
}

// אבחון: כל קישורי ה-API בשלוחות של מערכת (רק השורות של api_link, בלי סיסמאות)
export async function readLinks(token) {
  const dir = await yemot('GetIVR2Dir', { token, path: 'ivr2:/' }).catch((e) => ({ error: e.message }));
  const exts = (dir.dirs || []).map((d) => d.name).filter(Boolean);
  const out = {};
  for (const e of ['', ...exts]) {
    const r = await yemot('GetTextFile', { token, what: `ivr2:/${e ? e + '/' : ''}ext.ini` }).catch(() => ({}));
    const lines = String(r.contents || '').split('\n').filter((l) => /^(type|api_link|api_add|title)/.test(l.trim()));
    if (lines.length) out['/' + e] = lines;
  }
  return out;
}
