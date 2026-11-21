import { resolveSystem, enterSystem } from '../../../lib/systems.js';
// שלוחת חדשות (ימות פונה לכאן). מקריא מהדורה בקול טבעי, ואפשר להקיש מספר ידיעה בכל רגע.
import { getBulletin } from '../../../lib/news.js';
import { say } from '../../../lib/voice.js';
import { logError } from '../../../lib/store.js';

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
  if (p.hangup === 'yes') return reply('');
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

  // כניסה לשלוחה: אם אין מהדורה עדכנית - קודם הודעת המתנה, ומיד אחריה ימות חוזרת לכאן (wait=None)
  if (!choice && !p.wait) {
    const ready = await getBulletin({ build: false }).catch(() => null);
    if (!ready) return reply(tapRead([await say(WAIT, { cache: true })], 'wait', 1));
  }

  let bulletin;
  try {
    bulletin = await getBulletin();
  } catch (err) {
    logError('news', err);
    return reply(`id_list_message=${await say('סליחה, לא ניתן לטעון את החדשות כרגע. נסו שוב בעוד כמה דקות', { cache: true })}&go_to_folder=/`);
  }
  const items = bulletin.items;
  const time = new Date(bulletin.createdAt).toLocaleTimeString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
  });

  // המהדורה המלאה כטקסט אחד: "1. כותרת. תקציר. 2. ..." - נוצרת בקול פעם אחת ונשמרת
  const bulletinText =
    `מהדורת חדשות, מעודכנת לשעה ${time}.\n` +
    items.map((x, i) => `${i + 1}. ${x.title}. ${x.summary}`).join('\n');

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
