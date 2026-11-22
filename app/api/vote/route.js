// שלוחת ההצבעה של "המוכשר" - תוכנית הכישרונות של הישיבה.
// המתקשר שומע את רשימת המתמודדים, בוחר, מאשר - והקול נקלט. קול אחד לכל מספר טלפון.
// מי שכבר הצביע ומתקשר שוב - שומע למי הצביע, בלי אפשרות לשנות.
// להגדרה בימות (באותה מערכת או במערכת אחרת, עם הכתובת הציבורית):
//   type=api
//   api_link=https://<הדומיין>/api/vote
import { reply, readParams, digitsRead } from '../../../lib/yemot.js';
import { say, plainTts } from '../../../lib/voice.js';
import { getConfig, getCandidates, getMyVote, setVote } from '../../../lib/voting.js';
import { voteTexts, warmVoting } from '../../../lib/voting-voice.js';
import { after } from 'next/server';
import { createHash } from 'node:crypto';
import { getSettings, setSettings } from '../../../lib/store.js';
import { loadState, saveState, logError } from '../../../lib/store.js';

// ההצבעה רצה על מערכת ימות נפרדת. אם הוגדר VOTE_YEMOT_TOKEN - קול טבעי שמועלה למערכת ההיא.
// אחרת - הקראה רגילה של ימות (עובדת בכל מערכת בלי הגדרות).
const VT = process.env.VOTE_YEMOT_TOKEN;
// background: הודעה שעוד לא הוקלטה מושמעת מיד בהקראה של ימות ומוקלטת ברקע - אף מצביע לא מחכה
const speak = (t, o = {}) => (VT ? say(t, { background: true, ...o, token: VT }) : Promise.resolve(plainTts(t)));

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // מקום להקלטות ברקע אחרי התשובה

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

    // עד 9 מתמודדים - הקשה אחת מספיקה. מעל 9 - מספר וסולמית. הנוסחים ב-lib/voting-voice.js
    const T = voteTexts(show, candidates);
    const { twoDigits, listLines } = T;
    const introText = T.intro;

    // פעם אחת לכל נוסח (שם תוכנית + רשימת מתמודדים): הקלטת כל ההודעות מראש ברקע
    if (!n && VT) {
      const sig = createHash('sha1').update(JSON.stringify([show, candidates.map((c) => [c.num, c.name])])).digest('hex').slice(0, 16);
      const done = (await getSettings().catch(() => ({})))['vote.warmed'];
      if (done !== sig) {
        await setSettings({ 'vote.warmed': sig }).catch(() => {});
        after(() => warmVoting().catch(() => {}));
      }
    }

    const askList = async (pre = []) =>
      reply(digitsRead([...pre, ...(await Promise.all(listLines.map((t) => speak(t, { cache: true }))))], next, { min: 1, max: twoDigits ? 2 : 1, secWait: WAIT }));
    const askOne = async (text, opts = { cache: true }) =>
      reply(digitsRead([await speak(text, opts)], next, { min: 1, max: 1, secWait: WAIT }));

    let st = (n && (await loadState(key))) || null;

    // ---------- כניסה לשלוחה ----------
    if (!n || !st) {
      const mine = await getMyVote(phone);
      if (mine) {
        return hangup(T.alreadyEntry(mine.name), { cache: true });
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
        return hangup(st.stage === 'confirm' ? T.fixed[3] : T.fixed[4]);
      }
      if (st.stage === 'choose') return askList([await speak(T.fixed[0], { cache: true })]);
      if (st.stage === 'confirm') {
        const c = candidates.find((x) => x.num === st.num);
        return askOne(T.choseAgain(c?.name), { cache: true });
      }
    }
    st.silent = 0;

    // ---------- בחירת מתמודד ----------
    if (st.stage === 'choose') {
      if (input === '0') return askList();
      const c = candidates.find((x) => String(x.num) === String(Number(input)));
      if (!c) {
        return askList([await speak(`אין מתמודד במספר ${input}. נסו שוב.`, { cache: true })]);
      }
      st = { ...st, stage: 'confirm', num: c.num };
      await saveState(key, st);
      return askOne(T.chose(c.name), { cache: true });
    }

    // ---------- אישור ----------
    if (st.stage === 'confirm') {
      if (input !== '1') {
        st = { stage: 'choose', silent: 0 };
        await saveState(key, st);
        return askList([await speak(T.fixed[1], { cache: true })]);
      }
      const r = await setVote(phone, st.num);
      await saveState(key, { stage: 'done' });
      if (r.status === 'ok') {
        return hangup(T.done(r.candidate), { cache: true });
      }
      if (r.status === 'already') {
        return hangup(T.already(r.candidate), { cache: true });
      }
      if (r.status === 'closed') {
        return hangup(`ההצבעה של ${show} כבר נסגרה, ולכן הקול לא נקלט. תודה שהתקשרתם, והישארו איתנו לתוצאות!`);
      }
      // המתמודד נמחק בינתיים
      st = { stage: 'choose', silent: 0 };
      await saveState(key, st);
      return askList([await speak(T.fixed[2], { cache: true })]);
    }

    // מצב לא צפוי - מתחילים מחדש
    await saveState(key, { stage: 'choose', silent: 0 });
    return askList();
  } catch (err) {
    logError('vote', err);
    return hangup('סליחה, הייתה תקלה במערכת ההצבעה. נסו שוב מאוחר יותר');
  }
}
