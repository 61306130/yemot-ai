// הטקסטים של קו ההצבעה במקום אחד, כדי שגם השלוחה וגם ההכנה מראש (warmVoting) ישתמשו בדיוק באותו נוסח.
// הקלטה = לפי הטקסט המדויק, אז נוסח זהה = הקובץ שהוכן מראש הוא זה שיושמע.
import { say } from './voice.js';
import { getConfig, getCandidates } from './voting.js';

export const BYE = 'ובהצלחה לכל המתמודדים!';
export function voteTexts(show, candidates) {
  const twoDigits = candidates.length ? Math.max(...candidates.map((c) => c.num)) > 9 : false;
  return {
    twoDigits,
    intro: `ברוכים הבאים להצבעה של ${show}, תוכנית הכישרונות של הישיבה! עכשיו זה בידיים שלכם: מי הכי מוכשר?`,
    listLines: [
      ...candidates.map((c) => `ל${c.name}, הקישו ${c.num}.`),
      (twoDigits ? 'הקישו את מספר המתמודד, ובסיום סולמית.' : 'הקישו את מספר המתמודד.') + ' לשמיעת הרשימה שוב, הקישו אפס.',
    ],
    chose: (name) => `בחרת ב${name}. לאישור הקישו 1. לבחירה מחדש הקישו 2.`,
    choseAgain: (name) => `לא שמעתי. בחרת ב${name}. לאישור הקישו 1. לבחירה מחדש הקישו 2.`,
    done: (name) => `הקול שלך ל${name} נקלט! תודה שהשתתפת בהצבעה של ${show}, ${BYE}`,
    already: (name) => `כבר הצבעת ל${name}. אפשר להצביע רק פעם אחת. תודה, ${BYE}`,
    alreadyEntry: (name) => `שלום, כבר הצבעת ל${name} בהצבעה של ${show}. אפשר להצביע רק פעם אחת. תודה שהשתתפת, ${BYE}`,
    fixed: [
      'לא שמעתי בחירה. הנה הרשימה שוב.',
      'בסדר, בחרו מחדש.',
      'המתמודד הזה כבר לא ברשימה. בחרו שוב.',
      'לא אישרת את הבחירה, ולכן הקול לא נקלט. אפשר להתקשר שוב ולהצביע. להתראות!',
      'לא נקלטה בחירה. אפשר להתקשר שוב ולהצביע. להתראות!',
    ],
  };
}

// הקלטה מראש של כל ההודעות של ההצבעה (אחרי שינוי מתמודדים/שם/פתיחה), כדי שאף מצביע לא יחכה.
// הודעות שכבר מוקלטות לא מוקלטות שוב. מריצים 3 במקביל.
export async function warmVoting() {
  const VT = process.env.VOTE_YEMOT_TOKEN;
  if (!VT) return { warmed: 0 };
  const cfg = await getConfig();
  const candidates = await getCandidates();
  const show = cfg.title || 'המוכשר';
  const T = voteTexts(show, candidates);
  const texts = [
    T.intro,
    ...T.listLines,
    ...T.fixed,
    ...candidates.flatMap((c) => [T.chose(c.name), T.choseAgain(c.name), T.done(c.name), T.already(c.name), T.alreadyEntry(c.name)]),
  ];
  let ok = 0;
  for (let i = 0; i < texts.length; i += 3) {
    const res = await Promise.all(texts.slice(i, i + 3).map((t) => say(t, { cache: true, token: VT }).catch(() => 't-')));
    ok += res.filter((r) => r.startsWith('f-')).length;
  }
  return { warmed: ok, total: texts.length };
}
