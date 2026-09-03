import type { ArtifactEnvelope, ArtifactStore } from "../../../types/artifact.types";
import type { Scenario } from "../../../types/pipeline.types";
import type { IProcessingModule } from "../orchestrator";
import { gatherInboundArtifactsForStep } from "../step-inbound-artifacts";

type DiarSeg = { speakerId: string; startTime: number; endTime: number; text: string };

export class SpeakerTurnMergeModule implements IProcessingModule {
  id = "SPEAKER_TURN_MERGE" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
    scenario?: Scenario;
  }): Promise<Partial<ArtifactStore>> {
    if (!input.scenario) {
      throw new Error("SPEAKER_TURN_MERGE: нет scenario для сбора входящих артефактов по рёбрам.");
    }
    const sub = gatherInboundArtifactsForStep(input.artifacts, input.scenario, input.stepId);
    const sourceEnv: ArtifactEnvelope | undefined = sub.SPEAKER_SEGMENTS ?? sub.TRANSCRIPT_SEGMENTS;
    if (!sourceEnv || sourceEnv.status !== "ready") {
      throw new Error(
        "SPEAKER_TURN_MERGE: по входящим рёбрам нужны готовые SPEAKER_SEGMENTS или TRANSCRIPT_SEGMENTS (после диаризации).",
      );
    }
    const merged = mergeConsecutiveSpeakerTurns(parseSegmentArray(sourceEnv.data));

    const producer = { moduleId: this.id, stepId: input.stepId, runId: input.runId };
    const now = new Date().toISOString();
    const explainSource =
      sourceEnv.type === "SPEAKER_SEGMENTS" ? ("SPEAKER_SEGMENTS" as const) : ("TRANSCRIPT_SEGMENTS" as const);

    const baseExplain = [
      {
        sourceArtifactType: explainSource,
        rationale: "Слияние соседних сегментов одного спикера в одну реплику по таймлайну.",
      },
    ];

    return {
      READY_SPEAKERS: {
        type: "READY_SPEAKERS",
        status: "ready",
        version: "v1",
        producer,
        quality: { confidence: merged.length > 0 ? 0.9 : 0.5 },
        explainability: baseExplain,
        data: merged,
        createdAt: now,
      },
      DRAFT_SPEAKERS: {
        type: "DRAFT_SPEAKERS",
        status: "ready",
        version: "v1",
        producer,
        quality: { confidence: merged.length > 0 ? 0.9 : 0.5 },
        explainability: baseExplain,
        data: merged,
        createdAt: now,
      },
    };
  }
}

function parseSegmentArray(data: unknown): DiarSeg[] {
  if (!Array.isArray(data)) return [];
  const out: DiarSeg[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const start = typeof s.startTime === "number" ? s.startTime : Number(s.startTime);
    const end = typeof s.endTime === "number" ? s.endTime : Number(s.endTime);
    const text = typeof s.text === "string" ? s.text : "";
    const speakerId = typeof s.speakerId === "string" ? s.speakerId : "speaker_unknown";
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({ speakerId, startTime: start, endTime: end, text });
  }
  return out;
}

function mergeConsecutiveSpeakerTurns(segments: DiarSeg[]): DiarSeg[] {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const out: DiarSeg[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.speakerId === s.speakerId) {
      const parts = [last.text, s.text].map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean);
      last.text = parts.join(" ");
      last.endTime = s.endTime;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}
