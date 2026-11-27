// סינון תכנים לבוטי: הוראה ל-AI, ובדיקה של השאלה ושל התשובה מול רשימת מילים חסומות.
// ההגדרות באתר: bot.filter (הפעלה), bot.filterWords (מילים/ביטויים, שורה או פסיק בין אחד לשני),
// bot.filterReply (מה בוטי אומר כשנושא חסום).

export const DEFAULT_FILTER_REPLY = 'על הנושא הזה אני לא מדבר. אפשר לשאול אותי על משהו אחר.';

// מה ה-AI מתבקש לשמור עליו כשהסינון פעיל
export const filterRule = (reply = DEFAULT_FILTER_REPLY) => `
סינון תכנים (חובה):
- הקו משרת ציבור דתי ומשפחות עם ילדים. שמור על שפה נקייה ומכבדת.
- אל תעסוק בתוכן מיני, רומנטי או לא צנוע, בקללות, באלימות מפורטת, בהימורים, בסמים, בכישוף או בעבודה זרה.
- אל תדבר בגנות אנשים או קהילות, אל תפיץ רכילות ואל תלעג לדת, לרבנים או לציבור כלשהו.
- בשאלות של הלכה למעשה, אמור בקצרה מה המקובל ואמור לשאול רב.
- אם השאלה בנושא כזה, אל תסביר למה, ואל תחזור על התוכן. ענה רק: "${reply}"`;

function norm(s) {
  return String(s || '')
    .replace(/[֑-ׇ]/g, '') // בלי ניקוד וטעמים
    .replace(/[^א-תa-z0-9\s]/gi, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWords(list) {
  return String(list || '')
    .split(/[\n,]+/)
    .map(norm)
    .filter((w) => w.length >= 2);
}

// מחזיר את המילה החסומה שנמצאה, או null. מילה שלמה, גם עם אות שימוש לפניה (ה/ו/ב/ל/מ/ש/כ)
export function findBlocked(text, words) {
  if (!words?.length) return null;
  const t = ` ${norm(text)} `;
  for (const w of words) {
    const re = new RegExp(`\\s(?:[והבלמשכ]{0,2})${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s)`);
    if (re.test(t)) return w;
  }
  return null;
}

export function filterSettings(st) {
  const on = st?.['bot.filter'] !== false;
  return {
    on,
    words: on ? parseWords(st?.['bot.filterWords']) : [],
    reply: String(st?.['bot.filterReply'] || '').trim() || DEFAULT_FILTER_REPLY,
  };
}
