import "dotenv/config";
import { db, pool } from "../db/client.js";
import {
  AiCredentialsRotationError,
  rotateAiCredentialsKey,
  type RotateResult,
} from "../services/assistant/rotateAiCredentialsKey.js";

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function printResult(result: RotateResult, apply: boolean): void {
  const counts = `${countLabel(result.instanceCount, "instance key")} and ${countLabel(result.userCount, "user key")}`;
  for (const failure of result.failures) {
    if (failure.kind === "instance") {
      console.error(`Could not decrypt instance key for plugin ${failure.pluginId}.`);
    } else {
      console.error(`Could not decrypt user key for user ${failure.userId}, plugin ${failure.pluginId}.`);
    }
  }
  if (result.failures.length > 0) {
    console.error("No rows were written.");
    return;
  }
  if (!apply) {
    console.log(`Dry run: ${counts} would be re-encrypted. No rows were written.`);
    console.log("Re-run with --apply to write.");
    return;
  }
  console.log(`Re-encrypted ${counts}.`);
  console.log(
    "Set AI_CREDENTIALS_KEY to the value of AI_CREDENTIALS_KEY_NEXT, remove AI_CREDENTIALS_KEY_NEXT, and restart TaskMesh.",
  );
}

const apply = process.argv.includes("--apply");
const currentKey = process.env.AI_CREDENTIALS_KEY ?? "";
const nextKey = process.env.AI_CREDENTIALS_KEY_NEXT ?? "";

try {
  const result = await rotateAiCredentialsKey(db, { currentKey, nextKey, apply });
  printResult(result, apply);
  await pool.end();
  process.exit(result.failures.length > 0 ? 1 : 0);
} catch (err) {
  const message = err instanceof AiCredentialsRotationError ? err.message : "Key rotation failed.";
  console.error(message);
  await pool.end();
  process.exit(1);
}
