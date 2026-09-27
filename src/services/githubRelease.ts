import { compareSemver, semverDisplay } from "../lib/semver.js";

const DEFAULT_REPO = "blackrook-io/taskmesh";
const SUCCESS_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

export type StableRelease = {
  version: string;
  htmlUrl: string;
};

type CacheEntry = {
  at: number;
  value: StableRelease | null;
  ok: boolean;
};

let cache: CacheEntry | null = null;

export function clearGithubReleaseCache(): void {
  cache = null;
}

export function githubRepoSlug(raw = process.env.GITHUB_REPO): string | null {
  const slug = (raw ?? DEFAULT_REPO).trim() || DEFAULT_REPO;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) ? slug : null;
}

export function parseLatestRelease(body: unknown, repo: string): StableRelease | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const rec = body as Record<string, unknown>;
  if (rec.draft === true || rec.prerelease === true) return null;
  if (typeof rec.tag_name !== "string" || typeof rec.html_url !== "string") return null;
  const version = semverDisplay(rec.tag_name);
  if (!version) return null;
  const prefix = `https://github.com/${repo}/`;
  if (!rec.html_url.startsWith(prefix)) return null;
  return { version, htmlUrl: rec.html_url };
}

export function updateAvailable(currentVersion: string, latest: StableRelease | null): boolean {
  if (!latest) return false;
  const cmp = compareSemver(latest.version, currentVersion);
  return cmp != null && cmp > 0;
}

type LookupOptions = {
  now?: number;
  fetchImpl?: typeof fetch;
  repo?: string | null;
  token?: string;
};

export async function latestStableRelease(options: LookupOptions = {}): Promise<StableRelease | null> {
  const now = options.now ?? Date.now();
  if (cache) {
    const ttl = cache.ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    if (now - cache.at < ttl) return cache.value;
  }

  const repo = options.repo === undefined ? githubRepoSlug() : options.repo;
  if (!repo) {
    cache = { at: now, value: null, ok: false };
    return null;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "taskmesh",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = (options.token ?? process.env.GITHUB_TOKEN ?? "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) {
      cache = { at: now, value: null, ok: true };
      return null;
    }
    if (!res.ok) {
      cache = { at: now, value: null, ok: false };
      return null;
    }
    const value = parseLatestRelease(await res.json(), repo);
    cache = { at: now, value, ok: true };
    return value;
  } catch {
    cache = { at: now, value: null, ok: false };
    return null;
  }
}
