export const OPEN_ASK_EVENT = "taskmesh:open-ask";

export function dispatchOpenAsk(): void {
  window.dispatchEvent(new CustomEvent(OPEN_ASK_EVENT));
}
