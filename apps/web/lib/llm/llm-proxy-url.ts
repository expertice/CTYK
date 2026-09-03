/**
 * Валидация base URL для прокси-запросов к LLM (только http/https).
 */

export function validateLlmBaseUrl(raw: string): { ok: true; normalized: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "Некорректный URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Разрешены только http и https" };
  }
  return { ok: true, normalized: u.toString().replace(/\/+$/, "") };
}

/**
 * Корень демона Ollama из OpenAI-совместимого base (…/v1 → без /v1).
 */
export function ollamaDaemonRootFromOpenAiBase(normalizedOpenAiBase: string): string {
  const trimmed = normalizedOpenAiBase.replace(/\/+$/, "");
  if (/\/v1$/i.test(trimmed)) {
    return trimmed.slice(0, -3).replace(/\/+$/, "");
  }
  return trimmed;
}
