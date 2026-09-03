import { access, constants } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR,
  LOCAL_DIARIZATION_MODELS_DIR,
} from "../../../../lib/local-models/paths";
import { probeFfmpeg, probePythonRuntime } from "../../../../lib/local-models/runtime-probes";

interface DependencyItem {
  id: string;
  status: "done" | "missing" | "error";
  details: string;
  recommendedAction?: string;
}

export async function GET(): Promise<NextResponse> {
  const [ffmpeg, python] = await Promise.all([probeFfmpeg(), probePythonRuntime()]);
  const deps: DependencyItem[] = [];

  deps.push({
    id: "ffmpeg",
    status: ffmpeg.ok ? "done" : "missing",
    details: ffmpeg.ok ? `${ffmpeg.bin}: ${ffmpeg.version ?? "ok"}` : ffmpeg.error ?? "not found",
    recommendedAction: ffmpeg.ok
      ? undefined
      : "Скачать ffmpeg в .tools/ffmpeg и выставить FFMPEG_BIN в .env.local",
  });

  deps.push({
    id: "python_runtime",
    status: python.ok ? "done" : "error",
    details: python.ok
      ? `python=${python.version}, torch.cuda=${python.torchCudaAvailable ? "yes" : "no"}`
      : python.error ?? "runtime probe failed",
    recommendedAction: python.ok ? undefined : "Проверьте PYTHON_BIN и пакеты pyannote/torch в этом venv",
  });

  deps.push(await checkFile("offline_pipeline_config", path.join(LOCAL_DIARIZATION_OFFLINE_PIPELINE_DIR, "config.yaml")));
  deps.push(await checkFile("offline_segmentation_weights", path.join(LOCAL_DIARIZATION_MODELS_DIR, "offline-bundle", "segmentation-3.0", "pytorch_model.bin")));
  deps.push(await checkFile("offline_embedding_weights", path.join(LOCAL_DIARIZATION_MODELS_DIR, "offline-bundle", "embedding-local", "pytorch_model.bin")));
  deps.push(await checkFile("offline_plda_xvec", path.join(LOCAL_DIARIZATION_MODELS_DIR, "offline-bundle", "speaker-diarization-community-1", "plda", "xvec_transform.npz")));
  deps.push(await checkFile("offline_plda", path.join(LOCAL_DIARIZATION_MODELS_DIR, "offline-bundle", "speaker-diarization-community-1", "plda", "plda.npz")));

  const ok = deps.every((item) => item.status === "done");
  return NextResponse.json({
    ok,
    dependencies: deps,
  });
}

async function checkFile(id: string, filePath: string): Promise<DependencyItem> {
  try {
    await access(filePath, constants.F_OK);
    return { id, status: "done", details: filePath };
  } catch {
    return {
      id,
      status: "missing",
      details: filePath,
      recommendedAction: "Запустить: pnpm models:pyannote-offline",
    };
  }
}
