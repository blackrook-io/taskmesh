/** Mirrors root package.json + APP_VERSION_CREATED_AT. Update both on finish-up version bump. */
export const APP_VERSION = "0.30.2";
export const APP_VERSION_CREATED_AT: string | null = "2026-08-27T00:43:26.000Z";

export type AppVersionMeta = {
  version: string;
  createdAt: string | null;
  releasedAt: string | null;
};

export function formatUtcStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);
  return `${date}, ${time} UTC`;
}

export function formatVersionTooltip(meta: AppVersionMeta): string {
  const onMain = meta.createdAt ? `on main ${formatUtcStamp(meta.createdAt)}` : "not on main yet";
  const deployed = meta.releasedAt
    ? `deployed ${formatUtcStamp(meta.releasedAt)}`
    : "not deployed to production";
  return `TaskMesh v${meta.version} — ${onMain} — ${deployed}`;
}

export function bundledAppVersionMeta(): AppVersionMeta {
  return { version: APP_VERSION, createdAt: APP_VERSION_CREATED_AT, releasedAt: null };
}
