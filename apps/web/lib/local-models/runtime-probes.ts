import { spawn } from "node:child_process";
import os from "node:os";

export interface ProbeResult {
  ok: boolean;
  details: string;
}

export interface PythonRuntimeProbe {
  ok: boolean;
  pythonBin: string;
  version: string;
  torchCudaAvailable: boolean;
  gpuName?: string;
  gpuVramMb?: number;
  error?: string;
}

export interface FfmpegProbe {
  ok: boolean;
  bin: string;
  version?: string;
  error?: string;
}

export interface NvidiaSmiProbe {
  ok: boolean;
  gpuName?: string;
  gpuUtilPercent?: number;
  vramUsedMb?: number;
  vramTotalMb?: number;
  error?: string;
}

export async function checkPythonBinary(): Promise<ProbeResult> {
  const command = process.env.PYTHON_BIN || "python";
  const { code, stdout, stderr } = await run(command, ["--version"]);
  if (code !== 0) {
    return { ok: false, details: stderr || stdout || "python not found" };
  }
  return { ok: true, details: (stdout || stderr).trim() };
}

export async function probePythonRuntime(): Promise<PythonRuntimeProbe> {
  const pythonBin = process.env.PYTHON_BIN || "python";
  const script = [
    "import json,sys",
    "out={'ok':True,'pythonBin':sys.executable,'version':sys.version.split()[0],'torchCudaAvailable':False}",
    "try:",
    " import torch",
    " out['torchCudaAvailable']=bool(torch.cuda.is_available())",
    " if out['torchCudaAvailable']:",
    "  out['gpuName']=torch.cuda.get_device_name(0)",
    "  props=torch.cuda.get_device_properties(0)",
    "  out['gpuVramMb']=int(props.total_memory/1024/1024)",
    "except Exception as e:",
    " out['error']=str(e)",
    "print(json.dumps(out, ensure_ascii=False))",
  ].join("\n");
  const { code, stdout, stderr } = await run(pythonBin, ["-c", script], {
    PYTHONIOENCODING: "utf-8",
  });
  if (code !== 0) {
    return {
      ok: false,
      pythonBin,
      version: "",
      torchCudaAvailable: false,
      error: stderr || stdout || "python probe failed",
    };
  }
  try {
    return JSON.parse(stdout.trim()) as PythonRuntimeProbe;
  } catch {
    return {
      ok: false,
      pythonBin,
      version: "",
      torchCudaAvailable: false,
      error: `invalid python probe JSON: ${stdout || stderr}`,
    };
  }
}

export async function probeFfmpeg(): Promise<FfmpegProbe> {
  const bin = process.env.FFMPEG_BIN || "ffmpeg";
  const { code, stdout, stderr } = await run(bin, ["-version"]);
  if (code !== 0) {
    return { ok: false, bin, error: stderr || stdout || "ffmpeg not found" };
  }
  const first = (stdout || stderr).split(/\r?\n/).find(Boolean);
  return { ok: true, bin, version: first };
}

export async function probeNvidiaSmi(): Promise<NvidiaSmiProbe> {
  const args = [
    "--query-gpu=name,utilization.gpu,memory.used,memory.total",
    "--format=csv,noheader,nounits",
  ];
  const { code, stdout, stderr } = await run("nvidia-smi", args);
  if (code !== 0) {
    return { ok: false, error: stderr || stdout || "nvidia-smi not available" };
  }
  const line = stdout.split(/\r?\n/).find((x) => x.trim().length > 0);
  if (!line) return { ok: false, error: "nvidia-smi output is empty" };
  const [nameRaw, utilRaw, usedRaw, totalRaw] = line.split(",").map((s) => s.trim());
  return {
    ok: true,
    gpuName: nameRaw,
    gpuUtilPercent: Number(utilRaw),
    vramUsedMb: Number(usedRaw),
    vramTotalMb: Number(totalRaw),
  };
}

export interface HostResourceSample {
  cpuLoad1m: number;
  ramUsedMb: number;
  ramTotalMb: number;
}

/** RAM + CPU. On Windows `os.loadavg()` is always 0 — use `sampleHostResourcesAsync` for real CPU. */
export function sampleHostResources(): HostResourceSample {
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  const usedMemMb = totalMemMb - freeMemMb;
  return {
    cpuLoad1m: Number(os.loadavg()[0].toFixed(2)),
    ramUsedMb: usedMemMb,
    ramTotalMb: totalMemMb,
  };
}

function cpuTimesTotal(t: os.CpuInfo["times"]): number {
  return t.user + t.nice + t.sys + t.idle + (t.irq ?? 0);
}

/** Instant CPU util 0–100% from two `os.cpus()` snapshots (works on Windows; loadavg does not). */
async function sampleCpuUtilPercentFromCpuTimes(sampleMs = 150): Promise<number> {
  const prev = os.cpus();
  await new Promise((r) => setTimeout(r, sampleMs));
  const next = os.cpus();
  const n = Math.min(prev.length, next.length);
  if (n === 0) return 0;
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < n; i++) {
    const p = prev[i].times;
    const q = next[i].times;
    idleDelta += q.idle - p.idle;
    totalDelta += cpuTimesTotal(q) - cpuTimesTotal(p);
  }
  if (totalDelta <= 0) return 0;
  const util = 100 * (1 - idleDelta / totalDelta);
  return Math.min(100, Math.max(0, util));
}

/**
 * Host RAM + CPU for metrics APIs. On Windows, CPU is sampled via `os.cpus()` deltas; elsewhere 1m loadavg.
 * Client normalizes as `cpuLoad1m / logicalCpuCount` → ~utilization 0–1.
 */
export async function sampleHostResourcesAsync(): Promise<HostResourceSample> {
  const sync = sampleHostResources();
  const cpus = Math.max(1, os.cpus().length);
  if (process.platform === "win32") {
    const pct = await sampleCpuUtilPercentFromCpuTimes();
    return {
      ...sync,
      cpuLoad1m: Number(((pct / 100) * cpus).toFixed(2)),
    };
  }
  return sync;
}

async function run(
  command: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}`.trim() });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
