import { resolveSystem, enterSystem } from '../../../lib/systems.js';
// שלוחת חדשות (ימות פונה לכאן). מקריא מהדורה בקול טבעי, ואפשר להקיש מספר ידיעה בכל רגע.
import { getBulletin, anyBulletin, refreshBulletin, bulletinText as makeText } from '../../../lib/news.js';
import { bg } from '../../../lib/bg.js';
import { say } from '../../../lib/voice.js';
import { logError } from '../../../lib/store.js';
import { trackListen } from '../../../lib/newsstats.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function reply(text) {
  console.log('חדשות -> ימות:', text.slice(0, 300));
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// קבלת הקשה אחת. msgs = הודעות מוכנות לימות. ההקשה נקלטת גם באמצע ההקראה.
// secWait = כמה שניות לחכות להקשה בסוף. אם לא הקישו - מוחזר None
function tapRead(msgs, name, secWait = 8) {
  const ops = [name, 'no', '1', '1', String(secWait), 'No', 'no', 'no', '', '', '', 'Ok', 'None'];
  return `read=${msgs.filter(Boolean).join('.')}=${ops.join(',')}`;
}

const MENU = 'לפרטים על ידיעה, הקש את מספרה. לשמיעה חוזרת של המהדורה, הקש אפס';
const MENU_AFTER_ITEM = 'לידיעה אחרת, הקש את מספרה. לשמיעה חוזרת של המהדורה, הקש אפס';
const WAIT = 'אנא המתינו, בזמן שאנו מכינים עבורכם את המהדורה';

async function handle(request) {
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);
  if (request.method === 'POST') {
    try {
      for (const [k, v] of await request.formData()) p[k] = v;
    } catch {}
  }
  if (p.hangup === 'yes') {
    if (p.ApiCallId) bg(() => trackListen(p, null, 'end'));
    return reply('');
  }
  // אבחון זמני של נעילות במסד - רק דרך כתובת הביניים (עם המפתח הסודי שלה)
  if (p.dbdiag && process.env.PROXY_SECRET && request.headers.get('x-proxy-key') === process.env.PROXY_SECRET) {
    const { dbDiag } = await import('../../../lib/dbdiag.js');
    return Response.json(await dbDiag(p.dbdiag === 'fix'));
  }
  if (p.aidiag && process.env.PROXY_SECRET && request.headers.get('x-proxy-key') === process.env.PROXY_SECRET) {
    const ai = await import('../../../lib/ai.js');
    if (p.aidiag === 'regenmenus') {
      const v = await import('../../../lib/voice.js');
      const { getSettings } = await import('../../../lib/store.js');
      const { refreshAllSystems } = await import('../../../lib/systems.js');
      const st = await getSettings();
      const main = st['menu.text'] ? await v.speakToPath(st['menu.text'], st['menu.path'] || '/M1000').catch((e) => ({ error: e.message })) : null;
      const baseUrl = process.env.PUBLIC_BASE_URL || 'https://yemot-ai-dusky.vercel.app';
      const systems = await refreshAllSystems({ baseUrl, speakMenu: v.speakToPath, limit: 30 });
      return Response.json({ menuText: st['menu.text'], main, systems });
    }
    if (p.aidiag === 'ab') {
      const v = await import('../../../lib/voice.js');
      const { stripNiqqud, nakdan } = await import('../../../lib/nakdan.js');
      const nq = 'רִאשׁוֹנָה, ירוּשָׁלַיִם מְאֻחֶדֶת תַּחַת רְשׁוּת אַחַת מֵאָז שְׁנַת 1967. שֵׁנִית, שְׁמוֹ הָעַתִּיק שֶׁל הַר הַבַּיִת הוּא הַר מֹרִיָּה. שְׁלִישִׁית, בָּעִיר פּוֹעֵל קַו הָרַכֶּבֶת הַקַּלָּה מֵאָז שְׁנַת 2011.';
      const plain = stripNiqqud(nq);
      const dicta = await nakdan(plain, 5000);
      if (p.set === 'custom') {
        const list = String(p.q || '').split('|').filter(Boolean).map((t, i) => ({ name: String(i + 1), text: t, rate: Number(p.rate) || 0 }));
        return Response.json(await v.ttsAB(list, p.voice || 'he-IL-Chirp3-HD-Charon', p.nq ? ai.transcribeNiqqud : ai.transcribeMp3));
      }
      if (p.set === 'voices') {
        const t = 'שלום, כאן בוטי. מחר בבוקר צפוי גשם בצפון, והטמפרטורות ירדו מעט. כדאי לצאת מוקדם, ולקחת מטריה. רוצה שאבדוק גם את זמני התפילות?';
        const names = String(p.list || 'Charon,Orus,Fenrir,Puck,Zephyr,Kore').split(',');
        const vs = [];
        for (const n of names) for (const r of [0, 15]) {
          const [res] = await v.ttsAB([{ name: `${n} ${r}`, text: t, rate: r }], `he-IL-Chirp3-HD-${n}`, ai.transcribeMp3);
          vs.push(res);
        }
        return Response.json({ text: t, results: vs });
      }
      if (p.set === 'num') {
        const { speakable } = await import('../../../lib/hebnum.js');
        const a = 'מחר בירושלים 22 מעלות, ובתל אביב 27 מעלות. הרכבת יוצאת בשעה 10:30 והכרטיס עולה 35 שקלים.';
        return Response.json(await v.ttsAB([
          { name: 'ספרות', text: a, rate: 15 },
          { name: 'מילים בלי ניקוד', text: stripNiqqud(speakable(a)), rate: 15 },
        ], p.voice || 'he-IL-Chirp3-HD-Charon', ai.transcribeMp3));
      }
      const variants = [
        { name: 'בלי ניקוד, מהירות 15', text: plain, rate: 15 },
        { name: 'בלי ניקוד, מהירות רגילה', text: plain, rate: 0 },
        { name: 'ניקוד AI, מהירות 15', text: nq, rate: 15 },
        { name: 'ניקוד AI, מהירות רגילה', text: nq, rate: 0 },
        { name: 'ניקוד דיקטה, מהירות 15', text: dicta, rate: 15 },
      ];
      return Response.json(await v.ttsAB(variants, p.voice || 'he-IL-Chirp3-HD-Charon', ai.transcribeMp3));
    }
    if (p.aidiag === 'last') {
      const { sql } = await import('../../../lib/db.js');
      const msgs = await sql`select role, text, created_at from messages order by id desc limit ${Number(p.n) || 16}`;
      const errs = await sql`select source, message, created_at from error_log where created_at > now() - interval '3 hours' order by created_at desc limit 30`;
      const { getSettings } = await import('../../../lib/store.js');
      const st = await getSettings();
      return Response.json({ settings: { niqqud: st['bot.niqqud'], nakdan: st['voice.nakdan'], voice: st['voice.name'], rate: st['voice.rate'], vertex: st['bot.vertex'] },
        msgs: msgs.reverse(), errs: errs.map((e) => ({ ...e, message: e.message.split('\n')[0].slice(0, 300) })) });
    }
    if (p.aidiag === 'nakdan') {
      const { nakdanTest } = await import('../../../lib/nakdan.js');
      return Response.json(await nakdanTest(p.q || undefined));
    }
    if (p.aidiag === 'mod') {
      const tests = String(p.q || '').split('|').filter(Boolean);
      const out = [];
      for (const t of tests) { const t0 = Date.now(); out.push({ t, ...(await ai.moderate(t)), ms: Date.now() - t0 }); }
      return Response.json(out);
    }
    if (p.aidiag === 'regen') {
      const v = await import('../../../lib/voice.js');
      return Response.json(await v.regenAll({ budgetMs: 45000, before: p.before || null }));
    }
    if (p.aidiag === 'bot') {
      const v = await import('../../../lib/voice.js');
      const { getSettings } = await import('../../../lib/store.js');
      const { creditStatus } = await import('../../../lib/credit.js');
      const cfg = await getSettings();
      const before = await creditStatus();
      const ai1 = await ai.vertexProbe();
      const text = ai1.text || 'זו בדיקה של הקול. כוכב מאיר באור של עצמו, וכוכב לכת מחזיר את האור של השמש. כדור הארץ הוא כוכב לכת.';
      const t = Date.now();
      const file = await v.say(text, { name: 'diag-bot-voice' });
      const ttsMs = Date.now() - t;
      const t2 = Date.now();
      const syn = await v.previewVoice(text, cfg['voice.name'], Number(cfg['voice.rate']) || 0).catch((e) => ({ error: String(e) }));
      return Response.json({ voice: cfg['voice.name'], rate: cfg['voice.rate'], ai: ai1, sayMs: ttsMs, file,
        synthOnlyMs: Date.now() - t2, engine: syn.engine, synthError: syn.error, creditBefore: before, creditAfter: await creditStatus() });
    }
    if (p.aidiag === 'tts') {
      const v = await import('../../../lib/voice.js');
      return Response.json({ tts: await v.testCloudTts(), vertex: (await ai.diagnose()).vertex });
    }
    return Response.json(p.aidiag === 'groq' ? { keys: await ai.groqKeysCheck(), ...(await ai.groqLimits()) } : await ai.diagnose());
  }
  // מערכת של משתמש (k) - הקבצים וההקלטות עוברים דרך הטוקן שלה
  const sys = await resolveSystem(p, request).catch(() => ({}));
  if (sys.denied) return reply(`id_list_message=t-${sys.denied.replace(/[.,]/g, ' ')}&go_to_folder=hangup`);
  enterSystem(sys);

  const sels = Object.keys(p)
    .filter((k) => /^sel\d+$/.test(k))
    .map((k) => Number(k.slice(3)))
    .sort((a, b) => a - b);
  const n = sels.length ? sels[sels.length - 1] : 0;
  const choice = n ? String(p[`sel${n}`]) : null;

  // יש מהדורה (גם אם קצת ישנה) - מקריאים מיד. אם ישנה, בונים חדשה ברקע אחרי התשובה.
  // אין מהדורה בכלל - קודם הודעת המתנה, ומיד אחריה ימות חוזרת לכאן (wait=None) ואז בונים
  let bulletin;
  const have = await anyBulletin();
  if (have) {
    bulletin = have.data;
    if (have.stale) bg(() => refreshBulletin().catch((e) => console.error('חדשות ברקע:', e)));
  } else {
    if (!choice && !p.wait) return reply(tapRead([await say(WAIT, { cache: true })], 'wait', 1));
    try {
      bulletin = await getBulletin();
    } catch (err) {
      logError('news', err);
      return reply(`id_list_message=${await say('סליחה, לא ניתן לטעון את החדשות כרגע. נסו שוב בעוד כמה דקות', { cache: true })}&go_to_folder=/`);
    }
  }
  const items = bulletin.items;
  const bulletinText = makeText(bulletin);
  // מעקב האזנות (ברקע, לא מעכב את ההקראה)
  {
    const ev = !choice ? 'start' : choice === '0' ? 'replay' : choice === 'None' ? 'end' : 'item';
    bg(() => trackListen(p, sys, ev, { item: choice, bulletinAt: have?.at ? new Date(have.at) : null }));
  }

  // כניסה לשלוחה, או בקשה לשמיעה חוזרת
  if (!choice || choice === '0') {
    const [b, m] = await Promise.all([say(bulletinText, { cache: true }), say(MENU, { cache: true })]);
    return reply(tapRead([b, m], `sel${n + 1}`));
  }

  // לא הקישו כלום - יוצאים לתפריט הראשי
  if (choice === 'None') {
    return reply(`id_list_message=${await say('תודה שהאזנתם', { cache: true })}&go_to_folder=/`);
  }

  const item = items[Number(choice) - 1];
  if (!item) {
    const [a, m] = await Promise.all([say(`אין ידיעה מספר ${choice}`, { cache: true }), say(MENU, { cache: true })]);
    return reply(tapRead([a, m], `sel${n + 1}`));
  }
  const [d, m] = await Promise.all([
    say(`${item.title}. ${item.details || item.summary}`, { cache: true }),
    say(MENU_AFTER_ITEM, { cache: true }),
  ]);
  return reply(tapRead([d, m], `sel${n + 1}`));
}

export const GET = handle;
export const POST = handle;
