const RECENT_KEY = "taskmesh.recentNav";
const MAX_RECENT = 8;

export type RecentNavItem = {
  path: string;
  label: string;
  at: number;
};

export function loadRecentNav(): RecentNavItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentNavItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.path === "string" && typeof x.label === "string")
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function pushRecentNav(path: string, label: string) {
  const clean = path.split("?")[0] || path;
  if (!clean || clean === "/") {
    // Still allow home
  }
  const next: RecentNavItem = {
    path,
    label: label.trim() || path,
    at: Date.now(),
  };
  const prev = loadRecentNav().filter((r) => r.path !== path && r.path !== clean);
  const list = [next, ...prev].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
