// ניקוד אוטומטי בנקדן של דיקטה (מרכז דיקטה, חינמי), לפני ההקראה בקול.
// ניקוד של מודלי שפה הוא לרוב שגוי, לכן מוחקים אותו ומנקדים מחדש בנקדן שמיועד לזה.
// אם הנקדן לא עונה בזמן - מקריאים בלי ניקוד (עדיף על ניקוד שגוי).

const ENDPOINTS = ['https://nakdan-u1-0.loadbalancer.dicta.org.il/api', 'https://nakdan-5-1.loadbalancer.dicta.org.il/api'];
const NIQQUD = /[֑-ׇ]/g;
const cache = globalThis.__nakdanCache || (globalThis.__nakdanCache = new Map());

export const stripNiqqud = (s) => String(s || '').replace(NIQQUD, '');

function pick(item) {
  if (!item) return '';
  if (item.sep) return item.word ?? item.str ?? '';
  const opt = Array.isArray(item.options) ? item.options[0] : item.nakdan || null;
  let w = Array.isArray(opt) ? opt[0] : typeof opt === 'string' ? opt : opt?.w || opt?.word || '';
  if (!w) w = item.word ?? item.str ?? '';
  return String(w).replace(/\|/g, ''); // הנקדן מסמן גבולות של תחיליות ב-|
}

async function callDicta(url, text, ms) {
  const r = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(ms),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: 'nakdan', data: text, genre: 'modern', addmorph: false, keepnikud: false,
      keepmetagim: false, keepqq: false, nodageshdefmem: false, patachma: false, matchpartial: true, useTokenization: true,
    }),
  });
  if (!r.ok) throw new Error(`נקדן ${r.status}`);
  const j = await r.json();
  const items = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : null;
  if (!items) throw new Error('נקדן: תשובה לא מוכרת');
  const out = items.map(pick).join('');
  if (!out.trim() || out.replace(NIQQUD, '').replace(/\s/g, '') !== text.replace(/\s/g, '')) {
    // הגנה: אם הנקדן שינה את האותיות עצמן - לא משתמשים בתוצאה
    if (Math.abs(out.replace(NIQQUD, '').length - text.length) > text.length * 0.05) throw new Error('נקדן: הטקסט השתנה');
  }
  return out;
}

// מנקד טקסט. ms = זמן מקסימלי. תמיד מחזיר טקסט (במקרה של כישלון - בלי ניקוד)
export async function nakdan(text, ms = 3500) {
  const clean = stripNiqqud(text);
  if (!/[א-ת]/.test(clean)) return clean;
  if (cache.has(clean)) return cache.get(clean);
  const t0 = Date.now();
  for (const url of ENDPOINTS) {
    const left = ms - (Date.now() - t0);
    if (left < 500) break;
    try {
      const out = await callDicta(url, clean, left);
      if (cache.size > 500) cache.clear();
      cache.set(clean, out);
      return out;
    } catch (e) {
      console.error('נקדן:', url.split('/')[2], String(e?.message || e).slice(0, 120));
    }
  }
  return clean;
}

export async function nakdanTest(text = 'הספר נמצא על השולחן בחדר, ומחר בבוקר נלך לבית הכנסת.') {
  const t0 = Date.now();
  const raw = {};
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(6000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'nakdan', data: text, genre: 'modern', useTokenization: true }) });
      raw[url.split('/')[2]] = { status: r.status, sample: (await r.text()).slice(0, 600) };
    } catch (e) { raw[url.split('/')[2]] = { error: String(e?.message || e) }; }
  }
  cache.delete(stripNiqqud(text));
  const t1 = Date.now();
  const out = await nakdan(text, 6000);
  return { text, out, ms: Date.now() - t1, rawMs: t1 - t0, raw };
}
