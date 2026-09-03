import type { ModuleId, Scenario, ScenarioStep } from "../../types/pipeline.types";
import { getDefaultModuleConfig } from "../pipeline/module-default-config";
import { PIPELINE_MODULE_CATALOG } from "../pipeline/module-catalog";

const LEGACY_SUMMARY = "SUMMARY";
const LEGACY_NAME_DEFINER = "NAME_DEFINER";
const LEGACY_CHECKLIST_ANALYSIS = "CHECKLIST_ANALYSIS";

function moduleIdString(step: ScenarioStep): string {
  return step.moduleId as string;
}

/**
 * Убирает устаревшие модули из снимка сценария: инструкции переносятся в config целевых пультов
 * или шаг заменяется на подзадачу LLM; CHECKLIST_ANALYSIS → LLM_TASK_CHECKLIST.
 */
export function migrateLegacyScenarioSteps(scenario: Scenario): Scenario {
  let steps = scenario.steps.map((s) => ({ ...s }));
  let edges = [...scenario.edges];
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const removeStepIds = new Set<string>();

  for (const step of steps) {
    if (moduleIdString(step) !== LEGACY_SUMMARY) continue;

    const instOut = edges.filter((e) => e.fromStepId === step.id && e.artifactTypeId === "LLM_INSTRUCTIONS");
    if (instOut.length > 0) {
      for (const e of instOut) {
        const t = stepById.get(e.toStepId);
        if (!t) continue;
        const nextConfig = { ...t.config };
        const ip = step.config?.instructionPrompt;
        if (typeof ip === "string" && ip.trim()) nextConfig.instructionPrompt = ip;
        const ii = step.config?.instructionIntent;
        if (typeof ii === "string" && ii.trim()) nextConfig.instructionIntent = ii;
        t.config = nextConfig;
      }
      removeStepIds.add(step.id);
    } else {
      const s = stepById.get(step.id)!;
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "LLM_TASK_SUMMARY")!;
      s.moduleId = "LLM_TASK_SUMMARY";
      s.requires = [...cat.typicalRequires];
      s.produces = [...cat.typicalProduces];
      s.config = { ...getDefaultModuleConfig("LLM_TASK_SUMMARY"), ...s.config };
    }
  }

  for (const step of steps) {
    if (moduleIdString(step) !== LEGACY_NAME_DEFINER) continue;

    const instOut = edges.filter((e) => e.fromStepId === step.id && e.artifactTypeId === "LLM_INSTRUCTIONS");
    if (instOut.length > 0) {
      for (const e of instOut) {
        const t = stepById.get(e.toStepId);
        if (!t) continue;
        const sp = step.config?.speakerNamePrompt;
        if (typeof sp === "string" && sp.trim()) {
          t.config = { ...t.config, speakerNamePrompt: sp };
        }
      }
      removeStepIds.add(step.id);
    } else {
      const s = stepById.get(step.id)!;
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "LLM_TASK_SPEAKER_NAMES")!;
      s.moduleId = "LLM_TASK_SPEAKER_NAMES";
      s.requires = [...cat.typicalRequires];
      s.produces = [...cat.typicalProduces];
      s.config = { ...getDefaultModuleConfig("LLM_TASK_SPEAKER_NAMES"), ...s.config };
    }
  }

  const nextSteps = steps
    .map((st) => stepById.get(st.id)!)
    .filter((s) => !removeStepIds.has(s.id))
    .map((s) => {
      if (moduleIdString(s) !== LEGACY_CHECKLIST_ANALYSIS) return s;
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "LLM_TASK_CHECKLIST")!;
      return {
        ...s,
        moduleId: "LLM_TASK_CHECKLIST" as ModuleId,
        requires: [...cat.typicalRequires],
        produces: [...cat.typicalProduces],
        config: { ...getDefaultModuleConfig("LLM_TASK_CHECKLIST"), ...s.config },
      } satisfies ScenarioStep;
    });

  const nextEdges = edges.filter((e) => !removeStepIds.has(e.fromStepId) && !removeStepIds.has(e.toStepId));

  return { ...scenario, steps: nextSteps, edges: nextEdges };
}
