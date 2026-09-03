import os from "node:os";
import { NextResponse } from "next/server";
import { probeNvidiaSmi, sampleHostResourcesAsync } from "../../../../lib/local-models/runtime-probes";

export async function GET(): Promise<NextResponse> {
  const host = await sampleHostResourcesAsync();
  const gpu = await probeNvidiaSmi();
  return NextResponse.json({
    ts: new Date().toISOString(),
    logicalCpuCount: Math.max(1, os.cpus().length),
    cpuLoad1m: host.cpuLoad1m,
    ramUsedMb: host.ramUsedMb,
    ramTotalMb: host.ramTotalMb,
    gpu: {
      available: gpu.ok,
      name: gpu.gpuName ?? null,
      utilPercent: gpu.gpuUtilPercent ?? null,
      vramUsedMb: gpu.vramUsedMb ?? null,
      vramTotalMb: gpu.vramTotalMb ?? null,
    },
  });
}
