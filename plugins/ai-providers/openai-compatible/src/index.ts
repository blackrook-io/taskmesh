import { z } from "zod";
import {
  createOpenAiCompatiblePlugin,
  publicHttpsBaseUrlSchema,
} from "@taskmesh/ai-provider-contract";

/** No default host. Administrator config supplies the public https base URL. */
const configSchema = z.object({
  baseUrl: publicHttpsBaseUrlSchema(),
  defaultModel: z.string().trim().min(1).max(120),
});

export const plugin = createOpenAiCompatiblePlugin({
  id: "openai-compatible",
  displayName: "OpenAI-compatible",
  version: "1.0.0",
  configSchema,
});

export { configSchema };
