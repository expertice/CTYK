import type { ArtifactTypeId } from "../../types/artifact.types";

/**
 * Типы артефактов, которые можно подключить к шагу REPORT_OUTPUT
 * (несколько рёбер с разными типами на один мультиплекс-вход в графе).
 */
export const REPORT_OUTPUT_ACCEPTED_INPUTS: ArtifactTypeId[] = [
  "TEXT",
  "SUMMARY_TEXT",
  "LLM_SUMMARY",
  "SPEAKER_SEGMENTS",
  "READY_SPEAKERS",
  "DRAFT_SPEAKERS",
  "TRANSCRIPT_SEGMENTS",
  "ENRICHED_TRANSCRIPT",
  "SPEAKER_IDENTITY_MAP",
  "PSYCH_LABELS",
  "PSYCH_NARRATIVE",
  "LLM_PSYCH_LABELS",
  "LLM_PSYCH_NARRATIVE",
  "LLM_PSYCH_FULL_V1",
  "CHECKLIST_RESULTS",
];

const ACCEPT_SET = new Set<ArtifactTypeId>(REPORT_OUTPUT_ACCEPTED_INPUTS);

export function isReportOutputAcceptedInput(t: ArtifactTypeId): boolean {
  return ACCEPT_SET.has(t);
}
