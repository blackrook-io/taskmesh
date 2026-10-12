export function showAiAppliedToast(detail: { journalId: number; summary: string }) {
  window.dispatchEvent(new CustomEvent("taskmesh:ai-applied", { detail }));
}

export function showAiApplyFailedToast(detail: { summary: string; message: string }) {
  window.dispatchEvent(new CustomEvent("taskmesh:ai-apply-failed", { detail }));
}
