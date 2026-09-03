"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ArtifactTypeId } from "../../types/artifact.types";
import type { ModuleId, Scenario, ScenarioEdge, ScenarioStep } from "../../types/pipeline.types";
import { normalizeScenarioIds } from "../../lib/scenarios/scenario-normalize";
import { orderedScenarioSteps } from "../../lib/scenarios/scenario-order";
import {
  AUDIO_SOURCE_MODULE_IDS,
  LLM_PALETTE_MODULE_IDS,
  PIPELINE_MODULE_CATALOG,
  PROCESSING_MODULE_IDS,
} from "../../lib/pipeline/module-catalog";
import type { ModuleCatalogEntry } from "../../lib/pipeline/module-catalog";
import { isLlmPuppetModule, isLlmTaskSatellite } from "../../lib/pipeline/llm-orchestrator-modules";
import { readLlmRunOrder } from "../../lib/pipeline/llm-run-order";
import { isReportOutputAcceptedInput } from "../../lib/pipeline/report-output-inputs";
import { getDefaultModuleConfig } from "../../lib/pipeline/module-default-config";
import { artifactHex, artifactShortLabel } from "./artifact-colors";
import { MODULE_DRAG_MIME } from "./scenario-constants";
import { ModulePaletteFolderBar } from "./ModulePaletteFolderBar";
import { createDefaultGlobalSettings, readGlobalSettings } from "../../lib/settings/global-settings";

export interface GraphCanvasCopy {
  hint: string;
  deleteEdgeHint: string;
  portInTitle: string;
  /** Подсказка для единственного входа шага «Отчёт» (несколько типов артефактов). */
  reportMultiplexInTitle: string;
  /** Короткая подпись на плашке входа отчёта. */
  reportMultiplexInBadge: string;
  portOutTitle: string;
  paletteTitle: string;
  paletteDragHint: string;
  /** Группа источников аудио в палитре (кнопка-папка). */
  paletteSourceFolder: string;
  /** Группа обработки (APREP, ASR, диаризация, prosody). */
  paletteProcessingFolder: string;
  /** Группа LLM-модулей в палитре. */
  paletteLlmFolder: string;
  /** Доступное имя колонки с подсказками по холсту. */
  paletteInstructionsAria: string;
  removeStepTitle: string;
  llmRunOrderLabel: string;
  llmRunOrderHint: string;
  /** Подсказка для кнопки «подогнать схему в окно» (только aria/title). */
  fitToViewTitle: string;
}

const REPORT_IN_PORT = "__REPORT_IN__" as const;
type ScenarioInPortToken = ArtifactTypeId | typeof REPORT_IN_PORT;

function getScenarioOutputPorts(step: ScenarioStep, enforceGraphModulePortsMatchProgram: boolean): ArtifactTypeId[] {
  const base: ArtifactTypeId[] = (() => {
    if (!enforceGraphModulePortsMatchProgram) return step.produces;
    switch (step.moduleId) {
      case "AUDIO_FROM_UPLOAD":
      case "AUDIO_FROM_URL":
      case "AUDIO_FROM_API":
      case "AUDIO_FROM_RTSP":
        return ["AUDIO"];
      case "AUDIO_PREPARE":
        return ["AUDIO_PREPARED"];
      case "ASR":
        return ["TEXT"];
      case "DIARIZATION":
        return ["SPEAKER_SEGMENTS"];
      case "SPEAKER_TURN_MERGE":
        return ["DRAFT_SPEAKERS", "READY_SPEAKERS"];
      case "SPEAKER_DRAFT_EDIT":
        return ["READY_SPEAKERS"];
      case "PSYCH_STATE":
        return ["ENRICHED_TRANSCRIPT", "PSYCH_LABELS"];
      case "LLM_TASK_PSYCH":
        return ["LLM_SUBTASK", "LLM_PSYCH_LABELS", "LLM_PSYCH_NARRATIVE"];
      case "LLM_PUPPET":
        return ["SUMMARY_TEXT", "CHECKLIST_RESULTS", "PSYCH_LABELS", "PSYCH_NARRATIVE", "SPEAKER_IDENTITY_MAP"];
      default:
        return step.produces;
    }
  })();
  return applyArtifactOrder(step, base, "outputOrder");
}

function getScenarioInputPorts(
  step: ScenarioStep,
  opts: {
    enforceGraphModulePortsMatchProgram: boolean;
    showUniversalInputForReport: boolean;
  },
): Array<{
  key: string;
  token: ScenarioInPortToken;
  displayArt: ArtifactTypeId | null;
}> {
  if (opts.showUniversalInputForReport && step.moduleId === "REPORT_OUTPUT") {
    return [{ key: "report-in", token: REPORT_IN_PORT, displayArt: null }];
  }
  if (!opts.enforceGraphModulePortsMatchProgram) {
    return step.requires.map((art, i) => ({
      key: `in-${art}-${i}`,
      token: art,
      displayArt: art,
    }));
  }
  const requires: ArtifactTypeId[] = (() => {
    switch (step.moduleId) {
      case "AUDIO_FROM_UPLOAD":
      case "AUDIO_FROM_URL":
      case "AUDIO_FROM_API":
      case "AUDIO_FROM_RTSP":
        return [];
      case "AUDIO_PREPARE":
        return ["AUDIO"];
      case "ASR":
        return ["AUDIO_PREPARED", "AUDIO"];
      case "DIARIZATION":
        return ["AUDIO_PREPARED", "TEXT"];
      case "SPEAKER_TURN_MERGE":
        return ["SPEAKER_SEGMENTS"];
      case "SPEAKER_DRAFT_EDIT":
        return ["DRAFT_SPEAKERS"];
      case "PSYCH_STATE":
        return ["AUDIO_PREPARED", "READY_SPEAKERS"];
      case "LLM_TASK_PSYCH":
        return ["READY_SPEAKERS", "PSYCH_LABELS", "ENRICHED_TRANSCRIPT", "SPEAKER_IDENTITY_MAP"];
      case "LLM_TASK_SPEAKER_NAMES":
        return ["READY_SPEAKERS"];
      case "LLM_PUPPET":
        return ["LLM_SUBTASK"];
      default:
        return step.requires;
    }
  })();
  const orderedRequires = applyArtifactOrder(step, requires, "inputOrder");

  return orderedRequires.map((art, i) => ({
    key: `in-${art}-${i}`,
    token: art,
    displayArt: art,
  }));
}

function applyArtifactOrder(step: ScenarioStep, artifacts: ArtifactTypeId[], key: "inputOrder" | "outputOrder"): ArtifactTypeId[] {
  const raw = step.config?.[key];
  const order = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  if (order.length === 0) return artifacts;
  const idx = new Map(order.map((a, i) => [a, i]));
  return [...artifacts].sort((a, b) => {
    const ia = idx.get(a) ?? Number.MAX_SAFE_INTEGER;
    const ib = idx.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

function scenarioPortRowCount(
  step: ScenarioStep,
  opts: {
    enforceGraphModulePortsMatchProgram: boolean;
    showUniversalInputForReport: boolean;
  },
): number {
  const inCount = getScenarioInputPorts(step, opts).length;
  const outCount = Math.max(getScenarioOutputPorts(step, opts.enforceGraphModulePortsMatchProgram).length, 1);
  return Math.max(inCount, outCount, 1);
}

const NODE_W = 236;
const HEADER_H = 36;
/** Вертикальный шаг между центрами плашек портов. */
const PORT_GAP = 30;
const PORT_BADGE_H = 24;
const PORT_BADGE_RX = 6;
/** Плашка под полное имя типа; оценка ширины для пропорционального шрифта ~9px. */
const PORT_BADGE_PAD_X = 14;
const PORT_BADGE_CHAR_W = 6.85;
const PORT_BADGE_MIN_W = 80;
const PORT_BADGE_MAX_W = 168;
const BODY_TOP = 12;
/** Куда помещаем компактный preview `step.config` перед портами. */
const CONFIG_PREVIEW_H = 44;
const PAD_BOTTOM = 14;
const BEZIER_PAD = 72;
const MIN_CANVAS_ZOOM = 0.2;
const MAX_CANVAS_ZOOM = 5;
/** Сколько пикселей плашки торчит за границу модуля; остальное внутри карточки. */
const PORT_TAB_OUT = 10;
/** Размер кружка порта (ComfyUI-like). */
const PORT_DOT_R = 6;
/** Ширина невидимой hitbox-области вокруг точки. */
const PORT_DOT_HIT_W = 26;
/** Отступ до стенки модуля, чтобы точка порта была визуально внутри. */
const PORT_INNER_PAD_X = 10;
const TECHNICAL_OUTPUT_ARTIFACTS = new Set<ArtifactTypeId>(["LLM_SUBTASK", "LLM_INSTRUCTIONS"]);
type EdgeRenderMode = "bezier" | "orthogonal";

function readScenarioEdgeRenderMode(scenario: Scenario): EdgeRenderMode {
  const raw = scenario.config?.edgeRenderMode;
  return raw === "orthogonal" ? "orthogonal" : "bezier";
}

function portBadgeWidth(art: string): number {
  return Math.min(
    PORT_BADGE_MAX_W,
    Math.max(PORT_BADGE_MIN_W, Math.ceil(art.length * PORT_BADGE_CHAR_W + PORT_BADGE_PAD_X)),
  );
}

function readLayout(step: ScenarioStep): { x: number; y: number } | null {
  const raw = step.config?.layout;
  if (raw && typeof raw === "object" && "x" in raw && "y" in raw) {
    const x = (raw as { x: unknown }).x;
    const y = (raw as { y: unknown }).y;
    if (typeof x === "number" && typeof y === "number") return { x, y };
  }
  return null;
}

function defaultLayout(index: number): { x: number; y: number } {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { x: 40 + col * (NODE_W + 72), y: 40 + row * 188 };
}

function llmOrderRowHeight(step: ScenarioStep): number {
  void step;
  return 0;
}

function nodeHeight(
  step: ScenarioStep,
  opts: {
    enforceGraphModulePortsMatchProgram: boolean;
    showUniversalInputForReport: boolean;
  },
): number {
  const n = scenarioPortRowCount(step, opts);
  return (
    HEADER_H +
    BODY_TOP +
    llmOrderRowHeight(step) +
    configPreviewHeight(step) +
    n * PORT_GAP +
    PAD_BOTTOM
  );
}

function orthogonalRoundedPath(
  points: Array<{ x: number; y: number }>,
  radius = 12,
): string {
  type Pt = { x: number; y: number };
  const pts: Pt[] = points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: 0, y: 0 }];

  const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const toward = (from: Pt, to: Pt, d: number): Pt => {
    const len = Math.max(1e-6, dist(from, to));
    const t = Math.min(1, Math.max(0, d / len));
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  };

  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    const inLen = dist(prev, cur);
    const outLen = dist(cur, next);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (!Number.isFinite(r) || r < 0.5) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const pIn = toward(cur, prev, r);
    const pOut = toward(cur, next, r);
    d += ` L ${pIn.x} ${pIn.y} Q ${cur.x} ${cur.y} ${pOut.x} ${pOut.y}`;
  }
  d += ` L ${pts[pts.length - 1]!.x} ${pts[pts.length - 1]!.y}`;
  return d;
}

type Rect = { left: number; top: number; right: number; bottom: number };
type Dir = "U" | "D" | "L" | "R";
type PathPoint = { x: number; y: number };
type Segment = { a: PathPoint; b: PathPoint };
const ORTHOGONAL_MAX_BENDS = 4;
const ORTHOGONAL_CLEARANCE = 12;
const ORTHOGONAL_CROSS_PENALTY = 220;
const ORTHOGONAL_OVERLAP_PENALTY = 90;

function rectContainsPoint(r: Rect, p: { x: number; y: number }): boolean {
  return p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
}

function segmentHitsRect(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): boolean {
  if (a.x === b.x) {
    const x = a.x;
    if (x <= r.left || x >= r.right) return false;
    const yMin = Math.min(a.y, b.y);
    const yMax = Math.max(a.y, b.y);
    return yMax > r.top && yMin < r.bottom;
  }
  if (a.y === b.y) {
    const y = a.y;
    if (y <= r.top || y >= r.bottom) return false;
    const xMin = Math.min(a.x, b.x);
    const xMax = Math.max(a.x, b.x);
    return xMax > r.left && xMin < r.right;
  }
  return true;
}

function orthogonalFallbackPoints(x1: number, y1: number, x2: number, y2: number, viaX?: number): PathPoint[] {
  const midX = Number.isFinite(viaX as number) ? (viaX as number) : (x1 + x2) / 2;
  return [
    { x: x1, y: y1 },
    { x: midX, y: y1 },
    { x: midX, y: y2 },
    { x: x2, y: y2 },
  ];
}

function findOrthogonalRoutePoints(params: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  viaX?: number;
  obstacles: Rect[];
  occupiedSegments?: Segment[];
}): PathPoint[] | null {
  const { x1, y1, x2, y2, viaX, obstacles, occupiedSegments = [] } = params;
  const start = { x: x1, y: y1 };
  const end = { x: x2, y: y2 };

  const xs = new Set<number>([x1, x2, (x1 + x2) / 2, x1 + ORTHOGONAL_CLEARANCE, x2 - ORTHOGONAL_CLEARANCE]);
  const ys = new Set<number>([y1, y2, (y1 + y2) / 2]);
  if (Number.isFinite(viaX as number)) xs.add(viaX as number);
  for (const r of obstacles) {
    xs.add(r.left);
    xs.add(r.right);
    ys.add(r.top);
    ys.add(r.bottom);
  }

  const xVals = [...xs].sort((a, b) => a - b);
  const yVals = [...ys].sort((a, b) => a - b);
  const nodes: Array<{ x: number; y: number }> = [];
  const nodeByKey = new Map<string, number>();
  const keyOf = (x: number, y: number) => `${x}|${y}`;
  for (const x of xVals) {
    for (const y of yVals) {
      const p = { x, y };
      if (obstacles.some((r) => rectContainsPoint(r, p))) continue;
      const idx = nodes.length;
      nodes.push(p);
      nodeByKey.set(keyOf(x, y), idx);
    }
  }
  if (!nodeByKey.has(keyOf(start.x, start.y))) {
    nodeByKey.set(keyOf(start.x, start.y), nodes.length);
    nodes.push(start);
  }
  if (!nodeByKey.has(keyOf(end.x, end.y))) {
    nodeByKey.set(keyOf(end.x, end.y), nodes.length);
    nodes.push(end);
  }
  const startIdx = nodeByKey.get(keyOf(start.x, start.y));
  const endIdx = nodeByKey.get(keyOf(end.x, end.y));
  if (startIdx == null || endIdx == null) return null;

  const neighbors = new Map<number, number[]>();
  const addEdge = (a: number, b: number) => {
    const pa = nodes[a]!;
    const pb = nodes[b]!;
    if (obstacles.some((r) => segmentHitsRect(pa, pb, r))) return;
    const aa = neighbors.get(a) ?? [];
    aa.push(b);
    neighbors.set(a, aa);
    const bb = neighbors.get(b) ?? [];
    bb.push(a);
    neighbors.set(b, bb);
  };

  const byX = new Map<number, number[]>();
  const byY = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    const ax = byX.get(n.x) ?? [];
    ax.push(i);
    byX.set(n.x, ax);
    const ay = byY.get(n.y) ?? [];
    ay.push(i);
    byY.set(n.y, ay);
  });
  byX.forEach((ids) => {
    ids.sort((a, b) => nodes[a]!.y - nodes[b]!.y);
    for (let i = 1; i < ids.length; i++) addEdge(ids[i - 1]!, ids[i]!);
  });
  byY.forEach((ids) => {
    ids.sort((a, b) => nodes[a]!.x - nodes[b]!.x);
    for (let i = 1; i < ids.length; i++) addEdge(ids[i - 1]!, ids[i]!);
  });

  const direction = (a: { x: number; y: number }, b: { x: number; y: number }): Dir => {
    if (a.x === b.x) return b.y > a.y ? "D" : "U";
    return b.x > a.x ? "R" : "L";
  };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  const overlapLen1D = (a1: number, a2: number, b1: number, b2: number): number => {
    const l = Math.max(Math.min(a1, a2), Math.min(b1, b2));
    const r = Math.min(Math.max(a1, a2), Math.max(b1, b2));
    return Math.max(0, r - l);
  };
  const segmentPenalty = (a: PathPoint, b: PathPoint): number => {
    let penalty = 0;
    const vertical = a.x === b.x;
    for (const s of occupiedSegments) {
      const c = s.a;
      const d = s.b;
      const otherVertical = c.x === d.x;
      if (vertical !== otherVertical) {
        const vx = vertical ? a.x : c.x;
        const hy = vertical ? c.y : a.y;
        const vYMin = vertical ? Math.min(a.y, b.y) : Math.min(c.y, d.y);
        const vYMax = vertical ? Math.max(a.y, b.y) : Math.max(c.y, d.y);
        const hXMin = vertical ? Math.min(c.x, d.x) : Math.min(a.x, b.x);
        const hXMax = vertical ? Math.max(c.x, d.x) : Math.max(a.x, b.x);
        const crosses = vx > hXMin && vx < hXMax && hy > vYMin && hy < vYMax;
        if (crosses) penalty += ORTHOGONAL_CROSS_PENALTY;
      } else if (vertical) {
        if (a.x !== c.x) continue;
        const ov = overlapLen1D(a.y, b.y, c.y, d.y);
        if (ov > 0) penalty += ORTHOGONAL_OVERLAP_PENALTY + ov * 0.08;
      } else {
        if (a.y !== c.y) continue;
        const ov = overlapLen1D(a.x, b.x, c.x, d.x);
        if (ov > 0) penalty += ORTHOGONAL_OVERLAP_PENALTY + ov * 0.08;
      }
    }
    return penalty;
  };

  type State = { node: number; dir: Dir | null; bends: number; cost: number; parent: string | null };
  const stateKey = (node: number, dir: Dir | null, bends: number) => `${node}|${dir ?? "N"}|${bends}`;
  const best = new Map<string, State>();
  const open: State[] = [{ node: startIdx, dir: null, bends: 0, cost: 0, parent: null }];
  best.set(stateKey(startIdx, null, 0), open[0]!);

  let goal: State | null = null;
  while (open.length > 0) {
    open.sort((a, b) => a.cost - b.cost);
    const cur = open.shift()!;
    if (cur.node === endIdx && cur.dir === "R") {
      goal = cur;
      break;
    }
    const nextIds = neighbors.get(cur.node) ?? [];
    for (const nb of nextIds) {
      const nd = direction(nodes[cur.node]!, nodes[nb]!);
      if (cur.dir == null && nd !== "R") continue;
      const bends = cur.dir == null || cur.dir === nd ? cur.bends : cur.bends + 1;
      if (bends > ORTHOGONAL_MAX_BENDS) continue;
      const lengthCost = dist(nodes[cur.node]!, nodes[nb]!);
      const isVertical = nd === "D" || nd === "U";
      const lanePenalty =
        Number.isFinite(viaX as number) && isVertical
          ? Math.abs(nodes[cur.node]!.x - (viaX as number)) * 0.02
          : 0;
      const next: State = {
        node: nb,
        dir: nd,
        bends,
        cost: cur.cost + lengthCost + (cur.dir == null || cur.dir === nd ? 0 : 18) + lanePenalty,
        parent: stateKey(cur.node, cur.dir, cur.bends),
      };
      next.cost += segmentPenalty(nodes[cur.node]!, nodes[nb]!);
      const k = stateKey(next.node, next.dir, next.bends);
      const prev = best.get(k);
      if (!prev || next.cost < prev.cost) {
        best.set(k, next);
        open.push(next);
      }
    }
  }

  if (!goal) return null;
  const path: Array<{ x: number; y: number }> = [];
  let curKey: string | null = stateKey(goal.node, goal.dir, goal.bends);
  while (curKey) {
    const st = best.get(curKey);
    if (!st) break;
    path.push(nodes[st.node]!);
    curKey = st.parent;
  }
  path.reverse();
  if (path.length < 2) return null;
  return path;
}

function routeWithDraggedSegment(points: PathPoint[], segmentIndex: number, nextCoord: number): PathPoint[] {
  if (segmentIndex < 0 || segmentIndex >= points.length - 1) return points;
  const a = points[segmentIndex]!;
  const b = points[segmentIndex + 1]!;
  const vertical = a.x === b.x;
  if (!vertical && a.y !== b.y) return points;
  const lastSegIndex = points.length - 2;
  const isFirst = segmentIndex === 0;
  const isLast = segmentIndex === lastSegIndex;
  const out = points.map((p) => ({ ...p }));

  // Сегменты, примыкающие к порту узла (вход/выход), не двигаем по Y:
  // запрещаем "вверх/вниз" для горизонтальных крайних секций.
  if ((isFirst || isLast) && !vertical) return normalizeOrthogonalPoints(out);

  if (!isFirst && !isLast) {
    // Внутренний сегмент: параллельный сдвиг всей секции между двумя изломами.
    if (vertical) {
      out[segmentIndex]!.x = nextCoord;
      out[segmentIndex + 1]!.x = nextCoord;
    } else {
      out[segmentIndex]!.y = nextCoord;
      out[segmentIndex + 1]!.y = nextCoord;
    }
    return normalizeOrthogonalPoints(out);
  }

  if (isFirst) {
    // Крайний первый сегмент: автоматически добавляем 2 излома, чтобы двигалась секция, а порт оставался на месте.
    const p0 = points[0]!;
    const p1 = points[1]!;
    if (vertical) {
      const p0a = { x: nextCoord, y: p0.y };
      const p1a = { x: nextCoord, y: p1.y };
      return normalizeOrthogonalPoints([p0, p0a, p1a, ...points.slice(1)]);
    }
    const p0a = { x: p0.x, y: nextCoord };
    const p1a = { x: p1.x, y: nextCoord };
    return normalizeOrthogonalPoints([p0, p0a, p1a, ...points.slice(1)]);
  }

  // Крайний последний сегмент: автоматически добавляем 2 излома у входа в целевой порт.
  const pA = points[lastSegIndex]!;
  const pB = points[lastSegIndex + 1]!;
  if (vertical) {
    const pAa = { x: nextCoord, y: pA.y };
    const pBa = { x: nextCoord, y: pB.y };
    return normalizeOrthogonalPoints([...points.slice(0, lastSegIndex), pAa, pBa, pB]);
  }
  const pAa = { x: pA.x, y: nextCoord };
  const pBa = { x: pB.x, y: nextCoord };
  return normalizeOrthogonalPoints([...points.slice(0, lastSegIndex), pAa, pBa, pB]);
}

function normalizeOrthogonalPoints(points: PathPoint[]): PathPoint[] {
  if (points.length <= 2) return points;
  const dedup: PathPoint[] = [];
  for (const p of points) {
    const prev = dedup[dedup.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) dedup.push({ ...p });
  }
  if (dedup.length <= 2) return dedup;
  const out: PathPoint[] = [dedup[0]!];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = dedup[i]!;
    const c = dedup[i + 1]!;
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(dedup[dedup.length - 1]!);
  return out;
}

function toSegments(points: PathPoint[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.x === b.x || a.y === b.y) out.push({ a, b });
  }
  return out;
}

function anchorOverrideToPorts(points: PathPoint[], start: PathPoint, end: PathPoint): PathPoint[] {
  if (points.length < 2) return [start, end];
  const out = points.map((p) => ({ ...p }));

  const p1 = out[1];
  if (p1) {
    const firstWasVertical = out[0]!.x === p1.x;
    out[0] = { x: start.x, y: start.y };
    out[1] = firstWasVertical ? { x: start.x, y: p1.y } : { x: p1.x, y: start.y };
  } else {
    out[0] = { x: start.x, y: start.y };
  }

  const last = out.length - 1;
  const prev = out[last - 1];
  if (prev) {
    const lastWasVertical = prev.x === out[last]!.x;
    out[last] = { x: end.x, y: end.y };
    out[last - 1] = lastWasVertical ? { x: end.x, y: prev.y } : { x: prev.x, y: end.y };
  } else {
    out[last] = { x: end.x, y: end.y };
  }

  return normalizeOrthogonalPoints(out);
}

function configPreviewLines(step: ScenarioStep): string[] {
  void step;
  return [];
}

function configPreviewHeight(step: ScenarioStep): number {
  return configPreviewLines(step).length > 0 ? CONFIG_PREVIEW_H : 0;
}

function portCenterY(step: ScenarioStep, portIndex: number): number {
  return (
    HEADER_H +
    BODY_TOP +
    llmOrderRowHeight(step) +
    configPreviewHeight(step) +
    portIndex * PORT_GAP +
    PORT_GAP / 2
  );
}

function configBlockTop(step: ScenarioStep): number {
  return HEADER_H + BODY_TOP + llmOrderRowHeight(step);
}

function normalizeIds(
  scenario: Scenario,
  process: { enforceGraphModulePortsMatchProgram: boolean },
): Scenario {
  return normalizeScenarioIds(scenario, process);
}

function isModuleId(s: string): s is ModuleId {
  return PIPELINE_MODULE_CATALOG.some((m) => m.id === s);
}

/** Код вида step_7 из дропа/добавления — не показываем рядом с #порядок, чтобы не путать с номером в конвейере. */
function isDefaultAutoStepCode(code: string): boolean {
  return /^step_\d+$/.test(code.trim());
}

function nodeTooltipTitle(params: {
  label: string;
  moduleId: string;
  order: number | undefined;
  stepCode: string;
}): string {
  const head = `${params.label} (${params.moduleId})`;
  const ord = params.order != null ? ` · в графе: #${params.order}` : "";
  const codeExtra =
    params.stepCode && !isDefaultAutoStepCode(params.stepCode)
      ? ` · код шага: ${params.stepCode}`
      : "";
  return `${head}${ord}${codeExtra}`;
}

function normalizeSubtaskOrderForPuppet(params: {
  scenario: Scenario;
  puppetStepId: string;
  targetSubtaskStepId: string;
  targetOrder: number;
}): Scenario {
  const subtaskEdges = params.scenario.edges.filter(
    (e) => e.toStepId === params.puppetStepId && e.artifactTypeId === "LLM_SUBTASK",
  );
  if (subtaskEdges.length === 0) return params.scenario;
  const byId = new Map(params.scenario.steps.map((s) => [s.id, s]));
  const subtasks = subtaskEdges
    .map((e) => byId.get(e.fromStepId))
    .filter((s): s is ScenarioStep => Boolean(s) && isLlmTaskSatellite(s!.moduleId));
  if (subtasks.length === 0) return params.scenario;

  const uniq = new Map<string, ScenarioStep>();
  for (const st of subtasks) uniq.set(st.id, st);
  const ordered = [...uniq.values()].sort((a, b) => {
    const da = readLlmRunOrder(a);
    const db = readLlmRunOrder(b);
    if (da !== db) return da - db;
    if (a.orderHint !== b.orderHint) return a.orderHint - b.orderHint;
    return a.id.localeCompare(b.id);
  });
  const currentIndex = ordered.findIndex((s) => s.id === params.targetSubtaskStepId);
  if (currentIndex < 0) return params.scenario;
  const clampedOrder = Math.max(1, Math.min(ordered.length, Math.round(params.targetOrder)));
  const targetIndex = clampedOrder - 1;
  const [picked] = ordered.splice(currentIndex, 1);
  ordered.splice(targetIndex, 0, picked);

  const rankByStepId = new Map<string, number>();
  ordered.forEach((s, idx) => rankByStepId.set(s.id, idx + 1));
  return {
    ...params.scenario,
    steps: params.scenario.steps.map((s) => {
      const rank = rankByStepId.get(s.id);
      if (!rank) return s;
      return { ...s, config: { ...s.config, llmRunOrder: rank } };
    }),
  };
}

export function ScenarioGraphCanvas({
  scenario,
  onChange,
  copy,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  copy: GraphCanvasCopy;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [processSettings, setProcessSettings] = useState(() => createDefaultGlobalSettings().process);
  const processPortOpts = useMemo(
    () => ({
      enforceGraphModulePortsMatchProgram: processSettings.enforceGraphModulePortsMatchProgram,
      showUniversalInputForReport: processSettings.showUniversalInputForReport,
    }),
    [processSettings],
  );

  useEffect(() => {
    setProcessSettings(readGlobalSettings().process);
    function onGlobalSettingsChanged(e: Event) {
      const detail = (e as CustomEvent<{ process?: typeof processSettings }>).detail;
      if (detail?.process) {
        setProcessSettings(detail.process);
        return;
      }
      setProcessSettings(readGlobalSettings().process);
    }
    window.addEventListener("ctyk:globalSettingsChanged", onGlobalSettingsChanged);
    return () => window.removeEventListener("ctyk:globalSettingsChanged", onGlobalSettingsChanged);
  }, []);

  const [dragLive, setDragLive] = useState<{ stepId: string; x: number; y: number } | null>(null);

  const orderedSteps = useMemo(() => orderedScenarioSteps(scenario), [scenario]);

  const moduleLabelById = useMemo(
    () => new Map(PIPELINE_MODULE_CATALOG.map((m) => [m.id, m.label])),
    [],
  );

  const audioSourceIdSet = useMemo(() => new Set<ModuleId>(AUDIO_SOURCE_MODULE_IDS), []);
  const processingIdSet = useMemo(() => new Set<ModuleId>(PROCESSING_MODULE_IDS), []);
  const paletteGroupedIdSet = useMemo(
    () =>
      new Set<ModuleId>([
        ...AUDIO_SOURCE_MODULE_IDS,
        ...PROCESSING_MODULE_IDS,
        ...LLM_PALETTE_MODULE_IDS,
      ]),
    [],
  );
  const audioSourceEntries = useMemo(
    () => PIPELINE_MODULE_CATALOG.filter((m) => audioSourceIdSet.has(m.id)),
    [audioSourceIdSet],
  );
  const processingEntries = useMemo(
    () => PIPELINE_MODULE_CATALOG.filter((m) => processingIdSet.has(m.id)),
    [processingIdSet],
  );
  const llmPaletteEntries = useMemo(() => {
    const byId = new Map(PIPELINE_MODULE_CATALOG.map((m) => [m.id, m]));
    return LLM_PALETTE_MODULE_IDS.map((id) => byId.get(id)!);
  }, []);
  const paletteRestModules = useMemo(
    () => PIPELINE_MODULE_CATALOG.filter((m) => !paletteGroupedIdSet.has(m.id)),
    [paletteGroupedIdSet],
  );

  const bindModuleDrag = useCallback((m: ModuleCatalogEntry) => {
    return (e: React.DragEvent<HTMLButtonElement>) => {
      e.dataTransfer.setData(MODULE_DRAG_MIME, m.id);
      e.dataTransfer.setData("text/plain", m.id);
      e.dataTransfer.effectAllowed = "copy";
    };
  }, []);

  const stepOrderIndex = useMemo(() => {
    const m = new Map<string, number>();
    orderedSteps.forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [orderedSteps]);

  const stepLayouts = useMemo(() => {
    const map = new Map<string, { x: number; y: number; h: number }>();
    scenario.steps.forEach((step) => {
      const logicalIdx = stepOrderIndex.get(step.id);
      const gridIndex = logicalIdx != null ? logicalIdx - 1 : scenario.steps.indexOf(step);
      const base = readLayout(step) ?? defaultLayout(Math.max(0, gridIndex));
      const live = dragLive?.stepId === step.id ? dragLive : null;
      const l = live ? { x: live.x, y: live.y } : base;
      map.set(step.id, { ...l, h: nodeHeight(step, processPortOpts) });
    });
    return map;
  }, [scenario.steps, dragLive, stepOrderIndex, processPortOpts]);

  const viewBoxParts = useMemo(() => {
    if (scenario.steps.length === 0) {
      return { vx: 0, vy: 0, vw: 920, vh: 420 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const step of scenario.steps) {
      const b = stepLayouts.get(step.id);
      if (!b) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + NODE_W);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const pad = 48;
    return {
      vx: minX - pad,
      vy: minY - pad,
      vw: maxX - minX + pad * 2,
      vh: maxY - minY + pad * 2,
    };
  }, [scenario.steps, stepLayouts]);

  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasPanning, setCanvasPanning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<null | { clientX: number; clientY: number }>(null);
  const [edgeRenderMode, setEdgeRenderMode] = useState<EdgeRenderMode>(() => readScenarioEdgeRenderMode(scenario));
  const [gridEnabled, setGridEnabled] = useState(true);
  const [gridSize, setGridSize] = useState(40);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [dropHighlight, setDropHighlight] = useState(false);
  const canvasPanRef = useRef({ x: 0, y: 0 });
  canvasPanRef.current = canvasPan;
  const canvasZoomRef = useRef(1);
  canvasZoomRef.current = canvasZoom;
  const viewBoxPartsRef = useRef(viewBoxParts);
  viewBoxPartsRef.current = viewBoxParts;

  const zEff = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, canvasZoom));
  const vbW = viewBoxParts.vw / zEff;
  const vbH = viewBoxParts.vh / zEff;
  const vbX = viewBoxParts.vx + canvasPan.x;
  const vbY = viewBoxParts.vy + canvasPan.y;
  const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;
  const viewportRef = useRef({ vbX, vbY, vbW, vbH });
  const prevBoundsRef = useRef(viewBoxParts);
  const fitInProgressRef = useRef(false);
  useLayoutEffect(() => {
    viewportRef.current = { vbX, vbY, vbW, vbH };
  }, [vbX, vbY, vbW, vbH]);

  const svgWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onFsChange() {
      const el = svgWrapRef.current;
      const on = Boolean(el && document.fullscreenElement === el);
      setIsFullscreen(on);
      if (!on) setCtxMenu(null);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    onFsChange();
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    setEdgeRenderMode(readScenarioEdgeRenderMode(scenario));
  }, [scenario.id, scenario.config]);

  useEffect(() => {
    const alive = new Set(scenario.edges.map((e) => e.id));
    setEdgeRouteOverrides((prev) => {
      const next: Record<string, PathPoint[]> = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev)) {
        if (alive.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [scenario.edges]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setCtxMenu(null);
    }
    function onPointerDown(e: PointerEvent) {
      const menu = svgWrapRef.current?.querySelector("[data-ctx-menu='1']");
      const t = e.target as Node | null;
      if (menu && t && menu.contains(t)) return;
      setCtxMenu(null);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const pt = el.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = el.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const clientToSvgRef = useRef(clientToSvg);
  clientToSvgRef.current = clientToSvg;

  const [connect, setConnect] = useState<{
    fromStepId: string;
    artifactTypeId: ArtifactTypeId;
    x0: number;
    y0: number;
  } | null>(null);

  const [pointerSvg, setPointerSvg] = useState<{ x: number; y: number } | null>(null);
  const [openedEdgeOrderMenuId, setOpenedEdgeOrderMenuId] = useState<string | null>(null);
  const [edgeRouteOverrides, setEdgeRouteOverrides] = useState<Record<string, PathPoint[]>>({});
  const [portReorderPreview, setPortReorderPreview] = useState<null | {
    stepId: string;
    side: "in" | "out";
    fromIndex: number;
    toIndex: number;
  }>(null);

  const usedInputCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of scenario.edges) {
      const key = `${e.toStepId}::${e.artifactTypeId}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [scenario.edges]);
  const usedOutputCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of scenario.edges) {
      const key = `${e.fromStepId}::${e.artifactTypeId}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [scenario.edges]);

  const llmSubtaskOrderMetaByEdgeId = useMemo(() => {
    const stepById = new Map(scenario.steps.map((s) => [s.id, s]));
    const grouped = new Map<string, Array<{ edgeId: string; fromStep: ScenarioStep }>>();
    for (const e of scenario.edges) {
      if (e.artifactTypeId !== "LLM_SUBTASK") continue;
      const to = stepById.get(e.toStepId);
      const from = stepById.get(e.fromStepId);
      if (!to || !from) continue;
      if (!isLlmPuppetModule(to.moduleId) || !isLlmTaskSatellite(from.moduleId)) continue;
      const arr = grouped.get(to.id) ?? [];
      arr.push({ edgeId: e.id, fromStep: from });
      grouped.set(to.id, arr);
    }
    const out = new Map<string, { order: number; total: number }>();
    for (const rows of grouped.values()) {
      rows.sort((a, b) => {
        const da = readLlmRunOrder(a.fromStep);
        const db = readLlmRunOrder(b.fromStep);
        if (da !== db) return da - db;
        return a.fromStep.id.localeCompare(b.fromStep.id);
      });
      const total = rows.length;
      rows.forEach((r, idx) => out.set(r.edgeId, { order: idx + 1, total }));
    }
    return out;
  }, [scenario.edges, scenario.steps]);

  const edgeSiblingOffsetsById = useMemo(() => {
    const outMap = new Map<string, number>();
    const inMap = new Map<string, number>();
    const groupsOut = new Map<string, string[]>();
    const groupsIn = new Map<string, string[]>();
    const edgeById = new Map(scenario.edges.map((e) => [e.id, e]));
    const stepById = new Map(scenario.steps.map((s) => [s.id, s]));
    for (const e of scenario.edges) {
      const outKey = `${e.fromStepId}::${e.artifactTypeId}`;
      const inKey =
        processSettings.showUniversalInputForReport &&
        scenario.steps.find((s) => s.id === e.toStepId)?.moduleId === "REPORT_OUTPUT"
          ? `${e.toStepId}::__REPORT_IN__`
          : `${e.toStepId}::${e.artifactTypeId}`;
      const arrO = groupsOut.get(outKey) ?? [];
      arrO.push(e.id);
      groupsOut.set(outKey, arrO);
      const arrI = groupsIn.get(inKey) ?? [];
      arrI.push(e.id);
      groupsIn.set(inKey, arrI);
    }
    const spread = (ids: string[], target: Map<string, number>, mode: "out" | "in") => {
      const ranked = [...ids]
        .map((id) => {
          const e = edgeById.get(id);
          if (!e) return { id, rank: 0 };
          const from = stepById.get(e.fromStepId);
          const to = stepById.get(e.toStepId);
          if (!from || !to) return { id, rank: 0 };

          const outPorts = getScenarioOutputPorts(from, processSettings.enforceGraphModulePortsMatchProgram);
          const oi = outPorts.indexOf(e.artifactTypeId);
          const inPorts = getScenarioInputPorts(to, processPortOpts);
          const ii = inPorts.findIndex(
            (p) =>
              p.token === e.artifactTypeId ||
              (processSettings.showUniversalInputForReport && to.moduleId === "REPORT_OUTPUT" && p.token === REPORT_IN_PORT),
          );
          const bf = stepLayouts.get(from.id);
          const bt = stepLayouts.get(to.id);
          if (!bf || !bt) return { id, rank: 0 };
          const yOut = bf.y + (oi >= 0 ? portCenterY(from, oi) : 0);
          const yIn = bt.y + (ii >= 0 ? portCenterY(to, ii) : 0);
          // Для исходящих групп сортируем по точке входа в цель; для входящих — по точке выхода источника.
          return { id, rank: mode === "out" ? yIn : yOut };
        })
        .sort((a, b) => (a.rank === b.rank ? a.id.localeCompare(b.id) : a.rank - b.rank));
      const sorted = ranked.map((x) => x.id);
      const n = sorted.length;
      const maxSpread = PORT_DOT_R * 2; // крайние линии не дальше диаметра точки
      sorted.forEach((id, idx) => {
        const offset = n <= 1 ? 0 : -maxSpread / 2 + (idx * maxSpread) / (n - 1);
        target.set(id, offset);
      });
    };
    groupsOut.forEach((ids) => spread(ids, outMap, "out"));
    groupsIn.forEach((ids) => spread(ids, inMap, "in"));
    return { out: outMap, in: inMap };
  }, [
    scenario.edges,
    scenario.steps,
    stepLayouts,
    processSettings.showUniversalInputForReport,
    processSettings.enforceGraphModulePortsMatchProgram,
    processPortOpts,
  ]);

  const orthogonalLaneXByEdgeId = useMemo(() => {
    const edgeById = new Map(scenario.edges.map((e) => [e.id, e]));
    const stepById = new Map(scenario.steps.map((s) => [s.id, s]));
    const outGroups = new Map<string, string[]>();
    const inGroups = new Map<string, string[]>();

    for (const e of scenario.edges) {
      const outKey = `${e.fromStepId}::${e.artifactTypeId}`;
      const inKey =
        processSettings.showUniversalInputForReport &&
        scenario.steps.find((s) => s.id === e.toStepId)?.moduleId === "REPORT_OUTPUT"
          ? `${e.toStepId}::__REPORT_IN__`
          : `${e.toStepId}::${e.artifactTypeId}`;
      const o = outGroups.get(outKey) ?? [];
      o.push(e.id);
      outGroups.set(outKey, o);
      const i = inGroups.get(inKey) ?? [];
      i.push(e.id);
      inGroups.set(inKey, i);
    }

    const outOffset = new Map<string, number>();
    const inOffset = new Map<string, number>();
    const spreadOffsets = (
      ids: string[],
      mode: "out" | "in",
      target: Map<string, number>,
      stepPx = 16,
      maxPx = 56,
    ) => {
      const ranked = [...ids]
        .map((id) => {
          const e = edgeById.get(id);
          if (!e) return { id, rank: 0 };
          const from = stepById.get(e.fromStepId);
          const to = stepById.get(e.toStepId);
          const bf = from ? stepLayouts.get(from.id) : null;
          const bt = to ? stepLayouts.get(to.id) : null;
          if (!from || !to || !bf || !bt) return { id, rank: 0 };
          const outPorts = getScenarioOutputPorts(from, processSettings.enforceGraphModulePortsMatchProgram);
          const oi = outPorts.indexOf(e.artifactTypeId);
          const inPorts = getScenarioInputPorts(to, processPortOpts);
          const ii = inPorts.findIndex(
            (p) =>
              p.token === e.artifactTypeId ||
              (processSettings.showUniversalInputForReport && to.moduleId === "REPORT_OUTPUT" && p.token === REPORT_IN_PORT),
          );
          const yOut = bf.y + (oi >= 0 ? portCenterY(from, oi) : 0);
          const yIn = bt.y + (ii >= 0 ? portCenterY(to, ii) : 0);
          return { id, rank: mode === "out" ? yIn : yOut };
        })
        .sort((a, b) => (a.rank === b.rank ? a.id.localeCompare(b.id) : a.rank - b.rank));
      const n = ranked.length;
      const center = (n - 1) / 2;
      ranked.forEach((r, idx) => {
        const raw = (idx - center) * stepPx;
        target.set(r.id, Math.max(-maxPx, Math.min(maxPx, raw)));
      });
    };

    outGroups.forEach((ids) => spreadOffsets(ids, "out", outOffset));
    inGroups.forEach((ids) => spreadOffsets(ids, "in", inOffset));

    const lane = new Map<string, number>();
    for (const e of scenario.edges) {
      const from = stepById.get(e.fromStepId);
      const to = stepById.get(e.toStepId);
      const bf = from ? stepLayouts.get(from.id) : null;
      const bt = to ? stepLayouts.get(to.id) : null;
      if (!bf || !bt) continue;
      const x1 = bf.x + NODE_W;
      const x2 = bt.x;
      const minX = Math.min(x1, x2) + 12;
      const maxX = Math.max(x1, x2) - 12;
      if (maxX <= minX) {
        lane.set(e.id, (x1 + x2) / 2);
        continue;
      }
      const base = (x1 + x2) / 2;
      const shift = (outOffset.get(e.id) ?? 0) * 0.75 + (inOffset.get(e.id) ?? 0) * 0.75;
      const candidate = base + shift;
      lane.set(e.id, Math.max(minX, Math.min(maxX, candidate)));
    }
    return lane;
  }, [
    scenario.edges,
    scenario.steps,
    stepLayouts,
    processSettings.showUniversalInputForReport,
    processSettings.enforceGraphModulePortsMatchProgram,
    processPortOpts,
  ]);

  const orthogonalPointsByEdgeId = useMemo(() => {
    if (edgeRenderMode !== "orthogonal") return new Map<string, PathPoint[]>();
    const stepById = new Map(scenario.steps.map((s) => [s.id, s]));
    const edgesOrdered = [...scenario.edges].sort((a, b) => {
      const af = stepById.get(a.fromStepId);
      const at = stepById.get(a.toStepId);
      const bf = stepById.get(b.fromStepId);
      const bt = stepById.get(b.toStepId);
      const ea = af && at ? edgeEndpoints(af, at, a) : null;
      const eb = bf && bt ? edgeEndpoints(bf, bt, b) : null;
      const da = ea ? Math.abs(ea.x2 - ea.x1) + Math.abs(ea.y2 - ea.y1) : 0;
      const db = eb ? Math.abs(eb.x2 - eb.x1) + Math.abs(eb.y2 - eb.y1) : 0;
      return db - da;
    });
    const occupied: Segment[] = [];
    const out = new Map<string, PathPoint[]>();
    for (const edge of edgesOrdered) {
      const from = stepById.get(edge.fromStepId);
      const to = stepById.get(edge.toStepId);
      if (!from || !to) continue;
      const ep = edgeEndpoints(from, to, edge);
      if (!ep) continue;
      const obstacles: Rect[] = scenario.steps
        .filter((s) => s.id !== from.id && s.id !== to.id)
        .map((s) => {
          const b = stepLayouts.get(s.id)!;
          return {
            left: b.x - ORTHOGONAL_CLEARANCE,
            top: b.y - ORTHOGONAL_CLEARANCE,
            right: b.x + NODE_W + ORTHOGONAL_CLEARANCE,
            bottom: b.y + b.h + ORTHOGONAL_CLEARANCE,
          };
        });
      // Если выход правее входа (ребро "идёт назад"), заставляем маршрут огибать оба связанных модуля.
      if (ep.x1 > ep.x2) {
        const bf = stepLayouts.get(from.id);
        const bt = stepLayouts.get(to.id);
        if (bf) {
          obstacles.push({
            left: bf.x,
            top: bf.y,
            right: bf.x + NODE_W,
            bottom: bf.y + bf.h,
          });
        }
        if (bt) {
          obstacles.push({
            left: bt.x,
            top: bt.y,
            right: bt.x + NODE_W,
            bottom: bt.y + bt.h,
          });
        }
      }
      const points = normalizeOrthogonalPoints(
        findOrthogonalRoutePoints({
          x1: ep.x1,
          y1: ep.y1,
          x2: ep.x2,
          y2: ep.y2,
          viaX: orthogonalLaneXByEdgeId.get(edge.id),
          obstacles,
          occupiedSegments: occupied,
        }) ?? orthogonalFallbackPoints(ep.x1, ep.y1, ep.x2, ep.y2, orthogonalLaneXByEdgeId.get(edge.id)),
      );
      out.set(edge.id, points);
      const overridden = edgeRouteOverrides[edge.id];
      const finalPoints =
        overridden && overridden.length >= 2
          ? anchorOverrideToPorts(overridden, { x: ep.x1, y: ep.y1 }, { x: ep.x2, y: ep.y2 })
          : points;
      out.set(edge.id, finalPoints);
      occupied.push(...toSegments(finalPoints));
    }
    return out;
  }, [
    edgeRenderMode,
    scenario.edges,
    scenario.steps,
    stepLayouts,
    orthogonalLaneXByEdgeId,
    edgeRouteOverrides,
  ]);

  const patchStepLayout = useCallback(
    (stepId: string, x: number, y: number) => {
      const movedStep = scenario.steps.find((s) => s.id === stepId);
      if (!movedStep) return;
      const logicalIdx = stepOrderIndex.get(stepId);
      const gridIndex = logicalIdx != null ? logicalIdx - 1 : scenario.steps.findIndex((s) => s.id === stepId);
      const prevLayout = readLayout(movedStep) ?? defaultLayout(Math.max(0, gridIndex));
      const dx = x - prevLayout.x;
      const dy = y - prevLayout.y;
      if (dx !== 0 || dy !== 0) {
        setEdgeRouteOverrides((prev) => {
          let changed = false;
          const next: Record<string, PathPoint[]> = { ...prev };
          for (const e of scenario.edges) {
            const pts = prev[e.id];
            if (!pts || pts.length < 2) continue;
            const copy = pts.map((p) => ({ ...p }));
            if (e.fromStepId === stepId && copy.length >= 2) {
              const p0 = copy[0]!;
              const p1 = copy[1]!;
              const firstVertical = p0.x === p1.x;
              copy[1] = {
                x: firstVertical ? p1.x + dx : p1.x,
                y: firstVertical ? p1.y : p1.y + dy,
              };
            }
            if (e.toStepId === stepId && copy.length >= 2) {
              const i = copy.length - 2;
              const pA = copy[i]!;
              const pB = copy[i + 1]!;
              const lastVertical = pA.x === pB.x;
              copy[i] = {
                x: lastVertical ? pA.x + dx : pA.x,
                y: lastVertical ? pA.y : pA.y + dy,
              };
            }
            const normalized = normalizeOrthogonalPoints(copy);
            const same =
              normalized.length === pts.length &&
              normalized.every((p, i) => p.x === pts[i]!.x && p.y === pts[i]!.y);
            if (!same) {
              next[e.id] = normalized;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      const steps = scenario.steps.map((s) =>
        s.id === stepId
          ? {
              ...s,
              config: { ...s.config, layout: { x, y } },
            }
          : s,
      );
      onChange(normalizeIds({ ...scenario, steps }, processSettings));
    },
    [scenario, onChange, processSettings, stepOrderIndex],
  );

  const addEdge = useCallback(
    (fromStepId: string, toStepId: string, artifactTypeId: ArtifactTypeId) => {
      if (fromStepId === toStepId) return;
      const dup = scenario.edges.some(
        (e) =>
          e.fromStepId === fromStepId &&
          e.toStepId === toStepId &&
          e.artifactTypeId === artifactTypeId,
      );
      if (dup) return;
      const fromStep = scenario.steps.find((s) => s.id === fromStepId);
      const toStep = scenario.steps.find((s) => s.id === toStepId);
      if (!toStep) return;
      if (
        !fromStep ||
        !getScenarioOutputPorts(fromStep, processSettings.enforceGraphModulePortsMatchProgram).includes(
          artifactTypeId,
        )
      )
        return;
      if (processSettings.showUniversalInputForReport && toStep.moduleId === "REPORT_OUTPUT") {
        if (!isReportOutputAcceptedInput(artifactTypeId)) return;
      } else {
        const allowedInputs = new Set(
          getScenarioInputPorts(toStep, processPortOpts)
            .map((p) => p.displayArt)
            .filter((a): a is ArtifactTypeId => a != null),
        );
        const isSubtaskEdge =
          toStep != null && isLlmPuppetModule(toStep.moduleId) && artifactTypeId === "LLM_SUBTASK";
        if (!allowedInputs.has(artifactTypeId) && !isSubtaskEdge) return;
      }
      const edge: ScenarioEdge = {
        id: `edge_${Date.now()}`,
        scenarioId: scenario.id,
        fromStepId,
        toStepId,
        artifactTypeId,
      };
      onChange(normalizeIds({ ...scenario, edges: [...scenario.edges, edge] }, processSettings));
    },
    [scenario, onChange, processSettings, processPortOpts],
  );

  const removeEdge = useCallback(
    (edgeId: string) => {
      onChange(
        normalizeIds(
          {
          ...scenario,
          edges: scenario.edges.filter((e) => e.id !== edgeId),
          },
          processSettings,
        ),
      );
    },
    [scenario, onChange, processSettings],
  );

  const removeStepById = useCallback(
    (stepId: string) => {
      const steps = scenario.steps.filter((s) => s.id !== stepId);
      const edges = scenario.edges.filter(
        (e) => e.fromStepId !== stepId && e.toStepId !== stepId,
      );
      onChange(normalizeIds({ ...scenario, steps, edges }, processSettings));
    },
    [scenario, onChange, processSettings],
  );

  const dropModuleAt = useCallback(
    (moduleId: ModuleId, x: number, y: number) => {
      const entry = PIPELINE_MODULE_CATALOG.find((m) => m.id === moduleId);
      if (!entry) return;
      const nextStepCode = (() => {
        const used = new Set(scenario.steps.map((s) => s.code));
        const nums = scenario.steps
          .map((s) => {
            const m = /^step_(\d+)$/.exec(s.code);
            return m ? Number(m[1]) : null;
          })
          .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
        let i = Math.max(1, (nums.length ? Math.max(...nums) : 0) + 1);
        while (used.has(`step_${i}`)) i++;
        return `step_${i}`;
      })();
      const gx = snapToGrid ? Math.round(x / gridSize) * gridSize : x;
      const gy = snapToGrid ? Math.round(y / gridSize) * gridSize : y;
      const st: ScenarioStep = {
        id: `step_${Date.now()}`,
        scenarioId: scenario.id,
        moduleId: entry.id,
        code: nextStepCode,
        orderHint: scenario.steps.length + 1,
        config: { ...getDefaultModuleConfig(entry.id), layout: { x: gx, y: gy } },
        requires: [...entry.typicalRequires],
        produces: [...entry.typicalProduces],
      };
      onChange(normalizeIds({ ...scenario, steps: [...scenario.steps, st] }, processSettings));
    },
    [scenario, onChange, processSettings, snapToGrid, gridSize],
  );

  const addModuleFromMenu = useCallback(
    (moduleId: ModuleId, placement: "center" | "left") => {
      const v = viewportRef.current;
      const x = placement === "left" ? v.vbX + Math.max(40, Math.min(220, v.vbW * 0.12)) : v.vbX + v.vbW * 0.55;
      const y = v.vbY + v.vbH * 0.35;
      dropModuleAt(moduleId, x, y);
    },
    [dropModuleAt],
  );

  const toggleFullscreen = useCallback(async () => {
    const el = svgWrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // fullscreen может быть запрещён политикой браузера/пользователем
    }
  }, []);

  const dragRef = useRef<{ stepId: string; dx: number; dy: number; x: number; y: number } | null>(
    null,
  );
  const portReorderRef = useRef<null | { stepId: string; side: "in" | "out"; fromIndex: number }>(null);
  const connectActiveRef = useRef(false);
  const patchRef = useRef(patchStepLayout);
  const clientRef = useRef(clientToSvg);
  const edgeSegmentDragRef = useRef<null | {
    edgeId: string;
    segmentIndex: number;
    orientation: "vertical" | "horizontal";
    startClientX: number;
    startClientY: number;
    startCoord: number;
    basePoints: PathPoint[];
  }>(null);
  patchRef.current = patchStepLayout;
  clientRef.current = clientToSvg;

  const canvasPanDragRef = useRef<{
    clientX: number;
    clientY: number;
    startPanX: number;
    startPanY: number;
    vw: number;
    vh: number;
  } | null>(null);

  const reorderPorts = useCallback(
    (stepId: string, side: "in" | "out", fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const step = scenario.steps.find((s) => s.id === stepId);
      if (!step) return;
      const current =
        side === "in"
          ? getScenarioInputPorts(step, processPortOpts)
              .map((p) => p.displayArt)
              .filter((a): a is ArtifactTypeId => a != null)
          : getScenarioOutputPorts(step, processSettings.enforceGraphModulePortsMatchProgram);
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length) return;
      const next = [...current];
      const [picked] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, picked);
      const steps = scenario.steps.map((s) =>
        s.id === stepId
          ? {
              ...s,
              config: {
                ...s.config,
                ...(side === "in" ? { inputOrder: next } : { outputOrder: next }),
              },
            }
          : s,
      );
      onChange(normalizeIds({ ...scenario, steps }, processSettings));
    },
    [scenario, onChange, processSettings, processPortOpts],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const es = edgeSegmentDragRef.current;
      if (es) {
        const delta = es.orientation === "vertical" ? e.clientX - es.startClientX : e.clientY - es.startClientY;
        const nextCoord = es.startCoord + delta;
        const nextPoints = routeWithDraggedSegment(es.basePoints, es.segmentIndex, nextCoord);
        setEdgeRouteOverrides((prev) => ({ ...prev, [es.edgeId]: nextPoints }));
      }

      const cp = canvasPanDragRef.current;
      if (cp) {
        const el = svgRef.current;
        const r = el?.getBoundingClientRect();
        const w = Math.max(1, r?.width ?? 1);
        const h = Math.max(1, r?.height ?? 1);
        const dx = e.clientX - cp.clientX;
        const dy = e.clientY - cp.clientY;
        setCanvasPan({
          x: cp.startPanX - (dx / w) * cp.vw,
          y: cp.startPanY - (dy / h) * cp.vh,
        });
      }

      const d = dragRef.current;
      if (d) {
        const { x, y } = clientRef.current(e.clientX, e.clientY);
        const rawX = x - d.dx;
        const rawY = y - d.dy;
        const nx = snapToGrid ? Math.round(rawX / gridSize) * gridSize : rawX;
        const ny = snapToGrid ? Math.round(rawY / gridSize) * gridSize : rawY;
        dragRef.current = { ...d, x: nx, y: ny };
        setDragLive({ stepId: d.stepId, x: nx, y: ny });
      }
      const pr = portReorderRef.current;
      if (pr) {
        const step = scenario.steps.find((s) => s.id === pr.stepId);
        const b = step ? stepLayouts.get(step.id) : null;
        if (step && b) {
          const cnt =
            pr.side === "in"
              ? getScenarioInputPorts(step, processPortOpts).length
              : getScenarioOutputPorts(step, processSettings.enforceGraphModulePortsMatchProgram).length;
          const baseY =
            b.y + HEADER_H + BODY_TOP + llmOrderRowHeight(step) + configPreviewHeight(step) + PORT_GAP / 2;
          const { y } = clientRef.current(e.clientX, e.clientY);
          const idx = Math.max(0, Math.min(cnt - 1, Math.round((y - baseY) / PORT_GAP)));
          setPortReorderPreview({ stepId: pr.stepId, side: pr.side, fromIndex: pr.fromIndex, toIndex: idx });
        }
      }
      if (connectActiveRef.current) {
        setPointerSvg(clientRef.current(e.clientX, e.clientY));
      }
    }

    function onUp() {
      edgeSegmentDragRef.current = null;
      if (canvasPanDragRef.current) {
        canvasPanDragRef.current = null;
        setCanvasPanning(false);
      }
      const d = dragRef.current;
      if (d) {
        patchRef.current(d.stepId, d.x, d.y);
      }
      dragRef.current = null;
      setDragLive(null);
      const pr = portReorderRef.current;
      if (pr && portReorderPreview && portReorderPreview.stepId === pr.stepId && portReorderPreview.side === pr.side) {
        reorderPorts(pr.stepId, pr.side, pr.fromIndex, portReorderPreview.toIndex);
      }
      portReorderRef.current = null;
      setPortReorderPreview(null);
      if (connectActiveRef.current) {
        setConnect(null);
        setPointerSvg(null);
        connectActiveRef.current = false;
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [gridSize, snapToGrid, scenario.steps, stepLayouts, processPortOpts, processSettings.enforceGraphModulePortsMatchProgram, portReorderPreview, reorderPorts]);

  useEffect(() => {
    function onDragEnd() {
      setDropHighlight(false);
    }
    document.addEventListener("dragend", onDragEnd);
    return () => document.removeEventListener("dragend", onDragEnd);
  }, []);

  // При изменении bounds сохраняем фактический масштаб камеры (единицы мира на пиксель),
  // чтобы добавление модуля не вызывало визуальный auto-zoom.
  useEffect(() => {
    const prev = prevBoundsRef.current;
    const changed =
      prev.vx !== viewBoxParts.vx ||
      prev.vy !== viewBoxParts.vy ||
      prev.vw !== viewBoxParts.vw ||
      prev.vh !== viewBoxParts.vh;
    if (!changed) return;

    if (fitInProgressRef.current) {
      fitInProgressRef.current = false;
      prevBoundsRef.current = viewBoxParts;
      return;
    }

    const prevVp = viewportRef.current;
    const keepZoomByW = viewBoxParts.vw / Math.max(1e-6, prevVp.vbW);
    const keepZoomByH = viewBoxParts.vh / Math.max(1e-6, prevVp.vbH);
    const nextZoom = Math.min(
      MAX_CANVAS_ZOOM,
      Math.max(MIN_CANVAS_ZOOM, Math.max(keepZoomByW, keepZoomByH)),
    );

    setCanvasZoom(nextZoom);
    setCanvasPan({
      x: prevVp.vbX - viewBoxParts.vx,
      y: prevVp.vbY - viewBoxParts.vy,
    });
    prevBoundsRef.current = viewBoxParts;
  }, [viewBoxParts]);

  /** Колесо: перехват в capture на document + passive:false, иначе браузер успевает прокрутить overflow до preventDefault. */
  useLayoutEffect(() => {
    function onWheelCapture(e: WheelEvent) {
      const wrap = svgWrapRef.current;
      if (!wrap || !wrap.contains(e.target as Node)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".scenario-graph-fit-btn")) return;
      e.preventDefault();
      e.stopPropagation();
      const vp = viewBoxPartsRef.current;
      const pan = canvasPanRef.current;
      const zoom = canvasZoomRef.current;
      const vw0 = vp.vw;
      const vh0 = vp.vh;
      if (vw0 <= 0 || vh0 <= 0) return;
      const factor = e.deltaY < 0 ? 1.09 : 1 / 1.09;
      const nextZoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom * factor));
      if (Math.abs(nextZoom - zoom) < 1e-9) return;

      const vbWCur = vw0 / zoom;
      const vbHCur = vh0 / zoom;
      if (vbWCur <= 0 || vbHCur <= 0) return;
      const vbXCur = vp.vx + pan.x;
      const vbYCur = vp.vy + pan.y;
      const mx = clientToSvgRef.current(e.clientX, e.clientY);
      const u = (mx.x - vbXCur) / vbWCur;
      const v = (mx.y - vbYCur) / vbHCur;
      const newVbW = vw0 / nextZoom;
      const newVbH = vh0 / nextZoom;
      const newVbX = mx.x - u * newVbW;
      const newVbY = mx.y - v * newVbH;

      setCanvasZoom(nextZoom);
      setCanvasPan({ x: newVbX - vp.vx, y: newVbY - vp.vy });
    }
    document.addEventListener("wheel", onWheelCapture, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", onWheelCapture, { capture: true });
  }, []);

  const fitToView = useCallback(() => {
    fitInProgressRef.current = true;
    setCanvasZoom(1);
    setCanvasPan({ x: 0, y: 0 });
  }, []);

  function onBodyPointerDown(e: React.PointerEvent, stepId: string) {
    if (e.button !== 0) return;
    const b = stepLayouts.get(stepId);
    if (!b) return;
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    e.stopPropagation();
    if (canvasPanDragRef.current) {
      canvasPanDragRef.current = null;
      setCanvasPanning(false);
    }
    connectActiveRef.current = false;
    setConnect(null);
    setPointerSvg(null);
    dragRef.current = {
      stepId,
      dx: x - b.x,
      dy: y - b.y,
      x: b.x,
      y: b.y,
    };
  }

  function onOutPortDown(e: React.PointerEvent, stepId: string, artifactTypeId: ArtifactTypeId) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (canvasPanDragRef.current) {
      canvasPanDragRef.current = null;
      setCanvasPanning(false);
    }
    dragRef.current = null;
    setDragLive(null);
    const step = scenario.steps.find((s) => s.id === stepId);
    const b = stepLayouts.get(stepId);
    if (!step || !b) return;
    const outputPorts = getScenarioOutputPorts(step, processSettings.enforceGraphModulePortsMatchProgram);
    const i = outputPorts.indexOf(artifactTypeId);
    if (i < 0) return;
    const cy = b.y + portCenterY(step, i);
    const x0 = b.x + NODE_W;
    const y0 = cy;
    connectActiveRef.current = true;
    setConnect({ fromStepId: stepId, artifactTypeId, x0, y0 });
    setPointerSvg(clientToSvg(e.clientX, e.clientY));
  }

  function onInPortUp(e: React.PointerEvent, stepId: string, portToken: ScenarioInPortToken) {
    if (!connect) return;
    e.stopPropagation();
    connectActiveRef.current = false;
    const toStep = scenario.steps.find((s) => s.id === stepId);
    if (processSettings.showUniversalInputForReport && toStep?.moduleId === "REPORT_OUTPUT") {
      if (portToken !== REPORT_IN_PORT) {
        setConnect(null);
        setPointerSvg(null);
        return;
      }
      if (!isReportOutputAcceptedInput(connect.artifactTypeId)) {
        setConnect(null);
        setPointerSvg(null);
        return;
      }
    } else if (connect.artifactTypeId !== portToken) {
      setConnect(null);
      setPointerSvg(null);
      return;
    }
    if (connect.fromStepId === stepId) {
      setConnect(null);
      setPointerSvg(null);
      return;
    }
    addEdge(connect.fromStepId, stepId, connect.artifactTypeId);
    setConnect(null);
    setPointerSvg(null);
  }

  function edgeOrthogonalPoints(from: ScenarioStep, to: ScenarioStep, edge: ScenarioEdge): PathPoint[] | null {
    void from;
    void to;
    return orthogonalPointsByEdgeId.get(edge.id) ?? null;
  }

  function edgePath(from: ScenarioStep, to: ScenarioStep, edge: ScenarioEdge): string | null {
    const art = edge.artifactTypeId;
    const bf = stepLayouts.get(from.id);
    const bt = stepLayouts.get(to.id);
    if (!bf || !bt) return null;
    const outputPorts = getScenarioOutputPorts(from, processSettings.enforceGraphModulePortsMatchProgram);
    const oi = outputPorts.indexOf(art);
    let ii: number;
    if (processSettings.showUniversalInputForReport && to.moduleId === "REPORT_OUTPUT") {
      if (!isReportOutputAcceptedInput(art)) return null;
      ii = 0;
    } else {
      const inputPorts = getScenarioInputPorts(to, processPortOpts);
      ii = inputPorts.findIndex((p) => p.token === art);
      if (ii < 0) return null;
    }
    if (oi < 0) return null;
    const x1 = bf.x + NODE_W;
    const y1 = bf.y + portCenterY(from, oi) + (edgeSiblingOffsetsById.out.get(edge.id) ?? 0);
    const x2 = bt.x;
    const y2 = bt.y + portCenterY(to, ii) + (edgeSiblingOffsetsById.in.get(edge.id) ?? 0);
    if (edgeRenderMode === "orthogonal") {
      const points = edgeOrthogonalPoints(from, to, edge);
      return points ? orthogonalRoundedPath(points, 10) : null;
    }
    const c1x = x1 + BEZIER_PAD;
    const c2x = x2 - BEZIER_PAD;
    return `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
  }

  function edgeEndpoints(from: ScenarioStep, to: ScenarioStep, edge: ScenarioEdge): { x1: number; y1: number; x2: number; y2: number } | null {
    const art = edge.artifactTypeId;
    const bf = stepLayouts.get(from.id);
    const bt = stepLayouts.get(to.id);
    if (!bf || !bt) return null;
    const outputPorts = getScenarioOutputPorts(from, processSettings.enforceGraphModulePortsMatchProgram);
    const oi = outputPorts.indexOf(art);
    if (oi < 0) return null;
    let ii: number;
    if (processSettings.showUniversalInputForReport && to.moduleId === "REPORT_OUTPUT") {
      if (!isReportOutputAcceptedInput(art)) return null;
      ii = 0;
    } else {
      const inputPorts = getScenarioInputPorts(to, processPortOpts);
      ii = inputPorts.findIndex((p) => p.token === art);
      if (ii < 0) return null;
    }
    return {
      x1: bf.x + NODE_W,
      y1: bf.y + portCenterY(from, oi) + (edgeSiblingOffsetsById.out.get(edge.id) ?? 0),
      x2: bt.x,
      y2: bt.y + portCenterY(to, ii) + (edgeSiblingOffsetsById.in.get(edge.id) ?? 0),
    };
  }

  function applyEdgeOrder(edge: ScenarioEdge, rawOrder: number): void {
    const toStep = scenario.steps.find((s) => s.id === edge.toStepId);
    if (!toStep || !isLlmPuppetModule(toStep.moduleId)) return;
    const nextScenario = normalizeSubtaskOrderForPuppet({
      scenario,
      puppetStepId: toStep.id,
      targetSubtaskStepId: edge.fromStepId,
      targetOrder: rawOrder,
    });
    onChange(normalizeIds(nextScenario, processSettings));
  }

  return (
    <div className="card stack scenario-graph-canvas">
      <div className="scenario-graph-palette-with-instructions">
        <div className="scenario-module-palette">
          <div className="scenario-module-palette-head">
            <p className="scenario-module-palette-title">{copy.paletteTitle}</p>
            <p className="scenario-module-palette-hint">{copy.paletteDragHint}</p>
          </div>

          <nav className="scenario-mega-top" aria-label={copy.paletteTitle}>
            <ul className="scenario-mega-top__root">
              {[
                { title: copy.paletteSourceFolder, entries: audioSourceEntries },
                { title: copy.paletteProcessingFolder, entries: processingEntries },
                { title: copy.paletteLlmFolder, entries: llmPaletteEntries },
                { title: "Прочее", entries: paletteRestModules },
              ].map((group) => (
                <li key={group.title} className="scenario-mega-top__item">
                  <button type="button" className="scenario-mega-top__btn">
                    <span className="scenario-mega-top__label">{group.title}</span>
                    <span className="scenario-mega-top__count">{group.entries.length}</span>
                  </button>
                  <div className="scenario-mega-top__drop" role="menu" aria-label={group.title}>
                    <div className="scenario-mega-top__grid">
                      {group.entries.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="menuitem"
                          className="scenario-mega-top__mod"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(MODULE_DRAG_MIME, m.id);
                            e.dataTransfer.setData("text/plain", m.id);
                            e.dataTransfer.effectAllowed = "copyMove";
                          }}
                          onClick={() => addModuleFromMenu(m.id, "left")}
                        >
                          <div className="scenario-mega-top__modLabel">{m.label}</div>
                          <div className="scenario-mega-top__modId">{m.id}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <aside className="scenario-graph-instructions-col" aria-label={copy.paletteInstructionsAria}>
          <p className="field-hint scenario-graph-instructions-text">{copy.hint}</p>
          <p className="field-hint scenario-graph-hint-secondary scenario-graph-instructions-text">
            {copy.deleteEdgeHint}
          </p>
        </aside>
      </div>

      <div
        ref={svgWrapRef}
        className={`scenario-graph-svg-wrap${dropHighlight ? " scenario-graph-drop-target" : ""}`}
        onContextMenu={(e) => {
          if (!isFullscreen) return;
          e.preventDefault();
          setOpenedEdgeOrderMenuId(null);
          connectActiveRef.current = false;
          setConnect(null);
          setPointerSvg(null);
          setCtxMenu({ clientX: e.clientX, clientY: e.clientY });
        }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes(MODULE_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropHighlight(true);
        }}
        onDragLeave={(e) => {
          const related = e.relatedTarget as Node | null;
          if (related && (e.currentTarget as HTMLElement).contains(related)) return;
          setDropHighlight(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDropHighlight(false);
          const raw =
            e.dataTransfer.getData(MODULE_DRAG_MIME) || e.dataTransfer.getData("text/plain");
          if (!raw || !isModuleId(raw)) return;
          const { x, y } = clientToSvg(e.clientX, e.clientY);
          dropModuleAt(raw, x, y);
        }}
      >
        <button
          type="button"
          className="scenario-graph-fit-btn"
          title={copy.fitToViewTitle}
          aria-label={copy.fitToViewTitle}
          onClick={fitToView}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M9 9L4 4M15 9l5-5M9 15l-5 5M15 15l5 5"
            />
          </svg>
        </button>
        <button
          type="button"
          className="scenario-graph-fit-btn"
          title={isFullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}
          aria-label={isFullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}
          onClick={toggleFullscreen}
          style={{ right: 56 }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              d={
                isFullscreen
                  ? "M9 9H4V4M15 9h5V4M9 15H4v5M15 15h5v5"
                  : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
              }
            />
          </svg>
        </button>
        {isFullscreen ? (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 102,
              zIndex: 4,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.94)",
              color: "var(--text)",
            }}
          >
            <button
              type="button"
              className="icon-button"
              title={gridEnabled ? "Выключить сетку" : "Включить сетку"}
              aria-label={gridEnabled ? "Выключить сетку" : "Включить сетку"}
              onClick={() => setGridEnabled((v) => !v)}
            >
              {gridEnabled ? "▦" : "□"}
            </button>
            <button
              type="button"
              className="icon-button"
              title="Уменьшить шаг сетки"
              aria-label="Уменьшить шаг сетки"
              onClick={() => setGridSize((v) => Math.max(16, v - 8))}
            >
              -
            </button>
            <span style={{ fontSize: 12, minWidth: 46, textAlign: "center" }}>{gridSize}px</span>
            <button
              type="button"
              className="icon-button"
              title="Увеличить шаг сетки"
              aria-label="Увеличить шаг сетки"
              onClick={() => setGridSize((v) => Math.min(120, v + 8))}
            >
              +
            </button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, marginLeft: 4 }}>
              <input
                type="checkbox"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.currentTarget.checked)}
              />
              Snap
            </label>
            <select
              value={edgeRenderMode}
              onChange={(e) => {
                const mode = e.currentTarget.value as EdgeRenderMode;
                setEdgeRenderMode(mode);
                onChange(
                  normalizeIds(
                    {
                      ...scenario,
                      config: {
                        ...(scenario.config ?? {}),
                        edgeRenderMode: mode,
                      },
                    },
                    processSettings,
                  ),
                );
              }}
              title="Тип ребер"
              aria-label="Тип ребер"
              style={{
                marginLeft: 6,
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "4px 6px",
                fontSize: 12,
                background: "#fff",
                color: "var(--text)",
              }}
            >
              <option value="bezier">Безье</option>
              <option value="orthogonal">Ломаная</option>
            </select>
          </div>
        ) : null}

        {isFullscreen && ctxMenu ? (
          <nav
            data-ctx-menu="1"
            className="scenario-ctx-mega"
            aria-label="Добавить модуль"
            style={{
              left: Math.max(8, Math.min(window.innerWidth - 560, ctxMenu.clientX)),
              top: Math.max(56, Math.min(window.innerHeight - 420, ctxMenu.clientY)),
            }}
          >
            <div className="scenario-ctx-mega__title">Добавить модуль</div>
            <ul className="scenario-ctx-mega__root">
              {[
                { title: copy.paletteSourceFolder, entries: audioSourceEntries },
                { title: copy.paletteProcessingFolder, entries: processingEntries },
                { title: copy.paletteLlmFolder, entries: llmPaletteEntries },
                { title: "Прочее", entries: paletteRestModules },
              ].map((group) => (
                <li key={group.title}>
                  <button type="button" aria-haspopup="menu">
                    <span className="scenario-ctx-mega__cat">{group.title}</span>
                    <span className="scenario-ctx-mega__count">{group.entries.length}</span>
                  </button>
                  <div className="scenario-ctx-mega__sub" role="menu" aria-label={group.title}>
                    {group.entries.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="menuitem"
                        className="scenario-ctx-mega__item"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(MODULE_DRAG_MIME, m.id);
                          e.dataTransfer.setData("text/plain", m.id);
                          e.dataTransfer.effectAllowed = "copyMove";
                        }}
                        onClick={() => addModuleFromMenu(m.id, "center")}
                      >
                        <div className="scenario-ctx-mega__itemLabel">{m.label}</div>
                        <div className="scenario-ctx-mega__itemId">{m.id}</div>
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <svg
          ref={svgRef}
          className="scenario-graph-svg"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          style={{ touchAction: "none" }}
        >
          <defs>
            <pattern
              id="graphGridPattern"
              x="0"
              y="0"
              width={gridSize}
              height={gridSize}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                fill="none"
                stroke="color-mix(in srgb, var(--border) 68%, transparent)"
                strokeWidth="1"
              />
            </pattern>
            <filter id="graphNodeShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.12" />
            </filter>
          </defs>

          {isFullscreen && gridEnabled ? (
            <rect
              x={vbX}
              y={vbY}
              width={vbW}
              height={vbH}
              fill="url(#graphGridPattern)"
              pointerEvents="none"
            />
          ) : null}
          <rect
            x={vbX}
            y={vbY}
            width={vbW}
            height={vbH}
            fill="transparent"
            style={{ cursor: canvasPanning ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              setOpenedEdgeOrderMenuId(null);
              connectActiveRef.current = false;
              setConnect(null);
              setPointerSvg(null);
              portReorderRef.current = null;
              setPortReorderPreview(null);
              const ze = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, canvasZoomRef.current));
              canvasPanDragRef.current = {
                clientX: e.clientX,
                clientY: e.clientY,
                startPanX: canvasPanRef.current.x,
                startPanY: canvasPanRef.current.y,
                vw: viewBoxParts.vw / ze,
                vh: viewBoxParts.vh / ze,
              };
              setCanvasPanning(true);
            }}
          />

          {scenario.edges.map((edge) => {
            const from = scenario.steps.find((s) => s.id === edge.fromStepId);
            const to = scenario.steps.find((s) => s.id === edge.toStepId);
            if (!from || !to) return null;
            const d = edgePath(from, to, edge);
            const ep = edgeEndpoints(from, to, edge);
            const routePoints = edgeRenderMode === "orthogonal" ? edgeOrthogonalPoints(from, to, edge) : null;
            if (!d) return null;
            const col = artifactHex(edge.artifactTypeId);
            const isLlmSubtaskToPuppet =
              edge.artifactTypeId === "LLM_SUBTASK" && isLlmTaskSatellite(from.moduleId) && isLlmPuppetModule(to.moduleId);
            const runMeta = llmSubtaskOrderMetaByEdgeId.get(edge.id);
            const runOrder = isLlmSubtaskToPuppet ? runMeta?.order ?? readLlmRunOrder(from) : null;
            const runTotal = runMeta?.total ?? 1;
            const mx = ep ? (ep.x1 + ep.x2) / 2 : 0;
            const my = ep ? (ep.y1 + ep.y2) / 2 : 0;
            return (
              <g key={edge.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ cursor: "pointer" }}
                  onDoubleClick={() => removeEdge(edge.id)}
                />
                {routePoints && routePoints.length >= 2
                  ? routePoints.slice(0, -1).map((p, i) => {
                      const q = routePoints[i + 1]!;
                      const isEdgeSegment = i === 0 || i === routePoints.length - 2;
                      const vertical = p.x === q.x;
                      const horizontal = p.y === q.y;
                      if (!vertical && !horizontal) return null;
                      const blockedVerticalDrag = isEdgeSegment && horizontal;
                      return (
                        <line
                          key={`seg-hit-${edge.id}-${i}`}
                          x1={p.x}
                          y1={p.y}
                          x2={q.x}
                          y2={q.y}
                          stroke="transparent"
                          strokeWidth={14}
                          style={{ cursor: blockedVerticalDrag ? "default" : vertical ? "ew-resize" : "ns-resize" }}
                          onPointerDown={(e) => {
                            if (blockedVerticalDrag) return;
                            e.stopPropagation();
                            edgeSegmentDragRef.current = {
                              edgeId: edge.id,
                              segmentIndex: i,
                              orientation: vertical ? "vertical" : "horizontal",
                              startClientX: e.clientX,
                              startClientY: e.clientY,
                              startCoord: vertical ? p.x : p.y,
                              basePoints: routePoints.map((x) => ({ ...x })),
                            };
                          }}
                        />
                      );
                    })
                  : null}
                <path
                  d={d}
                  fill="none"
                  stroke={col}
                  strokeWidth={2.25}
                  strokeOpacity={0.92}
                  style={{ pointerEvents: "none" }}
                />
                {isLlmSubtaskToPuppet && ep ? (
                  <g transform={`translate(${mx},${my})`}>
                    <circle r={11} fill="#fff" stroke={col} strokeWidth={2} />
                    {openedEdgeOrderMenuId === edge.id
                      ? Array.from({ length: runTotal }).map((_, idx) => {
                          const order = idx + 1;
                          const angle = (Math.PI * 2 * idx) / Math.max(1, runTotal) - Math.PI / 2;
                          const radius = 24;
                          const ox = Math.cos(angle) * radius;
                          const oy = Math.sin(angle) * radius;
                          return (
                            <g
                              key={`ord-${edge.id}-${order}`}
                              transform={`translate(${ox},${oy})`}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                applyEdgeOrder(edge, order);
                                setOpenedEdgeOrderMenuId(null);
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              <circle
                                r={9}
                                fill={order === runOrder ? col : "#fff"}
                                stroke={col}
                                strokeWidth={1.5}
                              />
                              <text
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={9}
                                fontWeight={700}
                                fill={order === runOrder ? "#fff" : col}
                                style={{ userSelect: "none", pointerEvents: "none" }}
                              >
                                {order}
                              </text>
                            </g>
                          );
                        })
                      : null}
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={10}
                      fontWeight={700}
                      fill={col}
                      style={{ userSelect: "none", cursor: "pointer" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setOpenedEdgeOrderMenuId((prev) => (prev === edge.id ? null : edge.id));
                      }}
                    >
                      {runOrder ?? 1}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {connect && pointerSvg ? (
            <path
              d={`M ${connect.x0} ${connect.y0} C ${connect.x0 + BEZIER_PAD} ${connect.y0}, ${pointerSvg.x - BEZIER_PAD} ${pointerSvg.y}, ${pointerSvg.x} ${pointerSvg.y}`}
              fill="none"
              stroke={artifactHex(connect.artifactTypeId)}
              strokeWidth={2}
              strokeDasharray="8 6"
              strokeOpacity={0.85}
              style={{ pointerEvents: "none" }}
            />
          ) : null}

          {scenario.steps.map((step) => {
            const b = stepLayouts.get(step.id);
            if (!b) return null;
            const h = b.h;
            const fillSurface = "var(--surface, #fffdf9)";
            const strokeBorder = "var(--border, #ded8cc)";
            const previewLines = configPreviewLines(step);
            return (
              <g key={step.id} className="scenario-graph-node" transform={`translate(${b.x},${b.y})`}>
                <title>
                  {nodeTooltipTitle({
                    label: moduleLabelById.get(step.moduleId) ?? step.moduleId,
                    moduleId: step.moduleId,
                    order: stepOrderIndex.get(step.id),
                    stepCode: step.code,
                  })}
                </title>
                <rect
                  x={0}
                  y={0}
                  width={NODE_W}
                  height={h}
                  rx={14}
                  ry={14}
                  fill={fillSurface}
                  stroke={strokeBorder}
                  strokeWidth={1.5}
                  filter="url(#graphNodeShadow)"
                  style={{ cursor: "grab", touchAction: "none" }}
                  onPointerDown={(e) => onBodyPointerDown(e, step.id)}
                />
                <rect
                  x={0}
                  y={0}
                  width={NODE_W}
                  height={HEADER_H}
                  rx={14}
                  ry={14}
                  fill="var(--accent, #01696f)"
                  fillOpacity={0.12}
                  style={{ cursor: "grab", pointerEvents: "none" }}
                />
                <text
                  x={14}
                  y={24}
                  fill="var(--text, #1f2328)"
                  fontSize={(moduleLabelById.get(step.moduleId) ?? step.moduleId).length > 18 ? 11 : 13}
                  fontWeight={600}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {moduleLabelById.get(step.moduleId) ?? step.moduleId}
                </text>
                <text
                  x={NODE_W - 40}
                  y={24}
                  textAnchor="end"
                  fill="var(--muted, #5a6470)"
                  fontSize={11}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  #{stepOrderIndex.get(step.id) ?? "—"}
                </text>
                {null}
                {previewLines.length > 0 ? (
                  <g>
                    <rect
                      x={12}
                      y={configBlockTop(step) - 4}
                      width={NODE_W - 24}
                      height={CONFIG_PREVIEW_H}
                      rx={10}
                      ry={10}
                      fill="color-mix(in srgb, var(--accent) 10%, transparent)"
                      fillOpacity={0.9}
                      stroke="var(--border, #ded8cc)"
                      strokeWidth={1}
                      style={{ pointerEvents: "none" }}
                    />
                    {previewLines.map((line, idx) => (
                      <text
                        key={`cfg-${idx}`}
                        x={14}
                        y={configBlockTop(step) + 10 + idx * 13}
                        fill="var(--muted, #5a6470)"
                        fontSize={11}
                        fontWeight={500}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                ) : null}
                <g className="scenario-graph-node-close">
                  <title>{copy.removeStepTitle}</title>
                  <rect
                    x={NODE_W - 28}
                    y={6}
                    width={22}
                    height={22}
                    rx={6}
                    ry={6}
                    fill="#fee2e2"
                    stroke="var(--border, #ded8cc)"
                    strokeWidth={1}
                    style={{ cursor: "pointer" }}
                    aria-label={copy.removeStepTitle}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (canvasPanDragRef.current) {
                        canvasPanDragRef.current = null;
                        setCanvasPanning(false);
                      }
                      dragRef.current = null;
                      setDragLive(null);
                      removeStepById(step.id);
                    }}
                  />
                  <text
                    x={NODE_W - 17}
                    y={21}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="var(--danger, #b42318)"
                    fontSize={15}
                    fontWeight={700}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    ×
                  </text>
                </g>

                {getScenarioInputPorts(step, processPortOpts).map((pin, i) => {
                  const cy = portCenterY(step, i);
                  const isMux = pin.token === REPORT_IN_PORT;
                  const label = isMux
                    ? copy.reportMultiplexInBadge
                    : artifactShortLabel((pin.displayArt ?? pin.token) as ArtifactTypeId);
                  const col = isMux ? artifactHex("SESSION_REPORT") : artifactHex(pin.displayArt ?? "TEXT");
                  // ComfyUI-like: port dot inside module with small padding from walls.
                  const dotX = PORT_INNER_PAD_X;
                  const hitX = dotX - PORT_DOT_HIT_W / 2;
                  const textX = dotX + PORT_DOT_R + 8;
                  const usageKey = `${step.id}::${(pin.displayArt ?? pin.token) as ArtifactTypeId}`;
                  const active =
                    pin.token === REPORT_IN_PORT
                      ? scenario.edges.some((e) => e.toStepId === step.id)
                      : (usedInputCount.get(usageKey) ?? 0) > 0;
                  const alpha = active ? 1 : 0.35;
                  const reorderTarget =
                    portReorderPreview &&
                    portReorderPreview.stepId === step.id &&
                    portReorderPreview.side === "in" &&
                    portReorderPreview.toIndex === i;
                  return (
                    <g key={pin.key}>
                      <title>{isMux ? copy.reportMultiplexInTitle : `${copy.portInTitle}: ${pin.displayArt}`}</title>
                      <rect
                        x={hitX}
                        y={cy - PORT_DOT_R}
                        width={PORT_DOT_HIT_W}
                        height={PORT_DOT_R * 2}
                        rx={8}
                        ry={8}
                        fill="transparent"
                        stroke="transparent"
                        style={{ cursor: connect ? "crosshair" : "default" }}
                        onPointerUp={(e) => onInPortUp(e, step.id, pin.token)}
                      />
                      <circle cx={dotX} cy={cy} r={PORT_DOT_R} fill={col} fillOpacity={alpha} style={{ pointerEvents: "none" }} />
                      {reorderTarget ? (
                        <rect
                          x={dotX + 10}
                          y={cy - 9}
                          width={30}
                          height={18}
                          rx={6}
                          ry={6}
                          fill="color-mix(in srgb, var(--accent) 14%, #fff)"
                          stroke="var(--accent)"
                          strokeWidth={1}
                          style={{ pointerEvents: "none" }}
                        />
                      ) : null}
                      {pin.token !== REPORT_IN_PORT ? (
                        <text
                          x={textX + 22}
                          y={cy}
                          dominantBaseline="middle"
                          textAnchor="start"
                          fill="var(--muted, #5a6470)"
                          fontSize={10}
                          style={{ cursor: "ns-resize", userSelect: "none" }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            portReorderRef.current = { stepId: step.id, side: "in", fromIndex: i };
                            setPortReorderPreview({ stepId: step.id, side: "in", fromIndex: i, toIndex: i });
                          }}
                        >
                          ⋮⋮
                        </text>
                      ) : null}
                      <text
                        x={textX}
                        y={cy}
                        dominantBaseline="middle"
                        textAnchor="start"
                        fill="var(--muted, #5a6470)"
                        fillOpacity={alpha}
                        fontSize={9}
                        fontWeight={600}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}

                {getScenarioOutputPorts(step, processSettings.enforceGraphModulePortsMatchProgram).map((art, i) => {
                  const cy = portCenterY(step, i);
                  const col = artifactHex(art);
                  const label = artifactShortLabel(art);
                  const dotX = NODE_W - PORT_INNER_PAD_X;
                  const hitX = dotX - PORT_DOT_HIT_W / 2;
                  const textX = dotX - PORT_DOT_R - 8;
                  const usageKey = `${step.id}::${art}`;
                  const active = (usedOutputCount.get(usageKey) ?? 0) > 0;
                  const isBusiness = !TECHNICAL_OUTPUT_ARTIFACTS.has(art);
                  const alpha = active ? 1 : 0.35;
                  const reorderTarget =
                    portReorderPreview &&
                    portReorderPreview.stepId === step.id &&
                    portReorderPreview.side === "out" &&
                    portReorderPreview.toIndex === i;
                  const pillW = portBadgeWidth(label);
                  const pillX = textX - pillW - 8;
                  return (
                    <g key={`out-${art}-${i}`}>
                      <title>{`${copy.portOutTitle}: ${art}`}</title>
                      <rect
                        x={hitX}
                        y={cy - PORT_DOT_R}
                        width={PORT_DOT_HIT_W}
                        height={PORT_DOT_R * 2}
                        rx={8}
                        ry={8}
                        fill="transparent"
                        stroke="transparent"
                        style={{ cursor: "crosshair" }}
                        onPointerDown={(e) => onOutPortDown(e, step.id, art)}
                      />
                      {isBusiness ? (
                        <rect
                          x={pillX}
                          y={cy - 10}
                          width={pillW + (PORT_DOT_R * 2 + 10)}
                          height={20}
                          rx={10}
                          ry={10}
                          fill="transparent"
                          stroke={col}
                          strokeWidth={1.25}
                          strokeOpacity={alpha}
                          style={{ pointerEvents: "none" }}
                        />
                      ) : null}
                      {reorderTarget ? (
                        <rect
                          x={pillX - 34}
                          y={cy - 9}
                          width={30}
                          height={18}
                          rx={6}
                          ry={6}
                          fill="color-mix(in srgb, var(--accent) 14%, #fff)"
                          stroke="var(--accent)"
                          strokeWidth={1}
                          style={{ pointerEvents: "none" }}
                        />
                      ) : null}
                      <text
                        x={pillX - 18}
                        y={cy}
                        dominantBaseline="middle"
                        textAnchor="middle"
                        fill="var(--muted, #5a6470)"
                        fontSize={10}
                        style={{ cursor: "ns-resize", userSelect: "none" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          portReorderRef.current = { stepId: step.id, side: "out", fromIndex: i };
                          setPortReorderPreview({ stepId: step.id, side: "out", fromIndex: i, toIndex: i });
                        }}
                      >
                        ⋮⋮
                      </text>
                      <circle cx={dotX} cy={cy} r={PORT_DOT_R} fill={col} fillOpacity={alpha} style={{ pointerEvents: "none" }} />
                      <text
                        x={textX}
                        y={cy}
                        dominantBaseline="middle"
                        textAnchor="end"
                        fill="var(--muted, #5a6470)"
                        fillOpacity={alpha}
                        fontSize={9}
                        fontWeight={600}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
