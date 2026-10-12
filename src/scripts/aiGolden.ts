import "dotenv/config";
import { db, pool } from "../db/client.js";
import { resolveAssistantSession } from "../services/assistant/index.js";
import { assertPublicProviderBaseUrl } from "../services/assistant/providerBaseUrl.js";
import { runGoldenCases } from "../services/assistant/golden/run.js";

async function main(): Promise<void> {
  const session = await resolveAssistantSession(db);
  if (!session) {
    console.log("ai:golden skipped — no provider key is configured");
    return;
  }
  const results = await runGoldenCases({
    plugin: session.plugin,
    apiKey: session.apiKey,
    config: session.config,
    assertBaseUrl: assertPublicProviderBaseUrl,
    mode: "live",
  });
  for (const result of results) {
    console.log(`${result.ok ? "ok" : "fail"} ${result.id}: ${result.detail}`);
  }
  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
