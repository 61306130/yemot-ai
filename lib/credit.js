// קופת הקרדיט של חשבון הניסיון ב-Google Cloud - גבול קשיח משותף לכל השירותים בתשלום
// (Gemini דרך Vertex AI, ותווי קול Chirp מעבר למכסה החינמית).
//
// עקרונות, כדי שלא תהיה שום אפשרות לחריגה:
// 1. הגבול הוא GOOGLE_TRIAL_CREDIT_USD, ובכל מקרה לא יותר מ-100 דולר (קבוע בקוד).
//    בלי המשתנה - אין שימוש בתשלום בכלל.
// 2. לפני כל פנייה לגוגל "שומרים" מהקופה את המחיר המקסימלי האפשרי של הבקשה,
//    בפעולה אטומית אחת במסד: מצליחה רק אם הסכום עדיין נכנס בגבול. כך גם בקשות במקביל לא עוברות אותו.
// 3. אחרי תשובה מוצלחת מחשבים את המחיר האמיתי לפי מה שגוגל דיווחו, ומחזירים לקופה את ההפרש.
//    אם גוגל החזירו שגיאה מפורשת - הבקשה לא חויבה, והשמירה מוחזרת כולה.
//    אם לא ידוע מה קרה (ניתוק, חריגת זמן) - השמירה נשארת (צד בטוח).
// 4. המחירים כאן הם המחירים הגבוהים של גוגל (אחרי 1.1.2027) ועוד 20% מרווח.
// 5. בלי מסד נתונים, או אם המסד לא עונה - אין שימוש בתשלום.
import { hasDb, sql } from './db.js';

const HARD_CAP_USD = 100;
export const CREDIT_CAP_USD = Math.max(0, Math.min(HARD_CAP_USD, Number(process.env.GOOGLE_TRIAL_CREDIT_USD) || 0));
export const creditOn = CREDIT_CAP_USD > 0 && hasDb;
const CAP = Math.floor(CREDIT_CAP_USD * 1e6); // במיליוניות דולר

const MARGIN = 1.2;
export const PRICE = {
  geminiIn: 1.5 / 1e6, // דולר לטוקן קלט (Gemini Flash, מחיר מלא)
  geminiOut: 7.5 / 1e6, // דולר לטוקן פלט כולל "חשיבה"
  searchQuery: 14 / 1000, // כל שאילתת חיפוש (גם אם יש 5,000 חינם בחודש - סופרים הכול)
  ttsChar: 30 / 1e6, // תו Chirp 3 HD מעבר למכסה החינמית
};
const micros = (usd) => Math.ceil(usd * MARGIN * 1e6);

let ready = null;
function table() {
  return (ready ||= sql`create table if not exists credit_ledger (id text primary key, spent bigint not null default 0, updated_at timestamptz default now())`
    .then(() => sql`insert into credit_ledger (id, spent) values ('trial', 0) on conflict do nothing`)
    .catch((e) => { ready = null; throw e; }));
}

// שמירת סכום מהקופה. מחזיר כמה נשמר (במיליוניות), או 0 אם אין מקום / אין מסד
export async function reserveCredit(usd) {
  if (!creditOn) return 0;
  const m = micros(usd);
  if (m <= 0) return 0;
  try {
    await table();
    const rows = await sql`update credit_ledger set spent = spent + ${m}, updated_at = now()
      where id = 'trial' and spent + ${m} <= ${CAP} returning spent`;
    return rows.length ? m : 0;
  } catch (e) {
    console.error('קופת קרדיט:', e.message);
    return 0;
  }
}

// סגירת חשבון: actualUsd = המחיר האמיתי (לפני מרווח). null = לא ידוע -> משאירים את כל השמירה
// אם המחיר האמיתי גבוה מהשמירה (לא אמור לקרות) - רושמים את התוספת, כדי שהספירה תמיד תשקף את האמת
export function settleCredit(reserved, actualUsd) {
  if (!reserved || actualUsd == null) return;
  const diff = micros(actualUsd) - reserved;
  if (diff < 0) sql`update credit_ledger set spent = greatest(0, spent + ${diff}) where id = 'trial'`.catch(() => {});
  else if (diff > 0) sql`update credit_ledger set spent = spent + ${diff} where id = 'trial'`.catch(() => {});
}
export const releaseCredit = (reserved) => settleCredit(reserved, 0);

export async function creditStatus() {
  if (!creditOn) return { on: false, capUsd: CREDIT_CAP_USD };
  try {
    await table();
    const [r] = await sql`select spent from credit_ledger where id = 'trial'`;
    return { on: true, capUsd: CREDIT_CAP_USD, spentUsd: Number(r?.spent || 0) / 1e6 };
  } catch {
    return { on: false, capUsd: CREDIT_CAP_USD };
  }
}
