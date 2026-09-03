import type { ArtifactStore } from "../../../types/artifact.types";
import type { Scenario } from "../../../types/pipeline.types";
import type { IProcessingModule } from "../orchestrator";
import { HumanGateError } from "../human-gate-error";
import { gatherInboundArtifactsForStep } from "../step-inbound-artifacts";

/**
 * Ожидает ручную правку: на первом проходе останавливает прогон (HumanGate).
 * После POST /speaker-draft/submit в сторе появляется READY_SPEAKERS с producer.stepId = этому шагу — шаг пропускается, цепочка продолжается.
 */
export class SpeakerDraftEditModule implements IProcessingModule {
  id = "SPEAKER_DRAFT_EDIT" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
    scenario?: Scenario;
  }): Promise<Partial<ArtifactStore>> {
    if (!input.scenario) {
      throw new Error("SPEAKER_DRAFT_EDIT: нет scenario для входящих артефактов.");
    }
    const sub = gatherInboundArtifactsForStep(input.artifacts, input.scenario, input.stepId);
    const draft = sub.DRAFT_SPEAKERS;
    if (!draft || draft.status !== "ready") {
      throw new Error(
        "SPEAKER_DRAFT_EDIT: по графу нужны готовые DRAFT_SPEAKERS (черновик после слияния реплик).",
      );
    }
    void input.config;
    throw new HumanGateError("speaker_draft", "Ожидается ручная правка спикеров в UI сессии.");
  }
}
