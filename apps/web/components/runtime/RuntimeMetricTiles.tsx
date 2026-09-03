"use client";

import type { ReactNode } from "react";

export interface RuntimeMetricsResult {
  logicalCpuCount?: number;
  cpuLoad1m: number;
  ramUsedMb: number;
  ramTotalMb: number;
  gpu: {
    available: boolean;
    name: string | null;
    utilPercent: number | null;
    vramUsedMb: number | null;
    vramTotalMb: number | null;
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Hue 120 (green) → 0 (red) as stress goes 0 → 1 */
export function runtimeStressBarColor(level: number): string {
  const t = clamp01(level);
  const hue = 120 * (1 - t);
  return `hsl(${hue} 72% 40%)`;
}

export function runtimeMetricLevels(m: RuntimeMetricsResult | null): {
  cpu: number;
  ram: number;
  gpuUtil: number;
  vram: number;
} {
  if (!m) return { cpu: 0, ram: 0, gpuUtil: 0, vram: 0 };
  const cpus = m.logicalCpuCount && m.logicalCpuCount > 0 ? m.logicalCpuCount : 4;
  const cpu = clamp01(m.cpuLoad1m / cpus);
  const ram = m.ramTotalMb > 0 ? clamp01(m.ramUsedMb / m.ramTotalMb) : 0;
  const gpuUtil = m.gpu.available ? clamp01((m.gpu.utilPercent ?? 0) / 100) : 0;
  const vramTotal = m.gpu.vramTotalMb ?? 0;
  const vram =
    m.gpu.available && vramTotal > 0 ? clamp01((m.gpu.vramUsedMb ?? 0) / vramTotal) : 0;
  return { cpu, ram, gpuUtil, vram };
}

export function RuntimeMetricTile(props: { title: string; value: ReactNode; level: number }) {
  const t = clamp01(props.level);
  return (
    <div className="metric-tile new-session-metric-tile">
      <div className="new-session-metric-body">
        <div className="metric-title">{props.title}</div>
        <div className="metric-value">{props.value}</div>
      </div>
      <div className="metric-stress-track" aria-hidden>
        <div
          className="metric-stress-fill"
          style={{
            width: `${t * 100}%`,
            backgroundColor: runtimeStressBarColor(t),
          }}
        />
      </div>
    </div>
  );
}

export function RuntimeMetricTilesGrid(props: {
  metrics: RuntimeMetricsResult | null;
  levels: ReturnType<typeof runtimeMetricLevels>;
  copy?: { srTitle: string };
}) {
  const { metrics, levels, copy } = props;
  return (
    <div className="card stack compact-stack new-session-monitoring-card status-runtime-monitoring-card">
      {copy ? <h2 className="sr-only">{copy.srTitle}</h2> : null}
      <div className="metrics-tiles new-session-runtime-metrics">
        <RuntimeMetricTile
          title="CPU"
          value={metrics ? `${Math.round(levels.cpu * 100)}%` : "…"}
          level={levels.cpu}
        />
        <RuntimeMetricTile
          title="RAM"
          value={metrics ? `${Math.round(levels.ram * 100)}%` : "…"}
          level={levels.ram}
        />
        <RuntimeMetricTile
          title="GPU util"
          value={metrics?.gpu.available ? `${Math.round(levels.gpuUtil * 100)}%` : "N/A"}
          level={levels.gpuUtil}
        />
        <RuntimeMetricTile
          title="VRAM"
          value={metrics?.gpu.available ? `${Math.round(levels.vram * 100)}%` : "N/A"}
          level={levels.vram}
        />
      </div>
    </div>
  );
}
