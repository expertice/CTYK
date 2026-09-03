/**
 * Глобальные настройки приложения (клиент, localStorage).
 * Сейчас храним только параметры подключения локальной LLM (OpenAI-совместимый API).
 */

import { normalizeLlmModelName, OLLAMA_DEFAULT_MODEL_TAG } from "../llm/ollama-default-model";
import { DEFAULT_PROCESS_SETTINGS, parseProcessSettings, type ProcessSettings } from "../pipeline/process-settings";

export type GlobalSettings = {
  llmActiveSource: "local" | "cloud";
  llmLocal: {
    /** Базовый URL без завершающего слэша, например http://127.0.0.1:11434/v1 (Ollama) */
    baseUrl: string;
    apiKey: string;
    /** Имя модели на стороне сервера (Ollama/vLLM/LM Studio) */
    model: string;
    /** Последний полученный список моделей локального endpoint (например Ollama /api/tags). */
    availableModels?: string[];
  };
  llmCloud: {
    provider: "qwen";
    /** OpenAI-compatible endpoint Qwen Cloud */
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  process: ProcessSettings;
};

const STORAGE_KEY = "ctykGlobalLlmSettings_v1";

function getWindow(): Window | null {
  if (typeof window === "undefined") return null;
  return window;
}

/** Дефолты: типичный Ollama OpenAI endpoint и тег модели из каталога Ollama. */
export function createDefaultGlobalSettings(): GlobalSettings {
  return {
    llmActiveSource: "local",
    llmLocal: {
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      model: OLLAMA_DEFAULT_MODEL_TAG,
      availableModels: [],
    },
    llmCloud: {
      provider: "qwen",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      apiKey: "",
      model: "qwen-plus",
    },
    process: { ...DEFAULT_PROCESS_SETTINGS },
  };
}

export function readGlobalSettings(): GlobalSettings {
  const w = getWindow();
  if (!w) return createDefaultGlobalSettings();

  try {
    const raw = w.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultGlobalSettings();
    const parsed = JSON.parse(raw) as Partial<{
      llmActiveSource: GlobalSettings["llmActiveSource"];
      llmLocal: Partial<GlobalSettings["llmLocal"]>;
      llmCloud: Partial<GlobalSettings["llmCloud"]>;
      process: Partial<GlobalSettings["process"]>;
    }>;
    const defaults = createDefaultGlobalSettings();
    const storedModel =
      typeof parsed.llmLocal?.model === "string" && parsed.llmLocal.model.trim().length > 0
        ? parsed.llmLocal.model.trim()
        : defaults.llmLocal.model;
    const storedAvailableModels = Array.isArray(parsed.llmLocal?.availableModels)
      ? parsed.llmLocal?.availableModels.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      : defaults.llmLocal.availableModels ?? [];
    return {
      llmActiveSource: parsed.llmActiveSource === "cloud" ? "cloud" : "local",
      llmLocal: {
        baseUrl: typeof parsed.llmLocal?.baseUrl === "string" ? parsed.llmLocal.baseUrl : defaults.llmLocal.baseUrl,
        apiKey: typeof parsed.llmLocal?.apiKey === "string" ? parsed.llmLocal.apiKey : defaults.llmLocal.apiKey,
        model: normalizeLlmModelName(storedModel),
        availableModels: storedAvailableModels,
      },
      llmCloud: {
        provider: "qwen",
        baseUrl:
          typeof parsed.llmCloud?.baseUrl === "string" && parsed.llmCloud.baseUrl.trim().length > 0
            ? parsed.llmCloud.baseUrl
            : defaults.llmCloud.baseUrl,
        apiKey: typeof parsed.llmCloud?.apiKey === "string" ? parsed.llmCloud.apiKey : defaults.llmCloud.apiKey,
        model:
          typeof parsed.llmCloud?.model === "string" && parsed.llmCloud.model.trim().length > 0
            ? parsed.llmCloud.model.trim()
            : defaults.llmCloud.model,
      },
      process: parseProcessSettings(parsed.process ?? defaults.process),
    };
  } catch {
    return createDefaultGlobalSettings();
  }
}

export function writeGlobalSettings(next: GlobalSettings): void {
  const w = getWindow();
  if (!w) return;
  try {
    w.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export function notifyGlobalSettingsChanged(next: GlobalSettings): void {
  const w = getWindow();
  if (!w) return;
  try {
    const event = new CustomEvent("ctyk:globalSettingsChanged", { detail: next });
    w.dispatchEvent(event);
  } catch {
    // ignore
  }
}
