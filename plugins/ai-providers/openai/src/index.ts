import { z } from "zod";
import {
  createOpenAiCompatiblePlugin,
  publicHttpsBaseUrlSchema,
} from "@taskmesh/ai-provider-contract";

const configSchema = z.object({
  baseUrl: publicHttpsBaseUrlSchema().default("https://api.openai.com/v1"),
  defaultModel: z.string().trim().min(1).max(120).default("gpt-4.1-mini"),
});

export const plugin = createOpenAiCompatiblePlugin({
  id: "openai",
  displayName: "OpenAI",
  version: "1.0.0",
  configSchema,
});

export { configSchema };
