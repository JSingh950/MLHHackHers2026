import type {
  ChatResponse,
  CheckinEvent,
  DashboardTodayResponse,
  Goal,
  Habit,
  HabitLogStatus,
  Schedule,
  WeeklyReview,
  WeeklyHabitStat
} from "@goalcoach/shared";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";
export const UI_ONLY_MODE = process.env.NEXT_PUBLIC_UI_ONLY_MODE === "true";

export class ApiError extends Error {
  status: number;
  bodyText: string;

  constructor(status: number, message: string, bodyText: string) {
    super(message);
    this.status = status;
    this.bodyText = bodyText;
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
  phone_e164: string | null;
  phone_verified: boolean;
  consent_flags: {
    calls_opt_in: boolean;
    transcription_opt_in: boolean;
    storage_opt_in: boolean;
  };
}

export interface SessionResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: PublicUser;
}

export interface RefreshResult {
  access_token: string;
  expires_in: number;
}

type RegisterPayload = {
  email: string;
  password: string;
  name: string;
  timezone: string;
  phone_e164?: string | null;
  consent_flags: PublicUser["consent_flags"];
};

type CreateHabitPayload = {
  goal_id: string;
  title: string;
  frequency: Record<string, unknown>;
  measurement: Record<string, unknown>;
  difficulty_1_to_10: number;
  default_time_window: { start_local: string; end_local: string };
  active?: boolean;
};

type CreateHabitLogPayload = {
  habit_id: string;
  date_local: string;
  status: "done" | "partial" | "missed" | "skipped";
  value?: number | null;
  note?: string | null;
  source?: "manual" | "chat_auto" | "call_tool";
};

type CreateSchedulePayload = {
  type: "call" | "chat";
  windows: Array<Record<string, unknown>>;
  cadence: Record<string, unknown>;
  retry_policy?: { max_attempts: number; retry_delay_minutes: number };
};

type PatchSchedulePayload = {
  type?: "call" | "chat";
  windows?: Array<Record<string, unknown>>;
  cadence?: Record<string, unknown>;
  retry_policy?: { max_attempts: number; retry_delay_minutes: number } | null;
};

type ManualCheckinPayload = {
  type?: "call" | "chat";
  scheduled_at_utc?: string;
};

type MockUserRecord = PublicUser & { password: string };
type MockHabitLogRecord = {
  id: string;
  user_id: string;
  habit_id: string;
  date_local: string;
  status: HabitLogStatus;
  value?: number | null;
  note?: string | null;
  source?: "manual" | "chat_auto" | "call_tool";
  created_at: string;
};
type MockScheduleRecord = {
  id: string;
  user_id: string;
  type: "call" | "chat";
  windows: Array<Record<string, unknown>>;
  cadence: Record<string, unknown>;
  retry_policy?: { max_attempts: number; retry_delay_minutes: number };
  created_at: string;
  updated_at?: string;
};
type MockCheckinEventRecord = CheckinEvent;
type MockMessageRecord = {
  id: string;
  user_id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};
type MockCommitmentRecord = {
  id: string;
  user_id: string;
  text: string;
  due_date_local: string;
  status: "open" | "completed" | "canceled";
};
type MockMemoryProfile = {
  user_id: string;
  last_call_recap: string | null;
  rolling_summary: string | null;
  weekly_focus: string | null;
};
type MockState = {
  users: MockUserRecord[];
  goals: Goal[];
  habits: Habit[];
  habit_logs: MockHabitLogRecord[];
  schedules: MockScheduleRecord[];
  checkin_events: MockCheckinEventRecord[];
  messages: MockMessageRecord[];
  commitments: MockCommitmentRecord[];
  weekly_reviews: WeeklyReview[];
  memory_profiles: MockMemoryProfile[];
};

const MOCK_STORAGE_KEY = "goalcoach.uiOnlyMock.v1";

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(dateInput: string, days: number) {
  const d = new Date(`${dateInput}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekStartFrom(dateInput: string) {
  const d = new Date(`${dateInput}T00:00:00`);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function randomId(prefix = "id") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requireBrowserStorage() {
  if (typeof window === "undefined") {
    throw new Error("UI-only mode requires browser localStorage (client-side only).");
  }
  return window.localStorage;
}

function seedMockState(): MockState {
  const userId = randomId("usr");
  const goalId = randomId("goal");
  const habit1 = randomId("hab");
  const habit2 = randomId("hab");
  const today = todayIso();
  const reviewWeek = weekStartFrom(today);
  const createdAt = nowIso();

  const testUser: MockUserRecord = {
    id: userId,
    email: "test@goalcoach.app",
    password: "test",
    name: "Test Test",
    timezone: "America/New_York",
    phone_e164: "+19083337224",
    phone_verified: true,
    consent_flags: {
      calls_opt_in: true,
      transcription_opt_in: true,
      storage_opt_in: true
    }
  };

  const goal: Goal = {
    id: goalId,
    user_id: userId,
    statement: "Build GoalCoach and stay consistent while shipping",
    motivation: "Ship faster without burning out and maintain a daily execution rhythm.",
    constraints: "Founder workload, meetings, and context switching.",
    target_date: plusDays(today, 90),
    active: true,
    created_at: createdAt,
    updated_at: createdAt
  };

  const habits: Habit[] = [
    {
      id: habit1,
      user_id: userId,
      goal_id: goalId,
      title: "Daily planning check-in",
      frequency: { cadence: "daily" },
      measurement: { type: "boolean", target_value: 1, unit: "done" },
      difficulty_1_to_10: 3,
      default_time_window: { start_local: "08:00", end_local: "09:00" },
      active: true,
      created_at: createdAt,
      updated_at: createdAt
    },
    {
      id: habit2,
      user_id: userId,
      goal_id: goalId,
      title: "Deep work block",
      frequency: { cadence: "weekdays" },
      measurement: { type: "duration_minutes", target_value: 60, unit: "minutes" },
      difficulty_1_to_10: 5,
      default_time_window: { start_local: "10:00", end_local: "12:00" },
      active: true,
      created_at: createdAt,
      updated_at: createdAt
    }
  ];

  const habitLogs: MockHabitLogRecord[] = [
    {
      id: randomId("hlog"),
      user_id: userId,
      habit_id: habit1,
      date_local: today,
      status: "done",
      source: "call_tool",
      created_at: createdAt
    }
  ];

  const weeklyReview: WeeklyReview = {
    user_id: userId,
    week_start_date: reviewWeek,
    completion_stats: [
      {
        habit_id: habit1,
        title: "Daily planning check-in",
        completion_rate: 0.86,
        done_count: 6,
        target_count: 7,
        recommendation: "keep"
      },
      {
        habit_id: habit2,
        title: "Deep work block",
        completion_rate: 0.57,
        done_count: 4,
        target_count: 7,
        recommendation: "keep"
      }
    ],
    wins: ["Kept a consistent planning routine for most of the week."],
    misses: ["Deep work blocks slipped on meeting-heavy days."],
    blockers: ["Context switching and reactive tasks."],
    fixes: ["Timebox deep work earlier and move meetings later when possible."],
    summary: "Solid consistency on planning. Deep work is improving but still exposed to meeting load.",
    week_focus: "Protect one non-negotiable deep work block before noon.",
    pending_plan_changes: [
      {
        id: "chg_deepwork_window",
        type: "adjust_time_window",
        habit_id: habit2,
        from: { start_local: "10:00", end_local: "12:00" },
        to: { start_local: "09:00", end_local: "11:00" }
      }
    ],
    status: "pending_approval",
    generated_at: createdAt,
    approved_at: null
  };

  return {
    users: [testUser],
    goals: [goal],
    habits,
    habit_logs: habitLogs,
    schedules: [
      {
        id: randomId("sch"),
        user_id: userId,
        type: "call",
        windows: [{ days_of_week: [1, 2, 3, 4, 5], start_local: "17:00", end_local: "20:00" }],
        cadence: { kind: "weekly", interval: 1 },
        retry_policy: { max_attempts: 1, retry_delay_minutes: 10 },
        created_at: createdAt,
        updated_at: createdAt
      }
    ],
    checkin_events: [
      {
        id: randomId("evt"),
        user_id: userId,
        scheduled_at_utc: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        type: "call",
        status: "scheduled",
        attempt_count: 0,
        provider_call_id: null,
        created_at: createdAt,
        updated_at: createdAt
      }
    ],
    messages: [],
    commitments: [
      {
        id: randomId("com"),
        user_id: userId,
        text: "Ship onboarding UI and test the chat flow",
        due_date_local: today,
        status: "open"
      }
    ],
    weekly_reviews: [weeklyReview],
    memory_profiles: [
      {
        user_id: userId,
        last_call_recap: "Jeeyan checked in on your daily planning habit and logged it as done.",
        rolling_summary: "Best compliance happens when planning is completed before the first meeting.",
        weekly_focus: weeklyReview.week_focus
      }
    ]
  };
}

function loadMockState(): MockState {
  const storage = requireBrowserStorage();
  const raw = storage.getItem(MOCK_STORAGE_KEY);
  if (!raw) {
    const seeded = seedMockState();
    storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  try {
    return JSON.parse(raw) as MockState;
  } catch {
    const seeded = seedMockState();
    storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
}

function saveMockState(state: MockState) {
  requireBrowserStorage().setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
}

function withMockState<T>(fn: (state: MockState) => T): T {
  const state = loadMockState();
  const result = fn(state);
  saveMockState(state);
  return result;
}

function mockDelay(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockNotFound(message: string) {
  return new ApiError(404, message, message);
}

function mockConflict(message: string) {
  return new ApiError(409, message, message);
}

function mockUnauthorized(message = "Invalid credentials") {
  return new ApiError(401, message, message);
}

function userFromAccessToken(state: MockState, accessToken: string): MockUserRecord {
  const parts = accessToken.split(":");
  const userId = parts[1];
  const user = state.users.find((u) => u.id === userId);
  if (!user) {
    throw mockUnauthorized("Invalid access token");
  }
  return user;
}

function userIdFromRefreshToken(refreshToken: string): string {
  const parts = refreshToken.split(":");
  if (parts[0] !== "mock-refresh" || !parts[1]) {
    throw mockUnauthorized("Invalid refresh token");
  }
  return parts[1];
}

function createMockSession(user: MockUserRecord): SessionResult {
  const nonce = Math.random().toString(36).slice(2, 8);
  return {
    access_token: `mock-access:${user.id}:${nonce}`,
    refresh_token: `mock-refresh:${user.id}:${nonce}`,
    expires_in: 60 * 60,
    user: clone({
      id: user.id,
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      phone_e164: user.phone_e164,
      phone_verified: user.phone_verified,
      consent_flags: user.consent_flags
    })
  };
}

function activeGoalForUser(state: MockState, userId: string): Goal | null {
  return state.goals.find((g) => g.user_id === userId && g.active) ?? null;
}

function ensureMemoryProfile(state: MockState, userId: string): MockMemoryProfile {
  let profile = state.memory_profiles.find((m) => m.user_id === userId);
  if (!profile) {
    profile = { user_id: userId, last_call_recap: null, rolling_summary: null, weekly_focus: null };
    state.memory_profiles.push(profile);
  }
  return profile;
}

function latestHabitLogForDate(state: MockState, userId: string, habitId: string, dateLocal: string): MockHabitLogRecord | null {
  const candidates = state.habit_logs
    .filter((l) => l.user_id === userId && l.habit_id === habitId && l.date_local === dateLocal)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return candidates[0] ?? null;
}

function buildDashboardToday(state: MockState, userId: string, dateLocal: string): DashboardTodayResponse {
  const user = state.users.find((u) => u.id === userId);
  if (!user) {
    throw mockUnauthorized("Unknown user");
  }
  const goal = activeGoalForUser(state, userId);
  if (!goal) {
    throw mockNotFound("No active goal");
  }
  const habitsToday = state.habits
    .filter((h) => h.user_id === userId && h.active)
    .map((habit) => {
      const latestLog = latestHabitLogForDate(state, userId, habit.id, dateLocal);
      const status: HabitLogStatus | "pending" = latestLog?.status ?? "pending";
      return {
        habit_id: habit.id,
        title: habit.title,
        status,
        target_window: clone(habit.default_time_window),
        difficulty_1_to_10: habit.difficulty_1_to_10
      };
    });

  const profile = ensureMemoryProfile(state, userId);
  const weekStart = weekStartFrom(dateLocal);
  const review = state.weekly_reviews.find((r) => r.user_id === userId && r.week_start_date === weekStart);

  return {
    date_local: dateLocal,
    timezone: user.timezone,
    goal: clone(goal),
    habits_today: habitsToday,
    commitments: clone(state.commitments.filter((c) => c.user_id === userId)),
    last_call_recap: profile.last_call_recap,
    weekly_focus: review?.week_focus ?? profile.weekly_focus ?? null
  };
}

function synthesizeReview(state: MockState, userId: string, weekStart: string): WeeklyReview {
  const userHabits = state.habits.filter((h) => h.user_id === userId && h.active);
  const weekDates = Array.from({ length: 7 }, (_, i) => plusDays(weekStart, i));
  const completionStats: WeeklyHabitStat[] = userHabits.map((habit) => {
    const logs = state.habit_logs.filter(
      (l) => l.user_id === userId && l.habit_id === habit.id && weekDates.includes(l.date_local) && l.status === "done"
    );
    const targetCount = 7;
    const doneCount = logs.length;
    const completionRate = doneCount / targetCount;
    const recommendation: WeeklyHabitStat["recommendation"] =
      completionRate >= 0.85 ? "increase" : completionRate < 0.5 ? "simplify" : "keep";
    return {
      habit_id: habit.id,
      title: habit.title,
      completion_rate: completionRate,
      done_count: doneCount,
      target_count: targetCount,
      recommendation
    };
  });

  const review: WeeklyReview = {
    user_id: userId,
    week_start_date: weekStart,
    completion_stats: completionStats,
    wins: completionStats.filter((s) => s.completion_rate >= 0.7).map((s) => `Strong consistency on ${s.title}.`),
    misses: completionStats.filter((s) => s.completion_rate < 0.5).map((s) => `Missed ${s.title} too often.`),
    blockers: ["Reactive interruptions and shifting priorities."],
    fixes: ["Move highest-value habit earlier and reduce friction on busy days."],
    summary: "Auto-generated UI-only review for frontend click-through.",
    week_focus: "Protect one high-leverage habit at a consistent time.",
    pending_plan_changes:
      completionStats.length > 0
        ? [
            {
              id: randomId("chg"),
              type: "tweak_timing",
              habit_id: completionStats[0].habit_id,
              reason: "UI-only mock recommendation"
            }
          ]
        : [],
    status: "pending_approval",
    generated_at: nowIso(),
    approved_at: null
  };
  state.weekly_reviews = state.weekly_reviews.filter((r) => !(r.user_id === userId && r.week_start_date === weekStart));
  state.weekly_reviews.push(review);
  ensureMemoryProfile(state, userId).weekly_focus = review.week_focus;
  return review;
}

const mockApi = {
  async register(payload: RegisterPayload): Promise<SessionResult> {
    await mockDelay();
    return withMockState((state) => {
      const existing = state.users.find((u) => u.email.toLowerCase() === payload.email.toLowerCase());
      if (existing) {
        throw mockConflict("Email already exists");
      }
      const user: MockUserRecord = {
        id: randomId("usr"),
        email: payload.email,
        password: payload.password,
        name: payload.name,
        timezone: payload.timezone,
        phone_e164: payload.phone_e164 ?? null,
        phone_verified: Boolean(payload.phone_e164),
        consent_flags: clone(payload.consent_flags)
      };
      state.users.push(user);
      state.memory_profiles.push({
        user_id: user.id,
        last_call_recap: null,
        rolling_summary: null,
        weekly_focus: "Create your first habit and define one non-negotiable daily action."
      });
      return createMockSession(user);
    });
  },

  async login(payload: { email: string; password: string }): Promise<SessionResult> {
    await mockDelay();
    return withMockState((state) => {
      const user = state.users.find((u) => u.email.toLowerCase() === payload.email.toLowerCase());
      if (!user || user.password !== payload.password) {
        throw mockUnauthorized();
      }
      return createMockSession(user);
    });
  },

  async refresh(payload: { refresh_token: string }): Promise<RefreshResult> {
    await mockDelay(80);
    return withMockState((state) => {
      const userId = userIdFromRefreshToken(payload.refresh_token);
      const user = state.users.find((u) => u.id === userId);
      if (!user) {
        throw mockUnauthorized("Invalid refresh token");
      }
      return {
        access_token: `mock-access:${user.id}:${Math.random().toString(36).slice(2, 8)}`,
        expires_in: 60 * 60
      };
    });
  },

  async logout(_payload: { refresh_token?: string }, _accessToken?: string): Promise<void> {
    await mockDelay(50);
    return;
  },

  async verifyPhone(payload: { phone_e164: string; otp_code?: string }, accessToken: string): Promise<{ phone_verified: boolean }> {
    await mockDelay();
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      user.phone_e164 = payload.phone_e164;
      user.phone_verified = true;
      return { phone_verified: true };
    });
  },

  async createGoal(payload: { statement: string; motivation: string; constraints?: string; target_date: string }, accessToken: string): Promise<Goal> {
    await mockDelay();
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      state.goals.forEach((g) => {
        if (g.user_id === user.id) g.active = false;
      });
      const ts = nowIso();
      const goal: Goal = {
        id: randomId("goal"),
        user_id: user.id,
        statement: payload.statement,
        motivation: payload.motivation,
        constraints: payload.constraints ?? null,
        target_date: payload.target_date,
        active: true,
        created_at: ts,
        updated_at: ts
      };
      state.goals.push(goal);
      return clone(goal);
    });
  },

  async getActiveGoal(accessToken: string): Promise<Goal> {
    await mockDelay(70);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const goal = activeGoalForUser(state, user.id);
      if (!goal) throw mockNotFound("No active goal");
      return clone(goal);
    });
  },

  async createHabit(payload: CreateHabitPayload, accessToken: string): Promise<Habit> {
    await mockDelay();
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const ts = nowIso();
      const habit: Habit = {
        id: randomId("hab"),
        user_id: user.id,
        goal_id: payload.goal_id,
        title: payload.title,
        frequency: clone(payload.frequency),
        measurement: clone(payload.measurement),
        difficulty_1_to_10: payload.difficulty_1_to_10,
        default_time_window: clone(payload.default_time_window),
        active: payload.active ?? true,
        created_at: ts,
        updated_at: ts
      };
      state.habits.push(habit);
      return clone(habit);
    });
  },

  async getHabits(
    accessToken: string,
    options: { goal_id?: string; include_inactive?: boolean } = {}
  ): Promise<Habit[]> {
    await mockDelay(90);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      let habits = state.habits.filter((h) => h.user_id === user.id);
      if (options.goal_id) {
        habits = habits.filter((h) => h.goal_id === options.goal_id);
      }
      if (!options.include_inactive) {
        habits = habits.filter((h) => h.active);
      }
      return clone(habits.sort((a, b) => a.created_at.localeCompare(b.created_at)));
    });
  },

  async patchHabit(habitId: string, patch: Record<string, unknown>, accessToken: string): Promise<Habit> {
    await mockDelay();
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const habit = state.habits.find((h) => h.id === habitId && h.user_id === user.id);
      if (!habit) throw mockNotFound("Habit not found");
      if (typeof patch.title === "string") habit.title = patch.title;
      if (typeof patch.difficulty_1_to_10 === "number") habit.difficulty_1_to_10 = patch.difficulty_1_to_10;
      if (typeof patch.active === "boolean") habit.active = patch.active;
      if (
        patch.default_time_window &&
        typeof patch.default_time_window === "object" &&
        patch.default_time_window !== null
      ) {
        const tw = patch.default_time_window as { start_local?: string; end_local?: string };
        habit.default_time_window = {
          start_local: tw.start_local ?? habit.default_time_window.start_local,
          end_local: tw.end_local ?? habit.default_time_window.end_local
        };
      }
      habit.updated_at = nowIso();
      return clone(habit);
    });
  },

  async createHabitLog(payload: CreateHabitLogPayload, accessToken: string): Promise<{ id: string }> {
    await mockDelay(90);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const existing = state.habit_logs.find(
        (l) => l.user_id === user.id && l.habit_id === payload.habit_id && l.date_local === payload.date_local
      );
      if (existing) {
        existing.status = payload.status;
        existing.value = payload.value ?? null;
        existing.note = payload.note ?? null;
        existing.source = payload.source ?? "manual";
        existing.created_at = nowIso();
        return { id: existing.id };
      }
      const record: MockHabitLogRecord = {
        id: randomId("hlog"),
        user_id: user.id,
        habit_id: payload.habit_id,
        date_local: payload.date_local,
        status: payload.status,
        value: payload.value ?? null,
        note: payload.note ?? null,
        source: payload.source ?? "manual",
        created_at: nowIso()
      };
      state.habit_logs.push(record);
      return { id: record.id };
    });
  },

  async createSchedule(payload: CreateSchedulePayload, accessToken: string): Promise<Schedule> {
    await mockDelay();
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const existing = state.schedules.find((s) => s.user_id === user.id && s.type === payload.type);
      const ts = nowIso();
      const record: MockScheduleRecord = {
        id: existing?.id ?? randomId("sch"),
        user_id: user.id,
        type: payload.type,
        windows: clone(payload.windows),
        cadence: clone(payload.cadence),
        retry_policy: payload.retry_policy ? clone(payload.retry_policy) : undefined,
        created_at: existing?.created_at ?? ts,
        updated_at: ts
      };
      state.schedules = state.schedules.filter((s) => !(s.user_id === user.id && s.type === payload.type));
      state.schedules.push(record);
      if (payload.type === "call") {
        state.checkin_events.push({
          id: randomId("evt"),
          user_id: user.id,
          type: "call",
          status: "scheduled",
          scheduled_at_utc: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          attempt_count: 0,
          provider_call_id: null,
          created_at: ts,
          updated_at: ts
        });
      }
      return clone(record) as Schedule;
    });
  },

  async getSchedules(accessToken: string): Promise<Schedule[]> {
    await mockDelay(90);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      return clone(
        state.schedules
          .filter((s) => s.user_id === user.id)
          .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      ) as Schedule[];
    });
  },

  async patchSchedule(scheduleId: string, patch: PatchSchedulePayload, accessToken: string): Promise<Schedule> {
    await mockDelay(100);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const schedule = state.schedules.find((s) => s.user_id === user.id && s.id === scheduleId);
      if (!schedule) throw mockNotFound("Schedule not found");
      if (patch.type) schedule.type = patch.type;
      if (patch.windows) schedule.windows = clone(patch.windows);
      if (patch.cadence) schedule.cadence = clone(patch.cadence);
      if (patch.retry_policy !== undefined) schedule.retry_policy = patch.retry_policy ? clone(patch.retry_policy) : undefined;
      schedule.updated_at = nowIso();
      return clone(schedule) as Schedule;
    });
  },

  async deleteSchedule(scheduleId: string, accessToken: string): Promise<void> {
    await mockDelay(80);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const before = state.schedules.length;
      state.schedules = state.schedules.filter((s) => !(s.user_id === user.id && s.id === scheduleId));
      if (state.schedules.length === before) throw mockNotFound("Schedule not found");
    });
  },

  async getCheckinEvents(
    accessToken: string,
    options: { type?: "call" | "chat"; status?: CheckinEvent["status"]; from_utc?: string; to_utc?: string; limit?: number } = {}
  ): Promise<CheckinEvent[]> {
    await mockDelay(90);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      let items = state.checkin_events.filter((e) => e.user_id === user.id);
      if (options.type) items = items.filter((e) => e.type === options.type);
      if (options.status) items = items.filter((e) => e.status === options.status);
      if (options.from_utc) items = items.filter((e) => e.scheduled_at_utc >= options.from_utc!);
      if (options.to_utc) items = items.filter((e) => e.scheduled_at_utc <= options.to_utc!);
      items = items.sort((a, b) => a.scheduled_at_utc.localeCompare(b.scheduled_at_utc));
      if (options.limit) items = items.slice(0, options.limit);
      return clone(items);
    });
  },

  async triggerManualCheckin(payload: ManualCheckinPayload, accessToken: string): Promise<CheckinEvent> {
    await mockDelay(110);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const ts = nowIso();
      const event: MockCheckinEventRecord = {
        id: randomId("evt"),
        user_id: user.id,
        type: payload.type ?? "call",
        status: "scheduled",
        scheduled_at_utc: payload.scheduled_at_utc ?? ts,
        attempt_count: 0,
        provider_call_id: null,
        created_at: ts,
        updated_at: ts
      };
      state.checkin_events.push(event);
      return clone(event);
    });
  },

  async getDashboardToday(accessToken: string, dateLocal?: string): Promise<DashboardTodayResponse> {
    await mockDelay(100);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      return buildDashboardToday(state, user.id, dateLocal ?? todayIso());
    });
  },

  async sendChat(payload: { thread_id: string; message: string; client_message_id?: string }, accessToken: string): Promise<ChatResponse> {
    await mockDelay(220);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const userMessage: MockMessageRecord = {
        id: payload.client_message_id ?? randomId("msg"),
        user_id: user.id,
        thread_id: payload.thread_id,
        role: "user",
        content: payload.message,
        created_at: nowIso()
      };
      state.messages.push(userMessage);

      const lower = payload.message.toLowerCase();
      const actions: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const goal = activeGoalForUser(state, user.id);
      const firstHabit = state.habits.find((h) => h.user_id === user.id && h.active);

      if ((lower.includes("done") || lower.includes("finished") || lower.includes("completed")) && firstHabit) {
        const existingLog = state.habit_logs.find(
          (l) => l.user_id === user.id && l.habit_id === firstHabit.id && l.date_local === todayIso()
        );
        if (existingLog) {
          existingLog.status = "done";
          existingLog.source = "chat_auto";
          existingLog.created_at = nowIso();
        } else {
          state.habit_logs.push({
            id: randomId("hlog"),
            user_id: user.id,
            habit_id: firstHabit.id,
            date_local: todayIso(),
            status: "done",
            source: "chat_auto",
            created_at: nowIso()
          });
        }
        actions.push({ type: "habit_log_created", payload: { habit_id: firstHabit.id, status: "done", source: "chat_auto" } });
      }

      const profile = ensureMemoryProfile(state, user.id);
      profile.rolling_summary = `Recent focus: ${payload.message.slice(0, 120)}`;

      const assistantMessage =
        firstHabit && (lower.includes("done") || lower.includes("finished"))
          ? `Nice. I logged "${firstHabit.title}" as done for today. Next, protect one focused block for ${goal?.statement ?? "your goal"}.`
          : `Got it. You're working on ${goal?.statement ?? "your goal"}. Let's turn that into one concrete next step for today and one fallback if your schedule gets messy.`;

      const assistantRecord: MockMessageRecord = {
        id: randomId("msg"),
        user_id: user.id,
        thread_id: payload.thread_id,
        role: "assistant",
        content: assistantMessage,
        created_at: nowIso()
      };
      state.messages.push(assistantRecord);

      return {
        assistant_message: assistantMessage,
        thread_id: payload.thread_id,
        created_at: assistantRecord.created_at,
        actions_executed: actions,
        memory_snapshot_version: state.messages.filter((m) => m.user_id === user.id).length
      };
    });
  },

  async getWeeklyReview(weekStart: string, accessToken: string): Promise<WeeklyReview> {
    await mockDelay(100);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      const existing = state.weekly_reviews.find((r) => r.user_id === user.id && r.week_start_date === weekStart);
      if (existing) {
        return clone(existing);
      }
      return clone(synthesizeReview(state, user.id, weekStart));
    });
  },

  async approveWeeklyReview(
    weekStart: string,
    payload: { decision: "approve" | "reject"; selected_change_ids?: string[] },
    accessToken: string
  ): Promise<{ status: string; applied_changes_count: number; updated_habits: unknown[] }> {
    await mockDelay(140);
    return withMockState((state) => {
      const user = userFromAccessToken(state, accessToken);
      let review = state.weekly_reviews.find((r) => r.user_id === user.id && r.week_start_date === weekStart);
      if (!review) {
        review = synthesizeReview(state, user.id, weekStart);
      }
      const changes = review.pending_plan_changes ?? [];
      const selectedSet = new Set(payload.selected_change_ids ?? []);
      const applicableChanges =
        payload.selected_change_ids && payload.selected_change_ids.length > 0
          ? changes.filter((c) => selectedSet.has(String((c as { id?: unknown }).id ?? "")))
          : changes;

      review.status = payload.decision === "approve" ? "approved" : "rejected";
      review.approved_at = payload.decision === "approve" ? nowIso() : null;
      ensureMemoryProfile(state, user.id).weekly_focus = review.week_focus;

      return {
        status: review.status,
        applied_changes_count: payload.decision === "approve" ? applicableChanges.length : 0,
        updated_habits: []
      };
    });
  }
};

async function parseApiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  let message = `API error ${response.status}`;

  try {
    const json = JSON.parse(text) as { error?: { message?: string } };
    if (json.error?.message) {
      message = json.error.message;
    } else if (typeof json === "object") {
      message = text;
    }
  } catch {
    if (text) {
      message = text;
    }
  }

  return new ApiError(response.status, message, text);
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { accessToken?: string } = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

const realApi = {
  register(payload: RegisterPayload) {
    return apiRequest<SessionResult>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  login(payload: { email: string; password: string }) {
    return apiRequest<SessionResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  refresh(payload: { refresh_token: string }) {
    return apiRequest<RefreshResult>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  logout(payload: { refresh_token?: string }, accessToken?: string) {
    return apiRequest<void>(
      "/auth/logout",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      { accessToken }
    );
  },

  verifyPhone(payload: { phone_e164: string; otp_code?: string }, accessToken: string) {
    return apiRequest<{ phone_verified: boolean }>(
      "/auth/verify-phone",
      { method: "POST", body: JSON.stringify(payload) },
      { accessToken }
    );
  },

  createGoal(payload: { statement: string; motivation: string; constraints?: string; target_date: string }, accessToken: string) {
    return apiRequest<Goal>("/goals", { method: "POST", body: JSON.stringify(payload) }, { accessToken });
  },

  getActiveGoal(accessToken: string) {
    return apiRequest<Goal>("/goals/active", { method: "GET" }, { accessToken });
  },

  createHabit(payload: CreateHabitPayload, accessToken: string) {
    return apiRequest<Habit>("/habits", { method: "POST", body: JSON.stringify(payload) }, { accessToken });
  },

  getHabits(accessToken: string, options: { goal_id?: string; include_inactive?: boolean } = {}) {
    const params = new URLSearchParams();
    if (options.goal_id) params.set("goal_id", options.goal_id);
    if (typeof options.include_inactive === "boolean") {
      params.set("include_inactive", String(options.include_inactive));
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiRequest<Habit[]>(`/habits${query}`, { method: "GET" }, { accessToken });
  },

  patchHabit(habitId: string, patch: Record<string, unknown>, accessToken: string) {
    return apiRequest<Habit>(`/habits/${habitId}`, { method: "PATCH", body: JSON.stringify(patch) }, { accessToken });
  },

  createHabitLog(payload: CreateHabitLogPayload, accessToken: string) {
    return apiRequest<{ id: string }>("/habit-logs", { method: "POST", body: JSON.stringify(payload) }, { accessToken });
  },

  createSchedule(payload: CreateSchedulePayload, accessToken: string) {
    return apiRequest<Schedule>("/schedules", { method: "POST", body: JSON.stringify(payload) }, { accessToken });
  },

  getSchedules(accessToken: string) {
    return apiRequest<Schedule[]>("/schedules", { method: "GET" }, { accessToken });
  },

  patchSchedule(scheduleId: string, patch: PatchSchedulePayload, accessToken: string) {
    return apiRequest<Schedule>(`/schedules/${scheduleId}`, { method: "PATCH", body: JSON.stringify(patch) }, { accessToken });
  },

  deleteSchedule(scheduleId: string, accessToken: string) {
    return apiRequest<void>(`/schedules/${scheduleId}`, { method: "DELETE" }, { accessToken });
  },

  getCheckinEvents(
    accessToken: string,
    options: { type?: "call" | "chat"; status?: CheckinEvent["status"]; from_utc?: string; to_utc?: string; limit?: number } = {}
  ) {
    const params = new URLSearchParams();
    if (options.type) params.set("type", options.type);
    if (options.status) params.set("status", options.status);
    if (options.from_utc) params.set("from_utc", options.from_utc);
    if (options.to_utc) params.set("to_utc", options.to_utc);
    if (typeof options.limit === "number") params.set("limit", String(options.limit));
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiRequest<CheckinEvent[]>(`/checkin-events${query}`, { method: "GET" }, { accessToken });
  },

  triggerManualCheckin(payload: ManualCheckinPayload, accessToken: string) {
    return apiRequest<CheckinEvent>(`/checkin-events/manual`, { method: "POST", body: JSON.stringify(payload) }, { accessToken });
  },

  getDashboardToday(accessToken: string, dateLocal?: string) {
    const query = dateLocal ? `?date_local=${encodeURIComponent(dateLocal)}` : "";
    return apiRequest<DashboardTodayResponse>(`/dashboard/today${query}`, { method: "GET" }, { accessToken });
  },

  sendChat(payload: { thread_id: string; message: string; client_message_id?: string }, accessToken: string) {
    return apiRequest<ChatResponse>("/chat", { method: "POST", body: JSON.stringify(payload) }, { accessToken });
  },

  getWeeklyReview(weekStart: string, accessToken: string) {
    return apiRequest<WeeklyReview>(`/weekly-reviews/${weekStart}`, { method: "GET" }, { accessToken });
  },

  approveWeeklyReview(
    weekStart: string,
    payload: { decision: "approve" | "reject"; selected_change_ids?: string[] },
    accessToken: string
  ) {
    return apiRequest<{ status: string; applied_changes_count: number; updated_habits: unknown[] }>(
      `/weekly-reviews/${weekStart}/approve`,
      { method: "POST", body: JSON.stringify(payload) },
      { accessToken }
    );
  }
};

export const api = UI_ONLY_MODE ? mockApi : realApi;
