// שלוחת חדשות: מושך כותרות מאתרי חדשות, ה-AI מסכם למהדורה קצרה.
// המהדורה נבנית ברקע כל חצי שעה (טריגר מתוזמן ב-Cloudflare -> /api/news-refresh),
// כך שמתקשר לא מחכה לבנייה. אם הטריגר לא רץ - נבנית מחדש כשמישהו נכנס והיא ישנה.
import { hasDb, sql, ensureSchema } from './db.js';
import { answer } from './ai.js';

const FEEDS = [
  { name: 'ynet', url: 'https://www.ynet.co.il/Integration/StoryRss1854.xml' },
  { name: 'מעריב', url: 'https://www.maariv.co.il/Rss/RssFeedsMivzakiChadashot' },
  { name: 'וואלה', url: 'https://rss.walla.co.il/feed/22' },
];
const STALE_MS = 40 * 60 * 1000; // מהדורה ישנה מזה = הטריגר לא רץ, בונים בכניסה

// גיבוי בזיכרון למקרה שאין מסד נתונים
const mem = globalThis.__newsCache || (globalThis.__newsCache = { data: null, at: 0, building: null });

async function ensureTable() {
  if (!hasDb) return;
  await ensureSchema();
  await sql`create table if not exists news_cache (
    id int primary key, data jsonb not null, created_at timestamptz not null default now())`;
}

async function latest() {
  await ensureTable();
  let cached = mem.data && { data: mem.data, at: mem.at };
  if (hasDb) {
    const [row] = await sql`select data, created_at from news_cache where id = 1`;
    if (row) cached = { data: row.data, at: new Date(row.created_at).getTime() };
  }
  return cached || null;
}

// בנייה ושמירה של מהדורה חדשה (מהטריגר, מכפתור באתר, או כשאין מהדורה בכלל).
// בנייה אחת בכל פעם באותו שרת.
export async function refreshBulletin() {
  if (mem.building) return mem.building;
  mem.building = (async () => {
    const fresh = await buildBulletin();
    mem.data = fresh;
    mem.at = Date.now();
    if (hasDb) {
      await ensureTable();
      await sql`insert into news_cache (id, data, created_at) values (1, ${sql.json(fresh)}, now())
        on conflict (id) do update set data = excluded.data, created_at = now()`;
    }
    return fresh;
  })().finally(() => { mem.building = null; });
  return mem.building;
}

// המהדורה האחרונה שיש, גם אם ישנה. stale=true אם הגיע הזמן לבנות חדשה
export async function anyBulletin() {
  const cached = await latest().catch(() => null);
  return cached ? { data: cached.data, stale: Date.now() - cached.at >= STALE_MS } : null;
}

// הטקסט המוקרא של המהדורה (משותף לשלוחה ולהכנה מראש של הקול)
export function bulletinText(b) {
  const time = new Date(b.createdAt).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
  return `מהדורת חדשות, מעודכנת לשעה ${time}.\n` + b.items.map((x, i) => `${i + 1}. ${x.title}. ${x.summary}`).join('\n');
}

// build=false: רק מהדורה שמורה ועדכנית (או null), בלי לבנות.
// build=true: מהדורה עדכנית אם יש; אחרת בונים (ואם הבנייה נכשלת - הקודמת עדיפה מכלום)
export async function getBulletin({ build = true } = {}) {
  const cached = await latest();
  if (cached && Date.now() - cached.at < STALE_MS) return cached.data;
  if (!build) return null;
  try {
    return await refreshBulletin();
  } catch (err) {
    console.error('חדשות: בניית מהדורה נכשלה:', err);
    if (cached) return cached.data;
    throw err;
  }
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YemotNewsBot/1.0)' },
  });
  if (!res.ok) throw new Error(`${feed.name}: ${res.status}`);
  const xml = await res.text();
  return xml
    .split(/<item[\s>]/)
    .slice(1)
    .map((it) => ({
      source: feed.name,
      title: clean(it.match(/<title>([\s\S]*?)<\/title>/)?.[1]),
      desc: clean(it.match(/<description>([\s\S]*?)<\/description>/)?.[1]).slice(0, 400),
      date: new Date(clean(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]) || 0).getTime() || 0,
    }))
    .filter((x) => x.title);
}

function clean(s = '') {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;|&gt;|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function buildBulletin() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  results.forEach((r, i) => r.status === 'rejected' && console.error('חדשות: פיד נכשל', FEEDS[i].name, String(r.reason)));
  const items = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => b.date - a.date)
    .slice(0, 40);
  if (!items.length) throw new Error('לא התקבלו ידיעות מאף אתר');

  const list = items
    .map((x, i) => `${i + 1}. [${x.source}] ${x.title}${x.desc ? ' — ' + x.desc : ''}`)
    .join('\n');

  const system = `אתה עורך חדשות ברדיו. מכינים מהדורה קצרה שתוקרא בטלפון.
מתוך רשימת הידיעות בחר את 6 עד 8 הידיעות החשובות והעדכניות ביותר, בלי כפילויות (אותו אירוע מכמה אתרים = ידיעה אחת).
לכל ידיעה כתוב:
- title: כותרת קצרה וברורה (עד 10 מילים)
- summary: משפט אחד שמסביר את הידיעה
- details: 2 עד 4 משפטים עם הפרטים הידועים מהרשימה בלבד. אל תמציא פרטים.
כתוב בעברית פשוטה לשמיעה, בלי סימנים מיוחדים, בלי קיצורים ובלי מרכאות.
החזר JSON בלבד בפורמט: {"items":[{"title":"","summary":"","details":""}]}`;

  const { text, provider } = await answer(system, [{ role: 'user', text: list }]);
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const out = (json.items || []).filter((x) => x.title).slice(0, 9);
  if (!out.length) throw new Error('ה-AI לא החזיר ידיעות');
  console.log(`חדשות: מהדורה חדשה (${out.length} ידיעות, ${items.length} כותרות, ${provider})`);
  return { items: out, createdAt: new Date().toISOString() };
}
