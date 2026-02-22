import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import type { DashboardTodayResponse, Habit, WeeklyReview } from "@goalcoach/shared";
import {
  countMessagesForUser,
  createAuthSession,
  createBlocker,
  createCallOutcome,
  createCallSession,
  createCheckinEvent,
  createCommitment,
  createGoal,
  createHabit,
  createHabitLog,
  createMessage,
  createUser,
  deleteScheduleForUser,
  deactivateGoalsForUser,
  getActiveGoal,
  getAuthSessionById,
  getAuthSessionByRefreshTokenHash,
  getHabitByIdForUser,
  getLatestThreadIdForUser,
  getMemoryProfile,
  getSummaryFields,
  getUserByEmail,
  getUserById,
  getWeeklyReview,
  hasScheduledCheckinInNextWindow,
  listHabitLogsForDate,
  listHabitLogsForUser,
  listHabitsForGoal,
  listHabitsForUser,
  listOpenCommitments,
  listRecentMessagesByThread,
  listCheckinEventsForUser,
  listSchedulesForUser,
  patchScheduleForUser,
  revokeAuthSessionById,
  revokeAuthSessionsForUser,
  toUserPublic,
  updateCheckinEventStatus,
  updateHabit,
  upsertLastCallRecap,
  upsertRollingSummary,
  upsertSchedule,
  upsertWeeklyReview,
  upsertWeeklyReviewSummary,
  verifyUserPhone
} from "./repository.js";
import {
  generateRefreshToken,
  getAccessTokenTtlSeconds,
  getRefreshTokenExpiresAt,
  hashPassword,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword
} from "./auth.js";
import { generateCoachCompletion } from "./llm.js";
import { verifyElevenLabsSignature, verifyTwilioSignature } from "./signatures.js";
import { generateWeeklyReview, getWeekStart } from "./weekly-review.js";
import type { AuthSessionResponse, UserProfile } from "./types.js";

function todayLocalISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sendError(reply: FastifyReply, requestId: string, code: number, errorCode: string, message: string) {
  return reply.code(code).send({
    error: {
      code: errorCode,
      message,
      request_id: requestId
    }
  });
}

function extractBearerToken(authorization?: string): string | null {
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function createSessionForUser(user: UserProfile): Promise<AuthSessionResponse> {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshExpiresAt = getRefreshTokenExpiresAt();

  const authSession = await createAuthSession({
    user_id: user.id,
    refresh_token_hash: refreshTokenHash,
    expires_at: refreshExpiresAt.toISOString()
  });

  const accessToken = signAccessToken({
    userId: user.id,
    sessionId: authSession.id
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: getAccessTokenTtlSeconds(),
    user: toUserPublic(user)
  };
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<UserProfile | null> {
  const workerKey = Array.isArray(request.headers["x-worker-key"])
    ? request.headers["x-worker-key"][0]
    : request.headers["x-worker-key"];
  const workerUserId = Array.isArray(request.headers["x-user-id"])
    ? request.headers["x-user-id"][0]
    : request.headers["x-user-id"];

  if (workerKey && workerKey === (process.env.WORKER_API_KEY ?? "dev-worker-key") && workerUserId) {
    const workerUser = await getUserById(workerUserId);
    if (!workerUser) {
      sendError(reply, request.id, 401, "UNAUTHORIZED", "Worker user not found");
      return null;
    }
    return workerUser;
  }

  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    sendError(reply, request.id, 401, "UNAUTHORIZED", "Missing bearer token");
    return null;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    sendError(reply, request.id, 401, "UNAUTHORIZED", "Invalid bearer token");
    return null;
  }

  const session = await getAuthSessionById(payload.sid);
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
    sendError(reply, request.id, 401, "UNAUTHORIZED", "Session expired or revoked");
    return null;
  }

  const user = await getUserById(payload.sub);
  if (!user) {
    sendError(reply, request.id, 401, "UNAUTHORIZED", "User not found");
    return null;
  }

  return user;
}

function assertToolApiKey(request: FastifyRequest, reply: FastifyReply, toolApiKey: string): boolean {
  const header = request.headers["x-tool-api-key"];
  const key = Array.isArray(header) ? header[0] : header;

  if (key !== toolApiKey) {
    void sendError(reply, request.id, 401, "UNAUTHORIZED", "Invalid tool API key");
    return false;
  }

  return true;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function buildDashboard(userId: string, dateLocal: string): Promise<DashboardTodayResponse> {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("Unknown user");
  }

  const goal = await getActiveGoal(userId);
  if (!goal) {
    throw new Error("No active goal");
  }

  const [habits, logsForDate, commitments, review, summaries] = await Promise.all([
    listHabitsForGoal(userId, goal.id),
    listHabitLogsForDate(userId, dateLocal),
    listOpenCommitments(userId),
    getWeeklyReview({ userId, weekStart: getWeekStart(dateLocal) }),
    getSummaryFields(userId)
  ]);

  const habits_today = habits.map((habit) => {
    const log = logsForDate.find((entry) => entry.habit_id === habit.id);
    return {
      habit_id: habit.id,
      title: habit.title,
      status: (log?.status ?? "pending") as "pending" | "done" | "partial" | "missed" | "skipped",
      target_window: habit.default_time_window,
      difficulty_1_to_10: habit.difficulty_1_to_10
    };
  });

  return {
    date_local: dateLocal,
    timezone: user.timezone,
    goal,
    habits_today,
    commitments,
    last_call_recap: summaries.last_call_recap,
    weekly_focus: review?.week_focus ?? null
  };
}

async function executeCoachActions(params: {
  user: UserProfile;
  userId: string;
  habits: Habit[];
  actions: Array<{ type: string; payload: Record<string, unknown> }>;
}): Promise<Array<{ type: string; payload: Record<string, unknown> }>> {
  const executed: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const habitIds = new Set(params.habits.map((habit) => habit.id));

  for (const action of params.actions) {
    if (action.type === "habit_log_created") {
      const habitId = typeof action.payload.habit_id === "string" ? action.payload.habit_id : null;
      const status = typeof action.payload.status === "string" ? action.payload.status : null;
      const dateLocal = typeof action.payload.date_local === "string" ? action.payload.date_local : todayLocalISO();
      const note = typeof action.payload.note === "string" ? action.payload.note : null;

      if (!habitId || !status || !habitIds.has(habitId)) {
        continue;
      }

      if (!["done", "partial", "missed", "skipped"].includes(status)) {
        continue;
      }

      const log = await createHabitLog({
        user_id: params.userId,
        habit_id: habitId,
        date_local: dateLocal,
        status: status as "done" | "partial" | "missed" | "skipped",
        note,
        source: "chat_auto"
      });

      executed.push({
        type: "habit_log_created",
        payload: {
          id: log.id,
          habit_id: log.habit_id,
          status: log.status,
          date_local: log.date_local
        }
      });
      continue;
    }

    if (action.type === "blocker_created") {
      const blockerText = typeof action.payload.blocker_text === "string" ? action.payload.blocker_text : null;
      const severity = typeof action.payload.severity === "string" ? action.payload.severity : "medium";

      if (!blockerText) {
        continue;
      }

      const blocker = await createBlocker({
        user_id: params.userId,
        blocker_text: blockerText,
        severity: ["low", "medium", "high"].includes(severity) ? (severity as "low" | "medium" | "high") : "medium"
      });

      executed.push({
        type: "blocker_created",
        payload: { id: blocker.id }
      });
      continue;
    }

    if (action.type === "commitment_created") {
      const commitmentText =
        typeof action.payload.commitment_text === "string"
          ? action.payload.commitment_text
          : typeof action.payload.text === "string"
            ? action.payload.text
            : null;

      const dueDate = typeof action.payload.due_date_local === "string" ? action.payload.due_date_local : todayLocalISO();

      if (!commitmentText) {
        continue;
      }

      const commitment = await createCommitment({
        user_id: params.userId,
        text: commitmentText,
        due_date_local: dueDate
      });

      executed.push({
        type: "commitment_created",
        payload: { id: commitment.id }
      });
      continue;
    }

    if (action.type === "schedule_suggested") {
      const scheduleType =
        action.payload.type === "call" || action.payload.type === "chat"
          ? action.payload.type
          : "call";
      const windows = Array.isArray(action.payload.windows)
        ? (action.payload.windows.filter((w) => w && typeof w === "object") as Array<Record<string, unknown>>)
        : null;
      const cadence =
        action.payload.cadence && typeof action.payload.cadence === "object" && !Array.isArray(action.payload.cadence)
          ? (action.payload.cadence as Record<string, unknown>)
          : null;
      const retryPolicy =
        action.payload.retry_policy &&
        typeof action.payload.retry_policy === "object" &&
        !Array.isArray(action.payload.retry_policy)
          ? (action.payload.retry_policy as { max_attempts?: unknown; retry_delay_minutes?: unknown })
          : null;

      if (!windows?.length || !cadence) {
        executed.push(action);
        continue;
      }

      if (
        scheduleType === "call" &&
        (!params.user.phone_e164 || !params.user.phone_verified || !params.user.consent_flags.calls_opt_in)
      ) {
        executed.push({
          type: "schedule_upsert_skipped",
          payload: { reason: "call_phone_or_consent_missing" }
        });
        continue;
      }

      const savedSchedule = await upsertSchedule({
        user_id: params.userId,
        type: scheduleType,
        windows,
        cadence,
        retry_policy:
          retryPolicy &&
          typeof retryPolicy.max_attempts === "number" &&
          typeof retryPolicy.retry_delay_minutes === "number"
            ? {
                max_attempts: retryPolicy.max_attempts,
                retry_delay_minutes: retryPolicy.retry_delay_minutes
              }
            : undefined
      });

      if (scheduleType === "call") {
        const hasUpcoming = await hasScheduledCheckinInNextWindow({
          user_id: params.userId,
          type: "call",
          window_hours: 24
        });
        if (!hasUpcoming) {
          await createCheckinEvent({
            user_id: params.userId,
            scheduled_at_utc: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            type: "call"
          });
        }
      }

      executed.push({
        type: "schedule_upserted",
        payload: { id: savedSchedule.id, type: savedSchedule.type }
      });
      continue;
    }

    if (action.type === "checkin_event_created") {
      const eventType =
        action.payload.type === "call" || action.payload.type === "chat"
          ? action.payload.type
          : "call";
      const scheduledAtUtc =
        typeof action.payload.scheduled_at_utc === "string"
          ? action.payload.scheduled_at_utc
          : typeof action.payload.scheduledAtUtc === "string"
            ? action.payload.scheduledAtUtc
            : new Date().toISOString();

      if (
        eventType === "call" &&
        (!params.user.phone_e164 || !params.user.phone_verified || !params.user.consent_flags.calls_opt_in)
      ) {
        executed.push({
          type: "checkin_event_skipped",
          payload: { reason: "call_phone_or_consent_missing" }
        });
        continue;
      }

      const event = await createCheckinEvent({
        user_id: params.userId,
        scheduled_at_utc: scheduledAtUtc,
        type: eventType
      });

      executed.push({
        type: "checkin_event_created",
        payload: {
          id: event.id,
          type: eventType,
          scheduled_at_utc: event.scheduled_at_utc
        }
      });
      continue;
    }
  }

  return executed;
}

export function createApp() {
  const toolApiKey = process.env.TOOL_API_KEY ?? "dev-tool-api-key";
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
  });

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        const raw = typeof body === "string" ? body : String(body);
        const parsed = Object.fromEntries(new URLSearchParams(raw).entries());
        done(null, parsed);
      } catch (error) {
        done(error as Error);
      }
    }
  );

  app.get("/health", async () => ({ status: "ok" }));

  app.register(
    async (v1) => {
      v1.post("/auth/register", async (request, reply) => {
        const body = request.body as {
          email: string;
          password: string;
          name: string;
          timezone: string;
          phone_e164?: string | null;
          consent_flags: {
            calls_opt_in: boolean;
            transcription_opt_in: boolean;
            storage_opt_in: boolean;
          };
        };

        const existing = await getUserByEmail(body.email);
        if (existing) {
          return sendError(reply, request.id, 409, "CONFLICT", "Email already exists");
        }

        const passwordHash = await hashPassword(body.password);
        const user = await createUser({
          email: body.email,
          password_hash: passwordHash,
          name: body.name,
          timezone: body.timezone,
          phone_e164: body.phone_e164,
          consent_flags: body.consent_flags
        });

        const session = await createSessionForUser(user);
        return reply.code(201).send(session);
      });

      v1.post("/auth/login", async (request, reply) => {
        const body = request.body as { email: string; password: string };
        const user = await getUserByEmail(body.email);

        if (!user) {
          return sendError(reply, request.id, 401, "UNAUTHORIZED", "Invalid credentials");
        }

        const validPassword = await verifyPassword(body.password, user.password_hash);
        if (!validPassword) {
          return sendError(reply, request.id, 401, "UNAUTHORIZED", "Invalid credentials");
        }

        const session = await createSessionForUser(user);
        return reply.send(session);
      });

      v1.post("/auth/refresh", async (request, reply) => {
        const body = request.body as { refresh_token: string };

        if (!body.refresh_token) {
          return sendError(reply, request.id, 401, "UNAUTHORIZED", "Missing refresh token");
        }

        const refreshHash = hashRefreshToken(body.refresh_token);
        const session = await getAuthSessionByRefreshTokenHash(refreshHash);

        if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
          return sendError(reply, request.id, 401, "UNAUTHORIZED", "Invalid refresh token");
        }

        const user = await getUserById(session.user_id);
        if (!user) {
          return sendError(reply, request.id, 401, "UNAUTHORIZED", "Invalid refresh token");
        }

        return {
          access_token: signAccessToken({ userId: user.id, sessionId: session.id }),
          expires_in: getAccessTokenTtlSeconds()
        };
      });

      v1.post("/auth/logout", async (request, reply) => {
        const body = (request.body ?? {}) as { refresh_token?: string };

        if (body.refresh_token) {
          const refreshHash = hashRefreshToken(body.refresh_token);
          const session = await getAuthSessionByRefreshTokenHash(refreshHash);
          if (session) {
            await revokeAuthSessionById(session.id);
          }
          return reply.code(204).send();
        }

        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        await revokeAuthSessionsForUser(user.id);
        return reply.code(204).send();
      });

      v1.post("/auth/verify-phone", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const body = request.body as { phone_e164?: string; otp_code?: string };
        const phone = body.phone_e164?.trim();
        if (!phone) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "phone_e164 is required");
        }

        await verifyUserPhone({ userId: user.id, phone_e164: phone });
        return { phone_verified: true };
      });

      v1.post("/goals", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const body = request.body as {
          statement: string;
          motivation: string;
          constraints?: string;
          target_date: string;
        };

        await deactivateGoalsForUser(user.id);
        const goal = await createGoal({
          userId: user.id,
          statement: body.statement,
          motivation: body.motivation,
          constraints: body.constraints,
          target_date: body.target_date
        });

        return reply.code(201).send(goal);
      });

      v1.get("/goals/active", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const goal = await getActiveGoal(user.id);

        if (!goal) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "No active goal");
        }

        return goal;
      });

      v1.post("/habits", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const body = request.body as {
          goal_id: string;
          title: string;
          frequency: Record<string, unknown>;
          measurement: Record<string, unknown>;
          difficulty_1_to_10: number;
          default_time_window: { start_local: string; end_local: string };
          active?: boolean;
        };

        const habit = await createHabit({
          userId: user.id,
          goal_id: body.goal_id,
          title: body.title,
          frequency: body.frequency,
          measurement: body.measurement,
          difficulty_1_to_10: body.difficulty_1_to_10,
          default_time_window: body.default_time_window,
          active: body.active
        });

        return reply.code(201).send(habit);
      });

      v1.get("/habits", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const query = request.query as { goal_id?: string; include_inactive?: string | boolean };
        const includeInactive =
          query.include_inactive === true ||
          query.include_inactive === "true" ||
          query.include_inactive === "1";

        const habits = await listHabitsForUser({
          userId: user.id,
          goalId: query.goal_id,
          includeInactive
        });

        return habits;
      });

      v1.patch("/habits/:habit_id", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const params = request.params as { habit_id: string };
        const body = request.body as Record<string, unknown>;

        const existing = await getHabitByIdForUser(params.habit_id, user.id);
        if (!existing) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "Habit not found");
        }

        const updated = await updateHabit({ habitId: params.habit_id, userId: user.id, patch: body });
        if (!updated) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "Habit not found");
        }

        return updated;
      });

      v1.post("/habit-logs", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const body = request.body as {
          habit_id: string;
          date_local: string;
          status: "done" | "partial" | "missed" | "skipped";
          value?: number | null;
          note?: string | null;
          source?: "manual" | "chat_auto" | "call_tool";
        };

        const log = await createHabitLog({
          user_id: user.id,
          habit_id: body.habit_id,
          date_local: body.date_local,
          status: body.status,
          value: body.value,
          note: body.note,
          source: body.source
        });

        return reply.code(201).send(log);
      });

      v1.post("/schedules", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const body = request.body as {
          type: "call" | "chat";
          windows: Array<Record<string, unknown>>;
          cadence: Record<string, unknown>;
          retry_policy?: { max_attempts: number; retry_delay_minutes: number };
        };

        const savedSchedule = await upsertSchedule({
          user_id: user.id,
          type: body.type,
          windows: body.windows,
          cadence: body.cadence,
          retry_policy: body.retry_policy
        });

        if (body.type === "call") {
          const hasUpcoming = await hasScheduledCheckinInNextWindow({
            user_id: user.id,
            type: "call",
            window_hours: 24
          });
          if (!hasUpcoming) {
            const initialCheckinAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            await createCheckinEvent({
              user_id: user.id,
              scheduled_at_utc: initialCheckinAt,
              type: "call"
            });
          }
        }

        return savedSchedule;
      });

      v1.get("/schedules", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) return;
        return listSchedulesForUser(user.id);
      });

      v1.patch("/schedules/:schedule_id", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) return;

        const params = request.params as { schedule_id: string };
        const body = request.body as {
          type?: "call" | "chat";
          windows?: Array<Record<string, unknown>>;
          cadence?: Record<string, unknown>;
          retry_policy?: { max_attempts: number; retry_delay_minutes: number } | null;
        };

        const updated = await patchScheduleForUser({
          user_id: user.id,
          schedule_id: params.schedule_id,
          type: body.type,
          windows: body.windows,
          cadence: body.cadence,
          retry_policy: body.retry_policy
        });

        if (!updated) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "Schedule not found");
        }

        if (updated.type === "call") {
          const hasUpcoming = await hasScheduledCheckinInNextWindow({
            user_id: user.id,
            type: "call",
            window_hours: 24
          });
          if (!hasUpcoming) {
            await createCheckinEvent({
              user_id: user.id,
              scheduled_at_utc: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
              type: "call"
            });
          }
        }

        return updated;
      });

      v1.delete("/schedules/:schedule_id", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) return;
        const params = request.params as { schedule_id: string };
        const deleted = await deleteScheduleForUser(user.id, params.schedule_id);
        if (!deleted) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "Schedule not found");
        }
        return reply.code(204).send();
      });

      v1.get("/checkin-events", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) return;

        const query = request.query as {
          type?: "call" | "chat";
          status?: "scheduled" | "in_progress" | "completed" | "failed" | "no_answer";
          from_utc?: string;
          to_utc?: string;
          limit?: string;
        };

        return listCheckinEventsForUser({
          user_id: user.id,
          type: query.type,
          status: query.status,
          from_utc: query.from_utc,
          to_utc: query.to_utc,
          limit: query.limit ? Number(query.limit) : undefined
        });
      });

      v1.post("/checkin-events/manual", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) return;

        const body = request.body as {
          type?: "call" | "chat";
          scheduled_at_utc?: string;
        };

        const type = body.type === "chat" ? "chat" : "call";
        if (type === "call" && (!user.phone_e164 || !user.phone_verified || !user.consent_flags.calls_opt_in)) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "Phone + call consent required for call trigger");
        }

        const event = await createCheckinEvent({
          user_id: user.id,
          scheduled_at_utc: body.scheduled_at_utc ?? new Date().toISOString(),
          type
        });

        return reply.code(201).send({
          id: event.id,
          type,
          status: "scheduled",
          scheduled_at_utc: event.scheduled_at_utc
        });
      });

      v1.get("/dashboard/today", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const query = request.query as { date_local?: string };
        const dateLocal = query.date_local ?? todayLocalISO();

        try {
          return await buildDashboard(user.id, dateLocal);
        } catch (_error) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "Active goal required to build dashboard");
        }
      });

      v1.post("/chat", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const body = request.body as {
          thread_id: string;
          message: string;
          client_message_id?: string;
          context_overrides?: Record<string, unknown>;
        };

        if (!isUuid(body.thread_id)) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "thread_id must be a UUID");
        }

        await createMessage({
          user_id: user.id,
          thread_id: body.thread_id,
          role: "user",
          content: body.message
        });

        const [activeGoal, summaryFields, recentMessages, schedules] = await Promise.all([
          getActiveGoal(user.id),
          getSummaryFields(user.id),
          listRecentMessagesByThread({ user_id: user.id, thread_id: body.thread_id, limit: 12 }),
          listSchedulesForUser(user.id)
        ]);

        const habits = activeGoal ? await listHabitsForGoal(user.id, activeGoal.id) : [];

        const completion = await generateCoachCompletion({
          userTimezone: user.timezone,
          goalStatement: activeGoal?.statement ?? "No active goal yet",
          weeklyFocus: null,
          lastCallRecap: summaryFields.last_call_recap,
          rollingSummary: summaryFields.rolling_summary,
          recentMessages,
          availableHabits: habits,
          schedules,
          phoneVerified: user.phone_verified,
          phoneNumber: user.phone_e164,
          callsOptIn: user.consent_flags.calls_opt_in,
          userMessage: body.message
        });

        const executedActions = await executeCoachActions({
          user,
          userId: user.id,
          habits,
          actions: completion.actions
        });

        const assistantMessage = await createMessage({
          user_id: user.id,
          thread_id: body.thread_id,
          role: "assistant",
          content: completion.assistantMessage
        });

        await upsertRollingSummary(user.id, completion.rollingSummary);

        const memoryVersion = await countMessagesForUser(user.id);

        return {
          assistant_message: completion.assistantMessage,
          thread_id: body.thread_id,
          created_at: assistantMessage.created_at,
          actions_executed: executedActions,
          memory_snapshot_version: memoryVersion
        };
      });

      v1.get("/weekly-reviews/:week_start", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const params = request.params as { week_start: string };
        const weekStart = getWeekStart(params.week_start);

        let review = await getWeeklyReview({ userId: user.id, weekStart });
        if (!review) {
          const activeGoal = await getActiveGoal(user.id);
          const habits = activeGoal ? await listHabitsForGoal(user.id, activeGoal.id) : [];
          const logs = await listHabitLogsForUser(user.id);
          review = generateWeeklyReview({ userId: user.id, weekStart, habits, logs });
          review = await upsertWeeklyReview(review);
          await upsertWeeklyReviewSummary(user.id, review.summary ?? "");
        }

        return review;
      });

      v1.post("/weekly-reviews/:week_start/approve", async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const params = request.params as { week_start: string };
        const body = request.body as { decision: "approve" | "reject"; selected_change_ids?: string[] };
        const weekStart = getWeekStart(params.week_start);

        let review = await getWeeklyReview({ userId: user.id, weekStart });
        if (!review) {
          const activeGoal = await getActiveGoal(user.id);
          const habits = activeGoal ? await listHabitsForGoal(user.id, activeGoal.id) : [];
          const logs = await listHabitLogsForUser(user.id);
          review = generateWeeklyReview({ userId: user.id, weekStart, habits, logs });
        }

        const approved = body.decision === "approve";
        const selected = body.selected_change_ids ?? [];
        const appliedCount = approved
          ? selected.length > 0
            ? selected.length
            : review.pending_plan_changes?.length ?? 0
          : 0;

        const updatedReview: WeeklyReview = {
          ...review,
          status: approved ? "approved" : "rejected",
          approved_at: approved ? new Date().toISOString() : null
        };

        await upsertWeeklyReview(updatedReview);

        return {
          status: approved ? "approved" : "rejected",
          applied_changes_count: appliedCount,
          updated_habits: []
        };
      });

      v1.post("/tools/get-context-pack", async (request, reply) => {
        if (!assertToolApiKey(request, reply, toolApiKey)) {
          return;
        }

        const body = request.body as { user_id?: string; userId?: string };
        const userId = body.user_id ?? body.userId;
        if (!userId) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "user_id is required");
        }

        const user = await getUserById(userId);
        if (!user) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "User not found");
        }

        const goal = await getActiveGoal(user.id);
        if (!goal) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "Active goal not found");
        }

        const dateLocal = todayLocalISO();
        const weekStart = getWeekStart(dateLocal);

        const [habits, schedules, logs, commitments, summaryFields, memoryProfile, reviewSummary, contextVersion] = await Promise.all([
          listHabitsForGoal(user.id, goal.id),
          listSchedulesForUser(user.id),
          listHabitLogsForDate(user.id, dateLocal),
          listOpenCommitments(user.id),
          getSummaryFields(user.id),
          getMemoryProfile(user.id),
          getWeeklyReview({ userId: user.id, weekStart }),
          countMessagesForUser(user.id)
        ]);

        return {
          user: toUserPublic(user),
          goal,
          active_plan: {
            habits,
            schedule: schedules
          },
          today_status: {
            date_local: dateLocal,
            completed_habit_ids: logs.filter((log) => log.status === "done").map((log) => log.habit_id),
            missed_habit_ids: logs.filter((log) => log.status === "missed").map((log) => log.habit_id),
            commitments_open: commitments
          },
          summaries: {
            last_call_recap: summaryFields.last_call_recap,
            rolling_summary: summaryFields.rolling_summary,
            weekly_review_summary: reviewSummary?.summary ?? summaryFields.weekly_review_summary
          },
          memory_profile: memoryProfile,
          context_version: contextVersion
        };
      });

      v1.post("/tools/get-today-plan", async (request, reply) => {
        if (!assertToolApiKey(request, reply, toolApiKey)) {
          return;
        }

        const body = request.body as { user_id?: string; userId?: string };
        const userId = body.user_id ?? body.userId;
        if (!userId) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "user_id is required");
        }

        try {
          const dashboard = await buildDashboard(userId, todayLocalISO());
          return {
            date_local: dashboard.date_local,
            habits: dashboard.habits_today,
            commitments: dashboard.commitments
          };
        } catch (_error) {
          return sendError(reply, request.id, 404, "NOT_FOUND", "Unable to build today plan");
        }
      });

      v1.post("/tools/log-habit", async (request, reply) => {
        if (!assertToolApiKey(request, reply, toolApiKey)) {
          return;
        }

        const body = request.body as {
          user_id?: string;
          userId?: string;
          habit_id?: string;
          habitId?: string;
          date_local?: string;
          dateLocal?: string;
          status?: "done" | "partial" | "missed" | "skipped";
          note?: string;
        };

        const userId = body.user_id ?? body.userId;
        const habitId = body.habit_id ?? body.habitId;
        const dateLocal = body.date_local ?? body.dateLocal;
        if (!userId || !habitId || !dateLocal || !body.status) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "user_id, habit_id, date_local, status are required");
        }

        const log = await createHabitLog({
          user_id: userId,
          habit_id: habitId,
          date_local: dateLocal,
          status: body.status,
          source: "call_tool",
          note: body.note ?? null
        });

        return reply.code(201).send(log);
      });

      v1.post("/tools/report-blocker", async (request, reply) => {
        if (!assertToolApiKey(request, reply, toolApiKey)) {
          return;
        }

        const body = request.body as {
          user_id?: string;
          userId?: string;
          blocker_text?: string;
          blockerText?: string;
          severity?: "low" | "medium" | "high";
        };

        const userId = body.user_id ?? body.userId;
        const blockerText = body.blocker_text ?? body.blockerText;
        if (!userId || !blockerText) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "user_id and blocker_text are required");
        }

        const blocker = await createBlocker({
          user_id: userId,
          blocker_text: blockerText,
          severity: body.severity
        });

        return reply.code(201).send(blocker);
      });

      v1.post("/tools/set-commitment", async (request, reply) => {
        if (!assertToolApiKey(request, reply, toolApiKey)) {
          return;
        }

        const body = request.body as {
          user_id?: string;
          userId?: string;
          commitment_text?: string;
          commitmentText?: string;
          due_date_local?: string;
          dueDateLocal?: string;
        };
        const userId = body.user_id ?? body.userId;
        const commitmentText = body.commitment_text ?? body.commitmentText;
        const dueDateLocal = body.due_date_local ?? body.dueDateLocal;
        if (!userId || !commitmentText || !dueDateLocal) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "user_id, commitment_text, due_date_local are required");
        }

        const commitment = await createCommitment({
          user_id: userId,
          text: commitmentText,
          due_date_local: dueDateLocal
        });

        return reply.code(201).send(commitment);
      });

      v1.post("/tools/reschedule", async (request, reply) => {
        if (!assertToolApiKey(request, reply, toolApiKey)) {
          return;
        }

        const body = request.body as {
          user_id?: string;
          userId?: string;
          scheduled_at_utc?: string;
          scheduledAtUtc?: string;
          reason?: string;
        };
        const userId = body.user_id ?? body.userId;
        const scheduledAtUtc = body.scheduled_at_utc ?? body.scheduledAtUtc;
        if (!userId || !scheduledAtUtc) {
          return sendError(reply, request.id, 400, "VALIDATION_ERROR", "user_id and scheduled_at_utc are required");
        }

        const event = await createCheckinEvent({
          user_id: userId,
          scheduled_at_utc: scheduledAtUtc,
          type: "call"
        });

        return {
          checkin_event_id: event.id,
          scheduled_at_utc: event.scheduled_at_utc
        };
      });

      v1.post("/webhooks/elevenlabs", async (request, reply) => {
        const signature = Array.isArray(request.headers["x-elevenlabs-signature"])
          ? request.headers["x-elevenlabs-signature"][0]
          : request.headers["x-elevenlabs-signature"];

        if (!verifyElevenLabsSignature(request.body, signature)) {
          return sendError(reply, request.id, 401, "UNAUTHORIZED", "Invalid ElevenLabs signature");
        }

        const body = (request.body ?? {}) as Record<string, unknown>;
        const legacyPayload =
          body.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : undefined;
        const dataPayload = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : undefined;

        const dynamicVariables =
          ((dataPayload?.conversation_initiation_client_data as Record<string, unknown> | undefined)
            ?.dynamic_variables as Record<string, unknown> | undefined) ??
          ((dataPayload?.dynamic_variables as Record<string, unknown> | undefined) ?? undefined) ??
          ((dataPayload?.metadata as Record<string, unknown> | undefined) ?? undefined) ??
          {};

        const rawEventType =
          (typeof body.event_type === "string" && body.event_type) ||
          (typeof body.type === "string" && body.type) ||
          "call.completed";

        const callStatus =
          rawEventType === "call.completed" || rawEventType === "post_call_transcription"
            ? "completed"
            : rawEventType === "call.no_answer"
              ? "no_answer"
              : "failed";

        const userId =
          (typeof legacyPayload?.user_id === "string" && legacyPayload.user_id) ||
          (typeof dynamicVariables.user_id === "string" && dynamicVariables.user_id) ||
          (typeof dataPayload?.user_id === "string" && dataPayload.user_id) ||
          null;

        const checkinEventId =
          (typeof legacyPayload?.checkin_event_id === "string" && legacyPayload.checkin_event_id) ||
          (typeof dynamicVariables.checkin_event_id === "string" && dynamicVariables.checkin_event_id) ||
          (typeof dataPayload?.checkin_event_id === "string" && dataPayload.checkin_event_id) ||
          null;

        if (!userId || !checkinEventId) {
          app.log.warn({ body }, "ElevenLabs webhook missing user_id/checkin_event_id");
          return reply.code(202).send();
        }

        const startedAt =
          (typeof legacyPayload?.started_at === "string" && legacyPayload.started_at) || new Date().toISOString();
        const endedAt = (typeof legacyPayload?.ended_at === "string" && legacyPayload.ended_at) || new Date().toISOString();

        let transcriptText = "";
        if (typeof legacyPayload?.transcript === "string") {
          transcriptText = legacyPayload.transcript;
        } else if (Array.isArray(dataPayload?.transcript)) {
          transcriptText = dataPayload.transcript
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return "";
              }
              const record = entry as Record<string, unknown>;
              const role =
                (typeof record.role === "string" && record.role) ||
                (typeof record.speaker === "string" && record.speaker) ||
                "speaker";
              const text =
                (typeof record.text === "string" && record.text) ||
                (typeof record.message === "string" && record.message) ||
                "";
              return text ? `${role}: ${text}` : "";
            })
            .filter(Boolean)
            .join("\n");
        }

        const legacyAnalysis =
          legacyPayload?.analysis && typeof legacyPayload.analysis === "object"
            ? (legacyPayload.analysis as Record<string, unknown>)
            : undefined;
        const modernAnalysis =
          dataPayload?.analysis && typeof dataPayload.analysis === "object"
            ? (dataPayload.analysis as Record<string, unknown>)
            : undefined;

        const completedHabits = Array.isArray(legacyAnalysis?.completed_habits)
          ? (legacyAnalysis.completed_habits as string[])
          : [];
        const missedHabits = Array.isArray(legacyAnalysis?.missed_habits) ? (legacyAnalysis.missed_habits as string[]) : [];
        const blockers = Array.isArray(legacyAnalysis?.blockers) ? (legacyAnalysis.blockers as string[]) : [];
        const commitments = Array.isArray(legacyAnalysis?.commitments) ? (legacyAnalysis.commitments as string[]) : [];

        const session = await createCallSession({
          user_id: userId,
          checkin_event_id: checkinEventId,
          status: callStatus,
          started_at: startedAt,
          ended_at: endedAt,
          transcript: transcriptText
        });

        const recapText =
          (typeof legacyAnalysis?.recap_text === "string" && legacyAnalysis.recap_text) ||
          (typeof modernAnalysis?.recap_text === "string" && modernAnalysis.recap_text) ||
          (typeof modernAnalysis?.transcript_summary === "string" && modernAnalysis.transcript_summary) ||
          "Call completed. No recap provided by upstream analysis.";

        await createCallOutcome({
          call_session_id: session.id,
          completed_habits: completedHabits,
          missed_habits: missedHabits,
          blockers,
          commitments,
          recap_text: recapText
        });

        const threadId = (await getLatestThreadIdForUser(userId)) ?? randomUUID();

        await Promise.all([
          upsertLastCallRecap(userId, recapText),
          updateCheckinEventStatus({ checkin_event_id: checkinEventId, status: callStatus }),
          createMessage({
            user_id: userId,
            thread_id: threadId,
            role: "assistant",
            content: `Recap of our call: ${recapText}`
          })
        ]);

        return reply.code(202).send();
      });

      v1.post("/webhooks/twilio", async (request, reply) => {
        const signature = Array.isArray(request.headers["x-twilio-signature"])
          ? request.headers["x-twilio-signature"][0]
          : request.headers["x-twilio-signature"];

        const webhookUrl = process.env.TWILIO_WEBHOOK_URL ?? `${request.protocol}://${request.hostname}${request.url}`;
        const formBodyPayload = (request.body ?? {}) as Record<string, unknown>;

        const valid = verifyTwilioSignature({
          signatureHeader: signature,
          url: webhookUrl,
          formBody: formBodyPayload
        });

        if (!valid) {
          return sendError(reply, request.id, 401, "UNAUTHORIZED", "Invalid Twilio signature");
        }

        app.log.info({ body: request.body }, "Twilio webhook received");
        return reply.code(202).send();
      });
    },
    { prefix: "/v1" }
  );

  return app;
}
