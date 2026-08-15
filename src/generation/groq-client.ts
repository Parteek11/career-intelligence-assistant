import "server-only";

import { GenerationError } from "@/generation/errors";
import type { AnalysisLLMProvider, GroundedPrompt, TokenUsage } from "@/generation/types";

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

type GroqChatCompletionResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

/**
 * Minimal Groq client. No SDK is added — Groq's API is OpenAI-compatible
 * chat completions over plain HTTP, so a single fetch call is enough and
 * keeps dependencies minimal. Implements AnalysisLLMProvider so the model
 * (or provider) can be swapped later without touching callers.
 */
export class GroqChatProvider implements AnalysisLLMProvider {
  private readonly apiKey: string;
  readonly model: string;
  lastUsage: TokenUsage | null = null;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;

    if (!apiKey) {
      throw new GenerationError(
        "GROQ_API_KEY is not set. Copy .env.example to .env and add a Groq API key.",
      );
    }

    this.apiKey = apiKey;
    this.model = options.model ?? process.env.GROQ_MODEL ?? DEFAULT_MODEL;
  }

  async generate(prompt: GroundedPrompt): Promise<string> {
    this.lastUsage = null;
    let response: Response;

    try {
      response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        }),
      });
    } catch (error) {
      throw new GenerationError("Failed to reach Groq", { cause: error });
    }

    if (!response.ok) {
      const body = await safeReadText(response);
      throw new GenerationError(
        `Groq request failed with status ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
      );
    }

    const payload = (await response.json()) as GroqChatCompletionResponse;
    this.lastUsage = readTokenUsage(payload.usage);
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new GenerationError("Groq response did not include message content");
    }

    return content;
  }
}

function readTokenUsage(
  usage: GroqChatCompletionResponse["usage"],
): TokenUsage | null {
  if (!usage) {
    return null;
  }

  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

let defaultProvider: AnalysisLLMProvider | null = null;

/** Single shared provider instance, constructed lazily so a missing API key
 * only surfaces when generation is actually attempted. */
export function getDefaultAnalysisProvider(): AnalysisLLMProvider {
  if (!defaultProvider) {
    defaultProvider = new GroqChatProvider();
  }

  return defaultProvider;
}
