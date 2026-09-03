import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import { getWebAppRoot } from "../../local-models/web-root";

export class AudioFromApiModule implements IProcessingModule {
  id = "AUDIO_FROM_API" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
  }): Promise<Partial<ArtifactStore>> {
    const src = readSource(input.artifacts, "api");
    const endpoint = readString(input.config, "endpoint") ?? readObjString(src, "endpoint");
    if (!endpoint) {
      throw new Error("AUDIO_FROM_API: config.endpoint is required");
    }
    const method = (readString(input.config, "method") ?? readObjString(src, "method") ?? "GET").toUpperCase();
    const bodyText = readString(input.config, "body") ?? readObjString(src, "body");
    const headers = parseHeaders(input.config.headers) ?? parseHeaders(src.headers);
    const response = await fetch(endpoint, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : bodyText,
    });
    if (!response.ok) {
      throw new Error(`AUDIO_FROM_API: HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const uploadsDir = path.join(getWebAppRoot(), "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const ext = extensionFromContentType(response.headers.get("content-type"));
    const fileName = `${Date.now()}_api_audio${ext}`;
    const targetPath = path.join(uploadsDir, fileName);
    await writeFile(targetPath, bytes);
    return {
      AUDIO: {
        type: "AUDIO",
        status: "ready",
        version: "v1",
        producer: { moduleId: this.id, stepId: input.stepId, runId: input.runId },
        quality: {},
        data: { sourceType: "api", endpoint, method },
        url: `local://uploads/${fileName}`,
        createdAt: new Date().toISOString(),
      },
    };
  }
}

function readString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function extensionFromContentType(contentType: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("wav")) return ".wav";
  if (ct.includes("mpeg")) return ".mp3";
  if (ct.includes("ogg")) return ".ogg";
  if (ct.includes("flac")) return ".flac";
  if (ct.includes("mp4")) return ".m4a";
  return ".wav";
}

function readSource(artifacts: ArtifactStore, expectedKind: string): Record<string, unknown> {
  const raw = artifacts.AUDIO_SOURCE?.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === "string" ? obj.kind : "";
  return kind === expectedKind ? obj : {};
}

function readObjString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
