import type { ArtifactStore } from "../../types/artifact.types";
import combinationsFile from "./data/psych_full_metric_combinations.v1.json";

export type PsychFullCombinationRow = {
  combinationId: string;
  metricNames: string[];
  label: string;
  summary: string;
};

type DictionaryFile = {
  version: string;
  supportedMetricKeys: string[];
  combinations: PsychFullCombinationRow[];
  metricNameAliasesFromExternalDocs?: Record<string, string>;
};

const file = combinationsFile as DictionaryFile;

const KNOWN_IDS = new Set(file.combinations.map((c) => c.combinationId));

/** Все канонические combinationId из JSON (для валидации ответа LLM). */
export function getKnownPsychFullCombinationIds(): ReadonlySet<string> {
  return KNOWN_IDS;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Собирает множество имён метрик, которые реально присутствуют как числа хотя бы в одном сегменте ENRICHED.
 */
export function collectPresentMetricKeysFromEnriched(artifacts: ArtifactStore | undefined): Set<string> {
  const out = new Set<string>();
  if (!artifacts?.ENRICHED_TRANSCRIPT?.data || !isRecord(artifacts.ENRICHED_TRANSCRIPT.data)) return out;
  const segs = artifacts.ENRICHED_TRANSCRIPT.data.segments;
  if (!Array.isArray(segs)) return out;
  for (const raw of segs) {
    if (!isRecord(raw)) continue;
    for (const key of file.supportedMetricKeys) {
      const v = raw[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        out.add(key);
      }
    }
  }
  return out;
}

/**
 * Оставляет только комбинации, обе метрики которых встречаются в сессии. Если множество пустое — возвращает полный список.
 */
export function filterCombinationsByPresentMetrics(present: Set<string>): PsychFullCombinationRow[] {
  if (present.size === 0) {
    return file.combinations;
  }
  return file.combinations.filter((c) => c.metricNames.every((m) => present.has(m)));
}

/**
 * Текстовый блок для промпта full_psycho_analytics: список разрешённых combinationId и краткие подписи.
 */
export function formatPsychFullCombinationsPromptBlock(artifacts: ArtifactStore | undefined): string {
  const present = collectPresentMetricKeysFromEnriched(artifacts);
  const rows = filterCombinationsByPresentMetrics(present);
  const lines: string[] = [
    `Словарь комбинаций метрик (версия ${file.version}, JSON psych_full_metric_combinations.v1).`,
    "В evidence[].combinationId используй ТОЛЬКО перечисленные ниже идентификаторы; в metrics[] укажи ровно две метрики из поля metricNames этой комбинации с направлениями ↑ ↓ → ↑↑ ↓↓ по сравнению с baseline спикера/сессии.",
    present.size > 0
      ? `Учитываются только пары, для которых обе метрики встречаются в ENRICHED_TRANSCRIPT сегментах этой сессии (найдено метрик: ${[...present].sort().join(", ")}). Всего комбинаций в подсказке: ${rows.length}.`
      : `Сегменты не проанализированы на набор ключей — перечислены все ${rows.length} поддерживаемых пар.`,
    "",
  ];
  for (const r of rows) {
    lines.push(`- ${r.combinationId}: ${r.label}. Метрики: ${r.metricNames.join(" × ")}. ${r.summary}`);
  }
  lines.push("");
  lines.push(`Полный перечень id одной строкой: ${rows.map((r) => r.combinationId).join(", ")}.`);
  return lines.join("\n");
}

type EvidenceWithId = { combinationId: string };

/** Предупреждения quality, если LLM вернула неизвестный combinationId. */
export function collectPsychFullUnknownCombinationWarnings(data: {
  phases: Array<{ evidence: EvidenceWithId[] }>;
  episodes: Array<{ evidence: EvidenceWithId[] }>;
  participants: Array<{ evidence: EvidenceWithId[] }>;
}): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const scan = (id: string) => {
    const t = id.trim();
    if (!t || KNOWN_IDS.has(t)) return;
    const w = `psych_full_unknown_combination_id:${t}`;
    if (seen.has(w)) return;
    seen.add(w);
    warnings.push(w);
  };
  for (const p of data.phases) {
    for (const e of p.evidence) scan(e.combinationId);
  }
  for (const ep of data.episodes) {
    for (const e of ep.evidence) scan(e.combinationId);
  }
  for (const part of data.participants) {
    for (const e of part.evidence) scan(e.combinationId);
  }
  return warnings;
}
