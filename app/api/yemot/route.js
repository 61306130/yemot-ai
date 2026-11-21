// שלב 2: שיחה עם AI.
// המתקשר מדבר -> ימות מקליטה -> השרת מוריד את ההקלטה מימות ->
// Gemini מבין את ההקלטה ועונה -> ימות מקריאה את התשובה -> חוזר חלילה.

import { hasDb, sql, startCall, getHistory, saveTurn, endCall } from '../../../lib/db.js';
import { transcribe, answer as aiAnswer, searchAnswer } from '../../../lib/ai.js';
import { say, callFileName } from '../../../lib/voice.js';
import { getSettings, logError, loadState, saveState } from '../../../lib/store.js';
import { recordRead as recordAs, tapRead } from '../../../lib/yemot.js';
import { resolveSystem, enterSystem, currentToken } from '../../../lib/systems.js';

// ניקוי שם שהמתקשר אמר ("שמי ישראל כהן" -> "ישראל כהן")
function cleanName(t) {
  return String(t || '')
    .replace(/[.,!?"'״׳:;()\-]/g, ' ')
    .replace(/^\s*(שלום|היי)?\s*(השם שלי( הוא)?|שמי|קוראים לי|אני|זה)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ');
}

// רישום שם בשיחה הראשונה: הקלטה -> תמלול -> אישור -> שמירה. מחזיר תשובה לימות, או null כשסיימנו
async function nameFlow(p, callId, phone) {
  const a = Object.keys(p).filter((k) => /^nm\d+$/.test(k)).length;
  const b = Object.keys(p).filter((k) => /^nc\d+$/.test(k)).length;
  const key = `name-${callId}`;
  const st = (await loadState(key)) || { stage: 'name', tries: 0 };
  const askName = async (text) => {
    await saveState(key, { ...st, stage: 'name', tries: (st.tries || 0) + 1 });
    return reply(recordAs([await say(text, { cache: true })], `nm${a + 1}`));
  };
  const start = async (greeting) => reply(recordRead(await say(greeting, { cache: true }), 1));

  if (st.stage === 'name') {
    if ((st.tries || 0) >= 4) return start('בסדר, נמשיך בלי שם. שאל אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית');
    let name = '';
    try {
      const audio = await downloadRecording(p[`nm${a}`], p.ApiExtension);
      name = cleanName((await transcribe(audio, 'שם פרטי ושם משפחה בעברית')).text);
    } catch (e) {
      console.error('רישום שם:', String(e?.message || e).slice(0, 200));
    }
    if (!name) return askName('לא שמעתי. אמרו את השם הפרטי ושם המשפחה אחרי הצליל, ובסיום הקישו סולמית');
    if (name.split(' ').length < 2) return askName('אנחנו צריכים גם שם משפחה. אמרו את השם הפרטי ושם המשפחה ביחד, אחרי הצליל, ובסיום הקישו סולמית');
    await saveState(key, { ...st, stage: 'confirm', name });
    return reply(tapRead([await say(`שמעתי: ${name}. אם זה נכון, הקישו 1. להקלטה מחדש, הקישו 2.`, { name: `nm-${callId}` })], `nc${b + 1}`, 10));
  }
  // אישור
  const v = String(p[`nc${b}`] || '');
  if (v === '1' && st.name) {
    await sql`update callers set name = ${st.name} where phone = ${phone}`.catch((e) => console.error('שמירת שם:', e));
    await saveState(key, { stage: 'done' });
    return start(`נעים מאוד, ${st.name}! מעכשיו אזכור אותך. עכשיו אפשר לשאול אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית`);
  }
  return askName('בסדר, ננסה שוב. אמרו את השם הפרטי ושם המשפחה אחרי הצליל, ובסיום הקישו סולמית');
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HAS_AI = Boolean(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY);
// טוקן לימות בפורמט: מספר_מערכת:סיסמה
const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `אתה "העוזר החכם" של קו טלפון: ידען, חם ומדויק, שמדבר בעברית טבעית בשיחת טלפון.
המטרה שלך: שהמתקשר ינתק עם תשובה שבאמת עזרה לו.

איך לענות:
- התאם את האורך לשאלה. שאלה פשוטה (עובדה, שעה, הגדרה) - תשובה ישירה במשפט עד שלושה. שאלה שדורשת הסבר, עצה, השוואה או הוראות - תשובה מלאה ומועילה, עד בערך עשרה משפטים.
- פתח בתשובה העיקרית, ורק אחר כך פרטים והסבר. כמו אדם שמסביר בעל פה.
- תן תוכן אמיתי: עובדות, מספרים, שמות, צעדים מעשיים ודוגמאות. לא משפטים כלליים ומתחמקים, ולא "תלוי" בלי להסביר במה זה תלוי.
- כשנותנים הוראות או כמה אפשרויות, אמור אותן בסדר ברור: "ראשית... שנית... ולבסוף...".
- ההקלטה מתומללת אוטומטית ועלולה להכיל שגיאות. נחש את הכוונה לפי ההקשר וענה. שאל שאלת הבהרה רק אם באמת אי אפשר להבין.
- אם אינך יודע או לא בטוח - אמור זאת בכנות, ואל תמציא עובדות, מספרים או ציטוטים.
- לעולם אל תמסור מהזיכרון מחיר, תעריף, שער, שעות פתיחה, לוח זמנים או נתון אחר שמשתנה עם הזמן. נתונים כאלה מוסרים רק אם מצאת אותם עכשיו בחיפוש.
- אם הנושא רחב וקיצרת, סיים במשפט קצר שמציע להרחיב.

ההקראה בקול:
- בלי רשימות, כוכביות, אימוג'י, קישורים, סוגריים או סימנים מיוחדים.
- מספרים קצרים כתוב במילים.

ייתכן שההודעות הקודמות בשיחה הן משיחות טלפון קודמות עם אותו מתקשר. השתמש בהן כדי לזכור מה סיפר לך ועל מה דיברתם.`;

// הוראה לשלב הראשון: להחליט אם צריך חיפוש באינטרנט
const SEARCH_RULE = `
אין לך גישה ישירה לאינטרנט. אם כדי לענות נכון צריך מידע עדכני מהאינטרנט
(חדשות, אירועים מהימים האחרונים, מזג אוויר, תוצאות ספורט, מחירים, שערי מטבע, לוחות זמנים, או כשהמתקשר מבקש במפורש לחפש),
ענה רק במילה SEARCH ובלי שום דבר נוסף. בכל מקרה אחר ענה כרגיל.`;

// שאלות שחייבות מידע עדכני - הולכות ישר לחיפוש, בלי לתת למודל להחליט (ולנחש מהזיכרון)
const MUST_SEARCH = new RegExp(
  [
    'כמה (זה )?(עולה|עולים|עולות|יעלה|תעלה|יעלו|מחיר)', 'מחיר', 'מחירים', 'תעריף', 'עלות', 'בכמה', 'שקל', 'דולר', 'יורו', 'שער',
    'מזג (ה)?אוויר', 'גשם', 'טמפרטורה', 'חדשות', 'מה קרה', 'מה חדש', 'עדכני', 'היום', 'אתמול', 'מחר', 'השבוע', 'עכשיו', 'כרגע',
    'תוצא(ה|ות) (של )?ה?משחק', 'מי ניצח', 'שעות פתיחה', '(פתוח|סגור|פתוחה|סגורה) (עכשיו|היום|מחר|בשבת)', 'מתי (יוצא|נפתח|נסגר|מתחיל)', 'לוח זמנים', 'זמני (תפילה|שבת|הדלקת)',
    'כניסת שבת', 'צאת (ה)?שבת', 'מבצע', 'הנחה', 'משכורת', 'שכר מינימום', 'קצבה', 'ריבית', 'מניה', 'ביטקוין', 'בחירות', 'סקר',
  ].join('|')
);

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
    encodeURIComponent(currentToken() || YEMOT_TOKEN) +
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
  // מערכת של משתמש (k) - הקבצים וההקלטות עוברים דרך הטוקן שלה
  const sys = await resolveSystem(p, request).catch(() => ({}));
  if (sys.denied) return reply(`id_list_message=t-${sys.denied.replace(/[.,]/g, ' ')}&go_to_folder=hangup`);
  enterSystem(sys);

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

  // רישום שם (שיחה ראשונה) - יש תשובות לשלב השם ועוד אין שאלות
  if (n === 0 && hasDb && Object.keys(p).some((k) => /^(nm|nc)\d+$/.test(k))) {
    try {
      return await nameFlow(p, callId, phone);
    } catch (e) {
      logError('ai-call', e);
      return reply(recordRead(await say('שאל אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית', { cache: true }), 1));
    }
  }

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
        // מתקשר בלי שם (בדרך כלל - פעם ראשונה) - קודם מבקשים שם פרטי ושם משפחה
        if (!caller.name && !phone.startsWith('hidden')) {
          await saveState(`name-${callId}`, { stage: 'name', tries: 1 });
          return reply(
            recordAs(
              [await say('שלום וברוכים הבאים לעוזר החכם! לפני שנתחיל, נשמח להכיר. אמרו את השם הפרטי ושם המשפחה שלכם אחרי הצליל, ובסיום הקישו סולמית', { cache: true })],
              'nm1'
            )
          );
        }
        if (previousMessages === 0 && caller.name) {
          greeting = `שלום ${caller.name}! אני העוזר החכם. שאל אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית`;
        } else if (previousMessages > 0) {
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
    // מגבלת שאלות יומית לכל מתקשר - כדי שאדם אחד לא יגמור את המכסה לכולם
    const limit = Number((await getSettings().catch(() => ({})))['bot.dailyLimit']) || 0;
    if (limit > 0 && hasDb && !phone.startsWith('hidden')) {
      const [{ n: today }] = await sql`select count(*)::int as n from messages
        where phone = ${phone} and role = 'user' and created_at > date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem'`.catch(() => [{ n: 0 }]);
      if (today >= limit) {
        return reply(`id_list_message=${await say(`הגעת למספר השאלות המקסימלי להיום, ${limit} שאלות. אפשר לחזור ולשאול מחר. להתראות!`, { cache: true })}&go_to_folder=hangup`);
      }
    }

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
    const deadline = Date.now() + 22000; // זמן כולל לתשובה, כדי שימות לא תנתק
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
    const forceSearch = searchOn && MUST_SEARCH.test(transcript);
    let { text: answer, provider: aiBy } = forceSearch
      ? { text: 'SEARCH', provider: 'ניתוב ישיר לחיפוש' }
      : await aiAnswer(
          BASE + (searchOn ? '\n' + SEARCH_RULE : '\nאין לך גישה לאינטרנט כרגע. אם שואלים על מחיר או נתון עדכני, אמור שאינך יכול לבדוק אותו עכשיו.') + '\n\n' + nowText(),
          convo,
          deadline
        );
    // ה-AI ביקש חיפוש באינטרנט
    if (/^\W*SEARCH\W*$/i.test(answer.trim())) {
      try {
        ({ text: answer, provider: aiBy } = await searchAnswer(
          BASE +
            '\nחפש באינטרנט את המידע העדכני וענה רק על סמך מה שמצאת בחיפוש. ' +
            'כשאתה מוסר מחיר או נתון, אמור במילים מאיפה הוא, למשל "לפי האתר של רב קו", בלי כתובות אתרים. ' +
            'אם מצאת כמה מחירים שונים (למשל לפי סוג כרטיס או אזור), אמור את ההבדלים בקצרה. ' +
            'אם לא מצאת מידע ברור - אמור שלא הצלחת למצוא נתון מדויק, ואל תנחש.\n\n' + nowText(),
          convo,
          deadline
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
    if (err?.busy) {
      logError('ai-busy', err);
      return reply(`id_list_message=${await say('יש כרגע עומס גדול על העוזר החכם. נסו שוב בעוד כמה דקות. תודה על הסבלנות!', { cache: true })}&go_to_folder=/`);
    }
    logError('ai-call', err);
    return reply(recordRead(await say('סליחה, הייתה תקלה. נסה לשאול שוב אחרי הצליל', { cache: true }), n + 1));
  }
}

export const GET = handle;
export const POST = handle;
