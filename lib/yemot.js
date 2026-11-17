// עזרים משותפים לעבודה מול ימות המשיח
export function reply(text, tag = 'ימות') {
  console.log(`${tag} <-`, String(text).slice(0, 300));
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function readParams(request) {
  const p = Object.fromEntries(new URL(request.url).searchParams);
  if (request.method === 'POST') {
    try {
      for (const [k, v] of await request.formData()) p[k] = v;
    } catch {}
  }
  return p;
}

// הקשה אחת. msgs = הודעות מוכנות (f-/t-). אם לא הקישו - None
export function tapRead(msgs, name, secWait = 10) {
  const ops = [name, 'no', '1', '1', String(secWait), 'No', 'no', 'no', '', '', '', 'Ok', 'None'];
  return `read=${[].concat(msgs).filter(Boolean).join('.')}=${ops.join(',')}`;
}

// קליטת מספר באורך משתנה (minDigits..maxDigits). מסיימים בסולמית, או מחכים secWait שניות.
// אם לא הוקש כלום - מוחזר None
// סדר הערכים בימות: שם, בקשה מחדש, מקסימום ספרות, מינימום ספרות, שניות המתנה, צורת השמעה...
export function digitsRead(msgs, name, { min = 1, max = 2, secWait = 15 } = {}) {
  const ops = [name, 'no', String(max), String(min), String(secWait), 'No', 'no', 'no', '', '', '', 'Ok', 'None'];
  return `read=${[].concat(msgs).filter(Boolean).join('.')}=${ops.join(',')}`;
}

// הקלטה (בלי תפריט אישור, עד 30 שניות)
export function recordRead(msgs, name) {
  const ops = [name, 'no', 'record', '', '', 'no', 'yes', 'no', '1', '30'];
  return `read=${[].concat(msgs).filter(Boolean).join('.')}=${ops.join(',')}`;
}

export async function downloadRecording(value, extension, token = process.env.YEMOT_TOKEN) {
  let path = String(value);
  if (!path.includes('/')) path = `/${extension || ''}/${path}`;
  if (!path.startsWith('/')) path = '/' + path;
  path = path.replace(/\/+/g, '/');
  if (!/\.\w{2,4}$/.test(path)) path += '.wav';
  const url =
    'https://www.call2all.co.il/ym/api/DownloadFile?token=' +
    encodeURIComponent(token) +
    '&path=' +
    encodeURIComponent('ivr2:' + path);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('json') || buf.length < 500) {
    throw new Error(`הורדת ההקלטה נכשלה (${res.status}) ${path}: ${buf.toString().slice(0, 200)}`);
  }
  return buf;
}
