import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requestAuthContext } from "../lib/requestAuthContext.js";

/**
 * Multer (and similar) finishes on a later async turn, which drops
 * `requestAuthContext` from `sessionLoader`. Re-bind from `req` before
 * continuing so `getCurrentUserId()` still works in the route handler.
 */
export function restoreRequestAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  requestAuthContext.run(
    {
      sessionUserId: req.sessionUserId,
      apiKeyUserId: req.apiKeyUserId,
    },
    () => next(),
  );
}

/** Wrap a multer middleware so `next` re-enters request auth ALS. */
export function withRestoredRequestAuth(uploadMw: RequestHandler): RequestHandler {
  return (req, res, next) => {
    uploadMw(req, res, (err?: unknown) => {
      requestAuthContext.run(
        {
          sessionUserId: req.sessionUserId,
          apiKeyUserId: req.apiKeyUserId,
        },
        () => {
          if (err !== undefined) next(err);
          else next();
        },
      );
    });
  };
}
