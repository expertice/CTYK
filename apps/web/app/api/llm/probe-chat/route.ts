import { NextResponse } from "next/server";
import { validateLlmBaseUrl } from "../../../../lib/llm/llm-proxy-url";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ProbeBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  messages?: ChatMessage[];
}

const MAX_MESSAGES = 24;
const TIMEOUT_MS = 120_000;

function shouldDisableThinking(baseUrl: string): boolean {
  const u = baseUrl.toLowerCase();
  return u.includes("dashscope") || u.includes("qwen");
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: ProbeBody;
  try {
    body = (await request.json()) as ProbeBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const baseCheck = typeof body.baseUrl === "string" ? validateLlmBaseUrl(body.baseUrl.trim()) : null;
  if (!baseCheck || !baseCheck.ok) {
    return NextResponse.json({ error: baseCheck?.reason ?? "Укажите baseUrl" }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return NextResponse.json({ error: "Укажите модель" }, { status: 400 });
  }

  const messagesRaw = Array.isArray(body.messages) ? body.messages : [];
  const messages: Array<{ role: string; content: string }> = [];
  for (const m of messagesRaw.slice(-MAX_MESSAGES)) {
    if (!m || typeof m !== "object") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim()) continue;
    messages.push({ role: m.role, content });
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "Нет сообщений для отправки" }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const url = `${baseCheck.normalized}/chat/completions`;
  const disableThinking = shouldDisableThinking(baseCheck.normalized);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey.length > 0) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        ...(disableThinking ? { enable_thinking: false } : {}),
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `HTTP ${res.status}: ${text.slice(0, 800)}` },
        { status: 502 },
      );
    }

    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    } catch {
      return NextResponse.json({ error: "Ответ сервера не JSON" }, { status: 502 });
    }

    const reply = data.choices?.[0]?.message?.content ?? "";
    if (typeof reply !== "string") {
      return NextResponse.json({ error: "Пустой ответ модели" }, { status: 502 });
    }

    return NextResponse.json({ reply });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return NextResponse.json({ error: "Превышено время ожидания ответа LLM" }, { status: 504 });
    }
    const msg = e instanceof Error ? e.message : "Ошибка сети";
    return NextResponse.json({ error: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
