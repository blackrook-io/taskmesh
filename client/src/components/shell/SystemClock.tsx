import { useEffect, useState } from "react";

function formatClock(now: Date): { primary: string; tooltip: string } {
  const localTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  const zuluTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(now);

  const datePart = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offsetLabel = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;

  return {
    primary: `${localTime} (${zuluTime}Z) · ${datePart}`,
    tooltip: `${timeZone} (${offsetLabel})`,
  };
}

export function SystemClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const { primary, tooltip } = formatClock(now);

  return (
    <time className="system-clock" dateTime={now.toISOString()} title={tooltip} aria-live="off">
      {primary}
    </time>
  );
}
