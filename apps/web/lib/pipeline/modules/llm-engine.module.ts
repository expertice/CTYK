import type { ArtifactStore, ArtifactTypeId } from "../../../types/artifact.types";
import type { ModuleId, Scenario } from "../../../types/pipeline.types";
import type { LlmTask } from "../../ai/llm-engine";
import {
  buildLlmBundlePrompt,
  mergeLlmInstructionsData,
  parseLlmInstructionParts,
  type LlmInstructionPart,
} from "../llm-instructions-artifact";
import { gatherInboundArtifactsForStep } from "../step-inbound-artifacts";
import {
  psychMatcherV1ToLlmLabelItems,
  type PsychMatcherV1Payload,
} from "../psych-metric-matcher";
import { getLlmTaskContract, getLlmTaskDetailLabel, getLlmTaskForSatellite } from "../llm-task-contracts";
import {
  collectPsychFullUnknownCombinationWarnings,
  formatPsychFullCombinationsPromptBlock,
} from "../psych-full-combinations-dictionary";

const bundlePrompt = {
  promptId: "transcribator.llm_bundle",
  version: "v1",
  render(input: Record<string, unknown>): string {
    return buildLlmBundlePrompt(input);
  },
};

export const llmGatewayPrompts = {
  summary: bundlePrompt,
  checklist_analysis: bundlePrompt,
  psych_state: bundlePrompt,
  speaker_names: bundlePrompt,
};

export function resolveLlmTaskForModule(moduleId: ModuleId, config: Record<string, unknown>): LlmTask {
  const satelliteTask = getLlmTaskForSatellite(moduleId);
  if (satelliteTask) return satelliteTask;
  switch (moduleId) {
    case "LLM_PUPPET":
    default: {
      const t = config.task as LlmTask | undefined;
      if (t === "summary" || t === "checklist_analysis" || t === "psych_state" || t === "speaker_names") {
        return t;
      }
      return "summary";
    }
  }
}

export function subtaskDetailLabel(moduleId: ModuleId): string {
  const label = getLlmTaskDetailLabel(moduleId);
  if (label) return label;
  switch (moduleId) {
    default:
      return String(moduleId);
  }
}

export function buildLlmOutputForModule(
  taskModuleId: ModuleId,
  task: LlmTask,
  output: Record<string, unknown>,
  config: Record<string, unknown>,
  artifacts: ArtifactStore,
  baseProducer: { moduleId: ModuleId; runId: string; stepId: string },
  now: string,
): Partial<ArtifactStore> {
  const contract = getLlmTaskContract(taskModuleId);
  if (contract?.moduleId === "LLM_TASK_SUMMARY") {
    return buildSummaryOnlyOutput(output, config, baseProducer, now);
  }
  if (contract?.moduleId === "LLM_TASK_SPEAKER_NAMES") {
    return buildSpeakerIdentityOutput(output, baseProducer, now);
  }
  if (contract?.moduleId === "LLM_TASK_PSYCH") {
    return buildLlmPsychOnlyOutput(output, config, artifacts, baseProducer, now);
  }
  if (contract?.moduleId === "LLM_TASK_CHECKLIST") {
    return buildChecklistOnlyOutput(output, artifacts, baseProducer, now);
  }
  return buildGenericUnionOutput(task, output, artifacts, baseProducer, now);
}

function buildSummaryOnlyOutput(
  output: Record<string, unknown>,
  config: Record<string, unknown>,
  baseProducer: { moduleId: ModuleId; runId: string; stepId: string },
  now: string,
): Partial<ArtifactStore> {
  const cfg = readSummaryRequestConfig(config);
  const root = extractJsonRootFromOutput(output);
  const normalized = normalizeLlmSummary(root, cfg);
  const summaryData = { text: composeSummaryPreview(normalized.data, output) };
  return {
    SUMMARY_TEXT: {
      type: "SUMMARY_TEXT",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: {},
      data: summaryData,
      createdAt: now,
    },
    LLM_SUMMARY: {
      type: "LLM_SUMMARY",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: normalized.warnings.length > 0 ? { warnings: normalized.warnings } : {},
      data: normalized.data,
      createdAt: now,
    },
  };
}

type LlmSummaryData = {
  scenario: string;
  subScenario: string;
  sections: Array<{
    id: string;
    title: string;
    items: unknown[];
  }>;
  quality?: {
    notes?: string;
    doNotInfer?: string[];
  };
};

function readSummaryRequestConfig(config: Record<string, unknown>): {
  scenario: string;
  subScenario: string;
} {
  const scenario =
    typeof config.summaryScenario === "string" && config.summaryScenario.trim()
      ? config.summaryScenario.trim()
      : "docs";
  const subScenario =
    typeof config.summarySubScenario === "string" && config.summarySubScenario.trim()
      ? config.summarySubScenario.trim()
      : scenario === "analytics"
        ? "problems"
        : scenario === "planning"
          ? "actionplan"
          : "protocol";
  return { scenario, subScenario };
}

function normalizeLlmSummary(
  root: Record<string, unknown>,
  cfg: { scenario: string; subScenario: string },
): { data: LlmSummaryData; warnings: string[] } {
  const warnings: string[] = [];
  const scenario = typeof root.scenario === "string" && root.scenario.trim() ? root.scenario.trim() : cfg.scenario;
  const subScenario =
    typeof root.subScenario === "string" && root.subScenario.trim() ? root.subScenario.trim() : cfg.subScenario;
  const sectionsRaw = Array.isArray(root.sections) ? root.sections : [];
  const sections: LlmSummaryData["sections"] = sectionsRaw
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const id =
        typeof o.id === "string" && o.id.trim()
          ? o.id.trim()
          : typeof o.title === "string" && o.title.trim()
            ? `section_${idx + 1}`
            : "";
      const title =
        typeof o.title === "string" && o.title.trim()
          ? o.title.trim()
          : typeof o.id === "string" && o.id.trim()
            ? o.id.trim()
            : "";
      if (!id || !title) return null;
      const items = Array.isArray(o.items) ? o.items : [];
      return { id, title, items };
    })
    .filter((x): x is LlmSummaryData["sections"][number] => x !== null);
  if (sectionsRaw.length > 0 && sections.length === 0) {
    warnings.push("llm_summary_sections_rejected_invalid_contract");
  }
  const qualityObj =
    root.quality && typeof root.quality === "object" && !Array.isArray(root.quality)
      ? (root.quality as Record<string, unknown>)
      : null;
  const quality =
    qualityObj && (typeof qualityObj.notes === "string" || Array.isArray(qualityObj.doNotInfer))
      ? {
          ...(typeof qualityObj.notes === "string" && qualityObj.notes.trim()
            ? { notes: qualityObj.notes.trim() }
            : {}),
          ...(Array.isArray(qualityObj.doNotInfer)
            ? {
                doNotInfer: qualityObj.doNotInfer
                  .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
                  .map((x) => x.trim()),
              }
            : {}),
        }
      : undefined;
  const data: LlmSummaryData = {
    scenario,
    subScenario,
    sections,
    ...(quality ? { quality } : {}),
  };
  return { data, warnings };
}

function composeSummaryPreview(normalized: LlmSummaryData, output: Record<string, unknown>): string {
  const firstSection = normalized.sections.find((s) => s.items.length > 0) ?? normalized.sections[0];
  if (firstSection) {
    const firstItem = firstSection.items[0];
    if (typeof firstItem === "string" && firstItem.trim()) return firstItem.trim();
    if (firstItem && typeof firstItem === "object") {
      const o = firstItem as Record<string, unknown>;
      const txt =
        (typeof o.text === "string" && o.text.trim()) ||
        (typeof o.title === "string" && o.title.trim()) ||
        (typeof o.description === "string" && o.description.trim()) ||
        "";
      if (txt) return txt;
    }
    return `${firstSection.title}: ${firstSection.items.length}`;
  }
  return pickBestString(output, ["text", "summary", "content", "preview"]);
}

function buildChecklistOnlyOutput(
  output: Record<string, unknown>,
  artifacts: ArtifactStore,
  baseProducer: { moduleId: ModuleId; runId: string; stepId: string },
  now: string,
): Partial<ArtifactStore> {
  const checklistData = withChecklistFallback(
    pickBestArray(output, ["checklistResults", "items", "results"]),
    artifacts,
  );
  return {
    CHECKLIST_RESULTS: {
      type: "CHECKLIST_RESULTS",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: {},
      data: checklistData,
      createdAt: now,
    },
  };
}

function buildSpeakerIdentityOutput(
  output: Record<string, unknown>,
  baseProducer: { moduleId: ModuleId; runId: string; stepId: string },
  now: string,
): Partial<ArtifactStore> {
  const parsed = buildSpeakerIdentityData(output);
  return {
    SPEAKER_IDENTITY_MAP: {
      type: "SPEAKER_IDENTITY_MAP",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: parsed.warnings.length > 0 ? { warnings: parsed.warnings } : {},
      data: { entries: parsed.entries },
      createdAt: now,
    },
  };
}

function buildSpeakerIdentityData(output: Record<string, unknown>): {
  entries: Array<{ speakerId: string; displayName?: string; role?: string }>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const root = extractJsonRootFromOutput(output);
  const raw =
    Array.isArray(root.entries) && root.entries.length > 0
      ? root.entries
      : Array.isArray(root.identities) && root.identities.length > 0
        ? root.identities
        : Array.isArray(root.speakers) && root.speakers.length > 0
          ? root.speakers
          : Array.isArray(root.speakerMap) && root.speakerMap.length > 0
            ? root.speakerMap
            : pickBestArray(output, ["entries", "speakers", "speakerMap", "identities"]);

  const entries: Array<{ speakerId: string; displayName?: string; role?: string }> = [];
  let fallbackOrdinal = 1;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId =
      typeof o.speakerId === "string"
        ? o.speakerId
        : typeof o.id === "string"
          ? o.id
          : typeof o.speaker === "string"
            ? o.speaker
            : "";
    if (!speakerId.trim()) continue;
    const displayNameRaw =
      typeof o.displayName === "string"
        ? o.displayName
        : typeof o.name === "string"
          ? o.name
          : typeof o.label === "string"
            ? o.label
            : "";
    const roleRaw = typeof o.role === "string" ? o.role : "";
    let displayName = displayNameRaw.trim();
    const role = roleRaw.trim();
    // Защита от "пасстру" значения вида displayName=speaker_00.
    if (displayName && /^speaker_\d+$/i.test(displayName)) {
      displayName = `Спикер ${fallbackOrdinal}`;
      fallbackOrdinal += 1;
      if (!warnings.includes("speaker_identity_llm_passthrough")) {
        warnings.push("speaker_identity_llm_passthrough");
      }
    }
    // Контракт ДЕАНОН: identity должна содержать и имя, и роль.
    if (!displayName || !role) continue;
    entries.push({
      speakerId: speakerId.trim(),
      displayName,
      role,
    });
  }
  if (raw.length > 0 && entries.length === 0) {
    warnings.push("speaker_identity_map_rejected_invalid_contract");
  }
  return { entries, warnings };
}

function buildLlmPsychOnlyOutput(
  output: Record<string, unknown>,
  config: Record<string, unknown>,
  artifacts: ArtifactStore,
  baseProducer: { moduleId: ModuleId; runId: string; stepId: string },
  now: string,
): Partial<ArtifactStore> {
  const psychMode = readPsychMode(config);
  if (psychMode === "full_psycho_analytics") {
    return buildLlmPsychFullOutput(output, baseProducer, now, artifacts);
  }
  const parsed = parseStructuredPsychOutput(output);
  const lexiconCfg = readLlmLexiconCheckConfig(config);
  const segmentCommentMode = readSegmentCommentMode(config);
  const det = artifacts.PSYCH_LABELS?.data;
  const detRec =
    det && typeof det === "object" && !Array.isArray(det) ? (det as Record<string, unknown>) : null;
  const fromMatcher = detRec?.kind === "psych_matcher_v1";
  const baseRuleLabels = fromMatcher
    ? lexiconCfg.enableLlmLexiconCheck
      ? psychMatcherV1ToSegmentLabelItems(det as PsychMatcherV1Payload)
      : psychMatcherV1ToLlmLabelItems(det as PsychMatcherV1Payload)
    : [];
  const labelsForLlm = fromMatcher
    ? lexiconCfg.enableLlmLexiconCheck
      ? mergeRulesAndLlmLabels(baseRuleLabels, parsed.labels, det as PsychMatcherV1Payload, lexiconCfg)
      : baseRuleLabels
    : parsed.labels;
  const labelsWarnings = [
    ...(fromMatcher ? [] : parsed.labelsWarnings),
    ...(lexiconCfg.enableLlmLexiconCheck ? [`llm_lexicon_check_${lexiconCfg.mode}`] : []),
  ];
  const narrativePrepared =
    segmentCommentMode === "per_segment"
      ? fillMissingSegmentComments(parsed.narrative, artifacts, labelsForLlm)
      : parsed.narrative;
  const narrativeWarnings = [
    ...parsed.narrativeWarnings,
    ...(segmentCommentMode === "per_segment" &&
    Array.isArray(narrativePrepared.segmentComments) &&
    narrativePrepared.segmentComments.length > 0 &&
    narrativePrepared.segmentComments.some((c) => c.isFallback === true)
      ? ["psych_segment_comments_contains_fallbacks"]
      : []),
  ];
  const narrativeOut: PsychNarrativeData = {
    ...narrativePrepared,
    ...(Array.isArray(narrativePrepared.segmentComments)
      ? {
          segmentComments: narrativePrepared.segmentComments.map((c) => ({
            speakerId: c.speakerId,
            startSec: c.startSec,
            endSec: c.endSec,
            summary: c.summary,
            ...(c.tensionDelta ? { tensionDelta: c.tensionDelta } : {}),
            ...(c.patternIds && c.patternIds.length > 0 ? { patternIds: c.patternIds } : {}),
            ...(typeof c.confidence === "number" && Number.isFinite(c.confidence)
              ? { confidence: c.confidence }
              : {}),
          })),
        }
      : {}),
  };

  return {
    LLM_PSYCH_LABELS: {
      type: "LLM_PSYCH_LABELS",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: labelsWarnings.length > 0 ? { warnings: labelsWarnings } : {},
      data: labelsForLlm,
      createdAt: now,
    },
    LLM_PSYCH_NARRATIVE: {
      type: "LLM_PSYCH_NARRATIVE",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: narrativeWarnings.length > 0 ? { warnings: narrativeWarnings } : {},
      explainability: [],
      data: narrativeOut,
      createdAt: now,
    },
  };
}

function buildLlmPsychFullOutput(
  output: Record<string, unknown>,
  baseProducer: { moduleId: ModuleId; runId: string; stepId: string },
  now: string,
  artifacts: ArtifactStore,
): Partial<ArtifactStore> {
  const parsed = parsePsychFullOutput(output);
  const segmentationWarnings = computePsychFullSegmentationWarnings(parsed.data, artifacts);
  const dictionaryWarnings = collectPsychFullUnknownCombinationWarnings(parsed.data);
  const mergedWarnings = Array.from(
    new Set([...parsed.warnings, ...segmentationWarnings, ...dictionaryWarnings]),
  );
  const legacy = deriveLegacyPsychFromFull(parsed.data);
  const det = artifacts.PSYCH_LABELS?.data;
  const detRec =
    det && typeof det === "object" && !Array.isArray(det) ? (det as Record<string, unknown>) : null;
  const fromMatcher = detRec?.kind === "psych_matcher_v1";
  const ruleLabelsForReport = fromMatcher ? psychMatcherV1ToLlmLabelItems(det as PsychMatcherV1Payload) : [];
  return {
    LLM_PSYCH_FULL_V1: {
      type: "LLM_PSYCH_FULL_V1",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: mergedWarnings.length > 0 ? { warnings: mergedWarnings } : {},
      explainability: [],
      data: parsed.data,
      createdAt: now,
    },
    LLM_PSYCH_LABELS: {
      type: "LLM_PSYCH_LABELS",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: {},
      data: ruleLabelsForReport,
      createdAt: now,
    },
    LLM_PSYCH_NARRATIVE: {
      type: "LLM_PSYCH_NARRATIVE",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: {},
      explainability: [],
      data: legacy,
      createdAt: now,
    },
  };
}

function psychMatcherV1ToSegmentLabelItems(payload: PsychMatcherV1Payload): PsychLabelItem[] {
  return payload.entries.map((e) => ({
    speakerId: e.speakerId,
    labels: [{ code: e.patternId, score: e.score, source: "rules" }],
    evidence: [
      {
        startSec: e.startSec,
        endSec: e.endSec,
        ...(e.text.trim() ? { quote: e.text.length > 400 ? `${e.text.slice(0, 397)}...` : e.text } : {}),
      },
    ],
  }));
}

type LlmLexiconCheckConfig = {
  enableLlmLexiconCheck: boolean;
  mode: "weak_only" | "always";
  weakRuleThreshold: number;
  maxExtraLabels: number;
};

type SegmentCommentMode = "key_events" | "per_segment";
type PsychMode = "default" | "full_psycho_analytics";

function readLlmLexiconCheckConfig(config: Record<string, unknown>): LlmLexiconCheckConfig {
  const enableLlmLexiconCheck = config.enableLlmLexiconCheck === true;
  const mode = config.llmLexiconCheckMode === "always" ? "always" : "weak_only";
  const weakRuleThreshold = clampFloat(config.weakRuleThreshold, 0.6, 0.05, 0.95);
  const maxExtraLabels = clampInt(config.maxExtraLabels, 2, 0, 6);
  return { enableLlmLexiconCheck, mode, weakRuleThreshold, maxExtraLabels };
}

function readSegmentCommentMode(config: Record<string, unknown>): SegmentCommentMode {
  return config.segmentCommentMode === "per_segment" ? "per_segment" : "key_events";
}

function readPsychMode(config: Record<string, unknown>): PsychMode {
  return config.psychMode === "full_psycho_analytics" ? "full_psycho_analytics" : "default";
}

function mergeRulesAndLlmLabels(
  ruleItems: PsychLabelItem[],
  llmItems: PsychLabelItem[],
  payload: PsychMatcherV1Payload,
  cfg: LlmLexiconCheckConfig,
): PsychLabelItem[] {
  const result: PsychLabelItem[] = ruleItems.map((item) => ({
    speakerId: item.speakerId,
    labels: item.labels.map((l) => ({ ...l, source: l.source ?? "rules" })),
    evidence: item.evidence.map((e) => ({ ...e })),
  }));
  const weakWindows = collectWeakWindows(payload, cfg.weakRuleThreshold);
  const byWindow = new Map<string, PsychLabelItem>();
  for (const item of result) {
    const e = item.evidence[0];
    if (!e) continue;
    byWindow.set(windowKey(item.speakerId, e.startSec, e.endSec), item);
  }

  for (const llm of llmItems) {
    for (const ev of llm.evidence) {
      const key = windowKey(llm.speakerId, ev.startSec, ev.endSec);
      const allowed = cfg.mode === "always" || weakWindows.has(key);
      if (!allowed) continue;
      let target = byWindow.get(key);
      if (!target) {
        target = { speakerId: llm.speakerId, labels: [], evidence: [{ ...ev }] };
        result.push(target);
        byWindow.set(key, target);
      }
      let addedExtras = 0;
      for (const l of llm.labels) {
        const code = typeof l.code === "string" ? l.code.trim() : "";
        if (!code) continue;
        const existing = target.labels.find((x) => x.code === code);
        if (existing) {
          existing.score = Math.max(existing.score ?? 0, l.score ?? 0);
          existing.source = existing.source === "rules" ? "mixed" : existing.source ?? "mixed";
          if (typeof l.agreeWithRuleEngine === "boolean") existing.agreeWithRuleEngine = l.agreeWithRuleEngine;
          if (typeof l.reason === "string" && l.reason.trim()) existing.reason = l.reason.trim();
          continue;
        }
        if (addedExtras >= cfg.maxExtraLabels) continue;
        target.labels.push({
          code,
          ...(typeof l.score === "number" && Number.isFinite(l.score) ? { score: l.score } : {}),
          source: "llm",
          ...(typeof l.agreeWithRuleEngine === "boolean" ? { agreeWithRuleEngine: l.agreeWithRuleEngine } : {}),
          ...(typeof l.reason === "string" && l.reason.trim() ? { reason: l.reason.trim() } : {}),
        });
        addedExtras += 1;
      }
    }
  }
  return result;
}

function collectWeakWindows(payload: PsychMatcherV1Payload, threshold: number): Set<string> {
  const weak = new Set<string>();
  for (const e of payload.entries) {
    if (e.score < threshold) weak.add(windowKey(e.speakerId, e.startSec, e.endSec));
  }
  return weak;
}

function windowKey(speakerId: string, startSec: number, endSec: number): string {
  return `${speakerId}|${startSec.toFixed(2)}|${endSec.toFixed(2)}`;
}

function buildGenericUnionOutput(
  task: LlmTask,
  output: Record<string, unknown>,
  artifacts: ArtifactStore,
  baseProducer: { moduleId: ModuleId; runId: string; stepId: string },
  now: string,
): Partial<ArtifactStore> {
  const emptySummary = { text: "" };
  const emptyChecklist: unknown[] = [];
  const emptyPsychLabels: unknown[] = [];
  const emptyPsychNarrative = { interpretationPolicy: "assistive_non_diagnostic", text: "" };

  const summaryData =
    task === "summary"
      ? { text: pickBestString(output, ["text", "summary", "content", "preview"]) }
      : emptySummary;

  const checklistData =
    task === "checklist_analysis"
      ? withChecklistFallback(pickBestArray(output, ["checklistResults", "items", "results"]), artifacts)
      : emptyChecklist;

  const psychLabelsData =
    task === "psych_state" ? pickBestArray(output, ["labels", "psychLabels", "psych_labels"]) : emptyPsychLabels;

  const psychNarrativeData =
    task === "psych_state"
      ? { interpretationPolicy: "assistive_non_diagnostic", text: pickBestString(output, ["text", "narrative", "preview"]) }
      : emptyPsychNarrative;

  const speakerOnly = task === "speaker_names";

  const result: Partial<ArtifactStore> = {};

  if (speakerOnly) {
    Object.assign(result, buildSpeakerIdentityOutput(output, baseProducer, now));
    return result;
  }

  const shouldWriteSummary = task === "summary" || artifacts.SUMMARY_TEXT?.status !== "ready";
  if (shouldWriteSummary) {
    result.SUMMARY_TEXT = {
      type: "SUMMARY_TEXT",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: {},
      data: summaryData,
      createdAt: now,
    };
  }

  const shouldWriteChecklist = task === "checklist_analysis" || artifacts.CHECKLIST_RESULTS?.status !== "ready";
  if (shouldWriteChecklist) {
    result.CHECKLIST_RESULTS = {
      type: "CHECKLIST_RESULTS",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: {},
      data: checklistData,
      createdAt: now,
    };
  }

  const shouldWritePsychLabels = task === "psych_state" || artifacts.PSYCH_LABELS?.status !== "ready";
  if (shouldWritePsychLabels) {
    result.PSYCH_LABELS = {
      type: "PSYCH_LABELS",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: {},
      data: psychLabelsData,
      createdAt: now,
    };
  }

  const shouldWritePsychNarrative = task === "psych_state" || artifacts.PSYCH_NARRATIVE?.status !== "ready";
  if (shouldWritePsychNarrative) {
    result.PSYCH_NARRATIVE = {
      type: "PSYCH_NARRATIVE",
      status: "ready",
      version: "v1",
      producer: baseProducer,
      quality: {},
      explainability: [],
      data: psychNarrativeData,
      createdAt: now,
    };
  }

  return result;
}

function withChecklistFallback(data: unknown[], artifacts: ArtifactStore): unknown[] {
  if (Array.isArray(data) && data.length > 0) return data;
  const def = artifacts.CHECKLIST_DEFINITION;
  const itemsRaw =
    def?.status === "ready" &&
    def.data &&
    typeof def.data === "object" &&
    Array.isArray((def.data as { items?: unknown[] }).items)
      ? ((def.data as { items: unknown[] }).items ?? [])
      : [];
  if (itemsRaw.length === 0) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const it of itemsRaw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const itemId = typeof o.id === "string" ? o.id.trim() : "";
    const itemText = typeof o.label === "string" ? o.label.trim() : "";
    if (!itemId || !itemText) continue;
    const priority =
      o.priority === "critical" || o.priority === "important" || o.priority === "optional"
        ? o.priority
        : "important";
    out.push({
      itemId,
      itemText,
      status: "uncertain",
      priority,
      comment: "LLM не вернула структурированный ответ по пункту; нужна повторная проверка.",
      evidence: [],
    });
  }
  return out;
}

/** Промпты из `step.config` на подзадачах и fallback-пульте. */
export function mergeEmbeddedConfigIntoInstructionArtifact(
  store: ArtifactStore,
  engineId: ModuleId,
  config: Record<string, unknown>,
  stepId: string,
  runId: string,
): ArtifactStore {
  const extra: LlmInstructionPart[] = [];
  const instructionFromConfig = (): { intent: string; prompt: string } | null => {
    const promptRaw = typeof config.instructionPrompt === "string" ? config.instructionPrompt.trim() : "";
    if (promptRaw.length === 0 || isLikelyBrokenPrompt(promptRaw)) return null;
    const intentRaw = typeof config.instructionIntent === "string" ? config.instructionIntent.trim() : "";
    return {
      intent: intentRaw.length > 0 ? intentRaw : "summary",
      prompt: promptRaw,
    };
  };

  if (engineId === "LLM_TASK_SUMMARY") {
    const fromConfig = instructionFromConfig();
    if (fromConfig) {
      extra.push({
        stepId,
        moduleId: "LLM_TASK_SUMMARY",
        intent: fromConfig.intent,
        prompt: fromConfig.prompt,
      });
    }
  }
  if (engineId === "LLM_TASK_PSYCH") {
    const fromConfig = instructionFromConfig();
    extra.push({
      stepId,
      moduleId: "LLM_TASK_PSYCH",
      intent: fromConfig?.intent ?? "psych_state",
      prompt: fromConfig?.prompt ?? defaultPsychInstructionPrompt(config, store),
    });
  }
  if (engineId === "LLM_TASK_CHECKLIST") {
    const fromConfig = instructionFromConfig();
    extra.push({
      stepId,
      moduleId: "LLM_TASK_CHECKLIST",
      intent: fromConfig?.intent ?? "checklist_analysis",
      prompt: fromConfig?.prompt ?? defaultChecklistInstructionPrompt(),
    });
  }
  if (engineId === "LLM_TASK_SPEAKER_NAMES") {
    const prompt = typeof config.speakerNamePrompt === "string" ? config.speakerNamePrompt.trim() : "";
    const basePrompt =
      prompt.length > 0 && !isLikelyBrokenPrompt(prompt) ? prompt : defaultSpeakerNamesPrompt();
    const hintsBlock = buildSpeakerNamePreHints(store);
    const effectivePrompt = hintsBlock ? `${basePrompt}\n\n${hintsBlock}` : basePrompt;
    extra.push({
      stepId,
      moduleId: "LLM_TASK_SPEAKER_NAMES",
      intent: "speaker_names",
      prompt: effectivePrompt,
    });
  }

  if (!extra.length) return store;

  const mergedData = mergeLlmInstructionsData(store.LLM_INSTRUCTIONS?.data, { parts: extra });
  const prev = store.LLM_INSTRUCTIONS;
  return {
    ...store,
    LLM_INSTRUCTIONS: {
      type: "LLM_INSTRUCTIONS",
      status: "ready",
      version: "v1",
      producer: prev?.producer ?? { moduleId: engineId, stepId, runId },
      quality: prev?.quality ?? {},
      data: mergedData,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
    },
  };
}

const LLM_DATA_FALLBACK_TYPES: ArtifactTypeId[] = [
  "READY_SPEAKERS",
  "ENRICHED_TRANSCRIPT",
  "TRANSCRIPT_SEGMENTS",
  "SPEAKER_SEGMENTS",
  "TEXT",
  "CHECKLIST_DEFINITION",
  "SPEAKER_IDENTITY_MAP",
  "LLM_PSYCH_LABELS",
  "LLM_PSYCH_NARRATIVE",
  "LLM_PSYCH_FULL_V1",
  "PSYCH_LABELS",
  "PSYCH_NARRATIVE",
];

export function buildArtifactsForLlmGateway(
  full: ArtifactStore,
  scenario: Scenario | undefined,
  llmStepId: string,
  task: LlmTask,
  config: Record<string, unknown>,
): ArtifactStore {
  if (!scenario) {
    return full;
  }

  const incoming = scenario.edges.filter((e) => e.toStepId === llmStepId);
  const subData = gatherInboundArtifactsForStep(full, scenario, llmStepId, {
    excludeEdgeTypes: ["LLM_INSTRUCTIONS", "LLM_SUBTASK"],
  });

  const out: ArtifactStore = {};
  for (const [k, env] of Object.entries(subData)) {
    if (!env) continue;
    out[k as ArtifactTypeId] = env;
  }
  if (task === "psych_state") {
    const isFullPsychMode = config.psychMode === "full_psycho_analytics";
    const enriched = out.ENRICHED_TRANSCRIPT ?? full.ENRICHED_TRANSCRIPT;
    if (enriched) out.ENRICHED_TRANSCRIPT = enriched;
    const speakerMap = out.SPEAKER_IDENTITY_MAP ?? full.SPEAKER_IDENTITY_MAP;
    if (speakerMap) out.SPEAKER_IDENTITY_MAP = speakerMap;
    const structured = out.STRUCTURED_FEATURES ?? full.STRUCTURED_FEATURES;
    if (structured) out.STRUCTURED_FEATURES = structured;
    if (!out.PSYCH_LABELS && full.PSYCH_LABELS?.status === "ready") {
      out.PSYCH_LABELS = full.PSYCH_LABELS;
    }

    const psychLabels = out.PSYCH_LABELS ?? full.PSYCH_LABELS;
    const pdata = psychLabels?.data;
    if (
      !isFullPsychMode &&
      psychLabels?.status === "ready" &&
      pdata &&
      typeof pdata === "object" &&
      !Array.isArray(pdata) &&
      (pdata as Record<string, unknown>).kind === "psych_matcher_v1" &&
      out.ENRICHED_TRANSCRIPT?.status === "ready" &&
      out.ENRICHED_TRANSCRIPT.data &&
      typeof out.ENRICHED_TRANSCRIPT.data === "object"
    ) {
      const d = out.ENRICHED_TRANSCRIPT.data as Record<string, unknown>;
      const segs = Array.isArray(d.segments) ? d.segments : [];
      out.ENRICHED_TRANSCRIPT = {
        ...out.ENRICHED_TRANSCRIPT,
        data: {
          kind: d.kind ?? "prosody_enriched_transcript",
          sampleRate: d.sampleRate,
          globalTempoBpm: d.globalTempoBpm,
          segmentCount: segs.length,
          omittedSegmentsForSmallLlm: true,
        },
      };
    }
  } else {
    if (Object.keys(out).length === 0) {
      for (const t of LLM_DATA_FALLBACK_TYPES) {
        const env = full[t];
        if (env) out[t] = env;
      }
    }
    if (!out.SPEAKER_IDENTITY_MAP && full.SPEAKER_IDENTITY_MAP?.status === "ready") {
      out.SPEAKER_IDENTITY_MAP = full.SPEAKER_IDENTITY_MAP;
    }
  }

  // Canonical timeline for business LLM tasks is READY_SPEAKERS.
  // If READY exists in full store and was not wired explicitly, still provide it as fallback context.
  if (!out.READY_SPEAKERS && full.READY_SPEAKERS?.status === "ready") {
    out.READY_SPEAKERS = full.READY_SPEAKERS;
  }

  const wiredInstructionSteps = new Set(
    incoming.filter((e) => e.artifactTypeId === "LLM_INSTRUCTIONS").map((e) => e.fromStepId),
  );

  const disabledRaw = config.llmDisabledPromptStepIds;
  const disabled = new Set(
    Array.isArray(disabledRaw) ? disabledRaw.filter((x): x is string => typeof x === "string") : [],
  );

  const fullInst = full.LLM_INSTRUCTIONS;
  if (fullInst && wiredInstructionSteps.size > 0) {
    const allParts = parseLlmInstructionParts(fullInst.data);
    const filteredParts = allParts.filter(
      (p) => wiredInstructionSteps.has(p.stepId) && !disabled.has(p.stepId),
    );
    if (filteredParts.length > 0) {
      out.LLM_INSTRUCTIONS = {
        ...fullInst,
        data: { parts: filteredParts },
      };
    }
  }

  return out;
}

function defaultPsychInstructionPrompt(config: Record<string, unknown>, artifacts?: ArtifactStore): string {
  if (readPsychMode(config) === "full_psycho_analytics") {
    const combinationsBlock = formatPsychFullCombinationsPromptBlock(artifacts);
    return [
      "Ответ СТРОГО JSON, без markdown и без пояснений.",
      "Режим full_psycho_analytics: верни объект LlmPsychFullV1.",
      "Используй READY_SPEAKERS как канонический таймлайн и ENRICHED_TRANSCRIPT как источник метрик.",
      "Каждый эмоциональный/поведенческий вывод подтверждай evidence: минимум 2 метрики из одной комбинации.",
      "Используй только реальные метрики и направления, не выдумывай значения.",
      "Строго соблюдай ограничения DoNotInfer/Caveats и обязательный ассистивный дисклеймер.",
      "",
      "Сегментация таймлайна (обязательно):",
      "phases: 3–6 непересекающихся интервалов по времени; вместе покрывают всю встречу от начала первой реплики до конца последней в READY_SPEAKERS без дыр и наложений (каждая секунда ровно в одной фазе). Если длительность встречи >60 с — запрещена одна фаза на всю длину.",
      "episodes: минимум 3 эпизода; дополнительно не меньше min(6, число реплик в READY_SPEAKERS), если встреча ≥30 с. Для встречи <30 с допустимо меньше с явным пояснением в globalCommentary. Если в READY_SPEAKERS ≥3 реплик — запрещён эпизод, покрывающий >70% длительности встречи.",
      "episodes[].segmentIds: идентификаторы реплик из payload (поля id или segmentId в READY_SPEAKERS / ENRICHED_TRANSCRIPT.segments, если есть), не подставляй только speaker_XX вместо сегмента; если стабильного id нет — используй строки ready_0…ready_N-1 по порядку строк в READY_SPEAKERS. У каждого эпизода минимум один segment id.",
      "У каждого эпизода phaseId указывает фазу, где лежит основная часть эпизода по времени; в phases[].keyEpisodes перечисли episodeId эпизодов этой фазы.",
      "Дроби по смене темы, тактики взаимодействия, напряжения/тона или ведущего спикера по импульсу (метрики ENRICHED_TRANSCRIPT); при сомнении делай больше коротких эпизодов, а не один длинный.",
      "Таймкоды в phases и episodes: поля startTimeSec и endTimeSec (допустимы синонимы startSec и endSec — значения в секундах).",
      "",
      combinationsBlock,
      "",
      "Верни объект формата:",
      "{\"phases\":[{\"phaseId\":\"phase_1\",\"phaseName\":\"...\",\"startTimeSec\":0,\"endTimeSec\":0,\"phaseSummary\":\"...\",\"emotionalProfile\":\"...\",\"keyTopics\":[],\"keyEpisodes\":[],\"evidence\":[]}],\"episodes\":[{\"episodeId\":\"ep_1\",\"segmentIds\":[],\"speakers\":[],\"startTimeSec\":0,\"endTimeSec\":0,\"episodeSummary\":\"...\",\"localImpact\":\"...\",\"narrativeCommentary\":\"...\",\"phaseId\":\"phase_1\",\"evidence\":[]}],\"participants\":[{\"speakerId\":\"speaker_00\",\"trajectory\":\"...\",\"reactionsToCriticism\":\"...\",\"behaviorStrategy\":\"...\",\"keyPhases\":[],\"keyEpisodes\":[],\"evidence\":[]}],\"globalCommentary\":\"...\",\"disclaimers\":[\"Все интерпретации являются статистическими тенденциями, а не индивидуальными диагнозами.\"]}",
    ].join("\n");
  }
  return [
    "Ответ СТРОГО JSON, без markdown и без пояснений.",
    "Числовые паттерны prosody уже вычислены в артефакте PSYCH_LABELS (kind=psych_matcher_v1).",
    "Если config.enableLlmLexiconCheck=true: проверь пограничные сегменты и верни labels c source/agreeWithRuleEngine/reason.",
    "Если config.enableLlmLexiconCheck=false: labels не заполняй (верни пустой массив), делай только narrative.",
    "Если config.segmentCommentMode='per_segment': заполни narrative.segmentComments по каждому сегменту READY_SPEAKERS (1 комментарий на 1 сегмент, с теми же speakerId/startSec/endSec).",
    "Используй narrativeHints внутри PSYCH_LABELS (interpretation, behavioralHint, caveats, doNotInfer) как ограничения: не придумывай диагнозы.",
    "",
    "Верни объект с ключами labels и narrative:",
    "{\"labels\":[{\"speakerId\":\"speaker_00\",\"evidence\":[{\"startSec\":12.3,\"endSec\":18.9,\"quote\":\"...\"}],\"labels\":[{\"code\":\"initiative_takeover\",\"score\":0.72,\"source\":\"mixed\",\"agreeWithRuleEngine\":true,\"reason\":\"...\"}]}],\"narrative\":{\"interpretationPolicy\":\"assistive_non_diagnostic\",\"text\":\"...\",\"timelineEvents\":[{\"startSec\":12.3,\"endSec\":18.9,\"summary\":\"...\",\"actors\":[\"speaker_00\"],\"tensionDelta\":\"up\"}],\"segmentComments\":[{\"speakerId\":\"speaker_00\",\"startSec\":12.3,\"endSec\":18.9,\"summary\":\"...\",\"tensionDelta\":\"up\",\"patternIds\":[\"initiative_takeover\"],\"confidence\":0.72}]}}",
    "Требования:",
    "- text обязателен (связный нарратив по сессии).",
    "- timelineEvents обязателен и не пустой; каждый эпизод должен опираться на таймкоды и patternId из PSYCH_LABELS.entries / готовых меток (не выдумывай новые типы поведения).",
    "- Для segmentComments (если config.segmentCommentMode='per_segment'): обязателен комментарий на каждый сегмент READY_SPEAKERS.",
    "- Для labels: source только rules|llm|mixed, score в диапазоне 0..1.",
    "",
    "Источник текста и цитат — READY_SPEAKERS (канонический таймлайн). Если есть SPEAKER_IDENTITY_MAP — используй displayName в narrative.text, но actors оставляй speakerId.",
    "Если в payload сегменты ENRICHED_TRANSCRIPT опущены для экономии токенов — опирайся на PSYCH_LABELS и READY_SPEAKERS.",
  ].join("\n");
}

type FullMetricEvidence = {
  metricName: string;
  direction: "↑" | "↓" | "→" | "↑↑" | "↓↓";
  value?: number;
  comment: string;
};

type FullCombinationEvidence = {
  combinationId: string;
  dictionaryRef?: string;
  metrics: FullMetricEvidence[];
  confirmedByENR: boolean;
  caveats: string[];
};

type FullEpisodeAnalysis = {
  episodeId: string;
  segmentIds: string[];
  speakers: string[];
  startTimeSec: number;
  endTimeSec: number;
  episodeSummary: string;
  localImpact: string;
  narrativeCommentary: string;
  phaseId?: string;
  evidence: FullCombinationEvidence[];
};

type FullPhaseAnalysis = {
  phaseId: string;
  phaseName: string;
  startTimeSec: number;
  endTimeSec: number;
  phaseSummary: string;
  emotionalProfile: string;
  keyTopics: string[];
  keyEpisodes: string[];
  evidence: FullCombinationEvidence[];
};

type FullParticipantAnalysis = {
  speakerId: string;
  trajectory: string;
  reactionsToCriticism: string;
  behaviorStrategy: string;
  keyPhases: string[];
  keyEpisodes: string[];
  evidence: FullCombinationEvidence[];
};

type LlmPsychFullV1 = {
  phases: FullPhaseAnalysis[];
  episodes: FullEpisodeAnalysis[];
  participants: FullParticipantAnalysis[];
  globalCommentary: string;
  disclaimers: string[];
};

type PsychLabelItem = {
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

type PsychNarrativeData = {
  interpretationPolicy: "assistive_non_diagnostic";
  text: string;
  timelineEvents: Array<{
    startSec: number;
    endSec: number;
    summary: string;
    actors?: string[];
    tensionDelta?: "up" | "down" | "flat";
  }>;
  segmentComments?: PsychSegmentComment[];
  partial?: boolean;
};

type PsychSegmentComment = {
  speakerId: string;
  startSec: number;
  endSec: number;
  summary: string;
  tensionDelta?: "up" | "down" | "flat";
  patternIds?: string[];
  confidence?: number;
  isFallback?: boolean;
};

function parseStructuredPsychOutput(output: Record<string, unknown>): {
  labels: PsychLabelItem[];
  narrative: PsychNarrativeData;
  labelsWarnings: string[];
  narrativeWarnings: string[];
} {
  const labelsWarnings: string[] = [];
  const narrativeWarnings: string[] = [];
  const src = extractPsychRoot(output);
  const rawLabels = Array.isArray((src as { labels?: unknown }).labels)
    ? ((src as { labels: unknown[] }).labels ?? [])
    : pickBestArray(output, ["labels", "psychLabels", "psych_labels"]);
  const labels = normalizePsychLabels(rawLabels);
  if (rawLabels.length > 0 && labels.length === 0) {
    labelsWarnings.push("psych_labels_rejected_invalid_contract");
  }

  const narrative = normalizePsychNarrative(src, output);
  if (narrative.partial) {
    narrativeWarnings.push("psych_narrative_partial_missing_timeline_events");
  }
  return { labels, narrative, labelsWarnings, narrativeWarnings };
}

function extractPsychRoot(output: Record<string, unknown>): Record<string, unknown> {
  if (output.narrative && typeof output.narrative === "object") return output;
  const txt = pickBestString(output, ["text", "content", "preview"]);
  const json = tryParseJsonObject(txt);
  if (json) return json;
  return output;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(t.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function normalizePsychLabels(raw: unknown[]): PsychLabelItem[] {
  const out: PsychLabelItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId.trim() : "";
    if (!speakerId) continue;
    const labelsRaw = Array.isArray(o.labels) ? o.labels : [];
    const labels: Array<{ code: string; score?: number }> = [];
    for (const lr of labelsRaw) {
      if (typeof lr === "string" && lr.trim()) {
        labels.push({ code: lr.trim() });
        continue;
      }
      if (!lr || typeof lr !== "object") continue;
      const lo = lr as Record<string, unknown>;
      const code = typeof lo.code === "string" ? lo.code.trim() : "";
      if (!code) continue;
      const score = typeof lo.score === "number" && Number.isFinite(lo.score) ? lo.score : undefined;
      const source =
        lo.source === "rules" || lo.source === "llm" || lo.source === "mixed"
          ? lo.source
          : undefined;
      const agreeWithRuleEngine =
        typeof lo.agreeWithRuleEngine === "boolean" ? lo.agreeWithRuleEngine : undefined;
      const reason = typeof lo.reason === "string" && lo.reason.trim() ? lo.reason.trim() : undefined;
      labels.push({
        code,
        ...(score != null ? { score } : {}),
        ...(source ? { source } : {}),
        ...(agreeWithRuleEngine !== undefined ? { agreeWithRuleEngine } : {}),
        ...(reason ? { reason } : {}),
      });
    }
    const evidenceRaw = Array.isArray(o.evidence) ? o.evidence : [];
    const evidence: Array<{ startSec: number; endSec: number; quote?: string }> = [];
    for (const er of evidenceRaw) {
      if (!er || typeof er !== "object") continue;
      const eo = er as Record<string, unknown>;
      const startSec = toNum(eo.startSec);
      const endSec = toNum(eo.endSec);
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec) continue;
      const quote = typeof eo.quote === "string" && eo.quote.trim() ? eo.quote.trim() : undefined;
      evidence.push({ startSec, endSec, ...(quote ? { quote } : {}) });
    }
    if (labels.length === 0 || evidence.length === 0) continue;
    out.push({ speakerId, labels, evidence });
  }
  return out;
}

function normalizePsychNarrative(
  src: Record<string, unknown>,
  fallback: Record<string, unknown>,
): PsychNarrativeData {
  const narrativeObj =
    src.narrative && typeof src.narrative === "object"
      ? (src.narrative as Record<string, unknown>)
      : src;
  const text = pickBestString(narrativeObj, ["text", "summary", "narrative"]) || pickBestString(fallback, ["text", "content"]);
  const timelineRaw = Array.isArray(narrativeObj.timelineEvents) ? narrativeObj.timelineEvents : [];
  const segmentCommentsRaw = Array.isArray(narrativeObj.segmentComments) ? narrativeObj.segmentComments : [];
  const timelineEvents: PsychNarrativeData["timelineEvents"] = [];
  const segmentComments: PsychSegmentComment[] = [];
  for (const tr of timelineRaw) {
    if (!tr || typeof tr !== "object") continue;
    const t = tr as Record<string, unknown>;
    const startSec = toNum(t.startSec);
    const endSec = toNum(t.endSec);
    const summary = typeof t.summary === "string" ? t.summary.trim() : "";
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec || !summary) continue;
    const actors = Array.isArray(t.actors) ? t.actors.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : undefined;
    const tensionDelta =
      t.tensionDelta === "up" || t.tensionDelta === "down" || t.tensionDelta === "flat"
        ? t.tensionDelta
        : undefined;
    timelineEvents.push({
      startSec,
      endSec,
      summary,
      ...(actors && actors.length > 0 ? { actors } : {}),
      ...(tensionDelta ? { tensionDelta } : {}),
    });
  }
  for (const rawComment of segmentCommentsRaw) {
    if (!rawComment || typeof rawComment !== "object") continue;
    const c = rawComment as Record<string, unknown>;
    const speakerId = typeof c.speakerId === "string" ? c.speakerId.trim() : "";
    const startSec = toNum(c.startSec);
    const endSec = toNum(c.endSec);
    const summary = typeof c.summary === "string" ? c.summary.trim() : "";
    if (!speakerId || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec || !summary) continue;
    const tensionDelta =
      c.tensionDelta === "up" || c.tensionDelta === "down" || c.tensionDelta === "flat"
        ? c.tensionDelta
        : undefined;
    const patternIds = Array.isArray(c.patternIds)
      ? c.patternIds
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
      : [];
    const confidence = typeof c.confidence === "number" && Number.isFinite(c.confidence) ? clampFloat(c.confidence, 0.5, 0, 1) : undefined;
    segmentComments.push({
      speakerId,
      startSec,
      endSec,
      summary,
      ...(tensionDelta ? { tensionDelta } : {}),
      ...(patternIds.length > 0 ? { patternIds } : {}),
      ...(confidence != null ? { confidence } : {}),
    });
  }
  return {
    interpretationPolicy: "assistive_non_diagnostic",
    text: text || "Психологический нарратив не получен.",
    timelineEvents,
    ...(segmentComments.length > 0 ? { segmentComments } : {}),
    ...(timelineEvents.length === 0 ? { partial: true } : {}),
  };
}

function fillMissingSegmentComments(
  narrative: PsychNarrativeData,
  artifacts: ArtifactStore,
  labels: PsychLabelItem[],
): PsychNarrativeData {
  const readySegments = extractReadySpeakerWindows(artifacts);
  if (readySegments.length === 0) return narrative;
  const byKey = new Map<string, PsychSegmentComment>();
  for (const c of narrative.segmentComments ?? []) {
    byKey.set(windowKey(c.speakerId, c.startSec, c.endSec), c);
  }
  const out: PsychSegmentComment[] = [];
  for (const seg of readySegments) {
    const key = windowKey(seg.speakerId, seg.startSec, seg.endSec);
    const existing = byKey.get(key);
    if (existing) {
      out.push(existing);
      continue;
    }
    out.push(buildFallbackSegmentComment(seg, labels));
  }
  return {
    ...narrative,
    segmentComments: out,
  };
}

function extractReadySpeakerWindows(
  artifacts: ArtifactStore,
): Array<{ speakerId: string; startSec: number; endSec: number; text: string }> {
  const raw = Array.isArray(artifacts.READY_SPEAKERS?.data) ? artifacts.READY_SPEAKERS?.data : [];
  const out: Array<{ speakerId: string; startSec: number; endSec: number; text: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" ? o.speakerId.trim() : "";
    const startSec = toNum(o.startTime);
    const endSec = toNum(o.endTime);
    if (!speakerId || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec) continue;
    out.push({
      speakerId,
      startSec,
      endSec,
      text: typeof o.text === "string" ? o.text.trim() : "",
    });
  }
  return out;
}

/** Post-parse hints when LLM output does not match segmentation rules from the psych prompt. */
function computePsychFullSegmentationWarnings(data: LlmPsychFullV1, artifacts: ArtifactStore): string[] {
  const warnings: string[] = [];
  const segs = extractReadySpeakerWindows(artifacts);
  const readyCount = segs.length;
  let sessionDurationSec = 0;
  for (const s of segs) {
    sessionDurationSec = Math.max(sessionDurationSec, s.endSec);
  }

  const trivialSession = sessionDurationSec > 0 && sessionDurationSec < 30;

  if (!trivialSession && sessionDurationSec > 60) {
    if (data.phases.length < 3) {
      warnings.push("psych_full_phases_fewer_than_3");
    }
    if (data.phases.length === 1) {
      warnings.push("psych_full_single_phase_long_session");
    }
  }

  if (!trivialSession && readyCount > 0) {
    const expectedMin = Math.max(3, Math.min(6, readyCount));
    if (data.episodes.length < expectedMin) {
      warnings.push("psych_full_episodes_below_expected_min");
    }
  }

  if (readyCount >= 3 && sessionDurationSec > 0) {
    for (const ep of data.episodes) {
      const span = ep.endTimeSec - ep.startTimeSec;
      if (span > sessionDurationSec * 0.7) {
        warnings.push("psych_full_episode_covers_majority_duration");
        break;
      }
    }
  }

  return warnings;
}

function buildFallbackSegmentComment(
  seg: { speakerId: string; startSec: number; endSec: number; text: string },
  labels: PsychLabelItem[],
): PsychSegmentComment {
  const matchedCodes: string[] = [];
  let maxScore = 0;
  for (const item of labels) {
    if (item.speakerId !== seg.speakerId) continue;
    const overlaps = item.evidence.some((ev) => seg.startSec <= ev.endSec && ev.startSec <= seg.endSec);
    if (!overlaps) continue;
    for (const lab of item.labels) {
      if (!matchedCodes.includes(lab.code)) matchedCodes.push(lab.code);
      if (typeof lab.score === "number" && Number.isFinite(lab.score)) {
        maxScore = Math.max(maxScore, lab.score);
      }
    }
  }
  if (matchedCodes.length > 0) {
    return {
      speakerId: seg.speakerId,
      startSec: seg.startSec,
      endSec: seg.endSec,
      summary: `Сегмент помечен как ${matchedCodes.join(", ")}; оценка требует ассистивной интерпретации.`,
      patternIds: matchedCodes,
      ...(maxScore > 0 ? { confidence: clampFloat(maxScore, maxScore, 0, 1) } : {}),
      isFallback: true,
    };
  }
  return {
    speakerId: seg.speakerId,
    startSec: seg.startSec,
    endSec: seg.endSec,
    summary: "Явных психодинамических сдвигов в этом сегменте не обнаружено.",
    tensionDelta: "flat",
    confidence: 0.5,
    isFallback: true,
  };
}

function parsePsychFullOutput(output: Record<string, unknown>): { data: LlmPsychFullV1; warnings: string[] } {
  const warnings: string[] = [];
  const root = extractJsonRootFromOutput(output);
  const candidate =
    root.psychFull && typeof root.psychFull === "object" && !Array.isArray(root.psychFull)
      ? (root.psychFull as Record<string, unknown>)
      : root;
  const phases = normalizeFullPhases(Array.isArray(candidate.phases) ? candidate.phases : []);
  const episodes = normalizeFullEpisodes(Array.isArray(candidate.episodes) ? candidate.episodes : []);
  const participants = normalizeFullParticipants(Array.isArray(candidate.participants) ? candidate.participants : []);
  const globalCommentary =
    typeof candidate.globalCommentary === "string" && candidate.globalCommentary.trim()
      ? candidate.globalCommentary.trim()
      : "Динамика встречи проанализирована в ассистивном режиме.";
  const disclaimers =
    Array.isArray(candidate.disclaimers) && candidate.disclaimers.length > 0
      ? candidate.disclaimers
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
      : ["Все интерпретации являются статистическими тенденциями, а не индивидуальными диагнозами."];
  if (episodes.length === 0) warnings.push("psych_full_missing_episodes");
  if (phases.length === 0) warnings.push("psych_full_missing_phases");
  if (participants.length === 0) warnings.push("psych_full_missing_participants");
  return { data: { phases, episodes, participants, globalCommentary, disclaimers }, warnings };
}

/**
 * Модели часто путают контракт LlmPsychFullV1 и отдают startSec/endSec (как в narrative) вместо startTimeSec/endTimeSec.
 */
function pickPsychFullTimeRangeSec(o: Record<string, unknown>): { startTimeSec: number; endTimeSec: number } | null {
  const st = toNum(o.startTimeSec);
  const en = toNum(o.endTimeSec);
  if (Number.isFinite(st) && Number.isFinite(en) && en >= st) {
    return { startTimeSec: st, endTimeSec: en };
  }
  const ss = toNum(o.startSec);
  const es = toNum(o.endSec);
  if (Number.isFinite(ss) && Number.isFinite(es) && es >= ss) {
    return { startTimeSec: ss, endTimeSec: es };
  }
  return null;
}

function normalizeFullPhases(raw: unknown[]): FullPhaseAnalysis[] {
  const out: FullPhaseAnalysis[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const phaseId = pickBestString(o, ["phaseId", "phase_id", "id"]);
    const phaseName =
      pickBestString(o, ["phaseName", "name", "title", "label"]) || (phaseId ? phaseId : "");
    const range = pickPsychFullTimeRangeSec(o);
    if (!phaseId || !phaseName || !range) continue;
    const { startTimeSec, endTimeSec } = range;
    out.push({
      phaseId,
      phaseName,
      startTimeSec,
      endTimeSec,
      phaseSummary: typeof o.phaseSummary === "string" ? o.phaseSummary.trim() : "",
      emotionalProfile: typeof o.emotionalProfile === "string" ? o.emotionalProfile.trim() : "",
      keyTopics: Array.isArray(o.keyTopics) ? o.keyTopics.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      keyEpisodes: Array.isArray(o.keyEpisodes) ? o.keyEpisodes.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      evidence: normalizeCombinationEvidence(Array.isArray(o.evidence) ? o.evidence : []),
    });
  }
  return out;
}

function normalizeFullEpisodes(raw: unknown[]): FullEpisodeAnalysis[] {
  const out: FullEpisodeAnalysis[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    let episodeId = pickBestString(o, ["episodeId", "episode_id", "id"]);
    if (!episodeId && typeof o.id === "number" && Number.isFinite(o.id)) {
      episodeId = String(o.id);
    }
    const range = pickPsychFullTimeRangeSec(o);
    if (!episodeId || !range) continue;
    const { startTimeSec, endTimeSec } = range;
    const segmentIdsRaw = pickBestArray(o, ["segmentIds", "segment_ids", "segments"]);
    const phaseIdRef = pickBestString(o, ["phaseId", "phase_id"]);
    out.push({
      episodeId,
      segmentIds: segmentIdsRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0),
      speakers: Array.isArray(o.speakers) ? o.speakers.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      startTimeSec,
      endTimeSec,
      episodeSummary: typeof o.episodeSummary === "string" ? o.episodeSummary.trim() : "",
      localImpact: typeof o.localImpact === "string" ? o.localImpact.trim() : "",
      narrativeCommentary: typeof o.narrativeCommentary === "string" ? o.narrativeCommentary.trim() : "",
      ...(phaseIdRef ? { phaseId: phaseIdRef } : {}),
      evidence: normalizeCombinationEvidence(Array.isArray(o.evidence) ? o.evidence : []),
    });
  }
  return out;
}

function normalizeFullParticipants(raw: unknown[]): FullParticipantAnalysis[] {
  const out: FullParticipantAnalysis[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const speakerId = typeof o.speakerId === "string" && o.speakerId.trim() ? o.speakerId.trim() : "";
    if (!speakerId) continue;
    out.push({
      speakerId,
      trajectory: typeof o.trajectory === "string" ? o.trajectory.trim() : "",
      reactionsToCriticism: typeof o.reactionsToCriticism === "string" ? o.reactionsToCriticism.trim() : "",
      behaviorStrategy: typeof o.behaviorStrategy === "string" ? o.behaviorStrategy.trim() : "",
      keyPhases: Array.isArray(o.keyPhases) ? o.keyPhases.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      keyEpisodes: Array.isArray(o.keyEpisodes) ? o.keyEpisodes.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
      evidence: normalizeCombinationEvidence(Array.isArray(o.evidence) ? o.evidence : []),
    });
  }
  return out;
}

function normalizeCombinationEvidence(raw: unknown[]): FullCombinationEvidence[] {
  const out: FullCombinationEvidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const combinationId = typeof o.combinationId === "string" && o.combinationId.trim() ? o.combinationId.trim() : "";
    if (!combinationId) continue;
    const metrics = Array.isArray(o.metrics)
      ? o.metrics
          .map((m) => {
            if (!m || typeof m !== "object") return null;
            const mo = m as Record<string, unknown>;
            const metricName = typeof mo.metricName === "string" && mo.metricName.trim() ? mo.metricName.trim() : "";
            const direction =
              mo.direction === "↑" || mo.direction === "↓" || mo.direction === "→" || mo.direction === "↑↑" || mo.direction === "↓↓"
                ? mo.direction
                : null;
            const comment = typeof mo.comment === "string" ? mo.comment.trim() : "";
            if (!metricName || !direction || !comment) return null;
            const value = typeof mo.value === "number" && Number.isFinite(mo.value) ? mo.value : undefined;
            return { metricName, direction, ...(value !== undefined ? { value } : {}), comment };
          })
          .filter((m): m is FullMetricEvidence => m !== null)
      : [];
    if (metrics.length < 2) continue;
    out.push({
      combinationId,
      ...(typeof o.dictionaryRef === "string" && o.dictionaryRef.trim() ? { dictionaryRef: o.dictionaryRef.trim() } : {}),
      metrics,
      confirmedByENR: o.confirmedByENR !== false,
      caveats: Array.isArray(o.caveats) ? o.caveats.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [],
    });
  }
  return out;
}

/** Грубая эвристика для legacy narrative из full: иначе почти все таймлайн-события остаются без tone (только «ключевой момент»). */
function inferEpisodeTensionDelta(episode: FullEpisodeAnalysis): "up" | "down" | undefined {
  const blob = `${episode.narrativeCommentary} ${episode.episodeSummary} ${episode.localImpact}`.toLowerCase();
  if (/эскалац|напряж|конфликт|обостр|активиз|острен|тревог/.test(blob)) return "up";
  if (/спад|снижен|смягч|деэскалац|разрядк|остыв|притуш/.test(blob)) return "down";
  return undefined;
}

function deriveLegacyPsychFromFull(data: LlmPsychFullV1): PsychNarrativeData {
  const timelineEvents = data.episodes.slice(0, 48).map((episode) => {
    const td = inferEpisodeTensionDelta(episode);
    return {
      startSec: episode.startTimeSec,
      endSec: episode.endTimeSec,
      summary: episode.narrativeCommentary || episode.episodeSummary || episode.localImpact || "Эпизод встречи.",
      ...(episode.speakers.length > 0 ? { actors: episode.speakers } : {}),
      ...(td === "up" ? { tensionDelta: "up" as const } : td === "down" ? { tensionDelta: "down" as const } : {}),
    };
  });
  const segmentComments = data.episodes
    .flatMap((episode) => {
      const td = inferEpisodeTensionDelta(episode);
      const speakers =
        episode.speakers.length > 0
          ? episode.speakers
          : data.participants.length > 0
            ? data.participants.map((p) => p.speakerId)
            : [];
      return speakers.map((speakerId) => ({
        speakerId,
        startSec: episode.startTimeSec,
        endSec: episode.endTimeSec,
        summary: episode.episodeSummary || episode.localImpact || "Эпизодная динамика.",
        patternIds: episode.evidence.map((e) => e.combinationId),
        confidence: episode.evidence.every((e) => e.confirmedByENR) ? 0.8 : 0.6,
        ...(td ? { tensionDelta: td } : {}),
      }));
    })
    .slice(0, 96);
  return {
    interpretationPolicy: "assistive_non_diagnostic",
    text: data.globalCommentary || "Психологический нарратив не получен.",
    timelineEvents,
    ...(segmentComments.length > 0 ? { segmentComments } : {}),
    ...(timelineEvents.length === 0 ? { partial: true } : {}),
  };
}

function defaultSpeakerNamesPrompt(): string {
  return [
    "Ответ СТРОГО JSON, без markdown и без пояснений.",
    "Ты — аналитик транскрипций. Задача: определить человекочитаемые имена и роли каждого speakerId ТОЛЬКО по READY_SPEAKERS.",
    "",
    "АЛГОРИТМ (выполняй по порядку для каждого speakerId):",
    "1) Найди прямые обращения/именования (например: «Иван Петрович», «Александр»).",
    "2) Найди самопредставление («Меня зовут...», «Я — ...»).",
    "3) Найди косвенные ролевые маркеры (оператор, клиент, инженер, руководитель, менеджер, специалист).",
    "4) Если данных недостаточно: displayName = «Спикер N» (по порядку появления), role = «неизвестно». Это НЕ ошибка.",
    "",
    "Верни объект ТОЛЬКО такого формата:",
    "{\"entries\":[{\"speakerId\":\"speaker_00\",\"displayName\":\"Имя или Спикер 1\",\"role\":\"роль или неизвестно\",\"confidence\":0.85,\"evidence\":[{\"startSec\":12.3,\"endSec\":18.9,\"quote\":\"точная цитата\"}]}]}",
    "",
    "Требования контракта IDM:",
    "- entries: массив объектов.",
    "- speakerId обязателен.",
    "- displayName обязателен (если имя неизвестно: «Спикер N»).",
    "- role обязателен (минимум: «оператор», «клиент», «неизвестно»).",
    "- confidence обязателен: 0.9+ только при прямом именовании; 0.5–0.8 при косвенных признаках; 0.3–0.5 при fallback.",
    "- evidence: 1–2 цитаты с таймкодами; если оснований нет — пустой массив [].",
    "Не выдумывай факты. Если нет доказательств — используй fallback.",
  ].join("\\n");
}

function buildSpeakerNamePreHints(store: ArtifactStore): string {
  const art = store.READY_SPEAKERS;
  if (art?.status !== "ready" || !Array.isArray(art.data)) return "";
  const rows = art.data as Array<Record<string, unknown>>;
  if (rows.length === 0) return "";

  const roleWords = [
    "оператор",
    "клиент",
    "инженер",
    "руководитель",
    "менеджер",
    "специалист",
    "директор",
  ];
  const nameRe = /\b[А-ЯЁ][а-яё]{2,}\b/g;

  const bySpeaker = new Map<string, Array<{ kind: "name" | "role"; value: string; start: number; end: number; quote: string }>>();
  for (const raw of rows) {
    const speakerId = typeof raw.speakerId === "string" ? raw.speakerId.trim() : "";
    if (!speakerId) continue;
    const text = typeof raw.text === "string" ? raw.text : "";
    const start = toNum(raw.startTime);
    const end = toNum(raw.endTime);
    if (!text.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

    const arr = bySpeaker.get(speakerId) ?? [];
    const names = text.match(nameRe) ?? [];
    for (const n of names) {
      if (n.length < 3 || /^Спикер$/i.test(n)) continue;
      arr.push({ kind: "name", value: n, start, end, quote: text });
      break;
    }
    const lower = text.toLowerCase();
    for (const rw of roleWords) {
      if (lower.includes(rw)) {
        arr.push({ kind: "role", value: rw, start, end, quote: text });
        break;
      }
    }
    if (arr.length > 0) bySpeaker.set(speakerId, arr);
  }

  const lines: string[] = [];
  for (const [speakerId, hints] of bySpeaker) {
    const bestName = hints.find((h) => h.kind === "name");
    const bestRole = hints.find((h) => h.kind === "role");
    if (!bestName && !bestRole) continue;
    if (bestName) {
      lines.push(
        `- ${speakerId}: вероятное имя «${bestName.value}» (${bestName.start.toFixed(1)}–${bestName.end.toFixed(1)}), quote: ${truncateQuote(bestName.quote)}`,
      );
    }
    if (bestRole) {
      lines.push(
        `- ${speakerId}: вероятная роль «${bestRole.value}» (${bestRole.start.toFixed(1)}–${bestRole.end.toFixed(1)}), quote: ${truncateQuote(bestRole.quote)}`,
      );
    }
    if (lines.length >= 10) break;
  }

  if (lines.length === 0) return "";
  return [
    "ПОДСКАЗКИ (найдено программно, используй как гипотезы и проверь по READY_SPEAKERS):",
    ...lines,
  ].join("\n");
}

function truncateQuote(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= 120) return `«${t}»`;
  return `«${t.slice(0, 117)}...»`;
}

function extractJsonRootFromOutput(output: Record<string, unknown>): Record<string, unknown> {
  const txt = pickBestString(output, ["text", "content", "preview"]);
  const fromText = tryParseJsonObject(txt);
  if (fromText) return fromText;
  return output;
}

function defaultChecklistInstructionPrompt(): string {
  return [
    "Ответ СТРОГО на русском языке.",
    "Твоя задача: проверить, насколько аудиозапись/транскрипт соответствует пунктам чек-листа.",
    "",
    "Источник тем и критериев — ТОЛЬКО CHECKLIST_DEFINITION.items (если артефакт доступен).",
    "Ничего не придумывай сверх чек-листа. Для каждого пункта оцени наличие/качество раскрытия в транскрипте.",
    "",
    "Верни ТОЛЬКО JSON-массив checklistResults. По каждому пункту чек-листа верни объект:",
    "{\"itemId\":\"<id из чек-листа>\",\"itemText\":\"<label из чек-листа>\",\"status\":\"present|uncertain|absent\",\"priority\":\"critical|important|optional\",\"comment\":\"кратко почему\",\"evidence\":[{\"startSec\":0,\"endSec\":0,\"quote\":\"...\"}]}",
    "",
    "Правила доказательности:",
    "- Если status=present/uncertain — приложи 1–3 цитаты (quote) и таймкоды (startSec/endSec) из транскрипта.",
    "- Если status=absent — evidence оставь пустым массивом, а в comment напиши, чего именно не было.",
    "- Не используй слова speaker_XX как имена людей; если есть SPEAKER_IDENTITY_MAP — можно ссылаться «Имя (speaker_00)».",
  ].join("\\n");
}

function isLikelyBrokenPrompt(prompt: string): boolean {
  if (!prompt.trim()) return true;
  if (prompt.includes("�")) return true;
  const q = (prompt.match(/\?/g) ?? []).length;
  if (q >= 6 && q / Math.max(1, prompt.length) > 0.08) return true;
  return false;
}

/**
 * Укорачивает READY_SPEAKERS для бизнес-LLM (summary / checklist / speaker_names),
 * если включён optimizeForSmallContext — см. план long-session.
 */
function applyReadySpeakersCompactionForBusinessTasks(
  _task: LlmTask,
  config: Record<string, unknown>,
  artifacts: ArtifactStore,
): ArtifactStore {
  const rdy = artifacts.READY_SPEAKERS;
  if (!rdy || rdy.status !== "ready" || !Array.isArray(rdy.data)) {
    return artifacts;
  }
  const cap = clampInt(config.maxReadySegmentsForLlm, 120, 20, 600);
  const rows = rdy.data as unknown[];
  if (rows.length <= cap) {
    return artifacts;
  }
  const headN = Math.min(Math.max(1, Math.floor(cap / 2)), rows.length);
  const tailN = Math.min(cap - headN, Math.max(0, rows.length - headN));
  const picked =
    tailN <= 0 ? rows.slice(0, cap) : [...rows.slice(0, headN), ...rows.slice(rows.length - tailN)];
  const warn = `ready_speakers_truncated_for_llm:${String(rows.length)}->${String(picked.length)}`;
  const prevWarn = rdy.quality?.warnings ?? [];
  const out: ArtifactStore = { ...artifacts };
  out.READY_SPEAKERS = {
    ...rdy,
    quality: {
      ...rdy.quality,
      warnings: [...(Array.isArray(prevWarn) ? prevWarn : []), warn],
    },
    data: picked as typeof rdy.data,
  };
  return out;
}

export function applySmallContextCompaction(
  task: LlmTask,
  config: Record<string, unknown>,
  artifacts: ArtifactStore,
): ArtifactStore {
  if (!readBoolean(config.optimizeForSmallContext, false)) return artifacts;
  if (task === "summary" || task === "checklist_analysis" || task === "speaker_names") {
    return applyReadySpeakersCompactionForBusinessTasks(task, config, artifacts);
  }
  if (task !== "psych_state") return artifacts;

  const maxWindowsPerSpeaker = clampInt(config.maxWindowsPerSpeaker, 6, 2, 20);
  const maxQuotesTotal = clampInt(config.maxQuotesTotal, 12, 0, 40);
  const includeRawSegmentsTail = readBoolean(config.includeRawSegmentsTail, false);
  const granularity = readEnum(config.compactGranularity, ["coarse", "balanced", "fine"], "balanced");
  const targetContextTokens = clampInt(config.targetContextTokens, 2000, 512, 64000);
  const responseMaxTokens = clampInt(config.responseMaxTokens, 900, 200, 4000);
  const reserveTokensForOutputRatio = clampFloat(config.reserveTokensForOutputRatio, 0.35, 0.2, 0.6);

  const enrichedData =
    artifacts.ENRICHED_TRANSCRIPT?.status === "ready" && artifacts.ENRICHED_TRANSCRIPT.data
      ? artifacts.ENRICHED_TRANSCRIPT.data
      : null;
  const enrichedObj =
    enrichedData && typeof enrichedData === "object" ? (enrichedData as Record<string, unknown>) : null;
  const segmentsRaw = Array.isArray(enrichedObj?.segments)
    ? (enrichedObj?.segments as unknown[])
    : Array.isArray(artifacts.TRANSCRIPT_SEGMENTS?.data)
      ? (artifacts.TRANSCRIPT_SEGMENTS?.data as unknown[])
      : [];
  if (segmentsRaw.length === 0) return artifacts;

  type SegmentLite = {
    speakerId: string;
    startTime: number;
    endTime: number;
    text: string;
    charsPerSec?: number;
    rmsMeanDb?: number;
    zcrMean?: number;
    spectralCentroidMeanHz?: number;
    spectralRolloffMeanHz?: number;
  };

  const parsed: SegmentLite[] = [];
  for (const item of segmentsRaw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const startTime = toNum(s.startTime);
    const endTime = toNum(s.endTime);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) continue;
    parsed.push({
      speakerId: typeof s.speakerId === "string" && s.speakerId.trim() ? s.speakerId : "speaker_unknown",
      startTime,
      endTime,
      text: typeof s.text === "string" ? s.text : "",
      charsPerSec: toOptNum(s.charsPerSec),
      rmsMeanDb: toOptNum(s.rmsMeanDb),
      zcrMean: toOptNum(s.zcrMean),
      spectralCentroidMeanHz: toOptNum(s.spectralCentroidMeanHz),
      spectralRolloffMeanHz: toOptNum(s.spectralRolloffMeanHz),
    });
  }
  if (parsed.length === 0) return artifacts;

  const bySpeaker = new Map<string, SegmentLite[]>();
  for (const seg of parsed) {
    const arr = bySpeaker.get(seg.speakerId) ?? [];
    arr.push(seg);
    bySpeaker.set(seg.speakerId, arr);
  }

  const criticalWindows: Array<Record<string, unknown>> = [];
  const speakerProfiles: Array<Record<string, unknown>> = [];
  const topPerSpeaker = granularity === "coarse" ? Math.max(2, maxWindowsPerSpeaker - 2) : maxWindowsPerSpeaker;

  for (const [speakerId, rows] of bySpeaker.entries()) {
    rows.sort((a, b) => a.startTime - b.startTime);
    const totalDur = rows.reduce((acc, r) => acc + Math.max(0, r.endTime - r.startTime), 0);
    const cpsAvg = avg(rows.map((r) => r.charsPerSec));
    const rmsAvg = avg(rows.map((r) => r.rmsMeanDb));
    const zcrAvg = avg(rows.map((r) => r.zcrMean));
    speakerProfiles.push({
      speakerId,
      segmentCount: rows.length,
      totalDurationSec: round2(totalDur),
      avgCharsPerSec: round2(cpsAvg),
      avgRmsDb: round2(rmsAvg),
      avgZcr: round3(zcrAvg),
    });

    const scored = rows
      .map((r) => {
        const cps = Number.isFinite(r.charsPerSec) ? Math.abs((r.charsPerSec as number) - cpsAvg) : 0;
        const rms = Number.isFinite(r.rmsMeanDb) ? Math.abs((r.rmsMeanDb as number) - rmsAvg) : 0;
        const zcr = Number.isFinite(r.zcrMean) ? Math.abs((r.zcrMean as number) - zcrAvg) : 0;
        return { row: r, score: cps + rms * 0.08 + zcr * 2.5 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topPerSpeaker);
    for (const x of scored) {
      criticalWindows.push({
        speakerId,
        startTime: round2(x.row.startTime),
        endTime: round2(x.row.endTime),
        charsPerSec: round2(x.row.charsPerSec),
        rmsMeanDb: round2(x.row.rmsMeanDb),
        zcrMean: round3(x.row.zcrMean),
        textSnippet: x.row.text.slice(0, 220),
      });
    }
  }

  criticalWindows.sort((a, b) => (toNum((b as Record<string, unknown>).rmsMeanDb) || 0) - (toNum((a as Record<string, unknown>).rmsMeanDb) || 0));
  const trimmedWindows = criticalWindows.slice(0, Math.max(1, bySpeaker.size * topPerSpeaker));
  let quoteBudget = maxQuotesTotal;
  for (const w of trimmedWindows) {
    if (quoteBudget <= 0) {
      delete (w as Record<string, unknown>).textSnippet;
      continue;
    }
    const t = (w as Record<string, unknown>).textSnippet;
    if (typeof t === "string" && t.trim()) quoteBudget--;
  }

  const compactPayload = {
    kind: "prosody_compact_v1",
    mode: "small_context",
    compactGranularity: granularity,
    tokenBudget: {
      targetContextTokens,
      responseMaxTokens,
      reserveTokensForOutputRatio,
    },
    stats: {
      segmentCount: parsed.length,
      speakerCount: bySpeaker.size,
      source: artifacts.ENRICHED_TRANSCRIPT?.status === "ready" ? "ENRICHED_TRANSCRIPT" : "TRANSCRIPT_SEGMENTS",
      compactedAt: new Date().toISOString(),
    },
    speakerProfiles,
    criticalWindows: trimmedWindows,
    transcriptTail:
      includeRawSegmentsTail
        ? parsed.slice(-Math.min(parsed.length, 10)).map((s) => ({
            speakerId: s.speakerId,
            startTime: round2(s.startTime),
            endTime: round2(s.endTime),
            text: s.text.slice(0, 180),
          }))
        : [],
  };

  const producer = artifacts.ENRICHED_TRANSCRIPT?.producer ?? artifacts.TRANSCRIPT_SEGMENTS?.producer;
  const createdAt =
    artifacts.ENRICHED_TRANSCRIPT?.createdAt ?? artifacts.TRANSCRIPT_SEGMENTS?.createdAt ?? new Date().toISOString();
  const out: ArtifactStore = { ...artifacts };
  out.STRUCTURED_FEATURES = {
    type: "STRUCTURED_FEATURES",
    status: "ready",
    version: "v1",
    producer: producer ?? {
      moduleId: "LLM_PUPPET",
      stepId: "llm_compact",
      runId: "llm_compact",
    },
    quality: {
      warnings: ["small_context_compaction"],
    },
    data: compactPayload,
    createdAt,
  };
  if (!includeRawSegmentsTail) delete out.TRANSCRIPT_SEGMENTS;
  return out;
}

function readBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function readEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim().length > 0) return Number(v);
  return Number.NaN;
}

function toOptNum(v: unknown): number | undefined {
  const n = toNum(v);
  return Number.isFinite(n) ? n : undefined;
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(v as number) ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(v as number) ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function avg(values: Array<number | undefined>): number {
  const nums = values.filter((v): v is number => Number.isFinite(v as number));
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round2(v: number | undefined): number | undefined {
  if (!Number.isFinite(v as number)) return undefined;
  return Math.round((v as number) * 100) / 100;
}

function round3(v: number | undefined): number | undefined {
  if (!Number.isFinite(v as number)) return undefined;
  return Math.round((v as number) * 1000) / 1000;
}

function pickBestString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}

function pickBestArray(o: Record<string, unknown>, keys: string[]): unknown[] {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}
