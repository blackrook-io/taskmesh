export const NOTIFICATION_TYPES = ["digest", "reminder", "mention", "assignment"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_FREQUENCIES = ["immediate", "daily", "weekly"] as const;
export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

/** Local hour when daily and weekly email is sent, unless that hour is quiet. */
export const NOTIFICATION_BATCH_HOUR = 8;

export type QuietSchedule = {
  frequency: NotificationFrequency;
  quietStart: number | null;
  quietEnd: number | null;
  timeZone: string;
};

export type ZonedParts = {
  date: string;
  hour: number;
  minute: number;
  weekday: string;
};

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 80) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : "UTC";
}

export function zonedParts(now: Date, timeZone: string): ZonedParts {
  const zone = safeTimeZone(timeZone);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: Number(parts.minute),
    weekday: parts.weekday ?? "",
  };
}

/** True when `hour` is inside [start, end). Equal or missing bounds mean no quiet hours. */
export function isQuietHour(
  hour: number,
  quietStart: number | null,
  quietEnd: number | null,
): boolean {
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
  return hour >= quietStart || hour < quietEnd;
}

export function isQuietNow(now: Date, schedule: QuietSchedule): boolean {
  const parts = zonedParts(now, schedule.timeZone);
  return isQuietHour(parts.hour, schedule.quietStart, schedule.quietEnd);
}

/**
 * When an email may be queued.
 * `null` means send immediately.
 */
export function emailDeliverAt(now: Date, schedule: QuietSchedule): Date | null {
  if (schedule.frequency === "immediate" && !isQuietNow(now, schedule)) return null;

  const zone = safeTimeZone(schedule.timeZone);
  const start = now.getTime() + 60_000;
  for (let step = 0; step < 8 * 24 * 60; step++) {
    const candidate = new Date(start + step * 60_000);
    const parts = zonedParts(candidate, zone);
    if (parts.minute !== 0) continue;
    if (isQuietHour(parts.hour, schedule.quietStart, schedule.quietEnd)) continue;
    if (schedule.frequency === "immediate") return candidate;
    if (parts.hour !== NOTIFICATION_BATCH_HOUR) continue;
    if (schedule.frequency === "daily") return candidate;
    if (schedule.frequency === "weekly" && parts.weekday === "Mon") return candidate;
  }
  return new Date(now.getTime() + 60 * 60_000);
}

export function notificationPublicBaseUrl(): string {
  const fromEnv = process.env.OAUTH_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    const port = process.env.PORT?.trim() || "3000";
    return `http://127.0.0.1:${port}`;
  }
  return "http://127.0.0.1:5173";
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days));
  return next.toISOString().slice(0, 10);
}
