import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getWebAppRoot } from "../local-models/web-root";
import type { ArtifactStore, ArtifactTypeId } from "../../types/artifact.types";
import type {
  JobStatusResponse,
  PipelineRunEnvelope,
  SessionReusePackResponse,
  SessionStatusExtendedResponse,
  SessionStatusStep,
} from "../../types/pipeline-api.types";
import type { PipelineRun, Scenario, SessionRunStatus, StepRunStatus } from "../../types/pipeline.types";
import { sortStepsByScenarioGraph } from "../scenarios/scenario-order";
import type { PipelineRunResult } from "./orchestrator";
import { PIPELINE_MODULE_CATALOG } from "./module-catalog";

interface RunStateRecord {
  envelope: PipelineRunEnvelope;
  scenarioSnapshot: Scenario;
  payloadHash: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

/** Каталог состояния async-ранов: всегда под `apps/web`, даже если `process.cwd()` — корень монорепо. */
const rootDir = join(getWebAppRoot(), ".runs-async");
const dbPath = join(rootDir, "state.json");
const SESSION_NAMES_PATH = join(rootDir, "session-names.json");

const state: {
  runsById: Record<string, RunStateRecord>;
  runIdBySessionId: Record<string, string>;
  jobsById: Record<string, JobStatusResponse>;
  runIdByIdempotencyKey: Record<string, string>;
} = load();

function syncFromDisk(): void {
  const disk = load();
  state.runsById = disk.runsById;
  state.runIdBySessionId = disk.runIdBySessionId;
  state.jobsById = disk.jobsById;
  state.runIdByIdempotencyKey = disk.runIdByIdempotencyKey;
}

function load() {
  try {
    const raw = readFileSync(dbPath, "utf8");
    return JSON.parse(raw) as {
      runsById: Record<string, RunStateRecord>;
      runIdBySessionId: Record<string, string>;
      jobsById: Record<string, JobStatusResponse>;
      runIdByIdempotencyKey: Record<string, string>;
    };
  } catch {
    return {
      runsById: {},
      runIdBySessionId: {},
      jobsById: {},
      runIdByIdempotencyKey: {},
    };
  }
}

function persist() {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(dbPath, JSON.stringify(state, null, 2), "utf8");
}

export function createQueuedRun(input: {
  sessionId: string;
  scenario: Scenario;
  artifacts: ArtifactStore;
  payloadHash: string;
  priority: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): { run: PipelineRun; job: JobStatusResponse; duplicated: boolean } {
  syncFromDisk();
  if (input.idempotencyKey) {
    const existingRunId = state.runIdByIdempotencyKey[input.idempotencyKey];
    if (existingRunId) {
      const existing = state.runsById[existingRunId];
      if (existing.payloadHash !== input.payloadHash) {
        throw new Error("IDEMPOTENCY_HASH_CONFLICT");
      }
      const existingJob = Object.values(state.jobsById).find((j) => j.runId === existingRunId);
      if (!existingJob) {
        throw new Error("IDEMPOTENCY_JOB_MISSING");
      }
      return { run: existing.envelope.run, job: existingJob, duplicated: true };
    }
  }

  const now = new Date().toISOString();
  const runId = `run_${randomUUID()}`;
  const jobId = `job_${randomUUID()}`;
  const run: PipelineRun = {
    runId,
    sessionId: input.sessionId,
    scenarioId: input.scenario.id,
    status: "queued",
    attempt: 1,
    startedAt: undefined,
    finishedAt: undefined,
    idempotencyKey: input.idempotencyKey,
  };

  const envelope: PipelineRunEnvelope = {
    run,
    steps: [],
    artifacts: input.artifacts,
    queuedAt: now,
    jobId,
  };
  state.runsById[runId] = {
    envelope,
    scenarioSnapshot: input.scenario,
    payloadHash: input.payloadHash,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata,
  };
  state.runIdBySessionId[input.sessionId] = runId;
  if (input.idempotencyKey) {
    state.runIdByIdempotencyKey[input.idempotencyKey] = runId;
  }
  state.jobsById[jobId] = {
    jobId,
    queue: "pipeline-default",
    state: "waiting",
    attemptsMade: 0,
    maxAttempts: 3,
    nextRetryAt: null,
    priority: input.priority,
    enqueuedAt: now,
    runId,
    sessionId: input.sessionId,
    payloadHash: input.payloadHash,
    lastError: null,
  };
  persist();
  return { run, job: state.jobsById[jobId], duplicated: false };
}

export function getRunForExecution(runId: string): { run: PipelineRunEnvelope; scenario: Scenario } | null {
  syncFromDisk();
  const record = state.runsById[runId];
  if (!record) {
    return null;
  }
  return { run: record.envelope, scenario: record.scenarioSnapshot };
}

export function getPayloadHashForRun(runId: string): string | null {
  syncFromDisk();
  return state.runsById[runId]?.payloadHash ?? null;
}

export function getRunIdBySessionId(sessionId: string): string | null {
  syncFromDisk();
  return state.runIdBySessionId[sessionId] ?? null;
}

export function upsertRunStatus(runId: string, patch: Partial<PipelineRunEnvelope["run"]> & { progress?: number }): void {
  syncFromDisk();
  const record = state.runsById[runId];
  if (!record) {
    return;
  }
  record.envelope.run = { ...record.envelope.run, ...patch };
  persist();
}

export function upsertRunSteps(runId: string, steps: SessionStatusStep[]): void {
  syncFromDisk();
  const record = state.runsById[runId];
  if (!record) {
    return;
  }
  record.envelope.steps = steps;
  persist();
}

export function upsertRunArtifacts(runId: string, artifacts: ArtifactStore): void {
  syncFromDisk();
  const record = state.runsById[runId];
  if (!record) {
    return;
  }
  record.envelope.artifacts = artifacts;
  persist();
}

/** Новая job для продолжения прогона после паузы (тот же runId, артефакты уже в envelope). */
export function createFollowUpJobForRun(runId: string): JobStatusResponse {
  syncFromDisk();
  const record = state.runsById[runId];
  if (!record) {
    throw new Error(`createFollowUpJobForRun: run not found: ${runId}`);
  }
  const now = new Date().toISOString();
  const jobId = `job_${randomUUID()}`;
  const sessionId = record.envelope.run.sessionId;
  const job: JobStatusResponse = {
    jobId,
    queue: "pipeline-default",
    state: "waiting",
    attemptsMade: 0,
    maxAttempts: 3,
    nextRetryAt: null,
    priority: 5,
    enqueuedAt: now,
    runId,
    sessionId,
    payloadHash: record.payloadHash,
    lastError: null,
  };
  state.jobsById[jobId] = job;
  record.envelope.jobId = jobId;
  persist();
  return job;
}

export function updateJobStatus(jobId: string, patch: Partial<JobStatusResponse>): void {
  syncFromDisk();
  const current = state.jobsById[jobId];
  if (!current) {
    return;
  }
  state.jobsById[jobId] = { ...current, ...patch };
  persist();
}

export function getSessionStatusExtended(sessionId: string): SessionStatusExtendedResponse | null {
  syncFromDisk();
  const runId = state.runIdBySessionId[sessionId];
  if (!runId) {
    return null;
  }
  const record = state.runsById[runId];
  if (!record) {
    return null;
  }
  const run = record.envelope.run;
  const currentStepIds = record.envelope.steps.filter((s) => s.status === "running").map((s) => s.stepId);
  const progress =
    record.envelope.steps.length === 0
      ? run.status === "succeeded"
        ? 100
        : 0
      : Math.round((record.envelope.steps.filter((s) => s.status === "succeeded").length / record.envelope.steps.length) * 100);
  const draftArt = record.envelope.artifacts.DRAFT_SPEAKERS;
  const draftData = draftArt?.status === "ready" && Array.isArray(draftArt.data) ? draftArt.data : null;
  const draftEditStep = record.scenarioSnapshot.steps.find((s) => s.moduleId === "SPEAKER_DRAFT_EDIT");
  const audioPreparedData =
    record.envelope.artifacts.AUDIO_PREPARED?.status === "ready" &&
    record.envelope.artifacts.AUDIO_PREPARED.data &&
    typeof record.envelope.artifacts.AUDIO_PREPARED.data === "object"
      ? (record.envelope.artifacts.AUDIO_PREPARED.data as Record<string, unknown>)
      : null;
  const audioDurationSec =
    audioPreparedData && typeof audioPreparedData.durationSec === "number" && Number.isFinite(audioPreparedData.durationSec)
      ? audioPreparedData.durationSec
      : undefined;
  const sortedSteps = sortStepsByScenarioGraph(record.envelope.steps, record.scenarioSnapshot);

  return {
    sessionId,
    runId,
    jobId: record.envelope.jobId,
    status: run.status,
    progress,
    currentStepIds,
    queuedAt: record.envelope.queuedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
    audioDurationSec,
    steps: sortedSteps,
    processLog: buildProcessLog(record.scenarioSnapshot, sortedSteps, record.envelope.artifacts),
    speakerDraft:
      run.status === "paused" && draftData && draftEditStep
        ? {
            enabled: true,
            editStepId: draftEditStep.id,
            segments: draftData as Array<{
              speakerId: string;
              startTime: number;
              endTime: number;
              text: string;
            }>,
          }
        : undefined,
  };
}

function buildProcessLog(
  scenario: Scenario,
  steps: SessionStatusStep[],
  artifacts: ArtifactStore,
): string[] {
  const moduleLabelById = new Map(PIPELINE_MODULE_CATALOG.map((m) => [m.id, m.label]));
  const stepById = new Map(scenario.steps.map((s) => [s.id, s]));
  const short: Partial<Record<string, string>> = {
    AUDIO: "AUD",
    AUDIO_PREPARED: "APREP",
    TEXT: "TXT",
    SPEAKER_SEGMENTS: "SEG",
    READY_SPEAKERS: "RDY",
    DRAFT_SPEAKERS: "DRF",
    ENRICHED_TRANSCRIPT: "ENR",
    PSYCH_LABELS: "PSY",
    LLM_SUBTASK: "SUB",
    SESSION_REPORT: "RPT",
  };
  const out: string[] = [];
  const total = steps.length;

  for (let i = 0; i < steps.length; i++) {
    const sr = steps[i];
    const prefix = `${i + 1}/${total} · ${moduleLabelById.get(sr.moduleId as never) ?? sr.moduleId}`;
    const detail = typeof sr.detail === "string" ? sr.detail.trim() : "";
    if (sr.status === "running" || sr.status === "awaiting_human") {
      out.push(detail ? `${prefix}: выполняется. ${detail}` : `${prefix}: выполняется.`);
      continue;
    }
    if (sr.status === "failed") {
      out.push(`${prefix}: ошибка. ${sr.errorMessage?.trim() || "без сообщения"}`);
      continue;
    }
    if (sr.status === "pending") {
      out.push(`${prefix}: ожидает запуска.`);
      continue;
    }
    if (sr.status === "skipped") {
      out.push(`${prefix}: пропущен (данные уже были готовы).`);
      continue;
    }
    if (sr.status !== "succeeded") continue;

    if (sr.moduleId === "AUDIO_FROM_UPLOAD") {
      const au = artifacts.AUDIO;
      const producedHere = au?.status === "ready" && au.producer?.stepId === sr.stepId;
      const rawUrl = producedHere && typeof au.url === "string" ? au.url : "";
      const fileName = decodeURIComponent(rawUrl.split("/").pop() ?? "").replace(/^\d+__/, "");
      if (fileName) out.push(`${prefix}: загружен файл «${fileName}».`);
    }

    out.push(`${prefix}: шаг завершен.`);

    for (const edge of scenario.edges) {
      if (edge.fromStepId !== sr.stepId) continue;
      const toStep = stepById.get(edge.toStepId);
      const toLabel = toStep ? moduleLabelById.get(toStep.moduleId as never) ?? toStep.moduleId : edge.toStepId;
      const art = edge.artifactTypeId;
      const artShort = short[art] ?? art;
      const env = artifacts[art];
      const producerOk = env?.status === "ready" && env.producer?.stepId === sr.stepId;
      const shape = producerOk
        ? Array.isArray(env?.data)
          ? `массив(${env?.data.length})`
          : env?.data && typeof env.data === "object"
            ? "объект"
            : typeof env?.data === "string"
              ? "строка"
              : "данные"
        : "данные";
      out.push(`→ ${artShort} (${shape}) передан в ${toLabel}.`);
    }
  }
  return out;
}

export function getJobStatus(jobId: string): JobStatusResponse | null {
  syncFromDisk();
  return state.jobsById[jobId] ?? null;
}

export function getAsyncPipelineRun(sessionId: string): PipelineRunResult | null {
  syncFromDisk();
  const runId = state.runIdBySessionId[sessionId];
  if (!runId) {
    return null;
  }
  const record = state.runsById[runId];
  if (!record) {
    return null;
  }
  return {
    run: record.envelope.run,
    steps: record.envelope.steps.map((step) => ({
      runId,
      stepId: step.stepId,
      moduleId: step.moduleId as PipelineRunResult["steps"][number]["moduleId"],
      status: step.status,
      attempt: step.attempt,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      errorCode: step.errorCode,
      errorMessage: step.errorMessage,
      detail: step.detail,
    })),
    artifacts: record.envelope.artifacts,
  };
}

export function deleteAsyncSession(sessionId: string): void {
  syncFromDisk();
  const runId = state.runIdBySessionId[sessionId];
  if (!runId) {
    return;
  }
  const record = state.runsById[runId];
  const idempotencyKey = record?.idempotencyKey;
  delete state.runsById[runId];
  delete state.runIdBySessionId[sessionId];
  if (idempotencyKey) {
    delete state.runIdByIdempotencyKey[idempotencyKey];
  }
  for (const [jobId, job] of Object.entries(state.jobsById)) {
    if (job.runId === runId || job.sessionId === sessionId) {
      delete state.jobsById[jobId];
    }
  }
  persist();
}

export interface SessionListItem {
  sessionId: string;
  runId: string;
  status: SessionRunStatus;
  startedAt: string;
  queuedAt?: string;
  displayName: string;
  currentStepModuleId?: string;
  finishedAt?: string;
  errorMessage?: string;
  reportModules: string[];
}

function reportModuleLabelByArtifactType(artifactType: string): string | null {
  if (artifactType === "ENRICHED_TRANSCRIPT") return "Просодия";
  if (artifactType === "LLM_PSYCH_LABELS" || artifactType === "PSYCH_LABELS") return "Психоанализ";
  if (artifactType === "LLM_PSYCH_NARRATIVE" || artifactType === "PSYCH_NARRATIVE") return "Комментарии матча";
  if (artifactType === "LLM_SUMMARY" || artifactType === "SUMMARY_TEXT") return "Суммаризация";
  if (artifactType === "CHECKLIST_RESULTS") return "Чеклист";
  return null;
}

function inferReportModules(record: RunStateRecord): string[] {
  const labels = new Set<string>();
  const reportStepIds = new Set(
    record.scenarioSnapshot.steps.filter((s) => s.moduleId === "REPORT_OUTPUT").map((s) => s.id),
  );
  for (const edge of record.scenarioSnapshot.edges) {
    if (!reportStepIds.has(edge.toStepId)) continue;
    const label = reportModuleLabelByArtifactType(edge.artifactTypeId);
    if (label) labels.add(label);
  }
  for (const [artifactType, envelope] of Object.entries(record.envelope.artifacts)) {
    if (envelope?.status !== "ready") continue;
    const label = reportModuleLabelByArtifactType(artifactType);
    if (label) labels.add(label);
  }
  return [...labels];
}

function loadSessionNames(): Record<string, string> {
  try {
    const raw = readFileSync(SESSION_NAMES_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function saveSessionNames(names: Record<string, string>): void {
  try {
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(SESSION_NAMES_PATH, JSON.stringify(names, null, 2), "utf8");
  } catch {
    // ignore write errors
  }
}

function formatSessionDisplayName(iso: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) {
    return `Сессия ${iso || "без даты"}`;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function getCurrentAsyncStepModuleId(steps: SessionStatusStep[] | undefined): string | undefined {
  if (!steps || steps.length === 0) return undefined;
  const running = steps.find((s) => s.status === "running");
  if (running?.moduleId) return running.moduleId;
  const pending = steps.find((s) => s.status === "pending");
  if (pending?.moduleId) return pending.moduleId;
  return undefined;
}

export function setSessionDisplayName(sessionId: string, displayName: string): void {
  const names = loadSessionNames();
  names[sessionId] = displayName;
  saveSessionNames(names);
}

export function deleteSessionDisplayName(sessionId: string): void {
  const names = loadSessionNames();
  if (names[sessionId]) {
    delete names[sessionId];
    saveSessionNames(names);
  }
}

/** Async-only list of sessions from `.runs-async/state.json`. */
const ARTIFACT_TYPES_PIPELINE_PREFIX_FOR_REUSE: ArtifactTypeId[] = [
  "AUDIO_SOURCE",
  "AUDIO",
  "AUDIO_PREPARED",
  "TEXT",
  "TRANSCRIPT_SEGMENTS",
  "SPEAKER_SEGMENTS",
  "DRAFT_SPEAKERS",
  "READY_SPEAKERS",
];

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Пакет для «Повторить»: снимок сценария родительского рана + артефакты префикса пайплайна
 * (без выходов LLM и отчёта), чтобы совпадали producer.stepId и сработал canSkipStep.
 */
export function getReusePackForSession(sessionId: string): SessionReusePackResponse | null {
  syncFromDisk();
  const runId = state.runIdBySessionId[sessionId];
  if (!runId) {
    return null;
  }
  const record = state.runsById[runId];
  if (!record) {
    return null;
  }
  const arts = record.envelope.artifacts;
  const rdy = arts.READY_SPEAKERS;
  if (!rdy || rdy.status !== "ready") {
    return null;
  }

  const audioPreparedData =
    arts.AUDIO_PREPARED?.status === "ready" && arts.AUDIO_PREPARED.data && typeof arts.AUDIO_PREPARED.data === "object"
      ? (arts.AUDIO_PREPARED.data as Record<string, unknown>)
      : null;
  const audioDurationSec =
    audioPreparedData && typeof audioPreparedData.durationSec === "number" && Number.isFinite(audioPreparedData.durationSec)
      ? audioPreparedData.durationSec
      : undefined;

  const artifactsSeed: ArtifactStore = {};
  for (const k of ARTIFACT_TYPES_PIPELINE_PREFIX_FOR_REUSE) {
    const env = arts[k];
    if (env && env.status === "ready") {
      artifactsSeed[k] = cloneJson(env);
    }
  }

  if (arts.CHECKLIST_DEFINITION?.status === "ready") {
    artifactsSeed.CHECKLIST_DEFINITION = cloneJson(arts.CHECKLIST_DEFINITION);
  }
  if (arts.LLM_INSTRUCTIONS?.status === "ready") {
    artifactsSeed.LLM_INSTRUCTIONS = cloneJson(arts.LLM_INSTRUCTIONS);
  }

  const enrOk = arts.ENRICHED_TRANSCRIPT?.status === "ready";
  const psyOk = arts.PSYCH_LABELS?.status === "ready";
  if (enrOk) {
    artifactsSeed.ENRICHED_TRANSCRIPT = cloneJson(arts.ENRICHED_TRANSCRIPT!);
  }
  if (psyOk) {
    artifactsSeed.PSYCH_LABELS = cloneJson(arts.PSYCH_LABELS!);
  }
  if (arts.STRUCTURED_FEATURES?.status === "ready") {
    artifactsSeed.STRUCTURED_FEATURES = cloneJson(arts.STRUCTURED_FEATURES);
  }

  const reuseAudioTranscriptDiarization = Boolean(
    artifactsSeed.AUDIO_SOURCE?.status === "ready" &&
      artifactsSeed.AUDIO?.status === "ready" &&
      artifactsSeed.AUDIO_PREPARED?.status === "ready" &&
      artifactsSeed.TEXT?.status === "ready" &&
      artifactsSeed.SPEAKER_SEGMENTS?.status === "ready" &&
      artifactsSeed.READY_SPEAKERS?.status === "ready",
  );

  return {
    sourceSessionId: sessionId,
    sourceRunId: runId,
    scenarioSnapshot: cloneJson(record.scenarioSnapshot),
    artifactsSeed,
    hints: {
      hasReadySpeakers: true,
      hasEnrichedTranscript: enrOk,
      hasPsychLabels: psyOk,
      hasStructuredFeatures: arts.STRUCTURED_FEATURES?.status === "ready",
      audioDurationSec,
      reuseAudioTranscriptDiarization,
      reusePsychBundle: Boolean(enrOk && psyOk),
    },
  };
}

export function listAsyncSessions(): SessionListItem[] {
  syncFromDisk();
  const names = loadSessionNames();

  const out: SessionListItem[] = [];
  for (const record of Object.values(state.runsById)) {
    const run = record?.envelope?.run;
    if (!run?.runId || !record?.envelope?.queuedAt || !run?.sessionId || !run?.status) continue;

    out.push({
      sessionId: run.sessionId,
      runId: run.runId,
      status: run.status,
      queuedAt: record.envelope.queuedAt,
      startedAt: run.startedAt ?? "",
      displayName:
        names[run.sessionId] ?? formatSessionDisplayName(run.startedAt ?? record.envelope.queuedAt),
      currentStepModuleId: getCurrentAsyncStepModuleId(record.envelope.steps),
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
      reportModules: inferReportModules(record),
    });
  }

  return out.sort((a, b) =>
    (b.startedAt || b.queuedAt || "").localeCompare(a.startedAt || a.queuedAt || ""),
  );
}
