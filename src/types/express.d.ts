import "express";

declare global {
  namespace Express {
    interface Request {
      /** Set by session loader when a valid session cookie is present. */
      sessionUserId?: number;
      sessionId?: string;
    }
  }
}

export {};
