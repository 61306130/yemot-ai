// API לאתר הניהול. כל הנתיבים (למעט login) מוגנים בסיסמה שנשלחת בכותרת x-admin-key.
// הסיסמה מוגדרת במשתנה הסביבה ADMIN_PASSWORD ב-Vercel.
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  overview, recentCalls, callMessages, listCallers, updateCaller,
  recentErrors, clearErrors, usageToday, podcastHistory, searchCallers, callerProfile } from '../../../lib/admin.js';
import { getSettings, setSettings, logError } from '../../../lib/store.js';
import { runPodcast } from '../../../lib/podcast.js';
import { getBulletin, refreshBulletin } from '../../../lib/news.js';
import {
  getConfig, getCandidates, setCandidate, clearCandidates, setOpen, setTitle, resetVotes, resetAll, getResults,
  getVoters,
} from '../../../lib/voting.js';
import { say, speakToPath, previewVoice, cloudTtsUsage } from '../../../lib/voice.js';
import { runCleanup } from '../../../lib/cleanup.js';
import { warmVoting } from '../../../lib/voting-voice.js';
import { bg } from '../../../lib/bg.js';
import { geminiKeyCount, groqKeyCount, diagnose } from '../../../lib/ai.js';
import { listSystems, setSystemStatus, deleteSystem, systemsMonitor, checkSystem, checkAllSystems, refreshAllSystems, renewSystemAddress } from '../../../lib/systems.js';

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
    if (path === 'systems' && method === 'GET') return json({ systems: await listSystems() });
    if (path === 'systems/status' && method === 'POST') {
      const { did, status } = await body(request);
      await setSystemStatus(String(did), status);
      return json({ ok: true });
    }
    if (path === 'systems/monitor' && method === 'GET') return json(await systemsMonitor());
    if (path === 'systems/check' && method === 'POST') {
      const { did } = await body(request);
      return json(did ? await checkSystem(String(did)) : { results: await checkAllSystems({ limit: 40 }) });
    }
    if (path === 'systems/refresh-all' && method === 'POST') {
      const baseUrl = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
      return json({ results: await refreshAllSystems({ baseUrl, speakMenu: speakToPath, limit: 30 }) });
    }
    if (path === 'systems/renew' && method === 'POST') {
      const { did } = await body(request);
      const baseUrl = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
      return json(await renewSystemAddress(String(did), { baseUrl, speakMenu: speakToPath }));
    }
    if (path === 'systems/domains' && method === 'GET') {
      const { domainsStatus } = await import('../../../lib/systems.js');
      return json({ domains: await domainsStatus() });
    }
    if (path === 'systems/domains/move' && method === 'POST') {
      const { moveOffDomain } = await import('../../../lib/systems.js');
      const { domain } = await body(request);
      const st = await getSettings();
      const off = new Set(Array.isArray(st['systems.domainsOff']) ? st['systems.domainsOff'] : []);
      off.add(domain);
      await setSettings({ 'systems.domainsOff': [...off] });
      const baseUrl = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
      return json({ results: await moveOffDomain(domain, { baseUrl }) });
    }
    if (path === 'systems/domains/toggle' && method === 'POST') {
      const { domain, on } = await body(request);
      const st = await getSettings();
      const off = new Set(Array.isArray(st['systems.domainsOff']) ? st['systems.domainsOff'] : []);
      if (on) off.delete(domain); else off.add(domain);
      await setSettings({ 'systems.domainsOff': [...off] });
      return json({ ok: true });
    }
    if (path === 'systems/domains/assign' && method === 'POST') {
      const { assignHostsAll } = await import('../../../lib/systems.js');
      const baseUrl = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
      return json({ results: await assignHostsAll({ baseUrl }) });
    }
    if (path === 'systems/cf' && method === 'GET') {
      const { cfAccounts, cfEnabled } = await import('../../../lib/cfworkers.js');
      const accs = cfEnabled ? await cfAccounts(true).catch((e) => ({ error: e.message })) : [];
      return json({ enabled: cfEnabled, accounts: Array.isArray(accs) ? accs.map(({ token, ...a }) => a) : [], error: accs.error });
    }
    if (path === 'systems/delete' && method === 'POST') {
      await deleteSystem(String((await body(request)).did));
      return json({ ok: true });
    }
    if (path === 'users' && method === 'GET') {
      const u = new URL(request.url);
      const phone = u.searchParams.get('phone');
      if (phone) return json({ profile: await callerProfile(phone) });
      return json({ users: await searchCallers(u.searchParams.get('q') || '') });
    }
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
    if (path === 'cleanup' && method === 'GET') return json({ last: (await getSettings())['cleanup.last'] || null });
    if (path === 'cleanup/run' && method === 'POST') return json({ report: await runCleanup() });
    if (path === 'errors' && method === 'GET') return json({ errors: await recentErrors() });
    if (path === 'errors' && method === 'DELETE') {
      await clearErrors();
      return json({ ok: true });
    }
    if (path === 'usage') return json({ usage: await usageToday(), geminiKeys: geminiKeyCount, groq: groqKeyCount, tts: await cloudTtsUsage().catch(() => null) });
    if (path === 'aitest') return json(await diagnose());

    // ----- הגדרות -----
    if (path === 'settings' && method === 'GET') return json({ settings: await getSettings() });
    if (path === 'settings' && method === 'POST') {
      await setSettings(await body(request));
      return json({ ok: true, settings: await getSettings() });
    }

    // ----- תפריט ראשי (יצירת קובץ קול) -----
    // יצירה מחדש של כל ההודעות בקול הנוכחי: step=cache (בסבבים, עד left=0), אחר כך step=menus
    if (path === 'voice/regen' && method === 'POST') {
      const { step, before } = await body(request);
      if (step === 'menus') {
        const st = await getSettings();
        const main = st['menu.text'] ? await speakToPath(st['menu.text'], st['menu.path'] || '/M1000').catch((e) => ({ error: e.message })) : null;
        const baseUrl = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
        const systems = await refreshAllSystems({ baseUrl, speakMenu: speakToPath, limit: 30 });
        return json({ main, systems });
      }
      const { regenAll } = await import('../../../lib/voice.js');
      return json(await regenAll({ budgetMs: 45000, before: before || null }));
    }
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
      const b = await refreshBulletin(); // תמיד מהדורה חדשה, גם אם הקודמת עדכנית
      return json({ bulletin: b });
    }

    if (path === 'news/stats' && method === 'GET') {
      const { newsStats } = await import('../../../lib/newsstats.js');
      const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 14));
      return json({ stats: await newsStats(days) });
    }
    if (path === 'transit/log' && method === 'GET') {
      const { transitLog } = await import('../../../lib/transit.js');
      return json({ log: await transitLog() });
    }
    // ----- הצבעה -----
    if (path === 'voting' && method === 'GET') {
      const { config, results, total } = await getResults();
      return json({ config, candidates: await getCandidates(), results, total });
    }
    if (path === 'voting/voters' && method === 'GET') {
      return json(await getVoters(new URL(request.url).searchParams.get('round')));
    }
    if (path === 'voting/candidates' && method === 'POST') {
      const { candidates } = await body(request); // [{num,name}] - מחליף את כל הרשימה
      await clearCandidates();
      for (const c of candidates || []) {
        if (c.name && String(c.name).trim()) await setCandidate(c.num, c.name);
      }
      bg(() => warmVoting().catch(() => {})); // הקלטת כל ההודעות מראש, ברקע
      return json({ ok: true, candidates: await getCandidates() });
    }
    if (path === 'voting/title' && method === 'POST') {
      await setTitle((await body(request)).title);
      bg(() => warmVoting().catch(() => {}));
      return json({ ok: true });
    }
    if (path === 'voting/open' && method === 'POST') {
      await setOpen(!!(await body(request)).open);
      bg(() => warmVoting().catch(() => {}));
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
      const { text, voice, rate } = await body(request);
      const s = await getSettings();
      const r = await previewVoice(String(text || 'שלום, זאת דוגמה לקול').slice(0, 300), voice || s['voice.name'], rate ?? s['voice.rate'] ?? 0);
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
