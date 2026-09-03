import type { ArtifactTypeId } from "../../types/artifact.types";
import type { ModuleId } from "../../types/pipeline.types";
import type { LlmTask } from "../ai/llm-engine";

type LlmTaskSatelliteModuleId =
  | "LLM_TASK_SUMMARY"
  | "LLM_TASK_SPEAKER_NAMES"
  | "LLM_TASK_PSYCH"
  | "LLM_TASK_CHECKLIST";

export interface LlmTaskContract {
  moduleId: LlmTaskSatelliteModuleId;
  llmTask: LlmTask;
  detailLabel: string;
  inputArtifacts: ArtifactTypeId[];
  outputArtifacts: ArtifactTypeId[];
  outputSchema: string;
}

export const LLM_TASK_CONTRACTS: readonly LlmTaskContract[] = [
  {
    moduleId: "LLM_TASK_SUMMARY",
    llmTask: "summary",
    detailLabel: "обобщение",
    inputArtifacts: ["READY_SPEAKERS"],
    outputArtifacts: ["SUMMARY_TEXT", "LLM_SUMMARY", "LLM_SUBTASK"],
    outputSchema:
      "LLM_SUMMARY.data = { scenario: string; subScenario: string; sections: Array<{ id: string; title: string; items: unknown[] }>; quality?: { notes?: string; doNotInfer?: string[] } }",
  },
  {
    moduleId: "LLM_TASK_SPEAKER_NAMES",
    llmTask: "speaker_names",
    detailLabel: "деанон",
    inputArtifacts: ["READY_SPEAKERS"],
    outputArtifacts: ["SPEAKER_IDENTITY_MAP", "LLM_SUBTASK"],
    outputSchema:
      "SPEAKER_IDENTITY_MAP.data = { entries: Array<{ speakerId: string; displayName: string; role: string }> }",
  },
  {
    moduleId: "LLM_TASK_PSYCH",
    llmTask: "psych_state",
    detailLabel: "разбор (LLM)",
    inputArtifacts: ["READY_SPEAKERS", "PSYCH_LABELS", "ENRICHED_TRANSCRIPT"],
    outputArtifacts: ["LLM_PSYCH_LABELS", "LLM_PSYCH_NARRATIVE", "LLM_PSYCH_FULL_V1", "LLM_SUBTASK"],
    outputSchema:
      "mode=default: LLM_PSYCH_NARRATIVE.data = { interpretationPolicy: 'assistive_non_diagnostic'; text: string; timelineEvents: Array<{ startSec: number; endSec: number; summary: string; actors?: string[]; tensionDelta?: 'up'|'down'|'flat' }>; segmentComments?: Array<{ speakerId: string; startSec: number; endSec: number; summary: string; tensionDelta?: 'up'|'down'|'flat'; patternIds?: string[]; confidence?: number }> }. mode=full_psycho_analytics: + LLM_PSYCH_FULL_V1.data = { phases: unknown[]; episodes: unknown[]; participants: unknown[]; globalCommentary: string; disclaimers: string[] }",
  },
  {
    moduleId: "LLM_TASK_CHECKLIST",
    llmTask: "checklist_analysis",
    detailLabel: "чек-лист",
    inputArtifacts: ["READY_SPEAKERS", "CHECKLIST_DEFINITION"],
    outputArtifacts: ["CHECKLIST_RESULTS", "LLM_SUBTASK"],
    outputSchema:
      "CHECKLIST_RESULTS.data = Array<{ itemId: string; itemText: string; status: 'present'|'uncertain'|'absent'; priority: 'critical'|'important'|'optional'; comment: string; evidence: Array<{ startSec: number; endSec: number; quote?: string }> }>",
  },
];

const CONTRACT_BY_MODULE = new Map<ModuleId, LlmTaskContract>(
  LLM_TASK_CONTRACTS.map((c) => [c.moduleId, c]),
);

export function getLlmTaskContract(moduleId: ModuleId): LlmTaskContract | null {
  return CONTRACT_BY_MODULE.get(moduleId) ?? null;
}

export function getLlmTaskForSatellite(moduleId: ModuleId): LlmTask | null {
  return getLlmTaskContract(moduleId)?.llmTask ?? null;
}

export function getLlmTaskDetailLabel(moduleId: ModuleId): string | null {
  return getLlmTaskContract(moduleId)?.detailLabel ?? null;
}

export const LLM_TASK_SATELLITE_MODULE_IDS: readonly LlmTaskSatelliteModuleId[] =
  LLM_TASK_CONTRACTS.map((c) => c.moduleId);

