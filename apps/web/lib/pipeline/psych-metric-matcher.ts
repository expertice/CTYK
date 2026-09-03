import type { ProsodyEnrichedSegment } from "../local-models/model-manager";
import lexiconJson from "./data/psychmetric_lexicon_librosa_full_ru.json";

const NEUTRAL_Z = 0.35;

export type PsychLexiconRule = {
  metric: string;
  direction: "high" | "low" | "neutral";
  threshold_sd: number;
};

export type PsychLexiconPattern = {
  id: string;
  label: string;
  minMatchCount: number;
  rules: PsychLexiconRule[];
  score_weights: Record<string, number>;
  interpretation: string;
  behavioralHint: string;
  caveats: string[];
  doNotInfer: string[];
};

export type PsychLexiconFile = {
  version: string;
  patterns: PsychLexiconPattern[];
};

const DEFAULT_LEXICON = lexiconJson as unknown as PsychLexiconFile;

export type PsychMatcherEntry = {
  patternId: string;
  speakerId: string;
  startSec: number;
  endSec: number;
  text: string;
  score: number;
  matchedMetrics: string[];
  zByMetric: Record<string, number>;
  /** Сырые метрики сегмента (для отчёта, без z). */
  prosodySnapshot: {
    silenceRatio: number;
    charsPerSec: number;
    rmsMeanDb: number;
    spectralCentroidMeanHz: number;
  };
};

export type PsychNarrativeHint = {
  patternId: string;
  interpretation: string;
  behavioralHint: string;
  caveats: string[];
  doNotInfer: string[];
};

export type PsychMatcherV1Payload = {
  kind: "psych_matcher_v1";
  lexiconVersion: string;
  entries: PsychMatcherEntry[];
  narrativeHints: PsychNarrativeHint[];
};

/** Совместимо с LLM-контрактом LLM_PSYCH_LABELS (массив по спикерам). */
export type PsychLabelItemForLlm = {
  speakerId: string;
  labels: Array<{
    code: string;
    score?: number;
    source?: "rules" | "llm" | "mixed";
    agreeWithRuleEngine?: boolean;
    reason?: string;
  }>;
  evidence: Array<{ startSec: number; endSec: number; quote?: string }>;
};

const SKIP_PATTERN_IDS = new Set<string>(["rapport_growth"]);

const METRIC_GETTERS: Record<string, (s: ProsodyEnrichedSegment) => number> = {
  rmsMeanDb: (s) => s.rmsMeanDb,
  zcrMean: (s) => s.zcrMean,
  spectralCentroidMeanHz: (s) => s.spectralCentroidMeanHz,
  spectralRolloffMeanHz: (s) => s.spectralRolloffMeanHz,
  charsPerSec: (s) => s.charsPerSec,
  durationSec: (s) => s.durationSec,
  silenceRatio: (s) => s.silenceRatio,
  spectralFlux: (s) => s.spectralFlux,
};

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return median(s);
}

function robustMedianScale(values: number[]): { med: number; scale: number } {
  const med = medianOf(values);
  if (values.length <= 1) {
    return { med, scale: 1e-6 };
  }
  const devs = values.map((v) => Math.abs(v - med));
  const mad = medianOf(devs);
  let scale = 1.4826 * mad;
  if (scale < 1e-9) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(1, values.length - 1);
    scale = Math.sqrt(Math.max(variance, 1e-12));
  }
  return { med, scale: Math.max(scale, 1e-9) };
}

function zScore(value: number, med: number, scale: number): number {
  return (value - med) / scale;
}

function ruleMatches(z: number, rule: PsychLexiconRule): boolean {
  const t = rule.threshold_sd;
  if (rule.direction === "high") return z >= t;
  if (rule.direction === "low") return z <= -t;
  if (rule.direction === "neutral") {
    if (t <= 0) return Math.abs(z) <= NEUTRAL_Z;
    return Math.abs(z) <= t;
  }
  return false;
}

function ruleStrength(z: number, rule: PsychLexiconRule): number {
  const t = Math.max(rule.threshold_sd, 0.05);
  if (rule.direction === "high") return Math.min(1, Math.max(0, z / (t * 1.5)));
  if (rule.direction === "low") return Math.min(1, Math.max(0, -z / (t * 1.5)));
  if (rule.direction === "neutral") {
    const cap = t > 0 ? t : NEUTRAL_Z;
    return Math.min(1, Math.max(0, 1 - Math.abs(z) / (cap * 1.5)));
  }
  return 0;
}

function patternScore(
  pattern: PsychLexiconPattern,
  matched: Array<{ rule: PsychLexiconRule; z: number }>,
): number {
  let num = 0;
  let den = 0;
  for (const { rule, z } of matched) {
    const w =
      pattern.score_weights[rule.metric] ??
      1 / Math.max(1, pattern.rules.length);
    const s = ruleStrength(z, rule);
    num += w * s;
    den += w;
  }
  return den > 0 ? Math.min(1, Math.max(0, num / den)) : 0;
}

function buildSpeakerMetricScales(
  segments: ProsodyEnrichedSegment[],
): Map<string, Map<string, { med: number; scale: number }>> {
  const bySpeaker = new Map<string, ProsodyEnrichedSegment[]>();
  for (const seg of segments) {
    const arr = bySpeaker.get(seg.speakerId) ?? [];
    arr.push(seg);
    bySpeaker.set(seg.speakerId, arr);
  }
  const out = new Map<string, Map<string, { med: number; scale: number }>>();
  const metricNames = Object.keys(METRIC_GETTERS);
  for (const [spk, rows] of bySpeaker) {
    const mMap = new Map<string, { med: number; scale: number }>();
    for (const m of metricNames) {
      const getter = METRIC_GETTERS[m];
      const vals = rows.map((r) => getter(r)).filter((v) => Number.isFinite(v));
      if (vals.length === 0) continue;
      mMap.set(m, robustMedianScale(vals));
    }
    out.set(spk, mMap);
  }
  return out;
}

export function runPsychMetricMatcher(
  segments: ProsodyEnrichedSegment[],
  lexicon: PsychLexiconFile = DEFAULT_LEXICON,
): PsychMatcherV1Payload {
  const scales = buildSpeakerMetricScales(segments);
  const entries: PsychMatcherEntry[] = [];
  const hintPatternIds = new Set<string>();

  for (const seg of segments) {
    const spkScales = scales.get(seg.speakerId);
    if (!spkScales) continue;

    const zByMetric: Record<string, number> = {};
    for (const [metric, getter] of Object.entries(METRIC_GETTERS)) {
      const sc = spkScales.get(metric);
      if (!sc) continue;
      const raw = getter(seg);
      if (!Number.isFinite(raw)) continue;
      zByMetric[metric] = zScore(raw, sc.med, sc.scale);
    }

    for (const pattern of lexicon.patterns) {
      if (SKIP_PATTERN_IDS.has(pattern.id)) continue;

      const matched: Array<{ rule: PsychLexiconRule; z: number }> = [];
      const matchedMetrics: string[] = [];

      for (const rule of pattern.rules) {
        const getter = METRIC_GETTERS[rule.metric];
        if (!getter) continue;
        const z = zByMetric[rule.metric];
        if (z === undefined || !Number.isFinite(z)) continue;
        if (ruleMatches(z, rule)) {
          matched.push({ rule, z });
          matchedMetrics.push(rule.metric);
        }
      }

      if (matched.length < pattern.minMatchCount) continue;

      const score = patternScore(pattern, matched);
      hintPatternIds.add(pattern.id);
      entries.push({
        patternId: pattern.id,
        speakerId: seg.speakerId,
        startSec: seg.startTime,
        endSec: seg.endTime,
        text: typeof seg.text === "string" ? seg.text : "",
        score,
        matchedMetrics,
        zByMetric: { ...zByMetric },
        prosodySnapshot: {
          silenceRatio: seg.silenceRatio,
          charsPerSec: seg.charsPerSec,
          rmsMeanDb: seg.rmsMeanDb,
          spectralCentroidMeanHz: seg.spectralCentroidMeanHz,
        },
      });
    }
  }

  const narrativeHints: PsychNarrativeHint[] = [];
  for (const p of lexicon.patterns) {
    if (!hintPatternIds.has(p.id)) continue;
    narrativeHints.push({
      patternId: p.id,
      interpretation: p.interpretation,
      behavioralHint: p.behavioralHint,
      caveats: [...p.caveats],
      doNotInfer: [...p.doNotInfer],
    });
  }

  return {
    kind: "psych_matcher_v1",
    lexiconVersion: lexicon.version,
    entries,
    narrativeHints,
  };
}

export function psychMatcherV1ToLlmLabelItems(payload: PsychMatcherV1Payload): PsychLabelItemForLlm[] {
  const bySpeaker = new Map<string, PsychMatcherEntry[]>();
  for (const e of payload.entries) {
    const arr = bySpeaker.get(e.speakerId) ?? [];
    arr.push(e);
    bySpeaker.set(e.speakerId, arr);
  }

  const out: PsychLabelItemForLlm[] = [];
  for (const [speakerId, hits] of bySpeaker) {
    const bestByPattern = new Map<string, number>();
    for (const h of hits) {
      const prev = bestByPattern.get(h.patternId) ?? 0;
      bestByPattern.set(h.patternId, Math.max(prev, h.score));
    }
    const labels = [...bestByPattern.entries()].map(([code, score]) => ({ code, score }));
    const evidence = hits.map((h) => ({
      startSec: h.startSec,
      endSec: h.endSec,
      ...(h.text.trim() ? { quote: h.text.length > 400 ? `${h.text.slice(0, 397)}...` : h.text } : {}),
    }));
    out.push({ speakerId, labels, evidence });
  }
  return out;
}
