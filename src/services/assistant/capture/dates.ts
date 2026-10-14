export type CivilDate = { year: number; month: number; day: number };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const VAGUE = new Set([
  "soon",
  "later",
  "asap",
  "eventually",
  "sometime",
  "whenever",
  "at some point",
]);

export type DateResolution =
  | { kind: "none" }
  | { kind: "date"; iso: string }
  | { kind: "question"; prompt: string; choices?: { ref: string; title: string }[] };

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function civilDate(now: Date, timeZone: string): CivilDate & { weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const short = value("weekday");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday,
  };
}

export function formatIso(date: CivilDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function weekdayIndex(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function compareCivil(a: CivilDate, b: CivilDate): number {
  return formatIso(a).localeCompare(formatIso(b));
}

function lastDayOfMonth(year: number, month: number): CivilDate {
  const last = new Date(Date.UTC(year, month, 0));
  return { year: last.getUTCFullYear(), month: last.getUTCMonth() + 1, day: last.getUTCDate() };
}

function validCivil(date: CivilDate): boolean {
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return (
    check.getUTCFullYear() === date.year &&
    check.getUTCMonth() + 1 === date.month &&
    check.getUTCDate() === date.day
  );
}

function upcomingWeekday(today: CivilDate, weekday: number): CivilDate {
  const delta = (weekday - weekdayIndex(today) + 7) % 7;
  return addCivilDays(today, delta);
}

function question(prompt: string, isos: string[] = []): DateResolution {
  const unique = [...new Set(isos)].sort();
  return {
    kind: "question",
    prompt,
    choices: unique.length > 0 ? unique.map((iso) => ({ ref: iso, title: iso })) : undefined,
  };
}

function normalizePhrase(raw: string): string {
  let text = raw.trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/^(due by|due|by|on|before|until)\s+/, "");
  }
  return text;
}

function amount(raw: string): number | null {
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n >= 0 && n <= 366 ? n : null;
  }
  return NUMBER_WORDS[raw] ?? null;
}

/** Resolve a copied date phrase. A missing phrase is not a date. Vague or two-way phrases are questions. */
export function resolveDatePhrase(raw: string | null, now: Date, timeZone: string): DateResolution {
  if (raw == null || raw.trim() === "") return { kind: "none" };
  const phrase = normalizePhrase(raw);
  if (!phrase) return { kind: "none" };
  const today = civilDate(now, timeZone);

  if (VAGUE.has(phrase)) {
    return question(`“${raw.trim()}” is not a specific date.`);
  }
  if (phrase === "today") return { kind: "date", iso: formatIso(today) };
  if (phrase === "tomorrow") return { kind: "date", iso: formatIso(addCivilDays(today, 1)) };
  if (phrase === "yesterday") return { kind: "date", iso: formatIso(addCivilDays(today, -1)) };

  if (phrase === "next week" || phrase === "this weekend" || phrase === "next weekend" || phrase === "next month") {
    return question(`“${raw.trim()}” could be more than one day.`);
  }
  if (phrase === "end of the month" || phrase === "end of month") {
    return { kind: "date", iso: formatIso(lastDayOfMonth(today.year, today.month)) };
  }

  const relative = phrase.match(/^in\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks)$/);
  if (relative) {
    const count = amount(relative[1]!);
    if (count == null) return question(`“${raw.trim()}” is not a specific date.`);
    const days = relative[2]!.startsWith("week") ? count * 7 : count;
    return { kind: "date", iso: formatIso(addCivilDays(today, days)) };
  }

  const iso = phrase.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    if (!validCivil(date)) return question(`“${raw.trim()}” is not a real date.`);
    return { kind: "date", iso: formatIso(date) };
  }

  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(phrase)) {
    return question(`“${raw.trim()}” could be read in more than one order.`);
  }

  const named = phrase.match(/^(this|next)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)$/);
  if (named) {
    const word = named[2]!;
    const weekday = WEEKDAYS.findIndex((day) => day === word || day.startsWith(word));
    const soonest = upcomingWeekday(today, weekday);
    if (named[1] === "next") {
      const following = addCivilDays(soonest, 7);
      return question(`“${raw.trim()}” could be ${formatIso(soonest)} or ${formatIso(following)}.`, [
        formatIso(soonest),
        formatIso(following),
      ]);
    }
    if (named[1] === "this") {
      const weekStart = addCivilDays(today, -weekdayIndex(today));
      const inWeek = addCivilDays(weekStart, weekday);
      if (compareCivil(inWeek, today) < 0) {
        return question(`“${raw.trim()}” already passed this week.`);
      }
      return { kind: "date", iso: formatIso(inWeek) };
    }
    return { kind: "date", iso: formatIso(soonest) };
  }

  const monthDay = phrase.match(
    /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/,
  );
  if (monthDay && MONTHS[monthDay[1]!] != null) {
    const month = MONTHS[monthDay[1]!]!;
    const day = Number(monthDay[2]);
    if (monthDay[3]) {
      const date = { year: Number(monthDay[3]), month, day };
      if (!validCivil(date)) return question(`“${raw.trim()}” is not a real date.`);
      return { kind: "date", iso: formatIso(date) };
    }
    const thisYear = { year: today.year, month, day };
    if (!validCivil(thisYear)) return question(`“${raw.trim()}” is not a real date.`);
    const date = compareCivil(thisYear, today) < 0 ? { year: today.year + 1, month, day } : thisYear;
    if (!validCivil(date)) return question(`“${raw.trim()}” is not a real date.`);
    return { kind: "date", iso: formatIso(date) };
  }

  return question(`“${raw.trim()}” is not a specific date.`);
}
