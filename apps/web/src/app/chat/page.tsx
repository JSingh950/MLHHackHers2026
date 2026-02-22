"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { DashboardTodayResponse, Habit, HabitLogStatus, WeeklyReview } from "@goalcoach/shared";
import { ApiError, api, UI_ONLY_MODE } from "../../lib/api";
import { AppShell } from "../../components/app-shell";
import { useAuth } from "../../components/auth-provider";
import { RequireAuth } from "../../components/require-auth";
import { prettyDate, toWeekStart, todayIsoDate } from "../../lib/date";

type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

const suggestionPrompts = [
  "Plan my day",
  "Review my week",
  "Adjust habits",
  "I fell behind"
];

const quickLogStatuses: HabitLogStatus[] = ["done", "partial", "missed"];

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function extractHabitReference(message: string, habits: Habit[]): Habit | null {
  const lower = message.toLowerCase();
  return habits.find((habit) => lower.includes(habit.title.toLowerCase())) ?? null;
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderInlineWithHabitChips(text: string, habits: Habit[]): ReactNode {
  const titles = habits
    .map((h) => h.title)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);

  if (titles.length === 0) return text;

  const pattern = new RegExp(`(${titles.map(escapeRegex).join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts.map((part, idx) => {
    const matched = titles.find((t) => t.toLowerCase() === part.toLowerCase());
    if (matched) {
      return (
        <span key={`${part}-${idx}`} className="coach-inline-chip">
          {part}
        </span>
      );
    }
    return <Fragment key={`${part}-${idx}`}>{part}</Fragment>;
  });
}

function renderRichMessage(content: string, habits: Habit[]): ReactNode {
  const segments = content.split(/```/g);

  return (
    <div className="coach-rich">
      {segments.map((segment, segmentIndex) => {
        const isCode = segmentIndex % 2 === 1;
        if (isCode) {
          return (
            <pre key={`code-${segmentIndex}`} className="coach-code-block">
              <code>{segment.trim()}</code>
            </pre>
          );
        }

        const blocks = segment
          .split(/\n\s*\n/)
          .map((b) => b.trim())
          .filter(Boolean);

        return blocks.map((block, blockIndex) => {
          const lines = block.split("\n").map((l) => l.trimEnd());

          if (lines.every((l) => /^[-*]\s+/.test(l))) {
            return (
              <ul key={`ul-${segmentIndex}-${blockIndex}`} className="coach-list">
                {lines.map((line, i) => (
                  <li key={`li-${i}`}>{renderInlineWithHabitChips(line.replace(/^[-*]\s+/, ""), habits)}</li>
                ))}
              </ul>
            );
          }

          if (lines.every((l) => /^\d+\.\s+/.test(l))) {
            return (
              <ol key={`ol-${segmentIndex}-${blockIndex}`} className="coach-list coach-list-ordered">
                {lines.map((line, i) => (
                  <li key={`oli-${i}`}>{renderInlineWithHabitChips(line.replace(/^\d+\.\s+/, ""), habits)}</li>
                ))}
              </ol>
            );
          }

          if (/^#{1,3}\s+/.test(lines[0] ?? "")) {
            const heading = (lines[0] ?? "").replace(/^#{1,3}\s+/, "");
            const rest = lines.slice(1).join("\n").trim();
            return (
              <div key={`h-${segmentIndex}-${blockIndex}`} className="coach-text-block">
                <h4>{renderInlineWithHabitChips(heading, habits)}</h4>
                {rest ? <p>{renderInlineWithHabitChips(rest, habits)}</p> : null}
              </div>
            );
          }

          return (
            <p key={`p-${segmentIndex}-${blockIndex}`} className="coach-paragraph">
              {lines.map((line, i) => (
                <Fragment key={`line-${i}`}>
                  {renderInlineWithHabitChips(line, habits)}
                  {i < lines.length - 1 ? <br /> : null}
                </Fragment>
              ))}
            </p>
          );
        });
      })}
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const { session, runAuthed } = useAuth();
  const [hydrated, setHydrated] = useState(false);
  const [threadId, setThreadId] = useState<string>("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<Record<string, unknown> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const [todayContext, setTodayContext] = useState<DashboardTodayResponse | null>(null);
  const [weeklyReview, setWeeklyReview] = useState<WeeklyReview | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const storageKeys = useMemo(() => {
    const userId = session?.user.id ?? "anon";
    return {
      thread: `goalcoach.chat.thread.${userId}`,
      messages: `goalcoach.chat.messages.${userId}`
    };
  }, [session?.user.id]);

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const storedThread = readJson<string | null>(storageKeys.thread, null) ?? makeId();
    const storedMessages = readJson<LocalMessage[]>(storageKeys.messages, []);
    setThreadId(storedThread);
    setMessages(storedMessages);
    writeJson(storageKeys.thread, storedThread);
    setHydrated(true);
  }, [session, storageKeys]);

  useEffect(() => {
    if (!hydrated) return;
    writeJson(storageKeys.messages, messages);
  }, [hydrated, messages, storageKeys.messages]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const nextHeight = Math.min(el.scrollHeight, 180);
    el.style.height = `${Math.max(nextHeight, 54)}px`;
  }, [input]);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  const loadContext = useCallback(async () => {
    setLoadingContext(true);
    try {
      const today = todayIsoDate();
      const weekStart = toWeekStart(today);
      const [dash, review, habitsList] = await Promise.all([
        runAuthed((token) => api.getDashboardToday(token, today)).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
        runAuthed((token) => api.getWeeklyReview(weekStart, token)).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
        runAuthed((token) => api.getHabits(token, { include_inactive: false })).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return [] as Habit[];
          throw err;
        })
      ]);
      setTodayContext(dash);
      setWeeklyReview(review);
      setHabits(habitsList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat context");
    } finally {
      setLoadingContext(false);
    }
  }, [runAuthed]);

  useEffect(() => {
    if (!session) return;
    void loadContext();
  }, [loadContext, session]);

  async function sendMessage(text: string) {
    if (!threadId || !text.trim()) return;
    const userMessage: LocalMessage = {
      id: makeId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const response = await runAuthed((token) =>
        api.sendChat(
          {
            thread_id: threadId,
            message: text,
            client_message_id: userMessage.id
          },
          token
        )
      );

      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content: response.assistant_message,
          createdAt: response.created_at
        }
      ]);

      setLastMeta({
        thread_id: response.thread_id,
        created_at: response.created_at,
        actions_executed: response.actions_executed ?? [],
        memory_snapshot_version: response.memory_snapshot_version ?? null
      });

      void loadContext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t send. Retry.");
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    await sendMessage(text);
  }

  function resetThread() {
    const nextThreadId = makeId();
    setThreadId(nextThreadId);
    setMessages([]);
    setLastMeta(null);
    setError(null);
    writeJson(storageKeys.thread, nextThreadId);
    writeJson(storageKeys.messages, []);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function quickLogHabit(habitId: string, status: HabitLogStatus) {
    try {
      setError(null);
      await runAuthed((token) =>
        api.createHabitLog({ habit_id: habitId, date_local: todayIsoDate(), status, source: "manual" }, token)
      );
      await loadContext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log habit");
    }
  }

  const suggestedPrompts = useMemo(() => {
    const goalText = todayContext?.goal.statement ?? "my goal";
    return [
      `Plan my day around ${goalText}`,
      "Review my week",
      "Adjust habits",
      "I fell behind"
    ];
  }, [todayContext?.goal.statement]);

  const recentUserMessages = useMemo(() => {
    const seen = new Set<string>();
    return messages
      .filter((m) => m.role === "user")
      .slice()
      .reverse()
      .filter((m) => {
        const key = m.content.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);
  }, [messages]);

  const weekCompletionRate = useMemo(() => {
    if (!weeklyReview?.completion_stats?.length) return null;
    const totalTarget = weeklyReview.completion_stats.reduce((sum, s) => sum + s.target_count, 0);
    const totalDone = weeklyReview.completion_stats.reduce((sum, s) => sum + s.done_count, 0);
    return totalTarget > 0 ? totalDone / totalTarget : 0;
  }, [weeklyReview]);

  const userInitials = useMemo(() => {
    const name = session?.user.name ?? "You";
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
  }, [session?.user.name]);

  const headerRight = (
    <div className="coach-header-actions">
      <div className="status-group">
        <div className={`status-dot ${isOnline ? "ok" : "warn"}`} />
        <span className="muted compact">{isOnline ? "Synced" : "Offline"}</span>
      </div>
      <button
        className="btn btn-soft"
        type="button"
        onClick={() => {
          setInput((prev) => (prev ? prev : "Let's do a quick check-in for today."));
          textareaRef.current?.focus();
        }}
      >
        Today
      </button>
      <button className="btn btn-soft" type="button" onClick={() => setHistoryOpen(true)}>
        History
      </button>
      <button className="btn btn-soft" type="button" onClick={resetThread}>
        New chat
      </button>
      <button className="btn btn-primary" type="button" onClick={() => void loadContext()} disabled={loadingContext}>
        {loadingContext ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );

  const topSuggestedPrompts = messages.length === 0 ? suggestedPrompts : suggestionPrompts;

  return (
    <RequireAuth>
      <AppShell
        title="Chat Coach"
        subtitle="Daily coaching + context from habits and check-ins."
        headerRight={headerRight}
      >
        <div className="coach-layout">
          <div className="coach-context-mobile">
            <details className="panel card">
              <summary className="coach-context-summary">Context</summary>
              <div className="coach-context-stack">
                <ContextCards
                  todayContext={todayContext}
                  weeklyReview={weeklyReview}
                  weekCompletionRate={weekCompletionRate}
                  onLogHabit={quickLogHabit}
                />
              </div>
            </details>
          </div>

          <section className="panel card coach-chat-main">
            <div className="coach-chat-frame">
              <div className="coach-timeline" ref={timelineRef}>
                <div className="coach-system-card">
                  <div className="coach-system-title">Current coaching context</div>
                  <div className="coach-system-grid">
                    <div>
                      <div className="muted tiny">Goal</div>
                      <div className="coach-system-value">
                        {todayContext?.goal.statement ?? "No active goal yet"}
                      </div>
                    </div>
                    <div>
                      <div className="muted tiny">Current focus</div>
                      <div className="coach-system-value">
                        {todayContext?.weekly_focus ?? weeklyReview?.week_focus ?? "Protect one important action today."}
                      </div>
                    </div>
                  </div>
                </div>

                {topSuggestedPrompts.length > 0 ? (
                  <div className="coach-prompt-row">
                    {topSuggestedPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="coach-prompt-chip"
                        onClick={() => {
                          setInput(prompt);
                          textareaRef.current?.focus();
                        }}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : null}

                {messages.length === 0 ? (
                  <div className="coach-empty">
                    <div className="coach-empty-orb" aria-hidden="true" />
                    <h2>Start a check-in</h2>
                    <p>I’ll use your habit plan + weekly tracker to coach you.</p>
                  </div>
                ) : (
                  <div className="coach-message-list" role="log" aria-live="polite">
                    {messages.map((message, index) => {
                      const referencedHabit = message.role === "assistant" ? extractHabitReference(message.content, habits) : null;
                      const isLatestAssistant = message.role === "assistant" && index === messages.length - 1;

                      return (
                        <div key={message.id} className={`coach-message-row ${message.role}`}>
                          <div className="coach-avatar">{message.role === "assistant" ? "GC" : userInitials}</div>
                          <div className="coach-message-stack">
                            <div className="coach-message-meta">
                              <span>{message.role === "assistant" ? "Coach" : "You"}</span>
                              <span>•</span>
                              <span>{timeLabel(message.createdAt)}</span>
                            </div>
                            <div className={`coach-message-surface ${message.role} ${isLatestAssistant ? "appear" : ""}`}>
                              {renderRichMessage(message.content, habits)}
                            </div>
                            <div className="coach-message-actions">
                              <button
                                type="button"
                                className="coach-mini-action"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(message.content);
                                  } catch {
                                    setError("Couldn’t copy message.");
                                  }
                                }}
                              >
                                Copy
                              </button>
                              <button type="button" className="coach-mini-action">👍</button>
                              <button type="button" className="coach-mini-action">👎</button>
                              <button type="button" className="coach-mini-action">Save</button>
                            </div>

                            {referencedHabit ? (
                              <div className="coach-action-card">
                                <div>
                                  <div className="tiny muted">Action card</div>
                                  <strong>{referencedHabit.title}</strong>
                                  <div className="muted compact">
                                    {referencedHabit.default_time_window.start_local}-{referencedHabit.default_time_window.end_local}
                                  </div>
                                </div>
                                <div className="row gap-sm wrap">
                                  <button
                                    type="button"
                                    className="btn btn-soft"
                                    onClick={() => void quickLogHabit(referencedHabit.id, "done")}
                                  >
                                    Mark done
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-soft"
                                    onClick={() => setInput(`Help me reschedule ${referencedHabit.title} for today.`)}
                                  >
                                    Reschedule
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-soft"
                                    onClick={() => router.push("/dashboard")}
                                  >
                                    Edit habit
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    {sending ? (
                      <div className="coach-message-row assistant">
                        <div className="coach-avatar">GC</div>
                        <div className="coach-message-stack">
                          <div className="coach-message-meta">
                            <span>Coach</span>
                            <span>•</span>
                            <span>typing</span>
                          </div>
                          <div className="coach-typing-pill" aria-label="Typing">
                            <span />
                            <span />
                            <span />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <form className="coach-composer" onSubmit={onSubmit}>
                <div className="coach-composer-controls">
                  <button type="button" className="coach-icon-btn" aria-label="Voice">
                    🎙️
                  </button>
                  <button type="button" className="coach-icon-btn" aria-label="Attach">
                    📎
                  </button>
                  <button
                    type="button"
                    className="coach-icon-btn"
                    aria-label="Log habit"
                    onClick={() => setInput("I completed a habit. Help me log it and plan the next step.")}
                  >
                    ✅
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  className="coach-composer-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={1}
                  placeholder="Message your coach…"
                />
                <button className="btn btn-primary coach-send-btn" type="submit" disabled={sending || !input.trim()}>
                  Send
                </button>
              </form>

              {error ? (
                <div className="coach-inline-error">Couldn’t send. Retry. {error}</div>
              ) : null}
            </div>
          </section>

          <aside className="coach-context-rail">
            <ContextCards
              todayContext={todayContext}
              weeklyReview={weeklyReview}
              weekCompletionRate={weekCompletionRate}
              onLogHabit={quickLogHabit}
            />
          </aside>
        </div>

        {historyOpen ? (
          <div className="coach-history-drawer-backdrop" onClick={() => setHistoryOpen(false)}>
            <div className="coach-history-drawer panel card" onClick={(e) => e.stopPropagation()}>
              <div className="row spread wrap gap">
                <h3 style={{ marginBottom: 0 }}>Chat history</h3>
                <button className="btn btn-soft" type="button" onClick={() => setHistoryOpen(false)}>
                  Close
                </button>
              </div>
              <div className="data-row">
                <div className="muted compact">Thread ID</div>
                <div className="mono">{threadId || "(none)"}</div>
              </div>
              <div className="divider" />
              <p className="muted compact">Recent prompts (local session)</p>
              {recentUserMessages.length === 0 ? (
                <div className="empty-state">No previous prompts in this thread yet.</div>
              ) : (
                <div className="data-list">
                  {recentUserMessages.map((msg) => (
                    <button
                      key={msg.id}
                      type="button"
                      className="data-row coach-history-row"
                      onClick={() => {
                        setInput(msg.content);
                        setHistoryOpen(false);
                      }}
                    >
                      <strong>{msg.content}</strong>
                      <span className="muted compact">{new Date(msg.createdAt).toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </AppShell>
    </RequireAuth>
  );
}

function ContextCards({
  todayContext,
  weeklyReview,
  weekCompletionRate,
  onLogHabit
}: {
  todayContext: DashboardTodayResponse | null;
  weeklyReview: WeeklyReview | null;
  weekCompletionRate: number | null;
  onLogHabit: (habitId: string, status: HabitLogStatus) => Promise<void>;
}) {
  return (
    <>
      <section className="panel card">
        <div className="row spread wrap gap">
          <h3 style={{ marginBottom: 0 }}>Today’s habits</h3>
          <Link href="/dashboard" className="link-btn">
            View dashboard
          </Link>
        </div>
        {!todayContext ? (
          <div className="empty-state" style={{ marginTop: 10 }}>
            No context loaded yet.
          </div>
        ) : todayContext.habits_today.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 10 }}>
            No habits scheduled today.
          </div>
        ) : (
          <div className="data-list" style={{ marginTop: 10 }}>
            {todayContext.habits_today.map((habit) => (
              <div key={habit.habit_id} className="data-row">
                <div className="row spread wrap gap-sm">
                  <strong>{habit.title}</strong>
                  <span className={`badge ${habit.status}`}>{habit.status}</span>
                </div>
                <div className="muted compact">
                  {habit.target_window.start_local}-{habit.target_window.end_local}
                </div>
                <div className="row gap-sm wrap">
                  {quickLogStatuses.map((status) => (
                    <button
                      key={status}
                      className={status === "done" ? "btn btn-primary" : "btn btn-soft"}
                      type="button"
                      onClick={() => void onLogHabit(habit.habit_id, status)}
                    >
                      {status === "done" ? "Log now" : status}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel card">
        <h3>This week progress</h3>
        <div className="kpi" style={{ marginTop: 8 }}>
          <div className="kpi-value">
            {weekCompletionRate === null ? "—" : `${Math.round(weekCompletionRate * 100)}%`}
          </div>
          <div className="kpi-label">Completion rate</div>
        </div>
        <div className="progress-track" style={{ marginTop: 10 }}>
          <div
            className="progress-fill"
            style={{ width: `${Math.max(4, Math.round((weekCompletionRate ?? 0) * 100))}%` }}
          />
        </div>
        <div className="muted compact" style={{ marginTop: 8 }}>
          {weeklyReview?.week_focus ? `Focus: ${weeklyReview.week_focus}` : "Weekly review will fill in focus and recommendations."}
        </div>
        <div className="row gap wrap" style={{ marginTop: 10 }}>
          <Link className="btn btn-soft" href="/dashboard">
            View dashboard
          </Link>
          <Link className="btn btn-outline" href="/settings">
            Settings
          </Link>
        </div>
      </section>
    </>
  );
}
