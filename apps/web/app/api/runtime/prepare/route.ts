import { mkdir, access, constants } from "node:fs/promises";
import { NextResponse } from "next/server";
import path from "node:path";
import { getWebAppRoot } from "../../../../lib/local-models/web-root";
import {
  LOCAL_DIARIZATION_LEGACY_PYANNOTE_DIR,
  LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR,
} from "../../../../lib/local-models/paths";
import {
  checkPythonBinary,
  probeFfmpeg,
  probeNvidiaSmi,
  probePythonRuntime,
} from "../../../../lib/local-models/runtime-probes";

export async function POST(): Promise<NextResponse> {
  const modelsRoot = path.join(getWebAppRoot(), ".models");
  const asrDir = path.join(modelsRoot, "asr");
  const diarizationDir = path.join(modelsRoot, "diarization");
  const localPyannoteDir = LOCAL_DIARIZATION_LEGACY_PYANNOTE_DIR;
  const offlinePipelineDir = LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR;

  const checks: Array<{ step: string; ok: boolean; details: string }> = [];

  const [pythonReadyProbe, pythonRuntimeProbe, ffmpegProbe, nvidiaProbe] = await Promise.all([
    checkPythonBinary(),
    probePythonRuntime(),
    probeFfmpeg(),
    probeNvidiaSmi(),
  ]);
  checks.push({
    step: "python",
    ok: pythonReadyProbe.ok,
    details: pythonReadyProbe.details,
  });
  checks.push({
    step: "torch_cuda",
    ok: pythonRuntimeProbe.torchCudaAvailable,
    details: pythonRuntimeProbe.torchCudaAvailable
      ? `${pythonRuntimeProbe.gpuName ?? "GPU"} (${pythonRuntimeProbe.gpuVramMb ?? "?"} MB)`
      : (pythonRuntimeProbe.error ?? "CUDA not available, CPU mode will be used"),
  });
  checks.push({
    step: "ffmpeg",
    ok: ffmpegProbe.ok,
    details: ffmpegProbe.ok ? `${ffmpegProbe.bin}: ${ffmpegProbe.version ?? "ok"}` : ffmpegProbe.error ?? "ffmpeg not found",
  });
  checks.push({
    step: "nvidia_smi",
    ok: nvidiaProbe.ok,
    details: nvidiaProbe.ok
      ? `${nvidiaProbe.gpuName ?? "GPU"} util ${nvidiaProbe.gpuUtilPercent ?? 0}%`
      : nvidiaProbe.error ?? "nvidia-smi not found",
  });

  await mkdir(modelsRoot, { recursive: true });
  checks.push({
    step: "models_root",
    ok: true,
    details: modelsRoot,
  });

  await mkdir(asrDir, { recursive: true });
  checks.push({
    step: "asr_dir",
    ok: true,
    details: asrDir,
  });

  await mkdir(diarizationDir, { recursive: true });
  checks.push({
    step: "diarization_dir",
    ok: true,
    details: diarizationDir,
  });

  await mkdir(localPyannoteDir, { recursive: true });
  checks.push({
    step: "local_pyannote_dir",
    ok: true,
    details: localPyannoteDir,
  });

  await mkdir(path.dirname(offlinePipelineDir), { recursive: true });
  await mkdir(offlinePipelineDir, { recursive: true });
  checks.push({
    step: "offline_pyannote_pipeline_dir",
    ok: true,
    details: offlinePipelineDir,
  });

  const localPyannoteExists = await checkPath(localPyannoteDir);
  checks.push({
    step: "local_pyannote_path_ready",
    ok: localPyannoteExists,
    details: localPyannoteExists ? "Путь готов" : "Путь недоступен",
  });

  const offlineBundleReady = await checkPath(path.join(offlinePipelineDir, "config.yaml"));
  checks.push({
    step: "pyannote_offline_bundle",
    ok: offlineBundleReady,
    details: offlineBundleReady
      ? "Offline bundle готов (HF_TOKEN не нужен для диаризации)"
      : "Запустите один раз: pnpm models:pyannote-offline (нужен HF_TOKEN только для скачивания)",
  });

  const hasHfToken = Boolean(process.env.HF_TOKEN && process.env.HF_TOKEN.trim().length > 0);
  checks.push({
    step: "hf_token",
    ok: hasHfToken || offlineBundleReady,
    details: offlineBundleReady
      ? "HF_TOKEN не обязателен (offline bundle)"
      : hasHfToken
        ? "HF_TOKEN задан"
        : "HF_TOKEN не задан — для pyannote без offline bundle нужен токен или heuristic",
  });

  return NextResponse.json({
    ok: checks.every(
      (item) => item.ok || item.step === "hf_token" || item.step === "pyannote_offline_bundle",
    ),
    checks,
    runtimeCapabilities: {
      python: pythonRuntimeProbe,
      ffmpeg: ffmpegProbe,
      nvidiaSmi: nvidiaProbe,
    },
    paths: {
      modelsRoot,
      asrDir,
      diarizationDir,
      localPyannoteDir,
      offlinePipelineDir,
    },
  });
}

async function checkPath(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

