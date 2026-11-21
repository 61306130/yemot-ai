// Cloudflare Worker - כתובת ציבורית שמסתירה את כתובת השרת האמיתית.
// מעביר רק את הבקשות של שלוחות הטלפון (/api/...) לשרת. אתר הניהול לא נגיש דרכו.
//
// הקמה ב-Cloudflare: Workers -> Create -> להדביק את הקובץ -> Deploy.
// ואז ב-Settings -> Variables של ה-Worker להוסיף:
//   ORIGIN        = הכתובת האמיתית של השרת (לא נשמרת כאן, כי הקוד ציבורי)
//   PROXY_SECRET  = מחרוזת סודית ארוכה (אותה מחרוזת מגדירים גם ב-Vercel)
// וב-Vercel: PUBLIC_BASE_URL = כתובת ה-Worker, PROXY_SECRET = אותה מחרוזת.
const ALLOWED = ['yemot', 'news', 'transit', 'translate', 'setup', 'vote', 'vote-admin'];
// כתובת אישית לכל מערכת: /<מפתח המערכת>/<שירות>
const PER_SYSTEM = ['yemot', 'news', 'transit', 'translate'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const own = url.pathname.match(/^\/([a-f0-9]{16,64})\/([a-z]+)\/?$/);
    if (own && PER_SYSTEM.includes(own[2])) {
      url.searchParams.set('k', own[1]);
      url.pathname = '/api/' + own[2];
    }
    const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
    if (!env.ORIGIN || !url.pathname.startsWith('/api/') || !ALLOWED.includes(route)) {
      return new Response('Not found', { status: 404 });
    }
    const res = await fetch(env.ORIGIN.replace(/\/$/, '') + url.pathname + url.search, {
      method: request.method,
      headers: {
        'content-type': request.headers.get('content-type') || '',
        'x-proxy-key': env.PROXY_SECRET || '',
      },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    });
    // מחזירים רק את התוכן - בלי כותרות שחושפות את השרת
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'text/plain; charset=utf-8' },
    });
  },
  // טריגר מתוזמן (Settings -> Triggers -> Cron: */30 * * * *): בניית מהדורת חדשות כל חצי שעה
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch(env.ORIGIN.replace(/\/$/, '') + '/api/news-refresh', { headers: { 'x-proxy-key': env.PROXY_SECRET || '' } }));
  },
};
