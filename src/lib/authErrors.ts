export const AUTH_REQUIRED_MESSAGE = "Authentication required.";

export class AuthenticationError extends Error {
  readonly status = 401;
  readonly code = "not_authenticated";

  constructor(message: string = AUTH_REQUIRED_MESSAGE) {
    super(message);
    this.name = "AuthenticationError";
  }
}
