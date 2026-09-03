import type { ModuleId } from "../../types/pipeline.types";
import { LLM_TASK_SATELLITE_MODULE_IDS } from "./llm-task-contracts";

/** Узел, внутри которого последовательно вызывается модель (подзадачи по графу). */
export const LLM_PUPPET_MODULE_IDS: ModuleId[] = ["LLM_PUPPET"];

/** Спутники: только граф и конфиг; исполнение на `LLM_PUPPET`. */
export const LLM_TASK_SATELLITE_IDS: ModuleId[] = [
  ...LLM_TASK_SATELLITE_MODULE_IDS,
];

export function isLlmPuppetModule(moduleId: ModuleId): boolean {
  return (LLM_PUPPET_MODULE_IDS as readonly string[]).includes(moduleId);
}

export function isLlmTaskSatellite(moduleId: ModuleId): boolean {
  return (LLM_TASK_SATELLITE_IDS as readonly string[]).includes(moduleId);
}

/** Ветка LLM на холсте: пульт + подзадачи (порты LLM_INSTRUCTIONS, порядок). */
export function isLlmGraphLlmBranchModule(moduleId: ModuleId): boolean {
  return isLlmPuppetModule(moduleId) || isLlmTaskSatellite(moduleId);
}
