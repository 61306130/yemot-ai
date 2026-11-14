// שלוחת תחבורה ציבורית (4): אומרים מאיפה לאיפה, בוחרים מסלול, והמערכת מלווה שלב אחר שלב.
// הנסיעה נשמרת לפי מספר הטלפון - אפשר לנתק ולחזור באמצע עד שסוגרים אותה.
import { reply, readParams, tapRead, recordRead, downloadRecording } from '../../../lib/yemot.js';
import { say, callFileName } from '../../../lib/voice.js';
import { transcribeBoth, answer as aiAnswer } from '../../../lib/ai.js';
import {
  loadTrip, saveTrip, deleteTrip, listPlaces, savePlace, geocode, planTrip,
  buildSteps, nextArrival, arrivalText, hhmm,
} from '../../../lib/transit.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ASK = 'לאן תרצה לנסוע? אמור מאיפה לאיפה, למשל: מהתחנה המרכזית בירושלים לעזריאלי בתל אביב. ' +
  'אפשר גם לשמור מקום, למשל: תשמור את רחוב הרצל 5 בירושלים בתור בית. דבר אחרי הצליל, ובסיום הקש סולמית';
const SEARCHING = 'רגע, אני מחפש עבורך מסלולים';
const NAV_KEYS = 'לשמיעה חוזרת ועדכון, הקש 2. לשלב הקודם, הקש 3. לסיום הנסיעה, הקש 9';

export async function GET(request) {
  return handle(request);
}
export async function POST(request) {
  return handle(request);
}

async function handle(request) {
  const p = await readParams(request);
  if (p.hangup === 'yes') return reply('', 'תחבורה');
  const callId = p.ApiCallId || 'x';
  const phone = /^\d{5,}$/.test(p.ApiPhone || '') ? p.ApiPhone : `hidden-${callId}`;

  // הקלט האחרון (s1, s2, ...)
  const idx = Object.keys(p).filter((k) => /^s\d+$/.test(k)).map((k) => +k.slice(1));
  const n = idx.length ? Math.max(...idx) : 0;
  const input = n ? String(p[`s${n}`]) : null;
  const next = `s${n + 1}`;
  const dyn = (text) => say(text, { name: callFileName(callId, n) }); // טקסט משתנה
  const fixed = (text) => say(text, { cache: true }); // טקסט קבוע

  try {
    let trip = (await loadTrip(phone)) || {};

    // ---------- כניסה לשלוחה ----------
    if (!n) {
      if (trip.stage === 'nav') {
        trip.pending = 'resume';
        await saveTrip(phone, trip);
        return reply(tapRead([await dyn(`יש לך נסיעה פעילה אל ${trip.dest}. להמשך הנסיעה, הקש 1. לנסיעה חדשה, הקש 2`)], next));
      }
      trip = { pending: 'ask' };
      await saveTrip(phone, trip);
      return reply(recordRead([await fixed(ASK)], next));
    }

    // ---------- המשך נסיעה קיימת ----------
    if (trip.pending === 'resume') {
      if (input === '1') return navReply(trip, phone, next, dyn, true);
      trip = { pending: 'ask' };
      await saveTrip(phone, trip);
      return reply(recordRead([await fixed(ASK)], next));
    }

    // ---------- התקבלה הקלטה: קודם הודעת "רגע", ואז העבודה עצמה ----------
    if (trip.pending === 'ask') {
      if (input === 'None' || !input) return reply(recordRead([await fixed(ASK)], next));
      trip.rec = input;
      trip.pending = 'searching';
      await saveTrip(phone, trip);
      return reply(tapRead([await fixed(SEARCHING)], next, 1));
    }

    if (trip.pending === 'searching') {
      const result = await search(trip.rec, p.ApiExtension, phone);
      if (result.say) {
        // שמירת מקום / לא הובן - שואלים שוב
        trip = { pending: 'ask' };
        await saveTrip(phone, trip);
        return reply(recordRead([await dyn(result.say), await fixed('לנסיעה, אמור מאיפה לאיפה אחרי הצליל, ובסיום הקש סולמית')], next));
      }
      trip = { pending: 'choose', options: result.options, dest: result.to.name, origin: result.from.name };
      await saveTrip(phone, trip);
      return reply(tapRead([await dyn(optionsText(trip)), await fixed('לבחירה, הקש את מספר האפשרות. אם אחד המקומות לא נכון, הקש אפס ונסה שוב, ואמור גם את שם העיר')], next, 10));
    }

    // ---------- בחירת מסלול ----------
    if (trip.pending === 'choose') {
      const opt = trip.options?.[Number(input) - 1];
      if (input === '0' || input === 'None' || !opt) {
        if (input !== '0' && input !== 'None') {
          return reply(tapRead([await dyn(`אין אפשרות מספר ${input}. ` + optionsText(trip)), await fixed('לבחירה, הקש את מספר האפשרות. לחיפוש חדש, הקש אפס')], next, 10));
        }
        trip = { pending: 'ask' };
        await saveTrip(phone, trip);
        return reply(recordRead([await fixed(ASK)], next));
      }
      trip = { stage: 'nav', pending: 'nav', dest: trip.dest, steps: buildSteps(opt, trip.dest), step: 0, idle: 0 };
      await saveTrip(phone, trip);
      return navReply(trip, phone, next, dyn, false, `בחרת: ${opt.summary}. `);
    }

    // ---------- ניווט ----------
    if (trip.pending === 'nav') {
      if (input === '9') {
        await deleteTrip(phone);
        return reply(`id_list_message=${await fixed('הנסיעה נסגרה. נסיעה טובה')}&go_to_folder=/`);
      }
      if (input === 'None') {
        trip.idle = (trip.idle || 0) + 1;
        await saveTrip(phone, trip);
        if (trip.idle >= 2) {
          return reply(`id_list_message=${await fixed('הנסיעה שמורה. אפשר להתקשר שוב בכל רגע ולהמשיך מאותה נקודה')}&go_to_folder=hangup`);
        }
        return navReply(trip, phone, next, dyn, true);
      }
      trip.idle = 0;
      if (input === '1') trip.step = Math.min(trip.step + 1, trip.steps.length - 1);
      if (input === '3') trip.step = Math.max(trip.step - 1, 0);
      await saveTrip(phone, trip);
      return navReply(trip, phone, next, dyn, input === '2');
    }

    // מצב לא צפוי - מתחילים מחדש
    await saveTrip(phone, { pending: 'ask' });
    return reply(recordRead([await fixed(ASK)], next));
  } catch (err) {
    console.error('תחבורה: שגיאה', err);
    await saveTrip(phone, { pending: 'ask' }).catch(() => {});
    return reply(recordRead([await fixed('סליחה, הייתה תקלה. נסה שוב. אמור מאיפה לאיפה אחרי הצליל, ובסיום הקש סולמית')], next));
  }
}

// ---------- הקראת השלב הנוכחי ----------
async function navReply(trip, phone, next, dyn, repeat, prefix = '') {
  const step = trip.steps[trip.step];
  if (step.type === 'arrived') {
    await deleteTrip(phone);
    return reply(`id_list_message=${await dyn(prefix + step.text)}&go_to_folder=/`);
  }
  let text = prefix + (repeat ? 'השלב הנוכחי: ' : '') + step.text + ' ';
  if (step.type === 'wait') {
    text += arrivalText(step.leg, await nextArrival(step.leg)) + ' כשעלית, הקש 1. ';
  } else if (step.type === 'ride') {
    text += 'כשירדת, הקש 1. ';
  } else if (step.type === 'walk') {
    text += 'כשתגיע לתחנה, הקש 1. ';
  } else if (step.type === 'walk_end') {
    text += 'כשתגיע, הקש 1. ';
  }
  text += NAV_KEYS;
  return reply(tapRead([await dyn(text)], next, 30));
}

function optionsText(trip) {
  const opts = trip.options;
  return (
    `הבנתי: מ${trip.origin}, אל ${trip.dest}. מצאתי ${opts.length} אפשרויות. ` +
    opts
      .map((o, i) => `אפשרות ${i + 1}: ${o.summary}. ${o.minutes} דקות, יציאה בשעה ${hhmm(o.start)}, הגעה בשעה ${hhmm(o.end)}.`)
      .join(' ')
  );
}

// ---------- הבנת הבקשה, חיפוש מקומות ותכנון ----------
async function search(rec, ext, phone) {
  const audio = await downloadRecording(rec, ext);
  const versions = await transcribeBoth(
    audio,
    'בקשת נסיעה בתחבורה ציבורית בישראל: מאיפה לאיפה. שמות רחובות ומספרי בתים, שכונות, ערים, תחנות, קניונים ובתי חולים.'
  );
  console.log('תחבורה: תמלולים:', JSON.stringify(versions));
  if (!versions.length) return { say: 'לא שמעתי אותך.' };
  const text =
    versions.length === 1
      ? versions[0][1]
      : `יש שתי גרסאות תמלול של אותה הקלטה (מערכות שונות, ייתכנו שגיאות בשמות). שקול את שתיהן ובחר את מה שהגיוני ככתובת או מקום אמיתי בישראל:\n` +
        versions.map(([who, t], i) => `גרסה ${i + 1}: ${t}`).join('\n');

  const places = await listPlaces(phone);
  const names = places.map((x) => x.name);
  const system = `אתה מפענח בקשות לתחבורה ציבורית בישראל. החזר JSON בלבד.
הטקסט הגיע מתמלול של הקלטה טלפונית ועלול להכיל שגיאות - תקן שמות של ערים, רחובות, שכונות ומקומות מוכרים בישראל לכתיב הנכון.
לכל מקום החזר אובייקט {"name":"...","city":"..."}:
- name: שם המקום בלי העיר (רחוב ומספר בית, תחנה, קניון, בית חולים, שכונה וכו')
- city: שם העיר בכתיב הרשמי. אם לא נאמרה עיר, נחש לפי ההקשר (למשל עיר המוצא), ואם אי אפשר - השאר ריק.
אם המשתמש מבקש נסיעה: {"intent":"trip","from":{...},"to":{...}}
אם המשתמש מבקש לשמור מקום: {"intent":"save","name":"שם קצר כמו בית או עבודה","place":{...}}
אחרת: {"intent":"unknown"}
מקומות שמורים של המשתמש: ${names.length ? names.join(', ') : 'אין'}.
אם המשתמש מתייחס למקום שמור (למשל "מהבית"), החזר עבורו {"saved":"שם המקום השמור בדיוק כפי שהוא ברשימה"}.`;
  const { text: raw } = await aiAnswer(system, [{ role: 'user', text }]);
  let req;
  try {
    req = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    req = { intent: 'unknown' };
  }

  console.log('תחבורה: פוענח:', JSON.stringify(req));
  const label = (x) => (typeof x === 'string' ? x : [x?.name, x?.city].filter(Boolean).join(' '));

  if (req.intent === 'save' && req.name && req.place?.name) {
    const place = await geocode(req.place);
    if (!place) return { say: `לא מצאתי את הכתובת ${label(req.place)}.` };
    await savePlace(phone, req.name.trim(), place);
    return { say: `שמרתי את ${place.name} בתור ${req.name}.` };
  }
  if (req.intent !== 'trip' || !req.to) return { say: 'לא הבנתי מאיפה לאיפה אתה רוצה לנסוע.' };
  if (!req.from) return { say: 'לא שמעתי מאיפה אתה יוצא.' };

  const resolve = async (x) => {
    const savedName = x?.saved || (typeof x === 'string' ? x : null);
    const saved = savedName && places.find((pl) => pl.name === String(savedName).trim());
    if (saved) return { name: saved.name, lat: saved.lat, lon: saved.lon };
    return geocode(typeof x === 'string' ? x : { name: x?.name || '', city: x?.city || '' });
  };
  const [from, to] = await Promise.all([resolve(req.from), resolve(req.to)]);
  console.log('תחבורה: נמצא:', from?.name, '->', to?.name);
  if (!from) return { say: `לא מצאתי את המקום ${label(req.from)}.` };
  if (!to) return { say: `לא מצאתי את המקום ${label(req.to)}.` };

  const options = await planTrip(from, to);
  if (!options.length) return { say: `לא מצאתי מסלול בתחבורה ציבורית מ${from.name} אל ${to.name} בשעות הקרובות.` };
  return { from, to, options };
}
