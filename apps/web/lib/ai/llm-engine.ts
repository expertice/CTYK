import type { ModuleId } from "../../types/pipeline.types";

export type LlmProvider = "openai" | "anthropic" | "google";
export type LlmTask = "summary" | "checklist_analysis" | "psych_state" | "speaker_names";

export type LlmOpenAiCompatibleEndpoint = {
  baseUrl: string;
  apiKey?: string;
};

export type LlmProviderResolveInput = {
  providerHint?: LlmProvider;
  openAiCompatible?: LlmOpenAiCompatibleEndpoint;
};

export interface LlmTaskRequest {
  task: LlmTask;
  providerHint?: LlmProvider;
  model?: string;
  openAiCompatible?: LlmOpenAiCompatibleEndpoint;
  input: Record<string, unknown>;
  guardrailsProfile: "strict" | "balanced";
  trace: {
    sessionId: string;
    runId: string;
    stepId: string;
    sourceModuleId: ModuleId;
  };
}

export interface LlmTaskResponse {
  output: Record<string, unknown>;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
  };
  safety: {
    blocked: boolean;
    reasons?: string[];
  };
  promptVersion: string;
}

interface PromptTemplate {
  promptId: string;
  version: string;
  render(input: Record<string, unknown>): string;
}

export class LlmEngineGateway {
  constructor(
    private readonly providerResolver: (input: LlmProviderResolveInput) => Promise<LlmProviderClient>,
    private readonly prompts: Record<LlmTask, PromptTemplate>,
  ) {}

  async execute(request: LlmTaskRequest): Promise<LlmTaskResponse> {
    const promptTemplate = this.prompts[request.task];
    if (!promptTemplate) {
      throw new Error(`Prompt template for task ${request.task} is not configured`);
    }

    const prompt = promptTemplate.render(request.input);
    const promptChars = prompt.length;
    console.warn(
      `[ctyk.llm] task=${request.task} stepId=${request.trace.stepId} sourceModuleId=${request.trace.sourceModuleId} sessionId=${request.trace.sessionId} promptChars=${String(promptChars)}`,
    );
    const client = await this.providerResolver({
      providerHint: request.providerHint,
      openAiCompatible: request.openAiCompatible,
    });

    const providerResponse = await client.complete({
      model: request.model,
      prompt,
      guardrailsProfile: request.guardrailsProfile,
    });

    return {
      output: providerResponse.structuredOutput,
      usage: providerResponse.usage,
      safety: providerResponse.safety,
      promptVersion: `${promptTemplate.promptId}:${promptTemplate.version}`,
    };
  }
}

export interface LlmProviderClient {
  complete(input: {
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
  }>;
}
