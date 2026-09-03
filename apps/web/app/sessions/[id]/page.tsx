"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import type {
  ArtifactSection,
  ReportCombinationEvidence,
  ReportDialogueRow,
  ReportSummarySectionBlock,
  ReportSpeakerPatternCard,
  ReportTimelineMoment,
  SegmentProsodyMetrics,
  SessionReport,
  SpeakerSegment,
} from "../../../types/report.types";
import { getUiCopy } from "../../../lib/i18n/ui-copy";
import { substituteSpeakerRefsInPsychText } from "../../../lib/report/substitute-speaker-refs-in-psych-text";

type ReadableDialogueSection = ArtifactSection & {
  readable: {
    kind: "dialogue" | "dialogue_with_prosody";
    legend: { speakerCount: number; durationSec: number };
    dialogue: ReportDialogueRow[];
  };
};
type ReadablePsychNarrativeSection = ArtifactSection & {
  readable: {
    kind: "psych_narrative";
    summary: string;
    timelineEvents: ReportTimelineMoment[];
    segmentComments: Array<{
      speakerId: string;
      startSec: number;
      endSec: number;
      summary: string;
      tensionDelta?: "up" | "down" | "flat";
      confidence?: number | null;
    }>;
    turningPoints: string[];
    riskMoments: string[];
  };
};
type ReadablePsychLabelsSection = ArtifactSection & {
  readable: { kind: "psych_labels"; speakerPatterns: ReportSpeakerPatternCard[] };
};
type ReadableLlmSummarySection = ArtifactSection & {
  readable: {
    kind: "llm_summary";
    scenario: string;
    subScenario: string;
    sections: ReportSummarySectionBlock[];
    qualityNotes?: string;
    doNotInfer?: string[];
  };
};
type ReadablePsychFullSection = ArtifactSection & {
  readable: {
    kind: "psych_full";
    globalCommentary: string;
    disclaimers: string[];
  };
};

function formatMmSs(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatProsodyCells(p: SegmentProsodyMetrics | undefined): {
  rms: string;
  cps: string;
  zcr: string;
  cent: string;
  roll: string;
} {
  if (!p) {
    return { rms: "—", cps: "—", zcr: "—", cent: "—", roll: "—" };
  }
  return {
    rms: p.rmsMeanDb.toFixed(1),
    cps: p.charsPerSec.toFixed(1),
    zcr: p.zcrMean.toFixed(4),
    cent: Math.round(p.spectralCentroidMeanHz).toString(),
    roll: Math.round(p.spectralRolloffMeanHz).toString(),
  };
}

function firstGlobalBpmFromTranscript(transcript: SpeakerSegment[]): number | null {
  for (const s of transcript) {
    const b = s.prosody?.globalTempoBpm;
    if (typeof b === "number" && Number.isFinite(b) && b > 0) {
      return b;
    }
  }
  return null;
}

function formatDurationHuman(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}м ${s.toString().padStart(2, "0")}с`;
}

function renderSpeakerLabel(speakerId: string, displayName?: string): string {
  return (displayName && displayName.trim()) || speakerId || "speaker_unknown";
}

function signalToneClass(tone: "up" | "down" | "neutral" | undefined): string {
  if (tone === "up") return "report-signal--up";
  if (tone === "down") return "report-signal--down";
  return "report-signal--neutral";
}

function toneMultiplicityGlyph(tone: "up" | "down" | "neutral" | undefined): string {
  if (tone === "up") return "↗";
  if (tone === "down") return "↘";
  return "•";
}

function normalizeSeries(values: number[]): number[] {
  if (values.length === 0) return [];
  const maxAbs = values.reduce((acc, v) => Math.max(acc, Math.abs(v)), 0);
  if (maxAbs <= 0) return values.map(() => 0);
  return values.map((v) => v / maxAbs);
}

function isReadableDialogueSection(
  section: ArtifactSection,
): section is ReadableDialogueSection {
  if (!("readable" in section) || !section.readable) return false;
  const r = section.readable as { kind?: string };
  return r.kind === "dialogue" || r.kind === "dialogue_with_prosody";
}

function isPsychNarrativeSection(
  section: ArtifactSection,
): section is ReadablePsychNarrativeSection {
  if (!("readable" in section) || !section.readable) return false;
  return (section.readable as { kind?: string }).kind === "psych_narrative";
}

function isPsychLabelsSection(
  section: ArtifactSection,
): section is ReadablePsychLabelsSection {
  if (!("readable" in section) || !section.readable) return false;
  return (section.readable as { kind?: string }).kind === "psych_labels";
}

function isLlmSummarySection(
  section: ArtifactSection,
): section is ReadableLlmSummarySection {
  if (!("readable" in section) || !section.readable) return false;
  return (section.readable as { kind?: string }).kind === "llm_summary";
}

function isPsychFullSection(
  section: ArtifactSection,
): section is ReadablePsychFullSection {
  if (!("readable" in section) || !section.readable) return false;
  return (section.readable as { kind?: string }).kind === "psych_full";
}

function renderEvidenceCompact(evidence: ReportCombinationEvidence[]): string[] {
  return evidence.map((entry) => {
    const metrics = entry.metrics.map((m) => `${m.metricName} ${m.direction}`).join(", ");
    return `${entry.combinationId}: ${metrics}${entry.confirmedByENR ? "" : " (не подтверждено ENR)"}`;
  });
}

function summaryItemText(item: ReportSummarySectionBlock["items"][number]): string {
  return item.text ?? item.title ?? item.description ?? "—";
}

function summaryItemRecord(item: ReportSummarySectionBlock["items"][number]): Record<string, unknown> {
  return item as unknown as Record<string, unknown>;
}

function summaryItemStringArray(item: ReportSummarySectionBlock["items"][number], key: string): string[] {
  const raw = summaryItemRecord(item)[key];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

function summaryItemString(item: ReportSummarySectionBlock["items"][number], key: string): string | null {
  const raw = summaryItemRecord(item)[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function renderSummarySectionByScenario(
  section: ReportSummarySectionBlock,
  scenario: string,
) {
  const sid = section.id.toLowerCase();
  const isDocsTable = ["tasks", "decisions", "agreements", "next_steps"].includes(sid);
  const isAnalyticsCards = ["problems", "risks", "opportunities"].includes(sid);
  const isPositions = sid === "positions_by_topic";
  const isWorkstreams = sid === "workstreams";
  const isChecklist = sid === "checklist";
  const isPriorities = sid === "prioritized_tasks";
  const isCriticalPaths = sid === "critical_paths";

  if ((scenario === "docs" && isDocsTable) || isPriorities || isPositions) {
    return (
      <div className="report-summary-table-wrap">
        <table className="report-summary-table">
          <thead>
            <tr>
              <th>Что</th>
              <th>Кто</th>
              <th>Срок</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((item) => {
              const owners = item.owners && item.owners.length > 0 ? item.owners : summaryItemStringArray(item, "actors");
              const deadline = item.deadline ?? summaryItemString(item, "deadline");
              const participant = summaryItemString(item, "participant");
              const topic = summaryItemString(item, "topic");
              const positionSummary = summaryItemString(item, "positionSummary");
              const value = isPositions
                ? [topic, participant, positionSummary].filter(Boolean).join(" · ")
                : summaryItemText(item);
              return (
                <tr key={item.id}>
                  <td>{value || "—"}</td>
                  <td>{owners.length > 0 ? owners.join(", ") : "—"}</td>
                  <td>{deadline ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if ((scenario === "analytics" && isAnalyticsCards) || isCriticalPaths) {
    return (
      <div className="report-summary-cards">
        {section.items.map((item) => {
          const sev = summaryItemString(item, "severity");
          const likelihood = summaryItemString(item, "likelihood");
          const impact = summaryItemString(item, "impact");
          return (
            <article key={item.id} className="report-pattern-card">
              <p><strong>{item.title ?? item.text ?? item.id}</strong></p>
              {item.description ? <p>{item.description}</p> : null}
              {summaryItemText(item) !== item.title && summaryItemText(item) !== item.description ? (
                <p className="field-hint">{summaryItemText(item)}</p>
              ) : null}
              {sev ? <p className="field-hint">severity: {sev}</p> : null}
              {likelihood ? <p className="field-hint">likelihood: {likelihood}</p> : null}
              {impact ? <p className="field-hint">impact: {impact}</p> : null}
            </article>
          );
        })}
      </div>
    );
  }

  if (scenario === "planning" && isWorkstreams) {
    return (
      <div className="report-summary-workstreams">
        {section.items.map((item) => {
          const stepsRaw = summaryItemRecord(item).steps;
          const steps = Array.isArray(stepsRaw)
            ? stepsRaw.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
            : [];
          return (
            <article key={item.id} className="report-key-moment">
              <h4>{item.title ?? item.text ?? item.id}</h4>
              {steps.length > 0 ? (
                <ol>
                  {steps.map((step, idx) => (
                    <li key={`${item.id}_step_${idx}`}>
                      {typeof step.text === "string" && step.text.trim() ? step.text : "—"}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="field-hint">{summaryItemText(item)}</p>
              )}
            </article>
          );
        })}
      </div>
    );
  }

  if (scenario === "planning" && isChecklist) {
    return (
      <div className="stack">
        {section.items.map((item) => {
          const status = summaryItemString(item, "status") ?? "pending";
          const checked = status === "done" || status === "completed";
          return (
            <label key={item.id} className="report-summary-check-item">
              <input type="checkbox" checked={checked} readOnly />
              <span>{summaryItemText(item)}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <ul>
      {section.items.map((item) => (
        <li key={item.id}>{summaryItemText(item)}</li>
      ))}
    </ul>
  );
}

export default function SessionReportPage() {
  const copy = getUiCopy("ru");
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<SessionReport | null>(null);
  const [error, setError] = useState("");
  const [activeProsodyKey, setActiveProsodyKey] = useState("");
  const [artifactViewMode, setArtifactViewMode] = useState<Record<string, "readable" | "raw">>({});
  const [repeatReuseAvailable, setRepeatReuseAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/sessions/${encodeURIComponent(params.id)}/reuse-pack`, { cache: "no-store" });
        if (!cancelled) setRepeatReuseAvailable(r.ok);
      } catch {
        if (!cancelled) setRepeatReuseAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    let mounted = true;

    async function loadReport() {
      try {
        const response = await fetch(`/api/sessions/${params.id}/report`, { cache: "no-store" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? copy.reportPage.loadError);
        }
        const data = (await response.json()) as SessionReport;
        if (mounted) {
          setReport(data);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : copy.reportPage.unknownError);
        }
      }
    }

    loadReport();
    return () => {
      mounted = false;
    };
  }, [params.id]);

  const hasTranscriptProsody = Boolean(report?.transcript.some((s) => s.prosody != null));
  const transcriptGlobalBpm =
    report && hasTranscriptProsody ? firstGlobalBpmFromTranscript(report.transcript) : null;
  const psychNarrativeHtml = useMemo(() => {
    const text = report?.psychStateSummary?.narrative?.text?.trim() ?? "";
    if (!text || text === "—" || /not available yet/i.test(text)) return "";
    return String(marked.parse(text, { gfm: true, breaks: true }));
  }, [report?.psychStateSummary?.narrative?.text]);
  const typedSections = useMemo(() => (report?.artifactSections ?? []) as ArtifactSection[], [report?.artifactSections]);
  const dialogueSection = useMemo(() => {
    const enriched = typedSections.find(
      (s): s is ReadableDialogueSection => s.artifactType === "ENRICHED_TRANSCRIPT" && isReadableDialogueSection(s),
    );
    if (enriched) return enriched;
    return typedSections.find(
      (s): s is ReadableDialogueSection => s.artifactType === "READY_SPEAKERS" && isReadableDialogueSection(s),
    );
  }, [typedSections]);
  const psychNarrativeSection = useMemo(
    () =>
      typedSections.find(
        (s): s is ReadablePsychNarrativeSection => s.artifactType === "LLM_PSYCH_NARRATIVE" && isPsychNarrativeSection(s),
      ),
    [typedSections],
  );
  const psychLabelsSection = useMemo(
    () =>
      typedSections.find(
        (s): s is ReadablePsychLabelsSection => s.artifactType === "LLM_PSYCH_LABELS" && isPsychLabelsSection(s),
      ),
    [typedSections],
  );
  const llmSummarySection = useMemo(
    () =>
      typedSections.find(
        (s): s is ReadableLlmSummarySection => s.artifactType === "LLM_SUMMARY" && isLlmSummarySection(s),
      ),
    [typedSections],
  );
  const psychFullSection = useMemo(
    () =>
      typedSections.find(
        (s): s is ReadablePsychFullSection => s.artifactType === "LLM_PSYCH_FULL_V1" && isPsychFullSection(s),
      ),
    [typedSections],
  );
  const fallbackTranscriptLegend = useMemo(() => {
    if (!report) return null;
    const speakerCount = new Set(report.transcript.map((s) => s.speakerId)).size;
    const durationSec = report.transcript.reduce((acc, s) => Math.max(acc, s.endTime), 0);
    return { speakerCount, durationSec };
  }, [report]);
  const dialogueRows: ReportDialogueRow[] = dialogueSection
    ? dialogueSection.readable.dialogue
    : (report?.transcript ?? []).map((segment) => ({
        speakerId: segment.speakerId,
        displayName: segment.displayName,
        startTime: segment.startTime,
        endTime: segment.endTime,
        text: segment.text,
        prosody: segment.prosody,
      }));
  const speakerPsychDisplayLookup = useMemo(() => {
    const m = new Map<string, { displayName?: string }>();
    for (const r of dialogueRows) {
      if (r.displayName?.trim()) m.set(r.speakerId, { displayName: r.displayName.trim() });
    }
    return m;
  }, [dialogueRows]);
  const dialogueLegend = dialogueSection?.readable.legend ?? fallbackTranscriptLegend;
  const matchSummary = useMemo(() => {
    const total = dialogueRows.length;
    const withSignals = dialogueRows.filter((r) => (r.matchSignals?.length ?? 0) > 0).length;
    const upSignals = dialogueRows.reduce(
      (acc, r) => acc + (r.matchSignals?.filter((s: NonNullable<ReportDialogueRow["matchSignals"]>[number]) => s.tone === "up").length ?? 0),
      0,
    );
    const downSignals = dialogueRows.reduce(
      (acc, r) => acc + (r.matchSignals?.filter((s: NonNullable<ReportDialogueRow["matchSignals"]>[number]) => s.tone === "down").length ?? 0),
      0,
    );
    return { total, withSignals, upSignals, downSignals };
  }, [dialogueRows]);

  function jumpToSegmentByIndex(idx: number) {
    const row = dialogueRows[idx];
    if (!row) return;
    const rowKey = `${row.speakerId}:${row.startTime}:${row.endTime}`;
    setActiveProsodyKey(rowKey);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const el = document.getElementById(`segment-card-${idx}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
  }
  const matchDynamics = useMemo(() => {
    const initiativeRaw = dialogueRows.map((row) => {
      let v = 0;
      for (const s of row.matchSignals ?? []) {
        if (s.code.includes("initiative")) v += 1;
        if (s.code.includes("yield") || s.code.includes("submission")) v -= 1;
      }
      return v;
    });
    const tensionRaw = dialogueRows.map((row) => {
      let v = 0;
      for (const s of row.matchSignals ?? []) {
        if (s.code.includes("tension") || s.code.includes("activation")) v += 1;
        if (s.code.includes("deactivation") || s.code.includes("phase_decline")) v -= 1;
      }
      return v;
    });
    return {
      initiative: normalizeSeries(initiativeRaw),
      tension: normalizeSeries(tensionRaw),
    };
  }, [dialogueRows]);
  const hasArtifactSections = Array.isArray(report?.artifactSections) && report.artifactSections.length > 0;
  const graphArtifactTypes = useMemo(
    () => [...new Set((report?.artifactSections ?? []).map((section) => section.artifactType))],
    [report?.artifactSections],
  );
  const segmentArtifactMatrix = useMemo(
    () =>
      dialogueRows.map((row) => {
        const psychCodes = new Set([
          "initiative_takeover",
          "interruption_risk",
          "dominance_pattern",
          "emotional_activation_peak",
          "emotional_deactivation",
          "cognitive_load_or_evasion",
          "turn_yielding",
          "submission_pattern",
          "tension_up",
          "phase_decline",
        ]);
        const hasPsychLabels = (row.matchSignals ?? []).some((signal) => psychCodes.has(signal.code));
        const hasNarrativeEvents = (row.signalDetails ?? []).some(
          (detail) => detail.startsWith("Событие таймлайна:") || detail.startsWith("Комментарий сегмента:"),
        );
        return {
          row,
          hasProsody: Boolean(row.prosody),
          hasPsychLabels,
          hasNarrativeEvents,
        };
      }),
    [dialogueRows],
  );
  const psychNarrativeEvents = psychNarrativeSection?.readable.timelineEvents ?? [];
  const psychFullGlobalCommentary = psychFullSection?.readable.globalCommentary ?? "";

  return (
    <main>
      <div className="stack">
        <div className="card">
          <h1>{copy.reportPage.title}</h1>
          <p>
            {copy.reportPage.sessionId}: {params.id}
          </p>
          {repeatReuseAvailable ? (
            <p className="stack" style={{ marginTop: 12 }}>
              <Link className="button" href={`/sessions/new?reuseFrom=${encodeURIComponent(params.id)}`}>
                Повторить
              </Link>
              <span className="field-hint">
                Новая сессия с тем же сценарием и готовым RDY (пропуск источника аудио, ASR, диаризации и т.д. до LLM).
                Доступно, если в хранилище есть финальный READY_SPEAKERS — в том числе при ошибке отчёта или LLM.
              </span>
            </p>
          ) : null}
          <p>
            <a href={`/api/sessions/${params.id}/report/pdf`} className="report-export-link">
              {copy.reportPage.exportPdf}
            </a>
          </p>
          <div className="meta">
            <span className="meta-chip">{copy.reportPage.chips[0]}</span>
            <span className="meta-chip">{copy.reportPage.chips[1]}</span>
          </div>
        </div>

        {!report && !error ? (
          <div className="card stack">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}

        {report ? (
          <>
            <div className="card">
          <p>
            {copy.reportPage.generatedAt}: <b>{new Date(report.generatedAt).toLocaleString()}</b>
          </p>
          <p>
            {copy.reportPage.policy}: {report.interpretationPolicy}
          </p>
            </div>

            <div className="card">
          <h2>{copy.reportPage.summary}</h2>
          <p>{report.summary.text}</p>
            </div>
            <section className="card transcript-card" aria-label="Основной отчет">
                  <h2>{copy.reportPage.transcript}</h2>
                  <div className="report-match-summary">
                    <span className="meta-chip">Эпизодов: {matchSummary.total}</span>
                    <span className="meta-chip">С оценками: {matchSummary.withSignals}</span>
                    <span className="meta-chip">↑ динамика: {matchSummary.upSignals}</span>
                    <span className="meta-chip">↓ динамика: {matchSummary.downSignals}</span>
                  </div>
                  {matchDynamics.initiative.length > 0 ? (
                    <div className="report-mini-charts">
                      <div className="report-mini-chart">
                        <p className="report-mini-chart-title">Инициатива по времени</p>
                        <div className="report-mini-chart-track" aria-label="График инициативы">
                          {matchDynamics.initiative.map((value, idx) => {
                            const h = 8 + Math.round(Math.abs(value) * 20);
                            const cls = value > 0 ? "is-up" : value < 0 ? "is-down" : "is-neutral";
                            return (
                              <button
                                key={`init_${idx}`}
                                type="button"
                                className={`report-mini-chart-bar ${cls}`}
                                style={{ height: `${h}px` }}
                                onClick={() => jumpToSegmentByIndex(idx)}
                                title={`Перейти к эпизоду ${idx + 1}`}
                                aria-label={`Перейти к эпизоду ${idx + 1}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <div className="report-mini-chart">
                        <p className="report-mini-chart-title">Напряжение по времени</p>
                        <div className="report-mini-chart-track" aria-label="График напряжения">
                          {matchDynamics.tension.map((value, idx) => {
                            const h = 8 + Math.round(Math.abs(value) * 20);
                            const cls = value > 0 ? "is-up" : value < 0 ? "is-down" : "is-neutral";
                            return (
                              <button
                                key={`tension_${idx}`}
                                type="button"
                                className={`report-mini-chart-bar ${cls}`}
                                style={{ height: `${h}px` }}
                                onClick={() => jumpToSegmentByIndex(idx)}
                                title={`Перейти к эпизоду ${idx + 1}`}
                                aria-label={`Перейти к эпизоду ${idx + 1}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {dialogueLegend ? (
                    <div className="report-dialogue-legend">
                      <span className="meta-chip">
                        {copy.reportPage.transcriptColSpeaker}: {dialogueLegend.speakerCount}
                      </span>
                      <span className="meta-chip">
                        {copy.reportPage.transcriptColTime}: {formatDurationHuman(dialogueLegend.durationSec)}
                      </span>
                      {hasTranscriptProsody ? (
                        <span className="meta-chip">
                          {copy.reportPage.transcriptGlobalBpmLead}{" "}
                          {transcriptGlobalBpm != null ? `${transcriptGlobalBpm.toFixed(1)} BPM` : copy.reportPage.transcriptGlobalBpmUnknown}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
              <div className="report-paired-timeline">
                {dialogueRows.map((row: ReportDialogueRow, index: number) => {
                        const rowKey = `${row.speakerId}:${row.startTime}:${row.endTime}`;
                        const unitId = `${rowKey}:${index}`;
                        const isActive = activeProsodyKey === rowKey;
                        const prosodyCells = formatProsodyCells(row.prosody);
                        const groupedSignals = (() => {
                          const sourceSignals = row.matchSignals ?? [];
                          const grouped = new Map<
                            string,
                            { label: string; tone: "up" | "down" | "neutral" | undefined; count: number }
                          >();
                          for (const signal of sourceSignals) {
                            const key = `${signal.label}|${signal.tone ?? "neutral"}`;
                            const existing = grouped.get(key);
                            if (existing) {
                              existing.count += 1;
                            } else {
                              grouped.set(key, { label: signal.label, tone: signal.tone, count: 1 });
                            }
                          }
                          return Array.from(grouped.values());
                        })();
                        const narrativeRefs = psychNarrativeEvents.filter((event) => {
                          const endSec = event.endSec ?? event.startSec;
                          const overlaps = row.startTime <= endSec && event.startSec <= row.endTime;
                          if (!overlaps) return false;
                          return event.actors.length === 0 || event.actors.includes(row.speakerId);
                        });
                        const narrativeSummary =
                          row.fullPsychEpisode?.narrativeCommentary ??
                          (narrativeRefs.length > 0
                            ? narrativeRefs.map((event) => event.summary).join(" ")
                            : row.signalDetails?.find((detail) => !detail.startsWith("Событие таймлайна:")) ?? "");
                        const narrativeForDisplay = substituteSpeakerRefsInPsychText(
                          narrativeSummary,
                          speakerPsychDisplayLookup,
                        );
                        const hasAnalysis =
                          Boolean(row.prosody) ||
                          groupedSignals.length > 0 ||
                          (row.signalDetails?.length ?? 0) > 0 ||
                          narrativeRefs.length > 0 ||
                          Boolean(row.fullPsychEpisode) ||
                          Boolean(narrativeForDisplay.trim());
                        const normDetail = (s: string) => s.replace(/\s+/g, " ").trim();
                        const narrativeNorm = normDetail(narrativeForDisplay);
                        const fullPsychConnectionLines = new Set<string>();
                        if (row.fullPsychEpisode?.phaseName) {
                          fullPsychConnectionLines.add(normDetail(`Фаза: ${row.fullPsychEpisode.phaseName}`));
                        }
                        if (row.fullPsychEpisode?.participantRoleHint) {
                          fullPsychConnectionLines.add(normDetail(`Роль участника: ${row.fullPsychEpisode.participantRoleHint}`));
                        }
                        const bulletPoints = [
                          ...new Set(
                            (row.signalDetails ?? []).filter((detail) => {
                              if (detail.startsWith("Событие таймлайна:")) return false;
                              const displayed = substituteSpeakerRefsInPsychText(detail, speakerPsychDisplayLookup);
                              const t = normDetail(displayed);
                              if (!t) return false;
                              if (t === narrativeNorm) return false;
                              if (detail.startsWith("Full-режим:") && normDetail(detail.slice("Full-режим:".length)) === narrativeNorm) {
                                return false;
                              }
                              if (
                                detail.startsWith("Full-режим:") &&
                                normDetail(substituteSpeakerRefsInPsychText(detail.slice("Full-режим:".length), speakerPsychDisplayLookup)) ===
                                  narrativeNorm
                              ) {
                                return false;
                              }
                              if (fullPsychConnectionLines.has(t)) return false;
                              return true;
                            }),
                          ),
                        ];
                        const evidenceLines = renderEvidenceCompact(row.fullPsychEpisode?.evidence ?? []);
                        const toneRank: Record<"up" | "down" | "neutral", number> = { up: 0, down: 0, neutral: 0 };
                        for (const signal of groupedSignals) {
                          if (signal.tone === "up" || signal.tone === "down") {
                            toneRank[signal.tone] += signal.count;
                          } else {
                            toneRank.neutral += signal.count;
                          }
                        }
                        const dominantTone: "up" | "down" | "neutral" =
                          toneRank.up >= toneRank.down && toneRank.up >= toneRank.neutral
                            ? "up"
                            : toneRank.down >= toneRank.neutral
                              ? "down"
                              : "neutral";
                        return (
                          <div className="report-paired-row" key={unitId} data-unit-id={unitId}>
                          <article
                            id={`segment-card-${index}`}
                            className={`report-dialogue-item${isActive ? " report-dialogue-item--active" : ""}`}
                            onMouseEnter={() => {
                              if (row.prosody) setActiveProsodyKey(rowKey);
                            }}
                            onClick={() => {
                              if (row.prosody) setActiveProsodyKey(rowKey);
                            }}
                          >
                            <header className="report-dialogue-item-head">
                              <strong>{renderSpeakerLabel(row.speakerId, row.displayName)}</strong>
                              <div className="report-dialogue-item-head-right">
                                <span>
                                  [{formatMmSs(row.startTime)}–{formatMmSs(row.endTime)}]
                                </span>
                              </div>
                            </header>
                            <div className="report-segment-body">
                              <p className="report-dialogue-item-text">{row.text}</p>
                            </div>
                          </article>

                          <div className="report-analysis-wrap">
                            <article
                              id={`analysis-card-${rowKey}`}
                              className={`report-analysis-item${groupedSignals.length > 0 ? ` report-analysis-item--tone-${dominantTone}` : ""}`}
                              data-unit-id={unitId}
                            >
                              <header className="report-analysis-item-head">
                                {groupedSignals.length > 0 ? (
                                  <div className="report-analysis-header-status">
                                    {groupedSignals.map((signal, sIdx) => (
                                      <span key={`analysis_head_${signal.label}_${sIdx}`} className={`report-signal ${signalToneClass(signal.tone)}`}>
                                        {signal.label}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="report-analysis-trigger-title" aria-hidden="true" />
                                )}
                                <span className="field-hint">
                                  [{formatMmSs(row.startTime)}–{formatMmSs(row.endTime)}]
                                </span>
                              </header>
                              {hasAnalysis ? (
                                <>
                                  {narrativeForDisplay ? (
                                    <div className="report-analysis-section" data-section-label="Нарратив">
                                      <p className="report-analysis-narrative">{narrativeForDisplay}</p>
                                    </div>
                                  ) : null}
                                  {bulletPoints.length > 0 ? (
                                    <div className="report-analysis-section" data-section-label="Детали эпизода">
                                      <ul className="report-analysis-bullets">
                                        {bulletPoints.map((detail, idx) => (
                                          <li key={`detail_${unitId}_${idx}`} className="field-hint">
                                            {substituteSpeakerRefsInPsychText(detail, speakerPsychDisplayLookup)}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {row.fullPsychEpisode ? (
                                    <div className="report-analysis-section" data-section-label="Связи full режима">
                                      <ul className="report-analysis-bullets">
                                        {row.fullPsychEpisode.phaseName ? (
                                          <li className="field-hint">Фаза: {row.fullPsychEpisode.phaseName}</li>
                                        ) : null}
                                        {row.fullPsychEpisode.participantRoleHint ? (
                                          <li className="field-hint">Роль участника: {row.fullPsychEpisode.participantRoleHint}</li>
                                        ) : null}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {evidenceLines.length > 0 ? (
                                    <div className="report-analysis-section" data-section-label="Metric evidence">
                                      <ul className="report-analysis-bullets">
                                        {evidenceLines.map((line, idx) => (
                                          <li key={`evidence_${unitId}_${idx}`} className="field-hint">{line}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {row.prosody ? (
                                    <div className="report-analysis-section report-analysis-prosody" data-section-label="Просодия">
                                      <details className="report-analysis-accordion">
                                        <summary>Показать метрики</summary>
                                        <p className="field-hint" title="RMS, CPS, ZCR, Centroid и Rolloff для сегмента">
                                          RMS {prosodyCells.rms} · CPS {prosodyCells.cps} · ZCR {prosodyCells.zcr} · Centroid {prosodyCells.cent} · Rolloff {prosodyCells.roll}
                                        </p>
                                      </details>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <p className="field-hint">Дополнительных данных по эпизоду нет.</p>
                              )}
                            </article>
                          </div>
                        </div>
                      );
                    })}
              </div>
            </section>

            {hasArtifactSections ? (
              <div className="card">
                <h2>Артефакты по графу для сегментов RDY</h2>
                <p className="field-hint">
                  Подключено по графу: {graphArtifactTypes.length > 0 ? graphArtifactTypes.join(", ") : "—"}
                </p>
                <p className="field-hint">
                  Колонки ниже — не «есть ли артефакт в сессии», а есть ли на этой строке диалога признаки,
                  которые отчёт смог сопоставить: просодика берётся только если строки построены из{" "}
                  <code>ENRICHED_TRANSCRIPT</code> (метрики на сегменте). При отображении только{" "}
                  <code>READY_SPEAKERS</code> здесь будет «—», хотя ENRICHED мог использоваться в PSYCH_STATE/LLM.
                </p>
                <div className="report-summary-table-wrap">
                  <table className="report-summary-table">
                    <thead>
                      <tr>
                        <th>Сегмент RDY</th>
                        <th title="Фактически: есть ли row.prosody (метрики только у строк из ENRICHED_TRANSCRIPT)">
                          Просодика (как ENRICHED)
                        </th>
                        <th title="Есть ли на строке сигналы матчера из набора initiative/tension/…">
                          Паттерны PSYCH
                        </th>
                        <th title="Есть ли на строке следы таймлайна/комментария сегмента в matchSignals">
                          Нарратив LLM (таймлайн/сегмент)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {segmentArtifactMatrix.map((entry, idx) => (
                        <tr key={`artifact_row_${idx}`}>
                          <td>
                            {renderSpeakerLabel(entry.row.speakerId, entry.row.displayName)} [{formatMmSs(entry.row.startTime)}-{formatMmSs(entry.row.endTime)}]
                          </td>
                          <td>{entry.hasProsody ? "есть" : "—"}</td>
                          <td>{entry.hasPsychLabels ? "есть" : "—"}</td>
                          <td>{entry.hasNarrativeEvents ? "есть" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {psychFullGlobalCommentary ? (
              <div className="card">
                <h2>Full psycho analytics</h2>
                <p>{psychFullGlobalCommentary}</p>
              </div>
            ) : null}
          </>
        ) : null}

        <nav className="report-nav" aria-label="Навигация отчёта">
          <Link href="/">{copy.reportPage.backToHome}</Link>
          <span aria-hidden="true">·</span>
          <Link href={`/sessions/${params.id}/status`}>{copy.reportPage.backToStatus}</Link>
          {repeatReuseAvailable ? (
            <>
              <span aria-hidden="true">·</span>
              <Link href={`/sessions/new?reuseFrom=${encodeURIComponent(params.id)}`}>Повторить</Link>
            </>
          ) : null}
        </nav>
      </div>
    </main>
  );
}
