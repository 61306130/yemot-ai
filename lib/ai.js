import { countUsage } from './store.js';
import { creditOn, reserveCredit, settleCredit, releaseCredit, PRICE } from './credit.js';
import { googleAuthHeaders, hasServiceAccount, serviceProject } from './gauth.js';
// שכבת ה-AI: תמלול + תשובה, עם מעבר אוטומטי בין ספקים כשאחד עמוס או נגמרה לו המכסה.

// מפתחות Gemini: GEMINI_API_KEY, ואפשר להוסיף GEMINI_API_KEY_2 ... GEMINI_API_KEY_30
// (או GEMINI_API_KEYS מופרדים בפסיק). כשמפתח מגיע למכסה עוברים לבא בתור.
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 29 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  ...String(process.env.GEMINI_API_KEYS || '').split(','),
]
  .map((k) => String(k || '').trim())
  .filter((k, i, a) => k && a.indexOf(k) === i);
const GEMINI_KEY = GEMINI_KEYS[0];
export const geminiKeyCount = GEMINI_KEYS.length;
const GROQ_KEY = process.env.GROQ_API_KEY;
// כמה מפתחות Groq (GROQ_API_KEY, GROQ_API_KEY_2 ... _10). המגבלות של Groq הן לכל חשבון -
// כמה מפתחות מאותו חשבון לא מוסיפים כלום, רק מפתחות מחשבונות שונים
const GROQ_KEYS = [process.env.GROQ_API_KEY, ...Array.from({ length: 9 }, (_, i) => process.env[`GROQ_API_KEY_${i + 2}`])]
  .map((k) => String(k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
export const groqKeyCount = GROQ_KEYS.length;
const groqCool = globalThis.__groqCool || (globalThis.__groqCool = new Map()); // `${keyIndex}|${model}` -> עד מתי
let groqNext = 0;
// שליחה ל-Groq עם החלפת מפתח: מתחילים ממפתח אחר בכל פעם (פיזור עומס), ועל 429 עוברים לבא
async function groqFetch(url, model, makeInit) {
  let last;
  const start = groqNext++ % Math.max(1, GROQ_KEYS.length);
  for (let j = 0; j < GROQ_KEYS.length; j++) {
    const i = (start + j) % GROQ_KEYS.length;
    if ((groqCool.get(`${i}|${model}`) || 0) > Date.now()) continue;
    const res = await fetch(url, makeInit(GROQ_KEYS[i]));
    if (res.status !== 429) return res;
    const body = await res.text();
    const m = body.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
    const wait = m ? ((Number(m[1]) || 0) * 60 + Number(m[2])) * 1000 + 1500 : 60000;
    groqCool.set(`${i}|${model}`, Date.now() + Math.min(wait, 6 * 3600 * 1000));
    last = body;
  }
  // כל המפתחות במכסה לדגם הזה
  const soonest = Math.min(...GROQ_KEYS.map((_, i) => groqCool.get(`${i}|${model}`) || 0));
  const secs = Math.max(1, Math.round((soonest - Date.now()) / 1000));
  throw new Error(`429 כל מפתחות Groq במכסה ל-${model} (try again in ${secs}s) ${String(last || '').slice(0, 120)}`);
}

const TIMEOUT = 12000; // מקסימום זמן לכל ניסיון
const BUDGET = 22000; // מקסימום זמן לכל השרשרת - ימות לא מחכה יותר מזה

// ---------- תמלול ----------

// סדר ספקי התמלול
const TRANSCRIBERS = [
  GROQ_KEY && { name: 'groq:whisper-large-v3', fn: (a, h) => groqTranscribe(a, 'whisper-large-v3', h) },
  GROQ_KEY && { name: 'groq:whisper-large-v3-turbo', fn: (a, h) => groqTranscribe(a, 'whisper-large-v3-turbo', h) },
  GEMINI_KEY && { name: 'gemini:flash-lite', fn: (a, h) => geminiTranscribe(a, 'gemini-flash-lite-latest', h) },
  GEMINI_KEY && { name: 'gemini:flash', fn: (a, h) => geminiTranscribe(a, 'gemini-flash-latest', h) },
].filter(Boolean);

// hint = הקשר שעוזר לתמלול (למשל: "כתובות ושמות מקומות בישראל")
export async function transcribe(audio, hint = '') {
  return runChain('תמלול', TRANSCRIBERS, audio, hint);
}

// תמלול בכל שפה (זיהוי אוטומטי) - לתרגומון
const ANY_TRANSCRIBERS = [
  GROQ_KEY && { name: 'groq:whisper-large-v3', fn: (a, h) => groqTranscribe(a, 'whisper-large-v3', h, null) },
  GROQ_KEY && { name: 'groq:whisper-large-v3-turbo', fn: (a, h) => groqTranscribe(a, 'whisper-large-v3-turbo', h, null) },
  GEMINI_KEY && { name: 'gemini:flash-lite', fn: (a, h) => geminiTranscribe(a, 'gemini-flash-lite-latest', h, null) },
  GEMINI_KEY && { name: 'gemini:flash', fn: (a, h) => geminiTranscribe(a, 'gemini-flash-latest', h, null) },
].filter(Boolean);
export async function transcribeAny(audio, hint = '') {
  return runChain('תמלול', ANY_TRANSCRIBERS, audio, hint);
}

// תמלול כפול במקביל (Whisper + Gemini) - לבקשות שבהן שמות מקומות חשובים.
// מחזיר את כל הגרסאות שהצליחו.
export async function transcribeBoth(audio, hint = '') {
  const jobs = [];
  if (GROQ_KEY) jobs.push(groqTranscribe(audio, 'whisper-large-v3', hint).then((t) => ['whisper', t]));
  if (GEMINI_KEY) jobs.push(geminiTranscribe(audio, 'gemini-flash-lite-latest', hint).then((t) => ['gemini', t]));
  const res = await Promise.allSettled(jobs);
  const out = res.filter((r) => r.status === 'fulfilled' && r.value[1]).map((r) => r.value);
  if (!out.length) {
    const t = await transcribe(audio, hint);
    if (t.text) out.push([t.provider, t.text]);
  }
  return out;
}

async function groqTranscribe(audio, model, hint = '', lang = 'he') {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'rec.wav');
  form.append('model', model);
  if (lang) form.append('language', lang); // בלי שפה = זיהוי אוטומטי
  form.append('response_format', 'json');
  if (hint) form.append('prompt', hint);
  const res = await groqFetch('https://api.groq.com/openai/v1/audio/transcriptions', model, (key) => ({
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return (data.text || '').trim();
}

async function geminiTranscribe(audio, model, hint = '', lang = 'he') {
  const data = await geminiRequest(model, {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'audio/wav', data: audio.toString('base64') } },
          {
            text:
              (lang
                ? 'תמלל במדויק את ההקלטה בעברית. החזר רק את הטקסט שנאמר, בלי שום תוספת. אם אין דיבור, החזר מחרוזת ריקה.'
                : 'Transcribe the recording exactly, in the original language it was spoken in (do not translate). Return only the spoken text, nothing else. If there is no speech, return an empty string.') +
              (hint ? ' הקשר: ' + hint : ''),
          },
        ],
      },
    ],
  });
  return data.trim();
}

// ---------- Gemini בתשלום דרך Vertex AI (על חשבון קרדיט הניסיון, עם גבול קשיח) ----------
// פעיל רק כש-GOOGLE_TRIAL_CREDIT_USD מוגדר ויש מסד. כל בקשה נשמרת מראש בקופה (lib/credit.js).
const VERTEX_KEY = String(process.env.GOOGLE_VERTEX_API_KEY || process.env.GOOGLE_TTS_API_KEY || '').trim();
const VERTEX_MODEL = process.env.VERTEX_MODEL || 'gemini-3.8-flash';
const VERTEX_ON = creditOn && (Boolean(VERTEX_KEY) || hasServiceAccount);
const VERTEX_MAX_OUT = 1500; // מקסימום טוקנים לתשובה
const VERTEX_THINK_BOUND = 6000; // הערכת גג לטוקני "חשיבה" ברמה נמוכה
const VERTEX_MAX_SEARCHES = 10; // הערכת גג לשאילתות חיפוש בבקשה אחת

async function vertexAnswer(system, history, withSearch = false) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: history.map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text || '...' }] })),
    generationConfig: { maxOutputTokens: VERTEX_MAX_OUT, thinkingConfig: { thinkingLevel: 'low' } },
    ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
  };
  const json = JSON.stringify(body);
  // גג למחיר: כל בית בבקשה נספר כטוקן קלט (טוקן הוא לפחות בית אחד, אז זה תמיד יותר מהאמת)
  const maxUsd =
    Buffer.byteLength(json) * PRICE.geminiIn +
    (VERTEX_MAX_OUT + VERTEX_THINK_BOUND) * PRICE.geminiOut +
    (withSearch ? VERTEX_MAX_SEARCHES * PRICE.searchQuery : 0);
  const reserved = await reserveCredit(maxUsd);
  if (!reserved) throw new Error('429 קופת הקרדיט מלאה'); // מכסה -> המערכת עוברת לספקים החינמיים
  let res;
  try {
    const url = hasServiceAccount && serviceProject
      ? `https://aiplatform.googleapis.com/v1/projects/${serviceProject}/locations/global/publishers/google/models/${VERTEX_MODEL}:generateContent`
      : `https://aiplatform.googleapis.com/v1/publishers/google/models/${VERTEX_MODEL}:generateContent`;
    res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'Content-Type': 'application/json', ...(await googleAuthHeaders(VERTEX_KEY)) },
      body: json,
    });
  } catch (e) {
    throw e; // ניתוק / חריגת זמן: לא יודעים אם חויב - השמירה נשארת
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    releaseCredit(reserved); // שגיאה מפורשת = לא חויב
    throw new Error(`${res.status} ${JSON.stringify(data || {}).slice(0, 200)}`);
  }
  const u = data?.usageMetadata;
  const g = data?.candidates?.[0]?.groundingMetadata;
  if (u) {
    const searches = g ? Math.max(1, g.webSearchQueries?.length || 0) : 0;
    settleCredit(
      reserved,
      ((u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0)) * PRICE.geminiIn +
        ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * PRICE.geminiOut +
        searches * PRICE.searchQuery
    );
  } // בלי נתוני שימוש - משאירים את כל השמירה
  const text = (data?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('תשובה ריקה');
  return text;
}

// ---------- תשובה ----------

const ANSWERERS = [
  // הכי חכם קודם. כשהמכסה היומית שלו נגמרת בכל המפתחות - עוברים לבא בתור
  VERTEX_ON && { name: 'vertex:flash', fn: (s, h) => vertexAnswer(s, h) },
  // Flash-Lite קודם: Flash בחינם כמעט תמיד "עמוס" (503) או במכסה, ורק מבזבז זמן.
  // gemini-3.1-flash-lite הוא דגם נפרד עם מכסה יומית משלו - עוד מאגר תשובות חינמי
  GEMINI_KEY && { name: 'gemini:flash-lite', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-lite-latest') },
  GEMINI_KEY && { name: 'gemini:3.1-flash-lite', fn: (s, h) => geminiAnswer(s, h, 'gemini-3.1-flash-lite') },
  GEMINI_KEY && { name: 'gemini:flash', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-latest') },
  GROQ_KEY && { name: 'groq:gpt-oss-120b', fn: (s, h, mt) => groqAnswer(s, h, 'openai/gpt-oss-120b', undefined, mt) },
  // llama-3.3-70b הוסר מ-Groq. qwen3.8-27b - מכסה נפרדת של 1000 בקשות ביום
  GROQ_KEY && { name: 'groq:qwen3.8-27b', fn: (s, h, mt) => groqAnswer(s, h, 'qwen/qwen3.8-27b', undefined, mt) },
  GROQ_KEY && { name: 'groq:gpt-oss-20b', fn: (s, h, mt) => groqAnswer(s, h, 'openai/gpt-oss-20b', undefined, mt) },
].filter(Boolean);

// history: [{role:'user'|'model', text}] - כולל את השאלה הנוכחית בסוף
// deadline (לא חובה) = זמן שאחריו לא מתחילים ספק נוסף, משותף לכל שלבי הבקשה
// עבודות רקע (מהדורת חדשות): מודלים אחרים מהבוט, כדי לא לגזול ממנו את המכסה של Gemini
// ואת מגבלת הטוקנים לדקה של gpt-oss-120b. מחזיר JSON תקין.
const BULK = [
  GROQ_KEY && { name: 'groq:qwen3.8-27b', fn: (s, h, mt) => groqAnswer(s, h, 'qwen/qwen3.8-27b', undefined, mt, true) },
  GROQ_KEY && { name: 'groq:gpt-oss-20b', fn: (s, h, mt) => groqAnswer(s, h, 'openai/gpt-oss-20b', undefined, mt, true) },
  GEMINI_KEY && { name: 'gemini:flash-lite', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-lite-latest') },
].filter(Boolean);
export async function bulkAnswer(systemPrompt, history, deadline, maxTokens) {
  return runChain({ label: 'רקע', deadline }, BULK, systemPrompt, history, maxTokens);
}

// maxTokens: אורך תשובה מקסימלי (לתוכן ארוך כמו מהדורת חדשות)
export async function answer(systemPrompt, history, deadline, maxTokens) {
  return runChain({ label: 'תשובה', deadline }, ANSWERERS, systemPrompt, history, maxTokens);
}

async function geminiAnswer(system, history, model, withSearch = false) {
  return geminiRequest(model, {
    system_instruction: { parts: [{ text: system }] },
    contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text || '...' }] })),
    ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
  });
}

// רק ההודעות האחרונות נשלחות - פחות טוקנים = פחות חריגה ממגבלת הטוקנים לדקה של Groq (ומהיר יותר)
const recent = (history, n = 10) => history.slice(-n);
async function groqAnswer(system, history, model, tools, maxTokens, json = false) {
  history = recent(history);
  const res = await groqFetch('https://api.groq.com/openai/v1/chat/completions', model, (key) => ({
    method: 'POST',
    signal: AbortSignal.timeout(maxTokens > 1500 ? 45000 : TIMEOUT), // תוכן ארוך (חדשות) לוקח יותר זמן
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      // max_tokens נספר מראש במגבלת הטוקנים לדקה - לכן קטן לתשובות של הבוט, גדול רק כשמבקשים (חדשות)
      max_tokens: maxTokens || (tools ? 1200 : 800),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...(/qwen/.test(model) ? { reasoning_format: 'hidden' } : {}), // בלי "מחשבות" בתשובה
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
      messages: [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text || '...' })),
      ],
    }),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  // סימוני מקורות של החיפוש (כמו 【1†L4-L9】) - לא להקריא אותם
  const text = data.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/【[^】]*】/g, '').replace(/\[\d+\]/g, '').trim();
  if (!text) throw new Error('תשובה ריקה');
  return text;
}

// ---------- תשובה עם חיפוש באינטרנט (רק כשצריך מידע עדכני) ----------

const SEARCHERS = [
  VERTEX_ON && { name: 'vertex:flash+search', fn: (s, h) => vertexAnswer(s, h, true) },
  // חיפוש גוגל דרך Gemini קודם (הכי טוב בעברית), אחר כך החיפוש של Groq
  GEMINI_KEY && { name: 'gemini:flash-lite+search', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-lite-latest', true) },
  GEMINI_KEY && { name: 'gemini:3.1-flash-lite+search', fn: (s, h) => geminiAnswer(s, h, 'gemini-3.1-flash-lite', true) },
  GEMINI_KEY && { name: 'gemini:flash+search', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-latest', true) },
  GROQ_KEY && { name: 'groq:gpt-oss-120b+search', fn: (s, h) => groqAnswer(s, h, 'openai/gpt-oss-120b', [{ type: 'browser_search' }]) },
  GROQ_KEY && { name: 'groq:gpt-oss-20b+search', fn: (s, h) => groqAnswer(s, h, 'openai/gpt-oss-20b', [{ type: 'browser_search' }]) },
].filter(Boolean);

export async function searchAnswer(systemPrompt, history, deadline) {
  return runChain({ label: 'חיפוש', deadline }, SEARCHERS, systemPrompt, history);
}

// ---------- עזרים ----------

// המכסה היומית של גוגל מתאפסת בחצות לפי שעון קליפורניה
function untilPacificMidnight() {
  const now = new Date();
  const la = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const next = new Date(la); next.setHours(24, 0, 30, 0);
  return now.getTime() + (next - la);
}

// מפתח שהגיע למכסה במודל מסוים - מושבת לעשר דקות (לכל מודל בנפרד)
const keyCooldown = globalThis.__geminiKeyCooldown || (globalThis.__geminiKeyCooldown = new Map());
let keyTurn = 0;

async function geminiRequest(model, body) {
  // מתחילים כל פעם ממפתח אחר כדי לפזר את העומס
  const start = keyTurn++ % GEMINI_KEYS.length;
  let lastErr;
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const idx = (start + i) % GEMINI_KEYS.length;
    const key = GEMINI_KEYS[idx];
    const ck = `${idx}|${model}`;
    if ((keyCooldown.get(ck) || 0) > Date.now()) continue;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    lastErr = new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    // מכסה או מפתח לא תקין - עוברים למפתח הבא. שגיאה אחרת (בקשה שגויה) - עוצרים
    if (res.status === 429 || res.status === 403) {
      const daily = res.status === 429 && /PerDay|per day|daily/i.test(JSON.stringify(data));
      keyCooldown.set(ck, daily ? untilPacificMidnight() : Date.now() + (res.status === 403 ? 60 : 10) * 60 * 1000);
      console.error(`Gemini: מפתח ${idx + 1} ב-${model} - ${res.status}, עובר למפתח הבא`);
      continue;
    }
    throw lastErr;
  }
  throw lastErr || new Error(`429 כל ${GEMINI_KEYS.length} מפתחות Gemini במכסה`);
}

// ספק שנכשל על מכסה (429) מושבת לכמה דקות, כדי לא לבזבז עליו זמן בכל שאלה
const cooldown = globalThis.__aiCooldown || (globalThis.__aiCooldown = new Map());

async function runChain(opts, chain, ...args) {
  const label = typeof opts === 'string' ? opts : opts.label;
  if (!chain.length) throw new Error(`אין ספק מוגדר עבור ${label}`);
  let lastErr;
  let tried = 0, limited = 0;
  const deadline = (typeof opts === 'object' && opts.deadline) || Date.now() + BUDGET;
  for (const p of chain) {
    if ((cooldown.get(p.name) || 0) > Date.now()) { limited++; continue; }
    // נגמר הזמן - לא מתחילים ספק נוסף, עדיף הודעת עומס מאשר ניתוק של ימות
    if (Date.now() > deadline - 4000) { limited += chain.length; break; }
    tried++;
    try {
      // לא מחכים לספק מעבר לזמן שנשאר (גם אם הוא עצמו מוכן לחכות 12 שניות)
      const left = Math.max(3000, deadline - Date.now());
      const out = await Promise.race([
        p.fn(...args),
        new Promise((_, rej) => setTimeout(() => rej(new Error('deadline: נגמר הזמן לתשובה')), left)),
      ]);
      console.log(`${label} בוצע על ידי ${p.name}`);
      countUsage(label, p.name);
      return { text: out, provider: p.name };
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`${label}: ${p.name} נכשל:`, msg.slice(0, 200));
      if (msg.startsWith('429')) {
        // כמה לחכות: לפי מה שהספק אמר ("try again in 7.5s" / "in 2m3s"). מגבלת דקה (TPM/RPM) - דקה; מכסה יומית - שעה
        const m = msg.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
        const wait = m ? ((Number(m[1]) || 0) * 60 + Number(m[2])) * 1000 + 1500
          : /per day|daily|RPD|exceeded your current quota/i.test(msg) ? 60 * 60 * 1000 : 60 * 1000;
        cooldown.set(p.name, Date.now() + Math.min(wait, 6 * 60 * 60 * 1000));
        limited++;
      }
      // עומס אצל הספק (503) או שלא ענה בזמן - מדלגים עליו 3 דקות, כדי שהשאלות הבאות לא יחכו לו
      else if (/^5\d\d/.test(msg) || /abort|timeout|timed out/i.test(msg)) { cooldown.set(p.name, Date.now() + 3 * 60 * 1000); limited++; }
      // מודל שהוסר / לא קיים - לא לנסות אותו שוב שעה. שגיאה חד-פעמית של המודל (400 אחר) - בלי השבתה
      else if (msg.startsWith('404') || (msg.startsWith('400') && /not found|decommission|does not exist|not supported/i.test(msg)))
        cooldown.set(p.name, Date.now() + 60 * 60 * 1000);
      lastErr = err;
    }
  }
  // כל הספקים במכסה או בהשבתה - עומס (המתקשר ישמע הודעת עומס ולא "תקלה")
  if (limited > 0 || !tried) {
    const e = new Error(`BUSY: כל ספקי ה${label} במכסה כרגע`);
    e.busy = true;
    throw e;
  }
  throw lastErr || new Error(`כל ספקי ה${label} בהשבתה זמנית`);
}

// בדיקת אבחון: פנייה קטנה לכל מודל, כדי לראות מה עובד ומה במכסה
export async function diagnose() {
  const models = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'];
  const ping = async (key, model) => {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'אמור שלום' }] }] }),
      });
      const d = await r.json().catch(() => ({}));
      return r.ok ? 'ok' : `${r.status} ${String(d?.error?.message || '').slice(0, 120)}`;
    } catch (e) { return 'ERR ' + String(e?.message || e).slice(0, 80); }
  };
  const out = { model1: {}, perKey: {} };
  for (const m of models) out.model1[m] = await ping(GEMINI_KEYS[0], m);
  await Promise.all(GEMINI_KEYS.map(async (k, i) => {
    out.perKey[i + 1] = { flash: await ping(k, 'gemini-flash-latest'), lite: await ping(k, 'gemini-flash-lite-latest') };
  }));
  out.vertex = VERTEX_ON ? await vertexAnswer('ענה במילה אחת.', [{ role: 'user', text: 'אמור שלום' }]).then((t) => 'ok: ' + t.slice(0, 30), (e) => String(e.message).slice(0, 200)) : 'כבוי';
  out.cooldowns = Object.fromEntries([...cooldown].filter(([, t]) => t > Date.now()).map(([n, t]) => [n, Math.round((t - Date.now()) / 60000) + 'm']));
  return out;
}

// אבחון Groq: המגבלות האמיתיות של החשבון (מכותרות התשובה) לכל דגם, ובדיקת חיפוש באינטרנט
export async function groqLimits() {
  if (!GROQ_KEY) return { error: 'אין מפתח Groq' };
  const list = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${GROQ_KEY}` } }).then((r) => r.json()).catch(() => ({}));
  const available = (list.data || []).map((m) => m.id);
  const models = available.filter((m) => !/whisper|guard|tts|orpheus|compound/i.test(m)).slice(0, 12);
  const out = { _available: available };
  for (const m of models) {
    try {
      const isWhisper = m.startsWith('whisper');
      const r = isWhisper
        ? await fetch('https://api.groq.com/openai/v1/models/' + m, { headers: { Authorization: `Bearer ${GROQ_KEY}` } })
        : await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          });
      const h = (k) => r.headers.get(k);
      out[m] = { status: r.status, requestsPerDay: h('x-ratelimit-limit-requests'), requestsLeftToday: h('x-ratelimit-remaining-requests'),
        tokensPerMinute: h('x-ratelimit-limit-tokens'), tokensLeftThisMinute: h('x-ratelimit-remaining-tokens') };
      if (!r.ok) out[m].error = (await r.text()).slice(0, 150);
    } catch (e) { out[m] = { error: String(e.message) }; }
  }
  let search;
  try {
    const t = Date.now();
    const r = await searchAnswer('ענה בעברית במשפט אחד, על סמך חיפוש באינטרנט.', [{ role: 'user', text: 'מה מזג האוויר היום בירושלים?' }]);
    search = { ok: true, by: r.provider, ms: Date.now() - t, text: r.text.slice(0, 200) };
  } catch (e) { search = { ok: false, error: String(e.message).slice(0, 200) }; }
  return { models: out, search };
}
