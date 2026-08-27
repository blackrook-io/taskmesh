/**
 * Admin API key operations — thin re-exports of the shared apiKeys service (T0063).
 * Prefer importing from `./apiKeys.js` for new code.
 */
export {
  listAllApiKeys as listAdminApiKeys,
  createApiKeyForUser as createAdminApiKey,
  suspendApiKey,
  unsuspendApiKey,
  expireApiKey,
  revokeApiKey,
  deleteApiKeyRecord,
  updateApiKeyExpiry,
  parseApiKeyExpiresAt,
  type ApiKeyRow as AdminApiKeyRow,
  type ApiKeyStatus,
} from "./apiKeys.js";
