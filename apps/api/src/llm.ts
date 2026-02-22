import type { Habit, Schedule } from "@goalcoach/shared";

export type CoachActionType =
  | "habit_log_created"
  | "blocker_created"
  | "commitment_created"
  | "schedule_suggested"
  | "checkin_event_created";

export interface CoachAction {
  type: CoachActionType;
  payload: Record<string, unknown>;
}

export interface CoachCompletion {
  assistantMessage: string;
  actions: CoachAction[];
  rollingSummary: string;
}

interface ChatContextInput {
  userTimezone: string;
  goalStatement: string;
  weeklyFocus: string | null;
  lastCallRecap: string | null;
  rollingSummary: string | null;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  availableHabits: Habit[];
  schedules: Schedule[];
  phoneVerified: boolean;
  phoneNumber: string | null;
  callsOptIn: boolean;
  userMessage: string;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

function sanitizeAction(raw: unknown): CoachAction | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as { type?: unknown; payload?: unknown };
  if (typeof candidate.type !== "string") {
    return null;
  }

  const allowed: CoachActionType[] = [
    "habit_log_created",
    "blocker_created",
    "commitment_created",
    "schedule_suggested",
    "checkin_event_created"
  ];

  if (!allowed.includes(candidate.type as CoachActionType)) {
    return null;
  }

  const payload = candidate.payload && typeof candidate.payload === "object" ? (candidate.payload as Record<string, unknown>) : {};

  return {
    type: candidate.type as CoachActionType,
    payload
  };
}

function fallbackCompletion(input: ChatContextInput): CoachCompletion {
  const lower = input.userMessage.toLowerCase();
  const actions: CoachAction[] = [];

  if (lower.includes("blocker:")) {
    const blockerText = input.userMessage.split(/blocker:/i)[1]?.trim();
    if (blockerText) {
      actions.push({
        type: "blocker_created",
        payload: {
          blocker_text: blockerText,
          severity: "medium"
        }
      });
    }
  }

  if (lower.includes("commit:")) {
    const commitmentText = input.userMessage.split(/commit:/i)[1]?.trim();
    if (commitmentText) {
      actions.push({
        type: "commitment_created",
        payload: {
          commitment_text: commitmentText
        }
      });
    }
  }

  return {
    assistantMessage:
      "I logged your update. Focus on completing one high-impact habit in your next available window and report back tonight.",
    actions,
    rollingSummary: `Last user update: ${input.userMessage.slice(0, 180)}${input.userMessage.length > 180 ? "..." : ""}`
  };
}

function buildSystemPrompt(): string {
  return [
    "You are GoalCoach, a practical habit coach.",
    "Return strict JSON only.",
    "Schema:",
    "{",
    '  "assistant_message": "string",',
    '  "actions": [',
    '    { "type": "habit_log_created|blocker_created|commitment_created|schedule_suggested", "payload": { ... } }',
    "  ],",
    '  "rolling_summary": "string <= 240 chars"',
    "}",
    "Action rules:",
    "- Only create actions when the user explicitly states new facts.",
    "- For blocker_created payload: blocker_text, severity(low|medium|high).",
    "- For commitment_created payload: commitment_text, due_date_local(YYYY-MM-DD) if known.",
    "- For habit_log_created payload: habit_id, status(done|partial|missed|skipped), date_local(YYYY-MM-DD).",
    "- For schedule_suggested payload (used as schedule upsert tool action): include type(call|chat), windows(array), cadence(object), retry_policy(optional object). Only emit when user explicitly asks to create/change schedule.",
    "- For checkin_event_created payload: include type(call|chat) and optionally scheduled_at_utc (ISO timestamp). Use only when user explicitly asks to trigger a call/check-in now or at a specific time.",
    "- Do not invent habit IDs. Use only provided habit IDs.",
    "Tone rules:",
    "- Keep assistant_message concise, direct, and supportive.",
    "- Include one concrete next step."
  ].join("\n");
}

export async function generateCoachCompletion(input: ChatContextInput): Promise<CoachCompletion> {
  if (!OPENAI_API_KEY) {
    return fallbackCompletion(input);
  }

  const habitReference = input.availableHabits.map((habit) => ({
    id: habit.id,
    title: habit.title,
    frequency: habit.frequency,
    measurement: habit.measurement
  }));

  const userPayload = {
    context: {
      timezone: input.userTimezone,
      goal_statement: input.goalStatement,
      weekly_focus: input.weeklyFocus,
      last_call_recap: input.lastCallRecap,
      rolling_summary: input.rollingSummary,
      habits: habitReference,
      schedules: input.schedules,
      phone_verified: input.phoneVerified,
      phone_e164: input.phoneNumber,
      calls_opt_in: input.callsOptIn,
      recent_messages: input.recentMessages
    },
    user_message: input.userMessage,
    today_local: new Date().toISOString().slice(0, 10)
  };

  const requestBody: Record<string, unknown> = {
    model: OPENAI_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildSystemPrompt()
      },
      {
        role: "user",
        content: JSON.stringify(userPayload)
      }
    ]
  };

  // GPT-5 chat models currently only accept the default temperature value.
  if (!OPENAI_MODEL.toLowerCase().startsWith("gpt-5")) {
    requestBody.temperature = 0.4;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    return fallbackCompletion(input);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return fallbackCompletion(input);
  }

  try {
    const parsed = JSON.parse(content) as {
      assistant_message?: unknown;
      actions?: unknown;
      rolling_summary?: unknown;
    };

    const assistantMessage = typeof parsed.assistant_message === "string" ? parsed.assistant_message : fallbackCompletion(input).assistantMessage;
    const actionList = Array.isArray(parsed.actions) ? parsed.actions.map(sanitizeAction).filter((item): item is CoachAction => Boolean(item)) : [];
    const rollingSummary =
      typeof parsed.rolling_summary === "string" && parsed.rolling_summary.trim().length > 0
        ? parsed.rolling_summary.slice(0, 240)
        : `Last user update: ${input.userMessage.slice(0, 180)}${input.userMessage.length > 180 ? "..." : ""}`;

    return {
      assistantMessage,
      actions: actionList,
      rollingSummary
    };
  } catch {
    return fallbackCompletion(input);
  }
}
