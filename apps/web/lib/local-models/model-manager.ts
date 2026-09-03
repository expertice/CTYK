import { mkdir, access, writeFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPythonScript } from "./python-runner";
import {
  LOCAL_ASR_MODELS_DIR,
  LOCAL_DIARIZATION_LEGACY_PYANNOTE_DIR,
  LOCAL_DIARIZATION_MODELS_DIR,
  LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR,
} from "./paths";
import { getWebAppRoot } from "./web-root";

export interface AsrSegment {
  startTime: number;
  endTime: number;
  text: string;
}

export interface AsrResult {
  text: string;
  segments: AsrSegment[];
  model: string;
  downloaded: boolean;
}

export interface DiarizationSegment {
  speakerId: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface DiarizationResult {
  segments: DiarizationSegment[];
  model: string;
  downloaded: boolean;
  provider: "pyannote" | "local_pyannote" | "heuristic";
}

export interface ProsodyEnrichedSegment extends DiarizationSegment {
  rmsMeanDb: number;
  zcrMean: number;
  spectralCentroidMeanHz: number;
  spectralRolloffMeanHz: number;
  charsPerSec: number;
  durationSec: number;
  /** Доля коротких низкоэнергетичных кадров (0..1), для правил пауз/нагрузки. */
  silenceRatio: number;
  /** Средний спектральный flux по кадрам (онсет-подобная нестабильность). */
  spectralFlux: number;
  globalTempoBpm: number | null;
}

export interface ProsodyEnrichmentResult {
  segments: ProsodyEnrichedSegment[];
  sampleRate: number;
  globalTempoBpm: number | null;
}

export interface AudioPreparedChunk {
  chunkId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface AudioPrepareResult {
  preparedUrl: string;
  sampleRate: number;
  channels: number;
  durationSec: number;
  chunks: AudioPreparedChunk[];
}

export interface RtspCaptureResult {
  localUrl: string;
}

/** Длинный JSON в argv даёт spawn ENAMETOOLONG (Windows ~32K); пишем во временный файл. */
async function withTempJsonPayload<T>(jsonUtf8: string, run: (filePath: string) => Promise<T>): Promise<T> {
  const filePath = path.join(
    tmpdir(),
    `ctyk-segments-${Date.now()}-${Math.random().toString(36).slice(2, 11)}.json`,
  );
  await writeFile(filePath, jsonUtf8, "utf8");
  try {
    return await run(filePath);
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

export async function runLocalAsr(
  audioUrl?: string,
  options?: {
    modelName?: string;
    cacheDir?: string;
    device?: "auto" | "cpu" | "cuda" | "gpu_strict";
    computeType?: string;
  },
): Promise<AsrResult> {
  const audioPath = resolveAudioPath(audioUrl);
  const modelName = options?.modelName ?? process.env.ASR_LOCAL_MODEL ?? "small";
  const cacheDir = ensureAbsolutePath(options?.cacheDir ?? process.env.ASR_MODEL_CACHE_DIR ?? LOCAL_ASR_MODELS_DIR);
  const device =
    options?.device ??
    ((process.env.ASR_DEVICE as "auto" | "cpu" | "cuda" | "gpu_strict" | undefined) ?? "auto");
  const computeType = options?.computeType ?? process.env.ASR_COMPUTE_TYPE ?? "int8";
  const script = path.join(getWebAppRoot(), "scripts", "local-models", "asr_local.py");

  await mkdir(cacheDir, { recursive: true });
  const { stdout } = await runPythonScript(script, [
    "--audio-path",
    audioPath,
    "--model-name",
    modelName,
    "--cache-dir",
    cacheDir,
    "--device",
    device,
    "--compute-type",
    computeType,
  ]);
  return parseJson<AsrResult>(stdout, "ASR");
}

export async function runLocalAudioPrepare(
  audioUrl?: string,
  options?: {
    targetSampleRate?: number;
    targetChannels?: number;
    chunkSec?: number;
    overlapSec?: number;
  },
): Promise<AudioPrepareResult> {
  const audioPath = resolveAudioPath(audioUrl);
  const script = path.join(getWebAppRoot(), "scripts", "local-models", "audio_prepare.py");
  const targetSampleRate = options?.targetSampleRate ?? 16000;
  const targetChannels = options?.targetChannels ?? 1;
  const chunkSec = options?.chunkSec ?? 120;
  const overlapSec = options?.overlapSec ?? 1;

  const { stdout } = await runPythonScript(script, [
    "--audio-path",
    audioPath,
    "--target-sample-rate",
    String(targetSampleRate),
    "--target-channels",
    String(targetChannels),
    "--chunk-sec",
    String(chunkSec),
    "--overlap-sec",
    String(overlapSec),
  ]);

  const parsed = parseJson<{
    preparedPath?: string;
    sampleRate?: number;
    channels?: number;
    durationSec?: number;
    chunks?: AudioPreparedChunk[];
    error?: string;
  }>(stdout, "AUDIO_PREPARE");

  if (parsed.error === "missing_audio") {
    throw new Error("AUDIO_PREPARE: missing source AUDIO or invalid path");
  }

  const preparedPath = typeof parsed.preparedPath === "string" ? parsed.preparedPath : "";
  const preparedUrl = preparedPath.length > 0 ? `file://${preparedPath}` : (audioUrl ?? "");
  return {
    preparedUrl,
    sampleRate: typeof parsed.sampleRate === "number" ? parsed.sampleRate : targetSampleRate,
    channels: typeof parsed.channels === "number" ? parsed.channels : targetChannels,
    durationSec: typeof parsed.durationSec === "number" ? parsed.durationSec : 0,
    chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
  };
}

export async function runLocalRtspCapture(
  rtspUrl: string,
  options?: { captureSec?: number; transport?: "tcp" | "udp" },
): Promise<string> {
  const script = path.join(getWebAppRoot(), "scripts", "local-models", "rtsp_capture.py");
  const captureSec = options?.captureSec ?? 60;
  const transport = options?.transport ?? "tcp";
  const { stdout } = await runPythonScript(script, [
    "--rtsp-url",
    rtspUrl,
    "--capture-sec",
    String(captureSec),
    "--transport",
    transport,
  ]);
  const parsed = parseJson<{ localUrl?: string; error?: string; message?: string }>(stdout, "RTSP_CAPTURE");
  if (parsed.error) {
    throw new Error(parsed.message ? `RTSP_CAPTURE: ${parsed.message}` : "RTSP_CAPTURE failed");
  }
  if (!parsed.localUrl) {
    throw new Error("RTSP_CAPTURE: localUrl is missing");
  }
  return parsed.localUrl;
}

export async function runLocalDiarization(
  segments: AsrSegment[],
  options?: {
    modelName?: string;
    cacheDir?: string;
    localModelPath?: string;
    mode?: "local_pyannote" | "hf_pyannote" | "heuristic";
    audioUrl?: string;
    mergeGapSec?: number;
    minTurnSec?: number;
    deviceMode?: "auto" | "cpu" | "gpu_strict";
  },
): Promise<DiarizationResult> {
  const modelName = options?.modelName ?? process.env.DIARIZATION_LOCAL_MODEL ?? "pyannote/speaker-diarization-3.1";
  const cacheDir = ensureAbsolutePath(
    options?.cacheDir ?? process.env.DIARIZATION_MODEL_CACHE_DIR ?? LOCAL_DIARIZATION_MODELS_DIR,
  );
  const localModelPath = ensureAbsolutePath(
    options?.localModelPath?.trim() || (await resolveDiarizationLocalModelPathFromEnv()),
  );
  const mode = options?.mode ?? "local_pyannote";
  const audioPath = resolveAudioPath(options?.audioUrl);
  const script = path.join(getWebAppRoot(), "scripts", "local-models", "diarization_local.py");
  await mkdir(cacheDir, { recursive: true });

  const payload = JSON.stringify({ segments });
  const { stdout } = await withTempJsonPayload(payload, (segmentsFile) =>
    runPythonScript(
      script,
      [
        "--model-name",
        modelName,
        "--cache-dir",
        cacheDir,
        "--local-model-path",
        localModelPath,
        "--mode",
        mode,
        "--audio-path",
        audioPath,
        "--segments-json-file",
        segmentsFile,
        "--segments-json",
        "{}",
        "--merge-gap-sec",
        String(options?.mergeGapSec ?? ""),
        "--min-turn-sec",
        String(options?.minTurnSec ?? ""),
        "--device-mode",
        String(options?.deviceMode ?? ""),
      ],
    ),
  );
  return parseJson<DiarizationResult>(stdout, "DIARIZATION");
}

export async function runProsodyEnrichment(
  inputSegments: DiarizationSegment[],
  audioUrl?: string,
): Promise<ProsodyEnrichmentResult> {
  const audioPath = resolveAudioPath(audioUrl);
  const script = path.join(getWebAppRoot(), "scripts", "local-models", "prosody_enrich.py");
  const payload = JSON.stringify(inputSegments);

  const { stdout } = await withTempJsonPayload(payload, (segmentsFile) =>
    runPythonScript(script, [
      "--audio-path",
      audioPath,
      "--segments-json-file",
      segmentsFile,
      "--segments-json",
      "[]",
    ]),
  );
  const parsed = parseJson<{
    segments: ProsodyEnrichedSegment[];
    sampleRate: number;
    globalTempoBpm: number | null;
    error?: string;
    message?: string;
  }>(stdout, "PROSODY");

  if (parsed.error === "missing_audio" || parsed.error === "bad_segments_json") {
    throw new Error(
      parsed.error === "missing_audio"
        ? "Prosody enrichment: нет пути к аудио (нужен артефакт AUDIO с url после записи/загрузки)."
        : "Prosody enrichment: неверный JSON сегментов.",
    );
  }
  if (parsed.error === "python_exception") {
    const hint = parsed.message ? `: ${parsed.message}` : "";
    throw new Error(`Prosody (librosa) завершился с ошибкой${hint}`);
  }

  const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : [];
  const enrichedSegments: ProsodyEnrichedSegment[] = rawSegs.map((s) => {
    const o = s as unknown as Record<string, unknown>;
    const base = s as ProsodyEnrichedSegment;
    const sr =
      typeof o.silenceRatio === "number" && Number.isFinite(o.silenceRatio) ? o.silenceRatio : 0;
    const sf =
      typeof o.spectralFlux === "number" && Number.isFinite(o.spectralFlux) ? o.spectralFlux : 0;
    return { ...base, silenceRatio: sr, spectralFlux: sf };
  });

  return {
    segments: enrichedSegments,
    sampleRate: typeof parsed.sampleRate === "number" ? parsed.sampleRate : 16000,
    globalTempoBpm: parsed.globalTempoBpm ?? null,
  };
}

function resolveAudioPath(audioUrl?: string): string {
  if (!audioUrl) {
    return "";
  }

  if (audioUrl.startsWith("file://")) {
    return audioUrl.replace("file://", "");
  }

  if (audioUrl.startsWith("local://")) {
    const relative = audioUrl.replace("local://", "");
    return path.join(getWebAppRoot(), relative);
  }

  return audioUrl;
}

function ensureAbsolutePath(value: string): string {
  if (!value) {
    return "";
  }
  return path.isAbsolute(value) ? value : path.join(getWebAppRoot(), value);
}

/**
 * Resolves local pyannote directory for `local_pyannote` when the UI does not override it.
 * Priority: PYANNOTE_OFFLINE_PIPELINE → DIARIZATION_LOCAL_MODEL_PATH → existing offline bundle
 * → legacy pyannote-local → default offline bundle path (expected after one-time download).
 */
export async function resolveDiarizationLocalModelPathFromEnv(): Promise<string> {
  const envOffline = process.env.PYANNOTE_OFFLINE_PIPELINE?.trim();
  if (envOffline) {
    return ensureAbsolutePath(envOffline);
  }

  const envLocal = process.env.DIARIZATION_LOCAL_MODEL_PATH?.trim();
  if (envLocal) {
    return ensureAbsolutePath(envLocal);
  }

  try {
    await access(path.join(LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR, "config.yaml"), constants.F_OK);
    return LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR;
  } catch {
    /* use fallback below */
  }

  try {
    await access(path.join(LOCAL_DIARIZATION_LEGACY_PYANNOTE_DIR, "config.yaml"), constants.F_OK);
    return LOCAL_DIARIZATION_LEGACY_PYANNOTE_DIR;
  } catch {
    /* use fallback below */
  }

  return LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR;
}

/** Парсит JSON из stdout скрипта; допускает префиксный мусор (предупреждения librosa/numba в консоль). */
function parseJson<T>(raw: string, context: string): T {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const lines = trimmed.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith("{")) continue;
      try {
        return JSON.parse(line) as T;
      } catch {
        continue;
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`${context} local model produced invalid JSON output`);
  }
}

export async function isLocalRuntimeReady(): Promise<boolean> {
  const script = path.join(getWebAppRoot(), "scripts", "local-models", "asr_local.py");
  try {
    await access(script, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
