import type { Scenario, ScenarioStep } from "../../types/pipeline.types";
import { isLlmTaskSatellite } from "./llm-orchestrator-modules";
import { readLlmRunOrder } from "./llm-run-order";

export function listSubtasksForPuppet(scenario: Scenario, puppetStepId: string): ScenarioStep[] {
  const byId = new Map(scenario.steps.map((s) => [s.id, s]));
  const fromIds = scenario.edges
    .filter((e) => e.toStepId === puppetStepId && e.artifactTypeId === "LLM_SUBTASK")
    .map((e) => e.fromStepId);
  const out: ScenarioStep[] = [];
  for (const id of fromIds) {
    const st = byId.get(id);
    if (st && isLlmTaskSatellite(st.moduleId)) out.push(st);
  }
  return out;
}

export function normalizeLlmSubtaskRunOrder(scenario: Scenario): Scenario {
  const puppetIds = scenario.steps.filter((s) => s.moduleId === "LLM_PUPPET").map((s) => s.id);
  if (puppetIds.length === 0) return scenario;
  const rankByStepId = new Map<string, number>();
  for (const puppetId of puppetIds) {
    const subtasks = listSubtasksForPuppet(scenario, puppetId);
    subtasks.sort((a, b) => {
      const da = readLlmRunOrder(a);
      const db = readLlmRunOrder(b);
      if (da !== db) return da - db;
      if (a.orderHint !== b.orderHint) return a.orderHint - b.orderHint;
      return a.id.localeCompare(b.id);
    });
    subtasks.forEach((s, idx) => rankByStepId.set(s.id, idx + 1));
  }
  if (rankByStepId.size === 0) return scenario;
  return {
    ...scenario,
    steps: scenario.steps.map((s) => {
      const rank = rankByStepId.get(s.id);
      if (!rank) return s;
      return { ...s, config: { ...s.config, llmRunOrder: rank } };
    }),
  };
}

export function hasInvalidLlmSubtaskRunOrder(scenario: Scenario): boolean {
  const puppetIds = scenario.steps.filter((s) => s.moduleId === "LLM_PUPPET").map((s) => s.id);
  for (const puppetId of puppetIds) {
    const subtasks = listSubtasksForPuppet(scenario, puppetId);
    if (subtasks.length <= 1) continue;
    const ranks = subtasks.map((s) => Math.round(readLlmRunOrder(s)));
    const uniq = new Set(ranks);
    if (uniq.size !== ranks.length) return true;
    const min = Math.min(...ranks);
    const max = Math.max(...ranks);
    if (min < 1 || max > subtasks.length) return true;
  }
  return false;
}
