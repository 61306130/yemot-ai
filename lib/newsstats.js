// מעקב האזנות למהדורת החדשות: מי האזין, מתי, מאיזו מערכת, כמה זמן ואילו ידיעות ביקש לשמוע.
import { hasDb, sql } from './db.js';

let ready = null;
function ensure() {
  return (ready ||= sql`
    create table if not exists news_listens (
      call_id text primary key,
      phone text,
      did text,
      started_at timestamptz not null default now(),
      last_at timestamptz not null default now(),
      ended boolean not null default false,
      actions int not null default 1,
      items int[] not null default '{}',
      replays int not null default 0,
      bulletin_at timestamptz
    );
    create index if not exists news_listens_time_idx on news_listens(started_at desc);
  `.simple().catch((e) => { ready = null; throw e; }));
}

// event: 'start' | 'item' | 'replay' | 'end'
export async function trackListen(p, sys, event, extra = {}) {
  if (!hasDb) return;
  const callId = String(p.ApiCallId || '');
  if (!callId) return;
  const phone = /^\d{5,}$/.test(p.ApiPhone || '') ? p.ApiPhone : null;
  const did = sys?.did || p.ApiDID || null;
  try {
    await ensure();
    const item = event === 'item' && Number(extra.item) > 0 ? [Number(extra.item)] : [];
    await sql`
      insert into news_listens (call_id, phone, did, items, bulletin_at, ended)
      values (${callId}, ${phone}, ${did}, ${item}, ${extra.bulletinAt || null}, ${event === 'end'})
      on conflict (call_id) do update set
        last_at = now(),
        actions = news_listens.actions + 1,
        items = news_listens.items || ${item}::int[],
        replays = news_listens.replays + ${event === 'replay' ? 1 : 0},
        ended = news_listens.ended or ${event === 'end'},
        bulletin_at = coalesce(news_listens.bulletin_at, ${extra.bulletinAt || null})`;
  } catch (e) {
    console.error('מעקב חדשות:', e.message);
  }
}

export async function newsStats(days = 14) {
  if (!hasDb) return null;
  await ensure();
  const [tot] = await sql`select count(*)::int as listens, count(distinct phone)::int as people,
      coalesce(avg(extract(epoch from last_at - started_at)) filter (where ended), 0)::int as avg_secs,
      count(*) filter (where started_at > date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')::int as today
    from news_listens where started_at > now() - make_interval(days => ${days})`;
  const byDay = await sql`select (started_at at time zone 'Asia/Jerusalem')::date as day, count(*)::int as c,
      count(distinct phone)::int as people
    from news_listens where started_at > now() - make_interval(days => ${days}) group by day order by day`;
  const byHour = await sql`select extract(hour from started_at at time zone 'Asia/Jerusalem')::int as h, count(*)::int as c
    from news_listens where started_at > now() - make_interval(days => ${days}) group by h`;
  const topItems = await sql`select i as item, count(*)::int as c from news_listens, unnest(items) as i
    where started_at > now() - make_interval(days => ${days}) group by i order by c desc limit 10`;
  const recent = await sql`select l.call_id, l.phone, l.did, l.started_at, l.last_at, l.ended, l.items, l.replays,
      coalesce(c.name, '') as name, s.owner_name
    from news_listens l
    left join callers c on c.phone = l.phone
    left join lateral (select coalesce(nullif(cc.name, ''), sy.owner_name, '') as owner_name from systems sy left join callers cc on cc.phone = sy.owner_phone
      where sy.did = l.did limit 1) s on true
    order by l.started_at desc limit 150`.catch(async () =>
    sql`select l.*, coalesce(c.name, '') as name, null as owner_name from news_listens l
      left join callers c on c.phone = l.phone order by l.started_at desc limit 150`);
  const hours = Array(24).fill(0);
  byHour.forEach((r) => (hours[r.h] = r.c));
  return { ...tot, byDay, byHour: hours, topItems, recent };
}
