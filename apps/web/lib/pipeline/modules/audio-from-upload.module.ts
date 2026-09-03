import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";

export class AudioFromUploadModule implements IProcessingModule {
  id = "AUDIO_FROM_UPLOAD" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
  }): Promise<Partial<ArtifactStore>> {
    const src = readSource(input.artifacts, "upload");
    const configUrl = typeof input.config.localUrl === "string" ? input.config.localUrl : "";
    const sourceUrl = typeof src.localUrl === "string" ? src.localUrl : "";
    const seedUrl = input.artifacts.AUDIO?.url ?? "";
    const url = configUrl || sourceUrl || seedUrl;
    if (!url) {
      throw new Error("AUDIO_FROM_UPLOAD: localUrl is required (or pre-seeded AUDIO.url)");
    }
    return {
      AUDIO: {
        type: "AUDIO",
        status: "ready",
        version: "v1",
        producer: { moduleId: this.id, stepId: input.stepId, runId: input.runId },
        quality: {},
        data: { sourceType: "upload" },
        url,
        createdAt: new Date().toISOString(),
      },
    };
  }
}

function readSource(artifacts: ArtifactStore, expectedKind: string): Record<string, unknown> {
  const raw = artifacts.AUDIO_SOURCE?.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === "string" ? obj.kind : "";
  return kind === expectedKind ? obj : {};
}
