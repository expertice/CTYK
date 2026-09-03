import type { ArtifactEnvelope, ArtifactStore, ArtifactTypeId } from "../../types/artifact.types";
import type {
  SessionReport,
  ArtifactSection,
  ReportDialogueLegend,
  ReportDialogueRow,
  ReportSpeakerPatternCard,
  ReportTimelineMoment,
  ReportSegmentComment,
  ReportSummarySectionBlock,
  ReportSummarySectionItem,
  ReportCombinationEvidence,
  EvidenceRef,
  PsychStateLabel,
  SpeakerSegment,
  ChecklistItem,
  SegmentProsodyMetrics,
} from "../../types/report.types";
import type { ModuleId } from "../../types/pipeline.types";
import type { PipelineRunResult } from "../pipeline/orchestrator";
import type { PsychMatcherV1Payload } from "../pipeline/psych-metric-matcher";
import { REPORT_OUTPUT_ACCEPTED_INPUTS } from "../pipeline/report-output-inputs";
import { substituteSpeakerRefsInPsychText } from "./substitute-speaker-refs-in-psych-text";

export type ReportSectionKey = "summary" | "transcript" | "psych" | "checklist";

export interface ReportSectionsConfig {
  summary: boolean;
  transcript: boolean;
  psych: boolean;
  checklist: boolean;
}

export const DEFAULT_REPORT_SECTIONS: ReportSectionsConfig = {
  summary: true,
  transcript: true,
  psych: true,
  checklist: true,
};

/** Default when adding REPORT_OUTPUT from the graph palette without a full upstream stack. */
export const TRANSCRIPT_ONLY_REPORT_SECTIONS: ReportSectionsConfig = {
  summary: false,
  transcript: true,
  psych: false,
  checklist: false,
};

export function parseReportOutputConfig(config: Record<string, unknown>): {
  sections: ReportSectionsConfig;
  strict: boolean;
  renderInputs: Partial<Record<ArtifactTypeId, boolean>>;
} {
  const strict = Boolean(config.strict);
  const renderInputs = normalizeRenderInputs(config.renderInputs);
  const raw = config.sections;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      strict,
      renderInputs,
      sections: {
        summary: o.summary !== false,
        transcript: o.transcript !== false,
        psych: o.psych !== false,
        checklist: o.checklist !== false,
      },
    };
  }
  return { strict, renderInputs, sections: { ...DEFAULT_REPORT_SECTIONS } };
}

function normalizeRenderInputs(raw: unknown): Partial<Record<ArtifactTypeId, boolean>> {
  const out: Partial<Record<ArtifactTypeId, boolean>> = {};
  for (const t of REPORT_OUTPUT_ACCEPTED_INPUTS) out[t] = true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const t of REPORT_OUTPUT_ACCEPTED_INPUTS) {
    const v = o[t];
    if (typeof v === "boolean") out[t] = v;
  }
  return out;
}

function isReady(artifact: ArtifactEnvelope | undefined): boolean {
  return artifact?.status === "ready";
}

export function createEvidenceFromRun(run: PipelineRunResult): EvidenceRef {
  const step = run.steps.find((item) => item.status === "succeeded") ?? run.steps[0];
  return {
    evidenceId: "evidence_base",
    sourceArtifactType: "TEXT",
    sourceStepId: step?.stepId ?? "unknown_step",
    sourceModuleId: step?.moduleId ?? "ASR",
  };
}

export function createEvidenceFromArtifacts(artifacts: ArtifactStore): EvidenceRef {
  const order: Array<keyof ArtifactStore> = [
    "SUMMARY_TEXT",
    "SPEAKER_IDENTITY_MAP",
    "TEXT",
    "READY_SPEAKERS",
    "DRAFT_SPEAKERS",
    "SPEAKER_SEGMENTS",
    "TRANSCRIPT_SEGMENTS",
    "ENRICHED_TRANSCRIPT",
    "LLM_PSYCH_NARRATIVE",
    "PSYCH_NARRATIVE",
    "CHECKLIST_RESULTS",
  ];
  for (const t of order) {
    const a = artifacts[t];
    if (a?.status === "ready" && a.producer) {
      return {
        evidenceId: "evidence_base",
        sourceArtifactType: t,
        sourceStepId: a.producer.stepId,
        sourceModuleId: a.producer.moduleId as ModuleId,
      };
    }
  }
  return {
    evidenceId: "evidence_base",
    sourceArtifactType: "TEXT",
    sourceStepId: "unknown_step",
    sourceModuleId: "ASR",
  };
}

export function assembleSessionReport(input: {
  sessionId: string;
  artifacts: ArtifactStore;
  sections?: Partial<ReportSectionsConfig>;
  strict?: boolean;
  renderInputs?: Partial<Record<ArtifactTypeId, boolean>>;
  evidenceBase?: EvidenceRef;
}): SessionReport {
  const sections: ReportSectionsConfig = { ...DEFAULT_REPORT_SECTIONS, ...input.sections };
  const strict = input.strict ?? false;
  const evidenceBase = input.evidenceBase ?? createEvidenceFromArtifacts(input.artifacts);
  const renderInputs = normalizeRenderInputs(input.renderInputs);

  if (strict) {
    if (sections.summary && !isReady(input.artifacts.SUMMARY_TEXT) && !isReady(input.artifacts.LLM_SUMMARY)) {
      throw new Error("Report strict mode: summary section needs SUMMARY_TEXT or LLM_SUMMARY ready");
    }
    if (
      sections.transcript &&
      !isReady(input.artifacts.TRANSCRIPT_SEGMENTS) &&
      !isReady(input.artifacts.SPEAKER_SEGMENTS) &&
      !isReady(input.artifacts.READY_SPEAKERS) &&
      !isReady(input.artifacts.DRAFT_SPEAKERS) &&
      !isReady(input.artifacts.ENRICHED_TRANSCRIPT)
    ) {
      throw new Error(
        "Report strict mode: для транскрипта нужен TRANSCRIPT_SEGMENTS, READY_SPEAKERS/DRAFT_SPEAKERS, SPEAKER_SEGMENTS или ENRICHED_TRANSCRIPT",
      );
    }
    if (
      sections.psych &&
      !isReady(input.artifacts.PSYCH_NARRATIVE) &&
      !isReady(input.artifacts.PSYCH_LABELS) &&
      !isReady(input.artifacts.LLM_PSYCH_NARRATIVE) &&
      !isReady(input.artifacts.LLM_PSYCH_LABELS) &&
      !isReady(input.artifacts.LLM_PSYCH_FULL_V1)
    ) {
      throw new Error(
        "Report strict mode: нужен хотя бы один из PSYCH_* или LLM_PSYCH_* (labels/narrative), все отсутствуют или не ready",
      );
    }
    if (sections.checklist && !isReady(input.artifacts.CHECKLIST_RESULTS)) {
      throw new Error("Report strict mode: CHECKLIST_RESULTS is required but missing or not ready");
    }
  }

  const checklistResults = sections.checklist
    ? toChecklistItems(input.artifacts.CHECKLIST_RESULTS, evidenceBase)
    : [];

  const transcript = sections.transcript
    ? applySpeakerIdentityToTranscript(buildTranscript(input.artifacts, evidenceBase), input.artifacts.SPEAKER_IDENTITY_MAP)
    : [];

  const psychLabelsArtifact =
    input.artifacts.LLM_PSYCH_LABELS?.status === "ready"
      ? input.artifacts.LLM_PSYCH_LABELS
      : input.artifacts.PSYCH_LABELS;

  const psychLabels = sections.psych ? toPsychLabels(psychLabelsArtifact, evidenceBase) : [];

  const psychNarrativeText = sections.psych
    ? readString(input.artifacts.LLM_PSYCH_NARRATIVE, "text") || readString(input.artifacts.PSYCH_NARRATIVE, "text")
    : null;

  /** Только SUMMARY_TEXT — без подстановки TEXT, иначе в «суммаризацию» попадал бы сырой транскрипт без отдельного резюме. */
  const summaryText = sections.summary
    ? readString(input.artifacts.SUMMARY_TEXT, "text") ?? readSummaryTextFromLlmSummary(input.artifacts.LLM_SUMMARY)
    : null;

  return {
    sessionId: input.sessionId,
    generatedAt: new Date().toISOString(),
    interpretationPolicy: "assistive_non_diagnostic",
    checklistResults,
    transcript,
    psychStateSummary: {
      labels: psychLabels,
      narrative: {
        text: sections.psych
          ? (psychNarrativeText ?? "Psych narrative is not available yet")
          : "—",
        evidence: [evidenceBase],
      },
    },
    summary: {
      text: sections.summary ? (summaryText ?? "Summary is not available yet") : "—",
      evidence: [evidenceBase],
    },
    artifactSections: buildArtifactSections(input.artifacts, renderInputs, evidenceBase),
  };
}

function buildArtifactSections(
  artifacts: ArtifactStore,
  renderInputs: Partial<Record<ArtifactTypeId, boolean>>,
  evidenceBase: EvidenceRef,
): NonNullable<SessionReport["artifactSections"]> {
  const sections: ArtifactSection[] = [];
  for (const t of REPORT_OUTPUT_ACCEPTED_INPUTS) {
    if (renderInputs[t] === false) continue;
    const env = artifacts[t];
    if (env?.status !== "ready") continue;
    const typed = buildTypedArtifactSection(t, env, artifacts, evidenceBase);
    if (typed) {
      sections.push(typed);
      continue;
    }
    const base: ArtifactSection = {
      artifactType: t,
      sourceModuleId: env.producer?.moduleId ?? "unknown",
      title: `${t} (${env.producer?.moduleId ?? "unknown"})`,
      text: artifactNarrativeText(t, env),
      evidence: [{ ...evidenceBase, sourceArtifactType: t }],
      rawJson: safeJson(env.data),
    };
    sections.push(base);
  }
  return sections;
}

function buildTypedArtifactSection(
  t: ArtifactTypeId,
  env: ArtifactEnvelope,
  artifacts: ArtifactStore,
  evidenceBase: EvidenceRef,
): ArtifactSection | null {
  if (t === "READY_SPEAKERS") {
    const dialogue = enrichDialogueRowsWithMatchSignals(
      toDialogueRowsFromReady(env.data, artifacts.SPEAKER_IDENTITY_MAP),
      artifacts,
    );
    if (dialogue.length === 0) return null;
    return {
      artifactType: "READY_SPEAKERS",
      sourceModuleId: env.producer?.moduleId ?? "unknown",
      title: `${t} (${env.producer?.moduleId ?? "unknown"})`,
      text: artifactNarrativeText(t, env),
      evidence: [{ ...evidenceBase, sourceArtifactType: t }],
      rawJson: safeJson(env.data),
      readable: {
        kind: "dialogue",
        legend: buildDialogueLegend(dialogue),
        dialogue,
      },
    };
  }
  if (t === "ENRICHED_TRANSCRIPT") {
    const dialogue = enrichDialogueRowsWithMatchSignals(
      toDialogueRowsFromEnriched(env.data, artifacts.SPEAKER_IDENTITY_MAP),
      artifacts,
    );
    if (dialogue.length === 0) return null;
    return {
      artifactType: "ENRICHED_TRANSCRIPT",
      sourceModuleId: env.producer?.moduleId ?? "unknown",
      title: `${t} (${env.producer?.moduleId ?? "unknown"})`,
      text: artifactNarrativeText(t, env),
      evidence: [{ ...evidenceBase, sourceArtifactType: t }],
      rawJson: safeJson(env.data),
      readable: {
        kind: "dialogue_with_prosody",
        legend: buildDialogueLegend(dialogue),
        dialogue,
      },
    };
  }
  if (t === "LLM_PSYCH_NARRATIVE") {
    const readable = toPsychNarrativeReadable(env.data);
    if (!readable) return null;
    return {
      artifactType: "LLM_PSYCH_NARRATIVE",
      sourceModuleId: env.producer?.moduleId ?? "unknown",
      title: `${t} (${env.producer?.moduleId ?? "unknown"})`,
      text: artifactNarrativeText(t, env),
      evidence: [{ ...evidenceBase, sourceArtifactType: t }],
      rawJson: safeJson(env.data),
      readable,
    };
  }
  if (t === "LLM_PSYCH_LABELS") {
    const speakerPatterns = toPsychLabelCards(env.data, artifacts.SPEAKER_IDENTITY_MAP);
    if (speakerPatterns.length === 0) return null;
    return {
      artifactType: "LLM_PSYCH_LABELS",
      sourceModuleId: env.producer?.moduleId ?? "unknown",
      title: `${t} (${env.producer?.moduleId ?? "unknown"})`,
      text: artifactNarrativeText(t, env),
      evidence: [{ ...evidenceBase, sourceArtifactType: t }],
      rawJson: safeJson(env.data),
      readable: {
        kind: "psych_labels",
        speakerPatterns,
      },
    };
  }
  if (t === "LLM_SUMMARY") {
    const readable = toLlmSummaryReadable(env.data);
    if (!readable) return null;
    return {
      artifactType: "LLM_SUMMARY",
      sourceModuleId: env.producer?.moduleId ?? "unknown",
      title: `${t} (${env.producer?.moduleId ?? "unknown"})`,
      text: artifactNarrativeText(t, env),
      evidence: [{ ...evidenceBase, sourceArtifactType: t }],
      rawJson: safeJson(env.data),
      readable,
    };
  }
  if (t === "LLM_PSYCH_FULL_V1") {
    const readable = toPsychFullReadable(env.data);
    if (!readable) return null;
    return {
      artifactType: "LLM_PSYCH_FULL_V1",
      sourceModuleId: env.producer?.moduleId ?? "unknown",
      title: `${t} (${env.producer?.moduleId ?? "unknown"})`,
      text: artifactNarrativeText(t, env),
      evidence: [{ ...evidenceBase, sourceArtifactType: t }],
      rawJson: safeJson(env.data),
      readable,
    };
  }
  return null;
}

function enrichDialogueRowsWithMatchSignals(rows: ReportDialogueRow[], artifacts: ArtifactStore): ReportDialogueRow[] {
  if (rows.length === 0) return rows;
  const identityLookup = readSpeakerIdentityLookup(artifacts.SPEAKER_IDENTITY_MAP);
  const psychFullEpisodes = readPsychFullEpisodes(artifacts.LLM_PSYCH_FULL_V1);
  const psychFullParticipants = readPsychFullParticipants(artifacts.LLM_PSYCH_FULL_V1);
  const psychFullPhases = readPsychFullPhases(artifacts.LLM_PSYCH_FULL_V1);
  const labelWindows = readPsychLabelWindows(artifacts.LLM_PSYCH_LABELS);
  const timelineEvents = readNarrativeTimeline(artifacts.LLM_PSYCH_NARRATIVE);
  const segmentComments = readNarrativeSegmentComments(artifacts.LLM_PSYCH_NARRATIVE);
  return rows.map((row) => {
    const signals: ReportDialogueRow["matchSignals"] = [];
    const details: string[] = [];

    const p = row.prosody;
    if (p) {
      if (p.charsPerSec > 15) {
        signals.push({ code: "initiative_takeover", label: "↑ инициатива", tone: "up" });
        details.push(`Высокая скорость речи: ${p.charsPerSec.toFixed(1)} симв/с`);
      } else if (p.charsPerSec < 6) {
        signals.push({ code: "phase_decline", label: "фаза спада", tone: "down" });
        details.push(`Низкая скорость речи: ${p.charsPerSec.toFixed(1)} симв/с`);
      }
      if (p.rmsMeanDb > -18) {
        signals.push({ code: "tension_up", label: "напряжение растёт", tone: "up" });
        details.push(`Повышенная громкость сегмента: ${p.rmsMeanDb.toFixed(1)} dBFS`);
      }
    }

    for (const w of labelWindows) {
      if (w.speakerId !== row.speakerId) continue;
      if (!rangesOverlap(row.startTime, row.endTime, w.startSec, w.endSec)) continue;
      signals.push({
        code: w.code,
        label: psychCodeToBadgeLabel(w.code),
        tone: psychCodeToTone(w.code),
        confidence: w.score,
      });
      details.push(
        `${psychCodeToBadgeLabel(w.code)}${w.score != null ? ` (уверенность ${w.score.toFixed(2)})` : ""}${w.quote ? `: "${w.quote}"` : ""}`,
      );
    }

    for (const ev of timelineEvents) {
      const eventEnd = ev.endSec ?? ev.startSec;
      if (!rangesOverlap(row.startTime, row.endTime, ev.startSec, eventEnd)) continue;
      if (Array.isArray(ev.actors) && ev.actors.length > 0 && !ev.actors.includes(row.speakerId)) continue;
      signals.push({
        code: "timeline_event",
        label: ev.tensionDelta === "up" ? "напряжение растёт" : ev.tensionDelta === "down" ? "напряжение снизилось" : "ключевой момент",
        tone: ev.tensionDelta === "up" ? "up" : ev.tensionDelta === "down" ? "down" : "neutral",
      });
      details.push(`Событие таймлайна: ${substituteSpeakerRefsInPsychText(ev.summary, identityLookup)}`);
    }

    for (const sc of segmentComments) {
      if (sc.speakerId !== row.speakerId) continue;
      if (!rangesOverlap(row.startTime, row.endTime, sc.startSec, sc.endSec)) continue;
      signals.push({
        code: "segment_comment",
        label:
          sc.tensionDelta === "up"
            ? "комментарий: усиление"
            : sc.tensionDelta === "down"
              ? "комментарий: спад"
              : "комментарий сегмента",
        tone: sc.tensionDelta === "up" ? "up" : sc.tensionDelta === "down" ? "down" : "neutral",
        confidence: sc.confidence ?? null,
      });
      details.push(`Комментарий сегмента: ${substituteSpeakerRefsInPsychText(sc.summary, identityLookup)}`);
    }

    const matchedEpisode = psychFullEpisodes.find((ep) =>
      rangesOverlap(row.startTime, row.endTime, ep.startTimeSec, ep.endTimeSec) &&
      (ep.speakers.length === 0 || ep.speakers.includes(row.speakerId)),
    );
    const matchedParticipant = psychFullParticipants.get(row.speakerId);
    if (matchedEpisode) {
      signals.push({
        code: "full_psych_episode",
        label: "full psycho episode",
        tone: matchedEpisode.evidence.some((e) => e.confirmedByENR) ? "up" : "neutral",
      });
      // Нарратив, фаза и роль выводятся из fullPsychEpisode — не дублируем в signalDetails (см. UI «Детали эпизода»).
    }

    const uniqSignals = dedupeSignals(signals);
    return {
      ...row,
      ...(uniqSignals.length > 0 ? { matchSignals: uniqSignals } : {}),
      ...(details.length > 0 ? { signalDetails: details } : {}),
      ...(matchedEpisode
        ? {
            fullPsychEpisode: {
              episodeId: matchedEpisode.episodeId,
              ...(matchedEpisode.phaseId ? { phaseId: matchedEpisode.phaseId } : {}),
              ...(matchedEpisode.phaseId && psychFullPhases.get(matchedEpisode.phaseId)?.phaseName
                ? { phaseName: psychFullPhases.get(matchedEpisode.phaseId)?.phaseName }
                : {}),
              ...(matchedParticipant?.behaviorStrategy ? { participantRoleHint: matchedParticipant.behaviorStrategy } : {}),
              ...(matchedEpisode.narrativeCommentary
                ? {
                    narrativeCommentary: substituteSpeakerRefsInPsychText(
                      matchedEpisode.narrativeCommentary,
                      identityLookup,
                    ),
                  }
                : {}),
              evidence: matchedEpisode.evidence,
            },
          }
        : {}),
    };
  });
}

function readPsychLabelWindows(
  artifact: ArtifactEnvelope | undefined,
): Array<{ speakerId: string; code: string; score: number | null; startSec: number; endSec: number; quote?: string }> {
  const data = Array.isArray(artifact?.data) ? artifact.data : [];
  const out: Array<{ speakerId: string; code: string; score: number | null; startSec: number; endSec: number; quote?: string }> = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId : "";
    if (!speakerId) continue;
    const labels = Array.isArray(o.labels) ? o.labels : [];
    const evidence = Array.isArray(o.evidence) ? o.evidence : [];
    const firstEvidence =
      evidence.find((ev) => ev && typeof ev === "object" && toNumber((ev as Record<string, unknown>).startSec) !== null) ?? null;
    const startSec = firstEvidence ? toNumber((firstEvidence as Record<string, unknown>).startSec) ?? 0 : 0;
    const endSec = firstEvidence ? toNumber((firstEvidence as Record<string, unknown>).endSec) ?? startSec : startSec;
    const quote =
      firstEvidence && typeof (firstEvidence as Record<string, unknown>).quote === "string"
        ? String((firstEvidence as Record<string, unknown>).quote)
        : undefined;
    for (const labelItem of labels) {
      if (!labelItem || typeof labelItem !== "object") continue;
      const l = labelItem as Record<string, unknown>;
      const code = typeof l.code === "string" ? l.code : "";
      if (!code) continue;
      out.push({
        speakerId,
        code,
        score: toNumber(l.score),
        startSec,
        endSec,
        ...(quote ? { quote } : {}),
      });
    }
  }
  return out;
}

function readNarrativeTimeline(
  artifact: ArtifactEnvelope | undefined,
): Array<{ startSec: number; endSec?: number; summary: string; actors?: string[]; tensionDelta?: "up" | "down" | "flat" }> {
  if (!artifact?.data || typeof artifact.data !== "object") return [];
  const raw = (artifact.data as Record<string, unknown>).timelineEvents;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const startSec = toNumber(o.startSec);
      const endSec = toNumber(o.endSec);
      const summary = typeof o.summary === "string" ? o.summary.trim() : "";
      if (startSec === null || !summary) return null;
      const actors = Array.isArray(o.actors) ? o.actors.filter((a): a is string => typeof a === "string") : undefined;
      const tensionDelta = o.tensionDelta === "up" || o.tensionDelta === "down" || o.tensionDelta === "flat" ? o.tensionDelta : undefined;
      return { startSec, ...(endSec !== null ? { endSec } : {}), summary, ...(actors ? { actors } : {}), ...(tensionDelta ? { tensionDelta } : {}) };
    })
    .filter((x): x is { startSec: number; endSec?: number; summary: string; actors?: string[]; tensionDelta?: "up" | "down" | "flat" } => x !== null);
}

function readNarrativeSegmentComments(
  artifact: ArtifactEnvelope | undefined,
): Array<{
  speakerId: string;
  startSec: number;
  endSec: number;
  summary: string;
  tensionDelta?: "up" | "down" | "flat";
  confidence?: number | null;
}> {
  if (!artifact?.data || typeof artifact.data !== "object") return [];
  const raw = (artifact.data as Record<string, unknown>).segmentComments;
  if (!Array.isArray(raw)) return [];
  const out: Array<{
    speakerId: string;
    startSec: number;
    endSec: number;
    summary: string;
    tensionDelta?: "up" | "down" | "flat";
    confidence?: number | null;
  }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId.trim() : "";
    const startSec = toNumber(o.startSec);
    const endSec = toNumber(o.endSec);
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    if (!speakerId || startSec === null || endSec === null || endSec < startSec || !summary) continue;
    const tensionDelta: "up" | "down" | "flat" | undefined =
      o.tensionDelta === "up" || o.tensionDelta === "down" || o.tensionDelta === "flat"
        ? o.tensionDelta
        : undefined;
    const confidence = toNumber(o.confidence);
    out.push({
      speakerId,
      startSec,
      endSec,
      summary,
      ...(tensionDelta ? { tensionDelta } : {}),
      ...(confidence !== null ? { confidence } : {}),
    });
  }
  return out;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function psychCodeToBadgeLabel(code: string): string {
  const key = code.trim().toLowerCase();
  const map: Record<string, string> = {
    initiative_takeover: "перехват инициативы",
    interruption_risk: "риск перебивания",
    dominance_pattern: "доминирование",
    emotional_activation_peak: "пик эмоционального возбуждения",
    emotional_deactivation: "эмоциональный спад",
    cognitive_load_or_evasion: "когнитивная нагрузка / уход от ответа",
    turn_yielding: "уступка хода",
    submission_pattern: "подчинённая позиция",
    tension_up: "напряжение растёт",
    phase_decline: "фаза спада",
    timeline_event: "ключевой момент",
  };
  if (map[key]) return map[key];
  if (key.includes("initiative")) return "перехват инициативы";
  if (key.includes("tension") || key.includes("activation")) return "напряжение растёт";
  if (key.includes("deactivation") || key.includes("yield")) return "фаза спада";
  return code;
}

function psychCodeToTone(code: string): "up" | "down" | "neutral" {
  if (code.includes("initiative") || code.includes("activation") || code.includes("tension")) return "up";
  if (code.includes("deactivation") || code.includes("yield") || code.includes("submission")) return "down";
  return "neutral";
}

function dedupeSignals(signals: NonNullable<ReportDialogueRow["matchSignals"]>): NonNullable<ReportDialogueRow["matchSignals"]> {
  const seen = new Set<string>();
  const out: NonNullable<ReportDialogueRow["matchSignals"]> = [];
  for (const s of signals) {
    const k = `${s.code}|${s.label}|${s.tone ?? "neutral"}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function toDialogueRowsFromReady(data: unknown, identity: ArtifactEnvelope | undefined): ReportDialogueRow[] {
  const rows = Array.isArray(data) ? data : [];
  const map = readSpeakerIdentityLookup(identity);
  const out: ReportDialogueRow[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const startTime = toNumber(o.startTime);
    const endTime = toNumber(o.endTime);
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (startTime === null || endTime === null || !text) continue;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId : "speaker_unknown";
    out.push({
      speakerId,
      displayName: map.get(speakerId)?.displayName,
      startTime,
      endTime,
      text,
    });
  }
  return out;
}

function toDialogueRowsFromEnriched(data: unknown, identity: ArtifactEnvelope | undefined): ReportDialogueRow[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as Record<string, unknown>).segments;
  const rows = Array.isArray(raw) ? raw : [];
  const map = readSpeakerIdentityLookup(identity);
  const out: ReportDialogueRow[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const startTime = toNumber(o.startTime);
    const endTime = toNumber(o.endTime);
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (startTime === null || endTime === null || !text) continue;
    const speakerId =
      typeof o.speakerLabel === "string" ? o.speakerLabel : typeof o.speakerId === "string" ? o.speakerId : "speaker_unknown";
    out.push({
      speakerId,
      displayName: map.get(speakerId)?.displayName,
      startTime,
      endTime,
      text,
      prosody: toSegmentProsodyMetrics(o) ?? undefined,
    });
  }
  return out;
}

function buildDialogueLegend(dialogue: ReportDialogueRow[]): ReportDialogueLegend {
  let maxEnd = 0;
  const speakers = new Set<string>();
  for (const row of dialogue) {
    speakers.add(row.speakerId);
    if (row.endTime > maxEnd) maxEnd = row.endTime;
  }
  return { speakerCount: speakers.size, durationSec: maxEnd };
}

function toPsychNarrativeReadable(
  data: unknown,
): {
  kind: "psych_narrative";
  summary: string;
  timelineEvents: ReportTimelineMoment[];
  segmentComments: ReportSegmentComment[];
  turningPoints: string[];
  riskMoments: string[];
} | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const summary =
    typeof o.groupAtmosphereSummary === "string" && o.groupAtmosphereSummary.trim()
      ? o.groupAtmosphereSummary.trim()
      : typeof o.text === "string"
        ? o.text.trim()
        : "";
  if (!summary) return null;
  const timelineRaw = Array.isArray(o.timelineEvents) ? o.timelineEvents : [];
  const segmentCommentsRaw = Array.isArray(o.segmentComments) ? o.segmentComments : [];
  const timelineEvents: ReportTimelineMoment[] = timelineRaw
    .map((item): ReportTimelineMoment | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const startSec = toNumber(row.startSec);
      const endSec = toNumber(row.endSec);
      const eventSummary = typeof row.summary === "string" ? row.summary.trim() : "";
      if (startSec === null || !eventSummary) return null;
      const actors = Array.isArray(row.actors) ? row.actors.filter((a): a is string => typeof a === "string") : [];
      const td = row.tensionDelta;
      const tensionDelta = td === "up" || td === "down" || td === "flat" ? td : undefined;
      const quote = typeof row.evidence === "string" ? row.evidence : undefined;
      return {
        startSec,
        ...(endSec !== null ? { endSec } : {}),
        summary: eventSummary,
        actors,
        ...(quote ? { evidenceQuote: quote } : {}),
        ...(tensionDelta ? { tensionDelta } : {}),
      };
    })
    .filter((item): item is ReportTimelineMoment => item !== null);
  const segmentComments: ReportSegmentComment[] = segmentCommentsRaw
    .map((item): ReportSegmentComment | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const speakerId = typeof row.speakerId === "string" ? row.speakerId.trim() : "";
      const startSec = toNumber(row.startSec);
      const endSec = toNumber(row.endSec);
      const commentSummary = typeof row.summary === "string" ? row.summary.trim() : "";
      if (!speakerId || startSec === null || endSec === null || endSec < startSec || !commentSummary) return null;
      const td = row.tensionDelta;
      const tensionDelta = td === "up" || td === "down" || td === "flat" ? td : undefined;
      const patternIds = Array.isArray(row.patternIds)
        ? row.patternIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [];
      return {
        speakerId,
        startSec,
        endSec,
        summary: commentSummary,
        ...(tensionDelta ? { tensionDelta } : {}),
        ...(patternIds.length > 0 ? { patternIds } : {}),
        confidence: toNumber(row.confidence),
      };
    })
    .filter((item): item is ReportSegmentComment => item !== null);

  const turningPoints = Array.isArray(o.turningPoints)
    ? o.turningPoints.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const riskMoments = Array.isArray(o.riskMoments)
    ? o.riskMoments.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  return { kind: "psych_narrative", summary, timelineEvents, segmentComments, turningPoints, riskMoments };
}

function toPsychLabelCards(data: unknown, identity: ArtifactEnvelope | undefined): ReportSpeakerPatternCard[] {
  const rows = Array.isArray(data) ? data : [];
  const speakerLookup = readSpeakerIdentityLookup(identity);
  const out: ReportSpeakerPatternCard[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId : "speaker_unknown";
    const displayNameFromPayload = typeof o.displayName === "string" && o.displayName.trim() ? o.displayName.trim() : undefined;
    const displayName = displayNameFromPayload ?? speakerLookup.get(speakerId)?.displayName;
    const labels = Array.isArray(o.labels) ? o.labels : [];
    const evidence = Array.isArray(o.evidence) ? o.evidence : [];
    const firstQuote = evidence.find((ev) => ev && typeof ev === "object" && typeof (ev as Record<string, unknown>).quote === "string");
    const evidenceQuote = firstQuote ? String((firstQuote as Record<string, unknown>).quote) : undefined;
    for (const labelItem of labels) {
      if (!labelItem || typeof labelItem !== "object") continue;
      const lab = labelItem as Record<string, unknown>;
      const code = typeof lab.code === "string" ? lab.code : "";
      if (!code) continue;
      const score = toNumber(lab.score);
      const timeWindow =
        firstQuote && typeof firstQuote === "object"
          ? `${toNumber((firstQuote as Record<string, unknown>).startSec) ?? 0}-${toNumber((firstQuote as Record<string, unknown>).endSec) ?? 0}s`
          : "";
      out.push({
        speakerId,
        ...(displayName ? { displayName } : {}),
        code: psychCodeToBadgeLabel(code),
        confidence: score,
        explanation: timeWindow ? `Паттерн обнаружен в окне ${timeWindow}` : "Паттерн обнаружен в репликах спикера",
        ...(evidenceQuote ? { evidenceQuote } : {}),
      });
    }
  }
  return out;
}

function toLlmSummaryReadable(
  data: unknown,
): {
  kind: "llm_summary";
  scenario: string;
  subScenario: string;
  sections: ReportSummarySectionBlock[];
  qualityNotes?: string;
  doNotInfer?: string[];
} | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const scenario = typeof o.scenario === "string" && o.scenario.trim() ? o.scenario.trim() : "docs";
  const subScenario = typeof o.subScenario === "string" && o.subScenario.trim() ? o.subScenario.trim() : "protocol";
  const sectionsRaw = Array.isArray(o.sections) ? o.sections : [];
  const sections: ReportSummarySectionBlock[] = sectionsRaw
    .map((section, idx): ReportSummarySectionBlock | null => {
      if (!section || typeof section !== "object") return null;
      const s = section as Record<string, unknown>;
      const id =
        typeof s.id === "string" && s.id.trim()
          ? s.id.trim()
          : typeof s.title === "string" && s.title.trim()
            ? `section_${idx + 1}`
            : "";
      const title =
        typeof s.title === "string" && s.title.trim()
          ? s.title.trim()
          : typeof s.id === "string" && s.id.trim()
            ? s.id.trim()
            : "";
      if (!id || !title) return null;
      const itemsRaw = Array.isArray(s.items) ? s.items : [];
      const items: ReportSummarySectionItem[] = itemsRaw
        .map((item, itemIdx): ReportSummarySectionItem | null => {
          if (!item || typeof item !== "object") {
            return typeof item === "string" && item.trim()
              ? { id: `I${itemIdx + 1}`, text: item.trim() }
              : null;
          }
          const it = item as Record<string, unknown>;
          const itemId =
            typeof it.id === "string" && it.id.trim() ? it.id.trim() : `I${itemIdx + 1}`;
          const text = typeof it.text === "string" && it.text.trim() ? it.text.trim() : undefined;
          const itemTitle = typeof it.title === "string" && it.title.trim() ? it.title.trim() : undefined;
          const description =
            typeof it.description === "string" && it.description.trim() ? it.description.trim() : undefined;
          const owners = Array.isArray(it.owners)
            ? it.owners.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            : undefined;
          const deadline =
            typeof it.deadline === "string" && it.deadline.trim()
              ? it.deadline.trim()
              : it.deadline === null
                ? null
                : undefined;
          const priority = typeof it.priority === "string" && it.priority.trim() ? it.priority.trim() : undefined;
          const evidence = Array.isArray(it.evidence)
            ? it.evidence
                .map((ev) => {
                  if (!ev || typeof ev !== "object") return null;
                  const e = ev as Record<string, unknown>;
                  const startSec = toNumber(e.startSec);
                  const endSec = toNumber(e.endSec);
                  const speakerId = typeof e.speakerId === "string" ? e.speakerId : undefined;
                  if (startSec === null && endSec === null && !speakerId) return null;
                  return {
                    ...(startSec !== null ? { startSec } : {}),
                    ...(endSec !== null ? { endSec } : {}),
                    ...(speakerId ? { speakerId } : {}),
                  };
                })
                .filter((x): x is { startSec?: number; endSec?: number; speakerId?: string } => x !== null)
            : undefined;
          return {
            id: itemId,
            ...(text ? { text } : {}),
            ...(itemTitle ? { title: itemTitle } : {}),
            ...(description ? { description } : {}),
            ...(owners && owners.length > 0 ? { owners } : {}),
            ...(deadline !== undefined ? { deadline } : {}),
            ...(priority ? { priority } : {}),
            ...(evidence && evidence.length > 0 ? { evidence } : {}),
          };
        })
        .filter((x): x is ReportSummarySectionItem => x !== null);
      return { id, title, items };
    })
    .filter((x): x is ReportSummarySectionBlock => x !== null);
  if (sections.length === 0) return null;
  const qualityRaw = o.quality && typeof o.quality === "object" ? (o.quality as Record<string, unknown>) : null;
  const qualityNotes =
    qualityRaw && typeof qualityRaw.notes === "string" && qualityRaw.notes.trim()
      ? qualityRaw.notes.trim()
      : undefined;
  const doNotInfer =
    qualityRaw && Array.isArray(qualityRaw.doNotInfer)
      ? qualityRaw.doNotInfer.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
  return {
    kind: "llm_summary",
    scenario,
    subScenario,
    sections,
    ...(qualityNotes ? { qualityNotes } : {}),
    ...(doNotInfer && doNotInfer.length > 0 ? { doNotInfer } : {}),
  };
}

function toPsychFullReadable(
  data: unknown,
): {
  kind: "psych_full";
  phases: Array<{
    phaseId: string;
    phaseName: string;
    startTimeSec: number;
    endTimeSec: number;
    phaseSummary: string;
    emotionalProfile: string;
  }>;
  episodes: Array<{
    episodeId: string;
    segmentIds: string[];
    speakers: string[];
    startTimeSec: number;
    endTimeSec: number;
    episodeSummary: string;
    localImpact: string;
    narrativeCommentary: string;
    phaseId?: string;
    evidence: ReportCombinationEvidence[];
  }>;
  participants: Array<{
    speakerId: string;
    trajectory: string;
    behaviorStrategy: string;
    keyPhases: string[];
    keyEpisodes: string[];
  }>;
  globalCommentary: string;
  disclaimers: string[];
} | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const episodes = readPsychFullEpisodesFromData(o);
  if (episodes.length === 0) return null;
  return {
    kind: "psych_full",
    phases: readPsychFullPhasesFromData(o),
    episodes,
    participants: readPsychFullParticipantsFromData(o),
    globalCommentary:
      typeof o.globalCommentary === "string" && o.globalCommentary.trim()
        ? o.globalCommentary.trim()
        : "Аналитический комментарий недоступен.",
    disclaimers: Array.isArray(o.disclaimers)
      ? o.disclaimers.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [],
  };
}

function readPsychFullEpisodes(
  artifact: ArtifactEnvelope | undefined,
): Array<{
  episodeId: string;
  startTimeSec: number;
  endTimeSec: number;
  speakers: string[];
  narrativeCommentary: string;
  phaseId?: string;
  evidence: ReportCombinationEvidence[];
}> {
  if (!artifact?.data || typeof artifact.data !== "object") return [];
  return readPsychFullEpisodesFromData(artifact.data as Record<string, unknown>).map((episode) => ({
    episodeId: episode.episodeId,
    startTimeSec: episode.startTimeSec,
    endTimeSec: episode.endTimeSec,
    speakers: episode.speakers,
    narrativeCommentary: episode.narrativeCommentary,
    ...(episode.phaseId ? { phaseId: episode.phaseId } : {}),
    evidence: episode.evidence,
  }));
}

function readPsychFullEpisodesFromData(data: Record<string, unknown>): Array<{
  episodeId: string;
  segmentIds: string[];
  speakers: string[];
  startTimeSec: number;
  endTimeSec: number;
  episodeSummary: string;
  localImpact: string;
  narrativeCommentary: string;
  phaseId?: string;
  evidence: ReportCombinationEvidence[];
}> {
  const raw = Array.isArray(data.episodes) ? data.episodes : [];
  const out: Array<{
    episodeId: string;
    segmentIds: string[];
    speakers: string[];
    startTimeSec: number;
    endTimeSec: number;
    episodeSummary: string;
    localImpact: string;
    narrativeCommentary: string;
    phaseId?: string;
    evidence: ReportCombinationEvidence[];
  }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const episodeId = typeof o.episodeId === "string" ? o.episodeId.trim() : "";
    const startTimeSec = toNumber(o.startTimeSec);
    const endTimeSec = toNumber(o.endTimeSec);
    if (!episodeId || startTimeSec === null || endTimeSec === null || endTimeSec < startTimeSec) continue;
    out.push({
      episodeId,
      segmentIds: Array.isArray(o.segmentIds) ? o.segmentIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      speakers: Array.isArray(o.speakers) ? o.speakers.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      startTimeSec,
      endTimeSec,
      episodeSummary: typeof o.episodeSummary === "string" ? o.episodeSummary.trim() : "",
      localImpact: typeof o.localImpact === "string" ? o.localImpact.trim() : "",
      narrativeCommentary: typeof o.narrativeCommentary === "string" ? o.narrativeCommentary.trim() : "",
      ...(typeof o.phaseId === "string" && o.phaseId.trim() ? { phaseId: o.phaseId.trim() } : {}),
      evidence: normalizeReportCombinationEvidence(Array.isArray(o.evidence) ? o.evidence : []),
    });
  }
  return out;
}

function readPsychFullPhases(
  artifact: ArtifactEnvelope | undefined,
): Map<string, { phaseId: string; phaseName: string }> {
  const map = new Map<string, { phaseId: string; phaseName: string }>();
  if (!artifact?.data || typeof artifact.data !== "object") return map;
  for (const p of readPsychFullPhasesFromData(artifact.data as Record<string, unknown>)) {
    map.set(p.phaseId, { phaseId: p.phaseId, phaseName: p.phaseName });
  }
  return map;
}

function readPsychFullPhasesFromData(data: Record<string, unknown>) {
  const raw = Array.isArray(data.phases) ? data.phases : [];
  const out: Array<{
    phaseId: string;
    phaseName: string;
    startTimeSec: number;
    endTimeSec: number;
    phaseSummary: string;
    emotionalProfile: string;
  }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const phaseId = typeof o.phaseId === "string" ? o.phaseId.trim() : "";
    const phaseName = typeof o.phaseName === "string" ? o.phaseName.trim() : "";
    const startTimeSec = toNumber(o.startTimeSec);
    const endTimeSec = toNumber(o.endTimeSec);
    if (!phaseId || !phaseName || startTimeSec === null || endTimeSec === null || endTimeSec < startTimeSec) continue;
    out.push({
      phaseId,
      phaseName,
      startTimeSec,
      endTimeSec,
      phaseSummary: typeof o.phaseSummary === "string" ? o.phaseSummary.trim() : "",
      emotionalProfile: typeof o.emotionalProfile === "string" ? o.emotionalProfile.trim() : "",
    });
  }
  return out;
}

function readPsychFullParticipants(
  artifact: ArtifactEnvelope | undefined,
): Map<string, { speakerId: string; behaviorStrategy: string }> {
  const map = new Map<string, { speakerId: string; behaviorStrategy: string }>();
  if (!artifact?.data || typeof artifact.data !== "object") return map;
  for (const p of readPsychFullParticipantsFromData(artifact.data as Record<string, unknown>)) {
    map.set(p.speakerId, { speakerId: p.speakerId, behaviorStrategy: p.behaviorStrategy });
  }
  return map;
}

function readPsychFullParticipantsFromData(data: Record<string, unknown>) {
  const raw = Array.isArray(data.participants) ? data.participants : [];
  const out: Array<{
    speakerId: string;
    trajectory: string;
    behaviorStrategy: string;
    keyPhases: string[];
    keyEpisodes: string[];
  }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId.trim() : "";
    if (!speakerId) continue;
    out.push({
      speakerId,
      trajectory: typeof o.trajectory === "string" ? o.trajectory.trim() : "",
      behaviorStrategy: typeof o.behaviorStrategy === "string" ? o.behaviorStrategy.trim() : "",
      keyPhases: Array.isArray(o.keyPhases) ? o.keyPhases.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      keyEpisodes: Array.isArray(o.keyEpisodes) ? o.keyEpisodes.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
    });
  }
  return out;
}

function normalizeReportCombinationEvidence(raw: unknown[]): ReportCombinationEvidence[] {
  const out: ReportCombinationEvidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const combinationId = typeof o.combinationId === "string" ? o.combinationId.trim() : "";
    if (!combinationId) continue;
    const metricsRaw = Array.isArray(o.metrics) ? o.metrics : [];
    const metrics = metricsRaw
      .map((metric) => {
        if (!metric || typeof metric !== "object") return null;
        const m = metric as Record<string, unknown>;
        const metricName = typeof m.metricName === "string" ? m.metricName.trim() : "";
        const direction =
          m.direction === "↑" || m.direction === "↓" || m.direction === "→" || m.direction === "↑↑" || m.direction === "↓↓"
            ? m.direction
            : null;
        const comment = typeof m.comment === "string" ? m.comment.trim() : "";
        if (!metricName || !direction || !comment) return null;
        const value = toNumber(m.value);
        return { metricName, direction, ...(value !== null ? { value } : {}), comment };
      })
      .filter((x): x is ReportCombinationEvidence["metrics"][number] => x !== null);
    if (metrics.length < 2) continue;
    out.push({
      combinationId,
      dictionaryRef: typeof o.dictionaryRef === "string" ? o.dictionaryRef.trim() : undefined,
      confirmedByENR: o.confirmedByENR !== false,
      caveats: Array.isArray(o.caveats) ? o.caveats.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      metrics,
    });
  }
  return out;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "JSON serialization failed";
  }
}

function artifactNarrativeText(t: ArtifactTypeId, env: ArtifactEnvelope): string {
  const d = env.data;
  if (t === "TEXT" || t === "SUMMARY_TEXT") {
    if (d && typeof d === "object") {
      const o = d as Record<string, unknown>;
      const txt = typeof o.text === "string" ? o.text : typeof o.summary === "string" ? o.summary : "";
      if (txt.trim()) return txt;
    }
  }
  if (Array.isArray(d)) {
    if (d.length === 0) return "Артефакт пуст.";
    const first = JSON.stringify(d[0]).slice(0, 500);
    return `Получено элементов: ${d.length}. Первый элемент: ${first}`;
  }
  if (d && typeof d === "object") {
    const obj = d as Record<string, unknown>;
    if (Array.isArray(obj.segments)) return `Сегментов: ${obj.segments.length}.`;
    return JSON.stringify(obj).slice(0, 1200);
  }
  return typeof d === "string" ? d : "Данные артефакта получены.";
}

function toChecklistItems(
  artifact: ArtifactEnvelope | undefined,
  evidenceBase: EvidenceRef,
): ChecklistItem[] {
  if (!artifact || artifact.status !== "ready") {
    return [];
  }
  const data = Array.isArray(artifact.data) ? artifact.data : [];
  const items: ChecklistItem[] = [];
  data.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const s = item as Record<string, unknown>;
    const statusRaw = s.status;
    const status: ChecklistItem["status"] =
      statusRaw === "absent"
        ? "absent"
        : statusRaw === "uncertain"
          ? "uncertain"
          : "present";
    const priorityRaw = s.priority;
    const priority: ChecklistItem["priority"] =
      priorityRaw === "critical" || priorityRaw === "important" || priorityRaw === "optional"
        ? priorityRaw
        : "important";
    items.push({
      itemId: String(s.itemId ?? `item_${index}`),
      itemText: typeof s.itemText === "string" ? s.itemText : String(s.itemId ?? `Item ${index}`),
      status,
      priority,
      evidence: [evidenceBase],
    });
  });
  return items;
}

function buildTranscript(artifacts: ArtifactStore, evidenceBase: EvidenceRef): SpeakerSegment[] {
  for (const key of ["READY_SPEAKERS", "DRAFT_SPEAKERS"] as const) {
    const art = artifacts[key];
    if (art && isReady(art)) {
      const rows = toTranscript(art, evidenceBase);
      if (rows.length > 0) {
        return mergeProsodyOntoTranscript(rows, artifacts.ENRICHED_TRANSCRIPT);
      }
    }
  }

  const canonicalArt = artifacts.TRANSCRIPT_SEGMENTS;
  if (canonicalArt && isReady(canonicalArt)) {
    const fromCanonical = transcriptFromTranscriptSegmentsArtifact(canonicalArt, evidenceBase);
    if (fromCanonical.length > 0) {
      return fromCanonical;
    }
  }

  const enrichedArt = artifacts.ENRICHED_TRANSCRIPT;
  if (enrichedArt && isReady(enrichedArt)) {
    const fromEnriched = transcriptFromEnrichedArtifact(enrichedArt, evidenceBase);
    if (fromEnriched.length > 0) {
      return fromEnriched;
    }
  }
  const base = toTranscript(artifacts.SPEAKER_SEGMENTS, evidenceBase);
  return mergeProsodyOntoTranscript(base, artifacts.ENRICHED_TRANSCRIPT);
}

function readSpeakerIdentityLookup(
  identity: ArtifactEnvelope | undefined,
): Map<string, { displayName?: string; role?: string }> {
  const m = new Map<string, { displayName?: string; role?: string }>();
  if (!identity?.data || typeof identity.data !== "object") return m;
  const entries = (identity.data as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return m;
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId.trim() : "";
    if (!speakerId) continue;
    m.set(speakerId, {
      displayName:
        typeof o.displayName === "string"
          ? o.displayName
          : typeof o.name === "string"
            ? o.name
            : undefined,
      role: typeof o.role === "string" ? o.role : undefined,
    });
  }
  return m;
}

function applySpeakerIdentityToTranscript(
  segments: SpeakerSegment[],
  identity: ArtifactEnvelope | undefined,
): SpeakerSegment[] {
  const map = readSpeakerIdentityLookup(identity);
  if (map.size === 0) return segments;
  return segments.map((s) => {
    const row = map.get(s.speakerId);
    const label = row?.displayName ?? row?.role;
    if (!label || !label.trim()) return s;
    return { ...s, displayName: label.trim() };
  });
}

function transcriptFromTranscriptSegmentsArtifact(
  artifact: ArtifactEnvelope,
  evidenceBase: EvidenceRef,
): SpeakerSegment[] {
  const data = Array.isArray(artifact.data) ? artifact.data : [];
  if (data.length === 0) {
    return [];
  }

  const result: SpeakerSegment[] = [];
  data.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const source = item as Record<string, unknown>;

    const start = toNumber(source.startTime);
    const end = toNumber(source.endTime);
    const text = typeof source.text === "string" ? source.text : "";
    if (start === null || end === null || text.length === 0) return;

    const speakerId = typeof source.speakerId === "string" ? source.speakerId : "speaker_unknown";

    // Prosody metrics can be provided either at segment root or under `prosody`.
    const prosodyCandidate =
      source.prosody && typeof source.prosody === "object" && !Array.isArray(source.prosody)
        ? (source.prosody as Record<string, unknown>)
        : source;
    const prosody = toSegmentProsodyMetrics(prosodyCandidate);

    result.push({
      speakerId,
      startTime: start,
      endTime: end,
      text,
      evidence: {
        ...evidenceBase,
        evidenceId: `transcript_${index}`,
        timecodeStartSec: start,
        timecodeEndSec: end,
        quote: text,
      },
      ...(prosody ? { prosody } : {}),
    });
  });
  return result;
}

function transcriptFromEnrichedArtifact(
  artifact: ArtifactEnvelope,
  evidenceBase: EvidenceRef,
): SpeakerSegment[] {
  const data = artifact.data;
  if (!data || typeof data !== "object") {
    return [];
  }
  const raw = (data as Record<string, unknown>).segments;
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: SpeakerSegment[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const source = item as Record<string, unknown>;
    const start = toNumber(source.startTime);
    const end = toNumber(source.endTime);
    const text = typeof source.text === "string" ? source.text : "";
    if (start === null || end === null || text.length === 0) {
      return;
    }
    const prosody = toSegmentProsodyMetrics(source);
    result.push({
      speakerId: typeof source.speakerId === "string" ? source.speakerId : "speaker_unknown",
      startTime: start,
      endTime: end,
      text,
      evidence: {
        ...evidenceBase,
        evidenceId: `transcript_${index}`,
        timecodeStartSec: start,
        timecodeEndSec: end,
        quote: text,
      },
      ...(prosody ? { prosody } : {}),
    });
  });
  return result;
}

function toTranscript(
  artifact: ArtifactEnvelope | undefined,
  evidenceBase: EvidenceRef,
): SpeakerSegment[] {
  const data = Array.isArray(artifact?.data) ? artifact.data : [];
  if (data.length === 0) {
    return [];
  }

  const result: SpeakerSegment[] = [];
  data.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const source = item as Record<string, unknown>;
    const start = toNumber(source.startTime);
    const end = toNumber(source.endTime);
    const text = typeof source.text === "string" ? source.text : "";
    if (start === null || end === null || text.length === 0) {
      return;
    }
    result.push({
      speakerId: typeof source.speakerId === "string" ? source.speakerId : "speaker_unknown",
      startTime: start,
      endTime: end,
      text,
      evidence: {
        ...evidenceBase,
        evidenceId: `transcript_${index}`,
        timecodeStartSec: start,
        timecodeEndSec: end,
        quote: text,
      },
    });
  });
  return result;
}

function segmentAlignKey(speakerId: string, startTime: number, endTime: number): string {
  return `${speakerId}|${startTime.toFixed(4)}|${endTime.toFixed(4)}`;
}

function extractProsodyRowMap(artifact: ArtifactEnvelope | undefined): Map<string, SegmentProsodyMetrics> {
  const m = new Map<string, SegmentProsodyMetrics>();
  if (!artifact?.data || typeof artifact.data !== "object") {
    return m;
  }
  const root = artifact.data as Record<string, unknown>;
  const raw = root.segments;
  if (!Array.isArray(raw)) {
    return m;
  }
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId : "speaker_unknown";
    const st = toNumber(o.startTime);
    const en = toNumber(o.endTime);
    if (st === null || en === null) continue;
    const metrics = toSegmentProsodyMetrics(o);
    if (metrics) {
      m.set(segmentAlignKey(speakerId, st, en), metrics);
    }
  }
  return m;
}

function toSegmentProsodyMetrics(o: Record<string, unknown>): SegmentProsodyMetrics | null {
  const rmsMeanDb = toNumber(o.rmsMeanDb);
  const zcrMean = toNumber(o.zcrMean);
  const spectralCentroidMeanHz = toNumber(o.spectralCentroidMeanHz);
  const spectralRolloffMeanHz = toNumber(o.spectralRolloffMeanHz);
  const charsPerSec = toNumber(o.charsPerSec);
  const durationSec = toNumber(o.durationSec);
  if (
    rmsMeanDb === null ||
    zcrMean === null ||
    spectralCentroidMeanHz === null ||
    spectralRolloffMeanHz === null ||
    charsPerSec === null ||
    durationSec === null
  ) {
    return null;
  }
  const g = o.globalTempoBpm;
  const globalTempoBpm =
    typeof g === "number" && Number.isFinite(g) ? g : null;
  return {
    rmsMeanDb,
    zcrMean,
    spectralCentroidMeanHz,
    spectralRolloffMeanHz,
    charsPerSec,
    durationSec,
    globalTempoBpm,
  };
}

function mergeProsodyOntoTranscript(
  transcript: SpeakerSegment[],
  enriched: ArtifactEnvelope | undefined,
): SpeakerSegment[] {
  const rows = extractProsodyRowMap(enriched);
  if (rows.size === 0) {
    return transcript;
  }
  return transcript.map((seg) => {
    const key = segmentAlignKey(seg.speakerId, seg.startTime, seg.endTime);
    const prosody = rows.get(key);
    if (!prosody) {
      return seg;
    }
    return { ...seg, prosody };
  });
}

function patternIdToPsychReportLabel(patternId: string): PsychStateLabel["label"] {
  switch (patternId) {
    case "initiative_takeover":
    case "interruption_risk":
    case "dominance_pattern":
    case "emotional_activation_peak":
      return "tense";
    case "cognitive_load_or_evasion":
    case "emotional_deactivation":
    case "turn_yielding":
    case "submission_pattern":
      return "uncertain";
    default:
      return "neutral";
  }
}

function psychMatcherV1ToReportLabels(
  payload: PsychMatcherV1Payload,
  evidenceBase: EvidenceRef,
): PsychStateLabel[] {
  const result: PsychStateLabel[] = [];
  payload.entries.forEach((e, index) => {
    const label = patternIdToPsychReportLabel(e.patternId);
    const snap = e.prosodySnapshot;
    result.push({
      speakerId: e.speakerId,
      windowStart: e.startSec,
      windowEnd: e.endSec,
      label,
      features: {
        pauseRatio: Math.min(1, Math.max(0, snap.silenceRatio)),
        speechRate: snap.charsPerSec,
        energyVar: Math.abs(e.zByMetric.rmsMeanDb ?? 0),
        pitchVar: Math.abs(e.zByMetric.spectralCentroidMeanHz ?? 0),
      },
      evidence: [
        {
          ...evidenceBase,
          evidenceId: `psych_${index}`,
          timecodeStartSec: e.startSec,
          timecodeEndSec: e.endSec,
        },
      ],
    });
  });
  return result;
}

function toPsychLabels(
  artifact: ArtifactEnvelope | undefined,
  evidenceBase: EvidenceRef,
): PsychStateLabel[] {
  const raw = artifact?.data;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).kind === "psych_matcher_v1") {
    return psychMatcherV1ToReportLabels(raw as PsychMatcherV1Payload, evidenceBase);
  }

  const data = Array.isArray(raw) ? raw : [];
  if (data.length === 0) {
    return [];
  }

  const result: PsychStateLabel[] = [];
  data.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const source = item as Record<string, unknown>;
    const label = source.label;
    const allowed = new Set(["confident", "uncertain", "tense", "tired", "neutral"]);
    if (typeof label !== "string" || !allowed.has(label)) {
      return;
    }

    const windowStart = toNumber(source.windowStart) ?? 0;
    const windowEnd = toNumber(source.windowEnd) ?? 0;
    const featSrc = source.features;
    const featObj =
      featSrc && typeof featSrc === "object" && !Array.isArray(featSrc)
        ? (featSrc as Record<string, unknown>)
        : {};
    result.push({
      speakerId: typeof source.speakerId === "string" ? source.speakerId : "speaker_unknown",
      windowStart,
      windowEnd,
      label: label as PsychStateLabel["label"],
      features: {
        pauseRatio: toNumber(featObj.pauseRatio) ?? 0,
        speechRate: toNumber(featObj.speechRate) ?? 0,
        energyVar: toNumber(featObj.energyVar) ?? 0,
        pitchVar: toNumber(featObj.pitchVar) ?? 0,
      },
      evidence: [
        {
          ...evidenceBase,
          evidenceId: `psych_${index}`,
          timecodeStartSec: windowStart,
          timecodeEndSec: windowEnd,
        },
      ],
    });
  });
  return result;
}

function readString(artifact: ArtifactEnvelope | undefined, field: string): string | null {
  if (!artifact?.data || typeof artifact.data !== "object") {
    return null;
  }
  const value = (artifact.data as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function readSummaryTextFromLlmSummary(artifact: ArtifactEnvelope | undefined): string | null {
  if (!artifact?.data || typeof artifact.data !== "object") return null;
  const o = artifact.data as Record<string, unknown>;
  const sections = Array.isArray(o.sections) ? o.sections : [];
  for (const sec of sections) {
    if (!sec || typeof sec !== "object") continue;
    const s = sec as Record<string, unknown>;
    const items = Array.isArray(s.items) ? s.items : [];
    for (const item of items) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const text =
        (typeof it.text === "string" && it.text.trim()) ||
        (typeof it.title === "string" && it.title.trim()) ||
        (typeof it.description === "string" && it.description.trim()) ||
        "";
      if (text) return text;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return null;
}

export function isSessionReportPayload(data: unknown): data is SessionReport {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return (
    typeof o.sessionId === "string" &&
    typeof o.generatedAt === "string" &&
    Array.isArray(o.checklistResults) &&
    typeof o.summary === "object" &&
    o.summary !== null
  );
}
