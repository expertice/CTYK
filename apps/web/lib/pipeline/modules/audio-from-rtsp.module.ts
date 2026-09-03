import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import { runLocalRtspCapture } from "../../local-models/model-manager";

export class AudioFromRtspModule implements IProcessingModule {
  id = "AUDIO_FROM_RTSP" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
  }): Promise<Partial<ArtifactStore>> {
    const src = readSource(input.artifacts, "rtsp");
    const rtspUrl = readString(input.config, "rtspUrl") ?? readObjString(src, "rtspUrl");
    if (!rtspUrl) {
      throw new Error("AUDIO_FROM_RTSP: config.rtspUrl is required");
    }
    const durationSec = readNumber(input.config, "captureSec") ?? readObjNumber(src, "captureSec") ?? 60;
    const transportRaw = readString(input.config, "transport") ?? readObjString(src, "transport");
    const transport = transportRaw === "udp" ? "udp" : "tcp";
    const localUrl = await runLocalRtspCapture(rtspUrl, {
      captureSec: durationSec,
      transport,
    });
    return {
      AUDIO: {
        type: "AUDIO",
        status: "ready",
        version: "v1",
        producer: { moduleId: this.id, stepId: input.stepId, runId: input.runId },
        quality: {},
        data: { sourceType: "rtsp", rtspUrl, captureSec: durationSec, transport },
        url: localUrl,
        createdAt: new Date().toISOString(),
      },
    };
  }
}

function readString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
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

function readObjNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
