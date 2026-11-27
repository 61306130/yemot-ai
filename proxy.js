// אתר הניהול נגיש רק בכתובת אחת: https://<ADMIN_HOST>/<ADMIN_PATH>
// (ברירת מחדל ADMIN_HOST = mivzak360.site). בכל דומיין אחר, ובכל נתיב אחר - "לא נמצא".
// גם ה-API של אתר הניהול (/api/admin) עונה רק מאותו דומיין.
// השלוחות של ימות (/api/yemot, /api/news ...) לא מושפעות.
import { NextResponse } from 'next/server';

export const config = { matcher: ['/((?!_next/|icon|favicon).*)'] };

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export function proxy(req) {
  const secret = String(process.env.ADMIN_PATH || '').replace(/^\/+|\/+$/g, '');
  const adminHost = String(process.env.ADMIN_HOST || 'mivzak360.site').toLowerCase();
  const host = String(req.headers.get('host') || '').toLowerCase().split(':')[0];
  const onAdminHost = host === adminHost;
  const p = req.nextUrl.pathname;

  // ה-API של אתר הניהול - רק מהדומיין של הניהול
  if (p === '/api/admin' || p.startsWith('/api/admin/')) return secret && !onAdminHost ? notFound() : NextResponse.next();
  if (p.startsWith('/api/')) return NextResponse.next();
  if (!secret) return NextResponse.next();

  if (onAdminHost && (p === `/${secret}` || p.startsWith(`/${secret}/`))) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin' + p.slice(secret.length + 1);
    return NextResponse.rewrite(url);
  }
  if (p === '/' || p === '/admin' || p.startsWith('/admin/') || p === `/${secret}` || p.startsWith(`/${secret}/`)) return notFound();
  return NextResponse.next();
}
