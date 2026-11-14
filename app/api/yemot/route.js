// שלב 1: נקודת החיבור שימות המשיח פונה אליה בכל שיחה.
// כרגע היא רק משמיעה הודעת "שלום" ומנתקת.

export const dynamic = 'force-dynamic';

// ימות מבינה תשובה בטקסט פשוט, לכן מחזירים text/plain
function yemotResponse(text) {
  return new Response(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function handle(request) {
  // ימות שולחת פרטים על השיחה (מספר המתקשר, מזהה שיחה וכו').
  // נרשום אותם ללוג כדי לראות ב-Vercel שהפנייה הגיעה.
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  if (request.method === 'POST') {
    try {
      const body = await request.formData();
      for (const [k, v] of body) params[k] = v;
    } catch {}
  }
  console.log('פנייה מימות:', params);

  // t- = הקראת טקסט. אחרי ההשמעה - ניתוק.
  // (בלי נקודות בטקסט: אצל ימות נקודה מפרידה בין הודעות)
  return yemotResponse(
    'id_list_message=t-שלום הגעת לשרת בהצלחה&go_to_folder=hangup'
  );
}

export const GET = handle;
export const POST = handle;
