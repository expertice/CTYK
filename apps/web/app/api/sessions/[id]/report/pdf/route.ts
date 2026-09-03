import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getAsyncPipelineRun } from "../../../../../../lib/pipeline/async-run-store";
import { buildSessionReport, isSessionReportPayload } from "../../../../../../lib/report/build-report";
import { getSessionTags } from "../../../../../../lib/pipeline/session-tags-store";
import type { SessionReport } from "../../../../../../types/report.types";

interface Params {
  params: Promise<{ id: string }>;
}

function applySpeakerLabelsFromSessionTags(sessionId: string, report: SessionReport): SessionReport {
  const tags = getSessionTags(sessionId);
  if (!Array.isArray(tags) || tags.length === 0) return report;

  const bySpeaker = new Map<string, string>();
  for (const t of tags) {
    if (t.type !== "speaker" || typeof t.speakerId !== "string") continue;
    const label = typeof t.value === "string" ? t.value.trim() : "";
    if (!label) continue;
    bySpeaker.set(t.speakerId, label);
  }
  if (bySpeaker.size === 0) return report;

  return {
    ...report,
    transcript: Array.isArray(report.transcript)
      ? report.transcript.map((row) => {
          const label = bySpeaker.get(row.speakerId);
          return label ? { ...row, displayName: label } : row;
        })
      : [],
  };
}

function formatMmSs(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function wrapLine(text: string, maxChars = 110): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (`${cur} ${w}`.length > maxChars) {
      out.push(cur);
      cur = w;
    } else {
      cur = `${cur} ${w}`;
    }
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [text];
}

function reportToLines(report: SessionReport): string[] {
  const lines: string[] = [];
  lines.push("Session report");
  lines.push(`Session ID: ${report.sessionId}`);
  lines.push(`Generated at: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push("");

  lines.push("Summary");
  lines.push(...wrapLine(report.summary?.text ?? "—"));
  lines.push("");

  lines.push("Checklist");
  if (report.checklistResults.length === 0) {
    lines.push("- No checklist data");
  } else {
    for (const item of report.checklistResults) {
      lines.push(`- ${item.itemText}: ${item.status}`);
    }
  }
  lines.push("");

  lines.push("Transcript");
  if (report.transcript.length === 0) {
    lines.push("- No transcript data");
  } else {
    for (const row of report.transcript) {
      const speaker = row.displayName || row.speakerId;
      lines.push(`${speaker} [${formatMmSs(row.startTime)}-${formatMmSs(row.endTime)}]`);
      lines.push(...wrapLine(row.text, 100).map((x) => `  ${x}`));
    }
  }
  lines.push("");

  lines.push("Psych narrative");
  lines.push(...wrapLine(report.psychStateSummary?.narrative?.text ?? "—"));
  return lines;
}

async function createPdfBuffer(report: SessionReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]); // A4
  const marginX = 40;
  const marginTop = 36;
  const fontSize = 10;
  const lineHeight = 14;
  let y = 842 - marginTop;

  const lines = reportToLines(report);
  for (const line of lines) {
    if (y < 40) {
      page = pdf.addPage([595, 842]);
      y = 842 - marginTop;
    }
    page.drawText(line, {
      x: marginX,
      y,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: 595 - marginX * 2,
    });
    y -= lineHeight;
  }
  return pdf.save();
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const run = getAsyncPipelineRun(id);
  if (!run) {
    return NextResponse.json({ error: `No pipeline run found for session ${id}` }, { status: 404 });
  }
  if (run.run.status !== "succeeded") {
    return NextResponse.json({ error: "Report is not ready yet", status: run.run.status }, { status: 409 });
  }

  const stored = run.artifacts.SESSION_REPORT;
  const report =
    stored?.status === "ready" && stored.data !== undefined && isSessionReportPayload(stored.data)
      ? stored.data
      : buildSessionReport(id, run);
  const normalized = applySpeakerLabelsFromSessionTags(id, report);

  const bytes = await createPdfBuffer(normalized);
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="session-${id}-report.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
