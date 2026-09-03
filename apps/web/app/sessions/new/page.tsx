"use client";

import Link from "next/link";
import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import {
  RuntimeMetricTilesGrid,
  type RuntimeMetricsResult,
  runtimeMetricLevels,
} from "../../../components/runtime/RuntimeMetricTiles";
import { useRouter } from "next/navigation";
import { getUiCopy } from "../../../lib/i18n/ui-copy";
import type { ModuleId, Scenario, ScenarioStep } from "../../../types/pipeline.types";
import { sampleScenario } from "../../../lib/pipeline/sample-scenario";
import { normalizeScenarioIds } from "../../../lib/scenarios/scenario-normalize";
import { orderedScenarioSteps } from "../../../lib/scenarios/scenario-order";
import { PIPELINE_MODULE_CATALOG } from "../../../lib/pipeline/module-catalog";
import { getDefaultModuleConfig } from "../../../lib/pipeline/module-default-config";
import { readGlobalSettings } from "../../../lib/settings/global-settings";
import type { GlobalSettings } from "../../../lib/settings/global-settings";
import { mergeGlobalLlmIntoScenario } from "../../../lib/settings/merge-global-llm";
import {
  clampReportOutputStepsInScenario,
  computeReportSectionAvailability,
  listReportDirectInputTypes,
} from "../../../lib/pipeline/report-output-section-availability";
import { validateScenarioGraph } from "../../../lib/pipeline/validator";
import { isLlmGraphLlmBranchModule } from "../../../lib/pipeline/llm-orchestrator-modules";
import {
  applyLlmBehaviorPreset,
  readLlmBehaviorPresetId,
  type LlmBehaviorPresetId,
} from "../../../lib/pipeline/llm-behavior-presets";
import type { SessionReusePackResponse } from "../../../types/pipeline-api.types";
import { artifactHex, artifactShortLabel } from "../../../components/scenario-builder/artifact-colors";
import {
  parseProcessSettings,
  toNormalizeProcessSettings,
  toValidationProcessSettings,
} from "../../../lib/pipeline/process-settings";

const BUILTIN_SCENARIO_PICK = "__builtin__";

/** Порог «длинной записи» для таймаутов/компакции LLM (см. план long-session). */
const LONG_SESSION_THRESHOLD_SEC = 600;

function applyLongSessionLlmDefaults(scenario: Scenario, durationSec?: number): Scenario {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= LONG_SESSION_THRESHOLD_SEC) {
    return scenario;
  }
  return {
    ...scenario,
    steps: scenario.steps.map((step) => {
      if (step.moduleId !== "LLM_PUPPET") return step;
      const preset = readLlmBehaviorPresetId(step.config);
      const safePreset: LlmBehaviorPresetId = preset === "strong" ? "medium" : preset;
      const base = applyLlmBehaviorPreset(step.config, safePreset);
      const curTimeout = typeof base.llmRequestTimeoutMs === "number" ? base.llmRequestTimeoutMs : 120000;
      return {
        ...step,
        config: {
          ...base,
          optimizeForSmallContext: true,
          llmRequestTimeoutMs: Math.min(600_000, Math.max(curTimeout, 240_000)),
          longSessionAutoTuned: true,
        },
      };
    }),
  };
}

function isModuleLockedForReuse(moduleId: ScenarioStep["moduleId"], pack: SessionReusePackResponse | null): boolean {
  if (!pack?.hints.reuseAudioTranscriptDiarization) return false;
  const audioIds: ModuleId[] = ["AUDIO_FROM_UPLOAD", "AUDIO_FROM_URL", "AUDIO_FROM_API", "AUDIO_FROM_RTSP"];
  if (audioIds.includes(moduleId)) return true;
  if (
    moduleId === "AUDIO_PREPARE" ||
    moduleId === "ASR" ||
    moduleId === "DIARIZATION" ||
    moduleId === "SPEAKER_TURN_MERGE" ||
    moduleId === "SPEAKER_DRAFT_EDIT"
  ) {
    return true;
  }
  if (pack.hints.reusePsychBundle && moduleId === "PSYCH_STATE") return true;
  return false;
}
const QWEN_CLOUD_MODELS = [
  "qwen-plus",
  "qwen-turbo",
  "qwen-max",
  "qwen3-235b-a22b",
  "qwen3-32b",
  "qwen3-14b",
  "qwen3-8b",
] as const;

type ScenarioLlmPresetId = "psycho_full_cloud_qwen3_8b";

type ScenarioLlmPreset = {
  id: ScenarioLlmPresetId;
  title: string;
  description: string;
  requiredModules: ModuleId[];
};

const SCENARIO_LLM_PRESETS: readonly ScenarioLlmPreset[] = [
  {
    id: "psycho_full_cloud_qwen3_8b",
    title: "Полный психоанализ (cloud qwen3-8b)",
    description:
      "Переключает LLM_TASK_PSYCH в full_psycho_analytics, включает psych в REPORT_OUTPUT и настраивает LLM_PUPPET на cloud qwen3-8b.",
    requiredModules: ["PSYCH_STATE", "LLM_TASK_PSYCH", "LLM_PUPPET", "REPORT_OUTPUT"],
  },
];
function processSettingsForPipeline() {
  return parseProcessSettings(readGlobalSettings().process);
}

interface ScenarioListItem {
  id: string;
  name: string;
  source: "builtin" | "stored";
  latestVersion: number | null;
  updatedAt: string | null;
}

type SubmitState = "idle" | "submitting" | "error";

function normalizeSteppedNumber(value: number, min: number, max: number, step: number): number {
  const safe = Number.isFinite(value) ? value : min;
  const clamped = Math.min(max, Math.max(min, safe));
  const ticks = Math.round((clamped - min) / step);
  return min + ticks * step;
}

interface ModuleTileRenderContext {
  copy: ReturnType<typeof getUiCopy>;
  stepId: string;
  scenario: Scenario;
  moduleLabelById: Map<ModuleId, string>;
  updateStepConfig: (patch: Record<string, unknown>) => void;
  stepConfig: Record<string, unknown>;
  audioFileName: string;
  setAudioFile: (value: File | null) => void;
  setAudioFileName: (value: string) => void;
  whisperModel: string;
  setWhisperModel: (value: string) => void;
  asrUseGpu: boolean;
  setAsrUseGpu: (value: boolean) => void;
  diarizationUseGpu: boolean;
  setDiarizationUseGpu: (value: boolean) => void;
  diarizationMergeGapSec: number;
  setDiarizationMergeGapSec: (value: number) => void;
  diarizationMinTurnSec: number;
  setDiarizationMinTurnSec: (value: number) => void;
  llmActiveSource: "local" | "cloud";
  llmLocalModelOptions: string[];
  llmCloudModelOptions: string[];
  llmLocalConnection: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  llmCloudConnection: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  /** Плитка заблокирована (режим «Повторить» / переиспользование артефактов). */
  tileLocked?: boolean;
  reuseSourceSessionId?: string;
}

export default function NewSessionPage() {
  const copy = getUiCopy("ru");
  const router = useRouter();
  const [scenarioList, setScenarioList] = useState<ScenarioListItem[]>([]);
  const [scenarioListLoading, setScenarioListLoading] = useState(true);
  const [scenarioPick, setScenarioPick] = useState(BUILTIN_SCENARIO_PICK);
  const [audioFileName, setAudioFileName] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [whisperModel, setWhisperModel] = useState("small");
  const [asrUseGpu, setAsrUseGpu] = useState(true);
  const [diarizationUseGpu, setDiarizationUseGpu] = useState(true);
  const [diarizationMergeGapSec, setDiarizationMergeGapSec] = useState(0.25);
  const [diarizationMinTurnSec, setDiarizationMinTurnSec] = useState(0.4);
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetricsResult | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(() => readGlobalSettings());
  const runtimeMetricLv = useMemo(() => runtimeMetricLevels(runtimeMetrics), [runtimeMetrics]);

  const [queryHydrated, setQueryHydrated] = useState(false);
  const [queryReuseFrom, setQueryReuseFrom] = useState<string | null>(null);
  const [reusePack, setReusePack] = useState<SessionReusePackResponse | null>(null);
  const [reuseFetchState, setReuseFetchState] = useState<"idle" | "loading" | "error">("idle");
  const [reuseFetchError, setReuseFetchError] = useState("");

  useEffect(() => {
    setQueryReuseFrom(new URLSearchParams(window.location.search).get("reuseFrom"));
    setQueryHydrated(true);
  }, []);

  function applyDefaultsToScenario(s: Scenario): Scenario {
    return {
      ...s,
      steps: s.steps.map((st) => ({
        ...st,
        config: { ...getDefaultModuleConfig(st.moduleId), ...st.config },
      })),
    };
  }

  const [scenarioForRun, setScenarioForRun] = useState<Scenario>(() =>
    mergeGlobalLlmIntoScenario(
      applyDefaultsToScenario(
        normalizeScenarioIds(sampleScenario, toNormalizeProcessSettings(processSettingsForPipeline())),
      ),
      readGlobalSettings(),
    ),
  );

  const sessionId = useMemo(() => `session_${Date.now()}`, []);

  useEffect(() => {
    function onGlobalLlm(e: Event) {
      const detail = (e as CustomEvent<ReturnType<typeof readGlobalSettings>>).detail ?? readGlobalSettings();
      setGlobalSettings(detail);
      setScenarioForRun((prev) => mergeGlobalLlmIntoScenario(prev, detail));
    }
    window.addEventListener("ctyk:globalSettingsChanged", onGlobalLlm);
    return () => {
      window.removeEventListener("ctyk:globalSettingsChanged", onGlobalLlm);
    };
  }, []);

  const llmActiveSource = globalSettings.llmActiveSource === "cloud" ? "cloud" : "local";
  const llmCloudModelOptions = useMemo(() => {
    const cur = globalSettings.llmCloud.model.trim();
    const all: string[] = [...QWEN_CLOUD_MODELS];
    return cur && !all.includes(cur) ? [cur, ...all] : all;
  }, [globalSettings.llmCloud.model]);

  const llmLocalModelOptions = useMemo(() => {
    const fromSettings = Array.isArray(globalSettings.llmLocal.availableModels)
      ? globalSettings.llmLocal.availableModels.filter((m) => typeof m === "string" && m.trim().length > 0)
      : [];
    const cur = globalSettings.llmLocal.model.trim();
    const uniq = [...new Set([...(cur ? [cur] : []), ...fromSettings])];
    return uniq.length > 0 ? uniq : [cur || "qwen2.5:3b"];
  }, [globalSettings.llmLocal.availableModels, globalSettings.llmLocal.model]);

  useEffect(() => {
    let cancelled = false;
    async function loadScenarios() {
      setScenarioListLoading(true);
      try {
        const r = await fetch("/api/scenarios", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { scenarios: ScenarioListItem[] };
        if (!cancelled) setScenarioList(data.scenarios ?? []);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setScenarioListLoading(false);
      }
    }
    void loadScenarios();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!queryHydrated) return;
    if (queryReuseFrom) return;
    let cancelled = false;
    async function loadSelectedScenario() {
      if (scenarioPick === BUILTIN_SCENARIO_PICK) {
        const merged = mergeGlobalLlmIntoScenario(
          applyDefaultsToScenario(
            normalizeScenarioIds(sampleScenario, toNormalizeProcessSettings(processSettingsForPipeline())),
          ),
          readGlobalSettings(),
        );
        setScenarioForRun(merged);
        return;
      }
      try {
        const sr = await fetch(`/api/scenarios/${encodeURIComponent(scenarioPick)}`, { cache: "no-store" });
        if (!sr.ok) {
          return;
        }
        const data = (await sr.json()) as { scenario: Scenario };
        if (!cancelled && data.scenario) {
          const merged = mergeGlobalLlmIntoScenario(
            applyDefaultsToScenario(
              normalizeScenarioIds(data.scenario, toNormalizeProcessSettings(processSettingsForPipeline())),
            ),
            readGlobalSettings(),
          );
          setScenarioForRun(merged);
        }
      } catch {
        // ignore scenario preview loading errors
      }
    }
    void loadSelectedScenario();
    return () => {
      cancelled = true;
    };
  }, [queryHydrated, queryReuseFrom, scenarioPick]);

  useEffect(() => {
    if (!queryHydrated || !queryReuseFrom) {
      setReusePack(null);
      setReuseFetchState("idle");
      setReuseFetchError("");
      return;
    }
    let cancelled = false;
    setReuseFetchState("loading");
    setReuseFetchError("");
    void (async () => {
      try {
        const r = await fetch(`/api/sessions/${encodeURIComponent(queryReuseFrom)}/reuse-pack`, { cache: "no-store" });
        if (!r.ok) {
          const err = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? `HTTP ${String(r.status)}`);
        }
        const data = (await r.json()) as SessionReusePackResponse;
        if (cancelled) return;
        setReusePack(data);
        const merged = applyLongSessionLlmDefaults(
          mergeGlobalLlmIntoScenario(
            applyDefaultsToScenario(
              normalizeScenarioIds(data.scenarioSnapshot, toNormalizeProcessSettings(processSettingsForPipeline())),
            ),
            readGlobalSettings(),
          ),
          data.hints.audioDurationSec,
        );
        setScenarioForRun(merged);
        setReuseFetchState("idle");
      } catch (e) {
        if (cancelled) return;
        setReusePack(null);
        setReuseFetchState("error");
        setReuseFetchError(e instanceof Error ? e.message : "Не удалось загрузить пакет переиспользования");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryHydrated, queryReuseFrom]);

  const scenarioExecutionSequence = useMemo(() => orderedScenarioSteps(scenarioForRun), [scenarioForRun]);
  const availableScenarioLlmPresets = useMemo(() => {
    const modules = new Set(scenarioForRun.steps.map((s) => s.moduleId));
    return SCENARIO_LLM_PRESETS.filter((preset) => preset.requiredModules.every((m) => modules.has(m)));
  }, [scenarioForRun]);
  const moduleLabelById = useMemo(
    () => new Map<ModuleId, string>(PIPELINE_MODULE_CATALOG.map((item) => [item.id, item.label])),
    [],
  );
  const scenarioValidation = useMemo(
    () => validateScenarioGraph(scenarioForRun, toValidationProcessSettings(processSettingsForPipeline())),
    [scenarioForRun],
  );

  function updateStepConfig(stepId: string, patch: Record<string, unknown>) {
    setScenarioForRun((prev) =>
      normalizeScenarioIds(
        {
          ...prev,
          steps: prev.steps.map((s) =>
            s.id === stepId ? { ...s, config: { ...s.config, ...patch } } : s,
          ),
        },
        toNormalizeProcessSettings(processSettingsForPipeline()),
      ),
    );
  }

  function applyScenarioLlmPreset(presetId: ScenarioLlmPresetId) {
    if (presetId !== "psycho_full_cloud_qwen3_8b") return;
    setScenarioForRun((prev) =>
      normalizeScenarioIds(
        {
          ...prev,
          steps: prev.steps.map((step) => {
            if (step.moduleId === "LLM_PUPPET") {
              const base = applyLlmBehaviorPreset(step.config, "medium");
              return {
                ...step,
                config: {
                  ...base,
                  llmSource: "cloud",
                  llmBaseUrl: globalSettings.llmCloud.baseUrl,
                  llmApiKey: globalSettings.llmCloud.apiKey,
                  llmModel: "qwen3-8b",
                  optimizeForSmallContext: true,
                  targetContextTokens: 4224,
                  responseMaxTokens: 900,
                  llmRequestTimeoutMs: 150000,
                  llmMaxRetries: 2,
                  llmRetryBackoffMs: 2000,
                  llmAdaptiveDownshift: true,
                },
              };
            }
            if (step.moduleId === "LLM_TASK_PSYCH") {
              return {
                ...step,
                config: {
                  ...step.config,
                  psychMode: "full_psycho_analytics",
                  enableLlmLexiconCheck: false,
                },
              };
            }
            if (step.moduleId === "PSYCH_STATE") {
              return {
                ...step,
                config: {
                  ...step.config,
                  requireReadySpeakers: true,
                  fallbackSource: "draft_only",
                },
              };
            }
            if (step.moduleId === "REPORT_OUTPUT") {
              const sectionsRaw =
                step.config.sections && typeof step.config.sections === "object"
                  ? (step.config.sections as Record<string, unknown>)
                  : {};
              const renderInputsRaw =
                step.config.renderInputs && typeof step.config.renderInputs === "object"
                  ? (step.config.renderInputs as Record<string, unknown>)
                  : {};
              return {
                ...step,
                config: {
                  ...step.config,
                  sections: { ...sectionsRaw, psych: true },
                  renderInputs: {
                    ...renderInputsRaw,
                    LLM_PSYCH_FULL_V1: true,
                    LLM_PSYCH_NARRATIVE: true,
                  },
                },
              };
            }
            return step;
          }),
        },
        toNormalizeProcessSettings(processSettingsForPipeline()),
      ),
    );
    setToastMessage("Применен пресет: полный психоанализ (cloud qwen3-8b).");
  }

  // Keep legacy UI state (ASR/DIARIZATION tiles) in sync with `step.config`
  // so that constructor settings are reflected in the session forms.
  useEffect(() => {
    const asrStep = scenarioForRun.steps.find((s) => s.moduleId === "ASR");
    if (asrStep) {
      const wm = typeof asrStep.config.whisperModel === "string" ? asrStep.config.whisperModel : "small";
      setWhisperModel(wm);
      const device = typeof asrStep.config.asrDevice === "string" ? asrStep.config.asrDevice : "auto";
      setAsrUseGpu(device !== "cpu");
    }

    const diarStep = scenarioForRun.steps.find((s) => s.moduleId === "DIARIZATION");
    if (diarStep) {
      const deviceMode =
        typeof diarStep.config.diarizationDeviceMode === "string" ? diarStep.config.diarizationDeviceMode : "auto";
      setDiarizationUseGpu(deviceMode !== "cpu");
      const mg =
        typeof diarStep.config.diarizationMergeGapSec === "number" ? diarStep.config.diarizationMergeGapSec : 0.25;
      setDiarizationMergeGapSec(mg);
      const mt =
        typeof diarStep.config.diarizationMinTurnSec === "number" ? diarStep.config.diarizationMinTurnSec : 0.4;
      setDiarizationMinTurnSec(mt);
    }
  }, [scenarioForRun]);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function pollRuntimeMetrics() {
      try {
        const response = await fetch("/api/runtime/metrics", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as RuntimeMetricsResult;
        if (mounted) setRuntimeMetrics(data);
      } catch {
        // ignore lightweight metrics failures
      }
    }
    void pollRuntimeMetrics();
    timer = setInterval(pollRuntimeMetrics, 2000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setErrorMessage("");
    setToastMessage("");

    try {
      if (reusePack && !reusePack.hints.reuseAudioTranscriptDiarization) {
        throw new Error(
          "Пакет переиспользования неполный: нет полной цепочки до READY_SPEAKERS. Запустите исходную сессию до готового RDY.",
        );
      }

      const audioSourceStep = scenarioForRun.steps.find((st) =>
        ["AUDIO_FROM_UPLOAD", "AUDIO_FROM_URL", "AUDIO_FROM_API", "AUDIO_FROM_RTSP"].includes(st.moduleId),
      );

      if (!audioSourceStep) {
        throw new Error("В сценарии не найден модуль источника аудио (AUDIO_FROM_*).");
      }

      let uploadedAudioUrl: string | null = null;
      if (!reusePack?.hints.reuseAudioTranscriptDiarization && audioSourceStep.moduleId === "AUDIO_FROM_UPLOAD") {
        uploadedAudioUrl = await uploadAudioIfNeeded(audioFile);
      }

      const audioSourceKind = (() => {
        switch (audioSourceStep.moduleId) {
          case "AUDIO_FROM_UPLOAD":
            return "upload";
          case "AUDIO_FROM_URL":
            return "url";
          case "AUDIO_FROM_API":
            return "api";
          case "AUDIO_FROM_RTSP":
            return "rtsp";
          default:
            return "upload";
        }
      })();

      const audioSourceData: Record<string, unknown> = (() => {
        if (audioSourceKind === "upload") {
          const fromSeed =
            reusePack?.artifactsSeed.AUDIO_SOURCE?.data &&
            typeof reusePack.artifactsSeed.AUDIO_SOURCE.data === "object" &&
            typeof (reusePack.artifactsSeed.AUDIO_SOURCE.data as Record<string, unknown>).localUrl === "string"
              ? String((reusePack.artifactsSeed.AUDIO_SOURCE.data as Record<string, unknown>).localUrl)
              : "";
          const localUrlFromStep =
            typeof audioSourceStep.config.localUrl === "string" ? audioSourceStep.config.localUrl : "";
          const localUrl = uploadedAudioUrl ?? (fromSeed || localUrlFromStep);
          if (!localUrl) {
            throw new Error("Выберите аудиофайл для модуля AUDIO_FROM_UPLOAD.");
          }
          return { kind: audioSourceKind, localUrl };
        }

        if (audioSourceKind === "url") {
          const url = typeof audioSourceStep.config.url === "string" ? audioSourceStep.config.url : "";
          if (!url) {
            throw new Error("Для AUDIO_FROM_URL укажите `config.url` (URL до аудио).");
          }
          return { kind: audioSourceKind, url };
        }

        if (audioSourceKind === "api") {
          const endpoint = typeof audioSourceStep.config.endpoint === "string" ? audioSourceStep.config.endpoint : "";
          if (!endpoint) {
            throw new Error("Для AUDIO_FROM_API укажите `config.endpoint`.");
          }
          const method =
            typeof audioSourceStep.config.method === "string" ? audioSourceStep.config.method : "GET";
          const body = typeof audioSourceStep.config.body === "string" ? audioSourceStep.config.body : "";
          const headers =
            audioSourceStep.config.headers && typeof audioSourceStep.config.headers === "object"
              ? audioSourceStep.config.headers
              : {};
          return { kind: audioSourceKind, endpoint, method, body, headers };
        }

        // rtsp
        const rtspUrl =
          typeof audioSourceStep.config.rtspUrl === "string" ? audioSourceStep.config.rtspUrl : "";
        if (!rtspUrl) {
          throw new Error("Для AUDIO_FROM_RTSP укажите `config.rtspUrl`.");
        }
        const captureSec =
          typeof audioSourceStep.config.captureSec === "number"
            ? audioSourceStep.config.captureSec
            : Number(audioSourceStep.config.captureSec ?? 60);
        const transport =
          typeof audioSourceStep.config.transport === "string" ? audioSourceStep.config.transport : "tcp";
        return { kind: audioSourceKind, rtspUrl, captureSec, transport };
      })();

      const asrStep = scenarioForRun.steps.find((st) => st.moduleId === "ASR");
      const asrConfig = { ...getDefaultModuleConfig("ASR"), ...(asrStep?.config ?? {}) };
      const diarizationStep = scenarioForRun.steps.find((st) => st.moduleId === "DIARIZATION");
      const diarizationConfig = {
        ...getDefaultModuleConfig("DIARIZATION"),
        ...(diarizationStep?.config ?? {}),
      };

      const scenarioPayload = clampReportOutputStepsInScenario(scenarioForRun);
      const processSettings = processSettingsForPipeline();

      const metadata: Record<string, unknown> = {};
      if (reusePack) {
        metadata.reuseFromSession = reusePack.sourceSessionId;
      }

      const artifactsPayload =
        reusePack?.hints.reuseAudioTranscriptDiarization === true
          ? { ...reusePack.artifactsSeed }
          : {
              AUDIO_SOURCE: {
                type: "AUDIO_SOURCE" as const,
                status: "ready" as const,
                version: "v1" as const,
                producer: {
                  moduleId: audioSourceStep.moduleId,
                  stepId: "seed_audio_source",
                  runId: "seed_audio_source",
                },
                quality: {},
                data: audioSourceData,
                createdAt: new Date().toISOString(),
              },
            };

      const response = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          scenario: scenarioPayload,
          process: processSettings,
          artifacts: artifactsPayload,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
          localModels: {
            whisperModel: typeof asrConfig.whisperModel === "string" ? asrConfig.whisperModel : "small",
            asrDevice: (typeof asrConfig.asrDevice === "string" ? asrConfig.asrDevice : "auto") as
              | "auto"
              | "cpu"
              | "cuda"
              | "gpu_strict",
            asrComputeType: typeof asrConfig.asrComputeType === "string" ? asrConfig.asrComputeType : "int8",

            diarizationModel:
              typeof diarizationConfig.diarizationModel === "string"
                ? diarizationConfig.diarizationModel
                : "pyannote/speaker-diarization-3.1",
            localPyannoteModelPath:
              typeof diarizationConfig.localPyannoteModelPath === "string" ? diarizationConfig.localPyannoteModelPath : "",
            diarizationMode:
              (typeof diarizationConfig.diarizationMode === "string" ? diarizationConfig.diarizationMode : "local_pyannote") as
                | "local_pyannote"
                | "hf_pyannote"
                | "heuristic",
            diarizationMergeGapSec:
              typeof diarizationConfig.diarizationMergeGapSec === "number" ? diarizationConfig.diarizationMergeGapSec : 0.25,
            diarizationMinTurnSec:
              typeof diarizationConfig.diarizationMinTurnSec === "number" ? diarizationConfig.diarizationMinTurnSec : 0.4,
            diarizationDeviceMode:
              (typeof diarizationConfig.diarizationDeviceMode === "string" ? diarizationConfig.diarizationDeviceMode : "auto") as
                | "auto"
                | "cpu"
                | "gpu_strict",
          },
        }),
      });

      if (!response.ok) {
        const details = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(details?.error ?? copy.newSession.fallbackError);
      }

      setToastMessage(copy.newSession.toastSuccess);
      router.push(`/sessions/${sessionId}/status`);
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : copy.newSession.fallbackError);
      return;
    }

    setState("idle");
  }

  return (
    <main>
      <div className="stack">
        <div className="card">
          <div className="new-session-head-top">
            <h1>{copy.newSession.title}</h1>
            {queryReuseFrom && reuseFetchState === "loading" ? (
              <p className="field-hint" role="status">
                Загрузка сценария и артефактов для переиспользования из <code>{queryReuseFrom}</code>…
              </p>
            ) : null}
            {reuseFetchState === "error" ? (
              <div className="toast toast-error" role="alert">
                Не удалось включить режим переиспользования: {reuseFetchError}
              </div>
            ) : null}
            {reusePack ? (
              <div className="toast toast-success" role="status">
                Режим «Повторить»: сценарий и артефакты до RDY
                {reusePack.hints.reusePsychBundle ? ", ENR/PSY" : ""} взяты из <code>{reusePack.sourceSessionId}</code>.
                Заблокированы плитки источника аудио, подготовки, ASR, диаризации, слияния и правки спикеров
                {reusePack.hints.reusePsychBundle ? "; PSYCH_STATE (просодика) тоже заблокирован" : ""}.
              </div>
            ) : null}
            {reusePack?.hints.audioDurationSec != null &&
            reusePack.hints.audioDurationSec > LONG_SESSION_THRESHOLD_SEC ? (
              <div className="toast" role="status">
                Длинная запись (~{Math.round(reusePack.hints.audioDurationSec / 60)} мин): для шага LLM_PUPPET
                автоматически увеличен таймаут (до 240–600 с) и включён режим экономии контекста.
              </div>
            ) : null}
          </div>
          <div className="scenario-sequence-head">
            <p className="scenario-sequence-title">{copy.newSession.scenarioFlowTitle}</p>
            <div className="scenario-sequence-list" aria-label={copy.newSession.scenarioFlowTitle}>
              {scenarioExecutionSequence.map((step, idx) => (
                <div key={step.id} className="scenario-module-tile">
                  <div className="scenario-module-tile-order">{idx + 1}</div>
                  <div className="scenario-module-tile-main">
                    <div className="scenario-module-tile-label">{moduleLabelById.get(step.moduleId) ?? step.moduleId}</div>
                    <div className="scenario-module-tile-id">{step.moduleId}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {toastMessage ? <div className="toast toast-success">{toastMessage}</div> : null}
        {state === "error" ? <div className="toast toast-error">{errorMessage}</div> : null}

        <div className="new-session-layout">
          <form onSubmit={onSubmit} className="card stack compact-stack new-session-main">
            {!scenarioValidation.valid ? (
              <div className="toast toast-error" role="alert">
                <strong>Сценарий с ошибками графа.</strong>{" "}
                {scenarioValidation.errors[0]?.message ?? "Проверьте рёбра в конструкторе."}
                {scenarioValidation.errors.length > 1
                  ? ` (+${String(scenarioValidation.errors.length - 1)})`
                  : ""}
              </div>
            ) : null}
            <p className="field-hint">
              Плитки ниже совпадают со шагами сценария; порядок — по топологии графа (рёбра + при необходимости
              orderHint). Входы LLM: только типы с явными рёбрами к шагу + transcript-политика по умолчанию; лишние
              артефакты (например ENRICHED без ребра) в промпт не попадают.
            </p>
            <div className="new-session-module-list">
              {scenarioExecutionSequence.map((step, idx) => (
                <div key={`tile-${step.id}`} className="card new-session-module-card">
                  <div className="new-session-module-card-grid">
                    <aside className="new-session-module-side new-session-module-side--left">
                      <p className="new-session-module-side-title">Входящие</p>
                      <div className="new-session-module-artifacts">
                        {step.requires.length > 0 ? (
                          [...new Set(step.requires)].map((art) => (
                            <span
                              key={`in-${step.id}-${art}`}
                              className="new-session-module-artifact-icon"
                              title={art}
                              aria-label={`Входящий артефакт: ${art}`}
                              style={{ "--artifact-accent": artifactHex(art) } as CSSProperties}
                            >
                              {artifactShortLabel(art)}
                            </span>
                          ))
                        ) : (
                          <span className="new-session-module-artifact-empty">-</span>
                        )}
                      </div>
                    </aside>

                    <section className="new-session-module-center">
                      <div className="new-session-module-head">
                        <span className="new-session-module-order">{idx + 1}</span>
                        <div>
                          <h3>{moduleLabelById.get(step.moduleId) ?? step.moduleId}</h3>
                          <p className="field-hint">{step.moduleId}</p>
                        </div>
                      </div>

                      {renderModuleTileFields(step.moduleId, {
                        copy,
                        stepId: step.id,
                        scenario: scenarioForRun,
                        moduleLabelById,
                        updateStepConfig: (patch) => updateStepConfig(step.id, patch),
                        stepConfig: step.config,
                        audioFileName,
                        setAudioFile,
                        setAudioFileName,
                        whisperModel,
                        setWhisperModel,
                        asrUseGpu,
                        setAsrUseGpu,
                        diarizationUseGpu,
                        setDiarizationUseGpu,
                        diarizationMergeGapSec,
                        setDiarizationMergeGapSec,
                        diarizationMinTurnSec,
                        setDiarizationMinTurnSec,
                        llmActiveSource,
                        llmLocalModelOptions,
                        llmCloudModelOptions,
                        llmLocalConnection: {
                          baseUrl: globalSettings.llmLocal.baseUrl,
                          apiKey: globalSettings.llmLocal.apiKey,
                          model: globalSettings.llmLocal.model,
                        },
                        llmCloudConnection: {
                          baseUrl: globalSettings.llmCloud.baseUrl,
                          apiKey: globalSettings.llmCloud.apiKey,
                          model: globalSettings.llmCloud.model,
                        },
                        tileLocked: isModuleLockedForReuse(step.moduleId, reusePack),
                        reuseSourceSessionId: reusePack?.sourceSessionId,
                      })}
                    </section>

                    <aside className="new-session-module-side new-session-module-side--right">
                      <p className="new-session-module-side-title">Исходящие</p>
                      <div className="new-session-module-artifacts">
                        {step.produces.length > 0 ? (
                          [...new Set(step.produces)].map((art) => (
                            <span
                              key={`out-${step.id}-${art}`}
                              className="new-session-module-artifact-icon"
                              title={art}
                              aria-label={`Исходящий артефакт: ${art}`}
                              style={{ "--artifact-accent": artifactHex(art) } as CSSProperties}
                            >
                              {artifactShortLabel(art)}
                            </span>
                          ))
                        ) : (
                          <span className="new-session-module-artifact-empty">-</span>
                        )}
                      </div>
                    </aside>
                  </div>
                </div>
              ))}
            </div>

            <button type="submit" disabled={state === "submitting" || (Boolean(queryReuseFrom) && reuseFetchState === "loading")}>
              {state === "submitting" ? copy.newSession.submitting : copy.newSession.submit}
            </button>
          </form>

          <aside className="stack new-session-side">
            <div className="card stack compact-stack">
              <h3>Сценарные LLM-пресеты (beta)</h3>
              <p className="field-hint">
                Ручной режим старой секции временно отключен. Пресеты активируются только если в сценарии есть нужные
                плитки.
              </p>
              {availableScenarioLlmPresets.length > 0 ? (
                <div className="stack compact-stack">
                  {availableScenarioLlmPresets.map((preset) => (
                    <div key={preset.id} className="stack compact-stack">
                      <p>
                        <strong>{preset.title}</strong>
                      </p>
                      <p className="field-hint">{preset.description}</p>
                      <button type="button" className="button-ghost" onClick={() => applyScenarioLlmPreset(preset.id)}>
                        Применить пресет
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="field-hint">Для текущего графа сценария доступных LLM-пресетов нет.</p>
              )}
            </div>

            <RuntimeMetricTilesGrid
              metrics={runtimeMetrics}
              levels={runtimeMetricLv}
              copy={{ srTitle: copy.newSession.monitoringSectionSrTitle }}
            />

            <div className="card stack compact-stack new-session-scenario-pick-card">
              <fieldset className="new-session-scenario-radios" disabled={Boolean(queryReuseFrom)}>
                <legend>{copy.newSession.scenario}</legend>
                {queryReuseFrom ? (
                  <p className="field-hint">
                    Выбор сценария отключён: используется снимок графа из сессии <code>{queryReuseFrom}</code> (нужно для
                    совпадения stepId и пропуска шагов).
                  </p>
                ) : null}
                <ul className="new-session-scenario-list" role="presentation">
                  <li>
                    <label className="new-session-scenario-option">
                      <input
                        type="radio"
                        name="new-session-scenario"
                        value={BUILTIN_SCENARIO_PICK}
                        checked={scenarioPick === BUILTIN_SCENARIO_PICK}
                        onChange={() => setScenarioPick(BUILTIN_SCENARIO_PICK)}
                      />
                      <span className="new-session-scenario-option-text">
                        {copy.newSession.scenarioOptions.default}
                      </span>
                    </label>
                  </li>
                  {scenarioListLoading ? (
                    <li className="new-session-scenario-loading">{copy.newSession.scenarioOptions.loadingScenarios}</li>
                  ) : null}
                  {scenarioList
                    .filter((s) => s.source === "stored")
                    .map((s) => (
                      <li key={s.id}>
                        <label className="new-session-scenario-option">
                          <input
                            type="radio"
                            name="new-session-scenario"
                            value={s.id}
                            checked={scenarioPick === s.id}
                            onChange={() => setScenarioPick(s.id)}
                          />
                          <span className="new-session-scenario-option-text">
                            <span className="new-session-scenario-option-title">{s.name}</span>
                            <span className="new-session-scenario-option-meta">
                              {copy.newSession.scenarioOptions.serverScenario}: {s.id}
                              {s.latestVersion != null ? ` · v${String(s.latestVersion)}` : ""}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                </ul>
              </fieldset>
              <p className="field-hint new-session-scenario-builder-link">
                <Link href="/scenarios/build">{copy.newSession.scenarioOpenBuilder}</Link>
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function LlmPuppetSessionTile({ ctx }: { ctx: ModuleTileRenderContext }) {
  const llmSourceRaw = ctx.stepConfig.llmSource;
  const effectiveSource: "local" | "cloud" =
    llmSourceRaw === "cloud" ? "cloud" : llmSourceRaw === "local" ? "local" : ctx.llmActiveSource;
  const modelOptions = effectiveSource === "cloud" ? ctx.llmCloudModelOptions : ctx.llmLocalModelOptions;
  const llmModel =
    typeof ctx.stepConfig.llmModel === "string" && ctx.stepConfig.llmModel.trim().length > 0
      ? ctx.stepConfig.llmModel
      : modelOptions[0] ?? "";
  const sourceConn = effectiveSource === "cloud" ? ctx.llmCloudConnection : ctx.llmLocalConnection;
  const isReady =
    effectiveSource === "cloud"
      ? sourceConn.baseUrl.trim().length > 0 &&
        sourceConn.model.trim().length > 0 &&
        sourceConn.apiKey.trim().length > 0
      : sourceConn.baseUrl.trim().length > 0 && sourceConn.model.trim().length > 0;

  const optimizeForSmallContext = Boolean(ctx.stepConfig.optimizeForSmallContext);
  const targetContextTokens =
    typeof ctx.stepConfig.targetContextTokens === "number" ? ctx.stepConfig.targetContextTokens : 6000;
  const responseMaxTokens =
    typeof ctx.stepConfig.responseMaxTokens === "number" ? ctx.stepConfig.responseMaxTokens : 900;
  const reserveTokensForOutputRatio =
    typeof ctx.stepConfig.reserveTokensForOutputRatio === "number"
      ? ctx.stepConfig.reserveTokensForOutputRatio
      : 0.35;
  const compactGranularity =
    typeof ctx.stepConfig.compactGranularity === "string" ? ctx.stepConfig.compactGranularity : "balanced";
  const maxWindowsPerSpeaker =
    typeof ctx.stepConfig.maxWindowsPerSpeaker === "number" ? ctx.stepConfig.maxWindowsPerSpeaker : 6;
  const maxQuotesTotal = typeof ctx.stepConfig.maxQuotesTotal === "number" ? ctx.stepConfig.maxQuotesTotal : 12;
  const includeRawSegmentsTail = Boolean(ctx.stepConfig.includeRawSegmentsTail);
  const llmPreset = readLlmBehaviorPresetId(ctx.stepConfig);
  const llmRequestTimeoutMs =
    typeof ctx.stepConfig.llmRequestTimeoutMs === "number" ? ctx.stepConfig.llmRequestTimeoutMs : 120000;
  const llmMaxRetries = typeof ctx.stepConfig.llmMaxRetries === "number" ? ctx.stepConfig.llmMaxRetries : 2;
  const llmRetryBackoffMs =
    typeof ctx.stepConfig.llmRetryBackoffMs === "number" ? ctx.stepConfig.llmRetryBackoffMs : 2000;
  const llmAdaptiveDownshift = Boolean(ctx.stepConfig.llmAdaptiveDownshift ?? true);
  const normalizedTargetContextTokens = normalizeSteppedNumber(targetContextTokens, 512, 64000, 128);

  return (
    <>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 8px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--accent) 10%, transparent)",
          fontSize: 11,
          fontWeight: 700,
          width: "fit-content",
        }}
        aria-label="Активный источник LLM"
        title="Активный источник LLM из глобальных настроек"
      >
        <span style={{ opacity: 0.75 }}>Источник</span>
        <span>{effectiveSource === "cloud" ? "QWEN CLOUD" : "LOCAL"}</span>
        <span
          style={{
            marginLeft: 6,
            padding: "2px 6px",
            borderRadius: 999,
            background: isReady ? "rgba(16, 185, 129, 0.18)" : "rgba(239, 68, 68, 0.16)",
            color: isReady ? "#047857" : "#b91c1c",
          }}
          title={isReady ? "Модель готова к вызову" : "Заполните настройки выбранного источника"}
        >
          {isReady ? "готово" : "не готово"}
        </span>
      </div>
      <label className="field">
        Исполнитель
        <select
          value={effectiveSource}
          onChange={(e) => {
            const nextSource = e.target.value === "cloud" ? "cloud" : "local";
            const nextConn = nextSource === "cloud" ? ctx.llmCloudConnection : ctx.llmLocalConnection;
            const nextOptions = nextSource === "cloud" ? ctx.llmCloudModelOptions : ctx.llmLocalModelOptions;
            ctx.updateStepConfig({
              llmSource: nextSource,
              llmBaseUrl: nextConn.baseUrl,
              llmApiKey: nextConn.apiKey,
              llmModel: nextConn.model || nextOptions[0] || "",
            });
          }}
        >
          <option value="local">Локальная</option>
          <option value="cloud">Облачная</option>
        </select>
      </label>
      <label className="field">
        LLM модель исполнителя ({effectiveSource === "cloud" ? "облачная" : "локальная"})
        <select value={llmModel} onChange={(e) => ctx.updateStepConfig({ llmModel: e.target.value })}>
          {modelOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="field-hint">
          Список берется из выбранного исполнителя и глобальных настроек LLM.
        </span>
      </label>
      <button
        type="button"
        className="button-ghost"
        onClick={() =>
          ctx.updateStepConfig({
            llmBaseUrl: sourceConn.baseUrl,
            llmApiKey: sourceConn.apiKey,
            llmModel: sourceConn.model || modelOptions[0] || "",
          })
        }
      >
        Синхронизировать с настройками
      </button>

      <div className="field">
        <span>Профиль поведения LLM (контекст и ретраи)</span>
        <div className="stack compact-stack">
          <label className="field">
            Пресет
            <select
              value={llmPreset}
              onChange={(e) =>
                ctx.updateStepConfig(
                  applyLlmBehaviorPreset(ctx.stepConfig, (e.target.value as LlmBehaviorPresetId) || "medium"),
                )
              }
            >
              <option value="weak">Слабая модель</option>
              <option value="medium">Средняя модель</option>
              <option value="strong">Сильная модель</option>
            </select>
          </label>
          <label className="asr-gpu-inline">
            <input
              type="checkbox"
              checked={optimizeForSmallContext}
              onChange={(e) => ctx.updateStepConfig({ optimizeForSmallContext: e.target.checked })}
            />{" "}
            Оптимизировать вход под малый контекст
          </label>
          <div className="grid-2">
            <label className="field">
              targetContextTokens
              <input
                type="number"
                min="512"
                max="64000"
                step="128"
                value={normalizedTargetContextTokens}
                onChange={(e) =>
                  ctx.updateStepConfig({
                    targetContextTokens: normalizeSteppedNumber(Number(e.target.value), 512, 64000, 128),
                  })
                }
              />
            </label>
            <label className="field">
              responseMaxTokens
              <input
                type="number"
                min="200"
                max="4000"
                step="50"
                value={responseMaxTokens}
                onChange={(e) => ctx.updateStepConfig({ responseMaxTokens: Number(e.target.value) })}
              />
            </label>
          </div>
          {optimizeForSmallContext ? (
            <>
              <div className="grid-2">
                <label className="field">
                  compactGranularity
                  <select
                    value={compactGranularity}
                    onChange={(e) => ctx.updateStepConfig({ compactGranularity: e.target.value })}
                  >
                    <option value="coarse">coarse</option>
                    <option value="balanced">balanced</option>
                    <option value="fine">fine</option>
                  </select>
                </label>
                <label className="field">
                  reserveTokensForOutputRatio
                  <input
                    type="number"
                    min="0.2"
                    max="0.6"
                    step="0.01"
                    value={reserveTokensForOutputRatio}
                    onChange={(e) =>
                      ctx.updateStepConfig({ reserveTokensForOutputRatio: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <div className="grid-2">
                <label className="field">
                  maxWindowsPerSpeaker
                  <input
                    type="number"
                    min="2"
                    max="20"
                    step="1"
                    value={maxWindowsPerSpeaker}
                    onChange={(e) => ctx.updateStepConfig({ maxWindowsPerSpeaker: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  maxQuotesTotal
                  <input
                    type="number"
                    min="0"
                    max="40"
                    step="1"
                    value={maxQuotesTotal}
                    onChange={(e) => ctx.updateStepConfig({ maxQuotesTotal: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="asr-gpu-inline">
                <input
                  type="checkbox"
                  checked={includeRawSegmentsTail}
                  onChange={(e) => ctx.updateStepConfig({ includeRawSegmentsTail: e.target.checked })}
                />{" "}
                includeRawSegmentsTail
              </label>
            </>
          ) : null}
          <div className="grid-2">
            <label className="field">
              llmRequestTimeoutMs
              <input
                type="number"
                min="30000"
                max="600000"
                step="5000"
                value={llmRequestTimeoutMs}
                onChange={(e) => ctx.updateStepConfig({ llmRequestTimeoutMs: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              llmMaxRetries
              <input
                type="number"
                min="0"
                max="5"
                step="1"
                value={llmMaxRetries}
                onChange={(e) => ctx.updateStepConfig({ llmMaxRetries: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="grid-2">
            <label className="field">
              llmRetryBackoffMs
              <input
                type="number"
                min="250"
                max="30000"
                step="250"
                value={llmRetryBackoffMs}
                onChange={(e) => ctx.updateStepConfig({ llmRetryBackoffMs: Number(e.target.value) })}
              />
            </label>
            <label className="asr-gpu-inline" style={{ marginTop: "1.6rem" }}>
              <input
                type="checkbox"
                checked={llmAdaptiveDownshift}
                onChange={(e) => ctx.updateStepConfig({ llmAdaptiveDownshift: e.target.checked })}
              />{" "}
              adaptive downshift при ретрае
            </label>
          </div>
        </div>
        <p className="field-hint">
          Для длинных записей используйте weak/medium: включаются retry/backoff, timeout и адаптивное сжатие контекста
          при повторах. Эти параметры используют все подзадачи пульта.
        </p>
      </div>
    </>
  );
}

function renderModuleTileFields(moduleId: ScenarioStep["moduleId"], ctx: ModuleTileRenderContext) {
  if (ctx.tileLocked) {
    return (
      <div className="stack">
        <p className="field-hint">
          Переиспользование из сессии{" "}
          {ctx.reuseSourceSessionId ? <code>{ctx.reuseSourceSessionId}</code> : null}: шаг выполняется из готовых
          артефактов, поля заблокированы.
        </p>
      </div>
    );
  }
  if (moduleId === "CHECKLIST_SOURCE") {
    const filePath = typeof ctx.stepConfig.filePath === "string" ? ctx.stepConfig.filePath : "checklists/checklist.sample.json";
    return (
      <div className="stack">
        <label className="field">
          Путь к JSON чек-листу
          <input
            type="text"
            value={filePath}
            placeholder="checklists/checklist.sample.json"
            onChange={(e) => ctx.updateStepConfig({ filePath: e.target.value })}
          />
          <span className="field-hint">
            Если путь относительный — считается от корня web-приложения. Пункты чек-листа будут использоваться как «темы» для LLM проверки.
          </span>
        </label>
      </div>
    );
  }
  if (moduleId === "AUDIO_FROM_UPLOAD") {
    return (
      <div className="stack">
        <label className="field">
          {ctx.copy.newSession.audioFile}
          <input
            type="file"
            accept=".mp3,.wav,audio/*"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              ctx.setAudioFile(nextFile);
              ctx.setAudioFileName(nextFile?.name ?? "");
            }}
          />
          {ctx.audioFileName ? <span className="field-hint">{ctx.audioFileName}</span> : null}
        </label>
      </div>
    );
  }

  if (moduleId === "AUDIO_FROM_URL") {
    const url = typeof ctx.stepConfig.url === "string" ? ctx.stepConfig.url : "";
    return (
      <div className="stack">
        <label className="field">
          URL аудио
          <input
            type="text"
            value={url}
            placeholder="https://example.com/audio.wav"
            onChange={(event) => ctx.updateStepConfig({ url: event.target.value })}
          />
        </label>
      </div>
    );
  }

  if (moduleId === "AUDIO_FROM_RTSP") {
    const rtspUrl = typeof ctx.stepConfig.rtspUrl === "string" ? ctx.stepConfig.rtspUrl : "";
    const captureSec =
      typeof ctx.stepConfig.captureSec === "number" ? ctx.stepConfig.captureSec : 60;
    const transport = typeof ctx.stepConfig.transport === "string" ? ctx.stepConfig.transport : "tcp";
    return (
      <div className="stack">
        <label className="field">
          RTSP URL
          <input
            type="text"
            value={rtspUrl}
            placeholder="rtsp://..."
            onChange={(event) => ctx.updateStepConfig({ rtspUrl: event.target.value })}
          />
        </label>
        <div className="grid-2">
          <label className="field">
            Длительность захвата (сек)
            <input
              type="number"
              min="1"
              step="1"
              value={captureSec}
              onChange={(event) => ctx.updateStepConfig({ captureSec: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            Транспорт
            <select
              value={transport === "udp" ? "udp" : "tcp"}
              onChange={(event) => ctx.updateStepConfig({ transport: event.target.value })}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
          </label>
        </div>
      </div>
    );
  }

  if (moduleId === "AUDIO_FROM_API") {
    const endpoint = typeof ctx.stepConfig.endpoint === "string" ? ctx.stepConfig.endpoint : "";
    const method = typeof ctx.stepConfig.method === "string" ? ctx.stepConfig.method : "GET";
    const body = typeof ctx.stepConfig.body === "string" ? ctx.stepConfig.body : "";
    return (
      <div className="stack">
        <label className="field">
          Endpoint
          <input
            type="text"
            value={endpoint}
            placeholder="https://example.com/audio"
            onChange={(event) => ctx.updateStepConfig({ endpoint: event.target.value })}
          />
        </label>
        <div className="grid-2">
          <label className="field">
            Method
            <select value={method} onChange={(e) => ctx.updateStepConfig({ method: e.target.value })}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>
          <label className="field">
            Body (опционально)
            <textarea
              value={body}
              rows={3}
              onChange={(e) => ctx.updateStepConfig({ body: e.target.value })}
            />
          </label>
        </div>
        <p className="field-hint">Заголовки пока не редактируются в UI; передайте их через `config.headers` в сценарии.</p>
      </div>
    );
  }

  if (moduleId === "AUDIO_PREPARE") {
    const targetSampleRate =
      typeof ctx.stepConfig.targetSampleRate === "number" ? ctx.stepConfig.targetSampleRate : 16000;
    const targetChannels =
      typeof ctx.stepConfig.targetChannels === "number" ? ctx.stepConfig.targetChannels : 1;
    const chunkSec =
      typeof ctx.stepConfig.chunkSec === "number" ? ctx.stepConfig.chunkSec : 120;
    const overlapSec =
      typeof ctx.stepConfig.overlapSec === "number" ? ctx.stepConfig.overlapSec : 1;
    return (
      <div className="stack">
        <div className="grid-2">
          <label className="field">
            Sample rate
            <input
              type="number"
              min="8000"
              step="1000"
              value={targetSampleRate}
              onChange={(e) => ctx.updateStepConfig({ targetSampleRate: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Channels
            <input
              type="number"
              min="1"
              step="1"
              value={targetChannels}
              onChange={(e) => ctx.updateStepConfig({ targetChannels: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="grid-2">
          <label className="field">
            Chunk (сек)
            <input
              type="number"
              min="1"
              step="1"
              value={chunkSec}
              onChange={(e) => ctx.updateStepConfig({ chunkSec: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Overlap (сек)
            <input
              type="number"
              min="0"
              step="0.25"
              value={overlapSec}
              onChange={(e) => ctx.updateStepConfig({ overlapSec: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>
    );
  }

  if (isLlmGraphLlmBranchModule(moduleId)) {
    const disabledRaw = ctx.stepConfig.llmDisabledPromptStepIds;
    const disabled = new Set(
      Array.isArray(disabledRaw) ? disabledRaw.filter((x): x is string => typeof x === "string") : [],
    );
    const stepById = new Map(ctx.scenario.steps.map((s) => [s.id, s]));
    const promptEdges = ctx.scenario.edges.filter(
      (e) => e.toStepId === ctx.stepId && e.artifactTypeId === "LLM_INSTRUCTIONS",
    );

    function setPromptSourceEnabled(fromStepId: string, enabled: boolean) {
      const cur = (
        Array.isArray(ctx.stepConfig.llmDisabledPromptStepIds)
          ? [...(ctx.stepConfig.llmDisabledPromptStepIds as string[])]
          : []
      ) as string[];
      if (enabled) {
        ctx.updateStepConfig({ llmDisabledPromptStepIds: cur.filter((id) => id !== fromStepId) });
      } else if (!cur.includes(fromStepId)) {
        ctx.updateStepConfig({ llmDisabledPromptStepIds: [...cur, fromStepId] });
      }
    }

    const instructionIntent =
      typeof ctx.stepConfig.instructionIntent === "string" ? ctx.stepConfig.instructionIntent : "summary";
    const instructionPrompt =
      typeof ctx.stepConfig.instructionPrompt === "string" ? ctx.stepConfig.instructionPrompt : "";
    const summaryScenario =
      typeof ctx.stepConfig.summaryScenario === "string" ? ctx.stepConfig.summaryScenario : "docs";
    const summarySubScenario =
      typeof ctx.stepConfig.summarySubScenario === "string" ? ctx.stepConfig.summarySubScenario : "protocol";
    const summaryLanguage =
      typeof ctx.stepConfig.summaryLanguage === "string" ? ctx.stepConfig.summaryLanguage : "ru";
    const speakerNamePrompt =
      typeof ctx.stepConfig.speakerNamePrompt === "string" ? ctx.stepConfig.speakerNamePrompt : "";
    const psychMode =
      ctx.stepConfig.psychMode === "full_psycho_analytics" ? "full_psycho_analytics" : "default";
    const enableLlmLexiconCheck = ctx.stepConfig.enableLlmLexiconCheck === true;
    const llmLexiconCheckMode =
      ctx.stepConfig.llmLexiconCheckMode === "always" ? "always" : "weak_only";
    const weakRuleThreshold =
      typeof ctx.stepConfig.weakRuleThreshold === "number" ? ctx.stepConfig.weakRuleThreshold : 0.6;
    const maxExtraLabels =
      typeof ctx.stepConfig.maxExtraLabels === "number" ? ctx.stepConfig.maxExtraLabels : 2;

    return (
      <div className="stack">
        {moduleId === "LLM_PUPPET" ? <LlmPuppetSessionTile ctx={ctx} /> : null}
        {moduleId === "LLM_TASK_SUMMARY" ? (
          <>
            <div className="grid-3">
              <label className="field">
                Сценарий суммаризации
                <select
                  value={summaryScenario}
                  onChange={(e) => {
                    const nextScenario = e.target.value;
                    const defaultSubScenario =
                      nextScenario === "analytics"
                        ? "problems"
                        : nextScenario === "planning"
                          ? "actionplan"
                          : "protocol";
                    ctx.updateStepConfig({ summaryScenario: nextScenario, summarySubScenario: defaultSubScenario });
                  }}
                >
                  <option value="docs">docs</option>
                  <option value="analytics">analytics</option>
                  <option value="planning">planning</option>
                </select>
              </label>
              <label className="field">
                Подсценарий
                <select
                  value={summarySubScenario}
                  onChange={(e) => ctx.updateStepConfig({ summarySubScenario: e.target.value })}
                >
                  {summaryScenario === "docs" ? (
                    <>
                      <option value="protocol">protocol</option>
                      <option value="tasklist">tasklist</option>
                      <option value="agreements">agreements</option>
                    </>
                  ) : null}
                  {summaryScenario === "analytics" ? (
                    <>
                      <option value="problems">problems</option>
                      <option value="risks">risks</option>
                      <option value="positions">positions</option>
                    </>
                  ) : null}
                  {summaryScenario === "planning" ? (
                    <>
                      <option value="actionplan">actionplan</option>
                      <option value="priorities">priorities</option>
                      <option value="checklist">checklist</option>
                    </>
                  ) : null}
                </select>
              </label>
              <label className="field">
                Язык
                <select
                  value={summaryLanguage}
                  onChange={(e) => ctx.updateStepConfig({ summaryLanguage: e.target.value })}
                >
                  <option value="ru">ru</option>
                  <option value="en">en</option>
                </select>
              </label>
            </div>
            <label className="field">
              Intent (ярлык фрагмента)
              <input
                value={instructionIntent}
                onChange={(e) => ctx.updateStepConfig({ instructionIntent: e.target.value })}
                placeholder="summary"
              />
            </label>
            <label className="field">
              Текст инструкции для LLM
              <textarea
                rows={5}
                value={instructionPrompt}
                onChange={(e) => ctx.updateStepConfig({ instructionPrompt: e.target.value })}
                placeholder="Что именно должна сделать модель с транскриптом…"
              />
            </label>
          </>
        ) : null}
        {moduleId === "LLM_TASK_SPEAKER_NAMES" ? (
          <label className="field">
            Промпт (имена спикеров)
            <textarea
              rows={5}
              value={speakerNamePrompt}
              onChange={(e) => ctx.updateStepConfig({ speakerNamePrompt: e.target.value })}
              placeholder="Пусто — будет дефолтная инструкция про сопоставление SPEAKER_* с именами."
            />
          </label>
        ) : null}
        {moduleId === "LLM_TASK_PSYCH" ? (
          <div className="stack compact-stack">
            <label className="field">
              Режим psychMode
              <select value={psychMode} onChange={(e) => ctx.updateStepConfig({ psychMode: e.target.value })}>
                <option value="default">default</option>
                <option value="full_psycho_analytics">full_psycho_analytics</option>
              </select>
            </label>
            <label className="asr-gpu-inline">
              <input
                type="checkbox"
                checked={enableLlmLexiconCheck}
                onChange={(e) => ctx.updateStepConfig({ enableLlmLexiconCheck: e.target.checked })}
              />{" "}
              Проверка LLM для rule-based меток
            </label>
            <div className="grid-2">
              <label className="field">
                Режим проверки
                <select
                  value={llmLexiconCheckMode}
                  onChange={(e) => ctx.updateStepConfig({ llmLexiconCheckMode: e.target.value })}
                  disabled={!enableLlmLexiconCheck}
                >
                  <option value="weak_only">weak_only (только слабые правила)</option>
                  <option value="always">always (все сегменты)</option>
                </select>
              </label>
              <label className="field">
                Порог weakRuleThreshold
                <input
                  type="number"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={weakRuleThreshold}
                  disabled={!enableLlmLexiconCheck}
                  onChange={(e) => ctx.updateStepConfig({ weakRuleThreshold: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="field">
              maxExtraLabels
              <input
                type="number"
                min="0"
                max="6"
                step="1"
                value={maxExtraLabels}
                disabled={!enableLlmLexiconCheck}
                onChange={(e) => ctx.updateStepConfig({ maxExtraLabels: Number(e.target.value) })}
              />
            </label>
            <p className="field-hint">
              Сначала работают deterministic правила (librosa), затем LLM проверяет weak/все сегменты и помечает
              source=rules|llm|mixed.
            </p>
          </div>
        ) : null}
        {promptEdges.length > 0 ? (
          <div className="field">
            <span>Промпты по рёбрам LLM_INSTRUCTIONS</span>
            <div className="stack compact-stack">
              {promptEdges.map((e) => {
                const from = stepById.get(e.fromStepId);
                const title = from
                  ? `${ctx.moduleLabelById.get(from.moduleId) ?? from.moduleId} · ${from.code}`
                  : e.fromStepId;
                const checked = !disabled.has(e.fromStepId);
                return (
                  <label key={e.id} className="asr-gpu-inline">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(ev) => setPromptSourceEnabled(e.fromStepId, ev.target.checked)}
                    />{" "}
                    {title}
                  </label>
                );
              })}
            </div>
            <p className="field-hint">
              Снимите галочку, чтобы фрагмент промпта от этого шага не попадал в LLM (ребро в графе остаётся).
            </p>
          </div>
        ) : (
          <>
            <p className="field-hint">
              Подзадачи принимают данные по прямым артефактам (RDY/ENR/IDM и т.д.); пульт — по рёбрам{" "}
              <code>LLM_SUBTASK</code> от подзадач. Второй вход <code>LLM_INSTRUCTIONS</code> — если в графе есть шаг,
              который его производит.
            </p>
            <p className="field-hint">
              Для бизнес-ветки канонический таймлайн должен идти из <code>READY_SPEAKERS</code> (или{" "}
              <code>ENRICHED_TRANSCRIPT</code> в задаче просодии).
            </p>
          </>
        )}
      </div>
    );
  }

  if (moduleId === "REPORT_OUTPUT") {
    const strict = Boolean(ctx.stepConfig.strict);
    const sectionsRaw = ctx.stepConfig.sections && typeof ctx.stepConfig.sections === "object" ? ctx.stepConfig.sections : {};
    const sections = sectionsRaw as Record<string, unknown>;
    const renderInputsRaw =
      ctx.stepConfig.renderInputs && typeof ctx.stepConfig.renderInputs === "object"
        ? (ctx.stepConfig.renderInputs as Record<string, unknown>)
        : {};

    const avail = computeReportSectionAvailability(ctx.scenario, ctx.stepId);
    const directInputTypes = listReportDirectInputTypes(ctx.scenario, ctx.stepId);
    const directRenderInputTypes = directInputTypes.filter((t) => t !== "LLM_INSTRUCTIONS" && t !== "LLM_SUBTASK");

    const summaryChecked = sections.summary !== false;
    const transcriptChecked = sections.transcript !== false;
    const psychChecked = sections.psych !== false;
    const checklistChecked = sections.checklist !== false;

    const anySection = avail.summary || avail.transcript || avail.psych || avail.checklist;

    return (
      <div className="stack">
        <label className="field">
          <span>Фактические входы REPORT_OUTPUT (по рёбрам)</span>
          {directInputTypes.length > 0 ? (
            <div className="stack compact-stack">
              <code>{directInputTypes.join(", ")}</code>
            </div>
          ) : (
            <p className="field-hint">Нет входящих рёбер в REPORT_OUTPUT.</p>
          )}
        </label>
        <label className="field">
          <span>Рендер входов (только подключенные по схеме)</span>
          {directRenderInputTypes.length > 0 ? (
            <div className="stack compact-stack">
              {directRenderInputTypes.map((art) => {
                const checked = renderInputsRaw[art] !== false;
                return (
                  <label key={`rin-${art}`} className="asr-gpu-inline">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        ctx.updateStepConfig({
                          renderInputs: {
                            ...renderInputsRaw,
                            [art]: e.target.checked,
                          },
                        })
                      }
                    />{" "}
                    {art}
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="field-hint">Нет входов для рендера: подключите артефакты к REPORT_OUTPUT по рёбрам.</p>
          )}
          <p className="field-hint">В итоговый отчет попадут только включенные типы из реально подключенных входов.</p>
        </label>
        <label className="field">
          <span>Секции отчёта</span>
          <p className="field-hint">
            Секции ниже отражают только то, что реально приходит во вход REPORT_OUTPUT по рёбрам.
          </p>
          {anySection ? (
            <div className="stack compact-stack">
              {avail.summary ? (
                <label className="asr-gpu-inline">
                  <input
                    type="checkbox"
                    checked={summaryChecked}
                    onChange={(e) =>
                      ctx.updateStepConfig({ sections: { ...sections, summary: e.target.checked }, strict })
                    }
                  />{" "}
                  Summary
                </label>
              ) : null}
              {avail.transcript ? (
                <label className="asr-gpu-inline">
                  <input
                    type="checkbox"
                    checked={transcriptChecked}
                    onChange={(e) =>
                      ctx.updateStepConfig({ sections: { ...sections, transcript: e.target.checked }, strict })
                    }
                  />{" "}
                  Transcript
                </label>
              ) : null}
              {avail.psych ? (
                <label className="asr-gpu-inline">
                  <input
                    type="checkbox"
                    checked={psychChecked}
                    onChange={(e) =>
                      ctx.updateStepConfig({ sections: { ...sections, psych: e.target.checked }, strict })
                    }
                  />{" "}
                  Psych
                </label>
              ) : null}
              {avail.checklist ? (
                <label className="asr-gpu-inline">
                  <input
                    type="checkbox"
                    checked={checklistChecked}
                    onChange={(e) =>
                      ctx.updateStepConfig({ sections: { ...sections, checklist: e.target.checked }, strict })
                    }
                  />{" "}
                  Checklist
                </label>
              ) : null}
            </div>
          ) : (
            <p className="field-hint">
              Нет подходящих входов: подключите к отчёту или к LLM артефакты вроде <code>SUMMARY_TEXT</code>,{" "}
              <code>TRANSCRIPT_SEGMENTS</code>, <code>PSYCH_NARRATIVE</code>, <code>CHECKLIST_RESULTS</code> и т.д.
            </p>
          )}
        </label>
        <label className="field">
          <span>Strict</span>
          <label className="asr-gpu-inline">
            <input type="checkbox" checked={strict} onChange={(e) => ctx.updateStepConfig({ strict: e.target.checked })} />{" "}
            Включить строгую проверку готовности артефактов
          </label>
        </label>
      </div>
    );
  }

  if (moduleId === "ASR") {
    return (
      <div className="stack">
        <div className="field asr-gpu-checkbox">
          <span>{ctx.copy.newSession.asrDevice}</span>
          <label className="asr-gpu-inline">
            <input
              type="checkbox"
              checked={ctx.asrUseGpu}
              onChange={(event) => {
                const next = event.target.checked;
                ctx.setAsrUseGpu(next);
                ctx.updateStepConfig({ asrDevice: next ? "auto" : "cpu" });
              }}
            />{" "}
            GPU
          </label>
        </div>
        <label className="field">
          {ctx.copy.newSession.whisperModel}
          <div className="asr-model-switch" role="radiogroup" aria-label={ctx.copy.newSession.whisperModel}>
            {(
              [
                ["tiny", "tiny", "быстро"],
                ["base", "base", "баланс"],
                ["small", "small", "хорошо"],
                ["medium", "medium", "супер"],
              ] as const
            ).map(([id, title, hint]) => (
              <button
                key={id}
                type="button"
                className="asr-model-switch-btn"
                aria-pressed={ctx.whisperModel === id}
                onClick={() => {
                  ctx.setWhisperModel(id);
                  ctx.updateStepConfig({ whisperModel: id });
                }}
              >
                <span className="asr-model-title">{title}</span>
                <span className="asr-model-divider" aria-hidden="true" />
                <span className="asr-model-hint">{hint}</span>
              </button>
            ))}
          </div>
        </label>
      </div>
    );
  }
  if (moduleId === "DIARIZATION") {
    return (
      <div className="stack">
        <div className="field asr-gpu-checkbox">
          <span>{ctx.copy.newSession.diarizationDeviceMode}</span>
          <label className="asr-gpu-inline">
            <input
              type="checkbox"
              checked={ctx.diarizationUseGpu}
              onChange={(event) => {
                const next = event.target.checked;
                ctx.setDiarizationUseGpu(next);
                ctx.updateStepConfig({ diarizationDeviceMode: next ? "auto" : "cpu" });
              }}
            />{" "}
            GPU
          </label>
        </div>
        <div className="grid-2">
          <label className="field">
            {ctx.copy.newSession.diarizationMergeGap}
            <input
              type="number"
              step="0.05"
              min="0"
              value={ctx.diarizationMergeGapSec}
              onChange={(event) => {
                const v = Number(event.target.value);
                ctx.setDiarizationMergeGapSec(v);
                ctx.updateStepConfig({ diarizationMergeGapSec: v });
              }}
            />
          </label>
          <label className="field">
            {ctx.copy.newSession.diarizationMinTurn}
            <input
              type="number"
              step="0.05"
              min="0"
              value={ctx.diarizationMinTurnSec}
              onChange={(event) => {
                const v = Number(event.target.value);
                ctx.setDiarizationMinTurnSec(v);
                ctx.updateStepConfig({ diarizationMinTurnSec: v });
              }}
            />
          </label>
        </div>
      </div>
    );
  }
  if (moduleId === "PSYCH_STATE") {
    const requireReadySpeakers = ctx.stepConfig.requireReadySpeakers !== false;
    const fallbackSource =
      typeof ctx.stepConfig.fallbackSource === "string" ? ctx.stepConfig.fallbackSource : "draft_only";
    return (
      <div className="stack">
        <label className="field">
          <span>Источник сегментов для PROSODY</span>
          <div className="stack compact-stack">
            <div className="field-hint">
              Каноничный источник: <code>READY_SPEAKERS</code>.
            </div>
            <label className="asr-gpu-inline">
              <input
                type="checkbox"
                checked={requireReadySpeakers}
                onChange={(e) => ctx.updateStepConfig({ requireReadySpeakers: e.target.checked })}
              />{" "}
              Требовать READY_SPEAKERS (без fallback)
            </label>
            <label className="field">
              fallbackSource
              <select
                value={fallbackSource === "draft_then_raw" ? "draft_then_raw" : "draft_only"}
                disabled={requireReadySpeakers}
                onChange={(e) => ctx.updateStepConfig({ fallbackSource: e.target.value })}
              >
                <option value="draft_only">draft_only</option>
                <option value="draft_then_raw">draft_then_raw</option>
              </select>
            </label>
          </div>
        </label>
      </div>
    );
  }
  return <p className="field-hint">Плитка не требует параметров, используется конфиг шага из сценария.</p>;
}

async function uploadAudioIfNeeded(file: File | null): Promise<string | null> {
  if (!file) {
    return null;
  }
  const form = new FormData();
  form.append("file", file);

  const response = await fetch("/api/uploads/local", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error("Не удалось загрузить аудиофайл локально");
  }
  const payload = (await response.json()) as { localUrl?: string };
  if (!payload.localUrl) {
    throw new Error("Локальный URL аудиофайла не получен");
  }
  return payload.localUrl;
}
