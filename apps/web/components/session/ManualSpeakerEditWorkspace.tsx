"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type DraftSegment = {
  speakerId: string;
  startTime: number;
  endTime: number;
  text: string;
};

type RowModel = DraftSegment & { rowId: string };

/** Границы предложения в исходной строке (символы [start, end) в `fullText`). */
type SentenceSpan = { start: number; end: number };

function sentenceSpans(fullText: string): SentenceSpan[] {
  const text = fullText;
  if (!text.trim()) return [];
  const spans: SentenceSpan[] = [];
  let segStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isEnd =
      (ch === "." || ch === "!" || ch === "?" || ch === "…") &&
      (i === text.length - 1 || /\s/.test(text[i + 1] ?? ""));
    if (isEnd) {
      const end = i + 1;
      if (end > segStart) {
        spans.push({ start: segStart, end });
      }
      let j = end;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      segStart = j;
      i = j - 1;
    }
  }
  if (segStart < text.length) {
    spans.push({ start: segStart, end: text.length });
  }
  return spans.length > 0 ? spans : [{ start: 0, end: text.length }];
}

function selectionKey(rowId: string, sentenceIndex: number): string {
  return `${rowId}:${sentenceIndex}`;
}

function parseSelectionKey(key: string): { rowId: string; index: number } | null {
  const i = key.lastIndexOf(":");
  if (i <= 0) return null;
  const rowId = key.slice(0, i);
  const index = Number.parseInt(key.slice(i + 1), 10);
  if (!Number.isFinite(index)) return null;
  return { rowId, index };
}

/** После назначения спикера выбранным предложениям — новые строки с пропорцией по длине текста. */
function rebuildRowFromSentenceSpeakers(
  row: RowModel,
  sentenceIndices: Set<number>,
  targetSpeakerId: string,
): RowModel[] {
  const spans = sentenceSpans(row.text);
  if (spans.length === 0) return [{ ...row }];

  type Group = { speakerId: string; i0: number; i1: number };
  const groups: Group[] = [];
  let s = 0;
  while (s < spans.length) {
    const spk = sentenceIndices.has(s) ? targetSpeakerId : row.speakerId;
    let e = s;
    while (e + 1 < spans.length) {
      const nextSpk = sentenceIndices.has(e + 1) ? targetSpeakerId : row.speakerId;
      if (nextSpk !== spk) break;
      e++;
    }
    groups.push({ speakerId: spk, i0: s, i1: e });
    s = e + 1;
  }

  const totalLen = Math.max(1, row.text.length);
  const dur = Math.max(0.001, row.endTime - row.startTime);
  const out: RowModel[] = [];

  for (const g of groups) {
    const c0 = spans[g.i0]!.start;
    const c1 = spans[g.i1]!.end;
    const chunk = row.text.slice(c0, c1).trim();
    if (!chunk) continue;
    const t0 = row.startTime + dur * (c0 / totalLen);
    const t1 = row.startTime + dur * (c1 / totalLen);
    out.push({
      rowId: newRowId(),
      speakerId: g.speakerId,
      startTime: t0,
      endTime: t1,
      text: chunk,
    });
  }

  if (out.length === 0) return [{ ...row }];
  out[out.length - 1]!.endTime = row.endTime;
  return out;
}

function formatTc(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const secStr = sec < 10 ? `0${sec.toFixed(2)}` : sec.toFixed(2);
  return `${m}:${secStr}`;
}

function newRowId(): string {
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function uniqueSpeakerIds(rows: RowModel[]): string[] {
  const set = new Set<string>();
  for (const r of rows) set.add(r.speakerId);
  return [...set];
}

/** Сливает подряд идущие строки с одним speakerId: текст через пробел, время от первой до последней. */
function mergeConsecutiveSameSpeakerRows(rows: RowModel[]): RowModel[] {
  if (rows.length === 0) return [];
  const out: RowModel[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.speakerId === r.speakerId) {
      const joined = `${last.text} ${r.text}`.replace(/\s+/g, " ").trim();
      out[out.length - 1] = {
        ...last,
        text: joined,
        endTime: r.endTime,
      };
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export interface ManualSpeakerEditWorkspaceCopy {
  title: string;
  addSpeaker: string;
  colSpeaker: string;
  colTime: string;
  colText: string;
  continue: string;
  submitting: string;
  assignSelection: string;
  close: string;
  dockCollapse: string;
  dockExpand: string;
  dockShortLabel: string;
}

export function ManualSpeakerEditWorkspace(props: {
  sessionId: string;
  initialSegments: DraftSegment[];
  copy: ManualSpeakerEditWorkspaceCopy;
  onSubmitted?: () => void;
}) {
  const { initialSegments, copy, sessionId, onSubmitted } = props;
  const [rows, setRows] = useState<RowModel[]>(() =>
    mergeConsecutiveSameSpeakerRows(initialSegments.map((s) => ({ ...s, rowId: newRowId() }))),
  );
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [extraSpeakers, setExtraSpeakers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  /** Выделенные предложения: ключ `rowId:index` */
  const [selectedSentenceKeys, setSelectedSentenceKeys] = useState<Set<string>>(() => new Set());
  /** Кастомное меню спикеров (без native select — не дёргает скролл страницы). */
  const [speakerMenu, setSpeakerMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [speakerDockCollapsed, setSpeakerDockCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("manual-speaker-dock-collapsed") === "1") {
        setSpeakerDockCollapsed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  /** Без этого каждый poll статуса даёт новый массив `segments` → сбрасывались строки, выделение и меню. */
  const draftFingerprint = useMemo(
    () =>
      JSON.stringify(
        initialSegments.map((s) => ({
          speakerId: s.speakerId,
          startTime: s.startTime,
          endTime: s.endTime,
          text: s.text,
        })),
      ),
    [initialSegments],
  );

  useEffect(() => {
    setRows(mergeConsecutiveSameSpeakerRows(initialSegments.map((s) => ({ ...s, rowId: newRowId() }))));
    setSelectedSentenceKeys(new Set());
    setSpeakerMenu(null);
    // Только при смене содержимого черновика с сервера, не при каждом poll (новая ссылка на тот же массив).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialSegments согласован с draftFingerprint в том же рендере
  }, [draftFingerprint]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/tags`, { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { tags?: Array<{ type: string; speakerId?: string; value: string }> };
        const next: Record<string, string> = {};
        for (const t of data.tags ?? []) {
          if (t.type === "speaker" && t.speakerId && t.value) next[t.speakerId] = t.value;
        }
        if (!cancelled && Object.keys(next).length) setLabels((prev) => ({ ...next, ...prev }));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!speakerMenu) return;
    function onDocPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".manual-speaker-triangle")) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setSpeakerMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSpeakerMenu(null);
    }
    let detach: (() => void) | undefined;
    const openTick = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true);
      detach = () => document.removeEventListener("pointerdown", onDocPointerDown, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(openTick);
      detach?.();
      document.removeEventListener("keydown", onKey);
    };
  }, [speakerMenu]);

  const speakerOptions = useMemo(() => {
    const fromRows = uniqueSpeakerIds(rows);
    const merged = new Set<string>([...fromRows, ...extraSpeakers]);
    return [...merged];
  }, [rows, extraSpeakers]);

  const displayFor = useCallback(
    (id: string) => {
      const l = labels[id]?.trim();
      return l || id;
    },
    [labels],
  );

  const addSpeaker = useCallback(() => {
    const n = extraSpeakers.length + 1;
    const id = `speaker_new_${Date.now()}`;
    setExtraSpeakers((prev) => [...prev, id]);
    setLabels((prev) => ({ ...prev, [id]: `Спикер ${n}` }));
  }, [extraSpeakers.length]);

  const toggleSpeakerDock = useCallback(() => {
    setSpeakerDockCollapsed((c) => {
      const next = !c;
      try {
        sessionStorage.setItem("manual-speaker-dock-collapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setRowSpeaker = useCallback((rowId: string, speakerId: string) => {
    setRows((prev) =>
      mergeConsecutiveSameSpeakerRows(prev.map((r) => (r.rowId === rowId ? { ...r, speakerId } : r))),
    );
    setSelectedSentenceKeys(new Set());
    setSpeakerMenu(null);
  }, []);

  const toggleSentence = useCallback((rowId: string, sentenceIndex: number) => {
    const key = selectionKey(rowId, sentenceIndex);
    setSelectedSentenceKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSpeakerMenu(null);
  }, []);

  const indicesForRow = useCallback(
    (rowId: string): Set<number> => {
      const out = new Set<number>();
      for (const k of selectedSentenceKeys) {
        const p = parseSelectionKey(k);
        if (p && p.rowId === rowId) out.add(p.index);
      }
      return out;
    },
    [selectedSentenceKeys],
  );

  const applySpeakerToRowSelection = useCallback(
    (rowId: string, targetSpeakerId: string) => {
      const indices = indicesForRow(rowId);
      if (indices.size === 0) {
        setSpeakerMenu(null);
        return;
      }
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.rowId === rowId);
        if (idx < 0) return prev;
        const row = prev[idx]!;
        const rebuilt = rebuildRowFromSentenceSpeakers(row, indices, targetSpeakerId);
        const before = prev.slice(0, idx);
        const after = prev.slice(idx + 1);
        return mergeConsecutiveSameSpeakerRows([...before, ...rebuilt, ...after]);
      });
      setSelectedSentenceKeys(new Set());
      setSpeakerMenu(null);
    },
    [indicesForRow],
  );

  const openSpeakerMenu = useCallback(
    (rowId: string, e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      setSpeakerMenu({
        rowId,
        x: rect.left,
        y: rect.bottom + 6,
      });
    },
    [],
  );

  const onTrianglePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onContinue = useCallback(async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const segments: DraftSegment[] = rows.map(({ speakerId, startTime, endTime, text }) => ({
        speakerId,
        startTime,
        endTime,
        text,
      }));
      const speakerLabels: Record<string, string> = {};
      for (const id of speakerOptions) {
        const v = labels[id]?.trim();
        if (v) speakerLabels[id] = v;
      }
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/speaker-draft/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments, speakerLabels }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      onSubmitted?.();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  }, [rows, labels, speakerOptions, sessionId, onSubmitted]);

  return (
    <div className="manual-speaker-workspace stack">
      <h2 className="manual-speaker-title">{copy.title}</h2>

      <div
        className={
          speakerDockCollapsed
            ? "manual-speaker-chips-dock manual-speaker-chips-dock--collapsed"
            : "manual-speaker-chips-dock"
        }
      >
        <div className="manual-speaker-chips-dock-top">
          {!speakerDockCollapsed ? (
            <h3 className="manual-speaker-chips-dock-heading">{copy.dockShortLabel}</h3>
          ) : null}
          <button
            type="button"
            className="manual-speaker-chips-dock-toggle"
            onClick={toggleSpeakerDock}
            aria-expanded={!speakerDockCollapsed}
            title={speakerDockCollapsed ? copy.dockExpand : copy.dockCollapse}
            aria-label={speakerDockCollapsed ? copy.dockExpand : copy.dockCollapse}
          >
            <span aria-hidden>{speakerDockCollapsed ? "▶" : "◀"}</span>
          </button>
        </div>
        {speakerDockCollapsed ? (
          <span className="manual-speaker-chips-dock-strip-label">{copy.dockShortLabel}</span>
        ) : null}
        <div
          className={
            speakerDockCollapsed
              ? "manual-speaker-chips manual-speaker-chips--dock-inner manual-speaker-chips--dock-inner-collapsed"
              : "manual-speaker-chips manual-speaker-chips--dock-inner"
          }
          aria-label="Спикеры"
        >
          {speakerOptions.map((id) => (
            <label key={id} className="manual-speaker-chip">
              <span className="manual-speaker-chip-id">{id}</span>
              <input
                type="text"
                value={labels[id] ?? ""}
                placeholder={id}
                onChange={(e) => setLabels((p) => ({ ...p, [id]: e.target.value }))}
                aria-label={`Имя для ${id}`}
              />
            </label>
          ))}
          <button type="button" className="button-ghost manual-speaker-add" onClick={addSpeaker}>
            + {copy.addSpeaker}
          </button>
        </div>
      </div>

      <div className="manual-speaker-table-wrap">
        <table className="manual-speaker-table">
          <colgroup>
            <col className="manual-speaker-col-speaker" />
            <col className="manual-speaker-col-time" />
            <col className="manual-speaker-col-text" />
          </colgroup>
          <thead>
            <tr>
              <th>{copy.colSpeaker}</th>
              <th>{copy.colTime}</th>
              <th>{copy.colText}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const spans = sentenceSpans(row.text);
              return (
                <tr key={row.rowId}>
                  <td className="manual-speaker-td-speaker">
                    <select
                      className="manual-speaker-row-select"
                      value={row.speakerId}
                      onChange={(e) => setRowSpeaker(row.rowId, e.target.value)}
                      aria-label={copy.colSpeaker}
                    >
                      {speakerOptions.map((id) => (
                        <option key={id} value={id}>
                          {displayFor(id)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="manual-speaker-time manual-speaker-time--stack">
                    <span className="manual-speaker-time-line">{formatTc(row.startTime)}</span>
                    <span className="manual-speaker-time-line">{formatTc(row.endTime)}</span>
                  </td>
                  <td className="manual-speaker-text-cell">
                    <div className="manual-speaker-sentences">
                      {spans.length === 0 ? (
                        <span className="manual-speaker-sent-fallback">{row.text.trim() || "—"}</span>
                      ) : null}
                      {spans.map((span, sidx) => {
                        const key = selectionKey(row.rowId, sidx);
                        const selected = selectedSentenceKeys.has(key);
                        const piece = row.text.slice(span.start, span.end);
                        return (
                          <span key={sidx} className="manual-speaker-sent-wrap">
                            <button
                              type="button"
                              className={
                                selected
                                  ? "manual-speaker-sent manual-speaker-sent--selected"
                                  : "manual-speaker-sent"
                              }
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleSentence(row.rowId, sidx);
                              }}
                            >
                              {piece}
                            </button>
                            {selected ? (
                              <button
                                type="button"
                                className="manual-speaker-triangle"
                                aria-label={copy.assignSelection}
                                title={copy.assignSelection}
                                onPointerDown={onTrianglePointerDown}
                                onClick={(e) => openSpeakerMenu(row.rowId, e)}
                              >
                                <span className="manual-speaker-triangle-icon" aria-hidden />
                              </button>
                            ) : null}
                            {sidx < spans.length - 1 ? <span className="manual-speaker-sent-gap"> </span> : null}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {speakerMenu ? (
        <div
          ref={menuRef}
          className="manual-speaker-speaker-menu"
          style={{
            left:
              typeof window !== "undefined"
                ? Math.max(8, Math.min(speakerMenu.x, window.innerWidth - 240))
                : speakerMenu.x,
            top: speakerMenu.y,
          }}
          role="listbox"
          aria-label={copy.assignSelection}
        >
          <div className="manual-speaker-speaker-menu-title">{copy.assignSelection}</div>
          <ul className="manual-speaker-speaker-menu-list">
            {speakerOptions.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="manual-speaker-speaker-menu-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    applySpeakerToRowSelection(speakerMenu.rowId, id);
                  }}
                >
                  {displayFor(id)}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="manual-speaker-speaker-menu-close button-ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSpeakerMenu(null)}
          >
            {copy.close}
          </button>
        </div>
      ) : null}

      {submitError ? <p className="error">{submitError}</p> : null}

      <div className="manual-speaker-footer">
        <button type="button" className="button-primary" disabled={submitting} onClick={() => void onContinue()}>
          {submitting ? copy.submitting : copy.continue}
        </button>
      </div>
    </div>
  );
}
