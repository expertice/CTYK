import type { Scenario, ScenarioStep } from "../../types/pipeline.types";

/**
 * Порядок шагов по рёбрам графа (топологическая сортировка).
 * При неполном графе или цикле — fallback на orderHint.
 */
export function orderedScenarioSteps(scenario: Scenario): ScenarioStep[] {
  const byId = new Map(scenario.steps.map((step) => [step.id, step]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of scenario.steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }
  for (const edge of scenario.edges) {
    adjacency.get(edge.fromStepId)?.push(edge.toStepId);
    inDegree.set(edge.toStepId, (inDegree.get(edge.toStepId) ?? 0) + 1);
  }

  const queue = scenario.steps
    .filter((step) => (inDegree.get(step.id) ?? 0) === 0)
    .sort((a, b) => a.orderHint - b.orderHint)
    .map((step) => step.id);
  const orderedIds: string[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    orderedIds.push(currentId);
    const neighbors = adjacency.get(currentId) ?? [];
    for (const toId of neighbors) {
      const nextDeg = (inDegree.get(toId) ?? 0) - 1;
      inDegree.set(toId, nextDeg);
      if (nextDeg === 0) {
        queue.push(toId);
      }
    }
    queue.sort((aId, bId) => (byId.get(aId)?.orderHint ?? 0) - (byId.get(bId)?.orderHint ?? 0));
  }

  if (orderedIds.length !== scenario.steps.length) {
    return [...scenario.steps].sort((a, b) => a.orderHint - b.orderHint);
  }
  return orderedIds.map((id) => byId.get(id)).filter((step): step is ScenarioStep => Boolean(step));
}

/**
 * Сортирует записи шагов прогона в порядке конвейера сценария (рёбра + orderHint),
 * а не в порядке массива steps в JSON (часто порядок добавления на холсте).
 */
export function sortStepsByScenarioGraph<T extends { stepId: string }>(rows: T[], scenario: Scenario): T[] {
  const pipelineOrder = new Map(orderedScenarioSteps(scenario).map((s, i) => [s.id, i]));
  const fallbackOrder = new Map(scenario.steps.map((s, i) => [s.id, i]));
  return [...rows].sort((a, b) => {
    const pa = pipelineOrder.get(a.stepId);
    const pb = pipelineOrder.get(b.stepId);
    if (pa !== undefined && pb !== undefined && pa !== pb) {
      return pa - pb;
    }
    return (fallbackOrder.get(a.stepId) ?? 0) - (fallbackOrder.get(b.stepId) ?? 0);
  });
}
