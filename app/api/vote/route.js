// שלוחת הצבעה ציבורית: המתקשר שומע את רשימת המועמדים ובוחר אחד. הצבעה אחת לכל מספר טלפון.
// להגדרה בימות (באותה מערכת או במערכת אחרת, עם הכתובת הציבורית):
//   type=api
//   api_link=https://<הדומיין>/api/vote
import { reply, readParams, digitsRead } from '../../../lib/yemot.js';
import { say, plainTts } from '../../../lib/voice.js';
// ההצבעה רצה על מערכת ימות נפרדת. אם הוגדר VOTE_YEMOT_TOKEN - קול טבעי שמועלה למערכת ההיא.
// אחרת - הקראה רגילה של ימות (עובדת בכל מערכת בלי הגדרות).
const VT = process.env.VOTE_YEMOT_TOKEN;
const speak = (t, o = {}) => (VT ? say(t, { ...o, token: VT }) : Promise.resolve(plainTts(t)));

import { getConfig, getCandidates, castVote } from '../../../lib/voting.js';
import { logError } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  return handle(request);
}
export async function POST(request) {
  return handle(request);
}

async function handle(request) {
  const p = await readParams(request);
  if (p.hangup === 'yes') return reply('', 'הצבעה');
  const callId = p.ApiCallId || 'x';
  const phone = /^\d{5,}$/.test(p.ApiPhone || '') ? p.ApiPhone : `hidden-${callId}`;

  const idx = Object.keys(p).filter((k) => /^v\d+$/.test(k)).map((k) => +k.slice(1));
  const n = idx.length ? Math.max(...idx) : 0;
  const input = n ? String(p[`v${n}`]) : null;
  const next = `v${n + 1}`;

  try {
    const cfg = await getConfig();
    const candidates = await getCandidates();

    if (!cfg.is_open) {
      return reply(`id_list_message=${await speak('ההצבעה סגורה כרגע. תודה ולהתראות', { cache: true })}&go_to_folder=hangup`);
    }
    if (!candidates.length) {
      return reply(`id_list_message=${await speak('עדיין לא הוגדרו מועמדים להצבעה. נסו שוב מאוחר יותר', { cache: true })}&go_to_folder=hangup`);
    }

    // קריאת רשימת המועמדים (נשמרת בקול לפי כותרת ההצבעה וסבב, כל עוד לא שונתה)
    const listKey = `poll-list-r${cfg.round}`;
    const listText =
      `${cfg.title}. הצביעו למועמד שלכם. ` +
      candidates.map((c) => `למועמד ${c.name}, הקישו ${c.num}.`).join(' ') +
      ' הקישו את מספר המועמד, ובסיום סולמית.';

    // כניסה לשלוחה - מקריאים את הרשימה ומבקשים הקשה
    if (!n || input === '0') {
      return reply(digitsRead([await speak(listText, { cache: true, name: listKey })], next, { min: 1, max: 2, secWait: 10 }));
    }
    if (input === 'None') {
      return reply(`id_list_message=${await speak('לא נקלטה בחירה. תודה ולהתראות', { cache: true })}&go_to_folder=hangup`);
    }

    const result = await castVote(phone, input);
    if (result.status === 'ok') {
      return reply(`id_list_message=${await speak(`הצבעתך למועמד ${result.candidate} נקלטה בהצלחה. תודה שהצבעת`, { name: `vote-ok-${callId}` })}&go_to_folder=hangup`);
    }
    if (result.status === 'already') {
      return reply(`id_list_message=${await speak(`כבר הצבעת בהצבעה הזו${result.candidate ? ` למועמד ${result.candidate}` : ''}. אפשר להצביע רק פעם אחת. תודה`, { name: `vote-dup-${callId}` })}&go_to_folder=hangup`);
    }
    if (result.status === 'closed') {
      return reply(`id_list_message=${await speak('ההצבעה נסגרה. תודה', { cache: true })}&go_to_folder=hangup`);
    }
    // badnum - מספר שאין לו מועמד
    return reply(digitsRead([await speak(`אין מועמד במספר ${input}. נסו שוב.`, { name: `vote-bad-${callId}` }), await speak(listText, { cache: true, name: listKey })], next, { min: 1, max: 2, secWait: 10 }));
  } catch (err) {
    logError('vote', err);
    return reply(`id_list_message=${await speak('סליחה, הייתה תקלה במערכת ההצבעה. נסו שוב מאוחר יותר', { cache: true })}&go_to_folder=hangup`);
  }
}
