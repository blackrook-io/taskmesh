/** Persisted pixel height for the task Description markdown editor (localStorage). */

export const TASK_DESCRIPTION_EDITOR_HEIGHT_KEY = "taskmesh.taskDescriptionEditorHeight";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 720;

export function parseTaskDescriptionEditorHeight(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < MIN_HEIGHT || rounded > MAX_HEIGHT) return null;
  return rounded;
}

export function loadTaskDescriptionEditorHeight(): number | null {
  try {
    return parseTaskDescriptionEditorHeight(localStorage.getItem(TASK_DESCRIPTION_EDITOR_HEIGHT_KEY));
  } catch {
    return null;
  }
}

export function saveTaskDescriptionEditorHeight(height: number): void {
  const parsed = parseTaskDescriptionEditorHeight(String(Math.round(height)));
  if (parsed == null) return;
  try {
    localStorage.setItem(TASK_DESCRIPTION_EDITOR_HEIGHT_KEY, String(parsed));
  } catch {
    /* ignore quota / private mode */
  }
}
