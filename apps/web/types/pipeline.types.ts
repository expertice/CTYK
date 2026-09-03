import type { ArtifactStore, ArtifactTypeId } from "./artifact.types";

export type UserRole = "ADMIN" | "OTPB_EXPERT" | "VIEWER" | "INSTRUCTOR";

export type ModuleId =
  | "AUDIO_FROM_UPLOAD"
  | "AUDIO_FROM_URL"
  | "AUDIO_FROM_API"
  | "AUDIO_FROM_RTSP"
  | "CHECKLIST_SOURCE"
  | "AUDIO_PREPARE"
  | "ASR"
  | "DIARIZATION"
  /** Слияние соседних сегментов одного спикера → DRAFT_SPEAKERS (редактор) и READY_SPEAKERS (авто). */
  | "SPEAKER_TURN_MERGE"
  /** Пауза для ручной правки DRAFT_SPEAKERS → подтверждённый READY_SPEAKERS. */
  | "SPEAKER_DRAFT_EDIT"
  | "PSYCH_STATE"
  /** Единственный узел, выполняющий вызовы LLM; подзадачи — отдельные шаги `LLM_TASK_*` и рёбра `LLM_SUBTASK`. */
  | "LLM_PUPPET"
  | "LLM_TASK_SUMMARY"
  | "LLM_TASK_SPEAKER_NAMES"
  | "LLM_TASK_PSYCH"
  | "LLM_TASK_CHECKLIST"
  | "REPORT_OUTPUT";

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  description: string;
  inputTypes: ArtifactTypeId[];
  outputTypes: ArtifactTypeId[];
  requiresTypes: ArtifactTypeId[];
  configSchema: Record<string, unknown>;
}

export interface ScenarioStep {
  id: string;
  scenarioId: string;
  moduleId: ModuleId;
  code: string;
  orderHint: number;
  config: Record<string, unknown>;
  produces: ArtifactTypeId[];
  requires: ArtifactTypeId[];
}

export interface ScenarioEdge {
  id: string;
  scenarioId: string;
  fromStepId: string;
  toStepId: string;
  artifactTypeId: ArtifactTypeId;
}

export interface Scenario {
  id: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  allowedRoles: UserRole[];
  instructionTypes: string[];
  /** UI-настройки конструктора (напр. тип линии ребер). */
  config?: Record<string, unknown>;
  steps: ScenarioStep[];
  edges: ScenarioEdge[];
}

export type SessionRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";
export type StepRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "awaiting_human";

export interface PipelineRun {
  runId: string;
  sessionId: string;
  scenarioId: string;
  status: SessionRunStatus;
  startedAt?: string;
  finishedAt?: string;
  attempt: number;
  idempotencyKey?: string;
  errorMessage?: string;
}

export interface StepRun {
  runId: string;
  stepId: string;
  moduleId: ModuleId;
  status: StepRunStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Подстатус (например «2/4: деанон») для длинных шагов вроде LLM_PUPPET. */
  detail?: string;
}

export interface PipelineSession {
  id: string;
  scenarioId: string;
  artifacts: ArtifactStore;
}

export interface SessionStatusResponse {
  runId: string;
  status: SessionRunStatus;
  progress: number;
  currentStepIds: string[];
  steps: Array<{
    stepId: string;
    moduleId: ModuleId;
    status: StepRunStatus;
    attempt: number;
    startedAt?: string;
    finishedAt?: string;
    errorMessage?: string;
    detail?: string;
  }>;
}
