import type { ApiErrorBody } from "../types";

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) {
    return undefined as T;
  }
  const json = (await res.json()) as T | ApiErrorBody;
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
