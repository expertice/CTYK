import type { SessionReport } from "../../types/report.types";
import type { PipelineRunResult } from "../pipeline/orchestrator";
import {
  assembleSessionReport,
  createEvidenceFromRun,
  DEFAULT_REPORT_SECTIONS,
} from "./assemble-report";

export {
  assembleSessionReport,
  parseReportOutputConfig,
  DEFAULT_REPORT_SECTIONS,
  createEvidenceFromArtifacts,
  createEvidenceFromRun,
  isSessionReportPayload,
} from "./assemble-report";
export type { ReportSectionsConfig, ReportSectionKey } from "./assemble-report";

/** Сборка отчёта для API при отсутствии артефакта SESSION_REPORT (обратная совместимость). */
export function buildSessionReport(sessionId: string, run: PipelineRunResult): SessionReport {
  return assembleSessionReport({
    sessionId,
    artifacts: run.artifacts,
    sections: DEFAULT_REPORT_SECTIONS,
    strict: false,
    evidenceBase: createEvidenceFromRun(run),
  });
}
