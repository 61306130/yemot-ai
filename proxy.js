// כתובת סודית לאתר הניהול: אם מוגדר ADMIN_PATH ב-Vercel (למשל "nihul-7x"),
// אתר הניהול נפתח רק בכתובת /<ADMIN_PATH> (בכל דומיין, כולל mivzak360.site),
// והכתובות /admin ו-/ מחזירות "לא נמצא". בלי ADMIN_PATH - הכול כמו קודם (/admin).
import { NextResponse } from 'next/server';

export const config = { matcher: ['/((?!_next/|api/|icon|favicon).*)'] };

export function proxy(req) {
  const secret = String(process.env.ADMIN_PATH || '').replace(/^\/+|\/+$/g, '');
  if (!secret) return NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p === `/${secret}` || p.startsWith(`/${secret}/`)) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin' + p.slice(secret.length + 1);
    return NextResponse.rewrite(url);
  }
  if (p === '/' || p === '/admin' || p.startsWith('/admin/')) {
    return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return NextResponse.next();
}
