import { AsyncLocalStorage } from "node:async_hooks";

type AuthContext = {
  sessionUserId?: number;
  /** Set when T0063 API key auth succeeds. */
  apiKeyUserId?: number;
};

export const requestAuthContext = new AsyncLocalStorage<AuthContext>();

export function getRequestSessionUserId(): number | undefined {
  return requestAuthContext.getStore()?.sessionUserId;
}

export function getRequestApiKeyUserId(): number | undefined {
  return requestAuthContext.getStore()?.apiKeyUserId;
}
