import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import { runLocalDiarization } from "../../local-models/model-manager";

export class DiarizationModule implements IProcessingModule {
  id = "DIARIZATION" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
  }): Promise<Partial<ArtifactStore>> {
    const textData = input.artifacts.TEXT?.data;
    const transcriptSegments = extractAsrSegments(textData);
    const diarization = await runLocalDiarization(transcriptSegments, {
      modelName: readConfigString(input.config, "diarizationModel"),
      localModelPath: readConfigString(input.config, "localPyannoteModelPath"),
      mode: readDiarizationMode(input.config),
      mergeGapSec: readConfigNumber(input.config, "diarizationMergeGapSec"),
      minTurnSec: readConfigNumber(input.config, "diarizationMinTurnSec"),
      deviceMode: readDiarizationDeviceMode(input.config),
      audioUrl: input.artifacts.AUDIO_PREPARED?.url ?? input.artifacts.AUDIO?.url,
    });
    const diarized = diarization.segments;
    const producer = {
      moduleId: this.id,
      stepId: input.stepId,
      runId: input.runId,
    };
    const now = new Date().toISOString();
    return {
      SPEAKER_SEGMENTS: {
        type: "SPEAKER_SEGMENTS",
        status: "ready",
        version: "v1",
        producer,
        quality: {
          confidence: diarized.length > 0 ? 0.82 : 0.65,
        },
        explainability: [
          {
            sourceArtifactType: "TEXT",
            rationale: `Local diarization provider (${diarization.provider}) with model ${diarization.model}`,
          },
        ],
        data: diarized,
        createdAt: now,
      },
      TRANSCRIPT_SEGMENTS: {
        type: "TRANSCRIPT_SEGMENTS",
        status: "ready",
        version: "v1",
        producer,
        quality: {
          confidence: diarized.length > 0 ? 0.82 : 0.65,
        },
        explainability: [
          {
            sourceArtifactType: "TEXT",
            rationale: `Canonical transcript segments from diarization (${diarization.provider})`,
          },
        ],
        data: diarized,
        createdAt: now,
      },
    };
  }
}

function readConfigString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readConfigNumber(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readDiarizationMode(
  config: Record<string, unknown>,
): "local_pyannote" | "hf_pyannote" | "heuristic" | undefined {
  const value = config.diarizationMode;
  if (value === "local_pyannote" || value === "hf_pyannote" || value === "heuristic") {
    return value;
  }
  return undefined;
}

function readDiarizationDeviceMode(config: Record<string, unknown>): "auto" | "cpu" | "gpu_strict" | undefined {
  const value = config.diarizationDeviceMode;
  if (value === "auto" || value === "cpu" || value === "gpu_strict") {
    return value;
  }
  return undefined;
}

function extractAsrSegments(data: unknown): Array<{ startTime: number; endTime: number; text: string }> {
  if (!data || typeof data !== "object") {
    return [];
  }
  const maybeSegments = (data as { segments?: unknown }).segments;
  if (!Array.isArray(maybeSegments)) {
    return [];
  }

  return maybeSegments
    .map((segment) => {
      if (!segment || typeof segment !== "object") {
        return null;
      }
      const value = segment as Record<string, unknown>;
      if (
        typeof value.startTime !== "number" ||
        typeof value.endTime !== "number" ||
        typeof value.text !== "string"
      ) {
        return null;
      }
      return {
        startTime: value.startTime,
        endTime: value.endTime,
        text: value.text,
      };
    })
    .filter((segment): segment is { startTime: number; endTime: number; text: string } => Boolean(segment));
}
