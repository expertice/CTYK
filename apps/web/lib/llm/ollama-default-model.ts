/**
 * Дефолтная модель для локального Ollama: тег из каталога (`ollama pull qwen2.5:3b`),
 * не маркетинговое имя вроде Qwen3.5-2B — такой строки в Ollama нет.
 */
export const OLLAMA_DEFAULT_MODEL_TAG = "qwen2.5:3b";

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "Qwen3.5-2B": OLLAMA_DEFAULT_MODEL_TAG,
};

export function normalizeLlmModelName(model: string): string {
  const t = model.trim();
  if (!t) return t;
  return LEGACY_MODEL_ALIASES[t] ?? t;
}
