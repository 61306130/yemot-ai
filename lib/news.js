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
  const ord = ['', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'];
  return [
    b.opening || `מהדורת חדשות, מעודכנת לשעה ${time}.`,
    ...b.items.map((x, i) => `ידיעה ${ord[i + 1] || i + 1}. ${x.title}. ${x.summary}`),
    b.closing || '',
  ].filter(Boolean).join('\n');
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

  const hour = new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
  const system = `אתה קריין ועורך של מהדורת חדשות ברדיו - תוסס, חם וקצבי, כמו מגיש בוקר אהוב. השעה עכשיו ${hour}.
המהדורה מוקראת בטלפון, אז היא חייבת להיות כיפית לשמיעה ולא יבשה.

בחירת ידיעות (6 עד 8):
- תפתח בידיעה הכי חזקה ומעניינת, לא בהכרח הכי "רשמית".
- גוון: לא רק פוליטיקה וביטחון. שלב ידיעה שנוגעת לכיס ולחיי היום-יום (מחירים, תחבורה, מזג אוויר, בריאות), ידיעה מהעולם, וידיעה אחת מפתיעה, אנושית או קלילה אם יש כזו.
- בלי כפילויות: אותו אירוע מכמה אתרים = ידיעה אחת.
- דלג על ידיעות שאין בהן כלום חדש או שיתעניינו בהן מעטים.

איך לכתוב:
- opening: פתיחה של משפט אחד או שניים, אנרגטית ואישית, שמזכירה את השעה ונותנת "טעימה" מהכותרת הגדולה. בלי "שלום וברוכים הבאים" גנרי.
- לכל ידיעה:
  - title: כותרת קצרה וקליטה (עד 8 מילים), שגורמת לרצות לשמוע עוד.
  - summary: שניים-שלושה משפטים קצרים בשפה מדוברת, שמסבירים מה קרה ולמה זה חשוב למאזין. פתח במשהו מושך ולא ב"היום הודיע". אפשר מעבר קליל מהידיעה הקודמת.
  - details: 3 עד 5 משפטים עם כל הפרטים שיש ברשימה - מי, מה, איפה, מספרים, ומה הצעד הבא.
- closing: משפט סיום קצר וחם.
- רק עובדות שמופיעות ברשימה. אל תמציא פרטים, מספרים או ציטוטים. כשמשהו לא ודאי - אמור שזה לפי הדיווחים.
- עברית פשוטה ומדוברת, משפטים קצרים, בלי סימנים מיוחדים, בלי קיצורים, בלי מרכאות ובלי סוגריים. מספרים במילים כשזה נשמע טבעי יותר.
- טון ניטרלי בנושאים שנויים במחלוקת: מדווחים, לא מביעים דעה. בידיעות קשות (נפגעים, אסונות) - רציני ומכבד, בלי קלילות.

החזר JSON בלבד בפורמט: {"opening":"","items":[{"title":"","summary":"","details":""}],"closing":""}`;

  const { text, provider } = await answer(system, [{ role: 'user', text: list }]);
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const out = (json.items || []).filter((x) => x.title).slice(0, 9);
  if (!out.length) throw new Error('ה-AI לא החזיר ידיעות');
  console.log(`חדשות: מהדורה חדשה (${out.length} ידיעות, ${items.length} כותרות, ${provider})`);
  return { opening: String(json.opening || '').trim(), closing: String(json.closing || '').trim(), items: out, createdAt: new Date().toISOString() };
}
