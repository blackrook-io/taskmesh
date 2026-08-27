/** Resource missing — mapped to 404 by `handleRouteError`. */
export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "not_found";

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
