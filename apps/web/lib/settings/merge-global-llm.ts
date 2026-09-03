import type { Scenario } from "../../types/pipeline.types";
import { normalizeLlmModelName, OLLAMA_DEFAULT_MODEL_TAG } from "../llm/ollama-default-model";
import { isLlmPuppetModule } from "../pipeline/llm-orchestrator-modules";
import { getDefaultModuleConfig } from "../pipeline/module-default-config";
import type { GlobalSettings } from "./global-settings";

/**
 * Подставляет глобальные параметры LLM только в шаг LLM_PUPPET (подзадачи не хранят подключение).
 */
export function mergeGlobalLlmIntoScenario(scenario: Scenario, global: GlobalSettings | null): Scenario {
  if (!global) return scenario;
  const active = global.llmActiveSource === "cloud" ? "cloud" : "local";
  const g =
    active === "cloud"
      ? {
          baseUrl: global.llmCloud.baseUrl,
          apiKey: global.llmCloud.apiKey,
          model: global.llmCloud.model,
        }
      : global.llmLocal;

  return {
    ...scenario,
    steps: scenario.steps.map((st) => {
      if (!isLlmPuppetModule(st.moduleId)) return st;

      const defaults = getDefaultModuleConfig(st.moduleId);
      const cfg: Record<string, unknown> = { ...defaults, ...(st.config ?? {}) };

      const baseUrl = typeof cfg.llmBaseUrl === "string" ? cfg.llmBaseUrl.trim() : "";
      if (!baseUrl) {
        cfg.llmBaseUrl = g.baseUrl;
      }

      const apiKey = typeof cfg.llmApiKey === "string" ? cfg.llmApiKey.trim() : "";
      if (!apiKey && g.apiKey.trim().length > 0) {
        cfg.llmApiKey = g.apiKey;
      }

      const defaultModel = normalizeLlmModelName(
        typeof defaults.llmModel === "string" && defaults.llmModel.length > 0 ? defaults.llmModel : OLLAMA_DEFAULT_MODEL_TAG,
      );
      const curModel = normalizeLlmModelName(typeof cfg.llmModel === "string" ? cfg.llmModel.trim() : "");
      const globalModel = normalizeLlmModelName(g.model.trim());
      if (!curModel || curModel === defaultModel) {
        cfg.llmModel = globalModel;
      } else {
        cfg.llmModel = curModel;
      }

      return { ...st, config: cfg };
    }),
  };
}
