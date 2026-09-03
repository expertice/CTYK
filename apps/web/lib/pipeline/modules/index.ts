import type { ModuleId } from "../../../types/pipeline.types";
import type { IProcessingModule } from "../orchestrator";
import { AudioFromApiModule } from "./audio-from-api.module";
import { AudioFromRtspModule } from "./audio-from-rtsp.module";
import { AudioFromUploadModule } from "./audio-from-upload.module";
import { AudioFromUrlModule } from "./audio-from-url.module";
import { AudioPrepareModule } from "./audio-prepare.module";
import { AsrModule } from "./asr.module";
import { ChecklistSourceModule } from "./checklist-source.module";
import { DiarizationModule } from "./diarization.module";
import { LlmPuppetModule } from "./llm-puppet.module";
import { LlmTaskSatelliteModule } from "./llm-task-satellite.module";
import { PsychStateModule } from "./psych-state.module";
import { ReportOutputModule } from "./report-output.module";
import { SpeakerDraftEditModule } from "./speaker-draft-edit.module";
import { SpeakerTurnMergeModule } from "./speaker-turn-merge.module";

export function createDefaultModuleRegistry(): Map<ModuleId, IProcessingModule> {
  const modules: IProcessingModule[] = [
    new AudioFromUploadModule(),
    new AudioFromUrlModule(),
    new AudioFromApiModule(),
    new AudioFromRtspModule(),
    new ChecklistSourceModule(),
    new AudioPrepareModule(),
    new AsrModule(),
    new DiarizationModule(),
    new SpeakerTurnMergeModule(),
    new SpeakerDraftEditModule(),
    new PsychStateModule(),
    new LlmPuppetModule(),
    new LlmTaskSatelliteModule("LLM_TASK_SUMMARY"),
    new LlmTaskSatelliteModule("LLM_TASK_SPEAKER_NAMES"),
    new LlmTaskSatelliteModule("LLM_TASK_PSYCH"),
    new LlmTaskSatelliteModule("LLM_TASK_CHECKLIST"),
    new ReportOutputModule(),
  ];

  return new Map(modules.map((moduleInstance) => [moduleInstance.id, moduleInstance]));
}
