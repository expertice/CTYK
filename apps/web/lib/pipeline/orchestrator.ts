import type { ArtifactStore, ArtifactTypeId } from "../../types/artifact.types";
import { sortStepsByScenarioGraph } from "../scenarios/scenario-order";
import { mergePartialArtifactStore } from "./artifact-merge";
import { PIPELINE_MODULE_CATALOG } from "./module-catalog";
import type {
  ModuleId,
  PipelineRun,
  PipelineSession,
  Scenario,
  ScenarioStep,
  StepRun,
} from "../../types/pipeline.types";
import { isHumanGateError } from "./human-gate-error";
import { isLlmPuppetModule, isLlmTaskSatellite } from "./llm-orchestrator-modules";
import { listSubtasksForPuppet } from "./llm-puppet-subtasks";
import { readLlmRunOrder } from "./llm-run-order";

export interface IProcessingModule {
  id: ModuleId;
  run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
    /** Передаётся оркестратором (фильтр по рёбрам графа, подзадачи LLM_PUPPET). */
    scenario?: Scenario;
    /** Обновление подстатуса шага (например «2/4: деанон» у пульта LLM). */
    onStepProgress?: (u: { stepId: string; detail?: string | null }) => void;
  }): Promise<Partial<ArtifactStore>>;
}

export interface PipelineRunResult {
  run: PipelineRun;
  steps: StepRun[];
  artifacts: ArtifactStore;
}

interface OrchestratorRunOptions {
  runId?: string;
  onStepsUpdate?: (steps: StepRun[]) => void;
}

export class PipelineOrchestrator {
  constructor(private readonly moduleRegistry: Map<ModuleId, IProcessingModule>) {}

  async run(session: PipelineSession, scenario: Scenario, options?: OrchestratorRunOptions): Promise<PipelineRunResult> {
    const runId = options?.runId ?? createRunId();
    const run: PipelineRun = {
      runId,
      sessionId: session.id,
      scenarioId: scenario.id,
      status: "running",
      attempt: 1,
      startedAt: new Date().toISOString(),
    };

    const stepRuns: StepRun[] = sortStepsByScenarioGraph(
      scenario.steps.map((step) => ({
        runId,
        stepId: step.id,
        moduleId: step.moduleId,
        status: "pending",
        attempt: 0,
      })),
      scenario,
    );

    const artifacts: ArtifactStore = { ...session.artifacts };
    const executionBatches = this.planBatches(scenario);
    options?.onStepsUpdate?.(stepRuns);

    try {
      for (const batch of executionBatches) {
        const llmSteps: ScenarioStep[] = [];
        const otherSteps: ScenarioStep[] = [];
        for (const step of batch) {
          if (isLlmPuppetModule(step.moduleId)) {
            llmSteps.push(step);
          } else {
            otherSteps.push(step);
          }
        }

        for (const step of otherSteps) {
          try {
            await this.runOneStep(step, session, scenario, runId, stepRuns, artifacts, options);
          } catch (e) {
            if (isHumanGateError(e)) {
              run.status = "paused";
              run.finishedAt = undefined;
              return { run, steps: stepRuns, artifacts };
            }
            throw e;
          }
        }

        llmSteps.sort((a, b) => {
          const da = readLlmRunOrder(a);
          const db = readLlmRunOrder(b);
          if (da !== db) {
            return da - db;
          }
          if (a.orderHint !== b.orderHint) {
            return a.orderHint - b.orderHint;
          }
          return a.id.localeCompare(b.id);
        });

        for (const step of llmSteps) {
          try {
            await this.runOneStep(step, session, scenario, runId, stepRuns, artifacts, options);
          } catch (e) {
            if (isHumanGateError(e)) {
              run.status = "paused";
              run.finishedAt = undefined;
              return { run, steps: stepRuns, artifacts };
            }
            throw e;
          }
        }
      }

      run.status = "succeeded";
      run.finishedAt = new Date().toISOString();
      return { run, steps: stepRuns, artifacts };
    } catch (error) {
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      run.errorMessage = error instanceof Error ? error.message : String(error);
      return { run, steps: stepRuns, artifacts };
    }
  }

  private async runOneStep(
    step: ScenarioStep,
    session: PipelineSession,
    scenario: Scenario,
    runId: string,
    stepRuns: StepRun[],
    artifacts: ArtifactStore,
    options?: OrchestratorRunOptions,
  ): Promise<void> {
    const stepRun = stepRuns.find((item) => item.stepId === step.id);
    if (!stepRun) {
      return;
    }

    if (this.canSkipStep(step, scenario, artifacts)) {
      stepRun.status = this.shouldShowSucceededForSkippedStep(step, artifacts) ? "succeeded" : "skipped";
      stepRun.detail = undefined;
      stepRun.finishedAt = new Date().toISOString();
      options?.onStepsUpdate?.(stepRuns);
      return;
    }

    const moduleInstance = this.moduleRegistry.get(step.moduleId);
    if (!moduleInstance) {
      stepRun.status = "failed";
      stepRun.errorCode = "module_not_found";
      stepRun.errorMessage = `Module ${step.moduleId} is not registered`;
      stepRun.finishedAt = new Date().toISOString();
      options?.onStepsUpdate?.(stepRuns);
      throw new Error(stepRun.errorMessage);
    }

    stepRun.status = "running";
    stepRun.attempt = 1;
    stepRun.startedAt = new Date().toISOString();
    options?.onStepsUpdate?.(stepRuns);

    try {
      const output = await moduleInstance.run({
        sessionId: session.id,
        stepId: step.id,
        runId,
        config: step.config,
        artifacts,
        scenario,
        onStepProgress: (u) => {
          if (u.stepId !== step.id) return;
          stepRun.detail = u.detail === null || u.detail === undefined || u.detail === "" ? undefined : u.detail;
          options?.onStepsUpdate?.(stepRuns);
        },
      });

      mergePartialArtifactStore(artifacts, output);

      stepRun.status = "succeeded";
      stepRun.detail = undefined;
      stepRun.finishedAt = new Date().toISOString();
      options?.onStepsUpdate?.(stepRuns);
    } catch (moduleError) {
      if (isHumanGateError(moduleError)) {
        stepRun.status = "awaiting_human";
        stepRun.errorCode = "human_gate";
        stepRun.errorMessage = moduleError.message;
        stepRun.detail = undefined;
        stepRun.finishedAt = new Date().toISOString();
        options?.onStepsUpdate?.(stepRuns);
        throw moduleError;
      }
      const message = moduleError instanceof Error ? moduleError.message : String(moduleError);
      stepRun.status = "failed";
      stepRun.errorCode = "module_run_failed";
      stepRun.errorMessage = message;
      stepRun.detail = undefined;
      stepRun.finishedAt = new Date().toISOString();
      options?.onStepsUpdate?.(stepRuns);
      throw moduleError;
    }
  }

  private canSkipStep(step: ScenarioStep, scenario: Scenario, artifacts: ArtifactStore): boolean {
    if (isLlmTaskSatellite(step.moduleId)) {
      return false;
    }
    if (step.moduleId === "SPEAKER_DRAFT_EDIT") {
      const ready = artifacts.READY_SPEAKERS;
      if (ready?.status === "ready" && ready.producer?.stepId === step.id) {
        return true;
      }
      return false;
    }
    if (isLlmPuppetModule(step.moduleId)) {
      const subs = listSubtasksForPuppet(scenario, step.id);
      if (subs.length === 0) {
        const needed = effectiveProduces(step);
        return needed.every((artifactType) => this.isReady(artifacts, artifactType));
      }
      const kinds = new Set<ArtifactTypeId>();
      for (const s of subs) {
        const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === s.moduleId);
        for (const p of cat?.typicalProduces ?? []) {
          if (p !== "LLM_SUBTASK") kinds.add(p);
        }
        for (const p of s.produces) {
          if (p !== "LLM_SUBTASK") kinds.add(p);
        }
      }
      for (const t of kinds) {
        if (!this.isReady(artifacts, t)) return false;
      }
      return true;
    }
    const needed = effectiveProduces(step);
    return needed.every((artifactType) => this.isReady(artifacts, artifactType));
  }

  private isReady(artifacts: ArtifactStore, artifactType: ArtifactTypeId): boolean {
    return artifacts[artifactType]?.status === "ready";
  }

  /**
   * Если шаг ранее уже отработал и его артефакты лежат в сторе с producer.stepId этого шага,
   * в повторном прогоне (resume) показываем его как completed, а не skipped.
   */
  private wasPreviouslyCompleted(step: ScenarioStep, artifacts: ArtifactStore): boolean {
    const produced = effectiveProduces(step).filter((t) => t !== "LLM_SUBTASK");
    if (produced.length === 0) return false;
    return produced.every((t) => {
      const art = artifacts[t];
      return art?.status === "ready" && art.producer?.stepId === step.id;
    });
  }

  /**
   * Для некоторых транзитных шагов (merge/connector) "skipped" визуально выглядит как не-выполнено,
   * хотя данные на выходе уже готовы и шаг функционально закрыт.
   */
  private shouldShowSucceededForSkippedStep(step: ScenarioStep, artifacts: ArtifactStore): boolean {
    if (this.wasPreviouslyCompleted(step, artifacts)) return true;
    if (step.moduleId !== "SPEAKER_TURN_MERGE") return false;
    const produced = effectiveProduces(step);
    if (produced.length === 0) return false;
    return produced.every((t) => artifacts[t]?.status === "ready");
  }

  private planBatches(scenario: Scenario): ScenarioStep[][] {
    const stepById = new Map(scenario.steps.map((step) => [step.id, step]));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    const addDep = (fromStepId: string, toStepId: string) => {
      if (fromStepId === toStepId) return;
      const list = adjacency.get(fromStepId);
      if (!list) return;
      if (list.includes(toStepId)) return;
      list.push(toStepId);
      inDegree.set(toStepId, (inDegree.get(toStepId) ?? 0) + 1);
    };
    scenario.steps.forEach((step) => {
      inDegree.set(step.id, 0);
      adjacency.set(step.id, []);
    });

    for (const edge of scenario.edges) {
      addDep(edge.fromStepId, edge.toStepId);
    }

    /**
     * Бизнес-выходы LLM_TASK_* физически пишет LLM_PUPPET.
     * Поэтому потребители этих выходов должны зависеть от пульта, даже если ребро в графе идёт от task-узла.
     */
    const puppetIds = scenario.steps.filter((s) => isLlmPuppetModule(s.moduleId)).map((s) => s.id);
    for (const puppetId of puppetIds) {
      const subtaskIds = new Set(listSubtasksForPuppet(scenario, puppetId).map((s) => s.id));
      if (subtaskIds.size === 0) continue;
      for (const edge of scenario.edges) {
        if (!subtaskIds.has(edge.fromStepId)) continue;
        if (edge.artifactTypeId === "LLM_SUBTASK" || edge.toStepId === puppetId) continue;
        addDep(puppetId, edge.toStepId);
      }
    }

    const batches: ScenarioStep[][] = [];
    let frontier = scenario.steps.filter((step) => (inDegree.get(step.id) ?? 0) === 0).map((step) => step.id);

    while (frontier.length > 0) {
      const currentBatch = frontier.map((stepId) => stepById.get(stepId)).filter((step): step is ScenarioStep => Boolean(step));
      batches.push(currentBatch);

      const next: string[] = [];
      for (const stepId of frontier) {
        const neighbors = adjacency.get(stepId) ?? [];
        for (const toStepId of neighbors) {
          const degree = (inDegree.get(toStepId) ?? 0) - 1;
          inDegree.set(toStepId, degree);
          if (degree === 0) {
            next.push(toStepId);
          }
        }
      }
      frontier = next;
    }

    return batches;
  }
}

function createRunId(): string {
  const now = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 10);
  return `run_${now}_${rnd}`;
}

/** Объединяет явные выходы шага с актуальным каталогом — чтобы новые артефакты не ломали skip после обновления кода. */
function effectiveProduces(step: ScenarioStep): ArtifactTypeId[] {
  const catalog = PIPELINE_MODULE_CATALOG.find((m) => m.id === step.moduleId);
  const fromCatalog = catalog?.typicalProduces ?? [];
  return [...new Set<ArtifactTypeId>([...step.produces, ...fromCatalog])];
}
