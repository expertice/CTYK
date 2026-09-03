import type { ModuleId, Scenario, ScenarioEdge, ScenarioStep } from "../../types/pipeline.types";
import { PIPELINE_MODULE_CATALOG } from "../pipeline/module-catalog";
import { getDefaultModuleConfig } from "../pipeline/module-default-config";
import { isLlmPuppetModule, isLlmTaskSatellite } from "../pipeline/llm-orchestrator-modules";

const LEGACY_LLM_ENGINE = "LLM_ENGINE";
const LEGACY_TO_TASK: Record<string, ModuleId> = {
  LLM_SUMMARY: "LLM_TASK_SUMMARY",
  LLM_SPEAKER_NAMES: "LLM_TASK_SPEAKER_NAMES",
  LLM_PSYCH_INTERPRET: "LLM_TASK_PSYCH",
  LLM_CHECKLIST: "LLM_TASK_CHECKLIST",
};

function modStr(step: ScenarioStep): string {
  return step.moduleId as string;
}

function uniqueEdgeId(base: string, edges: ScenarioEdge[]): string {
  let id = base;
  let n = 0;
  const set = new Set(edges.map((e) => e.id));
  while (set.has(id)) {
    id = `${base}_${n++}`;
  }
  return id;
}

/**
 * Старые пульты и `LLM_ENGINE` → `LLM_TASK_*` + `LLM_PUPPET` и рёбра `LLM_SUBTASK`.
 * Идемпотентно: уже мигрированные сценарии не ломает.
 */
export function migrateScenarioToLlmPuppetModel(scenario: Scenario): Scenario {
  let steps = scenario.steps.map((s) => ({ ...s }));
  let edges = scenario.edges.map((e) => ({ ...e }));
  const sid = scenario.id;
  let hadLegacyLlm = false;

  const stepById = new Map(steps.map((s) => [s.id, s]));

  for (const s of steps) {
    const mapped = LEGACY_TO_TASK[modStr(s)];
    if (mapped) {
      hadLegacyLlm = true;
      s.moduleId = mapped;
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === mapped);
      if (cat) {
        s.requires = [...cat.typicalRequires];
        s.produces = [...cat.typicalProduces];
      }
    }
  }

  const engineSteps = steps.filter((s) => modStr(s) === LEGACY_LLM_ENGINE);
  if (engineSteps.length > 0) hadLegacyLlm = true;
  for (const eng of engineSteps) {
    const puppetId = eng.id;
    let tid = `step_llm_task_for_${puppetId}`;
    let n = 0;
    while (stepById.has(tid)) {
      tid = `step_llm_task_for_${puppetId}_${n++}`;
    }

    const taskCat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "LLM_TASK_SUMMARY")!;
    const taskStep: ScenarioStep = {
      id: tid,
      scenarioId: sid,
      moduleId: "LLM_TASK_SUMMARY",
      code: `${eng.code}_sub`,
      orderHint: eng.orderHint,
      config: { ...getDefaultModuleConfig("LLM_TASK_SUMMARY"), ...eng.config },
      requires: [...taskCat.typicalRequires],
      produces: [...taskCat.typicalProduces],
    };
    steps.push(taskStep);
    stepById.set(tid, taskStep);

    edges = edges.map((e) => {
      if (e.toStepId === puppetId && e.artifactTypeId !== "LLM_SUBTASK") {
        return { ...e, toStepId: tid };
      }
      return e;
    });
    edges = edges.map((e) => {
      if (e.fromStepId !== puppetId) return e;
      if (e.artifactTypeId === "LLM_SUBTASK") return e;
      return { ...e, fromStepId: tid };
    });

    const pupCat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "LLM_PUPPET")!;
    eng.moduleId = "LLM_PUPPET";
    const prevCfg = eng.config && typeof eng.config === "object" ? { ...eng.config } : {};
    eng.config = { ...getDefaultModuleConfig("LLM_PUPPET"), ...prevCfg };
    eng.requires = [...pupCat.typicalRequires];
    eng.produces = [...pupCat.typicalProduces];

    edges.push({
      id: uniqueEdgeId(`edge_llm_sub_${tid}_${puppetId}`, edges),
      scenarioId: sid,
      fromStepId: tid,
      toStepId: puppetId,
      artifactTypeId: "LLM_SUBTASK",
    });
  }

  const taskSteps = steps.filter((s) => isLlmTaskSatellite(s.moduleId));
  const puppetSteps = steps.filter((s) => isLlmPuppetModule(s.moduleId));

  if (hadLegacyLlm && taskSteps.length > 0 && puppetSteps.length === 0) {
    const maxHint = steps.reduce((m, s) => Math.max(m, s.orderHint), 0);
    let puppetId = `step_llm_puppet`;
    let k = 0;
    while (stepById.has(puppetId)) {
      puppetId = `step_llm_puppet_${k++}`;
    }
    const pupCat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "LLM_PUPPET")!;
    const puppet: ScenarioStep = {
      id: puppetId,
      scenarioId: sid,
      moduleId: "LLM_PUPPET",
      code: "llm_puppet",
      orderHint: maxHint + 1,
      config: { ...getDefaultModuleConfig("LLM_PUPPET") },
      requires: [...pupCat.typicalRequires],
      produces: [...pupCat.typicalProduces],
    };
    steps.push(puppet);
    stepById.set(puppetId, puppet);
  }

  const puppets = steps.filter((s) => isLlmPuppetModule(s.moduleId));
  const targetPuppet = puppets.sort((a, b) => a.orderHint - b.orderHint || a.id.localeCompare(b.id))[0];

  if (hadLegacyLlm && targetPuppet) {
    for (const task of taskSteps) {
      const has = edges.some((e) => e.fromStepId === task.id && e.artifactTypeId === "LLM_SUBTASK");
      if (has) continue;
      edges.push({
        id: uniqueEdgeId(`edge_llm_sub_${task.id}_${targetPuppet.id}`, edges),
        scenarioId: sid,
        fromStepId: task.id,
        toStepId: targetPuppet.id,
        artifactTypeId: "LLM_SUBTASK",
      });
    }
  }

  return { ...scenario, steps, edges };
}
