// Cloudflare Worker - כתובת ציבורית שמסתירה את כתובת השרת האמיתית.
// מעביר רק את הבקשות של שלוחות הטלפון (/api/...) לשרת ב-Vercel. אתר הניהול לא נגיש דרכו.
// הקמה: Cloudflare -> Workers -> Create -> להדביק את הקובץ הזה -> Deploy.
// אחר כך ב-Vercel: PUBLIC_BASE_URL = הכתובת של ה-Worker (למשל https://kav.<שם>.workers.dev)
const ORIGIN = 'https://yemot-ai-dusky.vercel.app';
const ALLOWED = ['yemot', 'news', 'transit', 'translate', 'setup', 'vote', 'vote-admin'];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
    if (!url.pathname.startsWith('/api/') || !ALLOWED.includes(route)) {
      return new Response('Not found', { status: 404 });
    }
    const target = ORIGIN + url.pathname + url.search;
    const res = await fetch(target, {
      method: request.method,
      headers: { 'content-type': request.headers.get('content-type') || '' },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    });
    // מחזירים רק את התוכן - בלי כותרות שחושפות את השרת
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/plain; charset=utf-8' } });
  },
};
