"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CheckinEvent, Schedule } from "@goalcoach/shared";
import { api } from "../../lib/api";
import { ProtectedPage } from "../../components/protected-page";
import { useAuth } from "../../components/auth-provider";

function parseDaysCsv(csv: string): number[] {
  return csv
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export default function SettingsPage() {
  const { session, verifyPhone, runAuthed } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [phoneForm, setPhoneForm] = useState({
    phone_e164: session?.user.phone_e164 ?? ""
  });
  const [scheduleForm, setScheduleForm] = useState({
    type: "call" as "call" | "chat",
    days_csv: "1,2,3,4,5",
    start_local: "09:00",
    end_local: "18:00",
    cadence_kind: "weekly",
    interval: "1",
    retry_attempts: "1",
    retry_delay_minutes: "10"
  });
  const [lastScheduleResult, setLastScheduleResult] = useState<unknown>(null);
  const [savedSchedules, setSavedSchedules] = useState<Schedule[]>([]);
  const [checkinEvents, setCheckinEvents] = useState<CheckinEvent[]>([]);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [loadingManagement, setLoadingManagement] = useState(false);

  const consentSummary = useMemo(() => session?.user.consent_flags ?? null, [session?.user.consent_flags]);

  async function loadManagement() {
    setLoadingManagement(true);
    try {
      const [schedules, events] = await Promise.all([
        runAuthed((token) => api.getSchedules(token)),
        runAuthed((token) => api.getCheckinEvents(token, { type: "call", limit: 20 }))
      ]);
      setSavedSchedules(schedules);
      setCheckinEvents(events);
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to load scheduling data" });
    } finally {
      setLoadingManagement(false);
    }
  }

  useEffect(() => {
    void loadManagement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onVerifyPhone(event: FormEvent) {
    event.preventDefault();
    setBusy("verify");
    setToast(null);
    try {
      await verifyPhone({
        phone_e164: phoneForm.phone_e164
      });
      setToast({ type: "success", message: "Phone saved and marked verified." });
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Phone verification failed" });
    } finally {
      setBusy(null);
    }
  }

  async function onCreateSchedule(event: FormEvent) {
    event.preventDefault();
    setBusy("schedule");
    setToast(null);
    try {
      const windows = [
        {
          days_of_week: parseDaysCsv(scheduleForm.days_csv),
          start_local: scheduleForm.start_local,
          end_local: scheduleForm.end_local
        }
      ];
      const cadence = {
        kind: scheduleForm.cadence_kind,
        interval: Number(scheduleForm.interval)
      };
      const retry_policy =
        scheduleForm.type === "call"
          ? {
              max_attempts: Number(scheduleForm.retry_attempts),
              retry_delay_minutes: Number(scheduleForm.retry_delay_minutes)
            }
          : undefined;

      const payload = {
        type: scheduleForm.type,
        windows,
        cadence,
        retry_policy
      };
      const result = await runAuthed((token) =>
        editingScheduleId ? api.patchSchedule(editingScheduleId, payload, token) : api.createSchedule(payload, token)
      );
      setLastScheduleResult(result);
      setToast({ type: "success", message: `${scheduleForm.type} schedule ${editingScheduleId ? "updated" : "saved"}.` });
      setEditingScheduleId(null);
      await loadManagement();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to create schedule" });
    } finally {
      setBusy(null);
    }
  }

  async function onDeleteSchedule(scheduleId: string) {
    setBusy(`delete:${scheduleId}`);
    setToast(null);
    try {
      await runAuthed((token) => api.deleteSchedule(scheduleId, token));
      if (editingScheduleId === scheduleId) setEditingScheduleId(null);
      setToast({ type: "success", message: "Schedule deleted." });
      await loadManagement();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to delete schedule" });
    } finally {
      setBusy(null);
    }
  }

  function loadScheduleIntoForm(schedule: Schedule) {
    const firstWindow = (schedule.windows[0] ?? {}) as Record<string, unknown>;
    const days = Array.isArray(firstWindow.days_of_week) ? firstWindow.days_of_week : [];
    const retry = schedule.retry_policy ?? { max_attempts: 1, retry_delay_minutes: 10 };
    setEditingScheduleId(schedule.id);
    setScheduleForm({
      type: schedule.type,
      days_csv: days.map(String).join(","),
      start_local: typeof firstWindow.start_local === "string" ? firstWindow.start_local : "09:00",
      end_local: typeof firstWindow.end_local === "string" ? firstWindow.end_local : "18:00",
      cadence_kind: String((schedule.cadence as Record<string, unknown>).kind ?? "weekly"),
      interval: String((schedule.cadence as Record<string, unknown>).interval ?? 1),
      retry_attempts: String(retry.max_attempts ?? 1),
      retry_delay_minutes: String(retry.retry_delay_minutes ?? 10)
    });
  }

  async function onTriggerCallNow() {
    setBusy("triggerCallNow");
    setToast(null);
    try {
      const event = await runAuthed((token) => api.triggerManualCheckin({ type: "call" }, token));
      setToast({ type: "success", message: `Call queued for ${new Date(event.scheduled_at_utc).toLocaleTimeString()}` });
      await loadManagement();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to queue call" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <ProtectedPage
      title="Settings & Scheduling"
      subtitle="Profile, call phone setup, schedule management, and manual call triggers."
    >
      <div className="grid">
        {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}

        <div className="grid grid-2">
          <section className="panel card">
            <h2>Account profile</h2>
            <div className="data-list">
              <div className="data-row">
                <div className="muted compact">Name</div>
                <strong>{session?.user.name}</strong>
              </div>
              <div className="data-row">
                <div className="muted compact">Email</div>
                <strong>{session?.user.email}</strong>
              </div>
              <div className="data-row">
                <div className="muted compact">Timezone</div>
                <strong>{session?.user.timezone}</strong>
              </div>
              <div className="data-row">
                <div className="muted compact">Phone</div>
                <strong>{session?.user.phone_e164 ?? "Not set"}</strong>
                <div className="row gap-sm" style={{ marginTop: 6 }}>
                  <span className={`badge ${session?.user.phone_verified ? "done" : "pending"}`}>
                    {session?.user.phone_verified ? "Verified" : "Unverified"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel card">
            <h2>Consent flags</h2>
            {!consentSummary ? (
              <div className="empty-state">No consent info in session.</div>
            ) : (
              <div className="data-list">
                <div className="data-row row spread"><span>Calls</span><span className={`badge ${consentSummary.calls_opt_in ? "done" : "missed"}`}>{String(consentSummary.calls_opt_in)}</span></div>
                <div className="data-row row spread"><span>Transcription</span><span className={`badge ${consentSummary.transcription_opt_in ? "done" : "missed"}`}>{String(consentSummary.transcription_opt_in)}</span></div>
                <div className="data-row row spread"><span>Storage</span><span className={`badge ${consentSummary.storage_opt_in ? "done" : "missed"}`}>{String(consentSummary.storage_opt_in)}</span></div>
              </div>
            )}
            <p className="muted tiny" style={{ marginBottom: 0 }}>
              Current web contract exposes consent values in auth session payloads but does not include a user settings update endpoint yet.
            </p>
          </section>
        </div>

        <div className="grid grid-2">
          <section className="panel card">
            <h2>Phone for calls</h2>
            <p className="muted compact">
              Save the phone number to use for calls. OTP verification is temporarily disabled in this build.
            </p>
            <form onSubmit={onVerifyPhone} className="stack">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="phone-e164">Phone (E.164)</label>
                <input
                  id="phone-e164"
                  value={phoneForm.phone_e164}
                  onChange={(e) => setPhoneForm({ ...phoneForm, phone_e164: e.target.value })}
                  placeholder="+19085551234"
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy === "verify"}>
                {busy === "verify" ? "Saving..." : "Save phone"}
              </button>
            </form>
          </section>

          <section className="panel card">
            <h2>Create schedule</h2>
            <p className="muted compact">
              Create or edit call/chat schedules used by the scheduler worker.
            </p>
            <form onSubmit={onCreateSchedule} className="stack">
              <div className="inline-fields">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="schedule-type">Type</label>
                  <select id="schedule-type" value={scheduleForm.type} onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value as "call" | "chat" })}>
                    <option value="call">Call</option>
                    <option value="chat">Chat</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="days-csv">Days of week (0-6 CSV)</label>
                  <input id="days-csv" value={scheduleForm.days_csv} onChange={(e) => setScheduleForm({ ...scheduleForm, days_csv: e.target.value })} />
                </div>
              </div>
              <div className="inline-fields">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="start-window">Window start</label>
                  <input id="start-window" type="time" value={scheduleForm.start_local} onChange={(e) => setScheduleForm({ ...scheduleForm, start_local: e.target.value })} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="end-window">Window end</label>
                  <input id="end-window" type="time" value={scheduleForm.end_local} onChange={(e) => setScheduleForm({ ...scheduleForm, end_local: e.target.value })} />
                </div>
              </div>
              <div className="inline-fields">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cadence-kind">Cadence kind</label>
                  <select id="cadence-kind" value={scheduleForm.cadence_kind} onChange={(e) => setScheduleForm({ ...scheduleForm, cadence_kind: e.target.value })}>
                    <option value="weekly">Weekly</option>
                    <option value="daily">Daily</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cadence-interval">Cadence interval</label>
                  <input id="cadence-interval" type="number" min={1} value={scheduleForm.interval} onChange={(e) => setScheduleForm({ ...scheduleForm, interval: e.target.value })} />
                </div>
              </div>
              {scheduleForm.type === "call" ? (
                <div className="inline-fields">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="retry-attempts">Retry attempts</label>
                    <input id="retry-attempts" type="number" min={0} value={scheduleForm.retry_attempts} onChange={(e) => setScheduleForm({ ...scheduleForm, retry_attempts: e.target.value })} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="retry-delay">Retry delay (minutes)</label>
                    <input id="retry-delay" type="number" min={1} value={scheduleForm.retry_delay_minutes} onChange={(e) => setScheduleForm({ ...scheduleForm, retry_delay_minutes: e.target.value })} />
                  </div>
                </div>
              ) : null}
              <button className="btn btn-primary" type="submit" disabled={busy === "schedule"}>
                {busy === "schedule" ? "Saving..." : editingScheduleId ? `Update ${scheduleForm.type} schedule` : `Save ${scheduleForm.type} schedule`}
              </button>
              {editingScheduleId ? (
                <button
                  className="btn btn-soft"
                  type="button"
                  onClick={() => setEditingScheduleId(null)}
                  disabled={busy === "schedule"}
                >
                  Cancel edit
                </button>
              ) : null}
            </form>
          </section>
        </div>

        <div className="grid grid-2">
          <section className="panel card">
            <div className="row spread wrap gap">
              <h2 style={{ marginBottom: 0 }}>Saved schedules</h2>
              <button className="btn btn-soft" type="button" onClick={() => void loadManagement()} disabled={loadingManagement}>
                {loadingManagement ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            {savedSchedules.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 10 }}>No schedules yet.</div>
            ) : (
              <div className="data-list" style={{ marginTop: 10 }}>
                {savedSchedules.map((schedule) => {
                  const window0 = (schedule.windows[0] ?? {}) as Record<string, unknown>;
                  const days = Array.isArray(window0.days_of_week) ? (window0.days_of_week as unknown[]).join(",") : "n/a";
                  return (
                    <div key={schedule.id} className="data-row">
                      <div className="row spread wrap gap-sm">
                        <strong>{schedule.type} schedule</strong>
                        <span className="badge mono">{schedule.id.slice(0, 8)}</span>
                      </div>
                      <div className="muted compact">
                        Days {days} • {String(window0.start_local ?? "--:--")}-{String(window0.end_local ?? "--:--")}
                      </div>
                      <div className="muted compact">
                        Cadence: {String((schedule.cadence as Record<string, unknown>).kind ?? "custom")} every {String((schedule.cadence as Record<string, unknown>).interval ?? 1)}
                      </div>
                      <div className="row gap-sm wrap">
                        <button className="btn btn-soft" type="button" onClick={() => loadScheduleIntoForm(schedule)}>
                          Edit
                        </button>
                        <button
                          className="btn btn-danger"
                          type="button"
                          onClick={() => void onDeleteSchedule(schedule.id)}
                          disabled={busy === `delete:${schedule.id}`}
                        >
                          {busy === `delete:${schedule.id}` ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <details style={{ marginTop: 12 }}>
              <summary className="muted compact" style={{ cursor: "pointer" }}>Last schedule response</summary>
              <pre className="code-block" style={{ marginTop: 8 }}>
                {JSON.stringify(lastScheduleResult ?? { status: "No schedule write this session" }, null, 2)}
              </pre>
            </details>
          </section>

          <section className="panel card">
            <div className="row spread wrap gap">
              <h2 style={{ marginBottom: 0 }}>Call management</h2>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void onTriggerCallNow()}
                disabled={busy === "triggerCallNow"}
              >
                {busy === "triggerCallNow" ? "Queueing..." : "Call me now"}
              </button>
            </div>
            <p className="muted compact">
              Queues an immediate call check-in event for the worker. Actual call dispatch depends on worker tick timing.
            </p>
            {checkinEvents.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 10 }}>No check-in events yet.</div>
            ) : (
              <div className="data-list" style={{ marginTop: 10 }}>
                {checkinEvents.map((event) => (
                  <div key={event.id} className="data-row">
                    <div className="row spread wrap gap-sm">
                      <strong>{event.type} check-in</strong>
                      <span className={`badge ${event.status === "completed" ? "done" : event.status === "failed" ? "missed" : "pending"}`}>
                        {event.status}
                      </span>
                    </div>
                    <div className="muted compact">
                      {new Date(event.scheduled_at_utc).toLocaleString()} • attempts {event.attempt_count}
                    </div>
                    {event.provider_call_id ? (
                      <div className="muted compact mono">provider: {event.provider_call_id}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </ProtectedPage>
  );
}
