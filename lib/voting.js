// מודול הצבעה: ניהול מועמדים, הצבעה (הצבעה אחת לכל מספר טלפון), פתיחה/סגירה ותוצאות.
// עובד על אותו שרת, ואפשר לחבר אליו שלוחה גם ממערכת ימות אחרת (דרך הכתובת הציבורית).
import { hasDb, sql, ensureSchema } from './db.js';

export const MAX_CANDIDATES = 30;

let ready;
function ensure() {
  if (!hasDb) throw new Error('מודול ההצבעה דורש מסד נתונים');
  ready ||= ensureSchema()
    .then(
      () => sql`
    create table if not exists poll_config (
      id int primary key default 1,
      title text not null default 'המוכשר',
      is_open boolean not null default false,
      round int not null default 1,
      updated_at timestamptz not null default now());
    create table if not exists poll_candidates (
      num int primary key, name text not null);
    create table if not exists poll_votes (
      round int not null, phone text not null, candidate_num int not null,
      created_at timestamptz not null default now(),
      primary key (round, phone));
    create index if not exists poll_votes_idx on poll_votes(round, candidate_num);
    update poll_config set title = 'המוכשר' where title = 'הצבעה';
  `.simple()
    )
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

export async function getConfig() {
  await ensure();
  const [cfg] = await sql`insert into poll_config (id) values (1) on conflict (id) do update set id = 1 returning *`;
  return cfg;
}

export async function getCandidates() {
  await ensure();
  return sql`select num, name from poll_candidates order by num`;
}

export async function setCandidate(num, name) {
  await ensure();
  num = Number(num);
  if (!(num >= 1 && num <= MAX_CANDIDATES)) throw new Error('מספר מתמודד לא חוקי');
  name = String(name || '').trim();
  if (!name) {
    await sql`delete from poll_candidates where num = ${num}`;
    return;
  }
  await sql`insert into poll_candidates (num, name) values (${num}, ${name})
    on conflict (num) do update set name = excluded.name`;
}

export async function clearCandidates() {
  await ensure();
  await sql`delete from poll_candidates`;
}

export async function setOpen(open) {
  await ensure();
  await sql`update poll_config set is_open = ${!!open}, updated_at = now() where id = 1`;
}

export async function setTitle(title) {
  await ensure();
  await sql`update poll_config set title = ${String(title || 'המוכשר').trim()}, updated_at = now() where id = 1`;
}

// איפוס ההצבעות: מתחילים סבב חדש, כך שההצבעות הקודמות נשמרות להיסטוריה אך לא נספרות
export async function resetVotes() {
  await ensure();
  await sql`update poll_config set round = round + 1, is_open = false, updated_at = now() where id = 1`;
}

// איפוס מלא: מחיקת כל המתמודדים ואיפוס הקולות (סבב חדש, ההצבעה נסגרת)
export async function resetAll() {
  await clearCandidates();
  await resetVotes();
}

// החזרת קול. מחזיר: ok | already | closed | nocand | badnum
export async function castVote(phone, num) {
  await ensure();
  const cfg = await getConfig();
  if (!cfg.is_open) return { status: 'closed' };
  num = Number(num);
  const [cand] = await sql`select name from poll_candidates where num = ${num}`;
  if (!cand) return { status: 'badnum' };
  try {
    await sql`insert into poll_votes (round, phone, candidate_num) values (${cfg.round}, ${phone}, ${num})`;
    return { status: 'ok', candidate: cand.name };
  } catch (e) {
    if (String(e.message).includes('duplicate') || e.code === '23505') {
      const [prev] = await sql`select candidate_num from poll_votes where round = ${cfg.round} and phone = ${phone}`;
      const [pc] = await sql`select name from poll_candidates where num = ${prev?.candidate_num}`;
      return { status: 'already', candidate: pc?.name };
    }
    throw e;
  }
}

// הקול הנוכחי של מתקשר בסבב הנוכחי (או null)
export async function getMyVote(phone) {
  await ensure();
  const cfg = await getConfig();
  const [row] = await sql`
    select v.candidate_num as num, c.name from poll_votes v
    left join poll_candidates c on c.num = v.candidate_num
    where v.round = ${cfg.round} and v.phone = ${phone}`;
  return row ? { num: row.num, name: row.name || `מתמודד ${row.num}` } : null;
}

// הצבעה - קול אחד לכל טלפון, בלי אפשרות שינוי. מחזיר: ok | already | closed | badnum
export async function setVote(phone, num) {
  await ensure();
  const cfg = await getConfig();
  if (!cfg.is_open) return { status: 'closed' };
  num = Number(num);
  const [cand] = await sql`select name from poll_candidates where num = ${num}`;
  if (!cand) return { status: 'badnum' };
  const rows = await sql`insert into poll_votes (round, phone, candidate_num) values (${cfg.round}, ${phone}, ${num})
    on conflict (round, phone) do nothing returning candidate_num`;
  if (!rows.length) {
    const prev = await getMyVote(phone); // הצביע בינתיים (למשל בשיחה מקבילה)
    return { status: 'already', candidate: prev?.name };
  }
  return { status: 'ok', candidate: cand.name };
}

export async function hasVoted(phone) {
  await ensure();
  const cfg = await getConfig();
  const [row] = await sql`select 1 from poll_votes where round = ${cfg.round} and phone = ${phone}`;
  return !!row;
}

// תוצאות: כל המועמדים עם מספר הקולות, ממוין מהמוביל
export async function getResults() {
  await ensure();
  const cfg = await getConfig();
  const rows = await sql`
    select c.num, c.name, count(v.phone)::int as votes
    from poll_candidates c
    left join poll_votes v on v.candidate_num = c.num and v.round = ${cfg.round}
    group by c.num, c.name
    order by votes desc, c.num asc`;
  const [{ total }] = await sql`select count(*)::int as total from poll_votes where round = ${cfg.round}`;
  return { config: cfg, results: rows, total };
}
