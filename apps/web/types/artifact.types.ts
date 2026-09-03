export type ArtifactTypeId =
  | "AUDIO_SOURCE"
  | "AUDIO"
  | "AUDIO_PREPARED"
  | "TEXT"
  | "SPEAKER_SEGMENTS"
  /** Слитые реплики для ручной правки спикеров/текста (вход модуля редактирования). */
  | "DRAFT_SPEAKERS"
  /** Автослияние соседних сегментов одного спикера в одну реплику (без ручного шага). */
  | "READY_SPEAKERS"
  | "TRANSCRIPT_SEGMENTS"
  | "ENRICHED_TRANSCRIPT"
  | "PSYCH_LABELS"
  | "PSYCH_NARRATIVE"
  /** Загруженный/сконструированный чек-лист: пункты и метаданные. */
  | "CHECKLIST_DEFINITION"
  | "CHECKLIST_RESULTS"
  | "LLM_INSTRUCTIONS"
  /** Связь подзадачи LLM (`LLM_TASK_*`) с пультом `LLM_PUPPET` (не хранится как envelope в сторе). */
  | "LLM_SUBTASK"
  | "SUMMARY_TEXT"
  | "LLM_SUMMARY"
  | "SPEAKER_IDENTITY_MAP"
  | "LLM_PSYCH_LABELS"
  | "LLM_PSYCH_NARRATIVE"
  | "LLM_PSYCH_FULL_V1"
  | "STRUCTURED_FEATURES"
  | "SESSION_REPORT";

export type ArtifactStatus = "pending" | "ready" | "error";

export interface ExplainabilityRef {
  sourceArtifactType: ArtifactTypeId;
  quote?: string;
  timecodeStartSec?: number;
  timecodeEndSec?: number;
  speakerId?: string;
  rationale?: string;
}

export interface ArtifactEnvelope<TData = unknown> {
  type: ArtifactTypeId;
  status: ArtifactStatus;
  version: "v1";
  producer: {
    moduleId: string;
    stepId: string;
    runId: string;
  };
  quality: {
    confidence?: number;
    coverage?: number;
    warnings?: string[];
  };
  explainability?: ExplainabilityRef[];
  data?: TData;
  url?: string;
  createdAt: string;
  errorMessage?: string;
}

export type ArtifactStore = Partial<Record<ArtifactTypeId, ArtifactEnvelope>>;
