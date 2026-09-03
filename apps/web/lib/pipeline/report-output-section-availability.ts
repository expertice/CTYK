import type { ArtifactTypeId } from "../../types/artifact.types";
import type { Scenario } from "../../types/pipeline.types";

export type ReportSectionAvailability = {
  summary: boolean;
  transcript: boolean;
  psych: boolean;
  checklist: boolean;
};

const TRANSCRIPT_SIGNAL: ArtifactTypeId[] = [
  "TEXT",
  "SPEAKER_SEGMENTS",
  "READY_SPEAKERS",
  "DRAFT_SPEAKERS",
  "TRANSCRIPT_SEGMENTS",
  "ENRICHED_TRANSCRIPT",
];

const PSYCH_BUSINESS_OUTPUTS: ArtifactTypeId[] = [
  "PSYCH_LABELS",
  "PSYCH_NARRATIVE",
  "LLM_PSYCH_LABELS",
  "LLM_PSYCH_NARRATIVE",
];

/**
 * Секция отчёта доступна в UI только по фактическим входящим рёбрам к REPORT_OUTPUT.
 */
export function computeReportSectionAvailability(scenario: Scenario, reportStepId: string): ReportSectionAvailability {
  const types = new Set<ArtifactTypeId>(listReportDirectInputTypes(scenario, reportStepId));

  return {
    summary: types.has("SUMMARY_TEXT") || types.has("LLM_SUMMARY"),
    transcript: TRANSCRIPT_SIGNAL.some((t) => types.has(t)),
    psych:
      types.has("PSYCH_LABELS") ||
      types.has("PSYCH_NARRATIVE") ||
      types.has("LLM_PSYCH_LABELS") ||
      types.has("LLM_PSYCH_NARRATIVE"),
    checklist: types.has("CHECKLIST_RESULTS"),
  };
}

export function listReportDirectInputTypes(scenario: Scenario, reportStepId: string): ArtifactTypeId[] {
  const types = new Set<ArtifactTypeId>();
  for (const e of scenario.edges) {
    if (e.toStepId === reportStepId) {
      types.add(e.artifactTypeId);
    }
  }
  return [...types];
}

/** Обнуляет секции отчёта, недоступные по графу (согласованность с UI). */
export function clampReportOutputStepsInScenario(scenario: Scenario): Scenario {
  return {
    ...scenario,
    steps: scenario.steps.map((st) => {
      if (st.moduleId !== "REPORT_OUTPUT") return st;
      const av = computeReportSectionAvailability(scenario, st.id);
      const hasDirectPsychBusinessInput = scenario.edges.some(
        (e) => e.toStepId === st.id && PSYCH_BUSINESS_OUTPUTS.includes(e.artifactTypeId),
      );
      const raw = st.config.sections;
      const prev =
        raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
      const sections = {
        summary: av.summary ? prev.summary !== false : false,
        transcript: av.transcript ? prev.transcript !== false : false,
        // Если психо-бизнес-артефакты заведены прямо в REPORT_OUTPUT, секция включается принудительно.
        psych: av.psych ? (hasDirectPsychBusinessInput ? true : prev.psych !== false) : false,
        checklist: av.checklist ? prev.checklist !== false : false,
      };
      return { ...st, config: { ...st.config, sections } };
    }),
  };
}
