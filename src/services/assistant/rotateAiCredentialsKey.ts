import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import {
  aiCredentialsKeyFromPassphrase,
  decryptAiSecretWithKey,
  encryptAiSecretWithKey,
} from "../../lib/aiCredentialsCrypto.js";
import { ENV_KEY_MIN_LENGTH } from "../../lib/envKeys.js";

type Db = NodePgDatabase<typeof schema>;

export class AiCredentialsRotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiCredentialsRotationError";
  }
}

export type RotateFailure = {
  kind: "instance" | "user";
  pluginId: string;
  userId: number | null;
};

export type RotateResult = {
  /** True only when ciphertext was written. */
  wrote: boolean;
  instanceCount: number;
  userCount: number;
  failures: RotateFailure[];
};

function requirePassphrase(name: string, raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed.length < ENV_KEY_MIN_LENGTH) {
    throw new AiCredentialsRotationError(
      `${name} must be at least ${ENV_KEY_MIN_LENGTH} characters.`,
    );
  }
  return aiCredentialsKeyFromPassphrase(trimmed);
}

/**
 * Re-encrypt every stored instance and user provider key.
 * Dry run (apply false) writes nothing. A decrypt failure writes nothing.
 */
export async function rotateAiCredentialsKey(
  db: Db,
  args: {
    currentKey: string;
    nextKey: string;
    apply: boolean;
    /** Limit the scan to these plugin ids. The CLI omits this and rotates every row. */
    pluginIds?: string[];
  },
): Promise<RotateResult> {
  if (args.currentKey.trim() === args.nextKey.trim()) {
    throw new AiCredentialsRotationError(
      "AI_CREDENTIALS_KEY_NEXT must be different from AI_CREDENTIALS_KEY.",
    );
  }
  const current = requirePassphrase("AI_CREDENTIALS_KEY", args.currentKey);
  const next = requirePassphrase("AI_CREDENTIALS_KEY_NEXT", args.nextKey);

  const pluginIds = args.pluginIds;
  const instanceQuery = db
    .select({
      pluginId: schema.aiInstanceCredentials.pluginId,
      secretEnc: schema.aiInstanceCredentials.secretEnc,
    })
    .from(schema.aiInstanceCredentials);
  const userQuery = db
    .select({
      userId: schema.userAiCredentials.userId,
      pluginId: schema.userAiCredentials.pluginId,
      secretEnc: schema.userAiCredentials.secretEnc,
    })
    .from(schema.userAiCredentials);
  const instanceRows = pluginIds
    ? await instanceQuery.where(inArray(schema.aiInstanceCredentials.pluginId, pluginIds))
    : await instanceQuery;
  const userRows = pluginIds
    ? await userQuery.where(inArray(schema.userAiCredentials.pluginId, pluginIds))
    : await userQuery;

  const failures: RotateFailure[] = [];
  const instanceUpdates: { pluginId: string; secretEnc: string }[] = [];
  const userUpdates: { userId: number; pluginId: string; secretEnc: string }[] = [];

  for (const row of instanceRows) {
    try {
      const plain = decryptAiSecretWithKey(row.secretEnc, current);
      instanceUpdates.push({
        pluginId: row.pluginId,
        secretEnc: encryptAiSecretWithKey(plain, next),
      });
    } catch {
      failures.push({ kind: "instance", pluginId: row.pluginId, userId: null });
    }
  }
  for (const row of userRows) {
    try {
      const plain = decryptAiSecretWithKey(row.secretEnc, current);
      userUpdates.push({
        userId: row.userId,
        pluginId: row.pluginId,
        secretEnc: encryptAiSecretWithKey(plain, next),
      });
    } catch {
      failures.push({ kind: "user", pluginId: row.pluginId, userId: row.userId });
    }
  }

  if (!args.apply || failures.length > 0) {
    return {
      wrote: false,
      instanceCount: instanceUpdates.length,
      userCount: userUpdates.length,
      failures,
    };
  }

  await db.transaction(async (tx) => {
    for (const row of instanceUpdates) {
      await tx
        .update(schema.aiInstanceCredentials)
        .set({ secretEnc: row.secretEnc })
        .where(eq(schema.aiInstanceCredentials.pluginId, row.pluginId));
    }
    for (const row of userUpdates) {
      await tx
        .update(schema.userAiCredentials)
        .set({ secretEnc: row.secretEnc })
        .where(
          and(
            eq(schema.userAiCredentials.userId, row.userId),
            eq(schema.userAiCredentials.pluginId, row.pluginId),
          ),
        );
    }
  });

  return {
    wrote: true,
    instanceCount: instanceUpdates.length,
    userCount: userUpdates.length,
    failures: [],
  };
}
