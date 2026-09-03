import { NextResponse } from "next/server";
import { ollamaDaemonRootFromOpenAiBase, validateLlmBaseUrl } from "../../../../lib/llm/llm-proxy-url";

interface Body {
  baseUrl?: string;
}

const TIMEOUT_MS = 12_000;

export async function POST(request: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const baseCheck = typeof body.baseUrl === "string" ? validateLlmBaseUrl(body.baseUrl.trim()) : null;
  if (!baseCheck || !baseCheck.ok) {
    return NextResponse.json({ error: baseCheck?.reason ?? "Укажите baseUrl" }, { status: 400 });
  }

  const root = ollamaDaemonRootFromOpenAiBase(baseCheck.normalized);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const versionUrl = `${root}/api/version`;
    const tagsUrl = `${root}/api/tags`;

    const [versionRes, tagsRes] = await Promise.all([
      fetch(versionUrl, { method: "GET", signal: controller.signal, cache: "no-store" }),
      fetch(tagsUrl, { method: "GET", signal: controller.signal, cache: "no-store" }),
    ]);

    if (!tagsRes.ok) {
      const snippet = (await tagsRes.text()).slice(0, 400);
      return NextResponse.json(
        {
          ok: false as const,
          ollamaReachable: false,
          error: `Ollama /api/tags: HTTP ${tagsRes.status}${snippet ? ` — ${snippet}` : ""}`,
        },
        { status: 200 },
      );
    }

    let tagsJson: unknown;
    try {
      tagsJson = await tagsRes.json();
    } catch {
      return NextResponse.json(
        { ok: false as const, ollamaReachable: false, error: "Ответ /api/tags не JSON" },
        { status: 200 },
      );
    }

    const modelsRaw = (tagsJson as { models?: unknown }).models;
    const names: string[] = [];
    if (Array.isArray(modelsRaw)) {
      for (const m of modelsRaw) {
        if (!m || typeof m !== "object") continue;
        const o = m as { name?: unknown; model?: unknown };
        const raw =
          typeof o.name === "string" && o.name.trim()
            ? o.name.trim()
            : typeof o.model === "string" && o.model.trim()
              ? o.model.trim()
              : "";
        if (raw) names.push(raw);
      }
    }
    const unique = [...new Set(names)];
    unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    let version: string | undefined;
    if (versionRes.ok) {
      try {
        const v = (await versionRes.json()) as { version?: unknown };
        if (typeof v.version === "string" && v.version.trim()) {
          version = v.version.trim();
        }
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      ok: true as const,
      ollamaReachable: true,
      root,
      version,
      models: unique,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return NextResponse.json(
        { ok: false as const, ollamaReachable: false, error: "Таймаут ожидания Ollama" },
        { status: 200 },
      );
    }
    const msg = e instanceof Error ? e.message : "Ошибка сети";
    return NextResponse.json({ ok: false as const, ollamaReachable: false, error: msg }, { status: 200 });
  } finally {
    clearTimeout(timer);
  }
}
