import { countUsage } from './store.js';
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

const TIMEOUT = 15000; // מקסימום זמן לכל ניסיון

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

async function groqTranscribe(audio, model, hint = '') {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'rec.wav');
  form.append('model', model);
  form.append('language', 'he');
  form.append('response_format', 'json');
  if (hint) form.append('prompt', hint);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return (data.text || '').trim();
}

async function geminiTranscribe(audio, model, hint = '') {
  const data = await geminiRequest(model, {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'audio/wav', data: audio.toString('base64') } },
          {
            text:
              'תמלל במדויק את ההקלטה בעברית. החזר רק את הטקסט שנאמר, בלי שום תוספת. אם אין דיבור, החזר מחרוזת ריקה.' +
              (hint ? ' הקשר: ' + hint : ''),
          },
        ],
      },
    ],
  });
  return data.trim();
}

// ---------- תשובה ----------

const ANSWERERS = [
  GEMINI_KEY && { name: 'gemini:flash-lite', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-lite-latest') },
  GROQ_KEY && { name: 'groq:llama-3.3-70b', fn: (s, h) => groqAnswer(s, h, 'llama-3.3-70b-versatile') },
  GROQ_KEY && { name: 'groq:gpt-oss-120b', fn: (s, h) => groqAnswer(s, h, 'openai/gpt-oss-120b') },
  GEMINI_KEY && { name: 'gemini:flash', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-latest') },
  GROQ_KEY && { name: 'groq:gpt-oss-20b', fn: (s, h) => groqAnswer(s, h, 'openai/gpt-oss-20b') },
].filter(Boolean);

// history: [{role:'user'|'model', text}] - כולל את השאלה הנוכחית בסוף
export async function answer(systemPrompt, history) {
  return runChain('תשובה', ANSWERERS, systemPrompt, history);
}

async function geminiAnswer(system, history, model, withSearch = false) {
  return geminiRequest(model, {
    system_instruction: { parts: [{ text: system }] },
    contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text || '...' }] })),
    ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
  });
}

async function groqAnswer(system, history, model, tools) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: tools ? 1500 : 600,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
      messages: [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text || '...' })),
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('תשובה ריקה');
  return text;
}

// ---------- תשובה עם חיפוש באינטרנט (רק כשצריך מידע עדכני) ----------

const SEARCHERS = [
  // GPT-OSS ב-Groq עם חיפוש מובנה בדפדפן
  GROQ_KEY && { name: 'groq:gpt-oss-120b+search', fn: (s, h) => groqAnswer(s, h, 'openai/gpt-oss-120b', [{ type: 'browser_search' }]) },
  GROQ_KEY && { name: 'groq:gpt-oss-20b+search', fn: (s, h) => groqAnswer(s, h, 'openai/gpt-oss-20b', [{ type: 'browser_search' }]) },
  GEMINI_KEY && { name: 'gemini:flash-lite+search', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-lite-latest', true) },
  GEMINI_KEY && { name: 'gemini:flash+search', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-latest', true) },
].filter(Boolean);

export async function searchAnswer(systemPrompt, history) {
  return runChain('חיפוש', SEARCHERS, systemPrompt, history);
}

// ---------- עזרים ----------

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
      keyCooldown.set(ck, Date.now() + (res.status === 403 ? 60 : 10) * 60 * 1000);
      console.error(`Gemini: מפתח ${idx + 1} ב-${model} - ${res.status}, עובר למפתח הבא`);
      continue;
    }
    throw lastErr;
  }
  throw lastErr || new Error(`429 כל ${GEMINI_KEYS.length} מפתחות Gemini במכסה`);
}

// ספק שנכשל על מכסה (429) מושבת לכמה דקות, כדי לא לבזבז עליו זמן בכל שאלה
const cooldown = globalThis.__aiCooldown || (globalThis.__aiCooldown = new Map());

async function runChain(label, chain, ...args) {
  if (!chain.length) throw new Error(`אין ספק מוגדר עבור ${label}`);
  let lastErr;
  let tried = 0, limited = 0;
  for (const p of chain) {
    if ((cooldown.get(p.name) || 0) > Date.now()) { limited++; continue; }
    tried++;
    try {
      const out = await p.fn(...args);
      console.log(`${label} בוצע על ידי ${p.name}`);
      countUsage(label, p.name);
      return { text: out, provider: p.name };
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`${label}: ${p.name} נכשל:`, msg.slice(0, 200));
      if (msg.startsWith('429')) { cooldown.set(p.name, Date.now() + 5 * 60 * 1000); limited++; }
      // מודל שהוסר / לא קיים - לא לנסות אותו שוב שעה
      if (msg.startsWith('404') || msg.startsWith('400')) cooldown.set(p.name, Date.now() + 60 * 60 * 1000);
      lastErr = err;
    }
  }
  // כל הספקים במכסה או בהשבתה - עומס (המתקשר ישמע הודעת עומס ולא "תקלה")
  if (limited >= chain.length || !tried) {
    const e = new Error(`BUSY: כל ספקי ה${label} במכסה כרגע`);
    e.busy = true;
    throw e;
  }
  throw lastErr || new Error(`כל ספקי ה${label} בהשבתה זמנית`);
}
