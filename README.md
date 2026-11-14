# yemot-ai

מערכת טלפונית לימות המשיח: עוזר AI קולי, חדשות, התוכנית המלאה של ינון ובן, ותחבורה ציבורית.

## שלוחות
| שלוחה | כתובת | תיאור |
|---|---|---|
| AI | `/api/yemot` | שיחה קולית עם AI, זיכרון לפי מספר טלפון, חיפוש באינטרנט כשצריך |
| 2 | `/api/podcast` (משימה יומית) | התוכנית המלאה של ינון מגל ובן כספית מ-103FM |
| 3 | `/api/news` | מהדורת חדשות שמתעדכנת כל רבע שעה לכל היותר |
| 4 | `/api/transit` | תכנון נסיעה בתחבורה ציבורית וליווי שלב אחר שלב |

## מקורות מידע וקרדיטים
- תכנון מסלולים וחיפוש מקומות: [Transitous](https://transitous.org) – ראו את [מקורות הנתונים](https://transitous.org/sources/) (כולל נתוני משרד התחבורה ו-OpenStreetMap © OpenStreetMap contributors).
- זמני הגעה בזמן אמת: [curlbus](https://curlbus.app) מאת Elad Alfassa, על בסיס נתוני SIRI של משרד התחבורה.
- חדשות: פידי RSS של ynet, מעריב ווואלה.
- הקראה: Microsoft Edge Read Aloud (דרך הספרייה msedge-tts), עם גיבוי להקראה של ימות.

## הגדרות (משתני סביבה ב-Vercel)
`GEMINI_API_KEY`, `GROQ_API_KEY`, `YEMOT_TOKEN` (מספר:סיסמה), `POSTGRES_URL` (Supabase).
אופציונלי: `VOICE_NAME` (ברירת מחדל he-IL-AvriNeural), `VOICE_FOLDER` (ברירת מחדל /9876), `VOICE_OFF=1`.

אין סיסמאות או מפתחות בקוד – הכל מוגדר ב-Vercel.
