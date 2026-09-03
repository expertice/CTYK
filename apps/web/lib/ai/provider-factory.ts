import type { LlmProvider, LlmProviderClient, LlmProviderResolveInput } from "./llm-engine";

class StubProviderClient implements LlmProviderClient {
  constructor(private readonly provider: LlmProvider) {}

  async complete(input: {
    model?: string;
    prompt: string;
    guardrailsProfile: "strict" | "balanced";
  }): Promise<{
    structuredOutput: Record<string, unknown>;
    usage: {
      promptTokens?: number;
      completionTokens?: number;
      costUsd?: number;
    };
    safety: {
      blocked: boolean;
      reasons?: string[];
    };
  }> {
    return {
      structuredOutput: {
        provider: this.provider,
        model: input.model ?? "default",
        preview: input.prompt.slice(0, 180),
        guardrailsProfile: input.guardrailsProfile,
      },
      usage: {
        promptTokens: Math.ceil(input.prompt.length / 4),
        completionTokens: 48,
        costUsd: 0,
      },
      safety: { blocked: false },
    };
  }
}

/** Клиент для локального OpenAI-совместимого /v1/chat/completions (Ollama, LM Studio, vLLM…). */
class OpenAiCompatibleClient implements LlmProviderClient {
  constructor(private readonly opts: { baseUrl: string; apiKey?: string }) {}

  private shouldDisableThinking(baseUrl: string): boolean {
    const u = baseUrl.toLowerCase();
    return u.includes("dashscope") || u.includes("qwen");
  }

  async complete(input: {
    model?: string;
    prompt: string;
    guardrailsProfile: "strict" | "balanced";
  }): Promise<{
    structuredOutput: Record<string, unknown>;
    usage: {
      promptTokens?: number;
      completionTokens?: number;
      costUsd?: number;
    };
    safety: {
      blocked: boolean;
      reasons?: string[];
    };
  }> {
    const root = this.opts.baseUrl.replace(/\/+$/, "");
    const url = `${root}/chat/completions`;
    const disableThinking = this.shouldDisableThinking(root);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.apiKey && this.opts.apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${this.opts.apiKey.trim()}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: input.prompt }],
        temperature: 0.2,
        ...(disableThinking ? { enable_thinking: false } : {}),
      }),
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`LLM request failed (${res.status}): ${rawText.slice(0, 400)}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new Error("LLM response is not valid JSON");
    }

    const o = data as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = o.choices?.[0]?.message?.content ?? "";
    let structuredOutput: Record<string, unknown>;
    try {
      structuredOutput = JSON.parse(text) as Record<string, unknown>;
    } catch {
      structuredOutput = { text, preview: text.slice(0, 500) };
    }

    return {
      structuredOutput,
      usage: {
        promptTokens: o.usage?.prompt_tokens,
        completionTokens: o.usage?.completion_tokens,
        costUsd: 0,
      },
      safety: { blocked: false },
    };
  }
}

export async function createProviderClient(hint?: LlmProvider): Promise<LlmProviderClient> {
  const provider = hint ?? parseProviderFromEnv();
  return new StubProviderClient(provider);
}

export async function resolveLlmProviderClient(input: LlmProviderResolveInput): Promise<LlmProviderClient> {
  const baseUrl = input.openAiCompatible?.baseUrl?.trim() ?? "";
  if (baseUrl.length > 0) {
    return new OpenAiCompatibleClient({
      baseUrl,
      apiKey: input.openAiCompatible?.apiKey?.trim() || undefined,
    });
  }
  return createProviderClient(input.providerHint);
}

function parseProviderFromEnv(): LlmProvider {
  const raw = (process.env.DEFAULT_LLM_PROVIDER ?? "openai").toLowerCase();
  if (raw === "openai" || raw === "anthropic" || raw === "google") {
    return raw;
  }
  return "openai";
}
