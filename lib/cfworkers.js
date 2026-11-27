// כתובת נפרדת לכל מערכת: Worker קטן ב-Cloudflare עם שם אקראי,
// כך שכל מערכת מקבלת כתובת כמו https://x7k2p9.6130-ivr.workers.dev
// הטוקן: CLOUDFLARE_API_TOKEN (אפשר גם _2, _3 ... לחשבונות נוספים). כל חשבון חינמי - עד 100 Workers.
import { randomBytes } from 'node:crypto';

const API = 'https://api.cloudflare.com/client/v4';
const TOKENS = [process.env.CLOUDFLARE_API_TOKEN, ...Array.from({ length: 9 }, (_, i) => process.env[`CLOUDFLARE_API_TOKEN_${i + 2}`])]
  .map((t) => String(t || '').trim()).filter(Boolean);
export const cfEnabled = TOKENS.length > 0;
const ORIGIN = (process.env.PROXY_ORIGIN || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://yemot-ai-dusky.vercel.app')).replace(/\/$/, '');
const MAX_PER_ACCOUNT = 95; // מעט מתחת למגבלה של 100, להשאיר מקום לכתובת הביניים הראשית

// הקוד שרץ בכל Worker של מערכת: מעביר בקשות של ימות לשרת, ומוסיף את המפתח של המערכת
const WORKER_CODE = `const ROUTES = ['yemot', 'news', 'transit', 'translate', 'setup'];
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const r = url.pathname.replace(/^\\/+|\\/+$/g, '');
    if (!ROUTES.includes(r)) return new Response('Not found', { status: 404 });
    if (r !== 'setup') url.searchParams.set('k', env.SYS_KEY);
    const init = { method: request.method, headers: { 'content-type': request.headers.get('content-type') || '', 'x-proxy-key': env.PROXY_SECRET || '' } };
    if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
    const res = await fetch(env.ORIGIN + '/api/' + r + url.search, init);
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/plain; charset=utf-8' } });
  },
};`;

async function cf(token, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.success === false) throw new Error(`Cloudflare ${res.status}: ${JSON.stringify(d.errors || d).slice(0, 200)}`);
  return d.result;
}

// כל החשבונות שהטוקנים רואים, עם הסיומת (workers.dev) וכמה Workers יש בכל אחד
let acctCache = { at: 0, list: [] };
export async function cfAccounts(force = false) {
  if (!cfEnabled) return [];
  if (!force && Date.now() - acctCache.at < 10 * 60 * 1000 && acctCache.list.length) return acctCache.list;
  const list = [];
  for (const token of TOKENS) {
    const accs = await cf(token, '/accounts?per_page=50').catch(() => []);
    for (const a of accs || []) {
      if (list.some((x) => x.id === a.id)) continue;
      const sub = await cf(token, `/accounts/${a.id}/workers/subdomain`).then((r) => r?.subdomain).catch(() => null);
      const scripts = await cf(token, `/accounts/${a.id}/workers/scripts`).then((r) => r?.length || 0).catch(() => 0);
      list.push({ id: a.id, name: a.name, token, subdomain: sub, workers: scripts });
    }
  }
  acctCache = { at: Date.now(), list };
  return list;
}

const randName = () => 'k' + randomBytes(6).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 7).padEnd(7, 'x');

// יצירת Worker חדש למערכת. מחזיר { name, account, url }
export async function createSystemWorker(sysKey) {
  const accs = (await cfAccounts(true)).filter((a) => a.subdomain && a.workers < MAX_PER_ACCOUNT);
  if (!accs.length) throw new Error('אין חשבון Cloudflare פנוי (עם סיומת workers.dev ופחות מ-100 Workers)');
  const acc = accs.sort((a, b) => a.workers - b.workers)[0]; // פיזור בין החשבונות
  const name = randName();
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    main_module: 'worker.js',
    compatibility_date: '2026-11-01',
    bindings: [
      { type: 'plain_text', name: 'ORIGIN', text: ORIGIN },
      { type: 'plain_text', name: 'SYS_KEY', text: sysKey },
      { type: 'secret_text', name: 'PROXY_SECRET', text: process.env.PROXY_SECRET || '' },
    ],
  })], { type: 'application/json' }));
  form.append('worker.js', new Blob([WORKER_CODE], { type: 'application/javascript+module' }), 'worker.js');
  await cf(acc.token, `/accounts/${acc.id}/workers/scripts/${name}`, { method: 'PUT', body: form });
  await cf(acc.token, `/accounts/${acc.id}/workers/scripts/${name}/subdomain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
  acc.workers++;
  return { name, account: acc.id, url: `https://${name}.${acc.subdomain}.workers.dev` };
}

export async function deleteSystemWorker(account, name) {
  if (!account || !name) return;
  const acc = (await cfAccounts()).find((a) => a.id === account);
  if (!acc) return;
  await cf(acc.token, `/accounts/${account}/workers/scripts/${name}?force=true`, { method: 'DELETE' }).catch(() => {});
}

// ---------- דומיינים עם קידומת לכל מערכת ----------
// Worker אחד ("boti-hosts") על *.domain/* בכל דומיין: הקידומת עוברת לשרת כ-h והשרת מוצא לפיה את המערכת.
// הטוקן צריך הרשאות: Account > Workers Scripts > Edit, Zone > Workers Routes > Edit, Zone > DNS > Edit, Zone > Zone > Read.
const HOSTS_WORKER = 'boti-hosts';
const HOSTS_CODE = `const ALLOWED = ['yemot', 'news', 'transit', 'translate', 'setup', 'vote', 'vote-admin'];
const PER_SYSTEM = ['yemot', 'news', 'transit', 'translate'];
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const labels = url.hostname.split('.');
    const prefix = labels.length >= 3 ? labels[0] : '';
    if (!prefix || prefix === 'www') return fetch(request);
    if (url.pathname === '/__ping') return new Response('ok');
    const svc = url.pathname.replace(/^\\/(api\\/)?/, '').replace(/\\/$/, '');
    if (!/^[a-z0-9]{6,20}$/.test(prefix) || !ALLOWED.includes(svc)) return new Response('Not found', { status: 404 });
    if (PER_SYSTEM.includes(svc)) url.searchParams.set('h', prefix);
    const init = { method: request.method, headers: { 'content-type': request.headers.get('content-type') || '', 'x-proxy-key': env.PROXY_SECRET || '' } };
    if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
    const res = await fetch(env.ORIGIN + '/api/' + svc + url.search, init);
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/plain; charset=utf-8' } });
  },
};`;

// מקים/מעדכן את הכול: ה-Worker, רשומת * בכל דומיין, ו-Route. בטוח להריץ שוב ושוב.
export async function setupDomains(domains) {
  if (!cfEnabled) throw new Error('חסר CLOUDFLARE_API_TOKEN');
  const report = [];
  for (const token of TOKENS) {
    const zones = await cf(token, '/zones?per_page=50').catch(() => []);
    const mine = (zones || []).filter((z) => domains.includes(z.name));
    if (!mine.length) continue;
    const accountId = mine[0].account.id;
    // ה-Worker
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({
      main_module: 'worker.js',
      compatibility_date: '2026-11-01',
      bindings: [
        { type: 'plain_text', name: 'ORIGIN', text: ORIGIN },
        { type: 'secret_text', name: 'PROXY_SECRET', text: process.env.PROXY_SECRET || '' },
      ],
    })], { type: 'application/json' }));
    form.append('worker.js', new Blob([HOSTS_CODE], { type: 'application/javascript+module' }), 'worker.js');
    await cf(token, `/accounts/${accountId}/workers/scripts/${HOSTS_WORKER}`, { method: 'PUT', body: form });
    report.push({ step: 'worker', ok: true });
    for (const z of mine) {
      const r = { domain: z.name, status: z.status };
      try {
        // רשומת * (כתובת סמלית - ה-Worker עונה לפני שמגיעים אליה)
        const recs = await cf(token, `/zones/${z.id}/dns_records?name=${encodeURIComponent('*.' + z.name)}`);
        if (!recs.length) {
          await cf(token, `/zones/${z.id}/dns_records`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'AAAA', name: '*', content: '100::', proxied: true, ttl: 1, comment: 'boti - כתובות מערכות' }) });
          r.dns = 'נוצרה';
        } else r.dns = 'קיימת';
        // Route
        const pattern = `*.${z.name}/*`;
        const routes = await cf(token, `/zones/${z.id}/workers/routes`);
        const ex = routes.find((x) => x.pattern === pattern);
        if (!ex) {
          await cf(token, `/zones/${z.id}/workers/routes`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pattern, script: HOSTS_WORKER }) });
          r.route = 'נוצר';
        } else if (ex.script !== HOSTS_WORKER) {
          await cf(token, `/zones/${z.id}/workers/routes/${ex.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pattern, script: HOSTS_WORKER }) });
          r.route = 'עודכן';
        } else r.route = 'קיים';
        r.ok = true;
      } catch (e) { r.ok = false; r.error = String(e?.message || e).slice(0, 200); }
      report.push(r);
    }
  }
  if (!report.length) throw new Error('הטוקן לא רואה אף אחד מהדומיינים');
  return report;
}
