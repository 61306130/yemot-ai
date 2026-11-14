// תחבורה ציבורית: חיפוש מקומות ותכנון מסלול (Transitous), זמני הגעה (curlbus / לוח זמנים),
// שמירת נסיעה פעילה ומקומות שמורים במסד הנתונים.
import { hasDb, sql, ensureSchema } from './db.js';

const API = 'https://api.transitous.org/api';
const UA = 'yemot-ai-phone-bot/1.0 (+https://github.com/61306130/yemot-ai)';
const TZ = { timeZone: 'Asia/Jerusalem' };

async function getJson(url, ms = 12000, headers = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
  return res.json();
}

// ---------- מסד נתונים ----------
const mem = globalThis.__transitMem || (globalThis.__transitMem = { trips: new Map(), places: new Map() });

async function ensureTables() {
  if (!hasDb) return;
  await ensureSchema();
  await sql`create table if not exists transit_trips (
    phone text primary key, state jsonb not null, updated_at timestamptz not null default now())`;
  await sql`create table if not exists transit_places (
    phone text not null, name text not null, label text, lat double precision, lon double precision,
    primary key (phone, name))`;
}

export async function loadTrip(phone) {
  if (!hasDb) return mem.trips.get(phone) || null;
  await ensureTables();
  const [row] = await sql`select state, updated_at from transit_trips where phone = ${phone}`;
  if (!row) return null;
  // נסיעה שלא נגעו בה 12 שעות - נחשבת סגורה
  if (Date.now() - new Date(row.updated_at).getTime() > 12 * 3600 * 1000) return null;
  return row.state;
}

export async function saveTrip(phone, state) {
  if (!hasDb) return void mem.trips.set(phone, state);
  await ensureTables();
  await sql`insert into transit_trips (phone, state, updated_at) values (${phone}, ${sql.json(state)}, now())
    on conflict (phone) do update set state = excluded.state, updated_at = now()`;
}

export async function deleteTrip(phone) {
  if (!hasDb) return void mem.trips.delete(phone);
  await ensureTables();
  await sql`delete from transit_trips where phone = ${phone}`;
}

export async function listPlaces(phone) {
  if (!hasDb) return mem.places.get(phone) || [];
  await ensureTables();
  return sql`select name, label, lat, lon from transit_places where phone = ${phone} order by name`;
}

export async function savePlace(phone, name, place) {
  if (!hasDb) {
    const list = (mem.places.get(phone) || []).filter((p) => p.name !== name);
    list.push({ name, label: place.name, lat: place.lat, lon: place.lon });
    return void mem.places.set(phone, list);
  }
  await ensureTables();
  await sql`insert into transit_places (phone, name, label, lat, lon)
    values (${phone}, ${name}, ${place.name}, ${place.lat}, ${place.lon})
    on conflict (phone, name) do update set label = excluded.label, lat = excluded.lat, lon = excluded.lon`;
}

// ---------- חיפוש מקום ----------
export async function geocode(text) {
  const url = `${API}/v1/geocode?language=he&text=${encodeURIComponent(text)}`;
  const list = await getJson(url, 8000);
  const il = (list || []).filter((x) => !x.country || x.country === 'IL');
  const best = il[0];
  if (!best) return null;
  const city = (best.areas || []).find((a) => a.default)?.name;
  return {
    name: best.name + (city && !best.name.includes(city) ? `, ${city}` : ''),
    lat: best.lat,
    lon: best.lon,
  };
}

// ---------- תכנון מסלול ----------
const MODE = {
  BUS: 'bus', COACH: 'bus', TRAM: 'tram', SUBWAY: 'tram', RAIL: 'train', REGIONAL_RAIL: 'train',
  REGIONAL_FAST_RAIL: 'train', HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train', NIGHT_RAIL: 'train',
  METRO: 'tram', CABLE_CAR: 'cable', FUNICULAR: 'cable', FERRY: 'ferry',
};

function legName(l) {
  const m = MODE[l.mode] || 'bus';
  const line = l.routeShortName || '';
  if (m === 'train') return 'רכבת' + (l.headsign ? ` לכיוון ${cleanName(l.headsign)}` : '');
  if (m === 'tram') return `רכבת קלה${line ? ' קו ' + line : ''}`;
  if (m === 'cable') return 'רכבל';
  return `קו ${line}`;
}

export function cleanName(s = '') {
  return String(s)
    .replace(/(^|\s)ת\.\s?/g, '$1תחנה ')
    .replace(/(^|\s)רח'\s?/g, '$1רחוב ')
    .replace(/(^|\s)שד'\s?/g, '$1שדרות ')
    .replace(/(^|\s)מ\.\s?/g, '$1מרכז ')
    .replace(/_/g, ' ').replace(/\//g, ' פינת ').replace(/''/g, '"').replace(/\s+/g, ' ').trim();
}

export function hhmm(iso) {
  return new Date(iso).toLocaleTimeString('he-IL', { ...TZ, hour: '2-digit', minute: '2-digit' });
}

export async function planTrip(from, to) {
  const url =
    `${API}/v5/plan?fromPlace=${from.lat},${from.lon}&toPlace=${to.lat},${to.lon}` +
    `&numItineraries=6&language=he`;
  const data = await getJson(url, 15000);
  const seen = new Set();
  return (data.itineraries || [])
    .map((it) => {
      const legs = it.legs.map((l) => ({
        mode: MODE[l.mode] ? l.mode : l.mode === 'WALK' ? 'WALK' : l.mode,
        kind: l.mode === 'WALK' ? 'walk' : MODE[l.mode] || 'bus',
        name: l.mode === 'WALK' ? 'הליכה' : legName(l),
        line: l.routeShortName || '',
        headsign: cleanName(l.headsign || ''),
        from: { name: cleanName(l.from?.name), stopId: l.from?.stopId, stopCode: l.from?.stopCode },
        to: { name: cleanName(l.to?.name), stopId: l.to?.stopId },
        start: l.startTime,
        end: l.endTime,
        minutes: Math.max(1, Math.round((l.duration || 0) / 60)),
        stops: (l.intermediateStops || []).length + 1,
      }));
      const transit = legs.filter((l) => l.kind !== 'walk');
      return {
        legs,
        minutes: Math.round(it.duration / 60),
        start: it.startTime,
        end: it.endTime,
        summary: transit.map((l) => l.name).join(', ואז '),
        key: transit.map((l) => l.name).join('|'),
      };
    })
    .filter((it) => it.legs.some((l) => l.kind !== 'walk'))
    .filter((it) => (seen.has(it.key) ? false : seen.add(it.key)))
    .sort((a, b) => new Date(a.end) - new Date(b.end))
    .slice(0, 4);
}

// ---------- שלבי הניווט ----------
export function buildSteps(it, destName) {
  const steps = [];
  it.legs.forEach((l, i) => {
    const last = i === it.legs.length - 1;
    if (l.kind === 'walk') {
      if (l.minutes <= 1 && !last) return; // הליכה זניחה בין רציפים
      steps.push(
        last
          ? { type: 'walk_end', text: `לך ברגל כ-${l.minutes} דקות אל היעד, ${destName}.` }
          : { type: 'walk', text: `לך ברגל כ-${l.minutes} דקות אל תחנת ${l.to.name}.` }
      );
      return;
    }
    steps.push({
      type: 'wait',
      leg: { kind: l.kind, line: l.line, name: l.name, headsign: l.headsign, stopId: l.from.stopId, stopCode: l.from.stopCode, planned: l.start },
      text: `בתחנת ${l.from.name}, עלה על ${l.name}${l.headsign && l.kind !== 'train' ? ` לכיוון ${l.headsign}` : ''}.`,
    });
    steps.push({
      type: 'ride',
      text: `רד בתחנת ${l.to.name}, אחרי ${l.stops} תחנות, בערך בעוד ${l.minutes} דקות.`,
    });
  });
  steps.push({ type: 'arrived', text: `הגעת ליעד. נסיעה טובה.` });
  return steps;
}

// ---------- זמן הגעה של הקו לתחנה ----------
export async function nextArrival(leg) {
  const now = Date.now();
  // 1. זמן אמת מ-curlbus (אוטובוסים ורכבת קלה, לפי קוד התחנה)
  if (leg.stopCode && leg.kind !== 'train') {
    try {
      const j = await getJson(`https://curlbus.app/${encodeURIComponent(leg.stopCode)}`, 5000, { Accept: 'application/json' });
      const visits = Object.values(j.visits || {}).flat();
      const etas = visits
        .filter((v) => String(v.line_name) === String(leg.line))
        .map((v) => new Date(v.eta).getTime())
        .filter((t) => t > now - 60000)
        .sort((a, b) => a - b);
      if (etas.length) return { live: true, times: etas.slice(0, 2) };
    } catch (e) {
      console.error('תחבורה: curlbus', e.message);
    }
  }
  // 2. לוח זמנים מ-Transitous
  if (leg.stopId) {
    try {
      const j = await getJson(`${API}/v5/stoptimes?stopId=${encodeURIComponent(leg.stopId)}&n=30`, 8000);
      const times = (j.stopTimes || [])
        .filter((s) => (leg.kind === 'train' ? true : String(s.routeShortName) === String(leg.line)))
        .filter((s) => !leg.headsign || leg.kind !== 'train' || cleanName(s.headsign) === leg.headsign)
        .map((s) => new Date(s.place?.departure || s.place?.scheduledDeparture).getTime())
        .filter((t) => t > now - 60000)
        .sort((a, b) => a - b);
      if (times.length) return { live: false, times: times.slice(0, 2) };
    } catch (e) {
      console.error('תחבורה: stoptimes', e.message);
    }
  }
  // 3. הזמן מהתכנון המקורי
  const t = new Date(leg.planned).getTime();
  return t > now - 60000 ? { live: false, times: [t] } : null;
}

export function arrivalText(leg, arr) {
  if (!arr) return `לא מצאתי זמן הגעה ל${leg.name}.`;
  const mins = arr.times.map((t) => Math.max(0, Math.round((t - Date.now()) / 60000)));
  const first = mins[0] === 0 ? 'מגיע עכשיו' : `מגיע בעוד ${mins[0]} דקות, בשעה ${hhmm(arr.times[0])}`;
  const second = mins[1] != null ? `. הבא אחריו בעוד ${mins[1]} דקות` : '';
  return `${leg.name} ${first}${second}. ${arr.live ? 'לפי מיקום האוטובוס בזמן אמת' : 'לפי לוח הזמנים, לא בזמן אמת'}.`;
}
