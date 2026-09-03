import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import type { ModuleId, Scenario } from "../../../types/pipeline.types";
import type { LlmTask } from "../../ai/llm-engine";
import { LlmEngineGateway } from "../../ai/llm-engine";
import { resolveLlmProviderClient } from "../../ai/provider-factory";
import { normalizeLlmModelName } from "../../llm/ollama-default-model";
import { mergePartialArtifactStore } from "../artifact-merge";
import { listSubtasksForPuppet } from "../llm-puppet-subtasks";
import { readLlmRunOrder } from "../llm-run-order";
import type { LlmBehaviorConfig } from "../llm-behavior-presets";
import {
  applySmallContextCompaction,
  buildArtifactsForLlmGateway,
  buildLlmOutputForModule,
  llmGatewayPrompts,
  mergeEmbeddedConfigIntoInstructionArtifact,
  resolveLlmTaskForModule,
  subtaskDetailLabel,
} from "./llm-engine.module";

/** Подключение и параметры контекста/модели берутся только с шага LLM_PUPPET, не с подзадач. */
const PUPPET_LLM_EXECUTION_KEYS: readonly (keyof LlmBehaviorConfig | "llmBaseUrl" | "llmApiKey" | "llmModel" | "llmSource")[] =
  [
    "llmBaseUrl",
    "llmApiKey",
    "llmModel",
    "llmSource",
    "llmBehaviorPreset",
    "optimizeForSmallContext",
    "targetContextTokens",
    "responseMaxTokens",
    "reserveTokensForOutputRatio",
    "compactGranularity",
    "maxWindowsPerSpeaker",
    "maxQuotesTotal",
    "includeRawSegmentsTail",
    "llmRequestTimeoutMs",
    "llmMaxRetries",
    "llmRetryBackoffMs",
    "llmAdaptiveDownshift",
    "maxReadySegmentsForLlm",
  ];

function applyPuppetExecutionOverrides(
  puppetConfig: Record<string, unknown>,
  mergedConfig: Record<string, unknown>,
): void {
  for (const k of PUPPET_LLM_EXECUTION_KEYS) {
    if (k in puppetConfig) mergedConfig[k] = puppetConfig[k];
  }
}

export class LlmPuppetModule implements IProcessingModule {
  readonly id: ModuleId = "LLM_PUPPET";
  private readonly gateway = new LlmEngineGateway(resolveLlmProviderClient, llmGatewayPrompts);

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
    scenario?: Scenario;
    onStepProgress?: (u: { stepId: string; detail?: string | null }) => void;
  }): Promise<Partial<ArtifactStore>> {
    const scenario = input.scenario;
    if (!scenario) throw new Error("LLM_PUPPET: сценарий не передан.");

    const subtasks = listSubtasksForPuppet(scenario, input.stepId);
    subtasks.sort((a, b) => {
      const da = readLlmRunOrder(a);
      const db = readLlmRunOrder(b);
      if (da !== db) return da - db;
      if (a.orderHint !== b.orderHint) return a.orderHint - b.orderHint;
      return a.id.localeCompare(b.id);
    });

    if (subtasks.length === 0) throw new Error("LLM_PUPPET: требуется хотя бы одна подключенная LLM подзадача.");

    const acc: Partial<ArtifactStore> = {};
    const n = subtasks.length;
    const baseUrl = typeof input.config.llmBaseUrl === "string" ? input.config.llmBaseUrl.trim() : "";
    const apiKey = typeof input.config.llmApiKey === "string" ? input.config.llmApiKey.trim() : "";

    for (let i = 0; i < subtasks.length; i++) {
      const taskStep = subtasks[i];
      const mergedConfig = { ...input.config, ...taskStep.config };
      /** Жёсткое правило: подключение, модель и параметры контекста — только из LLM_PUPPET. */
      applyPuppetExecutionOverrides(input.config, mergedConfig);
      const modelRaw = normalizeLlmModelName(
        typeof mergedConfig.llmModel === "string" ? mergedConfig.llmModel.trim() : "",
      );
      const model =
        modelRaw.length > 0
          ? modelRaw
          : typeof process.env.DEFAULT_LLM_MODEL === "string" && process.env.DEFAULT_LLM_MODEL.trim().length > 0
            ? process.env.DEFAULT_LLM_MODEL.trim()
            : undefined;

      input.onStepProgress?.({
        stepId: input.stepId,
        detail: `${i + 1}/${n}: ${subtaskDetailLabel(taskStep.moduleId)}`,
      });

      const task = resolveLlmTaskForModule(taskStep.moduleId, mergedConfig);
      const artifactsForPrompt = mergeEmbeddedConfigIntoInstructionArtifact(
        buildArtifactsForLlmGateway(input.artifacts, scenario, taskStep.id, task, mergedConfig),
        taskStep.moduleId,
        mergedConfig,
        taskStep.id,
        input.runId,
      );

      const compactedArtifactsForPrompt = applySmallContextCompaction(task, mergedConfig, artifactsForPrompt);
      assertPsychLlmInputsReady(task, mergedConfig, compactedArtifactsForPrompt);
      const response = await this.executeWithResilience({
        task,
        model,
        baseUrl,
        apiKey,
        sessionId: input.sessionId,
        runId: input.runId,
        stepId: taskStep.id,
        sourceModuleId: taskStep.moduleId,
        baseConfig: mergedConfig,
        baseArtifacts: compactedArtifactsForPrompt,
      });

      const now = new Date().toISOString();
      const output = response.output as Record<string, unknown>;
      const baseProducer = {
        moduleId: taskStep.moduleId,
        runId: input.runId,
        stepId: taskStep.id,
      };
      const part = buildLlmOutputForModule(
        taskStep.moduleId,
        task,
        output,
        mergedConfig,
        input.artifacts,
        baseProducer,
        now,
      );
      mergePartialArtifactStore(input.artifacts, part);
      Object.assign(acc, part);
    }

    input.onStepProgress?.({ stepId: input.stepId, detail: null });
    return acc;
  }

  private async executeWithResilience(input: {
    task: LlmTask;
    model: string | undefined;
    baseUrl: string;
    apiKey: string;
    sessionId: string;
    runId: string;
    stepId: string;
    sourceModuleId: ModuleId;
    baseConfig: Record<string, unknown>;
    baseArtifacts: ArtifactStore;
  }) {
    const timeoutMs = clampInt(input.baseConfig.llmRequestTimeoutMs, 120000, 30000, 600000);
    const maxRetries = clampInt(input.baseConfig.llmMaxRetries, 2, 0, 5);
    const backoffMs = clampInt(input.baseConfig.llmRetryBackoffMs, 2000, 250, 30000);
    const adaptiveDownshift = readBool(input.baseConfig.llmAdaptiveDownshift, true);
    const attempts = Math.max(1, maxRetries + 1);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const adapted = adaptConfigForAttempt(input.task, input.baseConfig, attempt, adaptiveDownshift);
      const adaptedArtifacts = applySmallContextCompaction(input.task, adapted, input.baseArtifacts);
      try {
        return await withTimeout(
          this.gateway.execute({
            task: input.task,
            guardrailsProfile: "balanced",
            model: input.model,
            openAiCompatible:
              input.baseUrl.length > 0
                ? { baseUrl: input.baseUrl, apiKey: input.apiKey.length > 0 ? input.apiKey : undefined }
                : undefined,
            input: {
              config: adapted,
              artifacts: adaptedArtifacts,
            },
            trace: {
              sessionId: input.sessionId,
              runId: input.runId,
              stepId: input.stepId,
              sourceModuleId: input.sourceModuleId,
            },
          }),
          timeoutMs,
          `LLM timeout after ${timeoutMs}ms (step=${input.stepId}, task=${input.task}, module=${input.sourceModuleId})`,
        );
      } catch (e) {
        lastError = e;
        if (attempt >= attempts || !isTransientLlmError(e)) break;
        await sleep(backoffMs * Math.pow(2, attempt - 1));
      }
    }
    const msg = lastError instanceof Error ? lastError.message : String(lastError ?? "LLM call failed");
    throw new Error(`LLM ${input.task} @${input.stepId}/${input.sourceModuleId}: ${msg}`);
  }
}

function assertPsychLlmInputsReady(task: LlmTask, config: Record<string, unknown>, artifacts: ArtifactStore): void {
  if (task !== "psych_state") return;
  if (artifacts.READY_SPEAKERS?.status !== "ready") {
    throw new Error("LLM psych_state: требуется READY_SPEAKERS.");
  }
  const psychMode = config.psychMode === "full_psycho_analytics" ? "full_psycho_analytics" : "default";
  const enr = artifacts.ENRICHED_TRANSCRIPT;
  const enrOk = enr?.status === "ready";
  const enrData = enr?.data && typeof enr.data === "object" ? (enr.data as Record<string, unknown>) : null;
  const hasSegs = Array.isArray(enrData?.segments) && (enrData!.segments as unknown[]).length > 0;
  if (psychMode === "full_psycho_analytics" && (!enrOk || !hasSegs)) {
    throw new Error("LLM psych_state full_psycho_analytics: требуется ENRICHED_TRANSCRIPT с непустыми segments.");
  }
  const psych = artifacts.PSYCH_LABELS?.data;
  const psychRec =
    psych && typeof psych === "object" && !Array.isArray(psych) ? (psych as Record<string, unknown>) : null;
  const hasMatcher = psychRec?.kind === "psych_matcher_v1";
  if (!hasMatcher && (!enrOk || !hasSegs)) {
    throw new Error(
      "LLM psych_state: нужен PSYCH_LABELS (psych_matcher_v1) от PSYCH_STATE либо ENRICHED_TRANSCRIPT с непустыми segments.",
    );
  }
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function readBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function isTransientLlmError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /fetch failed|timeout|timed out|econn|socket|network|reset|aborted/i.test(msg);
}

function adaptConfigForAttempt(
  task: LlmTask,
  config: Record<string, unknown>,
  attempt: number,
  adaptiveDownshift: boolean,
): Record<string, unknown> {
  if (attempt <= 1 || !adaptiveDownshift) return config;
  if (task === "psych_state") {
    const tc = clampInt(config.targetContextTokens, 4000, 512, 64000);
    const rm = clampInt(config.responseMaxTokens, 900, 200, 4000);
    const factor = Math.pow(0.72, attempt - 1);
    return {
      ...config,
      optimizeForSmallContext: true,
      compactGranularity: "coarse",
      includeRawSegmentsTail: false,
      maxWindowsPerSpeaker: Math.max(3, clampInt(config.maxWindowsPerSpeaker, 6, 2, 20) - attempt + 1),
      maxQuotesTotal: Math.max(4, clampInt(config.maxQuotesTotal, 12, 0, 40) - attempt * 2),
      targetContextTokens: Math.max(1200, Math.round(tc * factor)),
      responseMaxTokens: Math.max(350, Math.round(rm * Math.max(0.65, factor))),
    };
  }
  if (task === "summary" || task === "checklist_analysis" || task === "speaker_names") {
    const cap = clampInt(config.maxReadySegmentsForLlm, 120, 20, 600);
    const shrunk = Math.max(24, Math.round(cap * Math.pow(0.72, attempt - 1)));
    return {
      ...config,
      optimizeForSmallContext: true,
      maxReadySegmentsForLlm: shrunk,
    };
  }
  return config;
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), timeoutMs);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
