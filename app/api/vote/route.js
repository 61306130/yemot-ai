// שלוחת ההצבעה של "המוכשר" - תוכנית הכישרונות של הישיבה.
// המתקשר שומע את רשימת המתמודדים, בוחר, מאשר - והקול נקלט. קול אחד לכל מספר טלפון.
// מי שכבר הצביע ומתקשר שוב - שומע למי הצביע, בלי אפשרות לשנות.
// להגדרה בימות (באותה מערכת או במערכת אחרת, עם הכתובת הציבורית):
//   type=api
//   api_link=https://<הדומיין>/api/vote
import { reply, readParams, digitsRead } from '../../../lib/yemot.js';
import { say, plainTts } from '../../../lib/voice.js';
import { getConfig, getCandidates, getMyVote, setVote } from '../../../lib/voting.js';
import { loadState, saveState, logError } from '../../../lib/store.js';

// ההצבעה רצה על מערכת ימות נפרדת. אם הוגדר VOTE_YEMOT_TOKEN - קול טבעי שמועלה למערכת ההיא.
// אחרת - הקראה רגילה של ימות (עובדת בכל מערכת בלי הגדרות).
const VT = process.env.VOTE_YEMOT_TOKEN;
const speak = (t, o = {}) => (VT ? say(t, { ...o, token: VT }) : Promise.resolve(plainTts(t)));

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  return handle(request);
}
export async function POST(request) {
  return handle(request);
}

const WAIT = 15; // שניות להקשה
const MAX_SILENT = 3; // כמה פעמים בלי הקשה לפני ניתוק

async function handle(request) {
  const p = await readParams(request);
  if (p.hangup === 'yes') return reply('', 'הצבעה');
  const callId = p.ApiCallId || 'x';
  const phone = /^\d{5,}$/.test(p.ApiPhone || '') ? p.ApiPhone : `hidden-${callId}`;
  const key = `vote-${callId}`;

  const idx = Object.keys(p).filter((k) => /^v\d+$/.test(k)).map((k) => +k.slice(1));
  const n = idx.length ? Math.max(...idx) : 0;
  const input = n ? String(p[`v${n}`]) : null;
  const next = `v${n + 1}`;
  const hangup = async (text, opts = { cache: true }) =>
    reply(`id_list_message=${await speak(text, opts)}&go_to_folder=hangup`);

  try {
    const cfg = await getConfig();
    const candidates = await getCandidates();
    const show = cfg.title || 'המוכשר';
    const bye = 'ובהצלחה לכל המתמודדים!';

    if (!cfg.is_open) {
      return hangup(`שלום, הגעתם לקו ההצבעה של ${show}, תוכנית הכישרונות של הישיבה. ההצבעה סגורה כרגע. היא תיפתח במהלך התוכנית, אז נסו שוב בקרוב. להתראות!`);
    }
    if (!candidates.length) {
      return hangup(`שלום, הגעתם לקו ההצבעה של ${show}. המתמודדים עדיין לא עלו לבמה. נסו שוב בעוד כמה דקות. להתראות!`);
    }

    // עד 9 מתמודדים - הקשה אחת מספיקה. מעל 9 - מספר וסולמית
    const twoDigits = Math.max(...candidates.map((c) => c.num)) > 9;
    const listKey = `poll-list-r${cfg.round}`;
    const introText = `ברוכים הבאים להצבעה של ${show}, תוכנית הכישרונות של הישיבה! עכשיו זה בידיים שלכם: מי הכי מוכשר?`;
    const listText =
      candidates.map((c) => `ל${c.name}, הקישו ${c.num}.`).join(' ') +
      (twoDigits ? ' הקישו את מספר המתמודד, ובסיום סולמית.' : ' הקישו את מספר המתמודד.') +
      ' לשמיעת הרשימה שוב, הקישו אפס.';
    const askList = async (pre = []) =>
      reply(digitsRead([...pre, await speak(listText, { cache: true, name: listKey })], next, { min: 1, max: twoDigits ? 2 : 1, secWait: WAIT }));
    const askOne = async (text, opts = { cache: true }) =>
      reply(digitsRead([await speak(text, opts)], next, { min: 1, max: 1, secWait: WAIT }));

    let st = (n && (await loadState(key))) || null;

    // ---------- כניסה לשלוחה ----------
    if (!n || !st) {
      const mine = await getMyVote(phone);
      if (mine) {
        return hangup(
          `שלום, כבר הצבעת ל${mine.name} בהצבעה של ${show}. אפשר להצביע רק פעם אחת. תודה שהשתתפת, ${bye}`,
          { name: `vote-has-${callId}` }
        );
      }
      st = { stage: 'choose', silent: 0 };
      await saveState(key, st);
      return askList([await speak(introText, { cache: true })]);
    }

    // ---------- לא הקישו כלום ----------
    if (input === 'None') {
      st.silent = (st.silent || 0) + 1;
      await saveState(key, st);
      if (st.silent >= MAX_SILENT) {
        return hangup(
          st.stage === 'confirm'
            ? 'לא אישרת את הבחירה, ולכן הקול לא נקלט. אפשר להתקשר שוב ולהצביע. להתראות!'
            : 'לא נקלטה בחירה. אפשר להתקשר שוב ולהצביע. להתראות!'
        );
      }
      if (st.stage === 'choose') return askList([await speak('לא שמעתי בחירה. הנה הרשימה שוב.', { cache: true })]);
      if (st.stage === 'confirm') {
        const c = candidates.find((x) => x.num === st.num);
        return askOne(`לא שמעתי. בחרת ב${c?.name}. לאישור הקישו 1. לבחירה מחדש הקישו 2.`, { name: `vote-cf-${callId}` });
      }
    }
    st.silent = 0;

    // ---------- בחירת מתמודד ----------
    if (st.stage === 'choose') {
      if (input === '0') return askList();
      const c = candidates.find((x) => String(x.num) === String(Number(input)));
      if (!c) {
        return askList([await speak(`אין מתמודד במספר ${input}. נסו שוב.`, { name: `vote-bad-${callId}` })]);
      }
      st = { ...st, stage: 'confirm', num: c.num };
      await saveState(key, st);
      return askOne(`בחרת ב${c.name}. לאישור הקישו 1. לבחירה מחדש הקישו 2.`, { name: `vote-cf-${callId}` });
    }

    // ---------- אישור ----------
    if (st.stage === 'confirm') {
      if (input !== '1') {
        st = { stage: 'choose', silent: 0 };
        await saveState(key, st);
        return askList([await speak('בסדר, בחרו מחדש.', { cache: true })]);
      }
      const r = await setVote(phone, st.num);
      await saveState(key, { stage: 'done' });
      if (r.status === 'ok') {
        return hangup(`הקול שלך ל${r.candidate} נקלט! תודה שהשתתפת בהצבעה של ${show}, ${bye}`, { name: `vote-ok-${callId}` });
      }
      if (r.status === 'already') {
        return hangup(`כבר הצבעת ל${r.candidate}. אפשר להצביע רק פעם אחת. תודה, ${bye}`, { name: `vote-ok-${callId}` });
      }
      if (r.status === 'closed') {
        return hangup(`ההצבעה של ${show} כבר נסגרה, ולכן הקול לא נקלט. תודה שהתקשרתם, והישארו איתנו לתוצאות!`);
      }
      // המתמודד נמחק בינתיים
      st = { stage: 'choose', silent: 0 };
      await saveState(key, st);
      return askList([await speak('המתמודד הזה כבר לא ברשימה. בחרו שוב.', { cache: true })]);
    }

    // מצב לא צפוי - מתחילים מחדש
    await saveState(key, { stage: 'choose', silent: 0 });
    return askList();
  } catch (err) {
    logError('vote', err);
    return hangup('סליחה, הייתה תקלה במערכת ההצבעה. נסו שוב מאוחר יותר');
  }
}
