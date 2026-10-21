let openOnEmail = false;

/** Next System Logs mount opens the Email tab. */
export function requestEmailLogTab(): void {
  openOnEmail = true;
}

export function consumeEmailLogRequest(): boolean {
  const open = openOnEmail;
  openOnEmail = false;
  return open;
}
