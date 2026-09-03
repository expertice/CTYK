import { NextResponse } from "next/server";
import type { ArtifactEnvelope } from "../../../../../../types/artifact.types";
import {
  getRunForExecution,
  getRunIdBySessionId,
  upsertRunArtifacts,
  upsertRunStatus,
} from "../../../../../../lib/pipeline/async-run-store";
import { mergePartialArtifactStore } from "../../../../../../lib/pipeline/artifact-merge";
import { enqueueResumePipelineJob } from "../../../../../../lib/queue/pipeline-queue";
import { upsertSpeakerTagsFromLabels } from "../../../../../../lib/pipeline/session-tags-store";

interface Params {
  params: Promise<{ id: string }>;
}

type SegmentRow = { speakerId: string; startTime: number; endTime: number; text: string };

function isSegmentRow(x: unknown): x is SegmentRow {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.speakerId === "string" &&
    typeof o.startTime === "number" &&
    typeof o.endTime === "number" &&
    typeof o.text === "string" &&
    Number.isFinite(o.startTime) &&
    Number.isFinite(o.endTime)
  );
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const { id: sessionId } = await params;
  const runId = getRunIdBySessionId(sessionId);
  if (!runId) {
    return NextResponse.json({ error: "Session run not found" }, { status: 404 });
  }

  const record = getRunForExecution(runId);
  if (!record) {
    return NextResponse.json({ error: "Run record not found" }, { status: 404 });
  }
  if (record.run.run.status !== "paused") {
    return NextResponse.json(
      { error: "Run is not paused for speaker draft (expected status: paused)" },
      { status: 409 },
    );
  }

  const editStep = record.scenario.steps.find((s) => s.moduleId === "SPEAKER_DRAFT_EDIT");
  if (!editStep) {
    return NextResponse.json({ error: "Scenario has no SPEAKER_DRAFT_EDIT step" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rawSegments = (body as { segments?: unknown }).segments;
  const speakerLabels = (body as { speakerLabels?: unknown }).speakerLabels;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return NextResponse.json({ error: "segments non-empty array required" }, { status: 400 });
  }
  const segments: SegmentRow[] = [];
  for (const row of rawSegments) {
    if (!isSegmentRow(row)) {
      return NextResponse.json({ error: "Invalid segment row" }, { status: 400 });
    }
    segments.push(row);
  }

  const labels: Record<string, string> = {};
  if (speakerLabels && typeof speakerLabels === "object" && !Array.isArray(speakerLabels)) {
    for (const [k, v] of Object.entries(speakerLabels as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) labels[k] = v.trim();
    }
  }

  const now = new Date().toISOString();
  const producer = {
    moduleId: "SPEAKER_DRAFT_EDIT" as const,
    stepId: editStep.id,
    runId,
  };

  const readyEnv: ArtifactEnvelope = {
    type: "READY_SPEAKERS",
    status: "ready",
    version: "v1",
    producer,
    quality: { confidence: 1 },
    explainability: [
      {
        sourceArtifactType: "DRAFT_SPEAKERS",
        rationale: "Подтверждено вручную в UI статуса сессии.",
      },
    ],
    data: segments,
    createdAt: now,
  };

  const draftEnv: ArtifactEnvelope = {
    type: "DRAFT_SPEAKERS",
    status: "ready",
    version: "v1",
    producer,
    quality: { confidence: 1 },
    explainability: [
      {
        sourceArtifactType: "DRAFT_SPEAKERS",
        rationale: "Черновик синхронизирован с ручной правкой в UI статуса сессии.",
      },
    ],
    data: segments,
    createdAt: now,
  };

  const identityEntries = Object.entries(labels)
    .map(([speakerId, displayName]) => ({
      speakerId,
      displayName,
    }))
    .filter((x) => typeof x.speakerId === "string" && x.speakerId.trim() && typeof x.displayName === "string" && x.displayName.trim());
  const identityEnv: ArtifactEnvelope | undefined =
    identityEntries.length > 0
      ? {
          type: "SPEAKER_IDENTITY_MAP",
          status: "ready",
          version: "v1",
          producer,
          quality: {},
          data: {
            entries: identityEntries,
          },
          createdAt: now,
        }
      : undefined;

  const nextArtifacts = { ...record.run.artifacts };
  mergePartialArtifactStore(nextArtifacts, { READY_SPEAKERS: readyEnv });
  mergePartialArtifactStore(nextArtifacts, { DRAFT_SPEAKERS: draftEnv });
  if (identityEnv) {
    mergePartialArtifactStore(nextArtifacts, { SPEAKER_IDENTITY_MAP: identityEnv });
  }

  upsertRunArtifacts(runId, nextArtifacts);
  upsertSpeakerTagsFromLabels(sessionId, labels);

  upsertRunStatus(runId, {
    status: "queued",
    finishedAt: undefined,
    errorMessage: undefined,
  });

  enqueueResumePipelineJob({
    runId,
    sessionId,
    scenarioId: record.scenario.id,
  });

  return NextResponse.json({ ok: true, runId });
}
