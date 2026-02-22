"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardTodayResponse, Habit, HabitLogStatus, WeeklyReview } from "@goalcoach/shared";
import { ApiError, api } from "../../lib/api";
import { ProtectedPage } from "../../components/protected-page";
import { useAuth } from "../../components/auth-provider";
import { addDays, prettyDate, toWeekStart, todayIsoDate } from "../../lib/date";

type WeekDaySnapshot = {
  date: string;
  data: DashboardTodayResponse | null;
};

type VisibleHabit = {
  id: string;
  title: string;
  difficulty: number;
  start: string;
  end: string;
  active: boolean;
};

const quickStatuses: HabitLogStatus[] = ["done", "partial", "missed", "skipped"];

function extractChangeId(change: Record<string, unknown>): string | null {
  if (typeof change.id === "string") return change.id;
  if (typeof change.change_id === "string") return change.change_id;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function humanizeChangeType(type: string | null): string {
  if (!type) return "Plan update";
  return type.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function describePendingChange(
  change: Record<string, unknown>,
  habitTitleById: Map<string, string>
): { title: string; lines: string[] } {
  const type = typeof change.type === "string" ? change.type : null;
  const habitId = typeof change.habit_id === "string" ? change.habit_id : null;
  const habitTitle = habitId ? habitTitleById.get(habitId) ?? "this habit" : null;
  const reason = typeof change.reason === "string" ? change.reason : null;
  const lines: string[] = [];

  if (type === "tweak_timing" || type === "adjust_time_window") {
    const from = asRecord(change.from);
    const to = asRecord(change.to);
    const fromStart = typeof from?.start_local === "string" ? from.start_local : null;
    const fromEnd = typeof from?.end_local === "string" ? from.end_local : null;
    const toStart = typeof to?.start_local === "string" ? to.start_local : null;
    const toEnd = typeof to?.end_local === "string" ? to.end_local : null;

    const title = habitTitle
      ? `Adjust timing for ${habitTitle}`
      : "Adjust a habit time window";

    if (toStart && toEnd) {
      if (fromStart && fromEnd) {
        lines.push(`Suggested time window change: ${fromStart}-${fromEnd} -> ${toStart}-${toEnd}.`);
      } else {
        lines.push(`Suggested time window: ${toStart}-${toEnd}.`);
      }
    }
    if (reason) lines.push(reason);
    return { title, lines };
  }

  if (type === "simplify_habit") {
    const title = habitTitle ? `Simplify ${habitTitle}` : "Simplify a habit";
    if (reason) lines.push(reason);
    return { title, lines };
  }

  if (type === "increase_difficulty") {
    const title = habitTitle ? `Increase challenge for ${habitTitle}` : "Increase habit difficulty";
    if (reason) lines.push(reason);
    return { title, lines };
  }

  if (type === "change_cadence") {
    const title = habitTitle ? `Change cadence for ${habitTitle}` : "Change habit cadence";
    if (reason) lines.push(reason);
    return { title, lines };
  }

  const title = habitTitle ? `${humanizeChangeType(type)} for ${habitTitle}` : humanizeChangeType(type);
  if (reason) {
    lines.push(reason);
  } else {
    lines.push("Suggested by weekly review based on your completion patterns and blockers.");
  }
  return { title, lines };
}

export default function DashboardPage() {
  const { runAuthed } = useAuth();
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [weekSnapshots, setWeekSnapshots] = useState<WeekDaySnapshot[]>([]);
  const [selectedDayData, setSelectedDayData] = useState<DashboardTodayResponse | null>(null);
  const [weeklyReview, setWeeklyReview] = useState<WeeklyReview | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [selectedReviewChangeIds, setSelectedReviewChangeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [onboardingNeeded, setOnboardingNeeded] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [createHabitForm, setCreateHabitForm] = useState({
    title: "",
    cadence: "daily",
    measurementType: "boolean",
    targetValue: "1",
    unit: "done",
    difficulty: "4",
    start: "08:00",
    end: "09:00"
  });

  const [patchHabitForm, setPatchHabitForm] = useState({
    habitId: "",
    title: "",
    difficulty: "",
    start: "",
    end: "",
    active: "true"
  });

  const weekStart = useMemo(() => toWeekStart(selectedDate), [selectedDate]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setToast(null);
    setOnboardingNeeded(false);

    try {
      const [weekResults, reviewResult, habitsResult] = await Promise.all([
        Promise.all(
          weekDates.map(async (date) => {
            try {
              const data = await runAuthed((token) => api.getDashboardToday(token, date));
              return { date, data } satisfies WeekDaySnapshot;
            } catch (err) {
              if (err instanceof ApiError && err.status === 404) {
                return { date, data: null } satisfies WeekDaySnapshot;
              }
              throw err;
            }
          })
        ),
        runAuthed((token) => api.getWeeklyReview(weekStart, token)).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
        runAuthed((token) => api.getHabits(token, { include_inactive: true })).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return [] as Habit[];
          throw err;
        })
      ]);

      const selectedSnapshot = weekResults.find((d) => d.date === selectedDate) ?? null;
      const anyData = weekResults.some((d) => d.data);

      setWeekSnapshots(weekResults);
      setSelectedDayData(selectedSnapshot?.data ?? null);
      setWeeklyReview(reviewResult);
      setHabits(habitsResult);
      setSelectedReviewChangeIds([]);
      setOnboardingNeeded(!anyData);
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to load dashboard" });
      setWeekSnapshots([]);
      setSelectedDayData(null);
      setWeeklyReview(null);
      setHabits([]);
    } finally {
      setLoading(false);
    }
  }, [runAuthed, selectedDate, weekDates, weekStart]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const goal = selectedDayData?.goal ?? weekSnapshots.find((d) => d.data)?.data?.goal ?? null;

  const visibleHabits = useMemo<VisibleHabit[]>(() => {
    return habits
      .map((habit) => ({
        id: habit.id,
        title: habit.title,
        difficulty: habit.difficulty_1_to_10,
        start: habit.default_time_window.start_local,
        end: habit.default_time_window.end_local,
        active: habit.active
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [habits]);

  const habitTitleById = useMemo(
    () => new Map(visibleHabits.map((h) => [h.id, h.title] as const)),
    [visibleHabits]
  );

  const weeklyAnalytics = useMemo(() => {
    if (weeklyReview?.completion_stats?.length) {
      return weeklyReview.completion_stats.map((s) => ({
        habit_id: s.habit_id,
        title: s.title,
        completion_rate: s.completion_rate,
        done_count: s.done_count,
        target_count: s.target_count,
        recommendation: s.recommendation
      }));
    }

    const byHabit = new Map<string, { title: string; done: number; target: number }>();
    for (const snap of weekSnapshots) {
      for (const habit of snap.data?.habits_today ?? []) {
        const current = byHabit.get(habit.habit_id) ?? { title: habit.title, done: 0, target: 0 };
        current.target += 1;
        if (habit.status === "done") current.done += 1;
        byHabit.set(habit.habit_id, current);
      }
    }
    return [...byHabit.entries()].map(([habit_id, v]) => ({
      habit_id,
      title: v.title,
      completion_rate: v.target ? v.done / v.target : 0,
      done_count: v.done,
      target_count: v.target,
      recommendation: "keep" as const
    }));
  }, [weekSnapshots, weeklyReview?.completion_stats]);

  const weekSummary = useMemo(() => {
    let total = 0;
    let done = 0;
    let pending = 0;
    for (const snap of weekSnapshots) {
      for (const habit of snap.data?.habits_today ?? []) {
        total += 1;
        if (habit.status === "done") done += 1;
        if (habit.status === "pending") pending += 1;
      }
    }
    const completionRate = total ? done / total : 0;
    return { total, done, pending, completionRate };
  }, [weekSnapshots]);

  async function logHabit(habitId: string, status: HabitLogStatus) {
    setBusy(`log:${habitId}:${status}`);
    setToast(null);
    try {
      await runAuthed((token) =>
        api.createHabitLog(
          {
            habit_id: habitId,
            date_local: selectedDate,
            status,
            source: "manual"
          },
          token
        )
      );
      setToast({ type: "success", message: `Logged ${status}` });
      await loadDashboard();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to log habit" });
    } finally {
      setBusy(null);
    }
  }

  async function createHabit() {
    if (!goal) {
      setToast({ type: "error", message: "Complete onboarding first." });
      return;
    }
    setBusy("createHabit");
    setToast(null);
    try {
      const habit = await runAuthed((token) =>
        api.createHabit(
          {
            goal_id: goal.id,
            title: createHabitForm.title,
            frequency: { cadence: createHabitForm.cadence },
            measurement: {
              type: createHabitForm.measurementType,
              target_value: Number(createHabitForm.targetValue),
              unit: createHabitForm.unit
            },
            difficulty_1_to_10: Number(createHabitForm.difficulty),
            default_time_window: {
              start_local: createHabitForm.start,
              end_local: createHabitForm.end
            },
            active: true
          },
          token
        )
      );
      setCreateHabitForm((prev) => ({ ...prev, title: "" }));
      setToast({ type: "success", message: `Habit created: ${habit.title}` });
      await loadDashboard();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to create habit" });
    } finally {
      setBusy(null);
    }
  }

  function selectHabitForEdit(habitId: string) {
    const habit = visibleHabits.find((h) => h.id === habitId);
    setPatchHabitForm({
      habitId,
      title: habit?.title ?? "",
      difficulty: habit ? String(habit.difficulty) : "",
      start: habit?.start ?? "",
      end: habit?.end ?? "",
      active: "true"
    });
  }

  async function patchHabit() {
    if (!patchHabitForm.habitId) return;
    const patch: Record<string, unknown> = {};
    if (patchHabitForm.title.trim()) patch.title = patchHabitForm.title.trim();
    if (patchHabitForm.difficulty) patch.difficulty_1_to_10 = Number(patchHabitForm.difficulty);
    if (patchHabitForm.start && patchHabitForm.end) {
      patch.default_time_window = {
        start_local: patchHabitForm.start,
        end_local: patchHabitForm.end
      };
    }
    patch.active = patchHabitForm.active === "true";

    setBusy("patchHabit");
    setToast(null);
    try {
      const updated = await runAuthed((token) => api.patchHabit(patchHabitForm.habitId, patch, token));
      setToast({ type: "success", message: `Habit updated: ${updated.title}` });
      await loadDashboard();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to update habit" });
    } finally {
      setBusy(null);
    }
  }

  async function submitReviewDecision(decision: "approve" | "reject") {
    if (!weeklyReview) return;
    setBusy(`review:${decision}`);
    setToast(null);
    try {
      const result = await runAuthed((token) =>
        api.approveWeeklyReview(
          weekStart,
          {
            decision,
            selected_change_ids:
              decision === "approve" && selectedReviewChangeIds.length > 0 ? selectedReviewChangeIds : undefined
          },
          token
        )
      );
      setToast({
        type: "success",
        message: `${decision} submitted (${result.applied_changes_count} changes applied)`
      });
      await loadDashboard();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to submit weekly review" });
    } finally {
      setBusy(null);
    }
  }

  const selectedDaySummary = useMemo(() => {
    if (!selectedDayData) return null;
    const total = selectedDayData.habits_today.length;
    const done = selectedDayData.habits_today.filter((h) => h.status === "done").length;
    const pending = selectedDayData.habits_today.filter((h) => h.status === "pending").length;
    return { total, done, pending };
  }, [selectedDayData]);

  if (onboardingNeeded && !loading) {
    return (
      <ProtectedPage
        title="Dashboard"
        subtitle="No active plan found yet. Onboarding is a one-time setup for new users."
      >
        <section className="panel card">
          <h2>Finish onboarding once</h2>
          <p className="muted">
            We couldn't find an active goal/habit plan in your data store yet. Run the onboarding flow once, then you
            will come straight back here on future logins.
          </p>
          <div className="row gap wrap" style={{ marginTop: 12 }}>
            <Link className="btn btn-primary" href="/onboarding">
              Start onboarding
            </Link>
            <Link className="btn btn-soft" href="/chat">
              Open chat anyway
            </Link>
          </div>
        </section>
      </ProtectedPage>
    );
  }

  return (
    <ProtectedPage
      title="Dashboard"
      subtitle="Main analytics page: weekly calendar + checklist, completion rates, weekly review, and habit plan edits in one place."
    >
      <div className="grid">
        <section className="panel card">
          <div className="row spread wrap gap">
            <div>
              <h2 style={{ marginBottom: 6 }}>Weekly overview</h2>
              <p className="muted compact">
                Week of {prettyDate(weekStart)} • Selected day {prettyDate(selectedDate)}
              </p>
            </div>
            <div className="row gap-sm wrap">
              <button className="btn btn-soft" type="button" onClick={() => setSelectedDate(addDays(weekStart, -7))}>
                Previous week
              </button>
              <button className="btn btn-soft" type="button" onClick={() => setSelectedDate(todayIsoDate())}>
                This week
              </button>
              <button className="btn btn-soft" type="button" onClick={() => setSelectedDate(addDays(weekStart, 7))}>
                Next week
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void loadDashboard()} disabled={loading}>
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>

          {toast ? <div className={`toast ${toast.type}`} style={{ marginTop: 10 }}>{toast.message}</div> : null}

          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <div className="kpi">
              <div className="kpi-value">{Math.round(weekSummary.completionRate * 100)}%</div>
              <div className="kpi-label">Weekly completion rate</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">{weekSummary.done}</div>
              <div className="kpi-label">Done this week</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">{weekSummary.pending}</div>
              <div className="kpi-label">Pending instances</div>
            </div>
          </div>
        </section>

        <section className="panel card">
          <div className="row spread wrap gap">
            <h2 style={{ marginBottom: 0 }}>Calendar + checklist view</h2>
            <span className="muted compact">Click a day to inspect and log habits</span>
          </div>

          <div className="week-calendar-grid" style={{ marginTop: 10 }}>
            {weekSnapshots.map((snap) => {
              const total = snap.data?.habits_today.length ?? 0;
              const done = snap.data?.habits_today.filter((h) => h.status === "done").length ?? 0;
              const selected = snap.date === selectedDate;
              const dayLabel = new Date(`${snap.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
              return (
                <button
                  key={snap.date}
                  type="button"
                  className={`week-day-card ${selected ? "selected" : ""}`}
                  onClick={() => setSelectedDate(snap.date)}
                >
                  <div className="week-day-header">
                    <span>{dayLabel}</span>
                    <strong>{new Date(`${snap.date}T00:00:00`).getDate()}</strong>
                  </div>
                  <div className="week-day-sub muted compact">
                    {snap.data ? `${done}/${total} done` : "No plan"}
                  </div>
                  <div className="week-mini-list">
                    {(snap.data?.habits_today ?? []).slice(0, 4).map((habit) => (
                      <div key={habit.habit_id} className="week-mini-item">
                        <span className={`mini-dot ${habit.status}`} />
                        <span>{habit.title}</span>
                      </div>
                    ))}
                    {(snap.data?.habits_today.length ?? 0) > 4 ? (
                      <div className="week-mini-item muted compact">
                        +{(snap.data?.habits_today.length ?? 0) - 4} more
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="grid grid-2">
          <section className="panel card">
            <h2>Selected day checklist</h2>
            {selectedDayData ? (
              <>
                <div className="data-row">
                  <strong>{selectedDayData.goal.statement}</strong>
                  <p className="muted">{selectedDayData.goal.motivation}</p>
                  {selectedDaySummary ? (
                    <div className="row gap wrap">
                      <span className="badge">{selectedDaySummary.done}/{selectedDaySummary.total} done</span>
                      <span className="badge pending">{selectedDaySummary.pending} pending</span>
                      {selectedDayData.weekly_focus ? <span className="badge">{selectedDayData.weekly_focus}</span> : null}
                    </div>
                  ) : null}
                </div>

                {selectedDayData.habits_today.length === 0 ? (
                  <div className="empty-state" style={{ marginTop: 10 }}>
                    No habits scheduled for this day.
                  </div>
                ) : (
                  <div className="data-list" style={{ marginTop: 10 }}>
                    {selectedDayData.habits_today.map((habit) => (
                      <div key={habit.habit_id} className="data-row">
                        <div className="row spread wrap gap">
                          <div>
                            <strong>{habit.title}</strong>
                            <div className="muted compact">
                              {habit.target_window.start_local}-{habit.target_window.end_local} • difficulty{" "}
                              {habit.difficulty_1_to_10}
                            </div>
                          </div>
                          <span className={`badge ${habit.status}`}>{habit.status}</span>
                        </div>
                        <div className="row gap-sm wrap">
                          {quickStatuses.map((status) => {
                            const actionKey = `log:${habit.habit_id}:${status}`;
                            const isBusy = busy === actionKey;
                            return (
                              <button
                                key={status}
                                className={status === "done" ? "btn btn-primary" : "btn btn-soft"}
                                type="button"
                                onClick={() => void logHabit(habit.habit_id, status)}
                                disabled={Boolean(busy)}
                              >
                                {isBusy ? "Saving..." : status}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="divider" />
                <h3>Commitments + call memory</h3>
                {selectedDayData.commitments.length > 0 ? (
                  <div className="data-list">
                    {selectedDayData.commitments.map((c) => (
                      <div key={c.id} className="data-row">
                        <div className="row spread wrap gap-sm">
                          <strong>{c.text}</strong>
                          <span className={`badge ${c.status === "completed" ? "done" : "pending"}`}>{c.status}</span>
                        </div>
                        <div className="muted compact">Due {c.due_date_local}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No commitments on this day.</div>
                )}
                {selectedDayData.last_call_recap ? (
                  <div className="data-row" style={{ marginTop: 10 }}>
                    <strong>Last call recap</strong>
                    <p className="muted">{selectedDayData.last_call_recap}</p>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state">
                {loading ? "Loading selected day..." : "No data for selected day"}
              </div>
            )}
          </section>

          <section className="panel card">
            <div className="row spread wrap gap">
              <h2 style={{ marginBottom: 0 }}>Analytics (completion rates)</h2>
              <span className="muted compact">Pulled from weekly review when available</span>
            </div>

            {weeklyAnalytics.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 10 }}>No weekly analytics yet.</div>
            ) : (
              <div className="data-list" style={{ marginTop: 10 }}>
                {weeklyAnalytics.map((stat) => (
                  <div key={stat.habit_id} className="data-row">
                    <div className="row spread wrap gap-sm">
                      <strong>{stat.title}</strong>
                      <span className="badge">{Math.round(stat.completion_rate * 100)}%</span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.max(4, Math.round(stat.completion_rate * 100))}%` }}
                      />
                    </div>
                    <div className="muted compact">
                      {stat.done_count}/{stat.target_count} completed • {stat.recommendation}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {weeklyReview ? (
              <>
                <div className="divider" />
                <h3>Weekly review / check-in</h3>
                <div className="data-row">
                  <div className="row spread wrap gap-sm">
                    <span className="badge">{weeklyReview.status}</span>
                    <span className="muted compact">Week of {prettyDate(weeklyReview.week_start_date)}</span>
                  </div>
                  {weeklyReview.summary ? <p className="muted">{weeklyReview.summary}</p> : null}
                  <p className="muted compact">Focus: {weeklyReview.week_focus}</p>
                </div>

                <div className="grid grid-2" style={{ marginTop: 10 }}>
                  <div>
                    <h3>Wins</h3>
                    {weeklyReview.wins.length ? (
                      <div className="data-list">{weeklyReview.wins.map((x, i) => <div key={`w-${i}`} className="data-row">{x}</div>)}</div>
                    ) : <div className="empty-state">No wins listed.</div>}
                  </div>
                  <div>
                    <h3>Blockers</h3>
                    {weeklyReview.blockers.length ? (
                      <div className="data-list">{weeklyReview.blockers.map((x, i) => <div key={`b-${i}`} className="data-row">{x}</div>)}</div>
                    ) : <div className="empty-state">No blockers listed.</div>}
                  </div>
                </div>

                {(weeklyReview.pending_plan_changes?.length ?? 0) > 0 ? (
                  <>
                    <div className="divider" />
                    <h3>Pending plan changes</h3>
                    <div className="data-list">
                      {weeklyReview.pending_plan_changes!.map((change, index) => {
                        const id = extractChangeId(change);
                        const friendly = describePendingChange(change, habitTitleById);
                        return (
                          <div key={id ?? `change-${index}`} className="data-row">
                            <div className="row spread wrap gap-sm">
                              <strong>{friendly.title || `Change ${index + 1}`}</strong>
                              {id ? <span className="badge mono">{id}</span> : <span className="badge">No ID</span>}
                            </div>
                            <div className="stack" style={{ gap: 6 }}>
                              {friendly.lines.map((line, i) => (
                                <div key={`${id ?? index}-line-${i}`} className="muted compact">
                                  {line}
                                </div>
                              ))}
                            </div>
                            {id ? (
                              <label className="row gap-sm compact">
                                <input
                                  type="checkbox"
                                  checked={selectedReviewChangeIds.includes(id)}
                                  onChange={(e) =>
                                    setSelectedReviewChangeIds((prev) =>
                                      e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)
                                    )
                                  }
                                />
                                Select for partial apply
                              </label>
                            ) : null}
                            <details>
                              <summary className="muted compact" style={{ cursor: "pointer" }}>
                                Technical payload
                              </summary>
                              <pre className="code-block" style={{ marginTop: 8 }}>
                                {JSON.stringify(change, null, 2)}
                              </pre>
                            </details>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : null}

                <div className="row gap wrap" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={busy !== null || weeklyReview.status !== "pending_approval"}
                    onClick={() => void submitReviewDecision("approve")}
                  >
                    {busy === "review:approve" ? "Approving..." : "Approve review"}
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={busy !== null || weeklyReview.status !== "pending_approval"}
                    onClick={() => void submitReviewDecision("reject")}
                  >
                    {busy === "review:reject" ? "Rejecting..." : "Reject review"}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state" style={{ marginTop: 10 }}>
                No weekly review generated yet. The worker creates this; refresh later to pull it in.
              </div>
            )}
          </section>
        </div>

        <section className="panel card">
          <div className="row spread wrap gap">
            <h2 style={{ marginBottom: 0 }}>Habit plan (integrated)</h2>
            <span className="muted compact">Editing your saved habit plan from the datastore.</span>
          </div>

          <div className="grid grid-2" style={{ marginTop: 10 }}>
            <div className="card">
              <h3>Create habit</h3>
              <div className="stack">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Title</label>
                  <input
                    value={createHabitForm.title}
                    onChange={(e) => setCreateHabitForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Daily planning check-in"
                  />
                </div>
                <div className="inline-fields">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Frequency</label>
                    <select
                      value={createHabitForm.cadence}
                      onChange={(e) => setCreateHabitForm((p) => ({ ...p, cadence: e.target.value }))}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekdays">Weekdays</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Difficulty</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={createHabitForm.difficulty}
                      onChange={(e) => setCreateHabitForm((p) => ({ ...p, difficulty: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="inline-fields">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Measurement</label>
                    <select
                      value={createHabitForm.measurementType}
                      onChange={(e) => setCreateHabitForm((p) => ({ ...p, measurementType: e.target.value }))}
                    >
                      <option value="boolean">Yes / No</option>
                      <option value="count">Count</option>
                      <option value="duration_minutes">Duration</option>
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Target value</label>
                    <input
                      type="number"
                      min={0}
                      value={createHabitForm.targetValue}
                      onChange={(e) => setCreateHabitForm((p) => ({ ...p, targetValue: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="inline-fields">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Unit</label>
                    <input
                      value={createHabitForm.unit}
                      onChange={(e) => setCreateHabitForm((p) => ({ ...p, unit: e.target.value }))}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Time window</label>
                    <div className="time-range-inline">
                      <input
                        type="time"
                        value={createHabitForm.start}
                        onChange={(e) => setCreateHabitForm((p) => ({ ...p, start: e.target.value }))}
                      />
                      <span className="muted">to</span>
                      <input
                        type="time"
                        value={createHabitForm.end}
                        onChange={(e) => setCreateHabitForm((p) => ({ ...p, end: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void createHabit()}
                  disabled={busy === "createHabit" || !goal || !createHabitForm.title.trim()}
                >
                  {busy === "createHabit" ? "Creating..." : "Create habit"}
                </button>
              </div>
            </div>

            <div className="card">
              <h3>Edit visible habit</h3>
              <div className="stack">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Pick habit</label>
                  <select value={patchHabitForm.habitId} onChange={(e) => selectHabitForEdit(e.target.value)}>
                    <option value="">Select habit</option>
                    {visibleHabits.map((habit) => (
                      <option key={habit.id} value={habit.id}>
                        {habit.title} ({habit.id.slice(0, 8)}){habit.active ? "" : " [inactive]"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Title</label>
                  <input
                    value={patchHabitForm.title}
                    onChange={(e) => setPatchHabitForm((p) => ({ ...p, title: e.target.value }))}
                  />
                </div>
                <div className="inline-fields">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Difficulty</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={patchHabitForm.difficulty}
                      onChange={(e) => setPatchHabitForm((p) => ({ ...p, difficulty: e.target.value }))}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Active</label>
                    <select
                      value={patchHabitForm.active}
                      onChange={(e) => setPatchHabitForm((p) => ({ ...p, active: e.target.value }))}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
                <div className="inline-fields">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Start</label>
                    <input
                      type="time"
                      value={patchHabitForm.start}
                      onChange={(e) => setPatchHabitForm((p) => ({ ...p, start: e.target.value }))}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>End</label>
                    <input
                      type="time"
                      value={patchHabitForm.end}
                      onChange={(e) => setPatchHabitForm((p) => ({ ...p, end: e.target.value }))}
                    />
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void patchHabit()}
                  disabled={busy === "patchHabit" || !patchHabitForm.habitId}
                >
                  {busy === "patchHabit" ? "Updating..." : "Update habit"}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </ProtectedPage>
  );
}
