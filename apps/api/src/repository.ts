import type { Goal, Habit, WeeklyReview } from "@goalcoach/shared";
import { query, queryOne } from "./db.js";
import type { ChatMessage, CheckinEvent, HabitLog, Schedule, UserProfile, UserPublic } from "./types.js";

function asJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  return value as T;
}

function toUserProfile(row: any): UserProfile {
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    name: row.name,
    timezone: row.timezone,
    phone_e164: row.phone_e164,
    phone_verified: row.phone_verified,
    consent_flags: asJson(row.consent_flags, {
      calls_opt_in: false,
      transcription_opt_in: false,
      storage_opt_in: false
    }),
    preferences: asJson(row.preferences, {})
  };
}

function toGoal(row: any): Goal {
  return {
    id: row.id,
    user_id: row.user_id,
    statement: row.statement,
    motivation: row.motivation,
    constraints: row.constraints,
    target_date: row.target_date,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function toHabit(row: any): Habit {
  return {
    id: row.id,
    user_id: row.user_id,
    goal_id: row.goal_id,
    title: row.title,
    frequency: asJson(row.frequency, {}),
    measurement: asJson(row.measurement, {}),
    difficulty_1_to_10: row.difficulty_1_to_10,
    default_time_window: asJson(row.default_time_window, { start_local: "08:00", end_local: "09:00" }),
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function toHabitLog(row: any): HabitLog {
  return {
    id: row.id,
    user_id: row.user_id,
    habit_id: row.habit_id,
    date_local: row.date_local,
    status: row.status,
    value: row.value === null ? null : Number(row.value),
    note: row.note,
    source: row.source,
    created_at: row.created_at
  };
}

function toSchedule(row: any): Schedule {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    windows: asJson(row.windows, []),
    cadence: asJson(row.cadence, {}),
    retry_policy: asJson(row.retry_policy, { max_attempts: 1, retry_delay_minutes: 15 }),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function toMessage(row: any): ChatMessage {
  return {
    id: row.id,
    user_id: row.user_id,
    thread_id: row.thread_id,
    role: row.role,
    content: row.content,
    created_at: row.created_at
  };
}

function toCheckinEvent(row: any): CheckinEvent {
  return {
    id: row.id,
    user_id: row.user_id,
    scheduled_at_utc: row.scheduled_at_utc,
    type: row.type,
    status: row.status,
    attempt_count: Number(row.attempt_count ?? 0),
    provider_call_id: row.provider_call_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function toUserPublic(user: UserProfile): UserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    phone_e164: user.phone_e164,
    phone_verified: user.phone_verified,
    consent_flags: user.consent_flags,
    preferences: user.preferences
  };
}

export async function getUserByEmail(email: string): Promise<UserProfile | null> {
  const row = await queryOne<any>(
    `select * from users where lower(email) = lower($1) limit 1`,
    [email]
  );
  return row ? toUserProfile(row) : null;
}

export async function getUserById(userId: string): Promise<UserProfile | null> {
  const row = await queryOne<any>(`select * from users where id = $1 limit 1`, [userId]);
  return row ? toUserProfile(row) : null;
}

export async function getFirstUser(): Promise<UserProfile | null> {
  const row = await queryOne<any>(`select * from users order by created_at asc limit 1`);
  return row ? toUserProfile(row) : null;
}

export async function createUser(input: {
  email: string;
  password_hash: string;
  name: string;
  timezone: string;
  phone_e164?: string | null;
  consent_flags: {
    calls_opt_in: boolean;
    transcription_opt_in: boolean;
    storage_opt_in: boolean;
  };
}): Promise<UserProfile> {
  const row = await queryOne<any>(
    `insert into users (
      email,
      password_hash,
      name,
      timezone,
      phone_e164,
      phone_verified,
      consent_flags,
      preferences
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
    returning *`,
    [
      input.email,
      input.password_hash,
      input.name,
      input.timezone,
      input.phone_e164 ?? null,
      Boolean(input.phone_e164),
      JSON.stringify(input.consent_flags),
      JSON.stringify({})
    ]
  );

  if (!row) {
    throw new Error("Unable to create user");
  }

  await query(
    `insert into memory_profile (user_id, stable_facts, rolling_summary, last_call_recap)
     values ($1, $2::jsonb, null, null)
     on conflict (user_id) do nothing`,
    [row.id, JSON.stringify({})]
  );

  return toUserProfile(row);
}

export async function createAuthSession(params: {
  user_id: string;
  refresh_token_hash: string;
  expires_at: string;
}): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `insert into auth_sessions (user_id, refresh_token_hash, expires_at)
     values ($1, $2, $3)
     returning id`,
    [params.user_id, params.refresh_token_hash, params.expires_at]
  );

  if (!row) {
    throw new Error("Unable to create auth session");
  }

  return row;
}

export async function getAuthSessionByRefreshTokenHash(refreshTokenHash: string): Promise<{
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
} | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `select id, user_id, expires_at, revoked_at
     from auth_sessions
     where refresh_token_hash = $1
     limit 1`,
    [refreshTokenHash]
  );

  return row ?? null;
}

export async function revokeAuthSessionById(sessionId: string): Promise<void> {
  await query(
    `update auth_sessions
     set revoked_at = now()
     where id = $1 and revoked_at is null`,
    [sessionId]
  );
}

export async function revokeAuthSessionsForUser(userId: string): Promise<void> {
  await query(
    `update auth_sessions
     set revoked_at = now()
     where user_id = $1 and revoked_at is null`,
    [userId]
  );
}

export async function getAuthSessionById(sessionId: string): Promise<{
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
} | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `select id, user_id, expires_at, revoked_at
     from auth_sessions
     where id = $1
     limit 1`,
    [sessionId]
  );

  return row ?? null;
}

export async function verifyUserPhone(params: { userId: string; phone_e164: string }): Promise<void> {
  await query(`update users set phone_e164 = $2, phone_verified = true, updated_at = now() where id = $1`, [
    params.userId,
    params.phone_e164
  ]);
}

export async function deactivateGoalsForUser(userId: string): Promise<void> {
  await query(`update goals set active = false, updated_at = now() where user_id = $1 and active = true`, [userId]);
}

export async function createGoal(params: {
  userId: string;
  statement: string;
  motivation: string;
  constraints?: string;
  target_date: string;
}): Promise<Goal> {
  const row = await queryOne<any>(
    `insert into goals (user_id, statement, motivation, constraints, target_date, active)
     values ($1, $2, $3, $4, $5, true)
     returning *`,
    [params.userId, params.statement, params.motivation, params.constraints ?? null, params.target_date]
  );
  if (!row) {
    throw new Error("Unable to create goal");
  }
  return toGoal(row);
}

export async function getActiveGoal(userId: string): Promise<Goal | null> {
  const row = await queryOne<any>(
    `select * from goals where user_id = $1 and active = true order by updated_at desc limit 1`,
    [userId]
  );
  return row ? toGoal(row) : null;
}

export async function createHabit(params: {
  userId: string;
  goal_id: string;
  title: string;
  frequency: Record<string, unknown>;
  measurement: Record<string, unknown>;
  difficulty_1_to_10: number;
  default_time_window: { start_local: string; end_local: string };
  active?: boolean;
}): Promise<Habit> {
  const row = await queryOne<any>(
    `insert into habits (
      user_id,
      goal_id,
      title,
      frequency,
      measurement,
      difficulty_1_to_10,
      default_time_window,
      active
    )
    values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8)
    returning *`,
    [
      params.userId,
      params.goal_id,
      params.title,
      JSON.stringify(params.frequency),
      JSON.stringify(params.measurement),
      params.difficulty_1_to_10,
      JSON.stringify(params.default_time_window),
      params.active ?? true
    ]
  );

  if (!row) {
    throw new Error("Unable to create habit");
  }

  return toHabit(row);
}

export async function getHabitByIdForUser(habitId: string, userId: string): Promise<Habit | null> {
  const row = await queryOne<any>(`select * from habits where id = $1 and user_id = $2 limit 1`, [habitId, userId]);
  return row ? toHabit(row) : null;
}

export async function updateHabit(params: {
  habitId: string;
  userId: string;
  patch: Record<string, unknown>;
}): Promise<Habit | null> {
  const existing = await getHabitByIdForUser(params.habitId, params.userId);
  if (!existing) {
    return null;
  }

  const merged = {
    ...existing,
    ...params.patch,
    frequency: params.patch.frequency ?? existing.frequency,
    measurement: params.patch.measurement ?? existing.measurement,
    default_time_window: params.patch.default_time_window ?? existing.default_time_window,
    updated_at: new Date().toISOString()
  };

  const row = await queryOne<any>(
    `update habits
     set title = $3,
         frequency = $4::jsonb,
         measurement = $5::jsonb,
         difficulty_1_to_10 = $6,
         default_time_window = $7::jsonb,
         active = $8,
         updated_at = now()
     where id = $1 and user_id = $2
     returning *`,
    [
      params.habitId,
      params.userId,
      String(merged.title),
      JSON.stringify(merged.frequency),
      JSON.stringify(merged.measurement),
      Number(merged.difficulty_1_to_10),
      JSON.stringify(merged.default_time_window),
      Boolean(merged.active)
    ]
  );

  return row ? toHabit(row) : null;
}

export async function listHabitsForGoal(userId: string, goalId: string): Promise<Habit[]> {
  const rows = await query<any>(
    `select * from habits where user_id = $1 and goal_id = $2 and active = true order by created_at asc`,
    [userId, goalId]
  );
  return rows.map(toHabit);
}

export async function listHabitsForUser(params: {
  userId: string;
  goalId?: string;
  includeInactive?: boolean;
}): Promise<Habit[]> {
  const filters: string[] = ["user_id = $1"];
  const values: unknown[] = [params.userId];
  let paramIndex = 2;

  if (params.goalId) {
    filters.push(`goal_id = $${paramIndex}`);
    values.push(params.goalId);
    paramIndex += 1;
  }

  if (!params.includeInactive) {
    filters.push("active = true");
  }

  const rows = await query<any>(
    `select *
     from habits
     where ${filters.join(" and ")}
     order by active desc, created_at asc`,
    values
  );

  return rows.map(toHabit);
}

export async function createHabitLog(params: {
  user_id: string;
  habit_id: string;
  date_local: string;
  status: "done" | "partial" | "missed" | "skipped";
  value?: number | null;
  note?: string | null;
  source?: "manual" | "chat_auto" | "call_tool";
}): Promise<HabitLog> {
  const row = await queryOne<any>(
    `insert into habit_logs (user_id, habit_id, date_local, status, value, note, source)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      params.user_id,
      params.habit_id,
      params.date_local,
      params.status,
      params.value ?? null,
      params.note ?? null,
      params.source ?? "manual"
    ]
  );

  if (!row) {
    throw new Error("Unable to create habit log");
  }

  return toHabitLog(row);
}

export async function listHabitLogsForDate(userId: string, dateLocal: string): Promise<HabitLog[]> {
  const rows = await query<any>(
    `select * from habit_logs where user_id = $1 and date_local = $2 order by created_at asc`,
    [userId, dateLocal]
  );
  return rows.map(toHabitLog);
}

export async function listHabitLogsForUser(userId: string): Promise<HabitLog[]> {
  const rows = await query<any>(
    `select * from habit_logs where user_id = $1 order by date_local asc, created_at asc`,
    [userId]
  );
  return rows.map(toHabitLog);
}

export async function upsertSchedule(params: {
  user_id: string;
  type: "call" | "chat";
  windows: Array<Record<string, unknown>>;
  cadence: Record<string, unknown>;
  retry_policy?: { max_attempts: number; retry_delay_minutes: number };
}): Promise<Schedule> {
  const row = await queryOne<any>(
    `insert into schedules (user_id, type, windows, cadence, retry_policy)
     values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
     on conflict (user_id, type)
     do update set
       windows = excluded.windows,
       cadence = excluded.cadence,
       retry_policy = excluded.retry_policy,
       updated_at = now()
     returning *`,
    [
      params.user_id,
      params.type,
      JSON.stringify(params.windows),
      JSON.stringify(params.cadence),
      JSON.stringify(params.retry_policy ?? { max_attempts: 1, retry_delay_minutes: 15 })
    ]
  );

  if (!row) {
    throw new Error("Unable to upsert schedule");
  }

  return toSchedule(row);
}

export async function listSchedulesForUser(userId: string): Promise<Schedule[]> {
  const rows = await query<any>(`select * from schedules where user_id = $1 order by created_at asc`, [userId]);
  return rows.map(toSchedule);
}

export async function getScheduleByIdForUser(userId: string, scheduleId: string): Promise<Schedule | null> {
  const row = await queryOne<any>(`select * from schedules where user_id = $1 and id = $2 limit 1`, [userId, scheduleId]);
  return row ? toSchedule(row) : null;
}

export async function patchScheduleForUser(params: {
  user_id: string;
  schedule_id: string;
  type?: "call" | "chat";
  windows?: Array<Record<string, unknown>>;
  cadence?: Record<string, unknown>;
  retry_policy?: { max_attempts: number; retry_delay_minutes: number } | null;
}): Promise<Schedule | null> {
  const existing = await getScheduleByIdForUser(params.user_id, params.schedule_id);
  if (!existing) return null;

  const row = await queryOne<any>(
    `update schedules
     set type = $3,
         windows = $4::jsonb,
         cadence = $5::jsonb,
         retry_policy = $6::jsonb,
         updated_at = now()
     where user_id = $1 and id = $2
     returning *`,
    [
      params.user_id,
      params.schedule_id,
      params.type ?? existing.type,
      JSON.stringify(params.windows ?? existing.windows),
      JSON.stringify(params.cadence ?? existing.cadence),
      JSON.stringify(params.retry_policy === null ? null : (params.retry_policy ?? existing.retry_policy))
    ]
  );

  return row ? toSchedule(row) : null;
}

export async function deleteScheduleForUser(userId: string, scheduleId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `delete from schedules where user_id = $1 and id = $2 returning id`,
    [userId, scheduleId]
  );
  return Boolean(row);
}

export async function createMessage(params: {
  user_id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
}): Promise<ChatMessage> {
  const row = await queryOne<any>(
    `insert into messages (user_id, thread_id, role, content)
     values ($1, $2::uuid, $3, $4)
     returning *`,
    [params.user_id, params.thread_id, params.role, params.content]
  );

  if (!row) {
    throw new Error("Unable to create message");
  }

  return toMessage(row);
}

export async function listRecentMessagesByThread(params: {
  user_id: string;
  thread_id: string;
  limit: number;
}): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const rows = await query<any>(
    `select role, content
     from messages
     where user_id = $1 and thread_id = $2::uuid and role in ('user', 'assistant')
     order by created_at desc
     limit $3`,
    [params.user_id, params.thread_id, params.limit]
  );

  return rows
    .map((row) => ({
      role: row.role,
      content: row.content
    }))
    .reverse();
}

export async function getLatestThreadIdForUser(userId: string): Promise<string | null> {
  const row = await queryOne<{ thread_id: string }>(
    `select thread_id::text as thread_id
     from messages
     where user_id = $1
     order by created_at desc
     limit 1`,
    [userId]
  );

  return row?.thread_id ?? null;
}

export async function countMessagesForUser(userId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(`select count(*)::text as count from messages where user_id = $1`, [userId]);
  return row ? Number(row.count) : 0;
}

export async function createBlocker(params: {
  user_id: string;
  blocker_text: string;
  severity?: "low" | "medium" | "high";
}): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `insert into blockers (user_id, blocker_text, severity)
     values ($1, $2, $3)
     returning id`,
    [params.user_id, params.blocker_text, params.severity ?? "medium"]
  );

  if (!row) {
    throw new Error("Unable to create blocker");
  }

  return { id: row.id };
}

export async function createCommitment(params: {
  user_id: string;
  text: string;
  due_date_local: string;
}): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `insert into commitments (user_id, text, due_date_local, status)
     values ($1, $2, $3, 'open')
     returning id`,
    [params.user_id, params.text, params.due_date_local]
  );

  if (!row) {
    throw new Error("Unable to create commitment");
  }

  return { id: row.id };
}

export async function listOpenCommitments(userId: string): Promise<Array<{ id: string; text: string; due_date_local: string; status: "open" | "completed" | "canceled" }>> {
  const rows = await query<any>(
    `select id, text, due_date_local, status
     from commitments
     where user_id = $1 and status = 'open'
     order by due_date_local asc, created_at asc`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    due_date_local: row.due_date_local,
    status: row.status
  }));
}

export async function getWeeklyReview(params: { userId: string; weekStart: string }): Promise<WeeklyReview | null> {
  const row = await queryOne<any>(
    `select * from weekly_reviews where user_id = $1 and week_start_date = $2 limit 1`,
    [params.userId, params.weekStart]
  );

  if (!row) {
    return null;
  }

  return {
    user_id: row.user_id,
    week_start_date: row.week_start_date,
    completion_stats: asJson(row.completion_stats, []),
    wins: asJson(row.wins, []),
    misses: asJson(row.misses, []),
    blockers: asJson(row.blockers, []),
    fixes: asJson(row.fixes, []),
    summary: row.summary ?? undefined,
    week_focus: row.week_focus ?? "",
    pending_plan_changes: asJson(row.plan_changes_json, []),
    status: row.status,
    generated_at: row.generated_at ?? undefined,
    approved_at: row.approved_at
  };
}

export async function upsertWeeklyReview(review: WeeklyReview): Promise<WeeklyReview> {
  const row = await queryOne<any>(
    `insert into weekly_reviews (
      user_id,
      week_start_date,
      completion_stats,
      wins,
      misses,
      blockers,
      fixes,
      summary,
      week_focus,
      plan_changes_json,
      status,
      generated_at,
      approved_at
    )
    values (
      $1,
      $2,
      $3::jsonb,
      $4::jsonb,
      $5::jsonb,
      $6::jsonb,
      $7::jsonb,
      $8,
      $9,
      $10::jsonb,
      $11,
      $12,
      $13
    )
    on conflict (user_id, week_start_date)
    do update set
      completion_stats = excluded.completion_stats,
      wins = excluded.wins,
      misses = excluded.misses,
      blockers = excluded.blockers,
      fixes = excluded.fixes,
      summary = excluded.summary,
      week_focus = excluded.week_focus,
      plan_changes_json = excluded.plan_changes_json,
      status = excluded.status,
      generated_at = excluded.generated_at,
      approved_at = excluded.approved_at
    returning *`,
    [
      review.user_id,
      review.week_start_date,
      JSON.stringify(review.completion_stats),
      JSON.stringify(review.wins),
      JSON.stringify(review.misses),
      JSON.stringify(review.blockers),
      JSON.stringify(review.fixes),
      review.summary ?? null,
      review.week_focus,
      JSON.stringify(review.pending_plan_changes ?? []),
      review.status,
      review.generated_at ?? null,
      review.approved_at ?? null
    ]
  );

  if (!row) {
    throw new Error("Unable to upsert weekly review");
  }

  return {
    user_id: row.user_id,
    week_start_date: row.week_start_date,
    completion_stats: asJson(row.completion_stats, []),
    wins: asJson(row.wins, []),
    misses: asJson(row.misses, []),
    blockers: asJson(row.blockers, []),
    fixes: asJson(row.fixes, []),
    summary: row.summary ?? undefined,
    week_focus: row.week_focus ?? "",
    pending_plan_changes: asJson(row.plan_changes_json, []),
    status: row.status,
    generated_at: row.generated_at ?? undefined,
    approved_at: row.approved_at
  };
}

export async function createCheckinEvent(params: {
  user_id: string;
  scheduled_at_utc: string;
  type?: "call" | "chat";
}): Promise<{ id: string; scheduled_at_utc: string }> {
  const row = await queryOne<{ id: string; scheduled_at_utc: string }>(
    `insert into checkin_events (user_id, scheduled_at_utc, type, status, attempt_count)
     values ($1, $2, $3, 'scheduled', 0)
     returning id, scheduled_at_utc`,
    [params.user_id, params.scheduled_at_utc, params.type ?? "call"]
  );

  if (!row) {
    throw new Error("Unable to create checkin event");
  }

  return row;
}

export async function listCheckinEventsForUser(params: {
  user_id: string;
  type?: "call" | "chat";
  status?: CheckinEvent["status"];
  from_utc?: string;
  to_utc?: string;
  limit?: number;
}): Promise<CheckinEvent[]> {
  const values: unknown[] = [params.user_id];
  const where = ["user_id = $1"];

  if (params.type) {
    values.push(params.type);
    where.push(`type = $${values.length}`);
  }
  if (params.status) {
    values.push(params.status);
    where.push(`status = $${values.length}`);
  }
  if (params.from_utc) {
    values.push(params.from_utc);
    where.push(`scheduled_at_utc >= $${values.length}`);
  }
  if (params.to_utc) {
    values.push(params.to_utc);
    where.push(`scheduled_at_utc <= $${values.length}`);
  }
  const parsedLimit = typeof params.limit === "number" && Number.isFinite(params.limit) ? params.limit : 50;
  values.push(Math.min(Math.max(parsedLimit, 1), 200));

  const rows = await query<any>(
    `select *
     from checkin_events
     where ${where.join(" and ")}
     order by scheduled_at_utc asc
     limit $${values.length}`,
    values
  );
  return rows.map(toCheckinEvent);
}

export async function hasScheduledCheckinInNextWindow(params: {
  user_id: string;
  type?: "call" | "chat";
  window_hours: number;
}): Promise<boolean> {
  const row = await queryOne<{ count: string }>(
    `select count(*)::text as count
     from checkin_events
     where user_id = $1
       and type = $2
       and status in ('scheduled', 'in_progress')
       and scheduled_at_utc between now() and now() + ($3 || ' hours')::interval`,
    [params.user_id, params.type ?? "call", params.window_hours]
  );

  return Number(row?.count ?? "0") > 0;
}

export async function updateCheckinEventStatus(params: {
  checkin_event_id: string;
  status: "completed" | "failed" | "no_answer";
}): Promise<void> {
  await query(
    `update checkin_events
     set status = $2, updated_at = now()
     where id = $1`,
    [params.checkin_event_id, params.status]
  );
}

export async function updateCheckinEventDispatch(params: {
  checkin_event_id: string;
  provider_call_id: string;
  attempt_count: number;
}): Promise<void> {
  await query(
    `update checkin_events
     set provider_call_id = $2,
         attempt_count = $3,
         updated_at = now()
     where id = $1`,
    [params.checkin_event_id, params.provider_call_id, params.attempt_count]
  );
}

export async function createCallSession(params: {
  user_id: string;
  checkin_event_id: string;
  status: "completed" | "failed" | "no_answer";
  started_at: string;
  ended_at: string;
  transcript: string;
}): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `insert into call_sessions (user_id, checkin_event_id, status, started_at, ended_at, transcript)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      params.user_id,
      params.checkin_event_id,
      params.status,
      params.started_at,
      params.ended_at,
      params.transcript
    ]
  );

  if (!row) {
    throw new Error("Unable to create call session");
  }

  return row;
}

export async function createCallOutcome(params: {
  call_session_id: string;
  completed_habits: string[];
  missed_habits: string[];
  blockers: string[];
  commitments: string[];
  recap_text: string;
}): Promise<void> {
  await query(
    `insert into call_outcomes (
      call_session_id,
      completed_habits,
      missed_habits,
      blockers,
      commitments,
      recap_text
    )
    values ($1, $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6)
    on conflict (call_session_id)
    do update set
      completed_habits = excluded.completed_habits,
      missed_habits = excluded.missed_habits,
      blockers = excluded.blockers,
      commitments = excluded.commitments,
      recap_text = excluded.recap_text`,
    [
      params.call_session_id,
      params.completed_habits,
      params.missed_habits,
      params.blockers,
      params.commitments,
      params.recap_text
    ]
  );
}

export async function getMemoryProfile(userId: string): Promise<Record<string, unknown>> {
  const row = await queryOne<any>(`select stable_facts from memory_profile where user_id = $1 limit 1`, [userId]);
  return asJson(row?.stable_facts, {});
}

export async function getSummaryFields(userId: string): Promise<{
  last_call_recap: string | null;
  rolling_summary: string | null;
  weekly_review_summary: string | null;
}> {
  const row = await queryOne<any>(
    `select last_call_recap, rolling_summary, weekly_review_summary
     from memory_profile where user_id = $1 limit 1`,
    [userId]
  );

  return {
    last_call_recap: row?.last_call_recap ?? null,
    rolling_summary: row?.rolling_summary ?? null,
    weekly_review_summary: row?.weekly_review_summary ?? null
  };
}

export async function upsertRollingSummary(userId: string, rollingSummary: string): Promise<void> {
  await query(
    `insert into memory_profile (user_id, stable_facts, rolling_summary)
     values ($1, $2::jsonb, $3)
     on conflict (user_id)
     do update set rolling_summary = excluded.rolling_summary, updated_at = now()`,
    [userId, JSON.stringify({}), rollingSummary]
  );
}

export async function upsertLastCallRecap(userId: string, recapText: string): Promise<void> {
  await query(
    `insert into memory_profile (user_id, stable_facts, last_call_recap)
     values ($1, $2::jsonb, $3)
     on conflict (user_id)
     do update set last_call_recap = excluded.last_call_recap, updated_at = now()`,
    [userId, JSON.stringify({}), recapText]
  );
}

export async function upsertWeeklyReviewSummary(userId: string, weeklySummary: string): Promise<void> {
  await query(
    `insert into memory_profile (user_id, stable_facts, weekly_review_summary)
     values ($1, $2::jsonb, $3)
     on conflict (user_id)
     do update set weekly_review_summary = excluded.weekly_review_summary, updated_at = now()`,
    [userId, JSON.stringify({}), weeklySummary]
  );
}
