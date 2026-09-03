import type { ModuleId, ScenarioStep } from "../../types/pipeline.types";

/**
 * Чем меньше число — тем раньше выполняется подзадача внутри одного `LLM_PUPPET`
 * (при отсутствии зависимости по рёбрам между подзадачами).
 */
const DEFAULT_LLM_RUN_ORDER_BY_MODULE: Partial<Record<ModuleId, number>> = {
  LLM_TASK_SPEAKER_NAMES: 10,
  LLM_TASK_SUMMARY: 20,
  LLM_TASK_CHECKLIST: 25,
  LLM_TASK_PSYCH: 30,
  LLM_PUPPET: 100,
};

export function defaultLlmRunOrder(moduleId: ModuleId): number {
  return DEFAULT_LLM_RUN_ORDER_BY_MODULE[moduleId] ?? 100;
}

export function readLlmRunOrder(step: ScenarioStep): number {
  const v = step.config?.llmRunOrder;
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  return defaultLlmRunOrder(step.moduleId);
}
