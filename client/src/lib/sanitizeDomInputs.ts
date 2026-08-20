import { sanitizeMarkdown } from "./sanitizeMarkdown";
import { sanitizePlainText } from "./plainText";

const SKIP_INPUT_TYPES = new Set([
  "password",
  "file",
  "checkbox",
  "radio",
  "number",
  "range",
  "color",
  "date",
  "datetime-local",
  "time",
  "hidden",
  "month",
  "week",
]);

/**
 * Capture-phase sanitizer so every text input/textarea strips HTML before React state.
 * Leaves contenteditable (TipTap) and password/file/number controls alone.
 */
export function installDomInputSanitizer(): () => void {
  const onInput = (event: Event) => {
    if (event instanceof InputEvent && event.isComposing) return;
    const el = event.target;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
    if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type)) return;
    if (el.closest('[contenteditable="true"]')) return;
    const next =
      el instanceof HTMLTextAreaElement ? sanitizeMarkdown(el.value) : sanitizePlainText(el.value);
    if (next !== el.value) {
      el.value = next;
    }
  };
  document.addEventListener("input", onInput, true);
  return () => document.removeEventListener("input", onInput, true);
}
