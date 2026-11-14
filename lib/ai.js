// שכבת ה-AI: תמלול + תשובה, עם מעבר אוטומטי בין ספקים כשאחד עמוס או נגמרה לו המכסה.

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

const TIMEOUT = 15000; // מקסימום זמן לכל ניסיון

// ---------- תמלול ----------

// סדר ספקי התמלול
const TRANSCRIBERS = [
  GROQ_KEY && { name: 'groq:whisper-large-v3', fn: (a) => groqTranscribe(a, 'whisper-large-v3') },
  GROQ_KEY && { name: 'groq:whisper-large-v3-turbo', fn: (a) => groqTranscribe(a, 'whisper-large-v3-turbo') },
  GEMINI_KEY && { name: 'gemini:flash-lite', fn: (a) => geminiTranscribe(a, 'gemini-flash-lite-latest') },
  GEMINI_KEY && { name: 'gemini:flash', fn: (a) => geminiTranscribe(a, 'gemini-flash-latest') },
].filter(Boolean);

export async function transcribe(audio) {
  return runChain('תמלול', TRANSCRIBERS, audio);
}

async function groqTranscribe(audio, model) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'rec.wav');
  form.append('model', model);
  form.append('language', 'he');
  form.append('response_format', 'json');
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

async function geminiTranscribe(audio, model) {
  const data = await geminiRequest(model, {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'audio/wav', data: audio.toString('base64') } },
          { text: 'תמלל במדויק את ההקלטה בעברית. החזר רק את הטקסט שנאמר, בלי שום תוספת. אם אין דיבור, החזר מחרוזת ריקה.' },
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
  GEMINI_KEY && { name: 'gemini:2.5-flash-lite', fn: (s, h) => geminiAnswer(s, h, 'gemini-2.5-flash-lite') },
  GROQ_KEY && { name: 'groq:llama-3.1-8b', fn: (s, h) => groqAnswer(s, h, 'llama-3.1-8b-instant') },
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

async function groqAnswer(system, history, model) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 600,
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
  GROQ_KEY && { name: 'groq:compound', fn: (s, h) => groqAnswer(s, h, 'groq/compound') },
  GROQ_KEY && { name: 'groq:compound-mini', fn: (s, h) => groqAnswer(s, h, 'groq/compound-mini') },
  GEMINI_KEY && { name: 'gemini:flash+search', fn: (s, h) => geminiAnswer(s, h, 'gemini-flash-latest', true) },
  GEMINI_KEY && { name: 'gemini:2.5-flash+search', fn: (s, h) => geminiAnswer(s, h, 'gemini-2.5-flash', true) },
].filter(Boolean);

export async function searchAnswer(systemPrompt, history) {
  return runChain('חיפוש', SEARCHERS, systemPrompt, history);
}

// ---------- עזרים ----------

async function geminiRequest(model, body) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

// ספק שנכשל על מכסה (429) מושבת לכמה דקות, כדי לא לבזבז עליו זמן בכל שאלה
const cooldown = globalThis.__aiCooldown || (globalThis.__aiCooldown = new Map());

async function runChain(label, chain, ...args) {
  if (!chain.length) throw new Error(`אין ספק מוגדר עבור ${label}`);
  let lastErr;
  for (const p of chain) {
    if ((cooldown.get(p.name) || 0) > Date.now()) continue;
    try {
      const out = await p.fn(...args);
      console.log(`${label} בוצע על ידי ${p.name}`);
      return { text: out, provider: p.name };
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`${label}: ${p.name} נכשל:`, msg.slice(0, 200));
      if (msg.startsWith('429')) cooldown.set(p.name, Date.now() + 5 * 60 * 1000);
      lastErr = err;
    }
  }
  throw lastErr || new Error(`כל ספקי ה${label} בהשבתה זמנית`);
}
