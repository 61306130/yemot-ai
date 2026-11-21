// שלוחת "פתיחת מערכת משלכם": מקימה במערכת ימות של המתקשר את העוזר החכם, החדשות,
// התחבורה והתרגומון. מי שאין לו מערכת - מועבר לימות המשיח לפתיחת מערכת חדשה.
// להגדרה בימות:
//   type=api
//   api_link=https://<הדומיין>/api/setup
import { reply, readParams, digitsRead, tapRead } from '../../../lib/yemot.js';
import { say, speakToPath } from '../../../lib/voice.js';
import { checkLogin, provisionSystem } from '../../../lib/systems.js';
import { loadState, saveState, logError } from '../../../lib/store.js';
import { hasDb, sql } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// מי שאין לו מערכת עובר לשלוחה הזו במערכת הראשית, שמוגדרת כהעברה למערכת אחרת בימות:
//   type=routing_yemot
//   routing_yemot_number=0773137770
const NEW_SYSTEM_FOLDER = process.env.SETUP_ROUTING_FOLDER || '/99';
const spell = (d) => String(d).split('').join(' ');

async function handle(request) {
  const p = await readParams(request);
  if (p.hangup === 'yes') return reply('');
  const callId = p.ApiCallId || 'x';
  const phone = /^\d{5,}$/.test(p.ApiPhone || '') ? p.ApiPhone : '';
  const key = `setup-${callId}`;
  const idx = Object.keys(p).filter((k) => /^q\d+$/.test(k)).map((k) => +k.slice(1));
  const n = idx.length ? Math.max(...idx) : 0;
  const input = n ? String(p[`q${n}`]) : null;
  const next = `q${n + 1}`;
  const S = (t) => say(t, { cache: true });
  const ask1 = async (text, sec = 15) => reply(tapRead([await S(text)], next, sec));
  const askDigits = async (text, min, max) => reply(digitsRead([await S(text)], next, { min, max, secWait: 20 }));
  const bye = async (text) => reply(`id_list_message=${await S(text)}&go_to_folder=hangup`);

  try {
    let st = (n && (await loadState(key))) || null;
    const save = (x) => saveState(key, (st = { ...st, ...x }));

    if (!n || !st) {
      st = {};
      await save({ stage: 'has', tries: 0 });
      return ask1(
        'שלום! כאן אפשר להקים לעצמכם, בחינם, מערכת טלפונית משלכם עם העוזר החכם, מהדורת החדשות, בוט התחבורה והתרגומון. ' +
          'אם כבר יש לכם מערכת בימות המשיח, הקישו 1. אם עדיין אין לכם מערכת, הקישו 2.'
      );
    }
    if (input === 'None') {
      if ((st.silent = (st.silent || 0) + 1) >= 3) return bye('לא נקלטה בחירה. להתראות!');
      await save({});
    }

    // ---------- יש מערכת? ----------
    if (st.stage === 'has') {
      if (input === '2') {
        // מעבירים לימות המשיח לפתיחת מערכת. אחר כך חוזרים אלינו ומקישים 1
        const msg = await S(
          'מעבירים אתכם עכשיו לימות המשיח לפתיחת מערכת חדשה בחינם. בתפריט שלהם הקישו 3 לפתיחת מערכת. ' +
            'כשתתבקשו לבחור סיסמה, בחרו סיסמה פשוטה מספרות בלבד, ורשמו אותה בצד. בסיום תקבלו שיחה עם מספר המערכת החדשה שלכם. ' +
            'אחר כך התקשרו אלינו שוב, היכנסו לשלוחה הזו והקישו 1, ונקים לכם את כל השירותים. בהצלחה!'
        );
        return reply(`id_list_message=${msg}&go_to_folder=${NEW_SYSTEM_FOLDER}`);
      }
      if (input !== '1') return ask1('אם כבר יש לכם מערכת בימות המשיח, הקישו 1. אם אין לכם, הקישו 2.');
      await save({ stage: 'did' });
      return askDigits('הקישו את מספר המערכת שלכם, כולל הקידומת, ובסיום סולמית.', 9, 10);
    }

    // ---------- מספר המערכת ----------
    if (st.stage === 'did') {
      if (!/^0\d{8,9}$/.test(input || '')) {
        if (++st.tries > 3) return bye('לא הצלחנו לקלוט את מספר המערכת. נסו שוב מאוחר יותר. להתראות!');
        await save({});
        return askDigits('המספר לא תקין. הקישו את מספר המערכת המלא, למשל אפס שבע שבע ועוד שבע ספרות, ובסיום סולמית.', 9, 10);
      }
      await save({ stage: 'did_ok', did: input });
      return reply(tapRead([await say(`הקשתם: ${spell(input)}. אם המספר נכון, הקישו 1. לתיקון, הקישו 2.`, { name: `setup-${callId}-d` })], next, 15));
    }
    if (st.stage === 'did_ok') {
      if (input !== '1') {
        await save({ stage: 'did' });
        return askDigits('הקישו שוב את מספר המערכת, ובסיום סולמית.', 9, 10);
      }
      await save({ stage: 'pw' });
      return askDigits('עכשיו הקישו את הסיסמה של המערכת, ובסיום סולמית.', 1, 15);
    }

    // ---------- סיסמה + בדיקה ----------
    if (st.stage === 'pw') {
      const pw = input && input !== 'None' ? input : '';
      if (!pw || !(await checkLogin(st.did, pw))) {
        if (++st.tries > 3) return bye('מספר המערכת או הסיסמה אינם נכונים. בדקו את הפרטים ונסו שוב מאוחר יותר. להתראות!');
        await save({ stage: 'did' });
        return askDigits('לא הצלחנו להתחבר למערכת. ייתכן שהמספר או הסיסמה שגויים. נתחיל שוב: הקישו את מספר המערכת, ובסיום סולמית.', 9, 10);
      }
      await save({ stage: 'confirm', pw });
      return ask1(
        'התחברנו למערכת שלכם. שימו לב: המערכת תעבור איפוס, והתפריט הראשי ושלוחות 1 עד 4 יוחלפו בשירותים שלנו. ' +
          'קבצים ושלוחות אחרים לא יימחקו. כדי שהשירותים יעבדו, הסיסמה תישמר אצלנו. ' +
          'לאישור ההקמה, הקישו 1. לביטול, הקישו כוכבית.',
        20
      );
    }

    // ---------- הקמה ----------
    if (st.stage === 'confirm') {
      if (input !== '1') return bye('ההקמה בוטלה. לא שינינו כלום במערכת שלכם. להתראות!');
      let ownerName = null;
      if (hasDb && phone) ownerName = (await sql`select name from callers where phone = ${phone}`.catch(() => []))[0]?.name || null;
      const baseUrl = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
      await provisionSystem({ did: st.did, password: st.pw, ownerPhone: phone, ownerName, baseUrl, speakMenu: speakToPath });
      await save({ stage: 'done', pw: null });
      return bye(
        `המערכת שלכם מוכנה! התקשרו למספר ${spell(st.did)} ותשמעו את התפריט החדש: ` +
          'אחת לעוזר החכם, שתיים לחדשות, שלוש לתחבורה, וארבע לתרגומון. ובכוכבית, כל מי שמתקשר אליכם יוכל לפתוח מערכת משלו. תהנו!'
      );
    }

    await saveState(key, { stage: 'has', tries: 0 });
    return ask1('אם כבר יש לכם מערכת בימות המשיח, הקישו 1. אם אין לכם, הקישו 2.');
  } catch (err) {
    logError('setup', err);
    return bye('סליחה, הייתה תקלה בהקמת המערכת. נסו שוב בעוד כמה דקות.');
  }
}

export const GET = handle;
export const POST = handle;
