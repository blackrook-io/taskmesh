import type { ApiErrorBody } from "../types";

async function readJsonOrThrow(res: Response, path: string): Promise<unknown> {
  const text = await res.text();
  const trimmed = text.trimStart();
  if (!trimmed) {
    if (res.status === 204) return undefined;
    throw new Error(`Empty response from ${path} (HTTP ${res.status})`);
  }
  if (trimmed.startsWith("<") || trimmed.startsWith("<!")) {
    throw new Error(
      `Server returned HTML instead of JSON for ${path} (HTTP ${res.status}). Check the API is running and the URL is under /api/.`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `Invalid JSON from ${path} (HTTP ${res.status}): ${trimmed.slice(0, 120)}`,
    );
  }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (!path || typeof path !== "string") {
    throw new Error("Missing API path");
  }
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) {
    return undefined as T;
  }
  const json = (await readJsonOrThrow(res, path)) as T | ApiErrorBody;
  if (!res.ok) {
    const err = json as ApiErrorBody;
    throw new Error(err.error?.message ?? res.statusText);
  }
  return json as T;
}

export async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/v1/uploads", { method: "POST", body: fd });
  const json = (await res.json()) as { data?: { url: string }; error?: { message: string } };
  if (!res.ok) {
    throw new Error(json.error?.message ?? "Upload failed");
  }
  if (!json.data?.url) {
    throw new Error("Upload response missing url");
  }
  return json.data.url;
}
