// שלוחה 5 - התרגומון: בוחרים שפה, מדברים בעברית או בשפה השנייה, ושומעים את התרגום מיד.
// מתאים לשיחה בין שני אנשים: מעבירים את הטלפון, וכל אחד מדבר בשפה שלו.
// להגדרה בימות:
//   type=api
//   api_link=https://<הדומיין>/api/translate
import { reply, readParams, digitsRead, recordRead, downloadRecording } from '../../../lib/yemot.js';
import { say } from '../../../lib/voice.js';
import { transcribeAny, answer } from '../../../lib/ai.js';
import { loadState, saveState, logError } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// השפות לפי מקש. voice = קול טבעי באותה שפה. hint = הוראה קצרה לדובר השפה (מושמעת בקול שלו)
const LANGS = {
  1: { he: 'אנגלית', en: 'English', voice: 'en-US-GuyNeural', hint: 'Speak after the tone, then press the pound key.' },
  2: { he: 'ערבית', en: 'Arabic', voice: 'ar-SA-HamedNeural', hint: 'تحدث بعد سماع النغمة، ثم اضغط على مفتاح المربع.' },
  3: { he: 'רוסית', en: 'Russian', voice: 'ru-RU-DmitryNeural', hint: 'Говорите после сигнала, затем нажмите решётку.' },
  4: { he: 'צרפתית', en: 'French', voice: 'fr-FR-HenriNeural', hint: 'Parlez après le bip, puis appuyez sur la touche dièse.' },
  5: { he: 'ספרדית', en: 'Spanish', voice: 'es-ES-AlvaroNeural', hint: 'Hable después del tono y luego pulse la tecla almohadilla.' },
  6: { he: 'אמהרית', en: 'Amharic', voice: 'am-ET-AmehaNeural' },
  7: { he: 'גרמנית', en: 'German', voice: 'de-DE-ConradNeural', hint: 'Sprechen Sie nach dem Ton und drücken Sie dann die Rautetaste.' },
  8: { he: 'אוקראינית', en: 'Ukrainian', voice: 'uk-UA-OstapNeural', hint: 'Говоріть після сигналу, потім натисніть решітку.' },
  9: { he: 'איטלקית', en: 'Italian', voice: 'it-IT-DiegoNeural', hint: 'Parli dopo il segnale, poi prema il tasto cancelletto.' },
};

const MENU =
  'ברוכים הבאים לתרגומון החכם. בחרו את השפה שאליה וממנה תרצו לתרגם. ' +
  Object.entries(LANGS).map(([k, l]) => `ל${l.he}, הקישו ${k}.`).join(' ');

// כמה מהטקסט כתוב באותיות עבריות - כך יודעים לאיזה כיוון לתרגם
function isHebrew(text) {
  const letters = String(text).match(/\p{L}/gu) || [];
  if (!letters.length) return true;
  const heb = letters.filter((c) => /[֐-׿]/.test(c)).length;
  return heb / letters.length > 0.5;
}

async function handle(request) {
  const p = await readParams(request);
  if (p.hangup === 'yes') return reply('', 'תרגומון');
  const callId = p.ApiCallId || 'x';
  const key = `tr-${callId}`;
  const idx = Object.keys(p).filter((k) => /^x\d+$/.test(k)).map((k) => +k.slice(1));
  const n = idx.length ? Math.max(...idx) : 0;
  const input = n ? String(p[`x${n}`]) : null;
  const next = `x${n + 1}`;

  const askLang = async (pre = []) =>
    reply(digitsRead([...pre, await say(MENU, { cache: true })], next, { min: 1, max: 1, secWait: 15 }));

  try {
    let st = (n && (await loadState(key))) || null;

    // ---------- כניסה ----------
    if (!n || !st) {
      await saveState(key, { stage: 'lang', silent: 0 });
      return askLang();
    }

    // ---------- בחירת שפה ----------
    if (st.stage === 'lang') {
      if (input === 'None') {
        st.silent = (st.silent || 0) + 1;
        await saveState(key, st);
        if (st.silent >= 3) return reply(`id_list_message=${await say('לא נבחרה שפה. להתראות!', { cache: true })}&go_to_folder=/`);
        return askLang([await say('לא שמעתי בחירה.', { cache: true })]);
      }
      const lang = LANGS[input];
      if (!lang) return askLang([await say('אין שפה במקש הזה. נסו שוב.', { cache: true })]);
      await saveState(key, { stage: 'talk', lang: input, empty: 0 });
      const msgs = [
        await say(
          `תרגום בין עברית ל${lang.he}. דברו אחרי הצליל, בעברית או ב${lang.he}, ובסיום הקישו סולמית. התרגום יושמע מיד, ואפשר להמשיך לדבר. כדי להחליף שפה, הקישו סולמית בלי לדבר.`,
          { cache: true }
        ),
      ];
      if (lang.hint) msgs.push(await say(lang.hint, { cache: true, voice: lang.voice }));
      return reply(recordRead(msgs, next));
    }

    // ---------- תרגום ----------
    if (st.stage === 'talk') {
      const lang = LANGS[st.lang];
      let text = '';
      if (input && input !== 'None') {
        try {
          const audio = await downloadRecording(input, p.ApiExtension);
          text = (await transcribeAny(audio, `עברית או ${lang.en}`)).text?.trim() || '';
        } catch (e) {
          if (e?.busy) throw e;
          console.error('תרגומון - הקלטה:', String(e?.message || e).slice(0, 200));
        }
      }

      // הקלטה ריקה = מעבר לבחירת שפה
      if (!text || text.replace(/[^\p{L}]/gu, '').length < 2) {
        await saveState(key, { stage: 'lang', silent: 0 });
        return askLang([await say('בסדר, בחירת שפה.', { cache: true })]);
      }

      const toHebrew = !isHebrew(text);
      const target = toHebrew ? 'Hebrew' : lang.en;
      const system =
        `You are a professional interpreter between Hebrew and ${lang.en}. ` +
        `Translate the user's text into ${target}. The text is transcribed speech and may contain small transcription errors - translate the intended meaning. ` +
        'Output ONLY the translation, natural and spoken-style, with no quotes, notes or explanations.' +
        (toHebrew ? ' In the Hebrew output, add niqqud only to words that could be read in more than one way.' : '');
      const { text: out } = await answer(system, [{ role: 'user', text }]);
      const translation = String(out || '').trim();
      if (!translation) throw new Error('תרגום ריק');

      console.log(`תרגומון ${toHebrew ? lang.en + '→עברית' : 'עברית→' + lang.en}: ${text.slice(0, 80)} => ${translation.slice(0, 80)}`);
      // שם קובץ קבוע לכל שיחה (מתחלף בין שני קבצים) - תרגומים לא חוזרים על עצמם, אין טעם לשמור במטמון
      const audioRef = await say(translation, { name: `tr-${callId}-${n % 2}`, ...(toHebrew ? {} : { voice: lang.voice }) });
      return reply(recordRead([audioRef], next));
    }

    await saveState(key, { stage: 'lang', silent: 0 });
    return askLang();
  } catch (err) {
    if (err?.busy) {
      logError('ai-busy', err);
      return reply(`id_list_message=${await say('יש כרגע עומס גדול על המערכת. נסו שוב בעוד כמה דקות. תודה על הסבלנות!', { cache: true })}&go_to_folder=/`);
    }
    logError('translate', err);
    return reply(recordRead([await say('סליחה, הייתה תקלה בתרגום. נסו לומר את המשפט שוב אחרי הצליל.', { cache: true })], next));
  }
}

export const GET = handle;
export const POST = handle;
