import "express";

declare global {
  namespace Express {
    interface Request {
      /** Set by session loader when a valid session cookie is present. */
      sessionUserId?: number;
      sessionId?: string;
      /** Set by API key auth (T0063) when a valid key is presented. */
      apiKeyId?: number;
      apiKeyUserId?: number;
    }
  }
}

export {};
