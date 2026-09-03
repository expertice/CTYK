import type { ArtifactTypeId } from "../../types/artifact.types";
import type { Scenario, ScenarioStep } from "../../types/pipeline.types";
import { PIPELINE_MODULE_CATALOG } from "./module-catalog";
import { DEFAULT_PROCESS_SETTINGS } from "./process-settings";
import { REPORT_OUTPUT_ACCEPTED_INPUTS } from "./report-output-inputs";
import { hasInvalidLlmSubtaskRunOrder } from "./llm-puppet-subtasks";
import {
  incomingSatisfiesAsrRequire,
  incomingSatisfiesSpeakerDraftEditRequire,
  incomingSatisfiesSpeakerTurnMergeRequire,
} from "./step-inbound-artifacts";

export type ValidationErrorCode =
  | "cycle_detected"
  | "missing_required_artifact"
  | "edge_artifact_mismatch"
  | "duplicate_step_code"
  | "unreachable_step"
  | "llm_subtask_order_invalid"
  | "llm_puppet_subtask_missing";

export interface ScenarioValidationError {
  code: ValidationErrorCode;
  message: string;
  stepId?: string;
  edgeId?: string;
  artifactTypeId?: ArtifactTypeId;
}

export interface ScenarioValidationResult {
  valid: boolean;
  errors: ScenarioValidationError[];
}

export interface ScenarioValidationProcessOptions {
  enforceEdgeTypeCompatibility: boolean;
  showUniversalInputForReport: boolean;
}

const DEFAULT_PROCESS_OPTIONS: ScenarioValidationProcessOptions = {
  enforceEdgeTypeCompatibility: DEFAULT_PROCESS_SETTINGS.enforceEdgeTypeCompatibility,
  showUniversalInputForReport: DEFAULT_PROCESS_SETTINGS.showUniversalInputForReport,
};

const ROOT_ARTIFACT_TYPES = new Set<ArtifactTypeId>(["AUDIO", "AUDIO_SOURCE"]);

function moduleDisplayName(moduleId: string): string {
  return PIPELINE_MODULE_CATALOG.find((m) => m.id === moduleId)?.label ?? moduleId;
}

function artifactDisplayName(t: ArtifactTypeId): string {
  const map: Record<ArtifactTypeId, string> = {
    AUDIO_SOURCE: "источник аудио (AUDIO_SOURCE)",
    AUDIO: "сырое аудио (AUDIO)",
    AUDIO_PREPARED: "подготовленное аудио (AUDIO_PREPARED)",
    TEXT: "текст (TEXT)",
    SPEAKER_SEGMENTS: "сегменты спикеров (SPEAKER_SEGMENTS)",
    DRAFT_SPEAKERS: "черновик реплик для ручной правки (DRAFT_SPEAKERS)",
    READY_SPEAKERS: "слитые реплики после автослияния (READY_SPEAKERS)",
    TRANSCRIPT_SEGMENTS: "канонические сегменты транскрипта (TRANSCRIPT_SEGMENTS)",
    ENRICHED_TRANSCRIPT: "обогащённый транскрипт (ENRICHED_TRANSCRIPT)",
    PSYCH_LABELS: "психо-метки (PSYCH_LABELS)",
    PSYCH_NARRATIVE: "психо-нарратив (PSYCH_NARRATIVE)",
    CHECKLIST_DEFINITION: "чек-лист (CHECKLIST_DEFINITION)",
    CHECKLIST_RESULTS: "результаты чек-листа (CHECKLIST_RESULTS)",
    LLM_INSTRUCTIONS: "инструкции для LLM (LLM_INSTRUCTIONS)",
    LLM_SUBTASK: "связь подзадачи с пультом LLM (LLM_SUBTASK)",
    SUMMARY_TEXT: "резюме (SUMMARY_TEXT)",
    LLM_SUMMARY: "структурированное резюме LLM (LLM_SUMMARY)",
    SPEAKER_IDENTITY_MAP: "карта имён спикеров (SPEAKER_IDENTITY_MAP)",
    LLM_PSYCH_LABELS: "психо-метки от LLM (LLM_PSYCH_LABELS)",
    LLM_PSYCH_NARRATIVE: "психо-нарратив от LLM (LLM_PSYCH_NARRATIVE)",
    LLM_PSYCH_FULL_V1: "расширенный психо-артефакт LLM (LLM_PSYCH_FULL_V1)",
    STRUCTURED_FEATURES: "структурированные признаки (STRUCTURED_FEATURES)",
    SESSION_REPORT: "отчёт (SESSION_REPORT)",
  };
  return map[t] ?? t;
}

function stepSummary(step: ScenarioStep): string {
  const mod = moduleDisplayName(step.moduleId);
  return `«${mod}», код шага «${step.code}»`;
}

function validateReportOutputIncoming(step: ScenarioStep, scenario: Scenario): ScenarioValidationError[] {
  const errs: ScenarioValidationError[] = [];
  const incoming = collectIncomingArtifacts(step.id, scenario);
  const nonRootRequires = step.requires.filter((r) => !ROOT_ARTIFACT_TYPES.has(r));
  const allowSet = new Set<ArtifactTypeId>(
    nonRootRequires.length > 0 ? nonRootRequires : REPORT_OUTPUT_ACCEPTED_INPUTS,
  );
  const matched = [...incoming].filter((t) => allowSet.has(t));

  const reportLabel = moduleDisplayName("REPORT_OUTPUT");

  if (incoming.size === 0) {
    errs.push({
      code: "missing_required_artifact",
      message: `Модуль ${reportLabel} (${stepSummary(step)}): ни одно входящее ребро не подключено. Проведите хотя бы одно ребро на вход отчёта (например TEXT, SPEAKER_SEGMENTS, обогащённый транскрипт или SUMMARY_TEXT).`,
      stepId: step.id,
    });
    return errs;
  }

  if (matched.length === 0) {
    const incomingRu = [...incoming].map(artifactDisplayName).join("; ");
    const expectedRu = [...allowSet].map(artifactDisplayName).join("; ");
    errs.push({
      code: "missing_required_artifact",
      message: `Модуль ${reportLabel} (${stepSummary(step)}): по рёбрам приходит ${incomingRu}, а для отчёта нужен хотя бы один допустимый тип: ${expectedRu}.`,
      stepId: step.id,
    });
  }

  return errs;
}

export function validateScenarioGraph(
  scenario: Scenario,
  process: Partial<ScenarioValidationProcessOptions> = {},
): ScenarioValidationResult {
  const opts = { ...DEFAULT_PROCESS_OPTIONS, ...process };
  const errors: ScenarioValidationError[] = [];
  const stepById = new Map(scenario.steps.map((step) => [step.id, step]));

  const duplicateCodes = findDuplicateStepCodesWithStepIds(scenario);
  duplicateCodes.forEach(({ code, stepIds }) => {
    errors.push({
      code: "duplicate_step_code",
      message: `Код шага «${code}» задан у нескольких модулей сразу (${stepIds.join(", ")}). У каждого шага должен быть уникальный «code» (поле в форме / JSON).`,
    });
  });

  if (hasInvalidLlmSubtaskRunOrder(scenario)) {
    errors.push({
      code: "llm_subtask_order_invalid",
      message:
        "Порядок LLM-подзадач для пульта задан некорректно. Номера llmRunOrder должны быть уникальными и непрерывными в диапазоне 1..N.",
    });
  }

  for (const edge of scenario.edges) {
    const fromStep = stepById.get(edge.fromStepId);
    const toStep = stepById.get(edge.toStepId);

    if (!fromStep || !toStep) {
      continue;
    }

    if (opts.enforceEdgeTypeCompatibility && !fromStep.produces.includes(edge.artifactTypeId)) {
      errors.push({
        code: "edge_artifact_mismatch",
        message: `На ребре указан артефакт ${artifactDisplayName(edge.artifactTypeId)}, но модуль ${stepSummary(fromStep)} не объявляет такой выход. Либо смените тип на ребре, либо исправьте список «produces» у предыдущего шага.`,
        edgeId: edge.id,
        artifactTypeId: edge.artifactTypeId,
      });
    }
  }

  if (hasCycle(scenario)) {
    errors.push({
      code: "cycle_detected",
      message:
        "В графе обнаружен цикл: связи образуют замкнутый путь. Сценарий должен идти строго от входов к выходам, без петель.",
    });
  }

  for (const step of scenario.steps) {
    if (step.moduleId === "LLM_PUPPET") {
      const llmSubtasks = scenario.edges.filter(
        (e) => e.toStepId === step.id && e.artifactTypeId === "LLM_SUBTASK",
      );
      if (llmSubtasks.length === 0) {
        errors.push({
          code: "llm_puppet_subtask_missing",
          message: `У модуля ${stepSummary(step)} нет входа LLM_SUBTASK. Подключите хотя бы одну подзадачу LLM_TASK_* к пульту.`,
          stepId: step.id,
          artifactTypeId: "LLM_SUBTASK",
        });
      }
    }

    if (opts.showUniversalInputForReport && step.moduleId === "REPORT_OUTPUT") {
      errors.push(...validateReportOutputIncoming(step, scenario));
      continue;
    }

    const reachableArtifacts = collectIncomingArtifacts(step.id, scenario);

    if (step.moduleId === "ASR") {
      if (!incomingSatisfiesAsrRequire(reachableArtifacts)) {
        errors.push({
          code: "missing_required_artifact",
          message: `У модуля ${stepSummary(step)} нужен хотя бы один вход: ${artifactDisplayName(
            "AUDIO_PREPARED",
          )}, ${artifactDisplayName("AUDIO")}, ${artifactDisplayName("TEXT")} или ${artifactDisplayName(
            "TRANSCRIPT_SEGMENTS",
          )}.`,
          stepId: step.id,
        });
      }
      continue;
    }

    if (step.moduleId === "DIARIZATION") {
      if (!reachableArtifacts.has("TEXT")) {
        errors.push({
          code: "missing_required_artifact",
          message: `У модуля ${stepSummary(step)} нужен вход ${artifactDisplayName(
            "TEXT",
          )} от шага ASR (сегменты с таймкодами для диаризации).`,
          stepId: step.id,
          artifactTypeId: "TEXT",
        });
      }
      if (!reachableArtifacts.has("AUDIO_PREPARED")) {
        errors.push({
          code: "missing_required_artifact",
          message: `У модуля ${stepSummary(step)} нужен вход ${artifactDisplayName(
            "AUDIO_PREPARED",
          )} от шага AUDIO_PREPARE: на графе должна быть видна цепочка подготовки аудио до диаризации.`,
          stepId: step.id,
          artifactTypeId: "AUDIO_PREPARED",
        });
      }
      continue;
    }

    if (step.moduleId === "SPEAKER_TURN_MERGE") {
      if (!incomingSatisfiesSpeakerTurnMergeRequire(reachableArtifacts)) {
        errors.push({
          code: "missing_required_artifact",
          message: `У модуля ${stepSummary(step)} нужен хотя бы один вход: ${artifactDisplayName(
            "SPEAKER_SEGMENTS",
          )} или ${artifactDisplayName("TRANSCRIPT_SEGMENTS")} (после диаризации).`,
          stepId: step.id,
        });
      }
      continue;
    }

    if (step.moduleId === "SPEAKER_DRAFT_EDIT") {
      if (!incomingSatisfiesSpeakerDraftEditRequire(reachableArtifacts)) {
        errors.push({
          code: "missing_required_artifact",
          message: `У модуля ${stepSummary(step)} нужен вход ${artifactDisplayName(
            "DRAFT_SPEAKERS",
          )} (черновик слитых реплик).`,
          stepId: step.id,
          artifactTypeId: "DRAFT_SPEAKERS",
        });
      }
      continue;
    }

    for (const required of step.requires) {
      if (ROOT_ARTIFACT_TYPES.has(required)) {
        continue;
      }
      const isAudioFallbackSatisfied =
        required === "AUDIO_PREPARED" &&
        step.moduleId === "PSYCH_STATE" &&
        reachableArtifacts.has("AUDIO");
      if (isAudioFallbackSatisfied) {
        continue;
      }
      if (!reachableArtifacts.has(required)) {
        errors.push({
          code: "missing_required_artifact",
          message:
            required === "AUDIO_PREPARED" && step.moduleId === "PSYCH_STATE"
              ? `У модуля ${stepSummary(step)} не хватает входа с артефактом ${artifactDisplayName(
                  required,
                )}. Подключите подготовленное аудио (AUDIO_PREPARED) или сырое аудио (AUDIO).`
              : `У модуля ${stepSummary(step)} не хватает входа с артефактом ${artifactDisplayName(required)}: нет входящего ребра с этим типом. Подключите выход предыдущего шага, который производит ${artifactDisplayName(required)}.`,
          stepId: step.id,
          artifactTypeId: required,
        });
      }
    }
  }

  const unreachableSteps = findUnreachableSteps(scenario);
  for (const stepId of unreachableSteps) {
    const st = stepById.get(stepId);
    const who = st ? stepSummary(st) : `id «${stepId}»`;
    errors.push({
      code: "unreachable_step",
      message: `Модуль ${who} недостижим: к нему нельзя прийти от «корневых» шагов (у которых нет входящих рёбер). Добавьте связь или удалите лишний узел.`,
      stepId,
    });
  }

  return { valid: errors.length === 0, errors };
}

function findDuplicateStepCodesWithStepIds(
  scenario: Scenario,
): Array<{ code: string; stepIds: string[] }> {
  const stepIdsByCode = new Map<string, string[]>();
  for (const step of scenario.steps) {
    const code = step.code;
    const arr = stepIdsByCode.get(code) ?? [];
    arr.push(step.id);
    stepIdsByCode.set(code, arr);
  }
  return [...stepIdsByCode.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([code, stepIds]) => ({ code, stepIds }));
}

function collectIncomingArtifacts(stepId: string, scenario: Scenario): Set<ArtifactTypeId> {
  const incoming = scenario.edges.filter((edge) => edge.toStepId === stepId);
  return new Set(incoming.map((edge) => edge.artifactTypeId));
}

function findUnreachableSteps(scenario: Scenario): string[] {
  const incomingCount = new Map<string, number>();
  scenario.steps.forEach((step) => incomingCount.set(step.id, 0));
  scenario.edges.forEach((edge) => incomingCount.set(edge.toStepId, (incomingCount.get(edge.toStepId) ?? 0) + 1));

  const roots = scenario.steps.filter((step) => (incomingCount.get(step.id) ?? 0) === 0).map((step) => step.id);
  const adjacency = buildAdjacency(scenario);
  const visited = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || visited.has(node)) {
      continue;
    }
    visited.add(node);
    const neighbors = adjacency.get(node) ?? [];
    neighbors.forEach((next) => queue.push(next));
  }

  return scenario.steps.map((step) => step.id).filter((id) => !visited.has(id));
}

function hasCycle(scenario: Scenario): boolean {
  const adjacency = buildAdjacency(scenario);
  const inDegree = new Map<string, number>();
  scenario.steps.forEach((step) => inDegree.set(step.id, 0));
  scenario.edges.forEach((edge) => inDegree.set(edge.toStepId, (inDegree.get(edge.toStepId) ?? 0) + 1));

  const queue = [...scenario.steps.filter((step) => (inDegree.get(step.id) ?? 0) === 0).map((step) => step.id)];
  let visited = 0;

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    visited += 1;
    const neighbors = adjacency.get(node) ?? [];
    for (const next of neighbors) {
      const degree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
      }
    }
  }

  return visited !== scenario.steps.length;
}

function buildAdjacency(scenario: Scenario): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const step of scenario.steps) {
    adjacency.set(step.id, []);
  }
  for (const edge of scenario.edges) {
    const list = adjacency.get(edge.fromStepId);
    if (list) {
      list.push(edge.toStepId);
    }
  }
  return adjacency;
}
