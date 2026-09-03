import { NextResponse } from "next/server";
import { probeNvidiaSmi, sampleHostResourcesAsync } from "../../../../../lib/local-models/runtime-probes";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const host = await sampleHostResourcesAsync();
  const gpu = await probeNvidiaSmi();

  return NextResponse.json({
    sessionId: id,
    ts: new Date().toISOString(),
    cpuLoad1m: host.cpuLoad1m,
    ramUsedMb: host.ramUsedMb,
    ramTotalMb: host.ramTotalMb,
    gpu: {
      available: gpu.ok,
      name: gpu.gpuName ?? null,
      utilPercent: gpu.gpuUtilPercent ?? null,
      vramUsedMb: gpu.vramUsedMb ?? null,
      vramTotalMb: gpu.vramTotalMb ?? null,
      error: gpu.ok ? null : gpu.error ?? null,
    },
  });
}
