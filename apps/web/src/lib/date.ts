function parseDateInput(dateInput: string | Date): Date {
  if (dateInput instanceof Date) {
    return new Date(dateInput.getTime());
  }

  const raw = String(dateInput ?? "").trim();
  if (!raw) {
    return new Date(NaN);
  }

  // Prefer local-date parsing for YYYY-MM-DD so day labels don't shift by timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00`);
  }

  // Accept full ISO timestamps from backend rows (date or timestamp columns serialized by driver).
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  // Last resort: handle "YYYY-MM-DD HH:mm:ss" by coercing to ISO-ish format.
  const coerced = new Date(raw.replace(" ", "T"));
  return coerced;
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toWeekStart(dateInput: string | Date = new Date()): string {
  const date = parseDateInput(dateInput);
  if (Number.isNaN(date.getTime())) {
    return todayIsoDate();
  }
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  return date.toISOString().slice(0, 10);
}

export function addDays(dateInput: string, days: number): string {
  const date = parseDateInput(dateInput);
  if (Number.isNaN(date.getTime())) {
    return todayIsoDate();
  }
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function prettyDate(dateInput: string): string {
  const date = parseDateInput(dateInput);
  if (Number.isNaN(date.getTime())) {
    return dateInput || "";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
