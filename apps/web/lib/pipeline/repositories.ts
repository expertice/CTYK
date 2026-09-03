import type { ArtifactStore } from "../../types/artifact.types";
import type { JobStatusResponse, SessionStatusStep } from "../../types/pipeline-api.types";
import type { PipelineRun, Scenario } from "../../types/pipeline.types";

export interface PipelineRunRecord {
  run: PipelineRun;
  scenarioSnapshot: Scenario;
  artifacts: ArtifactStore;
  steps: SessionStatusStep[];
  payloadHash: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  queuedAt?: string;
  jobId?: string;
}

export interface PipelineRunRepository {
  createQueued(input: PipelineRunRecord): Promise<void>;
  updateRun(runId: string, patch: Partial<PipelineRun>): Promise<void>;
  updateSteps(runId: string, steps: SessionStatusStep[]): Promise<void>;
  updateArtifacts(runId: string, artifacts: ArtifactStore): Promise<void>;
  getByRunId(runId: string): Promise<PipelineRunRecord | null>;
  getBySessionId(sessionId: string): Promise<PipelineRunRecord | null>;
  getByIdempotencyKey(idempotencyKey: string): Promise<PipelineRunRecord | null>;
}

export interface PipelineJobRepository {
  upsertJob(job: JobStatusResponse): Promise<void>;
  updateJob(jobId: string, patch: Partial<JobStatusResponse>): Promise<void>;
  getJob(jobId: string): Promise<JobStatusResponse | null>;
}
