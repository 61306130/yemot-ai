// תשתית משותפת: הגדרות שנערכות מאתר הניהול, מצב זמני של שיחות, יומן שגיאות וסטטיסטיקת שימוש.
import { hasDb, sql, ensureSchema } from './db.js';

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
    create table if not exists usage_daily (
      day date not null, kind text not null, provider text not null, count int not null default 0,
      primary key (day, kind, provider));
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
  'bot.greeting': 'שלום. אני העוזר החכם. שאל אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית',
  'bot.search': true,
  'voice.name': process.env.VOICE_NAME || 'he-IL-AvriNeural',
  'voice.enabled': process.env.VOICE_OFF !== '1',
  'news.refreshMinutes': 15,
  'news.feeds': null, // null = ברירת המחדל שבקוד
  'menu.text': '',
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
  ensureStore()
    .then(() => sql`insert into error_log (source, message) values (${source}, ${message})`)
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
