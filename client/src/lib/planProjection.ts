export type PlanProjectionDriver =
  | "velocity"
  | "capacity"
  | "critical_path"
  | "needs_capacity"
  | "needs_estimates"
  | "complete";

export type PlanProjection = {
  earliest: string | null;
  latest: string | null;
  center: string | null;
  driver: PlanProjectionDriver;
  canSetCapacity: boolean;
  inputs: {
    completedHours28d: number;
    velocityHoursPerWeek: number | null;
    capacityHoursPerWeek: number | null;
    hoursPerWeek: number | null;
    rateSource: "velocity" | "capacity" | null;
    remainingHours: number;
    criticalPathHours: number | null;
    throughputFinish: string | null;
    criticalPathFinish: string | null;
    workdayHours: number;
    unestimatedCount: number;
    itemCount: number;
    uncertainty: number;
  };
};

const DRIVER_DETAIL: Record<PlanProjectionDriver, string> = {
  velocity: "Driven by velocity",
  capacity: "Driven by weekly capacity",
  critical_path: "Driven by the critical path",
  needs_capacity: "Set weekly capacity",
  needs_estimates: "Add estimates to project a finish",
  complete: "Finished",
};

function formatUtcDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function planFinishPresentation(
  projection: Pick<PlanProjection, "driver" | "earliest" | "latest">,
): { label: string; detail: string | null } {
  if (
    projection.driver === "needs_capacity" ||
    projection.driver === "needs_estimates" ||
    projection.driver === "complete"
  ) {
    return { label: DRIVER_DETAIL[projection.driver], detail: null };
  }
  if (!projection.earliest || !projection.latest) {
    return { label: "Finish date —", detail: null };
  }
  const start = formatUtcDate(projection.earliest);
  const end = formatUtcDate(projection.latest);
  return {
    label: start === end ? start : `${start} – ${end}`,
    detail: DRIVER_DETAIL[projection.driver],
  };
}
