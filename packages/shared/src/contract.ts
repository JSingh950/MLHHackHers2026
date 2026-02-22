export type UUID = string;

export interface Goal {
  id: UUID;
  user_id: UUID;
  statement: string;
  motivation: string;
  constraints: string | null;
  target_date: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TimeWindowSimple {
  start_local: string;
  end_local: string;
}

export type HabitLogStatus = "done" | "partial" | "missed" | "skipped";

export interface Habit {
  id: UUID;
  user_id: UUID;
  goal_id: UUID;
  title: string;
  frequency: Record<string, unknown>;
  measurement: Record<string, unknown>;
  difficulty_1_to_10: number;
  default_time_window: TimeWindowSimple;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RetryPolicy {
  max_attempts: number;
  retry_delay_minutes: number;
}

export interface Schedule {
  id: UUID;
  user_id: UUID;
  type: "call" | "chat";
  windows: Array<Record<string, unknown>>;
  cadence: Record<string, unknown>;
  retry_policy: RetryPolicy;
  created_at: string;
  updated_at: string;
}

export interface CheckinEvent {
  id: UUID;
  user_id: UUID;
  scheduled_at_utc: string;
  type: "call" | "chat";
  status: "scheduled" | "in_progress" | "completed" | "failed" | "no_answer";
  attempt_count: number;
  provider_call_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardHabitItem {
  habit_id: UUID;
  title: string;
  status: "pending" | HabitLogStatus;
  target_window: TimeWindowSimple;
  difficulty_1_to_10: number;
}

export interface CommitmentItem {
  id: UUID;
  text: string;
  due_date_local: string;
  status: "open" | "completed" | "canceled";
}

export interface DashboardTodayResponse {
  date_local: string;
  timezone: string;
  goal: Goal;
  habits_today: DashboardHabitItem[];
  commitments: CommitmentItem[];
  last_call_recap: string | null;
  weekly_focus: string | null;
}

export interface ChatResponse {
  assistant_message: string;
  thread_id: UUID;
  created_at: string;
  actions_executed?: Array<{ type: string; payload: Record<string, unknown> }>;
  memory_snapshot_version?: number;
}

export interface WeeklyHabitStat {
  habit_id: UUID;
  title: string;
  completion_rate: number;
  done_count: number;
  target_count: number;
  recommendation: "increase" | "keep" | "simplify";
}

export interface WeeklyReview {
  user_id: UUID;
  week_start_date: string;
  completion_stats: WeeklyHabitStat[];
  wins: string[];
  misses: string[];
  blockers: string[];
  fixes: string[];
  summary?: string;
  week_focus: string;
  pending_plan_changes?: Array<Record<string, unknown>>;
  status: "pending_approval" | "approved" | "rejected";
  generated_at?: string;
  approved_at?: string | null;
}
