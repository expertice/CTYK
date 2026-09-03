import type { ArtifactTypeId } from "../../types/artifact.types";
import type { Scenario } from "../../types/pipeline.types";
import { PIPELINE_MODULE_CATALOG } from "../pipeline/module-catalog";
import { DEFAULT_PROCESS_SETTINGS } from "../pipeline/process-settings";
import { normalizeLlmSubtaskRunOrder } from "../pipeline/llm-puppet-subtasks";
import { migrateLegacyScenarioSteps } from "./scenario-legacy-migrate";
import { migrateScenarioToLlmPuppetModel } from "./scenario-puppet-migrate";

export interface ScenarioProcessOptions {
  enforceGraphModulePortsMatchProgram: boolean;
}

const DEFAULT_PROCESS_OPTIONS: ScenarioProcessOptions = {
  enforceGraphModulePortsMatchProgram: DEFAULT_PROCESS_SETTINGS.enforceGraphModulePortsMatchProgram,
};

/** Устаревшее имя просодического артефакта → ENRICHED_TRANSCRIPT. */
function migrateArtifactType<T extends string>(t: T): T {
  return (t === "STRUCTURED_FEATURES" ? "ENRICHED_TRANSCRIPT" : t) as T;
}

/** Приводит scenarioId у шагов и рёбер к `scenario.id`, нормализует шаги отчёта и типы артефактов. */
export function normalizeScenarioIds(
  scenario: Scenario,
  process: Partial<ScenarioProcessOptions> = {},
): Scenario {
  const opts = { ...DEFAULT_PROCESS_OPTIONS, ...process };
  const afterLegacy = migrateLegacyScenarioSteps(scenario);
  const scenarioMigrated = migrateScenarioToLlmPuppetModel(afterLegacy);
  const id = scenarioMigrated.id;
  const isAudioSourceModule = (moduleId: string): boolean =>
    moduleId === "AUDIO_FROM_UPLOAD" ||
    moduleId === "AUDIO_FROM_URL" ||
    moduleId === "AUDIO_FROM_API" ||
    moduleId === "AUDIO_FROM_RTSP";

  const steps: Scenario["steps"] = scenarioMigrated.steps.map((s) => {
    const base = { ...s, scenarioId: id };
    if (opts.enforceGraphModulePortsMatchProgram && s.moduleId === "REPORT_OUTPUT") {
      return { ...base, requires: [] as ArtifactTypeId[] };
    }
    if (opts.enforceGraphModulePortsMatchProgram && s.moduleId === "ASR") {
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "ASR")!;
      return {
        ...base,
        requires: [...cat.typicalRequires],
        produces: [
          ...new Set([...cat.typicalProduces, ...s.produces.map(migrateArtifactType)]),
        ] as ArtifactTypeId[],
      };
    }
    if (opts.enforceGraphModulePortsMatchProgram && s.moduleId === "PSYCH_STATE") {
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "PSYCH_STATE")!;
      return {
        ...base,
        requires: [...cat.typicalRequires],
        produces: [
          ...new Set([...cat.typicalProduces, ...s.produces.map(migrateArtifactType)]),
        ] as ArtifactTypeId[],
      };
    }
    if (opts.enforceGraphModulePortsMatchProgram && s.moduleId === "DIARIZATION") {
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "DIARIZATION")!;
      return {
        ...base,
        requires: [...cat.typicalRequires],
        produces: [
          ...new Set([...cat.typicalProduces, ...s.produces.map(migrateArtifactType)]),
        ] as ArtifactTypeId[],
      };
    }
    if (opts.enforceGraphModulePortsMatchProgram && s.moduleId === "SPEAKER_TURN_MERGE") {
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "SPEAKER_TURN_MERGE")!;
      return {
        ...base,
        requires: [...cat.typicalRequires],
        produces: [
          ...new Set([...cat.typicalProduces, ...s.produces.map(migrateArtifactType)]),
        ] as ArtifactTypeId[],
      };
    }
    if (opts.enforceGraphModulePortsMatchProgram && s.moduleId === "SPEAKER_DRAFT_EDIT") {
      const cat = PIPELINE_MODULE_CATALOG.find((m) => m.id === "SPEAKER_DRAFT_EDIT")!;
      return {
        ...base,
        requires: [...cat.typicalRequires],
        produces: [
          ...new Set([...cat.typicalProduces, ...s.produces.map(migrateArtifactType)]),
        ] as ArtifactTypeId[],
      };
    }
    if (opts.enforceGraphModulePortsMatchProgram && s.moduleId === "AUDIO_PREPARE") {
      return {
        ...base,
        requires: ["AUDIO"] as ArtifactTypeId[],
        produces: ["AUDIO_PREPARED"] as ArtifactTypeId[],
      };
    }
    if (opts.enforceGraphModulePortsMatchProgram && isAudioSourceModule(s.moduleId)) {
      return {
        ...base,
        requires: ["AUDIO_SOURCE"] as ArtifactTypeId[],
        produces: ["AUDIO"] as ArtifactTypeId[],
      };
    }
    return {
      ...base,
      requires: [...new Set(s.requires.map(migrateArtifactType))] as ArtifactTypeId[],
      produces: [...new Set(s.produces.map(migrateArtifactType))] as ArtifactTypeId[],
    };
  });

  let edges = scenarioMigrated.edges.map((e) => {
    let artifactTypeId = migrateArtifactType(e.artifactTypeId);
    return {
      ...e,
      scenarioId: id,
      artifactTypeId,
    };
  });

  const stepById = new Map(steps.map((s) => [s.id, s]));
  if (opts.enforceGraphModulePortsMatchProgram) {
    edges = edges.filter((e) => {
      const to = stepById.get(e.toStepId);
      if (to?.moduleId === "PSYCH_STATE" && e.artifactTypeId === "TEXT") {
        return false;
      }
      return true;
    });
  }

  return normalizeLlmSubtaskRunOrder({ ...scenario, steps, edges });
}
