import type { ArtifactTypeId } from "../../types/artifact.types";
import type { ModuleId } from "../../types/pipeline.types";

/** MIME-тип для drag-and-drop модулей из палитры на холст. */
export const MODULE_DRAG_MIME = "application/x-ctyk-module-id";

export const ALL_MODULE_IDS: ModuleId[] = [
  "AUDIO_FROM_UPLOAD",
  "AUDIO_FROM_URL",
  "AUDIO_FROM_API",
  "AUDIO_FROM_RTSP",
  "CHECKLIST_SOURCE",
  "AUDIO_PREPARE",
  "ASR",
  "DIARIZATION",
  "SPEAKER_TURN_MERGE",
  "SPEAKER_DRAFT_EDIT",
  "PSYCH_STATE",
  "LLM_PUPPET",
  "LLM_TASK_SUMMARY",
  "LLM_TASK_SPEAKER_NAMES",
  "LLM_TASK_PSYCH",
  "LLM_TASK_CHECKLIST",
  "REPORT_OUTPUT",
];

export const ALL_ARTIFACT_TYPES: ArtifactTypeId[] = [
  "AUDIO_SOURCE",
  "AUDIO",
  "AUDIO_PREPARED",
  "TEXT",
  "SPEAKER_SEGMENTS",
  "DRAFT_SPEAKERS",
  "READY_SPEAKERS",
  "TRANSCRIPT_SEGMENTS",
  "ENRICHED_TRANSCRIPT",
  "PSYCH_LABELS",
  "PSYCH_NARRATIVE",
  "CHECKLIST_DEFINITION",
  "CHECKLIST_RESULTS",
  "LLM_INSTRUCTIONS",
  "LLM_SUBTASK",
  "SUMMARY_TEXT",
  "SPEAKER_IDENTITY_MAP",
  "LLM_PSYCH_LABELS",
  "LLM_PSYCH_NARRATIVE",
  "STRUCTURED_FEATURES",
  "SESSION_REPORT",
];
