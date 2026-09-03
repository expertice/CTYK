import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import type { ModuleId, Scenario } from "../../../types/pipeline.types";
import { LLM_TASK_SATELLITE_IDS } from "../llm-orchestrator-modules";

/** Узел подзадачи на графе: исполнение на `LLM_PUPPET`. */
export class LlmTaskSatelliteModule implements IProcessingModule {
  readonly id: ModuleId;

  constructor(taskId: ModuleId) {
    if (!(LLM_TASK_SATELLITE_IDS as readonly string[]).includes(taskId)) {
      throw new Error(`Invalid LLM task satellite id: ${taskId}`);
    }
    this.id = taskId;
  }

  async run(_input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
    scenario?: Scenario;
    onStepProgress?: (u: { stepId: string; detail?: string | null }) => void;
  }): Promise<Partial<ArtifactStore>> {
    return {};
  }
}
