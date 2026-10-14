export type DigestWallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  iso: string;
};

export type DigestSchedule = {
  kind: "none" | "ok" | "overdue" | "risk";
  days: number | null;
  used: number | null;
};

const MS_DAY = 864e5;

export function wallClock(now: Date, timeZone: string): DigestWallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(value("hour"));
  if (hour === 24) hour = 0;
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  return {
    year,
    month,
    day,
    hour,
    minute: Number(value("minute")),
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function civilDiff(laterIso: string, earlierIso: string): number {
  const later = Date.parse(`${laterIso}T00:00:00Z`);
  const earlier = Date.parse(`${earlierIso}T00:00:00Z`);
  return Math.round((later - earlier) / MS_DAY);
}

/** Monday-start ISO week for a civil date, plus that week's Monday. */
export function isoWeek(iso: string): { key: string; monday: string } {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  const weekday = date.getUTCDay() || 7;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((thursday.getTime() - yearStart.getTime()) / MS_DAY / 7 + 1 / 7);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (weekday - 1));
  const mondayIso = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
  return {
    key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    monday: mondayIso,
  };
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  return asUtc - instant.getTime();
}

/** UTC instant of a civil date and hour in `timeZone`. */
export function zonedInstant(iso: string, hour: number, timeZone: string): Date {
  const pad = String(hour).padStart(2, "0");
  const guess = new Date(`${iso}T${pad}:00:00Z`);
  const first = zoneOffsetMs(guess, timeZone);
  const corrected = new Date(guess.getTime() - first);
  const second = zoneOffsetMs(corrected, timeZone);
  if (second !== first) return new Date(guess.getTime() - second);
  return corrected;
}

export type DigestPeriod = {
  key: string;
  start: Date;
  end: Date;
  due: boolean;
};

/**
 * Daily key is the local date. Weekly key is the ISO week.
 * Due once local time is at or after `hour` in that period, including later the same day or week.
 */
export function digestPeriod(
  now: Date,
  args: { frequency: "daily" | "weekly"; timeZone: string; hour: number },
): DigestPeriod {
  const wall = wallClock(now, args.timeZone);
  if (args.frequency === "weekly") {
    const week = isoWeek(wall.iso);
    const start = zonedInstant(week.monday, 0, args.timeZone);
    const end = zonedInstant(addIsoDays(week.monday, 7), 0, args.timeZone);
    const open = zonedInstant(week.monday, args.hour, args.timeZone);
    return { key: week.key, start, end, due: now.getTime() >= open.getTime() };
  }
  const start = zonedInstant(wall.iso, 0, args.timeZone);
  const end = zonedInstant(addIsoDays(wall.iso, 1), 0, args.timeZone);
  return { key: wall.iso, start, end, due: wall.hour >= args.hour };
}

const CLOSED = new Set(["complete", "canceled"]);

export type ScheduleNode = {
  state?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  progress?: number | null;
};

/** Same overdue and at-risk split as Mesh, using noon in the user's zone as "today". */
export function digestSchedule(node: ScheduleNode, now: Date, timeZone: string): DigestSchedule {
  if (!node.dueDate || CLOSED.has(node.state ?? "")) return { kind: "none", days: null, used: null };
  const today = wallClock(now, timeZone).iso;
  if (node.dueDate < today) {
    return { kind: "overdue", days: civilDiff(today, node.dueDate), used: null };
  }
  if (node.createdAt && node.progress != null) {
    const start = new Date(node.createdAt).getTime();
    const due = zonedInstant(node.dueDate, 12, timeZone).getTime();
    const todayNoon = zonedInstant(today, 12, timeZone).getTime();
    const span = due - start;
    if (span > 0) {
      const frac = (todayNoon - start) / span;
      if (frac - node.progress / 100 > 0.25) {
        return { kind: "risk", days: civilDiff(node.dueDate, today), used: Math.round(frac * 100) };
      }
    }
  }
  return { kind: "ok", days: civilDiff(node.dueDate, today), used: null };
}

/** A record is stale when its last update is at least `staleDays` old. Complete records are not. */
export function digestStale(
  node: { state?: string | null; signalAt?: string | null },
  now: Date,
  staleDays: number,
): boolean {
  if (!node.signalAt || node.state === "complete") return false;
  const elapsed = (now.getTime() - new Date(node.signalAt).getTime()) / MS_DAY;
  return elapsed >= staleDays;
}
