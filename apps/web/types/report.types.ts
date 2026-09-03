import type { ArtifactTypeId } from "./artifact.types";
import type { ModuleId } from "./pipeline.types";

export interface EvidenceRef {
  evidenceId: string;
  sourceArtifactType: ArtifactTypeId;
  quote?: string;
  timecodeStartSec?: number;
  timecodeEndSec?: number;
  speakerId?: string;
  confidence?: number;
  sourceStepId: string;
  sourceModuleId: ModuleId;
}

export interface ChecklistItem {
  itemId: string;
  itemText: string;
  status: "present" | "absent" | "uncertain";
  priority: "critical" | "important" | "optional";
  evidence: EvidenceRef[];
}

/** Метрики librosa/просодии из артефакта ENRICHED_TRANSCRIPT (и при необходимости подмешиваются в транскрипт отчёта). */
export interface SegmentProsodyMetrics {
  rmsMeanDb: number;
  zcrMean: number;
  spectralCentroidMeanHz: number;
  spectralRolloffMeanHz: number;
  charsPerSec: number;
  durationSec: number;
  globalTempoBpm: number | null;
}

export interface SpeakerSegment {
  speakerId: string;
  /** Подпись после шага LLM_SPEAKER_NAMES (SPEAKER_IDENTITY_MAP), если есть. */
  displayName?: string;
  startTime: number;
  endTime: number;
  text: string;
  evidence: EvidenceRef;
  prosody?: SegmentProsodyMetrics;
}

export interface PsychStateLabel {
  speakerId: string;
  windowStart: number;
  windowEnd: number;
  label: "confident" | "uncertain" | "tense" | "tired" | "neutral";
  features: {
    pauseRatio: number;
    speechRate: number;
    energyVar: number;
    pitchVar: number;
  };
  evidence: EvidenceRef[];
}

export interface SessionReport {
  sessionId: string;
  generatedAt: string;
  interpretationPolicy: "assistive_non_diagnostic";
  checklistResults: ChecklistItem[];
  transcript: SpeakerSegment[];
  psychStateSummary: {
    labels: PsychStateLabel[];
    narrative: {
      text: string;
      evidence: EvidenceRef[];
    };
  };
  summary: {
    text: string;
    evidence: EvidenceRef[];
  };
  artifactSections?: ArtifactSection[];
}

export interface ReportDialogueRow {
  speakerId: string;
  displayName?: string;
  startTime: number;
  endTime: number;
  text: string;
  evidenceQuote?: string;
  prosody?: SegmentProsodyMetrics;
  matchSignals?: ReportSegmentSignal[];
  signalDetails?: string[];
  fullPsychEpisode?: {
    episodeId: string;
    phaseId?: string;
    phaseName?: string;
    participantRoleHint?: string;
    narrativeCommentary?: string;
    evidence?: ReportCombinationEvidence[];
  };
}

export interface ReportSegmentSignal {
  code: string;
  label: string;
  tone?: "up" | "down" | "neutral";
  confidence?: number | null;
}

export interface ReportDialogueLegend {
  speakerCount: number;
  durationSec: number;
}

export interface ReportTimelineMoment {
  startSec: number;
  endSec?: number;
  summary: string;
  actors: string[];
  evidenceQuote?: string;
  tensionDelta?: "up" | "down" | "flat";
}

export interface ReportSegmentComment {
  speakerId: string;
  startSec: number;
  endSec: number;
  summary: string;
  tensionDelta?: "up" | "down" | "flat";
  patternIds?: string[];
  confidence?: number | null;
}

export interface ReportSpeakerPatternCard {
  speakerId: string;
  displayName?: string;
  code: string;
  confidence: number | null;
  explanation: string;
  evidenceQuote?: string;
}

export interface ReportSummarySectionItem {
  id: string;
  text?: string;
  title?: string;
  description?: string;
  owners?: string[];
  deadline?: string | null;
  priority?: string;
  evidence?: Array<{ startSec?: number; endSec?: number; speakerId?: string }>;
}

export interface ReportSummarySectionBlock {
  id: string;
  title: string;
  items: ReportSummarySectionItem[];
}

export interface ReportMetricEvidence {
  metricName: string;
  direction: "↑" | "↓" | "→" | "↑↑" | "↓↓";
  value?: number;
  comment: string;
}

export interface ReportCombinationEvidence {
  combinationId: string;
  dictionaryRef?: string;
  confirmedByENR: boolean;
  caveats: string[];
  metrics: ReportMetricEvidence[];
}

interface ArtifactSectionBase {
  artifactType: ArtifactTypeId;
  sourceModuleId: string;
  title: string;
  text: string;
  evidence: EvidenceRef[];
  rawJson?: string;
}

export interface ReadySpeakersArtifactSection extends ArtifactSectionBase {
  artifactType: "READY_SPEAKERS";
  readable: {
    kind: "dialogue";
    legend: ReportDialogueLegend;
    dialogue: ReportDialogueRow[];
  };
}

export interface EnrichedTranscriptArtifactSection extends ArtifactSectionBase {
  artifactType: "ENRICHED_TRANSCRIPT";
  readable: {
    kind: "dialogue_with_prosody";
    legend: ReportDialogueLegend;
    dialogue: ReportDialogueRow[];
  };
}

export interface LlmPsychNarrativeArtifactSection extends ArtifactSectionBase {
  artifactType: "LLM_PSYCH_NARRATIVE";
  readable: {
    kind: "psych_narrative";
    summary: string;
    timelineEvents: ReportTimelineMoment[];
    segmentComments: ReportSegmentComment[];
    turningPoints: string[];
    riskMoments: string[];
  };
}

export interface LlmPsychLabelsArtifactSection extends ArtifactSectionBase {
  artifactType: "LLM_PSYCH_LABELS";
  readable: {
    kind: "psych_labels";
    speakerPatterns: ReportSpeakerPatternCard[];
  };
}

export interface LlmSummaryArtifactSection extends ArtifactSectionBase {
  artifactType: "LLM_SUMMARY";
  readable: {
    kind: "llm_summary";
    scenario: string;
    subScenario: string;
    sections: ReportSummarySectionBlock[];
    qualityNotes?: string;
    doNotInfer?: string[];
  };
}

export interface LlmPsychFullArtifactSection extends ArtifactSectionBase {
  artifactType: "LLM_PSYCH_FULL_V1";
  readable: {
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
  };
}

export type ArtifactSection =
  | ReadySpeakersArtifactSection
  | EnrichedTranscriptArtifactSection
  | LlmPsychNarrativeArtifactSection
  | LlmPsychLabelsArtifactSection
  | LlmSummaryArtifactSection
  | LlmPsychFullArtifactSection
  | ArtifactSectionBase;
