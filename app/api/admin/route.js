// API לאתר הניהול. כל הנתיבים (למעט login) מוגנים בסיסמה שנשלחת בכותרת x-admin-key.
// הסיסמה מוגדרת במשתנה הסביבה ADMIN_PASSWORD ב-Vercel.
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  overview, recentCalls, callMessages, listCallers, updateCaller,
  recentErrors, clearErrors, usageToday, podcastHistory,
} from '../../../lib/admin.js';
import { getSettings, setSettings, logError } from '../../../lib/store.js';
import { runPodcast } from '../../../lib/podcast.js';
import { getBulletin } from '../../../lib/news.js';
import {
  getConfig, getCandidates, setCandidate, clearCandidates, setOpen, setTitle, resetVotes, resetAll, getResults,
} from '../../../lib/voting.js';
import { say, speakToPath, previewVoice } from '../../../lib/voice.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PASSWORD = process.env.ADMIN_PASSWORD || '';

function json(data, status = 200) {
  return Response.json(data, { status });
}

function eq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function authed(request) {
  if (!PASSWORD) return false;
  const key = request.headers.get('x-admin-key') || '';
  return eq(key, PASSWORD);
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function handle(request, ctx) {
  const path = new URL(request.url).searchParams.get('p') || '';
  const method = request.method;

  // התחברות: בודקים סיסמה בלבד
  if (path === 'login' && method === 'POST') {
    if (!PASSWORD) return json({ ok: false, error: 'ADMIN_PASSWORD לא הוגדר בשרת' }, 500);
    const { password } = await body(request);
    return eq(password, PASSWORD) ? json({ ok: true }) : json({ ok: false }, 401);
  }

  if (!authed(request)) return json({ ok: false, error: 'לא מורשה' }, 401);

  try {
    // ----- נתונים -----
    if (path === 'overview') return json(await overview());
    if (path === 'calls') {
      const u = new URL(request.url);
      const id = u.searchParams.get('id');
      if (id) return json({ messages: await callMessages(id) });
      return json({ calls: await recentCalls(60) });
    }
    if (path === 'callers' && method === 'GET') return json({ callers: await listCallers() });
    if (path === 'callers' && method === 'POST') {
      const { phone, ...fields } = await body(request);
      await updateCaller(phone, fields);
      return json({ ok: true });
    }
    if (path === 'errors' && method === 'GET') return json({ errors: await recentErrors() });
    if (path === 'errors' && method === 'DELETE') {
      await clearErrors();
      return json({ ok: true });
    }
    if (path === 'usage') return json({ usage: await usageToday() });

    // ----- הגדרות -----
    if (path === 'settings' && method === 'GET') return json({ settings: await getSettings() });
    if (path === 'settings' && method === 'POST') {
      await setSettings(await body(request));
      return json({ ok: true, settings: await getSettings() });
    }

    // ----- תפריט ראשי (יצירת קובץ קול) -----
    if (path === 'menu/publish' && method === 'POST') {
      const s = await getSettings();
      const text = (await body(request)).text || s['menu.text'];
      if (!text) return json({ ok: false, error: 'אין טקסט לתפריט' }, 400);
      await setSettings({ 'menu.text': text });
      const result = await speakToPath(text, s['menu.path'] || '/M1000');
      return json({ ok: true, yemot: result });
    }

    // ----- פודקאסט -----
    if (path === 'podcast' && method === 'GET') return json({ history: await podcastHistory() });
    if (path === 'podcast/run' && method === 'POST') {
      const result = await runPodcast({ force: !!(await body(request)).force });
      return json(result);
    }

    // ----- חדשות -----
    if (path === 'news' && method === 'GET') {
      const b = await getBulletin({ build: false }).catch(() => null);
      return json({ bulletin: b });
    }
    if (path === 'news/refresh' && method === 'POST') {
      const b = await getBulletin();
      return json({ bulletin: b });
    }

    // ----- הצבעה -----
    if (path === 'voting' && method === 'GET') {
      const { config, results, total } = await getResults();
      return json({ config, candidates: await getCandidates(), results, total });
    }
    if (path === 'voting/candidates' && method === 'POST') {
      const { candidates } = await body(request); // [{num,name}] - מחליף את כל הרשימה
      await clearCandidates();
      for (const c of candidates || []) {
        if (c.name && String(c.name).trim()) await setCandidate(c.num, c.name);
      }
      return json({ ok: true, candidates: await getCandidates() });
    }
    if (path === 'voting/title' && method === 'POST') {
      await setTitle((await body(request)).title);
      return json({ ok: true });
    }
    if (path === 'voting/open' && method === 'POST') {
      await setOpen(!!(await body(request)).open);
      return json({ ok: true, config: await getConfig() });
    }
    if (path === 'voting/reset' && method === 'POST') {
      const { all } = await body(request).catch(() => ({}));
      if (all) await resetAll();
      else await resetVotes();
      return json({ ok: true });
    }

    // ----- תצוגה מקדימה של קול -----
    if (path === 'voice/preview' && method === 'POST') {
      const { text, voice } = await body(request);
      const s = await getSettings();
      const r = await previewVoice(String(text || 'שלום, זאת דוגמה לקול').slice(0, 300), voice || s['voice.name']);
      return json({ ok: true, engine: r.engine, error: r.error, audio: r.audio.toString('base64') });
    }

    return json({ ok: false, error: 'נתיב לא נמצא' }, 404);
  } catch (err) {
    logError('admin-api:' + path, err);
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
}

export async function GET(request, ctx) {
  return handle(request, ctx);
}
export async function POST(request, ctx) {
  return handle(request, ctx);
}
export async function DELETE(request, ctx) {
  return handle(request, ctx);
}
