// התחברות ל-Google Cloud עם חשבון שירות (Service Account), למקרים שבהם מפתח API לא נתמך
// (Text-to-Speech ו-Vertex AI). המשתנה GOOGLE_SERVICE_ACCOUNT = תוכן קובץ ה-JSON של המפתח.
import { createSign } from 'node:crypto';

let sa = null;
try {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT || '';
  if (raw.trim()) sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
} catch (e) {
  console.error('GOOGLE_SERVICE_ACCOUNT לא תקין:', e.message);
}

export const hasServiceAccount = Boolean(sa?.client_email && sa?.private_key);
export const serviceProject = sa?.project_id || null;

const cache = globalThis.__gAuth || (globalThis.__gAuth = { token: null, exp: 0, pending: null });
const b64url = (x) => Buffer.from(x).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// טוקן גישה (בתוקף שעה), נשמר בזיכרון ומתחדש 5 דקות לפני שפג
export async function googleAccessToken() {
  if (!hasServiceAccount) return null;
  if (cache.token && Date.now() < cache.exp - 5 * 60 * 1000) return cache.token;
  if (cache.pending) return cache.pending;
  cache.pending = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${claim}`);
    const sig = signer.sign(sa.private_key).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) throw new Error(`Google auth ${res.status}: ${JSON.stringify(d).slice(0, 150)}`);
    cache.token = d.access_token;
    cache.exp = Date.now() + (d.expires_in || 3600) * 1000;
    return cache.token;
  })().finally(() => { cache.pending = null; });
  return cache.pending;
}

// כותרות התחברות: חשבון שירות אם יש, אחרת מפתח API
export async function googleAuthHeaders(apiKey) {
  const tok = await googleAccessToken().catch((e) => { console.error(e.message); return null; });
  if (tok) return { Authorization: `Bearer ${tok}` };
  return apiKey ? { 'x-goog-api-key': apiKey } : {};
}
