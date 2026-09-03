import type { ModuleId } from "../../types/pipeline.types";
import { OLLAMA_DEFAULT_MODEL_TAG } from "../llm/ollama-default-model";
import { TRANSCRIPT_ONLY_REPORT_SECTIONS } from "../report/assemble-report";
import { REPORT_OUTPUT_ACCEPTED_INPUTS } from "./report-output-inputs";
import { isLlmTaskSatellite } from "./llm-orchestrator-modules";
import { defaultLlmRunOrder } from "./llm-run-order";
import { getLlmBehaviorPreset } from "./llm-behavior-presets";

/**
 * Default `step.config` for each module (used when creating steps from the canvas).
 * These defaults are intentionally aligned with the current `/sessions/new` UI fields
 * so that constructor previews map to session tiles.
 */
export const MODULE_DEFAULT_CONFIG: Partial<Record<ModuleId, Record<string, unknown>>> = {
  AUDIO_FROM_UPLOAD: {
    localUrl: "",
  },
  AUDIO_FROM_URL: {
    url: "",
  },
  AUDIO_FROM_API: {
    endpoint: "",
    method: "GET",
    body: "",
    headers: {},
  },
  AUDIO_FROM_RTSP: {
    rtspUrl: "",
    captureSec: 60,
    transport: "tcp",
  },
  CHECKLIST_SOURCE: {
    /**
     * Путь до JSON файла чек-листа. Если относительный — от корня web-приложения (apps/web).
     * Рекомендуемый каталог: `checklists/`.
     */
    filePath: "checklists/checklist.sample.json",
  },
  AUDIO_PREPARE: {
    targetSampleRate: 16000,
    targetChannels: 1,
    chunkSec: 120,
    overlapSec: 1,
  },
  ASR: {
    whisperModel: "small",
    asrDevice: "auto",
    asrComputeType: "int8",
  },
  SPEAKER_TURN_MERGE: {},
  SPEAKER_DRAFT_EDIT: {},
  DIARIZATION: {
    diarizationModel: "pyannote/speaker-diarization-3.1",
    localPyannoteModelPath: "",
    diarizationMode: "local_pyannote",
    diarizationMergeGapSec: 0.25,
    diarizationMinTurnSec: 0.4,
    diarizationDeviceMode: "auto",
  },
  PSYCH_STATE: {
    canonicalSource: "READY_SPEAKERS",
    requireReadySpeakers: true,
    fallbackSource: "draft_only",
  },
  LLM_PUPPET: {
    llmBaseUrl: "",
    llmApiKey: "",
    llmModel: OLLAMA_DEFAULT_MODEL_TAG,
    ...getLlmBehaviorPreset("medium"),
  },
  /** Дефолтный текст задания для подзадачи «ОБОБЩЕНИЕ». */
  LLM_TASK_SUMMARY: {
    instructionIntent: "llm_summary",
    summaryScenario: "docs",
    summarySubScenario: "protocol",
    summaryLanguage: "ru",
    instructionPrompt: [
      "Ответ СТРОГО JSON, без markdown и без комментариев.",
      "Сформируй структурированное резюме встречи на основе переданных артефактов.",
      "",
      "Верни объект формата:",
      '{"scenario":"docs","subScenario":"protocol","sections":[{"id":"decisions","title":"Принятые решения","items":[{"id":"D1","text":"...","owners":[],"deadline":null,"evidence":[{"startSec":0,"endSec":0,"speakerId":"speaker_00"}]}]}],"quality":{"notes":"...","doNotInfer":["..."]}}',
      "",
      "Правила:",
      "- scenario/subScenario бери из config.summaryScenario/config.summarySubScenario.",
      "- sections/items должны быть пригодны для рендера в отчете (списки/карточки/чек-листы).",
      "- evidence обязательно для важных пунктов (1-2 фрагмента).",
      "- Не придумывай факты. Без клинических или юридических выводов.",
    ].join("\n"),
  },
  LLM_TASK_PSYCH: {
    psychMode: "default",
    enableLlmLexiconCheck: false,
    llmLexiconCheckMode: "weak_only",
    weakRuleThreshold: 0.6,
    maxExtraLabels: 2,
  },
  REPORT_OUTPUT: {
    sections: { ...TRANSCRIPT_ONLY_REPORT_SECTIONS },
    strict: false,
    renderInputs: Object.fromEntries(REPORT_OUTPUT_ACCEPTED_INPUTS.map((t) => [t, true])),
  },
};

export function getDefaultModuleConfig(moduleId: ModuleId): Record<string, unknown> {
  if (moduleId === "LLM_TASK_SUMMARY") {
    return {
      llmRunOrder: defaultLlmRunOrder("LLM_TASK_SUMMARY"),
      ...(MODULE_DEFAULT_CONFIG.LLM_TASK_SUMMARY ?? {}),
    };
  }
  if (moduleId === "LLM_TASK_SPEAKER_NAMES") {
    return {
      llmRunOrder: defaultLlmRunOrder("LLM_TASK_SPEAKER_NAMES"),
      speakerNamePrompt: "",
    };
  }
  if (moduleId === "LLM_TASK_PSYCH") {
    return {
      llmRunOrder: defaultLlmRunOrder("LLM_TASK_PSYCH"),
      ...(MODULE_DEFAULT_CONFIG.LLM_TASK_PSYCH ?? {}),
    };
  }
  const raw = MODULE_DEFAULT_CONFIG[moduleId];
  if (raw) return { ...raw };
  if (isLlmTaskSatellite(moduleId)) {
    return {
      llmRunOrder: defaultLlmRunOrder(moduleId),
    };
  }
  return {};
}
