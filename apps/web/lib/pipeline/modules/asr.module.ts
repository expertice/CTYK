import type { ArtifactStore } from "../../../types/artifact.types";
import type { Scenario } from "../../../types/pipeline.types";
import type { IProcessingModule } from "../orchestrator";
import { runLocalAsr } from "../../local-models/model-manager";
import { gatherInboundArtifactsForStep } from "../step-inbound-artifacts";

export class AsrModule implements IProcessingModule {
  id = "ASR" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
    scenario?: Scenario;
  }): Promise<Partial<ArtifactStore>> {
    const producer = { moduleId: this.id, stepId: input.stepId, runId: input.runId };
    const now = new Date().toISOString();

    if (input.scenario) {
      const sub = gatherInboundArtifactsForStep(input.artifacts, input.scenario, input.stepId);
      const hasAudio = Boolean(sub.AUDIO_PREPARED?.url ?? sub.AUDIO?.url);
      const trIn = sub.TRANSCRIPT_SEGMENTS;
      const textIn = sub.TEXT;

      if (!hasAudio && trIn?.status === "ready" && trIn.data != null) {
        const text = joinSegmentTexts(trIn.data);
        return {
          TEXT: {
            type: "TEXT",
            status: "ready",
            version: "v1",
            producer,
            quality: {},
            data: { text, segments: trIn.data },
            createdAt: now,
          },
        };
      }

      if (!hasAudio && textIn?.status === "ready" && textIn.data) {
        const td = textIn.data as { text?: string; segments?: unknown };
        const text = typeof td.text === "string" ? td.text : "";
        return {
          TEXT: {
            type: "TEXT",
            status: "ready",
            version: "v1",
            producer,
            quality: {},
            data: { text, segments: td.segments },
            createdAt: now,
          },
        };
      }
    }

    const sourceAudioUrl = input.artifacts.AUDIO_PREPARED?.url ?? input.artifacts.AUDIO?.url;
    const asr = await runLocalAsr(sourceAudioUrl, {
      modelName: readConfigString(input.config, "whisperModel"),
      device: readAsrDevice(input.config),
      computeType: readConfigString(input.config, "asrComputeType"),
    });

    return {
      TEXT: {
        type: "TEXT",
        status: "ready",
        version: "v1",
        producer,
        quality: {
          confidence: 0.86,
          coverage: 1,
        },
        explainability: [
          {
            sourceArtifactType: input.artifacts.AUDIO_PREPARED?.url ? "AUDIO_PREPARED" : "AUDIO",
            rationale: `Local ASR model (${asr.model}) was used`,
          },
        ],
        data: {
          text: asr.text,
          segments: asr.segments,
        },
        createdAt: now,
      },
    };
  }
}

function joinSegmentTexts(data: unknown): string {
  if (!Array.isArray(data)) return "";
  const parts: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const t = (item as { text?: unknown }).text;
    if (typeof t === "string" && t.trim()) parts.push(t.trim());
  }
  return parts.join("\n");
}

function readConfigString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readAsrDevice(config: Record<string, unknown>): "auto" | "cpu" | "cuda" | "gpu_strict" | undefined {
  const value = config.asrDevice;
  if (value === "auto" || value === "cpu" || value === "cuda" || value === "gpu_strict") {
    return value;
  }
  return undefined;
}
