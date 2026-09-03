import type { ArtifactTypeId } from "../../types/artifact.types";

/** Стабильные цвета портов по типу артефакта (светлая тема). */
export const ARTIFACT_HEX: Record<ArtifactTypeId, string> = {
  AUDIO_SOURCE: "#0ea5e9",
  AUDIO: "#2563eb",
  AUDIO_PREPARED: "#1d4ed8",
  TEXT: "#16a34a",
  SPEAKER_SEGMENTS: "#9333ea",
  DRAFT_SPEAKERS: "#a855f7",
  READY_SPEAKERS: "#7e22ce",
  TRANSCRIPT_SEGMENTS: "#6d28d9",
  ENRICHED_TRANSCRIPT: "#7c3aed",
  PSYCH_LABELS: "#d97706",
  PSYCH_NARRATIVE: "#db2777",
  CHECKLIST_DEFINITION: "#0e7490",
  CHECKLIST_RESULTS: "#0891b2",
  LLM_INSTRUCTIONS: "#0e7490",
  LLM_SUBTASK: "#6366f1",
  SUMMARY_TEXT: "#ca8a04",
  LLM_SUMMARY: "#b45309",
  SPEAKER_IDENTITY_MAP: "#a16207",
  LLM_PSYCH_LABELS: "#ea580c",
  LLM_PSYCH_NARRATIVE: "#be185d",
  LLM_PSYCH_FULL_V1: "#7e22ce",
  STRUCTURED_FEATURES: "#475569",
  SESSION_REPORT: "#0f766e",
};

export function artifactHex(type: ArtifactTypeId): string {
  return ARTIFACT_HEX[type] ?? "#64748b";
}

/** Короткая подпись (например для компактных подсказок). */
export function artifactShortLabel(type: ArtifactTypeId): string {
  const map: Partial<Record<ArtifactTypeId, string>> = {
    AUDIO_SOURCE: "SRC",
    AUDIO: "AUD",
    AUDIO_PREPARED: "APR",
    TEXT: "TXT",
    SPEAKER_SEGMENTS: "SPK",
    DRAFT_SPEAKERS: "DRF",
    READY_SPEAKERS: "RDY",
    TRANSCRIPT_SEGMENTS: "TRS",
    ENRICHED_TRANSCRIPT: "ENR",
    PSYCH_LABELS: "PSY",
    PSYCH_NARRATIVE: "NAR",
    CHECKLIST_DEFINITION: "CLD",
    CHECKLIST_RESULTS: "CHK",
    LLM_INSTRUCTIONS: "LLM",
    LLM_SUBTASK: "SUB",
    SUMMARY_TEXT: "SUM",
    LLM_SUMMARY: "LSM",
    SPEAKER_IDENTITY_MAP: "IDM",
    LLM_PSYCH_LABELS: "LPL",
    LLM_PSYCH_NARRATIVE: "LPN",
    LLM_PSYCH_FULL_V1: "LPF",
    STRUCTURED_FEATURES: "FEA",
    SESSION_REPORT: "RPT",
  };
  return map[type] ?? type.slice(0, 3);
}
