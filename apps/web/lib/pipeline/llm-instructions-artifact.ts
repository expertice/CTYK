import type { ArtifactStore } from "../../types/artifact.types";
import type { ModuleId } from "../../types/pipeline.types";

/** Один фрагмент текста задания для LLM (ребро LLM_INSTRUCTIONS и/или поля config на пульте). */
export type LlmInstructionPart = {
  stepId: string;
  moduleId: ModuleId;
  /** Логический ярлык: summary, speaker_names, checklist_focus, … */
  intent: string;
  prompt: string;
};

export type LlmInstructionsData = {
  parts: LlmInstructionPart[];
};

function isInstructionPart(x: unknown): x is LlmInstructionPart {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.stepId === "string" &&
    typeof o.moduleId === "string" &&
    typeof o.intent === "string" &&
    typeof o.prompt === "string"
  );
}

/** Извлекает части из `LLM_INSTRUCTIONS.data` (или сырого объекта с полем parts). */
export function parseLlmInstructionParts(data: unknown): LlmInstructionPart[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as LlmInstructionsData).parts)) return [];
  return ((data as LlmInstructionsData).parts as unknown[]).filter(isInstructionPart);
}

export function mergeLlmInstructionsData(prev: unknown, incoming: unknown): LlmInstructionsData {
  const prevParts = Array.isArray((prev as LlmInstructionsData | undefined)?.parts)
    ? ((prev as LlmInstructionsData).parts as unknown[]).filter(isInstructionPart)
    : [];
  const incParts = Array.isArray((incoming as LlmInstructionsData | undefined)?.parts)
    ? ((incoming as LlmInstructionsData).parts as unknown[]).filter(isInstructionPart)
    : [];
  const byStep = new Map<string, LlmInstructionPart>();
  for (const p of prevParts) {
    if (p.prompt.trim().length > 0) byStep.set(p.stepId, p);
  }
  for (const p of incParts) {
    if (p.prompt.trim().length > 0) {
      byStep.set(p.stepId, p);
    } else {
      byStep.delete(p.stepId);
    }
  }
  return { parts: [...byStep.values()].sort((a, b) => a.stepId.localeCompare(b.stepId, undefined, { sensitivity: "base" })) };
}

export function formatLlmInstructionBlock(data: LlmInstructionsData | undefined): string {
  if (!data?.parts?.length) return "";
  return data.parts
    .filter((p) => p.prompt.trim().length > 0)
    .map((p) => `### ${p.intent} [${p.moduleId} / ${p.stepId}]\n${p.prompt.trim()}`)
    .join("\n\n");
}

/** Собирает пользовательский промпт для LLM: инструкции из графа + JSON с данными (без дублирования LLM_INSTRUCTIONS). */
export function buildLlmBundlePrompt(input: Record<string, unknown>): string {
  const artifacts = input.artifacts as ArtifactStore | undefined;
  const config = input.config;
  const raw = artifacts?.LLM_INSTRUCTIONS?.data;
  const data =
    raw && typeof raw === "object" && Array.isArray((raw as LlmInstructionsData).parts)
      ? (raw as LlmInstructionsData)
      : undefined;
  const block = formatLlmInstructionBlock(data);

  const rest: ArtifactStore = { ...(artifacts ?? {}) };
  delete rest.LLM_INSTRUCTIONS;

  const payload = {
    config,
    artifacts: rest,
  };
  const json = JSON.stringify(payload);

  if (!block.trim()) {
    return json;
  }

  return [
    "Follow the scenario instructions below first. Then use the JSON payload (config + artifacts).",
    "",
    block,
    "",
    "--- payload (instructions omitted from artifacts) ---",
    json,
  ].join("\n");
}
