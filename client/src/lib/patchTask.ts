import { apiJson } from "../api/client";
import type { Task } from "../types";

/**
 * Patch a task. Uses standalone `/api/v1/tasks/:id` when `projectId` is in the
 * patch or the task is unassigned; otherwise project-scoped route when known.
 */
export async function patchTaskRecord(
  taskId: number,
  patch: Record<string, unknown>,
  currentProjectId: number | null,
): Promise<Task> {
  const useStandalone = "projectId" in patch || currentProjectId == null;
  const url = useStandalone
    ? `/api/v1/tasks/${taskId}`
    : `/api/v1/projects/${currentProjectId}/tasks/${taskId}`;
  const res = await apiJson<{ data: Task }>(url, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return res.data;
}
