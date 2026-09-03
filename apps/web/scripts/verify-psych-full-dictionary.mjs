/**
 * Проверка целостности psych_full_metric_combinations.v1.json (без тест-раннера).
 * Запуск: node apps/web/scripts/verify-psych-full-dictionary.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonPath = join(__dirname, "../lib/pipeline/data/psych_full_metric_combinations.v1.json");
const raw = JSON.parse(readFileSync(jsonPath, "utf8"));

const supported = new Set(raw.supportedMetricKeys);
const ids = new Set();
let n = 0;
for (const c of raw.combinations) {
  n += 1;
  if (!c.combinationId || typeof c.combinationId !== "string") throw new Error("bad combinationId");
  if (ids.has(c.combinationId)) throw new Error(`duplicate ${c.combinationId}`);
  ids.add(c.combinationId);
  if (!Array.isArray(c.metricNames) || c.metricNames.length !== 2) {
    throw new Error(`bad metricNames for ${c.combinationId}`);
  }
  for (const m of c.metricNames) {
    if (!supported.has(m)) throw new Error(`unknown metric ${m} in ${c.combinationId}`);
  }
}

const expectedPairs = (supported.size * (supported.size - 1)) / 2;
if (n !== expectedPairs) {
  throw new Error(`expected ${expectedPairs} pairs, got ${n}`);
}

console.log(`OK: psych_full_metric_combinations.v1.json — ${n} комбинаций, версия ${raw.version}`);
