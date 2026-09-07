import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Provider-agnostic model factory.
 *
 * Pick an LLM from the keys present in the environment. The first provider with
 * a configured API key wins:
 *
 *   ANTHROPIC_API_KEY    -> Anthropic (Claude)            - first class SDK
 *   OPENAI_API_KEY       -> OpenAI                        - first class SDK
 *   LLM_API_KEY          -> LiteLLM proxy (or any         - OpenAI-compatible
 *                           OpenAI-compatible endpoint)     via LLM_BASE_URL
 *   ZAI_API_KEY          -> Z.ai GLM                      - OpenAI-compatible
 *                           (backwards-compatible default)
 *
 * The Z.ai and LiteLLM providers are OpenAI-compatible and pipe through
 * createOpenAICompatible, so you can also point them at any other OpenAI-
 * compatible base URL via the corresponding _BASE_URL/_MODEL overrides.
 */
export function getModel(): LanguageModel {
  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5");
  }

  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    return openai(process.env.OPENAI_MODEL ?? "gpt-4o");
  }

  if (process.env.LLM_API_KEY) {
    const litellm = createOpenAICompatible({
      name: "litellm",
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL ?? "https://api.litellm.ai/v1",
    });
    return litellm(process.env.LLM_MODEL ?? "gpt-4o");
  }

  const zai = createOpenAICompatible({
    name: "zai",
    apiKey: process.env.ZAI_API_KEY,
    baseURL: process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4",
  });
  return zai(process.env.ZAI_MODEL ?? "glm-5.3-flash");
}

/**
 * True if the given bearer token matches any of the configured provider API
 * keys. MCP and A2A endpoints authenticate against whatever key the deployer
 * set, so clients can present the same key they configured for the LLM.
 */
export function isValidProviderKey(token: string | undefined): boolean {
  if (!token) return false;
  const keys = [
    process.env.ZAI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.LLM_API_KEY,
  ].filter(Boolean) as string[];
  return keys.includes(token);
}