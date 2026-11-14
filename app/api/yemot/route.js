// שלב 2: שיחה עם AI.
// המתקשר מדבר -> ימות מקליטה -> השרת מוריד את ההקלטה מימות ->
// Gemini מבין את ההקלטה ועונה -> ימות מקריאה את התשובה -> חוזר חלילה.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
// טוקן לימות בפורמט: מספר_מערכת:סיסמה
const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `אתה עוזר קולי ידידותי שמדבר בעברית בשיחת טלפון.
התשובות שלך מוקראות בקול, ולכן:
- ענה בקצרה, בדרך כלל 2 עד 4 משפטים.
- בלי רשימות, כוכביות, אימוג'י, קישורים או סימנים מיוחדים.
- כתוב מספרים במילים כשזה קצר.
אם לא שמעת או לא הבנת את השאלה, בקש בנימוס לחזור עליה.`;

// זיכרון שיחה זמני (בשלב הבא יעבור למסד נתונים)
const memory = globalThis.__yemotMemory || (globalThis.__yemotMemory = new Map());

function reply(text) {
  console.log('תשובה לימות:', text);
  return new Response(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// ימות לא מקבלת בטקסט להקראה: . - " ' & | = ,
// לכן מפצלים לפי משפטים, וכל משפט הופך להודעה נפרדת (t-)
function toYemotText(text) {
  const parts = String(text)
    .replace(/[*#_`~>\[\]()]/g, ' ')
    .split(/[.!?\n]+/)
    .map((s) => s.replace(/[.\-"'&|=,]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!parts.length) return 't-סליחה לא הבנתי';
  return parts.map((p) => 't-' + p).join('.');
}

// בקשת הקלטה מהמתקשר
function recordRead(promptText, n) {
  const ops = [
    `rec${n}`, // שם המשתנה
    'no',      // לא לבקש שוב אם כבר קיים
    'record',  // מצב הקלטה
    '',        // תיקייה (ברירת מחדל: השלוחה הנוכחית)
    '',        // שם קובץ (אוטומטי)
    'no',      // בלי תפריט אישור אחרי ההקלטה
    'yes',     // לשמור גם אם ניתקו באמצע
    'no',      // לא להוסיף לקובץ קיים
    '1',       // אורך מינימלי בשניות
    '60',      // אורך מקסימלי בשניות
  ];
  return `read=${toYemotText(promptText)}=${ops.join(',')}`;
}

async function downloadRecording(value, extension) {
  let path = String(value);
  if (!path.includes('/')) path = `/${extension || ''}/${path}`;
  if (!path.startsWith('/')) path = '/' + path;
  path = path.replace(/\/+/g, '/');
  if (!/\.\w{2,4}$/.test(path)) path += '.wav';

  const url =
    'https://www.call2all.co.il/ym/api/DownloadFile?token=' +
    encodeURIComponent(YEMOT_TOKEN) +
    '&path=' +
    encodeURIComponent('ivr2:' + path);
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('json') || buf.length < 500) {
    throw new Error(`הורדת ההקלטה נכשלה (${res.status}) ${path}: ${buf.toString().slice(0, 200)}`);
  }
  return buf;
}

async function askGemini(history, audio) {
  const contents = [
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    {
      role: 'user',
      parts: [
        { inline_data: { mime_type: 'audio/wav', data: audio.toString('base64') } },
        { text: 'זו ההקלטה של המתקשר. תמלל אותה וענה לו.' },
      ],
    },
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              transcript: { type: 'STRING', description: 'מה שהמתקשר אמר' },
              answer: { type: 'STRING', description: 'התשובה שתוקרא למתקשר' },
            },
            required: ['transcript', 'answer'],
          },
        },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error('Gemini: ' + JSON.stringify(data).slice(0, 300));
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '{}';
  return JSON.parse(raw);
}

async function handle(request) {
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);
  if (request.method === 'POST') {
    try {
      const body = await request.formData();
      for (const [k, v] of body) p[k] = v;
    } catch {}
  }
  console.log('פנייה מימות:', p);

  const callId = p.ApiCallId || 'unknown';

  // המתקשר ניתק
  if (p.hangup === 'yes') {
    memory.delete(callId);
    return reply('');
  }

  if (!GEMINI_KEY || !YEMOT_TOKEN) {
    return reply('id_list_message=t-השרת עדיין לא הוגדר&go_to_folder=hangup');
  }

  // ההקלטה האחרונה ששלחה ימות (rec1, rec2, ...)
  const recs = Object.keys(p)
    .filter((k) => /^rec\d+$/.test(k))
    .map((k) => Number(k.slice(3)))
    .sort((a, b) => a - b);
  const n = recs.length ? recs[recs.length - 1] : 0;

  // כניסה לשלוחה: הודעת פתיחה ובקשת הקלטה ראשונה
  if (n === 0) {
    return reply(
      recordRead('שלום. אני העוזר החכם. שאל אותי כל שאלה אחרי הצליל, ובסיום הקש סולמית', 1)
    );
  }

  try {
    const audio = await downloadRecording(p[`rec${n}`], p.ApiExtension);
    const history = memory.get(callId) || [];
    const { transcript, answer } = await askGemini(history, audio);
    console.log('המתקשר אמר:', transcript, '| AI ענה:', answer);

    history.push({ role: 'user', text: transcript || '' }, { role: 'model', text: answer || '' });
    memory.set(callId, history.slice(-20));

    return reply(
      `id_list_message=${toYemotText(answer)}&` +
        recordRead('אפשר לשאול עוד שאלה אחרי הצליל', n + 1)
    );
  } catch (err) {
    console.error('שגיאה:', err);
    return reply(recordRead('סליחה, הייתה תקלה. נסה לשאול שוב אחרי הצליל', n + 1));
  }
}

export const GET = handle;
export const POST = handle;
