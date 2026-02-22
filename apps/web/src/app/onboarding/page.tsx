"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, api, UI_ONLY_MODE } from "../../lib/api";
import { todayIsoDate } from "../../lib/date";
import { type StoredSession, useAuth } from "../../components/auth-provider";

type StepId =
  | "name"
  | "email"
  | "password"
  | "timezone"
  | "phone"
  | "consent"
  | "goal_statement"
  | "goal_motivation"
  | "goal_constraints"
  | "target_date"
  | "habit_title"
  | "habit_details"
  | "habit_window"
  | "call_checkin"
  | "review";

type Answers = {
  name: string;
  email: string;
  password: string;
  timezone: string;
  phone_e164: string;
  consents: {
    calls_opt_in: boolean;
    transcription_opt_in: boolean;
    storage_opt_in: boolean;
  };
  goal_statement: string;
  goal_motivation: string;
  goal_constraints: string;
  target_date: string;
  habit_title: string;
  habit_frequency: "daily" | "weekdays" | "custom";
  habit_measurement_type: "boolean" | "count" | "duration_minutes";
  habit_target_value: string;
  habit_measurement_unit: string;
  habit_difficulty: string;
  habit_start_local: string;
  habit_end_local: string;
  enable_call_checkins: boolean;
  call_days_csv: string;
  call_start_local: string;
  call_end_local: string;
};

type StepDef = {
  id: StepId;
  optional?: boolean;
};

const steps: StepDef[] = [
  { id: "name" },
  { id: "email" },
  { id: "password" },
  { id: "timezone" },
  { id: "phone", optional: true },
  { id: "consent" },
  { id: "goal_statement" },
  { id: "goal_motivation" },
  { id: "goal_constraints", optional: true },
  { id: "target_date" },
  { id: "habit_title" },
  { id: "habit_details" },
  { id: "habit_window" },
  { id: "call_checkin", optional: true },
  { id: "review" }
];

function guessTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function plusDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function toStoredSession(session: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: StoredSession["user"];
}): StoredSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    accessTokenExpiresAt: Date.now() + session.expires_in * 1000 - 5000,
    user: session.user
  };
}

function parseDaysCsv(csv: string): number[] {
  return csv
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

function answerPreview(stepId: StepId, answers: Answers): string | null {
  switch (stepId) {
    case "name":
      return answers.name || null;
    case "email":
      return answers.email || null;
    case "password":
      return answers.password ? "••••••••" : null;
    case "timezone":
      return answers.timezone || null;
    case "phone":
      return answers.phone_e164 || "Skipped";
    case "consent":
      return answers.consents.calls_opt_in &&
        answers.consents.transcription_opt_in &&
        answers.consents.storage_opt_in
        ? "All consent flags enabled"
        : "Consent flags need review";
    case "goal_statement":
      return answers.goal_statement || null;
    case "goal_motivation":
      return answers.goal_motivation || null;
    case "goal_constraints":
      return answers.goal_constraints || "None";
    case "target_date":
      return answers.target_date || null;
    case "habit_title":
      return answers.habit_title || null;
    case "habit_details":
      return `${answers.habit_frequency}, ${answers.habit_measurement_type}, difficulty ${answers.habit_difficulty}`;
    case "habit_window":
      return `${answers.habit_start_local} - ${answers.habit_end_local}`;
    case "call_checkin":
      return answers.enable_call_checkins
        ? `On (${answers.call_days_csv}) ${answers.call_start_local}-${answers.call_end_local}`
        : "Skipped";
    case "review":
      return null;
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const { session, isAuthenticated, setSession, runAuthed } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({
    name: "",
    email: "",
    password: "",
    timezone: guessTimezone(),
    phone_e164: "",
    consents: {
      calls_opt_in: true,
      transcription_opt_in: true,
      storage_opt_in: true
    },
    goal_statement: "",
    goal_motivation: "",
    goal_constraints: "",
    target_date: plusDays(todayIsoDate(), 90),
    habit_title: "",
    habit_frequency: "daily",
    habit_measurement_type: "boolean",
    habit_target_value: "1",
    habit_measurement_unit: "done",
    habit_difficulty: "4",
    habit_start_local: "08:00",
    habit_end_local: "09:00",
    enable_call_checkins: true,
    call_days_csv: "1,2,3,4,5",
    call_start_local: "17:00",
    call_end_local: "20:00"
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [checkingExistingOnboarding, setCheckingExistingOnboarding] = useState(false);

  const step = steps[stepIndex];

  useEffect(() => {
    let canceled = false;
    async function checkExisting() {
      if (!isAuthenticated) return;
      setCheckingExistingOnboarding(true);
      try {
        await runAuthed((token) => api.getActiveGoal(token));
        if (!canceled) {
          router.replace("/dashboard");
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // No active goal yet, continue onboarding.
        } else if (!canceled) {
          setError(err instanceof Error ? err.message : "Failed to verify onboarding state");
        }
      } finally {
        if (!canceled) {
          setCheckingExistingOnboarding(false);
        }
      }
    }
    void checkExisting();
    return () => {
      canceled = true;
    };
  }, [isAuthenticated, router, runAuthed]);

  const progress = `${stepIndex + 1} / ${steps.length}`;
  const prompts = useMemo<Record<StepId, string>>(
    () => ({
      name: "What is your name?",
      email: answers.name
        ? `Hi ${firstName(answers.name)}. What's your email?`
        : "What's your email?",
      password: "Create a password.",
      timezone: `What timezone should I coach you in, ${firstName(answers.name)}?`,
      phone: "What phone number should we use for check-in calls? (optional)",
      consent:
        "Do you consent to calls, transcription, and memory storage so the coach can work across chat + calls?",
      goal_statement: "What goal are we coaching toward?",
      goal_motivation: "Why does this goal matter right now?",
      goal_constraints: "Any constraints I should remember while coaching you? (optional)",
      target_date: "What target date are we aiming for?",
      habit_title: "What is the first habit we should build around this goal?",
      habit_details: "How should that habit be measured and how hard should it feel?",
      habit_window: "When should this habit usually happen?",
      call_checkin: "Do you want scheduled call check-ins during the week?",
      review: `Perfect, ${firstName(answers.name)}. Review your setup and create your workspace.`
    }),
    [answers.name]
  );

  const stepCanContinue = useMemo(() => {
    switch (step.id) {
      case "name":
        return answers.name.trim().length >= 2;
      case "email":
        return /\S+@\S+\.\S+/.test(answers.email.trim());
      case "password":
        return answers.password.length >= 4;
      case "timezone":
        return answers.timezone.trim().length > 0;
      case "phone":
        return true;
      case "consent":
        return (
          answers.consents.calls_opt_in &&
          answers.consents.transcription_opt_in &&
          answers.consents.storage_opt_in
        );
      case "goal_statement":
        return answers.goal_statement.trim().length >= 5;
      case "goal_motivation":
        return answers.goal_motivation.trim().length >= 5;
      case "goal_constraints":
        return true;
      case "target_date":
        return Boolean(answers.target_date);
      case "habit_title":
        return answers.habit_title.trim().length >= 3;
      case "habit_details":
        return (
          Number(answers.habit_difficulty) >= 1 &&
          Number(answers.habit_difficulty) <= 10 &&
          answers.habit_target_value.trim().length > 0 &&
          answers.habit_measurement_unit.trim().length > 0
        );
      case "habit_window":
        return Boolean(answers.habit_start_local && answers.habit_end_local);
      case "call_checkin":
        return !answers.enable_call_checkins || parseDaysCsv(answers.call_days_csv).length > 0;
      case "review":
        return true;
      default:
        return false;
    }
  }, [answers, step.id]);

  const completedHistory = useMemo(
    () =>
      steps
        .slice(0, stepIndex)
        .map((s) => ({ id: s.id, preview: answerPreview(s.id, answers) }))
        .filter((x) => x.preview),
    [answers, stepIndex]
  );

  function nextStep() {
    if (!stepCanContinue) return;
    setError(null);
    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  }

  function previousStep() {
    setError(null);
    setStepIndex((prev) => Math.max(prev - 1, 0));
  }

  function skipStep() {
    if (!step.optional) return;
    if (step.id === "phone") {
      setAnswers((prev) => ({ ...prev, phone_e164: "" }));
    }
    if (step.id === "goal_constraints") {
      setAnswers((prev) => ({ ...prev, goal_constraints: "" }));
    }
    if (step.id === "call_checkin") {
      setAnswers((prev) => ({ ...prev, enable_call_checkins: false }));
    }
    nextStep();
  }

  async function submitAll() {
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      let accessToken = session?.accessToken;
      let currentUserId = session?.user.id;

      if (!isAuthenticated) {
        const authResult = await api.register({
          email: answers.email.trim(),
          password: answers.password,
          name: answers.name.trim(),
          timezone: answers.timezone.trim(),
          phone_e164: answers.phone_e164.trim() || null,
          consent_flags: {
            calls_opt_in: answers.consents.calls_opt_in,
            transcription_opt_in: answers.consents.transcription_opt_in,
            storage_opt_in: answers.consents.storage_opt_in
          }
        });
        const stored = toStoredSession(authResult);
        setSession(stored);
        accessToken = stored.accessToken;
        currentUserId = stored.user.id;
      }

      if (!accessToken || !currentUserId) {
        throw new Error("Missing authenticated session");
      }

      const goal = await api.createGoal(
        {
          statement: answers.goal_statement.trim(),
          motivation: answers.goal_motivation.trim(),
          constraints: answers.goal_constraints.trim() || undefined,
          target_date: answers.target_date
        },
        accessToken
      );

      await api.createHabit(
        {
          goal_id: goal.id,
          title: answers.habit_title.trim(),
          frequency: { cadence: answers.habit_frequency },
          measurement: {
            type: answers.habit_measurement_type,
            target_value: Number(answers.habit_target_value),
            unit: answers.habit_measurement_unit.trim()
          },
          difficulty_1_to_10: Number(answers.habit_difficulty),
          default_time_window: {
            start_local: answers.habit_start_local,
            end_local: answers.habit_end_local
          },
          active: true
        },
        accessToken
      );

      if (answers.enable_call_checkins) {
        await api.createSchedule(
          {
            type: "call",
            windows: [
              {
                days_of_week: parseDaysCsv(answers.call_days_csv),
                start_local: answers.call_start_local,
                end_local: answers.call_end_local
              }
            ],
            cadence: {
              kind: "weekly",
              interval: 1
            },
            retry_policy: {
              max_attempts: 1,
              retry_delay_minutes: 10
            }
          },
          accessToken
        );
      }

      setSuccessMessage(UI_ONLY_MODE ? "UI demo workspace created locally." : "Workspace created. Redirecting...");
      setTimeout(() => {
        router.replace("/dashboard");
      }, 900);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Onboarding failed");
    } finally {
      setSubmitting(false);
    }
  }

  function onEnter(event: FormEvent) {
    event.preventDefault();
    if (step.id === "review") {
      if (!submitting) {
        void submitAll();
      }
      return;
    }
    nextStep();
  }

  return (
    <main className="obo-shell">
      <div className="obo-stars" aria-hidden="true" />
      <div className="obo-noise" aria-hidden="true" />

      <div className="obo-topbar">
        <div className="obo-brand">Goal Coach</div>
        <div className="obo-progress">{progress}</div>
      </div>

      <section className="obo-stage">
        <div className="obo-left-rail">
          <div className="obo-rail-card">
            <div className="obo-rail-title">Setup flow</div>
            <div className="obo-rail-copy">
              Conversational onboarding for account + goal + first habit + optional call schedule.
            </div>
            <div className="obo-steps">
              {steps.map((s, idx) => (
                <div
                  key={s.id}
                  className={`obo-step-pill ${idx === stepIndex ? "active" : ""} ${idx < stepIndex ? "done" : ""}`}
                >
                  <span>{idx + 1}</span>
                  <small>{s.id.replace(/_/g, " ")}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="obo-rail-card">
            <div className="obo-rail-title">Already have an account?</div>
            <div className="obo-rail-actions">
              <Link className="obo-link-button" href="/login">
                Sign in
              </Link>
              {isAuthenticated ? (
                <Link className="obo-link-button" href="/dashboard">
                  Go to dashboard
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="obo-center">
          {checkingExistingOnboarding ? (
            <div className="obo-alert">Checking your setup...</div>
          ) : null}
          <div className="obo-history">
            {completedHistory.slice(-4).map((entry) => (
              <div key={entry.id} className="obo-history-chip">
                <span className="obo-history-label">{entry.id.replace(/_/g, " ")}</span>
                <span className="obo-history-value">{entry.preview}</span>
              </div>
            ))}
          </div>

          <h1 className="obo-prompt">{prompts[step.id]}</h1>

          <form className="obo-input-wrap" onSubmit={onEnter}>
            {step.id === "name" ? (
              <input
                autoFocus
                className="obo-input"
                placeholder="Type your name"
                value={answers.name}
                onChange={(e) => setAnswers((prev) => ({ ...prev, name: e.target.value }))}
              />
            ) : null}

            {step.id === "email" ? (
              <input
                autoFocus
                className="obo-input"
                type="email"
                placeholder="you@example.com"
                value={answers.email}
                onChange={(e) => setAnswers((prev) => ({ ...prev, email: e.target.value }))}
              />
            ) : null}

            {step.id === "password" ? (
              <input
                autoFocus
                className="obo-input"
                type="password"
                placeholder="Create a password"
                value={answers.password}
                onChange={(e) => setAnswers((prev) => ({ ...prev, password: e.target.value }))}
              />
            ) : null}

            {step.id === "timezone" ? (
              <input
                autoFocus
                className="obo-input"
                placeholder="America/New_York"
                value={answers.timezone}
                onChange={(e) => setAnswers((prev) => ({ ...prev, timezone: e.target.value }))}
              />
            ) : null}

            {step.id === "phone" ? (
              <input
                autoFocus
                className="obo-input"
                placeholder="+19085551234 (optional)"
                value={answers.phone_e164}
                onChange={(e) => setAnswers((prev) => ({ ...prev, phone_e164: e.target.value }))}
              />
            ) : null}

            {step.id === "consent" ? (
              <div className="obo-glass-card">
                <label className="obo-check">
                  <input
                    type="checkbox"
                    checked={answers.consents.calls_opt_in}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        consents: { ...prev.consents, calls_opt_in: e.target.checked }
                      }))
                    }
                  />
                  <span>Phone calls + reminders</span>
                </label>
                <label className="obo-check">
                  <input
                    type="checkbox"
                    checked={answers.consents.transcription_opt_in}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        consents: { ...prev.consents, transcription_opt_in: e.target.checked }
                      }))
                    }
                  />
                  <span>Transcription + analysis</span>
                </label>
                <label className="obo-check">
                  <input
                    type="checkbox"
                    checked={answers.consents.storage_opt_in}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        consents: { ...prev.consents, storage_opt_in: e.target.checked }
                      }))
                    }
                  />
                  <span>Stored coaching memory</span>
                </label>
                <p className="obo-help">All three are required for the current coaching + calling experience.</p>
              </div>
            ) : null}

            {step.id === "goal_statement" ? (
              <input
                autoFocus
                className="obo-input"
                placeholder="Build GoalCoach and stay consistent while shipping"
                value={answers.goal_statement}
                onChange={(e) => setAnswers((prev) => ({ ...prev, goal_statement: e.target.value }))}
              />
            ) : null}

            {step.id === "goal_motivation" ? (
              <textarea
                autoFocus
                className="obo-textarea"
                placeholder="Why this matters and what changes if you hit it..."
                value={answers.goal_motivation}
                onChange={(e) => setAnswers((prev) => ({ ...prev, goal_motivation: e.target.value }))}
              />
            ) : null}

            {step.id === "goal_constraints" ? (
              <textarea
                autoFocus
                className="obo-textarea"
                placeholder="Travel, work schedule, energy limits, family constraints (optional)"
                value={answers.goal_constraints}
                onChange={(e) => setAnswers((prev) => ({ ...prev, goal_constraints: e.target.value }))}
              />
            ) : null}

            {step.id === "target_date" ? (
              <div className="obo-glass-card">
                <label className="obo-field-label" htmlFor="target-date">
                  Target date
                </label>
                <input
                  id="target-date"
                  className="obo-inline-input"
                  type="date"
                  value={answers.target_date}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, target_date: e.target.value }))}
                />
              </div>
            ) : null}

            {step.id === "habit_title" ? (
              <input
                autoFocus
                className="obo-input"
                placeholder="Daily planning check-in"
                value={answers.habit_title}
                onChange={(e) => setAnswers((prev) => ({ ...prev, habit_title: e.target.value }))}
              />
            ) : null}

            {step.id === "habit_details" ? (
              <div className="obo-glass-card obo-grid">
                <div className="obo-field">
                  <label className="obo-field-label">Frequency</label>
                  <select
                    className="obo-inline-input"
                    value={answers.habit_frequency}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        habit_frequency: e.target.value as Answers["habit_frequency"]
                      }))
                    }
                  >
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="obo-field">
                  <label className="obo-field-label">Measurement type</label>
                  <select
                    className="obo-inline-input"
                    value={answers.habit_measurement_type}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        habit_measurement_type: e.target.value as Answers["habit_measurement_type"]
                      }))
                    }
                  >
                    <option value="boolean">Yes / No</option>
                    <option value="count">Count</option>
                    <option value="duration_minutes">Duration (minutes)</option>
                  </select>
                </div>
                <div className="obo-field">
                  <label className="obo-field-label">Target value</label>
                  <input
                    className="obo-inline-input"
                    type="number"
                    min={0}
                    value={answers.habit_target_value}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, habit_target_value: e.target.value }))}
                  />
                </div>
                <div className="obo-field">
                  <label className="obo-field-label">Unit</label>
                  <input
                    className="obo-inline-input"
                    value={answers.habit_measurement_unit}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, habit_measurement_unit: e.target.value }))
                    }
                  />
                </div>
                <div className="obo-field">
                  <label className="obo-field-label">Difficulty (1-10)</label>
                  <input
                    className="obo-inline-input"
                    type="number"
                    min={1}
                    max={10}
                    value={answers.habit_difficulty}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, habit_difficulty: e.target.value }))}
                  />
                </div>
              </div>
            ) : null}

            {step.id === "habit_window" ? (
              <div className="obo-glass-card obo-grid">
                <div className="obo-field">
                  <label className="obo-field-label">Start</label>
                  <input
                    className="obo-inline-input"
                    type="time"
                    value={answers.habit_start_local}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, habit_start_local: e.target.value }))}
                  />
                </div>
                <div className="obo-field">
                  <label className="obo-field-label">End</label>
                  <input
                    className="obo-inline-input"
                    type="time"
                    value={answers.habit_end_local}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, habit_end_local: e.target.value }))}
                  />
                </div>
              </div>
            ) : null}

            {step.id === "call_checkin" ? (
              <div className="obo-glass-card">
                <div className="obo-segment">
                  <button
                    type="button"
                    className={answers.enable_call_checkins ? "active" : ""}
                    onClick={() => setAnswers((prev) => ({ ...prev, enable_call_checkins: true }))}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={!answers.enable_call_checkins ? "active" : ""}
                    onClick={() => setAnswers((prev) => ({ ...prev, enable_call_checkins: false }))}
                  >
                    Not now
                  </button>
                </div>
                {answers.enable_call_checkins ? (
                  <div className="obo-grid" style={{ marginTop: 12 }}>
                    <div className="obo-field" style={{ gridColumn: "1 / -1" }}>
                      <label className="obo-field-label">Days (0-6 CSV, 1-5 = weekdays)</label>
                      <input
                        className="obo-inline-input"
                        value={answers.call_days_csv}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, call_days_csv: e.target.value }))}
                      />
                    </div>
                    <div className="obo-field">
                      <label className="obo-field-label">Window start</label>
                      <input
                        className="obo-inline-input"
                        type="time"
                        value={answers.call_start_local}
                        onChange={(e) =>
                          setAnswers((prev) => ({ ...prev, call_start_local: e.target.value }))
                        }
                      />
                    </div>
                    <div className="obo-field">
                      <label className="obo-field-label">Window end</label>
                      <input
                        className="obo-inline-input"
                        type="time"
                        value={answers.call_end_local}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, call_end_local: e.target.value }))}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="obo-help">You can add schedules later in Settings.</p>
                )}
              </div>
            ) : null}

            {step.id === "review" ? (
              <div className="obo-glass-card">
                <div className="obo-review-grid">
                  <div><span>Name</span><strong>{answers.name}</strong></div>
                  <div><span>Email</span><strong>{answers.email}</strong></div>
                  <div><span>Timezone</span><strong>{answers.timezone}</strong></div>
                  <div><span>Phone</span><strong>{answers.phone_e164 || "Not provided"}</strong></div>
                  <div><span>Goal</span><strong>{answers.goal_statement}</strong></div>
                  <div><span>Target date</span><strong>{answers.target_date}</strong></div>
                  <div><span>First habit</span><strong>{answers.habit_title}</strong></div>
                  <div><span>Habit window</span><strong>{answers.habit_start_local}-{answers.habit_end_local}</strong></div>
                  <div><span>Call check-ins</span><strong>{answers.enable_call_checkins ? "Enabled" : "Not now"}</strong></div>
                  <div><span>Mode</span><strong>{UI_ONLY_MODE ? "UI-only demo" : "Live backend"}</strong></div>
                </div>
                <p className="obo-help" style={{ marginTop: 12 }}>
                  Submit will create auth session, goal, first habit, and optional call schedule using the existing backend contract.
                </p>
              </div>
            ) : null}

            {error ? <div className="obo-alert error">{error}</div> : null}
            {successMessage ? <div className="obo-alert success">{successMessage}</div> : null}

            <div className="obo-actions">
              <button
                className="obo-btn obo-btn-secondary"
                type="button"
                onClick={previousStep}
                disabled={stepIndex === 0 || submitting}
              >
                Back
              </button>

              <div className="obo-actions-right">
                {step.optional && step.id !== "review" ? (
                  <button className="obo-btn obo-btn-ghost" type="button" onClick={skipStep} disabled={submitting}>
                    Skip
                  </button>
                ) : null}

                {step.id !== "review" ? (
                  <button
                    className="obo-btn obo-btn-primary"
                    type="submit"
                    disabled={!stepCanContinue || submitting}
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    className="obo-btn obo-btn-primary"
                    type="button"
                    disabled={submitting}
                    onClick={() => void submitAll()}
                  >
                    {submitting ? "Creating..." : "Create workspace"}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
