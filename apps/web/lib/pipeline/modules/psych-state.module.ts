import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import type { DiarizationSegment } from "../../local-models/model-manager";
import { runProsodyEnrichment } from "../../local-models/model-manager";
import { runPsychMetricMatcher } from "../psych-metric-matcher";

export class PsychStateModule implements IProcessingModule {
  id = "PSYCH_STATE" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
  }): Promise<Partial<ArtifactStore>> {
    const inputPolicy = readProsodyInputPolicy(input.config);
    const sourcePick = pickProsodySegments(input.artifacts, inputPolicy);
    const segments = sourcePick.segments;
    const audioUrl = input.artifacts.AUDIO_PREPARED?.url ?? input.artifacts.AUDIO?.url;

    if (segments.length === 0) {
      if (inputPolicy.requireReadySpeakers) {
        throw new Error("PSYCH_STATE: отсутствует READY_SPEAKERS (каноничный вход prosody).");
      }
      throw new Error("PSYCH_STATE: нет подходящих спикер-сегментов (READY/DRAFT/SPEAKER_SEGMENTS).");
    }
    if (!audioUrl) {
      throw new Error("PSYCH_STATE: нет AUDIO_PREPARED/AUDIO — для librosa нужен файл записи.");
    }

    const enrichment = await runProsodyEnrichment(segments, audioUrl);
    const psychMatcher = runPsychMetricMatcher(enrichment.segments);
    const producer = {
      moduleId: this.id,
      stepId: input.stepId,
      runId: input.runId,
    };
    const now = new Date().toISOString();
    const enrichedPayload = {
      kind: "prosody_enriched_transcript" as const,
      sampleRate: enrichment.sampleRate,
      globalTempoBpm: enrichment.globalTempoBpm,
      segments: enrichment.segments,
    };

    return {
      PSYCH_LABELS: {
        type: "PSYCH_LABELS",
        status: "ready",
        version: "v1",
        producer,
        quality: {
          confidence: 0.75,
          warnings: [
            "assistive_non_diagnostic",
            "psych_matcher_v1",
            "lexicon_rules_engine",
          ],
        },
        explainability: [
          {
            sourceArtifactType: "ENRICHED_TRANSCRIPT",
            rationale:
              "Паттерны prosody по z-score от медианы/MAD по спикеру; правила из psychmetric_lexicon JSON.",
          },
        ],
        data: psychMatcher,
        createdAt: now,
      },
      ENRICHED_TRANSCRIPT: {
        type: "ENRICHED_TRANSCRIPT",
        status: "ready",
        version: "v1",
        producer,
        quality: {
          confidence: 0.72,
          warnings: [
            "assistive_non_diagnostic",
            "prosody_librosa",
            sourcePick.source !== "READY_SPEAKERS" ? `prosody_source_${sourcePick.source.toLowerCase()}` : "prosody_source_ready_speakers",
          ],
        },
        explainability: [
          {
            sourceArtifactType: sourcePick.source,
            rationale: `Просодические метки по таймкодам сегментов (librosa), источник: ${sourcePick.source}`,
          },
          {
            sourceArtifactType: "AUDIO",
            rationale: "Акустические признаки по вырезкам waveform",
          },
        ],
        data: enrichedPayload,
        createdAt: now,
      },
    };
  }
}

function extractDiarizationSegments(data: unknown): DiarizationSegment[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const out: DiarizationSegment[] = [];
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

type ProsodySourceArtifact = "READY_SPEAKERS" | "DRAFT_SPEAKERS" | "SPEAKER_SEGMENTS";
type FallbackSourcePolicy = "draft_only" | "draft_then_raw";
type ProsodyInputPolicy = {
  requireReadySpeakers: boolean;
  fallbackSource: FallbackSourcePolicy;
};

function readProsodyInputPolicy(config: Record<string, unknown>): ProsodyInputPolicy {
  const fallbackRaw = typeof config.fallbackSource === "string" ? config.fallbackSource : "draft_only";
  const fallbackSource: FallbackSourcePolicy =
    fallbackRaw === "draft_then_raw" ? "draft_then_raw" : "draft_only";
  return {
    requireReadySpeakers: config.requireReadySpeakers !== false,
    fallbackSource,
  };
}

function pickProsodySegments(
  artifacts: ArtifactStore,
  policy: ProsodyInputPolicy,
): { source: ProsodySourceArtifact; segments: DiarizationSegment[] } {
  const ready = extractDiarizationSegments(artifacts.READY_SPEAKERS?.data);
  if (ready.length > 0) return { source: "READY_SPEAKERS", segments: ready };
  if (policy.requireReadySpeakers) return { source: "READY_SPEAKERS", segments: [] };

  const draft = extractDiarizationSegments(artifacts.DRAFT_SPEAKERS?.data);
  if (draft.length > 0) return { source: "DRAFT_SPEAKERS", segments: draft };
  if (policy.fallbackSource === "draft_only") return { source: "DRAFT_SPEAKERS", segments: [] };

  const raw = extractDiarizationSegments(artifacts.SPEAKER_SEGMENTS?.data);
  if (raw.length > 0) return { source: "SPEAKER_SEGMENTS", segments: raw };
  return { source: "SPEAKER_SEGMENTS", segments: [] };
}
