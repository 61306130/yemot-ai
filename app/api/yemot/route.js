// שלב 2: שיחה עם AI.
// המתקשר מדבר -> ימות מקליטה -> השרת מוריד את ההקלטה מימות ->
// Gemini מבין את ההקלטה ועונה -> ימות מקריאה את התשובה -> חוזר חלילה.

import { hasDb, startCall, getHistory, saveTurn, endCall } from '../../../lib/db.js';
import { transcribe, answer as aiAnswer, searchAnswer } from '../../../lib/ai.js';
import { say, callFileName } from '../../../lib/voice.js';
import { getSettings, logError } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HAS_AI = Boolean(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY);
// טוקן לימות בפורמט: מספר_מערכת:סיסמה
const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `אתה עוזר קולי ידידותי שמדבר בעברית בשיחת טלפון.
התשובות שלך מוקראות בקול, ולכן:
- ענה בקצרה, בדרך כלל 2 עד 4 משפטים.
- בלי רשימות, כוכביות, אימוג'י, קישורים או סימנים מיוחדים.
- כתוב מספרים במילים כשזה קצר.
אם לא שמעת או לא הבנת את השאלה, בקש בנימוס לחזור עליה.
ייתכן שההודעות הקודמות בשיחה הן משיחות טלפון קודמות עם אותו מתקשר. השתמש בהן כדי לזכור מה סיפר לך ועל מה דיברתם.`;

// הוראה לשלב הראשון: להחליט אם צריך חיפוש באינטרנט
const SEARCH_RULE = `
אין לך גישה ישירה לאינטרנט. אם כדי לענות נכון צריך מידע עדכני מהאינטרנט
(חדשות, אירועים מהימים האחרונים, מזג אוויר, תוצאות ספורט, מחירים, שערי מטבע, לוחות זמנים, או כשהמתקשר מבקש במפורש לחפש),
ענה רק במילה SEARCH ובלי שום דבר נוסף. בכל מקרה אחר ענה כרגיל.`;

// התאריך והשעה העכשוויים בישראל - נשלחים ל-AI בכל פנייה
function nowText() {
  const now = new Date();
  const tz = { timeZone: 'Asia/Jerusalem' };
  const time = now.toLocaleTimeString('he-IL', { ...tz, hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('he-IL', { ...tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heb = now.toLocaleDateString('he-IL-u-ca-hebrew', { ...tz, day: 'numeric', month: 'long', year: 'numeric' });
  return `מידע עדכני: עכשיו השעה ${time} בישראל. התאריך היום: ${date}, ${heb}. השתמש במידע הזה כששואלים על שעה או תאריך.`;
}

// זיכרון שיחה זמני (בשלב הבא יעבור למסד נתונים)
const memory = globalThis.__yemotMemory || (globalThis.__yemotMemory = new Map());

function reply(text) {
  console.log('תשובה לימות:', text);
  return new Response(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// ימות לא מקבלת בטקסט להקראה: . - " ' & | = ,
// לכן מפצלים לפי משפטים, וכל משפט הופך להודעה נפרדת (t-)
function toYemotText(text) {
  const parts = String(text)
    .replace(/[*#_`~>\[\]()]/g, ' ')
    .split(/[.!?\n]+/)
    .map((s) => s.replace(/[.\-"'&|=,]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!parts.length) return 't-סליחה לא הבנתי';
  return parts.map((p) => 't-' + p).join('.');
}

// בקשת הקלטה מהמתקשר. msg = הודעה מוכנה לימות (f-... או t-...)
function recordRead(msg, n) {
  const ops = [
    `rec${n}`, // שם המשתנה
    'no',      // לא לבקש שוב אם כבר קיים
    'record',  // מצב הקלטה
    '',        // תיקייה (ברירת מחדל: השלוחה הנוכחית)
    '',        // שם קובץ (אוטומטי)
    'no',      // בלי תפריט אישור אחרי ההקלטה
    'yes',     // לשמור גם אם ניתקו באמצע
    'no',      // לא להוסיף לקובץ קיים
    '1',       // אורך מינימלי בשניות
    '60',      // אורך מקסימלי בשניות
  ];
  return `read=${msg}=${ops.join(',')}`;
}

async function downloadRecording(value, extension) {
  let path = String(value);
  if (!path.includes('/')) path = `/${extension || ''}/${path}`;
  if (!path.startsWith('/')) path = '/' + path;
  path = path.replace(/\/+/g, '/');
  if (!/\.\w{2,4}$/.test(path)) path += '.wav';

  const url =
    'https://www.call2all.co.il/ym/api/DownloadFile?token=' +
    encodeURIComponent(YEMOT_TOKEN) +
    '&path=' +
    encodeURIComponent('ivr2:' + path);
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('json') || buf.length < 500) {
    throw new Error(`הורדת ההקלטה נכשלה (${res.status}) ${path}: ${buf.toString().slice(0, 200)}`);
  }
  return buf;
}

async function handle(request) {
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);
  if (request.method === 'POST') {
    try {
      const body = await request.formData();
      for (const [k, v] of body) p[k] = v;
    } catch {}
  }
  console.log('פנייה מימות:', p);

  const callId = p.ApiCallId || 'unknown';
  // מזהים את המתקשר לפי מספר הטלפון (מספר חסוי - בלי זיכרון בין שיחות)
  const phone = /^\d{5,}$/.test(p.ApiPhone || '') ? p.ApiPhone : `hidden-${callId}`;

  // המתקשר ניתק
  if (p.hangup === 'yes') {
    memory.delete(callId);
    if (hasDb) await endCall(callId).catch((e) => console.error('endCall:', e));
    return reply('');
  }

  if (!HAS_AI || !YEMOT_TOKEN) {
    return reply('id_list_message=t-השרת עדיין לא הוגדר&go_to_folder=hangup');
  }

  // ההקלטה האחרונה ששלחה ימות (rec1, rec2, ...)
  const recs = Object.keys(p)
    .filter((k) => /^rec\d+$/.test(k))
    .map((k) => Number(k.slice(3)))
    .sort((a, b) => a - b);
  const n = recs.length ? recs[recs.length - 1] : 0;

  // כניסה לשלוחה: זיהוי המתקשר, הודעת פתיחה ובקשת הקלטה ראשונה
  if (n === 0) {
    const cfg = await getSettings().catch(() => ({}));
    let greeting = cfg['bot.greeting'] || 'שלום. אני העוזר החכם. שאל אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית';
    if (hasDb) {
      try {
        const { caller, previousMessages } = await startCall(callId, phone);
        if (caller.blocked) {
          return reply('id_list_message=t-הגישה למערכת חסומה&go_to_folder=hangup');
        }
        if (previousMessages > 0) {
          const name = caller.name ? ` ${caller.name}` : '';
          greeting = `שלום${name}, טוב לשמוע ממך שוב. אני זוכר על מה דיברנו. אפשר להמשיך מאיפה שעצרנו או לשאול משהו חדש. דבר אחרי הצליל ובסיום הקש סולמית`;
        }
      } catch (e) {
        console.error('startCall:', e);
      }
    }
    return reply(recordRead(await say(greeting, { cache: true }), 1));
  }

  try {
    const audio = await downloadRecording(p[`rec${n}`], p.ApiExtension);

    let history = memory.get(callId) || [];
    if (hasDb) {
      try {
        history = await getHistory(phone);
      } catch (e) {
        console.error('getHistory:', e);
      }
    }

    const { text: transcript, provider: sttBy } = await transcribe(audio);
    if (!transcript) {
      return reply(recordRead(await say('לא שמעתי אותך. נסה לדבר שוב אחרי הצליל, ובסיום הקש סולמית', { cache: true }), n + 1));
    }
    const convo = [...history, { role: 'user', text: transcript }];
    const st = await getSettings().catch(() => ({}));
    const NIQQUD =
      st['bot.niqqud'] !== false
        ? '\n- התשובה מוקראת על ידי מנוע הקראה שמתבלבל במילים בלי ניקוד. הוסף ניקוד מלא ומדויק למילים שאפשר לקרוא ביותר מדרך אחת, לשמות של אנשים ומקומות ולמילים לועזיות. מילים ברורות השאר בלי ניקוד.'
        : '';
    const BASE = SYSTEM_PROMPT + NIQQUD + (st['bot.prompt'] ? '\n\nהוראות נוספות מהמנהל:\n' + st['bot.prompt'] : '');
    const searchOn = st['bot.search'] !== false;
    let { text: answer, provider: aiBy } = await aiAnswer(
      BASE + (searchOn ? '\n' + SEARCH_RULE : '') + '\n\n' + nowText(),
      convo
    );
    // ה-AI ביקש חיפוש באינטרנט
    if (/^\W*SEARCH\W*$/i.test(answer.trim())) {
      try {
        ({ text: answer, provider: aiBy } = await searchAnswer(
          BASE + '\nחפש באינטרנט את המידע העדכני וענה על סמך מה שמצאת. בלי קישורים ובלי ציון מקורות.\n\n' + nowText(),
          convo
        ));
      } catch (e) {
        // החיפוש לא זמין - עונים בכל זאת, בלי אינטרנט, ואומרים את זה למתקשר
        console.error('חיפוש לא זמין, עונה בלי אינטרנט:', String(e?.message || e).slice(0, 200));
        ({ text: answer, provider: aiBy } = await aiAnswer(
          BASE + '\nכרגע אין לך גישה לאינטרנט. אמור בקצרה שאינך יכול לבדוק מידע עדכני כרגע, וענה כמיטב ידיעתך אם אפשר. אל תענה במילה SEARCH.\n\n' + nowText(),
          convo
        ));
      }
    }
    console.log(`המתקשר אמר (${sttBy}):`, transcript, `| AI ענה (${aiBy}):`, answer);

    const mem = memory.get(callId) || [];
    mem.push({ role: 'user', text: transcript }, { role: 'model', text: answer });
    memory.set(callId, mem.slice(-20));
    if (hasDb) {
      await saveTurn(callId, phone, transcript, answer).catch((e) => console.error('saveTurn:', e));
    }

    // התשובה בקול טבעי (קובץ קבוע לכל שיחה), והשאלה הבאה מהמטמון
    const [answerMsg, nextMsg] = await Promise.all([
      say(answer, { name: callFileName(callId, n) }),
      say('אפשר לשאול עוד שאלה אחרי הצליל', { cache: true }),
    ]);
    return reply(`id_list_message=${answerMsg}&` + recordRead(nextMsg, n + 1));
  } catch (err) {
    logError('ai-call', err);
    return reply(recordRead(await say('סליחה, הייתה תקלה. נסה לשאול שוב אחרי הצליל', { cache: true }), n + 1));
  }
}

export const GET = handle;
export const POST = handle;
