import { AsyncLocalStorage } from "node:async_hooks";

type AuthContext = {
  sessionUserId?: number;
};

export const requestAuthContext = new AsyncLocalStorage<AuthContext>();

export function getRequestSessionUserId(): number | undefined {
  return requestAuthContext.getStore()?.sessionUserId;
}
