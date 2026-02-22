import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/goalcoach";
const useSsl = /sslmode=|supabase\.(co|com)/i.test(databaseUrl);
const rejectUnauthorized =
  (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ??
    (databaseUrl.includes("pooler.supabase.com") ? "false" : "true")) !== "false";

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized } : undefined,
  max: 8,
  idleTimeoutMillis: 30_000
});

type CheckinRow = {
  id: string;
  user_id: string;
  scheduled_at_utc: string;
  attempt_count: number;
};

export async function claimDueCheckins(limit: number): Promise<CheckinRow[]> {
  const result = await pool.query<CheckinRow>(
    `with candidates as (
      select id
      from checkin_events
      where type = 'call'
        and status = 'scheduled'
        and scheduled_at_utc <= now()
      order by scheduled_at_utc asc
      limit $1
      for update skip locked
    )
    update checkin_events ce
    set status = 'in_progress',
        updated_at = now()
    from candidates
    where ce.id = candidates.id
    returning ce.id, ce.user_id, ce.scheduled_at_utc::text, ce.attempt_count`,
    [limit]
  );

  return result.rows;
}

export async function getCallRetryPolicy(userId: string): Promise<{ max_attempts: number; retry_delay_minutes: number }> {
  const result = await pool.query<{ retry_policy: Record<string, unknown> | null }>(
    `select retry_policy
     from schedules
     where user_id = $1 and type = 'call'
     limit 1`,
    [userId]
  );

  const policy = result.rows[0]?.retry_policy ?? null;
  const maxAttemptsRaw = Number((policy as { max_attempts?: number } | null)?.max_attempts ?? 1);
  const retryDelayRaw = Number((policy as { retry_delay_minutes?: number } | null)?.retry_delay_minutes ?? 15);

  return {
    max_attempts: Number.isFinite(maxAttemptsRaw) ? Math.max(0, Math.min(5, maxAttemptsRaw)) : 1,
    retry_delay_minutes: Number.isFinite(retryDelayRaw) ? Math.max(1, Math.min(240, retryDelayRaw)) : 15
  };
}

export async function getUserCallablePhone(userId: string): Promise<string | null> {
  const result = await pool.query<{ phone_e164: string | null; phone_verified: boolean }>(
    `select phone_e164, phone_verified
     from users
     where id = $1
     limit 1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row || !row.phone_verified || !row.phone_e164) {
    return null;
  }

  return row.phone_e164;
}

export async function markCheckinDispatched(params: {
  checkinEventId: string;
  attemptCount: number;
  providerCallId: string;
}): Promise<void> {
  await pool.query(
    `update checkin_events
     set attempt_count = $2,
         provider_call_id = $3,
         updated_at = now()
     where id = $1`,
    [params.checkinEventId, params.attemptCount, params.providerCallId]
  );
}

export async function markCheckinRetry(params: {
  checkinEventId: string;
  attemptCount: number;
  scheduledAtUtc: string;
}): Promise<void> {
  await pool.query(
    `update checkin_events
     set status = 'scheduled',
         attempt_count = $2,
         scheduled_at_utc = $3,
         updated_at = now()
     where id = $1`,
    [params.checkinEventId, params.attemptCount, params.scheduledAtUtc]
  );
}

export async function markCheckinFailed(params: {
  checkinEventId: string;
  attemptCount: number;
}): Promise<void> {
  await pool.query(
    `update checkin_events
     set status = 'failed',
         attempt_count = $2,
         updated_at = now()
     where id = $1`,
    [params.checkinEventId, params.attemptCount]
  );
}

export async function markCheckinCompleted(params: {
  checkinEventId: string;
  attemptCount: number;
}): Promise<void> {
  await pool.query(
    `update checkin_events
     set status = 'completed',
         attempt_count = $2,
         updated_at = now()
     where id = $1`,
    [params.checkinEventId, params.attemptCount]
  );
}

export async function closeWorkerDb(): Promise<void> {
  await pool.end();
}
