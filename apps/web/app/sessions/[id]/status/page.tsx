"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getUiCopy, tRunStatus, tStepStatus } from "../../../../lib/i18n/ui-copy";
import { PIPELINE_MODULE_CATALOG } from "../../../../lib/pipeline/module-catalog";
import type { SessionStatusExtendedResponse, SpeakerDraftStatusPayload } from "../../../../types/pipeline-api.types";
import type { ModuleId } from "../../../../types/pipeline.types";
import {
  RuntimeMetricTilesGrid,
  type RuntimeMetricsResult,
  runtimeMetricLevels,
} from "../../../../components/runtime/RuntimeMetricTiles";
import { ManualSpeakerEditWorkspace } from "../../../../components/session/ManualSpeakerEditWorkspace";
import { ScenarioStepStatusIcon } from "../../../../components/session/ScenarioStepStatusIcon";

function formatStepDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatAudioDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function computeStepDurationMs(step: {
  startedAt?: string;
  finishedAt?: string;
  status: string;
}, nowMs: number): number | null {
  if (!step.startedAt) return null;
  const st = Date.parse(step.startedAt);
  if (!Number.isFinite(st)) return null;
  const endMs =
    step.finishedAt && step.status !== "running" && step.status !== "awaiting_human"
      ? Date.parse(step.finishedAt)
      : nowMs;
  if (!Number.isFinite(endMs)) return null;
  if (endMs < st) return 0;
  return endMs - st;
}

export default function SessionStatusPage() {
  const copy = getUiCopy("ru");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<SessionStatusExtendedResponse | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetricsResult | null>(null);
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [knownDurations, setKnownDurations] = useState<Record<string, number>>({});
  const [repeatReuseAvailable, setRepeatReuseAvailable] = useState(false);
  const runtimeMetricLv = useMemo(() => runtimeMetricLevels(runtimeMetrics), [runtimeMetrics]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/sessions/${encodeURIComponent(params.id)}/reuse-pack`, { cache: "no-store" });
        if (!cancelled) setRepeatReuseAvailable(r.ok);
      } catch {
        if (!cancelled) setRepeatReuseAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const moduleLabel = useMemo(() => {
    const m = new Map<ModuleId, string>(PIPELINE_MODULE_CATALOG.map((x) => [x.id, x.label]));
    return (id: string) => m.get(id as ModuleId) ?? id;
  }, []);

  const isLlmModuleId = useCallback((id: string) => {
    if (!id) return false;
    if (id === "LLM_PUPPET") return true;
    return id.startsWith("LLM_TASK_");
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${params.id}/status`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(copy.statusPage.loadError);
      }
      const data = (await response.json()) as SessionStatusExtendedResponse;
      setStatus(data);
      setKnownDurations((prev) => {
        const next = { ...prev };
        for (const step of data.steps) {
          const d = computeStepDurationMs(step, Date.now());
          if (d != null && d >= 0) {
            next[step.stepId] = d;
            continue;
          }
          const m = step.metrics as Record<string, unknown> | undefined;
          const md = typeof m?.durationMs === "number" && Number.isFinite(m.durationMs) ? m.durationMs : null;
          if (md != null && md >= 0) {
            next[step.stepId] = md;
          }
        }
        return next;
      });
      if (data.status === "succeeded") {
        router.push(`/sessions/${params.id}`);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.statusPage.unknownError);
    }
  }, [params.id, router, copy.statusPage.loadError, copy.statusPage.unknownError]);

  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function pollMetrics() {
      try {
        const metricsRes = await fetch("/api/runtime/metrics", { cache: "no-store" });
        if (metricsRes.ok) {
          const metricsData = (await metricsRes.json()) as RuntimeMetricsResult;
          if (mounted) setRuntimeMetrics(metricsData);
        }
      } catch {
        // ignore
      }
    }

    void poll();
    void pollMetrics();
    intervalId = setInterval(() => {
      void poll();
      void pollMetrics();
    }, 1500);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [poll]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const speakerDraft: SpeakerDraftStatusPayload | undefined = status?.speakerDraft;
  const showManualSpeaker = Boolean(speakerDraft?.enabled && speakerDraft.segments?.length);

  const llmSteps = useMemo(
    () => status?.steps.filter((s) => isLlmModuleId(s.moduleId)) ?? [],
    [status?.steps, isLlmModuleId],
  );
  const activeLlmStep = useMemo(
    () =>
      llmSteps.find((s) => s.status === "running" || s.status === "awaiting_human") ??
      (llmSteps.length > 0 ? llmSteps[llmSteps.length - 1] : undefined),
    [llmSteps],
  );

  const runBadgeClass =
    status?.status === "paused"
      ? "status-badge status-paused"
      : `status-badge status-${status?.status?.replace(/_/g, "-") ?? "pending"}`;

  const processNarrative = useMemo(() => {
    if (!status) return [];
    if (Array.isArray(status.processLog) && status.processLog.length > 0) {
      return status.processLog;
    }
    const total = status.steps.length;
    return status.steps.map((step, idx) => {
      const prefix = `${idx + 1}/${total} · ${moduleLabel(step.moduleId)}`;
      const stateText = tStepStatus(step.status);
      const detail = typeof step.detail === "string" ? step.detail.trim() : "";
      const liveDuration = computeStepDurationMs(step, nowMs);
      const durationMs = liveDuration ?? knownDurations[step.stepId] ?? null;
      const durationText = durationMs != null ? ` (${formatStepDurationMs(durationMs)})` : "";

      if (step.status === "succeeded") {
        return `${prefix}: шаг завершен${durationText}.`;
      }
      if (step.status === "running" || step.status === "awaiting_human") {
        return detail
          ? `${prefix}: ${stateText.toLowerCase()}${durationText}. ${detail}`
          : `${prefix}: ${stateText.toLowerCase()}${durationText}.`;
      }
      if (step.status === "failed") {
        const reason = step.errorMessage?.trim();
        return reason
          ? `${prefix}: шаг завершился ошибкой${durationText}. Причина: ${reason}`
          : `${prefix}: шаг завершился ошибкой${durationText}.`;
      }
      if (step.status === "skipped") {
        return `${prefix}: шаг пропущен.`;
      }
      return detail
        ? `${prefix}: ${stateText.toLowerCase()}${durationText}. ${detail}`
        : `${prefix}: ${stateText.toLowerCase()}${durationText}.`;
    });
  }, [status, moduleLabel, nowMs, knownDurations]);

  return (
    <main>
      <div className="stack">
        <div className="card status-session-header-card">
          <div className="status-session-header-row">
            <div className="status-session-header-text">
              <h1>{copy.statusPage.title}</h1>
              <p>
                {copy.statusPage.sessionId}: {params.id}
              </p>
              {repeatReuseAvailable && status && (status.status === "failed" || status.status === "paused") ? (
                <p className="field-hint">
                  <Link className="button" href={`/sessions/new?reuseFrom=${encodeURIComponent(params.id)}`}>
                    Повторить
                  </Link>
                  <span className="field-hint" style={{ marginLeft: 8 }}>
                    Новая сессия с тем же сценарием и готовым RDY (и ENR/PSY при наличии); источник аудио и тяжёлые
                    шаги до LLM будут пропущены.
                  </span>
                </p>
              ) : null}
              <div className="meta status-session-header-meta">
                {status ? (
                  <>
                    <span className={runBadgeClass} role="status">
                      {tRunStatus(status.status)}
                    </span>
                    <span className="meta-chip">
                      {copy.statusPage.progressLabel}: {status.progress}%
                    </span>
                    {typeof status.audioDurationSec === "number" ? (
                      <span className="meta-chip">Длительность: {formatAudioDuration(status.audioDurationSec)}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="meta-chip">{copy.statusPage.statusHeaderLoading}</span>
                )}
              </div>
            </div>
            <div className="status-session-header-metrics">
              <RuntimeMetricTilesGrid
                metrics={runtimeMetrics}
                levels={runtimeMetricLv}
                copy={{ srTitle: copy.newSession.monitoringSectionSrTitle }}
              />
            </div>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {!status ? (
          <div className="card stack">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : null}

        {status ? (
          <div className="status-session-main-grid">
            <div className="status-session-left-col stack">
              {showManualSpeaker && speakerDraft ? (
                <div className="card manual-speaker-card stack">
                  <ManualSpeakerEditWorkspace
                    sessionId={params.id}
                    initialSegments={speakerDraft.segments}
                    copy={{
                      title: copy.statusPage.manualSpeakerTitle,
                      addSpeaker: copy.statusPage.manualSpeakerAddSpeaker,
                      colSpeaker: copy.statusPage.manualSpeakerColSpeaker,
                      colTime: copy.statusPage.manualSpeakerColTime,
                      colText: copy.statusPage.manualSpeakerColText,
                      continue: copy.statusPage.manualSpeakerContinue,
                      submitting: copy.statusPage.manualSpeakerSubmitting,
                      assignSelection: copy.statusPage.manualSpeakerAssignSelection,
                      close: copy.statusPage.manualSpeakerClose,
                      dockCollapse: copy.statusPage.manualSpeakerDockCollapse,
                      dockExpand: copy.statusPage.manualSpeakerDockExpand,
                      dockShortLabel: copy.statusPage.manualSpeakerDockShortLabel,
                    }}
                    onSubmitted={() => void poll()}
                  />
                </div>
              ) : null}

              {!showManualSpeaker ? (
                <div className="card stack">
                  <p>
                    {copy.statusPage.statusLabel}: <span className={runBadgeClass}>{tRunStatus(status.status)}</span>
                  </p>
                  <p>
                    {copy.statusPage.progressLabel}: {status.progress}%
                  </p>
                  <div className="progress-wrap">
                    <div className="progress-bar" style={{ width: `${status.progress}%` }} />
                  </div>
                </div>
              ) : null}

              {status?.steps.length > 0 ? (
                <div className="card status-llm-log-card">
                  <div className="status-llm-log-header">
                    <div className="status-llm-log-titles">
                      <span className="status-llm-log-title">Процесс выполнения</span>
                      {activeLlmStep ? (
                        <span className="status-llm-log-subtitle">
                          {moduleLabel(activeLlmStep.moduleId)} · {tStepStatus(activeLlmStep.status)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="status-llm-log-body">
                    {processNarrative.length > 0 ? (
                      <pre className="status-llm-log-text">{processNarrative.join("\n\n")}</pre>
                    ) : (
                      <p className="status-llm-log-empty">Пока нет данных по этапам…</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <aside className="status-session-steps-col">
              <h2>{copy.statusPage.stepsColumnTitle}</h2>
              <ul className="status-step-list">
                {status.steps.map((step) => {
                  const active = step.status === "running" || step.status === "awaiting_human";
                  const liveDuration = computeStepDurationMs(step, nowMs);
                  const resolvedDuration = liveDuration ?? knownDurations[step.stepId] ?? null;
                  return (
                    <li key={step.stepId} className={active ? "status-step-row status-step-row--active" : "status-step-row"}>
                      <div className="status-step-main">
                        <div className="status-step-head">
                          <strong>{moduleLabel(step.moduleId)}</strong>
                          <div className="status-step-right">
                            {resolvedDuration != null ? (
                              <span className={`status-step-duration${active ? " status-step-duration--running" : ""}`}>
                                {formatStepDurationMs(resolvedDuration)}
                              </span>
                            ) : null}
                            <ScenarioStepStatusIcon
                              status={step.status}
                              statusLabel={tStepStatus(step.status)}
                              detail={step.detail}
                              errorMessage={step.errorMessage}
                            />
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </aside>
          </div>
        ) : null}

        <p>
          <Link href={`/sessions/${params.id}`}>{copy.statusPage.openReport}</Link>
        </p>
      </div>
    </main>
  );
}
