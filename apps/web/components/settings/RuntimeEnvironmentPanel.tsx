"use client";

import { useCallback, useEffect, useState } from "react";
import { getUiCopy } from "../../lib/i18n/ui-copy";

type RuntimeCheckState = "idle" | "loading" | "ready" | "error";

interface RuntimeCheckResult {
  pythonReady: boolean;
  hasHfToken: boolean;
  localPathExists: boolean;
  localPyannoteModelPath: string;
  diarizationMode: "local_pyannote" | "hf_pyannote" | "heuristic";
  effectiveDiarizationProvider: "local_pyannote" | "pyannote" | "heuristic";
  runtimeCapabilities?: {
    python?: {
      torchCudaAvailable?: boolean;
      gpuName?: string;
    };
    ffmpeg?: { ok?: boolean; bin?: string };
    nvidiaSmi?: { ok?: boolean; gpuName?: string };
  };
}

interface RuntimePrepareResult {
  ok: boolean;
  checks: Array<{
    step: string;
    ok: boolean;
    details: string;
  }>;
  paths: {
    modelsRoot: string;
    asrDir: string;
    diarizationDir: string;
    localPyannoteDir: string;
  };
}

interface DependencyCheckResult {
  ok: boolean;
  dependencies: Array<{
    id: string;
    status: "done" | "missing" | "error";
    details: string;
    recommendedAction?: string;
  }>;
}

function statusTileClass(status: "done" | "missing" | "error" | "ok" | "bad"): string {
  if (status === "done" || status === "ok") return "metric-tile metric-tile-ok";
  if (status === "missing") return "metric-tile metric-tile-warn";
  return "metric-tile metric-tile-bad";
}

function dependencyLabel(id: string): string {
  const map: Record<string, string> = {
    python: "Python",
    torch_cuda: "Torch CUDA",
    ffmpeg: "FFmpeg",
    nvidia_smi: "NVIDIA SMI",
    models_root: "Каталог моделей",
    asr_dir: "Каталог ASR",
    diarization_dir: "Каталог diarization",
    local_pyannote_dir: "Локальный pyannote",
    offline_pyannote_pipeline_dir: "Offline pipeline",
    local_pyannote_path_ready: "Путь pyannote",
    pyannote_offline_bundle: "Bundle pyannote",
    hf_token: "HF токен",
  };
  return map[id] ?? id.replaceAll("_", " ");
}

export function RuntimeEnvironmentPanel() {
  const copy = getUiCopy("ru");
  const ns = copy.newSession;

  const [runtimeCheckState, setRuntimeCheckState] = useState<RuntimeCheckState>("idle");
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeCheckResult | null>(null);
  const [runtimeCheckError, setRuntimeCheckError] = useState("");
  const [prepareState, setPrepareState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [prepareError, setPrepareError] = useState("");
  const [depsState, setDepsState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [depsResult, setDepsResult] = useState<DependencyCheckResult | null>(null);
  const [depsError, setDepsError] = useState("");
  const [activeTileInfo, setActiveTileInfo] = useState<{ id: string; text: string } | null>(null);

  const loadRuntimeCheck = useCallback(async () => {
    setRuntimeCheckState("loading");
    setRuntimeCheckError("");
    try {
      const response = await fetch("/api/runtime/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diarizationMode: "local_pyannote" }),
      });
      if (!response.ok) {
        throw new Error(ns.runtimeCheckError);
      }
      const payload = (await response.json()) as RuntimeCheckResult;
      setRuntimeCheck(payload);
      setRuntimeCheckState("ready");
    } catch (error) {
      setRuntimeCheckState("error");
      setRuntimeCheckError(error instanceof Error ? error.message : ns.runtimeCheckError);
    }
  }, [copy.newSession.runtimeCheckError]);

  useEffect(() => {
    void loadRuntimeCheck();
  }, [loadRuntimeCheck]);

  function toggleTileInfo(id: string, text: string) {
    setActiveTileInfo((prev) => (prev?.id === id ? null : { id, text }));
  }

  async function onPrepareRuntime() {
    setPrepareState("running");
    setPrepareError("");
    try {
      const response = await fetch("/api/runtime/prepare", { method: "POST" });
      if (!response.ok) {
        throw new Error(ns.runtimePrepare.error);
      }
      (await response.json()) as RuntimePrepareResult;
      setPrepareState("done");
      await loadRuntimeCheck();
      await onCheckDependencies();
    } catch (error) {
      setPrepareState("error");
      setPrepareError(error instanceof Error ? error.message : ns.runtimePrepare.error);
    }
  }

  async function onCheckDependencies() {
    setDepsState("running");
    setDepsResult(null);
    setDepsError("");
    try {
      const response = await fetch("/api/runtime/dependencies", { method: "GET", cache: "no-store" });
      if (!response.ok) {
        throw new Error(ns.depsCheckError);
      }
      const payload = (await response.json()) as DependencyCheckResult;
      setDepsResult(payload);
      setDepsState("done");
    } catch (error) {
      setDepsState("error");
      setDepsError(error instanceof Error ? error.message : ns.depsCheckErrorGeneric);
    }
  }

  return (
    <div className="stack settings-runtime-panel">
      <h3 className="settings-runtime-panel-title">{ns.environmentStateTitle}</h3>

      {runtimeCheckState === "loading" ? <p>{ns.runtimeCheckLoading}</p> : null}
      {runtimeCheckState === "error" ? <p className="error">{runtimeCheckError}</p> : null}
      {prepareState === "error" ? <p className="error">{prepareError}</p> : null}
      {depsState === "error" ? <p className="error">{depsError}</p> : null}

      {runtimeCheckState === "ready" && runtimeCheck ? (
        <div className="metrics-tiles">
          <div className={statusTileClass(runtimeCheck.pythonReady ? "ok" : "bad")}>
            <div className="metric-title">{ns.runtimeCheckFields.pythonReady}</div>
            <div className="metric-value">
              {runtimeCheck.pythonReady ? ns.runtimeCheckValues.yes : ns.runtimeCheckValues.no}
            </div>
          </div>
          <div className={statusTileClass(runtimeCheck.runtimeCapabilities?.python?.torchCudaAvailable ? "ok" : "bad")}>
            <div className="metric-title">{ns.runtimeCheckFields.torchCuda}</div>
            <div className="metric-value">
              {runtimeCheck.runtimeCapabilities?.python?.torchCudaAvailable
                ? ns.runtimeCheckValues.yes
                : ns.runtimeCheckValues.no}
            </div>
          </div>
          <div className={statusTileClass(runtimeCheck.runtimeCapabilities?.nvidiaSmi?.gpuName ? "ok" : "missing")}>
            <div className="metric-title">{ns.runtimeCheckFields.gpuCard}</div>
            <div className="metric-value">
              {runtimeCheck.runtimeCapabilities?.nvidiaSmi?.gpuName ??
                runtimeCheck.runtimeCapabilities?.python?.gpuName ??
                "N/A"}
            </div>
          </div>
          <div className={statusTileClass(runtimeCheck.runtimeCapabilities?.ffmpeg?.ok ? "ok" : "bad")}>
            <div className="metric-title">{ns.runtimeCheckFields.ffmpeg}</div>
            <div className="metric-value">
              {runtimeCheck.runtimeCapabilities?.ffmpeg?.ok ? ns.runtimeCheckValues.yes : ns.runtimeCheckValues.no}
            </div>
          </div>
        </div>
      ) : null}

      {depsResult?.dependencies?.length ? (
        <div className="metrics-tiles">
          {depsResult.dependencies.map((dep) => (
            <button
              key={dep.id}
              type="button"
              className={`${statusTileClass(dep.status)} metric-tile-button`}
              onClick={() =>
                toggleTileInfo(
                  `dep:${dep.id}`,
                  `${dependencyLabel(dep.id)}: ${dep.details}${dep.recommendedAction ? `\n${dep.recommendedAction}` : ""}`,
                )
              }
            >
              <div className="metric-title">{dependencyLabel(dep.id)}</div>
              <div className="metric-value">{dep.status}</div>
              {activeTileInfo?.id === `dep:${dep.id}` ? (
                <div className="metric-tooltip metric-tooltip-near">{activeTileInfo.text}</div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="settings-runtime-actions">
        <button type="button" onClick={() => void loadRuntimeCheck()} disabled={runtimeCheckState === "loading"}>
          {runtimeCheckState === "loading" ? ns.runtimeCheckLoading : ns.runtimeRecheckAction}
        </button>
        <button type="button" onClick={() => void onPrepareRuntime()} disabled={prepareState === "running"}>
          {prepareState === "running" ? ns.runtimePrepare.running : ns.runtimePrepare.action}
        </button>
        <button type="button" onClick={() => void onCheckDependencies()} disabled={depsState === "running"}>
          {depsState === "running" ? ns.depsCheckRunning : ns.depsCheckAction}
        </button>
      </div>
    </div>
  );
}
