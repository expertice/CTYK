import type { PipelineRunResult } from "./orchestrator";
import type { SessionRunStatus, SessionStatusResponse, StepRunStatus } from "../../types/pipeline.types";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { getWebAppRoot } from "../local-models/web-root";

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
}

const runsBySessionId = new Map<string, PipelineRunResult>();

const RUNS_DIR = path.join(getWebAppRoot(), ".runs");
const ASYNC_RUNS_STATE_PATH = path.join(getWebAppRoot(), ".runs-async", "state.json");
const SESSION_NAMES_PATH = path.join(getWebAppRoot(), ".runs", "session-names.json");

export function savePipelineRun(sessionId: string, run: PipelineRunResult): void {
  runsBySessionId.set(sessionId, run);
  // Best-effort persistence for dev restarts.
  void persistRun(sessionId, run);
}

export function getSessionStatus(sessionId: string): SessionStatusResponse | null {
  const run = runsBySessionId.get(sessionId) ?? tryLoadRunSync(sessionId);
  if (!run) return null;

  const totalSteps = run.steps.length || 1;
  const completed = run.steps.filter((step) => isComplete(step.status)).length;
  const progress = Math.round((completed / totalSteps) * 100);
  const currentStepIds = run.steps.filter((step) => step.status === "running").map((step) => step.stepId);

  return {
    runId: run.run.runId,
    status: run.run.status,
    progress,
    currentStepIds,
    steps: run.steps.map((step) => ({
      stepId: step.stepId,
      moduleId: step.moduleId,
      status: step.status,
      attempt: step.attempt,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      errorMessage: step.errorMessage,
      detail: step.detail,
    })),
  };
}

export function getPipelineRun(sessionId: string): PipelineRunResult | null {
  return runsBySessionId.get(sessionId) ?? tryLoadRunSync(sessionId) ?? null;
}

function isComplete(status: StepRunStatus): boolean {
  return status === "succeeded" || status === "skipped" || status === "failed";
}

async function persistRun(sessionId: string, run: PipelineRunResult): Promise<void> {
  try {
    await mkdir(RUNS_DIR, { recursive: true });
    const safeId = sessionId.replace(/[^\w.\-]+/g, "_");
    const filePath = path.join(RUNS_DIR, `${safeId}.json`);
    await writeFile(filePath, JSON.stringify(run), "utf8");
  } catch {
    // ignore persistence errors
  }
}

function tryLoadRunSync(sessionId: string): PipelineRunResult | null {
  try {
    const safeId = sessionId.replace(/[^\w.\-]+/g, "_");
    const filePath = path.join(RUNS_DIR, `${safeId}.json`);
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as PipelineRunResult;
    runsBySessionId.set(sessionId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** All pipeline runs persisted under `.runs/*.json`, newest `startedAt` first. */
export function listPersistedSessions(): SessionListItem[] {
  const sessionNames = loadSessionNames();
  const mergedBySession = new Map<string, SessionListItem>();
  try {
    const fileNames = readdirSync(RUNS_DIR);
    for (const name of fileNames) {
      if (!name.endsWith(".json")) continue;
      try {
        const filePath = path.join(RUNS_DIR, name);
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as PipelineRunResult;
        const r = parsed.run;
        mergedBySession.set(r.sessionId, {
          sessionId: r.sessionId,
          runId: r.runId,
          status: r.status,
          queuedAt: r.startedAt ?? "",
          startedAt: r.startedAt ?? "",
          displayName: sessionNames[r.sessionId] ?? formatSessionDisplayName(r.startedAt ?? ""),
          currentStepModuleId: getCurrentStepModuleId(parsed.steps),
          finishedAt: r.finishedAt,
          errorMessage: r.errorMessage,
        });
      } catch {
        // skip corrupt file
      }
    }
  } catch {
    // ignore sync store read errors
  }

  for (const item of listAsyncSessions()) {
    const prev = mergedBySession.get(item.sessionId);
    if (
      !prev ||
      (item.startedAt || item.queuedAt || "").localeCompare(prev.startedAt || prev.queuedAt || "") >= 0
    ) {
      mergedBySession.set(item.sessionId, item);
    }
  }

  return Array.from(mergedBySession.values()).sort((a, b) =>
    (b.startedAt || b.queuedAt || "").localeCompare(a.startedAt || a.queuedAt || ""),
  );
}

export function deletePersistedSession(sessionId: string): void {
  runsBySessionId.delete(sessionId);
  try {
    const safeId = sessionId.replace(/[^\w.\-]+/g, "_");
    const filePath = path.join(RUNS_DIR, `${safeId}.json`);
    rmSync(filePath, { force: true });
  } catch {
    // ignore delete errors
  }
  const names = loadSessionNames();
  if (names[sessionId]) {
    delete names[sessionId];
    saveSessionNames(names);
  }
}

export function setSessionDisplayName(sessionId: string, displayName: string): void {
  const names = loadSessionNames();
  names[sessionId] = displayName;
  saveSessionNames(names);
}

function listAsyncSessions(): SessionListItem[] {
  const sessionNames = loadSessionNames();
  try {
    const raw = readFileSync(ASYNC_RUNS_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      runsById?: Record<
        string,
        {
          envelope?: {
            run?: {
              sessionId?: string;
              runId?: string;
              status?: SessionRunStatus;
              queuedAt?: string;
              startedAt?: string;
              finishedAt?: string;
              errorMessage?: string;
            };
            steps?: Array<{
              moduleId: string;
              status: "pending" | "running" | "succeeded" | "failed" | "skipped";
            }>;
          };
        }
      >;
    };
    const runs = parsed.runsById ?? {};
    const out: SessionListItem[] = [];
    for (const record of Object.values(runs)) {
      const run = record?.envelope?.run;
      if (!run?.sessionId || !run?.runId || !run.status) continue;
      out.push({
        sessionId: run.sessionId,
        runId: run.runId,
        status: run.status,
        queuedAt: run.queuedAt,
        startedAt: run.startedAt ?? "",
        displayName:
          sessionNames[run.sessionId] ??
          formatSessionDisplayName(run.startedAt ?? run.queuedAt ?? ""),
        currentStepModuleId: getCurrentAsyncStepModuleId(record?.envelope?.steps),
        finishedAt: run.finishedAt,
        errorMessage: run.errorMessage,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function loadSessionNames(): Record<string, string> {
  try {
    const raw = readFileSync(SESSION_NAMES_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim() !== "") {
        out[k] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveSessionNames(names: Record<string, string>): void {
  try {
    mkdirSync(path.dirname(SESSION_NAMES_PATH), { recursive: true });
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

function getCurrentStepModuleId(
  steps: Array<{ moduleId: string; status: StepRunStatus }> | undefined,
): string | undefined {
  if (!steps || steps.length === 0) return undefined;
  const running = steps.find((s) => s.status === "running");
  if (running) return running.moduleId;
  const pending = steps.find((s) => s.status === "pending");
  if (pending) return pending.moduleId;
  return undefined;
}

function getCurrentAsyncStepModuleId(
  steps:
    | Array<{
        moduleId: string;
        status: "pending" | "running" | "succeeded" | "failed" | "skipped";
      }>
    | undefined,
): string | undefined {
  if (!steps || steps.length === 0) return undefined;
  const running = steps.find((s) => s.status === "running");
  if (running) return running.moduleId;
  const pending = steps.find((s) => s.status === "pending");
  if (pending) return pending.moduleId;
  return undefined;
}
