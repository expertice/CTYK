import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import { assembleSessionReport, parseReportOutputConfig } from "../../report/assemble-report";

/**
 * Сборка отчёта из полного стора артефактов сессии после прогона графа.
 * Какие секции заполняются — по config.sections; данные подставляются, если соответствующий артефакт есть (независимо от числа рёбер к шагу).
 */
export class ReportOutputModule implements IProcessingModule {
  id = "REPORT_OUTPUT" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
  }): Promise<Partial<ArtifactStore>> {
    const { sections, strict, renderInputs } = parseReportOutputConfig(input.config);
    const report = assembleSessionReport({
      sessionId: input.sessionId,
      artifacts: input.artifacts,
      sections,
      strict,
      renderInputs,
    });

    return {
      SESSION_REPORT: {
        type: "SESSION_REPORT",
        status: "ready",
        version: "v1",
        producer: {
          moduleId: this.id,
          stepId: input.stepId,
          runId: input.runId,
        },
        quality: {},
        data: report,
        createdAt: new Date().toISOString(),
      },
    };
  }
}
