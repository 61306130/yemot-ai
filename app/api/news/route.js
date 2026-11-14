// שלוחת חדשות (ימות פונה לכאן). מקריא מהדורה, ואז אפשר להקיש מספר ידיעה לפרטים.
import { getBulletin } from '../../../lib/news.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function reply(text) {
  console.log('חדשות -> ימות:', text.slice(0, 300));
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// טקסט להקראה: ימות לא מקבלת . - " ' & | = , בתוך הקראה, לכן כל משפט הוא הודעה נפרדת
function tts(text) {
  return String(text)
    .split(/[.!?\n:]+/)
    .map((s) => s.replace(/[.\-"'&|=,*#_~<>()\[\]]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => 't-' + p)
    .join('.');
}

// קבלת הקשה אחת (ספרה). אם לא הקישו - מוחזר None
function tapRead(promptText, n) {
  const ops = [`sel${n}`, 'no', '1', '1', '8', 'No', 'no', 'no', '', '', '', 'Ok', 'None'];
  return `read=${tts(promptText)}=${ops.join(',')}`;
}

const MENU = 'לפרטים על ידיעה הקש את מספרה. לשמיעה חוזרת של המהדורה הקש אפס';

async function handle(request) {
  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams);
  if (request.method === 'POST') {
    try {
      for (const [k, v] of await request.formData()) p[k] = v;
    } catch {}
  }
  if (p.hangup === 'yes') return reply('');

  const sels = Object.keys(p)
    .filter((k) => /^sel\d+$/.test(k))
    .map((k) => Number(k.slice(3)))
    .sort((a, b) => a - b);
  const n = sels.length ? sels[sels.length - 1] : 0;
  const choice = n ? String(p[`sel${n}`]) : null;

  let bulletin;
  try {
    bulletin = await getBulletin();
  } catch (err) {
    console.error('חדשות:', err);
    return reply(`id_list_message=${tts('סליחה, לא ניתן לטעון את החדשות כרגע. נסו שוב בעוד כמה דקות')}&go_to_folder=/`);
  }
  const items = bulletin.items;
  const time = new Date(bulletin.createdAt).toLocaleTimeString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
  });

  const fullBulletin = () =>
    tts(`מהדורת חדשות מעודכנת לשעה ${time.replace(':', ' ו ')} דקות`) +
    '.' +
    items.map((x, i) => tts(`ידיעה ${i + 1}. ${x.title}. ${x.summary}`)).join('.');

  // כניסה לשלוחה, או בקשה לשמיעה חוזרת
  if (!choice || choice === '0') {
    return reply(`id_list_message=${fullBulletin()}&${tapRead(MENU, n + 1)}`);
  }

  // לא הקישו כלום - יוצאים לתפריט הראשי
  if (choice === 'None') {
    return reply(`id_list_message=${tts('תודה שהאזנתם')}&go_to_folder=/`);
  }

  const item = items[Number(choice) - 1];
  if (!item) {
    return reply(tapRead(`אין ידיעה מספר ${choice}. ${MENU}`, n + 1));
  }
  return reply(
    `id_list_message=${tts(`${item.title}. ${item.details || item.summary}`)}&` +
      tapRead(`לידיעה אחרת הקש את מספרה. לשמיעה חוזרת של המהדורה הקש אפס`, n + 1)
  );
}

export const GET = handle;
export const POST = handle;
