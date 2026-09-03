export type LlmBehaviorPresetId = "weak" | "medium" | "strong";

export type LlmBehaviorConfig = {
  llmBehaviorPreset: LlmBehaviorPresetId;
  optimizeForSmallContext: boolean;
  targetContextTokens: number;
  responseMaxTokens: number;
  reserveTokensForOutputRatio: number;
  compactGranularity: "coarse" | "balanced" | "fine";
  maxWindowsPerSpeaker: number;
  maxQuotesTotal: number;
  includeRawSegmentsTail: boolean;
  llmRequestTimeoutMs: number;
  llmMaxRetries: number;
  llmRetryBackoffMs: number;
  llmAdaptiveDownshift: boolean;
  /** Макс. реплик READY_SPEAKERS в промпт для summary/checklist/speaker_names при optimizeForSmallContext. */
  maxReadySegmentsForLlm: number;
};

const PRESET_MAP: Record<LlmBehaviorPresetId, Omit<LlmBehaviorConfig, "llmBehaviorPreset">> = {
  weak: {
    optimizeForSmallContext: true,
    targetContextTokens: 2304,
    responseMaxTokens: 550,
    reserveTokensForOutputRatio: 0.45,
    compactGranularity: "coarse",
    maxWindowsPerSpeaker: 4,
    maxQuotesTotal: 6,
    includeRawSegmentsTail: false,
    llmRequestTimeoutMs: 90000,
    llmMaxRetries: 3,
    llmRetryBackoffMs: 2500,
    llmAdaptiveDownshift: true,
    maxReadySegmentsForLlm: 80,
  },
  medium: {
    optimizeForSmallContext: true,
    targetContextTokens: 4224,
    responseMaxTokens: 800,
    reserveTokensForOutputRatio: 0.38,
    compactGranularity: "balanced",
    maxWindowsPerSpeaker: 6,
    maxQuotesTotal: 10,
    includeRawSegmentsTail: false,
    llmRequestTimeoutMs: 120000,
    llmMaxRetries: 2,
    llmRetryBackoffMs: 2000,
    llmAdaptiveDownshift: true,
    maxReadySegmentsForLlm: 120,
  },
  strong: {
    optimizeForSmallContext: false,
    targetContextTokens: 8064,
    responseMaxTokens: 1200,
    reserveTokensForOutputRatio: 0.3,
    compactGranularity: "fine",
    maxWindowsPerSpeaker: 10,
    maxQuotesTotal: 16,
    includeRawSegmentsTail: true,
    llmRequestTimeoutMs: 180000,
    llmMaxRetries: 1,
    llmRetryBackoffMs: 1500,
    llmAdaptiveDownshift: false,
    maxReadySegmentsForLlm: 200,
  },
};

export function getLlmBehaviorPreset(id: LlmBehaviorPresetId): LlmBehaviorConfig {
  return {
    llmBehaviorPreset: id,
    ...PRESET_MAP[id],
  };
}

export function readLlmBehaviorPresetId(config: Record<string, unknown>): LlmBehaviorPresetId {
  const raw = typeof config.llmBehaviorPreset === "string" ? config.llmBehaviorPreset : "medium";
  return raw === "weak" || raw === "strong" ? raw : "medium";
}

export function applyLlmBehaviorPreset(
  config: Record<string, unknown>,
  id: LlmBehaviorPresetId,
): Record<string, unknown> {
  return {
    ...config,
    ...getLlmBehaviorPreset(id),
  };
}

