export type TimelineZoom = "day" | "week" | "month";

export type TimelineSpan = {
  start: string;
  end: string;
  startFraction: number;
  endFraction: number;
  /** Actual bars may sit on a weekend. Scheduled bars skip those columns. */
  actual: boolean;
};

const DAY_MS = 86_400_000;

export function columnWidth(zoom: TimelineZoom): number {
  if (zoom === "day") return 40;
  if (zoom === "week") return 16;
  return 5;
}

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  const date = parseDay(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDays(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

export function isWeekend(iso: string): boolean {
  const day = parseDay(iso).getUTCDay();
  return day === 0 || day === 6;
}

export function dateX(date: string, origin: string, width: number, fraction = 0): number {
  return (calendarDays(origin, date) + fraction) * width;
}

export function barSegments(
  span: TimelineSpan,
  origin: string,
  width: number,
): Array<{ x: number; width: number }> {
  const segments: Array<{ x: number; width: number }> = [];
  const days = Math.max(0, calendarDays(span.start, span.end));
  for (let offset = 0; offset <= days; offset += 1) {
    const date = addDays(span.start, offset);
    if (!span.actual && isWeekend(date)) continue;
    const dayIndex = calendarDays(origin, date);
    let from = 0;
    let to = 1;
    if (date === span.start) from = span.startFraction;
    if (date === span.end) to = span.endFraction;
    if (to - from <= 0.001) {
      if (span.start === span.end) {
        segments.push({ x: dayIndex * width + from * width, width: Math.max(4, width * 0.2) });
      }
      continue;
    }
    segments.push({ x: dayIndex * width + from * width, width: (to - from) * width });
  }
  return segments;
}

export function axisTicks(
  origin: string,
  end: string,
  zoom: TimelineZoom,
): Array<{ date: string; label: string }> {
  const ticks: Array<{ date: string; label: string }> = [];
  const total = Math.max(0, calendarDays(origin, end));
  for (let offset = 0; offset <= total; offset += 1) {
    const date = addDays(origin, offset);
    const parsed = parseDay(date);
    const weekday = parsed.getUTCDay();
    const show =
      (zoom === "day" && !isWeekend(date)) ||
      (zoom === "week" && weekday === 1) ||
      (zoom === "month" && parsed.getUTCDate() === 1);
    if (!show) continue;
    ticks.push({
      date,
      label: parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    });
  }
  return ticks;
}
