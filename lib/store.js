// תשתית משותפת: הגדרות שנערכות מאתר הניהול, מצב זמני של שיחות, יומן שגיאות וסטטיסטיקת שימוש.
import { hasDb, sql, ensureSchema } from './db.js';
import { currentSystem, countSystemError } from './systems.js';

let ready;
export function ensureStore() {
  if (!hasDb) return Promise.resolve();
  ready ||= ensureSchema()
    .then(
      () => sql`
    create table if not exists settings (
      key text primary key, value jsonb, updated_at timestamptz not null default now());
    create table if not exists ivr_state (
      key text primary key, state jsonb not null, updated_at timestamptz not null default now());
    create table if not exists error_log (
      id bigserial primary key, source text, message text, created_at timestamptz not null default now());
    create index if not exists error_log_time_idx on error_log(created_at desc);
    -- הוספת עמודה רק אם חסרה: alter table נועל את הטבלה גם כשהעמודה קיימת, ובכל הפעלה זה תוקע בקשות
    do $$ begin
      if not exists (select 1 from information_schema.columns where table_name = 'error_log' and column_name = 'did') then
        set local lock_timeout = '3s';
        alter table error_log add column did text;
      end if;
    end $$;
    -- מגבלת שאלות יומית אישית למתקשר (ריק = ברירת המחדל, 0 = בלי הגבלה)
    do $$ begin
      if not exists (select 1 from information_schema.columns where table_name = 'callers' and column_name = 'daily_limit') then
        set local lock_timeout = '3s';
        alter table callers add column daily_limit int;
      end if;
    end $$;
    -- מתקשרים בלי סינון תכנים (נקבע בכרטיס המשתמש באתר)
    do $$ begin
      if not exists (select 1 from information_schema.columns where table_name = 'callers' and column_name = 'no_filter') then
        set local lock_timeout = '3s';
        alter table callers add column no_filter boolean not null default false;
      end if;
    end $$;
    -- מנהלים: מזוהים רק לפי מספר הטלפון שסומן באתר (לא לפי מה שאומרים בשיחה)
    do $$ begin
      if not exists (select 1 from information_schema.columns where table_name = 'callers' and column_name = 'is_admin') then
        set local lock_timeout = '3s';
        alter table callers add column is_admin boolean not null default false;
      end if;
    end $$;
    create table if not exists usage_daily (
      day date not null, kind text not null, provider text not null, count int not null default 0,
      primary key (day, kind, provider));
    -- חזרה חד-פעמית לקול של אברי בכל המודולים (אפשר להחליף באתר)
    insert into settings (key, value) values ('voice.migrated_google', 'true') on conflict (key) do nothing;
    insert into settings (key, value)
      select 'voice.name', '"he-IL-AvriNeural"' where not exists (select 1 from settings where key = 'voice.migrated_avri')
      on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into settings (key, value) values ('voice.migrated_avri', 'true') on conflict (key) do nothing;
    insert into settings (key, value)
      select 'bot.dailyLimit', '20' where not exists (select 1 from settings where key = 'bot.limit_migrated_20')
      on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into settings (key, value) values ('bot.limit_migrated_20', 'true') on conflict (key) do nothing;
    -- כיבוי חד-פעמי של נקדן דיקטה (הניקוד שלו נשמע רע בקול Chirp)
    insert into settings (key, value) select 'voice.nakdan', 'false' where not exists (select 1 from settings where key = 'voice.nakdan_off_migrated')
      on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into settings (key, value) values ('voice.nakdan_off_migrated', 'true') on conflict (key) do nothing;
    -- מהירות התשובות: 8 (חד-פעמי, למקרה שנשמר 0 באתר)
    insert into settings (key, value) select 'voice.answerRate', '8' where not exists (select 1 from settings where key = 'voice.answer_rate_migrated_8')
      on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into settings (key, value) values ('voice.answer_rate_migrated_8', 'true') on conflict (key) do nothing;
    -- תפריט ראשי חדש (חד-פעמי): "לחצו" במקום "הקישו" (הקול קרא "היקישו"), "ששמעתם", פודקאסטים, הקרדיט בסוף
    insert into settings (key, value) select 'menu.text', to_jsonb('שלום, הגעתם לבוטי. לבוטי העוזר החכם, הקישו אחת. למהדורת חדשות עדכנית, הקישו שתיים. לבוט התחבורה החכם, הקישו שלוש. לתרגומון החכם, הקישו חמש. לפודקאסטים, הקישו שמונה. לפתיחת מערכת משלכם עם כל השירותים האלה, הקישו כוכבית. לחזרה למקום האחרון ששמעתם, הקישו סולמית. המערכת הוקמה על ידי שמעיה.'::text) where not exists (select 1 from settings where key = 'menu.v4_migrated')
      on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into settings (key, value) values ('menu.v4_migrated', 'true') on conflict (key) do nothing;
    -- הודעת הפתיחה של בוטי (חד-פעמי)
    insert into settings (key, value) select 'bot.greeting', to_jsonb('שלום, כאן בוטי העוזר החכם! שאלו אותי כל שאלה אחרי הצליל, ובסיום הקישו סולמית.'::text) where not exists (select 1 from settings where key = 'bot.greeting_v4_migrated')
      on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into settings (key, value) values ('bot.greeting_v4_migrated', 'true') on conflict (key) do nothing;
    -- המערכת הוקמה על ידי שמעיה (במקום 6130)
    update settings set value = to_jsonb(replace(value #>> '{}', 'המערכת הוקמה באמצעות שש, אחת, שלוש, אפס. מערכות טלפוניה.', 'המערכת הוקמה על ידי שמעיה.')), updated_at = now()
      where key in ('menu.text', 'systems.menuText') and value #>> '{}' like '%שש, אחת, שלוש, אפס%';
    update settings set value = '"שלום, כאן בוטי. שאל אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית"', updated_at = now()
      where key = 'bot.greeting' and value::text = '"שלום. אני העוזר החכם. שאל אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית"';
    update settings set value = to_jsonb(replace(value #>> '{}', 'לעוזר החכם, הקישו אחת', 'לבוטי, העוזר החכם, הקישו אחת')), updated_at = now()
      where key = 'menu.text' and value #>> '{}' like '%לעוזר החכם, הקישו אחת%';
  `.simple()
    )
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

// ---------- הגדרות ----------
const DEFAULTS = {
  'bot.prompt': '',
  'bot.greeting': 'שלום, כאן בוטי העוזר החכם! שאלו אותי כל שאלה אחרי הצליל, ובסיום הקישו סולמית.',
  'bot.search': true,
  'bot.dailyLimit': 20, // מקסימום שאלות לבוט לכל מתקשר ביום (0 = בלי הגבלה)
  'bot.dailyLimitOwner': 40, // מי שפתח מערכת אישית
  'bot.upgradeFolder': '/Star', // לאן מעבירים מי שרוצה לפתוח מערכת (שלוחת הכוכבית)
  'bot.filter': true, // סינון תכנים (הוראה ל-AI + מילים חסומות)
  'bot.filterSmart': true, // בדיקה חכמה של כל שאלה ותשובה (מודל קטן ב-Groq)
  'bot.filterWords': 'סקס, פורנו, פורנוגרפיה, קזינו',
  'bot.filterReply': '',
  'bot.music': false, // מנגינה בזמן שבוטי חושב (כבויה עד שתיבחר מנגינה)
  'bot.niqqud': true, // ניקוד מלא של ה-AI בתשובות הבוט, לשיפור ההגייה
  'voice.nakdan': false, // נקדן דיקטה - כבוי (נשמע רע עם Chirp). ה-AI מנקד את התשובות בעצמו
  'voice.answerRate': 8, // מהירות ההקראה של התשובות של בוטי (0 נשמע ישנוני, 15 מהיר מדי)
  'voice.rate': 15, // מהירות דיבור באחוזים (0 = רגיל)
  'voice.name': process.env.VOICE_NAME || 'he-IL-AvriNeural',
  'voice.enabled': process.env.VOICE_OFF !== '1',
  'news.refreshMinutes': 15,
  'news.feeds': null, // null = ברירת המחדל שבקוד
  'menu.text': 'שלום, הגעתם לבוטי. לבוטי העוזר החכם, הקישו אחת. למהדורת חדשות עדכנית, הקישו שתיים. לבוט התחבורה החכם, הקישו שלוש. לתרגומון החכם, הקישו חמש. לפודקאסטים, הקישו שמונה. לפתיחת מערכת משלכם עם כל השירותים האלה, הקישו כוכבית. לחזרה למקום האחרון ששמעתם, הקישו סולמית. המערכת הוקמה על ידי שמעיה.',
  'menu.path': '/M1000',
  'transit.enabled': true,
  'podcast.enabled': true,
};
const cache = globalThis.__settingsCache || (globalThis.__settingsCache = { at: 0, map: {} });

export async function getSettings() {
  if (!hasDb) return { ...DEFAULTS };
  if (Date.now() - cache.at < 20000) return { ...DEFAULTS, ...cache.map };
  try {
    await ensureStore();
    const rows = await sql`select key, value from settings`;
    cache.map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cache.at = Date.now();
  } catch (e) {
    console.error('הגדרות: קריאה נכשלה', e.message);
  }
  return { ...DEFAULTS, ...cache.map };
}

export async function getSetting(key) {
  return (await getSettings())[key];
}

export async function setSettings(obj) {
  if (!hasDb) throw new Error('אין מסד נתונים');
  await ensureStore();
  for (const [key, value] of Object.entries(obj)) {
    await sql`insert into settings (key, value, updated_at) values (${key}, ${sql.json(value)}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
  }
  cache.at = 0;
}

export { DEFAULTS as SETTING_DEFAULTS };

// ---------- מצב זמני (למשל מצב שיחה בשלוחת ניהול) ----------
const memState = globalThis.__ivrState || (globalThis.__ivrState = new Map());

export async function loadState(key) {
  if (!hasDb) return memState.get(key) || null;
  await ensureStore();
  const [row] = await sql`select state from ivr_state where key = ${key}`;
  return row?.state || null;
}

export async function saveState(key, state) {
  if (!hasDb) return void memState.set(key, state);
  await ensureStore();
  await sql`insert into ivr_state (key, state, updated_at) values (${key}, ${sql.json(state)}, now())
    on conflict (key) do update set state = excluded.state, updated_at = now()`;
}

// ---------- יומן שגיאות ----------
export function logError(source, err) {
  const message = String(err?.stack || err?.message || err).slice(0, 2000);
  console.error(`[${source}]`, message);
  if (!hasDb) return;
  const did = currentSystem()?.did || null; // שגיאה במערכת של משתמש - נרשמת עליה
  if (did) countSystemError();
  ensureStore()
    .then(() => sql`insert into error_log (source, message, did) values (${source}, ${message}, ${did})`)
    .catch(() => {});
}

// ---------- סטטיסטיקת שימוש (כמה פעמים כל ספק עבד היום) ----------
export function countUsage(kind, provider) {
  if (!hasDb) return;
  ensureStore()
    .then(
      () => sql`insert into usage_daily (day, kind, provider, count)
        values ((now() at time zone 'Asia/Jerusalem')::date, ${kind}, ${provider}, 1)
        on conflict (day, kind, provider) do update set count = usage_daily.count + 1`
    )
    .catch(() => {});
}
