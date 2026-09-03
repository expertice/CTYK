import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import { runLocalAudioPrepare } from "../../local-models/model-manager";

export class AudioPrepareModule implements IProcessingModule {
  id = "AUDIO_PREPARE" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
  }): Promise<Partial<ArtifactStore>> {
    const source = input.artifacts.AUDIO;
    const prepared = await runLocalAudioPrepare(source?.url, {
      targetSampleRate: readConfigNumber(input.config, "targetSampleRate") ?? 16000,
      targetChannels: readConfigNumber(input.config, "targetChannels") ?? 1,
      chunkSec: readConfigNumber(input.config, "chunkSec") ?? 120,
      overlapSec: readConfigNumber(input.config, "overlapSec") ?? 1,
    });

    return {
      AUDIO_PREPARED: {
        type: "AUDIO_PREPARED",
        status: "ready",
        version: "v1",
        producer: {
          moduleId: this.id,
          stepId: input.stepId,
          runId: input.runId,
        },
        quality: {
          confidence: 0.94,
          coverage: prepared.durationSec > 0 ? 1 : 0,
        },
        explainability: [
          {
            sourceArtifactType: "AUDIO",
            rationale: "Audio normalized for ASR/diarization and split into deterministic timeline chunks",
          },
        ],
        data: {
          sampleRate: prepared.sampleRate,
          channels: prepared.channels,
          durationSec: prepared.durationSec,
          chunks: prepared.chunks,
        },
        url: prepared.preparedUrl,
        createdAt: new Date().toISOString(),
      },
    };
  }
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
