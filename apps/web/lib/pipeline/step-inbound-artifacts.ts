import type { ArtifactStore, ArtifactTypeId } from "../../types/artifact.types";
import type { Scenario } from "../../types/pipeline.types";

/**
 * Артефакты, пришедшие на шаг по входящим рёбрам: только если `producer.stepId` совпадает с `fromStepId` ребра
 * (иначе в общем сторе может лежать одноимённый тип от другого шага).
 */
export function gatherInboundArtifactsForStep(
  full: ArtifactStore,
  scenario: Scenario,
  stepId: string,
  opts?: { excludeEdgeTypes?: ArtifactTypeId[] },
): ArtifactStore {
  const incoming = scenario.edges.filter((e) => e.toStepId === stepId);
  const exclude = new Set(opts?.excludeEdgeTypes ?? []);
  const out: ArtifactStore = {};
  for (const e of incoming) {
    if (exclude.has(e.artifactTypeId)) continue;
    const env = full[e.artifactTypeId];
    if (!env || env.status !== "ready") continue;
    if (env.producer?.stepId !== e.fromStepId) continue;
    out[e.artifactTypeId] = env;
  }
  return out;
}

/** ASR: достаточно одного из входов — аудио (prepared/raw) или уже готовый текст/сегменты. */
export function incomingSatisfiesAsrRequire(reachable: Set<ArtifactTypeId>): boolean {
  return (
    reachable.has("AUDIO_PREPARED") ||
    reachable.has("AUDIO") ||
    reachable.has("TEXT") ||
    reachable.has("TRANSCRIPT_SEGMENTS")
  );
}

/** SPEAKER_TURN_MERGE: достаточно одного из сегментных входов с диаризации. */
export function incomingSatisfiesSpeakerTurnMergeRequire(reachable: Set<ArtifactTypeId>): boolean {
  return reachable.has("SPEAKER_SEGMENTS") || reachable.has("TRANSCRIPT_SEGMENTS");
}

export function incomingSatisfiesSpeakerDraftEditRequire(reachable: Set<ArtifactTypeId>): boolean {
  return reachable.has("DRAFT_SPEAKERS");
}
