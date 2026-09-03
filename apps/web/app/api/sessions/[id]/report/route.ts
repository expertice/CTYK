import { NextResponse } from "next/server";
import { getAsyncPipelineRun } from "../../../../../lib/pipeline/async-run-store";
import { buildSessionReport, isSessionReportPayload } from "../../../../../lib/report/build-report";
import { getSessionTags } from "../../../../../lib/pipeline/session-tags-store";
import type { SessionReport } from "../../../../../types/report.types";

interface Params {
  params: Promise<{ id: string }>;
}

function applySpeakerLabelsFromSessionTags(sessionId: string, report: SessionReport): SessionReport {
  const tags = getSessionTags(sessionId);
  if (!Array.isArray(tags) || tags.length === 0) {
    return report;
  }
  const bySpeaker = new Map<string, string>();
  for (const t of tags) {
    if (t.type !== "speaker" || typeof t.speakerId !== "string") continue;
    const label = typeof t.value === "string" ? t.value.trim() : "";
    if (!label) continue;
    bySpeaker.set(t.speakerId, label);
  }
  if (bySpeaker.size === 0) {
    return report;
  }

  function rewriteSpeakerIdsInText(text: string): string {
    let out = text;
    const entries = [...bySpeaker.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [speakerId, label] of entries) {
      const escaped = speakerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Avoid double-replacing inside already formatted "(speaker_00)".
      const re = new RegExp(`(?<!\\()(?<![\\w-])${escaped}(?![\\w-])`, "gi");
      out = out.replace(re, `${label} (${speakerId})`);
    }
    return out;
  }

  const nextNarrative =
    report.psychStateSummary?.narrative?.text && typeof report.psychStateSummary.narrative.text === "string"
      ? rewriteSpeakerIdsInText(report.psychStateSummary.narrative.text)
      : undefined;

  return {
    ...report,
    transcript: Array.isArray(report.transcript)
      ? report.transcript.map((row) => {
          const label = bySpeaker.get(row.speakerId);
          return label ? { ...row, displayName: label } : row;
        })
      : [],
    psychStateSummary:
      nextNarrative && report.psychStateSummary
        ? {
            ...report.psychStateSummary,
            narrative: {
              ...report.psychStateSummary.narrative,
              text: nextNarrative,
            },
          }
        : report.psychStateSummary,
  };
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const run = getAsyncPipelineRun(id);
  if (!run) {
    return NextResponse.json(
      {
        error: `No pipeline run found for session ${id}`,
      },
      { status: 404 },
    );
  }

  if (run.run.status !== "succeeded") {
    return NextResponse.json(
      {
        error: "Report is not ready yet",
        status: run.run.status,
      },
      { status: 409 },
    );
  }

  const stored = run.artifacts.SESSION_REPORT;
  if (
    stored?.status === "ready" &&
    stored.data !== undefined &&
    isSessionReportPayload(stored.data)
  ) {
    return NextResponse.json(applySpeakerLabelsFromSessionTags(id, stored.data));
  }

  const report = buildSessionReport(id, run);
  return NextResponse.json(applySpeakerLabelsFromSessionTags(id, report));
}
