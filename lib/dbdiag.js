// אבחון זמני: מה תוקע את המסד (נעילות / חיבורים תקועים). fix=true - מנתק חיבורים תקועים שלנו.
import postgres from 'postgres';

export async function dbDiag(fix = false) {
  const url = (process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || '').replace(/[?&]supa=[^&]*/g, '');
  const db = postgres(url, { ssl: 'require', max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
  try {
    const t = Date.now();
    await db`select 1`;
    const ping = Date.now() - t;
    const act = await db`select pid, state, wait_event_type, wait_event, usename,
        extract(epoch from now() - coalesce(xact_start, query_start))::int as secs, left(query, 160) as query,
        pg_blocking_pids(pid) as blocked_by
      from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
      order by secs desc nulls last limit 40`;
    let killed = [];
    if (fix) {
      const victims = act.filter((a) => a.usename !== 'supabase_admin' && a.secs > 30 &&
        (a.state === 'idle in transaction' || (a.blocked_by && a.blocked_by.length) || /alter table/i.test(a.query) ||
          act.some((b) => (b.blocked_by || []).includes(a.pid))));
      for (const v of victims) {
        const [r] = await db`select pg_terminate_backend(${v.pid}) as ok`.catch(() => [{ ok: false }]);
        killed.push({ pid: v.pid, ok: r.ok, query: v.query });
      }
    }
    const errors = await db`select source, left(message, 600) as message, created_at from error_log order by id desc limit 6`.catch(() => []);
    return { ping, count: act.length, errors, activity: act, killed };
  } catch (e) {
    return { error: String(e?.message || e) };
  } finally {
    await db.end({ timeout: 2 }).catch(() => {});
  }
}
