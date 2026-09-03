import type { ArtifactStore } from "../../types/artifact.types";
import type { RunRequestLocalModels, SessionStatusStep } from "../../types/pipeline-api.types";
import type { Scenario } from "../../types/pipeline.types";
import { PipelineOrchestrator } from "../pipeline/orchestrator";
import { createDefaultModuleRegistry } from "../pipeline/modules";
import {
  createFollowUpJobForRun,
  getPayloadHashForRun,
  getRunForExecution,
  updateJobStatus,
  upsertRunArtifacts,
  upsertRunStatus,
  upsertRunSteps,
} from "../pipeline/async-run-store";

interface PipelineQueuePayload {
  runId: string;
  jobId: string;
  sessionId: string;
  scenarioId: string;
  scenarioSnapshot: Scenario;
  artifactsSeed: ArtifactStore;
  localModels?: RunRequestLocalModels;
  metadata?: Record<string, unknown>;
  payloadHash: string;
}

interface QueueJob {
  payload: PipelineQueuePayload;
  attemptsMade: number;
}

const queue: QueueJob[] = [];
let active = false;
const workerId = `worker-${process.pid}`;

const BACKOFF_SEC = [10, 30, 90];
/** Heartbeat для job; при LLM до 600000 ms шаг всё ещё пишет heartbeat чаще таймаута. */
const HEARTBEAT_MS = 5000;

export function enqueuePipelineJob(payload: PipelineQueuePayload): void {
  queue.push({ payload, attemptsMade: 0 });
  kickWorker();
}

/** Продолжить прогон после паузы (артефакты уже сохранены в envelope). */
export function enqueueResumePipelineJob(input: {
  runId: string;
  sessionId: string;
  scenarioId: string;
}): void {
  const record = getRunForExecution(input.runId);
  if (!record) {
    throw new Error(`enqueueResumePipelineJob: run not found ${input.runId}`);
  }
  const job = createFollowUpJobForRun(input.runId);
  const payloadHash = getPayloadHashForRun(input.runId) ?? "";
  enqueuePipelineJob({
    runId: input.runId,
    jobId: job.jobId,
    sessionId: input.sessionId,
    scenarioId: input.scenarioId,
    scenarioSnapshot: record.scenario,
    artifactsSeed: record.run.artifacts,
    payloadHash,
  });
}

function kickWorker(): void {
  if (active) {
    return;
  }
  active = true;
  queueMicrotask(async () => {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) {
        continue;
      }
      await processJob(job);
    }
    active = false;
  });
}

async function processJob(job: QueueJob): Promise<void> {
  const { jobId, runId } = job.payload;
  const startedAt = new Date().toISOString();
  updateJobStatus(jobId, {
    state: "active",
    startedAt,
    workerId,
    attemptsMade: job.attemptsMade,
    nextRetryAt: null,
  });
  upsertRunStatus(runId, { status: "running", startedAt });

  const hb = setInterval(() => {
    updateJobStatus(jobId, { lastHeartbeatAt: new Date().toISOString() });
  }, HEARTBEAT_MS);

  try {
    const record = getRunForExecution(runId);
    if (!record) {
      throw new Error(`Run not found: ${runId}`);
    }
    const registry = createDefaultModuleRegistry();
    const orchestrator = new PipelineOrchestrator(registry);
    const result = await orchestrator.run(
      { id: job.payload.sessionId, scenarioId: job.payload.scenarioId, artifacts: record.run.artifacts },
      record.scenario,
      {
        runId,
        onStepsUpdate: (steps) => upsertRunSteps(runId, toStatusSteps(steps)),
      },
    );
    upsertRunArtifacts(runId, result.artifacts);
    upsertRunSteps(runId, toStatusSteps(result.steps));
    if (result.run.status === "paused") {
      upsertRunStatus(runId, {
        status: "paused",
        finishedAt: undefined,
        errorMessage: undefined,
      });
      updateJobStatus(jobId, {
        state: "completed",
        finishedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
        lastError: null,
      });
      return;
    }
    upsertRunStatus(runId, {
      status: result.run.status,
      finishedAt: result.run.finishedAt,
      errorMessage: result.run.errorMessage,
    });
    updateJobStatus(jobId, {
      state: "completed",
      finishedAt: new Date().toISOString(),
      attemptsMade: job.attemptsMade,
      lastError: null,
    });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : "Unknown worker error";
    clearInterval(hb);
    if (job.attemptsMade + 1 < 3) {
      const nextAttemptsMade = job.attemptsMade + 1;
      const retrySec = BACKOFF_SEC[Math.min(nextAttemptsMade - 1, BACKOFF_SEC.length - 1)];
      const nextRetryAt = new Date(Date.now() + retrySec * 1000).toISOString();
      updateJobStatus(jobId, {
        state: "delayed",
        attemptsMade: nextAttemptsMade,
        nextRetryAt,
        lastError: errMessage,
      });
      setTimeout(() => {
        queue.push({ payload: job.payload, attemptsMade: nextAttemptsMade });
        kickWorker();
      }, retrySec * 1000);
      return;
    }
    upsertRunStatus(runId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: errMessage,
    });
    updateJobStatus(jobId, {
      state: "failed",
      attemptsMade: job.attemptsMade + 1,
      lastError: errMessage,
      finishedAt: new Date().toISOString(),
      nextRetryAt: null,
    });
    return;
  } finally {
    clearInterval(hb);
  }
}

function toStatusSteps(
  steps: Array<{
    stepId: string;
    moduleId: string;
    status: string;
    attempt: number;
    startedAt?: string;
    finishedAt?: string;
    errorCode?: string;
    errorMessage?: string;
    detail?: string;
  }>,
): SessionStatusStep[] {
  return steps.map((step) => ({
    stepId: step.stepId,
    moduleId: step.moduleId,
    status: step.status as SessionStatusStep["status"],
    attempt: step.attempt,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    errorCode: step.errorCode,
    errorMessage: step.errorMessage,
    detail: step.detail,
    metrics: step.startedAt && step.finishedAt ? { durationMs: Date.parse(step.finishedAt) - Date.parse(step.startedAt) } : {},
  }));
}
