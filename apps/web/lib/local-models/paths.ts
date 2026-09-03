import path from "node:path";
import { getWebAppRoot } from "./web-root";

export const LOCAL_MODELS_ROOT = path.join(getWebAppRoot(), ".models");
export const LOCAL_ASR_MODELS_DIR = path.join(LOCAL_MODELS_ROOT, "asr");
export const LOCAL_DIARIZATION_MODELS_DIR = path.join(LOCAL_MODELS_ROOT, "diarization");
/** After `pnpm models:pyannote-offline` — pipeline with patched config (no HF at runtime). */
export const LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR = path.join(
  LOCAL_DIARIZATION_MODELS_DIR,
  "offline-bundle",
  "pipeline",
);
export const LOCAL_DIARIZATION_LEGACY_PYANNOTE_DIR = path.join(LOCAL_DIARIZATION_MODELS_DIR, "pyannote-local");
