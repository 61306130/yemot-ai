// ניקוי יומי - מופעל אוטומטית על ידי Vercel Cron (ראו vercel.json)
import { runCleanup } from '../../../lib/cleanup.js';
import { logError } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const auth = request.headers.get('authorization') || '';
  const ua = request.headers.get('user-agent') || '';
  const ok = process.env.CRON_SECRET ? auth === `Bearer ${process.env.CRON_SECRET}` : ua.includes('vercel-cron');
  if (!ok) return Response.json({ ok: false, error: 'לא מורשה' }, { status: 401 });
  try {
    return Response.json({ ok: true, report: await runCleanup() });
  } catch (err) {
    logError('cleanup', err);
    return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
