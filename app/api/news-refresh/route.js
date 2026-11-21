// בניית מהדורת חדשות ברקע. נקרא כל חצי שעה מטריגר מתוזמן של Cloudflare (proxy/worker.js),
// עם הכותרת x-proxy-key. אפשר גם מ-Vercel Cron (CRON_SECRET).
import { refreshBulletin, bulletinText } from '../../../lib/news.js';
import { say } from '../../../lib/voice.js';
import { getSettings } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function allowed(request) {
  const proxy = process.env.PROXY_SECRET;
  if (proxy && request.headers.get('x-proxy-key') === proxy) return true;
  const cron = process.env.CRON_SECRET;
  if (cron && request.headers.get('authorization') === `Bearer ${cron}`) return true;
  return false;
}

export async function GET(request) {
  if (!allowed(request)) return new Response('Not found', { status: 404 });
  try {
    const b = await refreshBulletin();
    // הכנת הקול מראש במערכת הראשית, כדי שהמתקשר הראשון לא יחכה.
    // לא בקול Chirp - שם כל הקראה עולה מהמכסה, אז מקריאים רק כשמישהו באמת מאזין
    const st = await getSettings().catch(() => ({}));
    if (!/Chirp/.test(String(st['voice.name'] || ''))) await say(bulletinText(b), { cache: true }).catch(() => {});
    return Response.json({ ok: true, items: b.items.length, createdAt: b.createdAt });
  } catch (e) {
    console.error('news-refresh:', e);
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
