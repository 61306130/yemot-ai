// שאילתות עבור אתר הניהול: סטטיסטיקה, שיחות, מתקשרים, שגיאות ושימוש.
import { hasDb, sql } from './db.js';
import { ensureStore, getSettings } from './store.js';
import { isSystemOwner } from './systems.js';

export async function overview() {
  if (!hasDb) return { ok: false };
  await ensureStore();
  const [calls] = await sql`select count(*)::int as c from calls`;
  const [today] = await sql`select count(*)::int as c from calls where started_at >= (now() at time zone 'Asia/Jerusalem')::date`;
  const [callers] = await sql`select count(*)::int as c from callers`;
  const [blocked] = await sql`select count(*)::int as c from callers where blocked`;
  const [msgs] = await sql`select count(*)::int as c from messages`;
  const [errs] = await sql`select count(*)::int as c from error_log where created_at > now() - interval '24 hours'`;
  const byDay = await sql`
    select to_char(started_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD') as day, count(*)::int as c
    from calls where started_at > now() - interval '14 days'
    group by day order by day`;
  const topCallers = await sql`
    select phone, coalesce(name,'') as name, calls_count from callers
    order by calls_count desc limit 5`;
  return {
    ok: true,
    totals: { calls: calls.c, today: today.c, callers: callers.c, blocked: blocked.c, messages: msgs.c, errors24h: errs.c },
    byDay, topCallers,
  };
}

export async function recentCalls(limit = 40) {
  if (!hasDb) return [];
  await ensureStore();
  const calls = await sql`
    select c.id, c.phone, coalesce(ca.name,'') as name, c.started_at, c.ended_at,
      (select count(*)::int from messages m where m.call_id = c.id) as turns
    from calls c left join callers ca on ca.phone = c.phone
    order by c.started_at desc limit ${limit}`;
  return calls;
}

export async function callMessages(callId) {
  if (!hasDb) return [];
  await ensureStore();
  return sql`select role, text, created_at from messages where call_id = ${callId} order by id`;
}

export async function listCallers(limit = 200) {
  if (!hasDb) return [];
  await ensureStore();
  return sql`
    select phone, coalesce(name,'') as name, blocked, coalesce(notes,'') as notes,
      calls_count, first_call_at, last_call_at
    from callers order by last_call_at desc limit ${limit}`;
}

export async function updateCaller(phone, fields) {
  if (!hasDb) throw new Error('אין מסד נתונים');
  await ensureStore();
  const sets = {};
  if ('name' in fields) sets.name = String(fields.name || '').slice(0, 80) || null;
  if ('notes' in fields) sets.notes = String(fields.notes || '').slice(0, 500) || null;
  if ('blocked' in fields) sets.blocked = !!fields.blocked;
  if ('daily_limit' in fields) {
    const v = fields.daily_limit;
    sets.daily_limit = v === null || v === '' || v === undefined ? null : Math.max(0, Math.min(1000, Math.round(Number(v)) || 0));
  }
  if (!Object.keys(sets).length) return;
  await sql`update callers set ${sql(sets)} where phone = ${phone}`;
}

export async function recentErrors(limit = 50) {
  if (!hasDb) return [];
  await ensureStore();
  return sql`select source, message, created_at from error_log order by created_at desc limit ${limit}`;
}

export async function clearErrors() {
  if (!hasDb) return;
  await ensureStore();
  await sql`delete from error_log`;
}

export async function usageToday() {
  if (!hasDb) return [];
  await ensureStore();
  return sql`
    select kind, provider, count from usage_daily
    where day = (now() at time zone 'Asia/Jerusalem')::date
    order by kind, count desc`;
}

export async function podcastHistory(limit = 10) {
  if (!hasDb) return [];
  await ensureStore();
  try {
    return await sql`select title, status, bytes, seconds, started_at from podcast_log order by id desc limit ${limit}`;
  } catch {
    return [];
  }
}

// ----- משתמשי הבוט: חיפוש ופרופיל -----
export async function searchCallers(q, limit = 30) {
  if (!hasDb) return [];
  await ensureStore();
  const like = `%${String(q || '').trim()}%`;
  return sql`
    select phone, coalesce(name,'') as name, calls_count, first_call_at, last_call_at, blocked,
      (select count(*)::int from messages m where m.phone = c.phone and m.role = 'user') as questions
    from callers c
    where ${String(q || '').trim()} = '' or coalesce(name,'') ilike ${like} or phone like ${like}
    order by last_call_at desc limit ${limit}`;
}

export async function callerProfile(phone) {
  if (!hasDb) return null;
  await ensureStore();
  const [caller] = await sql`select phone, coalesce(name,'') as name, coalesce(notes,'') as notes, blocked, daily_limit,
    calls_count, first_call_at, last_call_at from callers where phone = ${phone}`;
  if (!caller) return null;
  const [q] = await sql`select count(*)::int as c from messages where phone = ${phone} and role = 'user'`;
  const [t] = await sql`select count(*)::int as c from messages where phone = ${phone} and role = 'user'
    and created_at > date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem'`;
  const cfg = await getSettings().catch(() => ({}));
  const owner = await isSystemOwner(phone).catch(() => false);
  const base = Number(cfg['bot.dailyLimit']) || 0;
  const defaultLimit = base > 0 ? (owner ? Math.max(base, Number(cfg['bot.dailyLimitOwner']) || 40) : base) : 0;
  const limit = { today: t.c, owner, defaultLimit, custom: caller.daily_limit,
    effective: caller.daily_limit ?? defaultLimit };
  const hours = await sql`
    select extract(hour from started_at at time zone 'Asia/Jerusalem')::int as h, count(*)::int as c
    from calls where phone = ${phone} group by h`;
  const days = await sql`
    select extract(dow from started_at at time zone 'Asia/Jerusalem')::int as d, count(*)::int as c
    from calls where phone = ${phone} group by d`;
  const calls = await sql`
    select c.id, c.started_at, c.ended_at,
      (select count(*)::int from messages m where m.call_id = c.id) as turns
    from calls c where c.phone = ${phone} order by c.started_at desc limit 40`;
  const byHour = Array(24).fill(0);
  hours.forEach((r) => (byHour[r.h] = r.c));
  const byDay = Array(7).fill(0);
  days.forEach((r) => (byDay[r.d] = r.c));
  return { caller, questions: q.c, byHour, byDay, calls, limit };
}
