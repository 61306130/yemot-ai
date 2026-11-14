// הפעלת הורדת הפודקאסט: אוטומטית פעם ביום (vercel.json), או ידנית מהדפדפן.
// הפעלה רגילה לא מורידה שוב פרק שכבר הועלה. ?force=1&key=... מעלה מחדש בכל מקרה.
import { runPodcast } from '../../../lib/podcast.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // המקסימום במסלול החינמי של Vercel

export async function GET(request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  const force = url.searchParams.get('force') === '1' && (!secret || url.searchParams.get('key') === secret);
  try {
    const result = await runPodcast({ force });
    return Response.json(result, { status: result.status === 'error' ? 500 : 200 });
  } catch (err) {
    console.error('פודקאסט:', err);
    return Response.json({ status: 'error', error: String(err?.message || err) }, { status: 500 });
  }
}
