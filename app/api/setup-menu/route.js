// מייצר את הודעת התפריט הראשי בקול טבעי ומעלה אותה לימות (קובץ M1000 בשלוחה הראשית).
// כדי לשנות את התפריט: לעדכן את הטקסט כאן, להעלות, ולפתוח את הכתובת /api/setup-menu בדפדפן.
import { speakToPath } from '../../../lib/voice.js';
import { setSettings } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MENU_PATH = '/M1000';
const MENU_TEXT =
  'שלום. לעוזר החכם, הקישו אחת. למהדורת חדשות עדכנית, הקישו שתיים. לבוט התחבורה החכם, הקישו שלוש. לתרגומון החכם, הקישו חמש. לפודקאסט היומי של ינון מגל ובן כספית, הקישו שמונה. המערכת הוקמה באמצעות שש, אחת, שלוש, אפס. מערכות טלפוניה.';

export async function GET() {
  try {
    const result = await speakToPath(MENU_TEXT, MENU_PATH);
    await setSettings({ 'menu.text': MENU_TEXT }).catch(() => {}); // שהאתר יציג את הטקסט העדכני
    return Response.json({ status: 'ok', path: MENU_PATH, yemot: result, text: MENU_TEXT });
  } catch (err) {
    return Response.json({ status: 'error', error: String(err?.message || err) }, { status: 500 });
  }
}
