// שלוחת ניהול ההצבעה (מוגנת בקוד). המנהל יכול: לשמוע תוצאות, לפתוח/לסגור הצבעה,
// לאפס, ולהגדיר שמות מועמדים בהקלטה. רוב הניהול נוח יותר מאתר הניהול.
// להגדרה בימות:
//   type=api
//   api_link=https://<הדומיין>/api/vote-admin
import { reply, readParams, tapRead, digitsRead, recordRead, downloadRecording } from '../../../lib/yemot.js';
import { say, plainTts } from '../../../lib/voice.js';
// ההצבעה רצה על מערכת ימות נפרדת. אם הוגדר VOTE_YEMOT_TOKEN - קול טבעי שמועלה למערכת ההיא.
// אחרת - הקראה רגילה של ימות (עובדת בכל מערכת בלי הגדרות).
const VT = process.env.VOTE_YEMOT_TOKEN;
const speak = (t, o = {}) => (VT ? say(t, { ...o, token: VT }) : Promise.resolve(plainTts(t)));

import { transcribe } from '../../../lib/ai.js';
import { loadState, saveState, getSetting, logError } from '../../../lib/store.js';
import {
  getConfig, getCandidates, getResults, setOpen, resetVotes, resetAll, setCandidate, MAX_CANDIDATES,
} from '../../../lib/voting.js';
import { warmVoting } from '../../../lib/voting-voice.js';
import { bg } from '../../../lib/bg.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_PIN = process.env.VOTE_ADMIN_PIN || '1234';

// ניסוח עברי תקין למספר קולות
function votesWord(nn) {
  nn = Number(nn);
  if (nn === 0) return 'אין קולות';
  if (nn === 1) return 'קול אחד';
  if (nn === 2) return 'שני קולות';
  return `${nn} קולות`;
}

export async function GET(request) {
  return handle(request);
}
export async function POST(request) {
  return handle(request);
}

const MENU =
  'תפריט הניהול של המוכשר. ' +
  'לשמיעת התוצאות, הקישו 1. ' +
  'לפתיחת ההצבעה, הקישו 2. ' +
  'לסגירת ההצבעה, הקישו 3. ' +
  'להגדרת שם של מתמודד, הקישו 4. ' +
  'לאיפוס הקולות בלבד, כשהשמות נשארים, הקישו 5. ' +
  'לאיפוס מלא של הקולות וגם של שמות המתמודדים, הקישו 6. ' +
  'לשמיעת התפריט שוב, הקישו 0.';

async function handle(request) {
  const p = await readParams(request);
  if (p.hangup === 'yes') return reply('', 'ניהול-הצבעה');
  const callId = p.ApiCallId || 'x';
  const key = `vote-admin-${callId}`;

  const idx = Object.keys(p).filter((k) => /^a\d+$/.test(k)).map((k) => +k.slice(1));
  const n = idx.length ? Math.max(...idx) : 0;
  const input = n ? String(p[`a${n}`]) : null;
  const next = `a${n + 1}`;
  const dyn = (t) => speak(t, { name: `va-${callId}-${n % 3}` });
  const fixed = (t) => speak(t, { cache: true });

  try {
    const pin = (await getSetting('vote.pin')) || DEFAULT_PIN;
    let st = (await loadState(key)) || { stage: 'pin' };

    // ---------- קוד כניסה ----------
    if (st.stage === 'pin') {
      if (!n) {
        await saveState(key, st);
        return reply(digitsRead([await fixed('ניהול ההצבעה של המוכשר. הקישו את קוד הניהול, ובסיום סולמית')], next, { min: 1, max: 8, secWait: 15 }));
      }
      if (input === 'None') {
        // לא הקישו קוד - מבקשים שוב (עד 3 פעמים) לפני ניתוק
        if (n < 3) {
          return reply(digitsRead([await fixed('לא נקלט קוד. הקישו את קוד הניהול, ובסיום סולמית')], next, { min: 1, max: 8, secWait: 15 }));
        }
        return reply(`id_list_message=${await fixed('לא נקלט קוד. להתראות')}&go_to_folder=hangup`);
      }
      if (String(input) !== String(pin)) {
        return reply(`id_list_message=${await fixed('קוד שגוי')}&go_to_folder=hangup`);
      }
      st = { stage: 'menu' };
      await saveState(key, st);
      return reply(tapRead([await fixed(MENU)], next));
    }

    // ---------- הגדרת שם מועמד: שלב מספר ----------
    if (st.stage === 'cand_num') {
      if (input === 'None') {
        st = { stage: 'menu' };
        await saveState(key, st);
        return reply(tapRead([await fixed(MENU)], next));
      }
      const num = Number(input);
      if (!(num >= 1 && num <= MAX_CANDIDATES)) {
        return reply(digitsRead([await dyn(`מספר לא חוקי. הקישו מספר מתמודד בין 1 ל-${MAX_CANDIDATES}, ובסיום סולמית`)], next, { min: 1, max: 2, secWait: 15 }));
      }
      st = { stage: 'cand_rec', num };
      await saveState(key, st);
      return reply(recordRead([await dyn(`אמרו את השם של מתמודד מספר ${num} אחרי הצליל, ובסיום הקישו סולמית. כדי למחוק את המתמודד, הקישו סולמית בלי להקליט`)], next));
    }

    // ---------- הגדרת שם מועמד: שלב הקלטה ----------
    if (st.stage === 'cand_rec') {
      const num = st.num;
      if (input === 'None' || !input) {
        await setCandidate(num, ''); // מחיקה
        st = { stage: 'menu' };
        await saveState(key, st);
        return reply(tapRead([await dyn(`מתמודד מספר ${num} נמחק.`), await fixed(MENU)], next));
      }
      let name = '';
      try {
        const audio = await downloadRecording(input, p.ApiExtension, VT || process.env.YEMOT_TOKEN);
        const { text } = await transcribe(audio, 'שם פרטי ושם משפחה של בחור ישיבה, בעברית');
        name = (text || '').replace(/[.,]/g, '').trim();
      } catch (e) {
        logError('vote-admin:transcribe', e);
      }
      if (!name) {
        return reply(recordRead([await dyn(VT ? 'לא הצלחתי להבין את השם. אמרו שוב את שם המתמודד אחרי הצליל, ובסיום סולמית' : 'לא הצלחתי לקלוט את ההקלטה. אפשר להגדיר את שמות המתמודדים באתר הניהול. או נסו לומר שוב את השם אחרי הצליל, ובסיום סולמית')], next));
      }
      await setCandidate(num, name);
      bg(() => warmVoting().catch(() => {})); // הקלטת ההודעות של המתמודד החדש מראש
      st = { stage: 'menu' };
      await saveState(key, st);
      return reply(tapRead([await dyn(`מתמודד מספר ${num}: ${name}.`), await fixed('להגדרת מתמודד נוסף הקישו 4. לתפריט הקישו 0')], next));
    }

    // ---------- אישור איפוס ----------
    if (st.stage === 'reset_confirm') {
      if (input === '1') {
        const all = st.kind === 'all';
        if (all) await resetAll();
        else await resetVotes();
        st = { stage: 'menu' };
        await saveState(key, st);
        const msg = all
          ? 'בוצע איפוס מלא. כל הקולות וכל שמות המתמודדים נמחקו, וההצבעה סגורה. להגדרת מתמודדים חדשים הקישו 4.'
          : 'הקולות אופסו, ושמות המתמודדים נשארו. ההצבעה סגורה, ואפשר לפתוח אותה מחדש בעזרת מקש 2.';
        return reply(tapRead([await fixed(msg), await fixed(MENU)], next));
      }
      st = { stage: 'menu' };
      await saveState(key, st);
      return reply(tapRead([await fixed('האיפוס בוטל.'), await fixed(MENU)], next));
    }

    // ---------- תפריט ראשי ----------
    const choice = input;
    if (choice === '1') {
      const { results, total, config } = await getResults();
      if (!total) {
        return reply(tapRead([await dyn(`בהצבעה של ${config.title || 'המוכשר'} עדיין אין קולות.`), await fixed(MENU)], next));
      }
      const top = results.filter((r) => r.votes > 0);
      const tie = results.length > 1 && results[1].votes === results[0].votes;
      let text = `תוצאות ${config.title || 'המוכשר'}. ${config.is_open ? 'ההצבעה עדיין פתוחה. ' : 'ההצבעה סגורה. '}סך הכל ${votesWord(total)}. `;
      text += tie
        ? `יש תיקו במקום הראשון, עם ${votesWord(results[0].votes)} לכל אחד. `
        : `${config.is_open ? 'מוביל כרגע' : 'המוכשר הוא'} ${results[0].name}, עם ${votesWord(results[0].votes)}! `;
      text += 'הפירוט: ' + top.map((r) => `${r.name}, ${votesWord(r.votes)}`).join('. ') + '.';
      return reply(tapRead([await dyn(text), await fixed(MENU)], next));
    }
    if (choice === '2') {
      await setOpen(true);
      return reply(tapRead([await fixed('ההצבעה נפתחה! מעכשיו כל מי שמתקשר יכול להצביע.'), await fixed(MENU)], next));
    }
    if (choice === '3') {
      await setOpen(false);
      return reply(tapRead([await fixed('ההצבעה נסגרה.'), await fixed(MENU)], next));
    }
    if (choice === '4') {
      st = { stage: 'cand_num' };
      await saveState(key, st);
      const cands = await getCandidates();
      const have = cands.length ? `מוגדרים כרגע ${cands.length} מתמודדים. ` : 'עדיין אין מתמודדים. ';
      return reply(digitsRead([await dyn(`${have}הקישו את מספר המתמודד שתרצו להגדיר, בין 1 ל-${MAX_CANDIDATES}, ובסיום סולמית`)], next, { min: 1, max: 2, secWait: 15 }));
    }
    if (choice === '5') {
      st = { stage: 'reset_confirm', kind: 'votes' };
      await saveState(key, st);
      return reply(tapRead([await fixed('איפוס הקולות בלבד. כל הקולות יימחקו, ושמות המתמודדים יישארו. לאישור הקישו 1. לביטול, הקישו כוכבית או המתינו')], next, 6));
    }
    if (choice === '6') {
      st = { stage: 'reset_confirm', kind: 'all' };
      await saveState(key, st);
      return reply(tapRead([await fixed('איפוס מלא. כל הקולות וגם כל שמות המתמודדים יימחקו. לאישור הקישו 1. לביטול, הקישו כוכבית או המתינו')], next, 6));
    }
    // 0 או כל דבר אחר - התפריט שוב
    return reply(tapRead([await fixed(MENU)], next));
  } catch (err) {
    logError('vote-admin', err);
    return reply(`id_list_message=${await speak('סליחה, הייתה תקלה', { cache: true })}&go_to_folder=hangup`);
  }
}
