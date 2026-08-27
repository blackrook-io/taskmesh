/**
 * Copy-replace git-tracked schema docs (`docs/`) into the TaskMesh project's
 * Documents module (PROD by default). `/docs` remains authoritative.
 *
 * Usage:
 *   npm run docs:sync-schema
 *   TASKMESH_COOKIE='<session id or Cookie header>' npm run docs:sync-schema
 *   TASKMESH_API_BASE=http://127.0.0.1:3000 TASKMESH_PROJECT_ID=4 npm run docs:sync-schema
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const API_BASE = (process.env.TASKMESH_API_BASE ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const PROJECT_ID = Number(process.env.TASKMESH_PROJECT_ID ?? "4");

const rawCookie = process.env.TASKMESH_COOKIE?.trim();
const cookieHeader = rawCookie
  ? rawCookie.toLowerCase().startsWith("taskmesh_session=")
    ? rawCookie
    : `taskmesh_session=${rawCookie}`
  : undefined;

/** Stable Document titles used for upsert (match exactly on sync). */
export const SCHEMA_DOC_SYNC_MAP: ReadonlyArray<{
  repoPath: string;
  title: string;
  position: number;
}> = [
  { repoPath: "docs/README.md", title: "DB Schema — Index", position: 0 },
  {
    repoPath: "docs/database/overview.md",
    title: "DB Schema — Overview",
    position: 1,
  },
  {
    repoPath: "docs/database/projects-and-ideas.md",
    title: "DB Schema — Projects and ideas",
    position: 2,
  },
  { repoPath: "docs/database/tasks.md", title: "DB Schema — Tasks", position: 3 },
  {
    repoPath: "docs/database/content-and-modules.md",
    title: "DB Schema — Content and modules",
    position: 4,
  },
  {
    repoPath: "docs/database/platform.md",
    title: "DB Schema — Platform tables",
    position: 5,
  },
  {
    repoPath: "docs/database/glossary.md",
    title: "DB Schema — Glossary",
    position: 6,
  },
];

const BANNER = `> **Authoritative copy:** git-tracked [\`docs/\`](https://github.com/blackrook-io/taskmesh/tree/main/docs) in the repo. This Document is a synced mirror for in-app reading. Mermaid diagrams may render as code fences until the editor supports Mermaid preview. Re-sync with \`npm run docs:sync-schema\`.
>
> Source file: \`{{REPO_PATH}}\`

`;

type ProjectDocument = {
  id: number;
  title: string;
  body: string | null;
  position: number;
};

async function api<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(cookieHeader && method !== "GET"
        ? { "X-TaskMesh-Client": "ui", Origin: API_BASE }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${urlPath} → ${res.status}: non-JSON (${text.slice(0, 200)})`);
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${urlPath} → ${res.status}: ${typeof json === "object" ? JSON.stringify(json) : text}`,
    );
  }
  return json as T;
}

function withBanner(repoPath: string, markdown: string): string {
  return BANNER.replace("{{REPO_PATH}}", repoPath) + markdown.trimStart();
}

async function main(): Promise<void> {
  if (!Number.isFinite(PROJECT_ID) || PROJECT_ID <= 0) {
    throw new Error(`Invalid TASKMESH_PROJECT_ID: ${process.env.TASKMESH_PROJECT_ID}`);
  }

  const projectRes = await api<{ data: { id: number; name: string; number: number } }>(
    "GET",
    `/api/v1/projects/${PROJECT_ID}`,
  );
  const project = projectRes.data;
  console.log(
    `Syncing schema docs → P${String(project.number).padStart(4, "0")} “${project.name}” (id ${project.id}) via ${API_BASE}`,
  );

  const listRes = await api<{ data: ProjectDocument[] }>(
    "GET",
    `/api/v1/projects/${PROJECT_ID}/documents`,
  );
  const byTitle = new Map(listRes.data.map((d) => [d.title, d]));

  const results: Array<{ title: string; action: "created" | "updated"; id: number }> = [];

  for (const entry of SCHEMA_DOC_SYNC_MAP) {
    const abs = path.join(repoRoot, entry.repoPath);
    const raw = await readFile(abs, "utf8");
    const body = withBanner(entry.repoPath, raw);
    const existing = byTitle.get(entry.title);

    if (existing) {
      const patched = await api<{ data: ProjectDocument }>(
        "PATCH",
        `/api/v1/projects/${PROJECT_ID}/documents/${existing.id}`,
        { body, position: entry.position },
      );
      results.push({ title: entry.title, action: "updated", id: patched.data.id });
      console.log(`  updated  D… id=${patched.data.id}  ${entry.title}`);
    } else {
      const created = await api<{ data: ProjectDocument }>(
        "POST",
        `/api/v1/projects/${PROJECT_ID}/documents`,
        { title: entry.title, body, position: entry.position },
      );
      results.push({ title: entry.title, action: "created", id: created.data.id });
      console.log(`  created  id=${created.data.id}  ${entry.title}`);
    }
  }

  console.log(JSON.stringify({ ok: true, projectId: PROJECT_ID, results }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
