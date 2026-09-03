import type { ArtifactEnvelope, ArtifactStore, ArtifactTypeId } from "../../types/artifact.types";
import { mergeLlmInstructionsData } from "./llm-instructions-artifact";

/**
 * Вливает результат шага в общий стор: для LLM_INSTRUCTIONS объединяет фрагменты по stepId
 * (несколько модулей могут добавлять фрагменты к одному пакету LLM_INSTRUCTIONS).
 */
export function mergePartialArtifactStore(base: ArtifactStore, patch: Partial<ArtifactStore>): void {
  for (const key of Object.keys(patch) as ArtifactTypeId[]) {
    const env = patch[key];
    if (!env) continue;

    if (key === "LLM_INSTRUCTIONS" && env.status === "ready" && env.type === "LLM_INSTRUCTIONS") {
      const mergedData = mergeLlmInstructionsData(base.LLM_INSTRUCTIONS?.data, env.data);
      const next: ArtifactEnvelope = {
        ...env,
        data: mergedData,
      };
      base.LLM_INSTRUCTIONS = next;
      continue;
    }

    base[key] = env as ArtifactEnvelope;
  }
}
