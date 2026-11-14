// חיבור למסד הנתונים (Supabase / Postgres) ויצירת הטבלאות אוטומטית.
import postgres from 'postgres';

const URL =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  '';

export const hasDb = Boolean(URL);

export const sql = hasDb
  ? globalThis.__sql ||
    (globalThis.__sql = postgres(URL.replace(/[?&]supa=[^&]*/g, ''), {
      ssl: URL.includes('localhost') ? false : 'require',
      prepare: false, // נדרש עבור ה-pooler של Supabase
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    }))
  : null;

// יצירת הטבלאות בפעם הראשונה
let ready;
export function ensureSchema() {
  if (!hasDb) return Promise.resolve();
  ready ||= sql`
    create table if not exists callers (
      phone text primary key,
      name text,
      blocked boolean not null default false,
      notes text,
      calls_count int not null default 0,
      first_call_at timestamptz not null default now(),
      last_call_at timestamptz not null default now()
    );
    create table if not exists calls (
      id text primary key,
      phone text references callers(phone),
      started_at timestamptz not null default now(),
      ended_at timestamptz
    );
    create table if not exists messages (
      id bigserial primary key,
      call_id text references calls(id),
      phone text,
      role text not null,
      text text not null,
      created_at timestamptz not null default now()
    );
    create index if not exists messages_phone_idx on messages(phone, id desc);
  `.simple().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// מתקשר נכנס: רישום/עדכון, ופתיחת שיחה
export async function startCall(callId, phone) {
  await ensureSchema();
  const [caller] = await sql`
    insert into callers (phone, calls_count) values (${phone}, 1)
    on conflict (phone) do update
      set calls_count = callers.calls_count + 1, last_call_at = now()
    returning *`;
  await sql`insert into calls (id, phone) values (${callId}, ${phone}) on conflict do nothing`;
  const [{ count }] = await sql`select count(*)::int as count from messages where phone = ${phone}`;
  return { caller, previousMessages: count };
}

// ההיסטוריה של המתקשר, מכל השיחות שלו
export async function getHistory(phone, limit = 30) {
  await ensureSchema();
  const rows = await sql`
    select role, text from messages where phone = ${phone}
    order by id desc limit ${limit}`;
  return rows.reverse();
}

export async function saveTurn(callId, phone, userText, answer) {
  await ensureSchema();
  await sql`insert into calls (id, phone) values (${callId}, ${phone}) on conflict do nothing`;
  await sql`
    insert into messages (call_id, phone, role, text) values
      (${callId}, ${phone}, 'user', ${userText}),
      (${callId}, ${phone}, 'model', ${answer})`;
}

export async function endCall(callId) {
  await ensureSchema();
  await sql`update calls set ended_at = now() where id = ${callId}`;
}
