import { access, constants } from "node:fs/promises";
import { NextResponse } from "next/server";
import path from "node:path";
import { getWebAppRoot } from "../../../../lib/local-models/web-root";
import { resolveDiarizationLocalModelPathFromEnv } from "../../../../lib/local-models/model-manager";
import { probeFfmpeg, probeNvidiaSmi, probePythonRuntime } from "../../../../lib/local-models/runtime-probes";

interface RuntimeCheckRequest {
  diarizationMode?: "local_pyannote" | "hf_pyannote" | "heuristic";
  localPyannoteModelPath?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = ((await request.json().catch(() => ({}))) ?? {}) as RuntimeCheckRequest;
  const diarizationMode = body.diarizationMode ?? "local_pyannote";
  const rawLocal = body.localPyannoteModelPath?.trim();
  const modelPath = rawLocal
    ? resolvePath(rawLocal)
    : await resolveDiarizationLocalModelPathFromEnv();

  const [pythonProbe, ffmpegProbe, nvidiaProbe, localPathExists] = await Promise.all([
    probePythonRuntime(),
    probeFfmpeg(),
    probeNvidiaSmi(),
    checkPath(modelPath),
  ]);
  const hasHfToken = Boolean(process.env.HF_TOKEN && process.env.HF_TOKEN.trim().length > 0);

  const effectiveDiarizationProvider = resolveDiarizationProvider({
    mode: diarizationMode,
    hasHfToken,
    localPathExists,
  });

  return NextResponse.json({
    pythonReady: pythonProbe.ok,
    hasHfToken,
    localPathExists,
    localPyannoteModelPath: modelPath,
    diarizationMode,
    effectiveDiarizationProvider,
    runtimeCapabilities: {
      python: pythonProbe,
      ffmpeg: ffmpegProbe,
      nvidiaSmi: nvidiaProbe,
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

function resolvePath(raw: string): string {
  return path.isAbsolute(raw) ? raw : path.join(getWebAppRoot(), raw);
}

function resolveDiarizationProvider(input: {
  mode: "local_pyannote" | "hf_pyannote" | "heuristic";
  hasHfToken: boolean;
  localPathExists: boolean;
}): "local_pyannote" | "pyannote" | "heuristic" {
  if (input.mode === "heuristic") {
    return "heuristic";
  }
  if (input.mode === "local_pyannote") {
    return input.localPathExists ? "local_pyannote" : "heuristic";
  }
  if (input.mode === "hf_pyannote") {
    return input.hasHfToken ? "pyannote" : "heuristic";
  }
  return "heuristic";
}
