import type { ArtifactStore } from "./artifact.types";
import type { PipelineRun, Scenario, SessionRunStatus, StepRunStatus } from "./pipeline.types";
import type { ProcessSettings } from "../lib/pipeline/process-settings";

export interface RunRequestLocalModels {
  whisperModel?: string;
  asrDevice?: "auto" | "cpu" | "cuda" | "gpu_strict";
  asrComputeType?: string;
  diarizationModel?: string;
  localPyannoteModelPath?: string;
  diarizationMode?: "local_pyannote" | "hf_pyannote" | "heuristic";
  diarizationMergeGapSec?: number;
  diarizationMinTurnSec?: number;
  diarizationDeviceMode?: "auto" | "cpu" | "gpu_strict";
}

export interface RunRequestBody {
  sessionId: string;
  scenarioId?: string;
  scenario?: Scenario;
  process?: ProcessSettings;
  artifacts?: ArtifactStore;
  localModels?: RunRequestLocalModels;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface RunAcceptedResponse {
  runId: string;
  jobId: string;
  sessionId: string;
  status: "queued";
  queuedAt: string;
}

export interface SessionStatusStep {
  stepId: string;
  moduleId: string;
  /** В т.ч. `awaiting_human` у шага правки спикеров. */
  status: StepRunStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Подстатус шага (внутренние фазы пульта LLM и т.п.). */
  detail?: string;
  metrics?: Record<string, unknown>;
}

export interface SpeakerDraftStatusPayload {
  enabled: true;
  editStepId: string;
  segments: Array<{
    speakerId: string;
    startTime: number;
    endTime: number;
    text: string;
  }>;
}

export interface SessionStatusExtendedResponse {
  sessionId: string;
  runId: string;
  jobId?: string;
  status: SessionRunStatus;
  progress: number;
  currentStepIds: string[];
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  audioDurationSec?: number;
  steps: SessionStatusStep[];
  /** Наглядный журнал выполнения: что сделано и какие артефакты куда переданы. */
  processLog?: string[];
  /** Когда run в паузе на SPEAKER_DRAFT_EDIT — данные для UI правки. */
  speakerDraft?: SpeakerDraftStatusPayload;
}

export interface JobStatusResponse {
  jobId: string;
  queue: string;
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "stalled";
  attemptsMade: number;
  maxAttempts: number;
  nextRetryAt?: string | null;
  priority: number;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  runId: string;
  sessionId: string;
  workerId?: string;
  lastHeartbeatAt?: string;
  lastError?: string | null;
  payloadHash: string;
}

export interface PipelineRunEnvelope {
  run: PipelineRun;
  steps: SessionStatusStep[];
  artifacts: ArtifactStore;
  jobId?: string;
  queuedAt?: string;
}

/** Ответ GET /api/sessions/[id]/reuse-pack — снимок сценария и сид артефактов без выходов LLM. */
export interface SessionReuseHints {
  hasReadySpeakers: boolean;
  hasEnrichedTranscript: boolean;
  hasPsychLabels: boolean;
  hasStructuredFeatures: boolean;
  audioDurationSec?: number;
  /** Достаточно данных, чтобы оркестратор пропустил источник аудио, подготовку, ASR, диаризацию, слияние. */
  reuseAudioTranscriptDiarization: boolean;
  /** ENR и PSY готовы — PSYCH_STATE можно не запускать. */
  reusePsychBundle: boolean;
}

export interface SessionReusePackResponse {
  sourceSessionId: string;
  sourceRunId: string;
  scenarioSnapshot: Scenario;
  artifactsSeed: ArtifactStore;
  hints: SessionReuseHints;
}
