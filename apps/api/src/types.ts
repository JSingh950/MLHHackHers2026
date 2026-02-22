import type { CommitmentItem, DashboardTodayResponse, HabitLogStatus } from "@goalcoach/shared";

export interface ConsentFlags {
  calls_opt_in: boolean;
  transcription_opt_in: boolean;
  storage_opt_in: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  timezone: string;
  phone_e164: string | null;
  phone_verified: boolean;
  consent_flags: ConsentFlags;
  preferences?: Record<string, unknown>;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  timezone: string;
  phone_e164: string | null;
  phone_verified: boolean;
  consent_flags: ConsentFlags;
  preferences?: Record<string, unknown>;
}

export interface HabitLog {
  id: string;
  user_id: string;
  habit_id: string;
  date_local: string;
  status: HabitLogStatus;
  value: number | null;
  note: string | null;
  source: "manual" | "chat_auto" | "call_tool";
  created_at: string;
}

export interface RetryPolicy {
  max_attempts: number;
  retry_delay_minutes: number;
}

export interface Schedule {
  id: string;
  user_id: string;
  type: "call" | "chat";
  windows: Array<Record<string, unknown>>;
  cadence: Record<string, unknown>;
  retry_policy: RetryPolicy;
  created_at: string;
  updated_at: string;
}

export interface CheckinEvent {
  id: string;
  user_id: string;
  scheduled_at_utc: string;
  type: "call" | "chat";
  status: "scheduled" | "in_progress" | "completed" | "failed" | "no_answer";
  attempt_count: number;
  provider_call_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface AuthSessionResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: UserPublic;
}

export interface TodayPlan {
  date_local: string;
  habits: DashboardTodayResponse["habits_today"];
  commitments: CommitmentItem[];
}
