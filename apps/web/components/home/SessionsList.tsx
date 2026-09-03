"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { tRunStatus, getUiCopy } from "../../lib/i18n/ui-copy";
import type { SessionListItem } from "../../lib/pipeline/async-run-store";

interface Props {
  sessions: SessionListItem[];
}

export default function SessionsList({ sessions }: Props) {
  const copy = getUiCopy("ru");
  const hc = copy.home;
  const [items, setItems] = useState<SessionListItem[]>(sessions);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshMenuOpen, setRefreshMenuOpen] = useState(false);
  const [refreshMs, setRefreshMs] = useState<number>(30000);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sessionMenuOpenId, setSessionMenuOpenId] = useState<string | null>(null);
  const [sessionMenuPos, setSessionMenuPos] = useState<{ top: number; right: number } | null>(null);

  const hasUnfinished = useMemo(
    () => items.some((s) => s.status === "queued" || s.status === "running"),
    [items],
  );
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.sessionId.toLowerCase().includes(q) ||
        (s.currentStepModuleId ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    setItems(sessions);
  }, [sessions]);

  useEffect(() => {
    if (sessionMenuOpenId == null) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const root = t.closest(`[data-session-menu-root="${sessionMenuOpenId}"]`);
      if (root) return;
      setSessionMenuOpenId(null);
      setSessionMenuPos(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSessionMenuOpenId(null);
        setSessionMenuPos(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sessionMenuOpenId]);

  useEffect(() => {
    if (!refreshMs) return;
    const timer = setInterval(() => {
      if (!hasUnfinished) return;
      void refreshSessions();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, hasUnfinished]);

  async function refreshSessions() {
    const response = await fetch("/api/sessions", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { sessions?: SessionListItem[] };
    setItems(payload.sessions ?? []);
  }

  async function onDelete(sessionId: string) {
    setDeletingId(sessionId);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Delete failed");
      }
      setItems((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } finally {
      setDeletingId(null);
    }
  }

  async function onRenameSave(sessionId: string) {
    const nextName = renameValue.trim();
    if (!nextName) return;
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });
    if (!response.ok) return;
    setItems((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, displayName: nextName } : s)));
    setRenamingId(null);
    setRenameValue("");
  }

  return (
    <>
      <div className="sessions-head">
        <h2>{copy.home.sessionsTitle}</h2>
        <div className="sessions-refresh">
          <input
            type="search"
            placeholder="Поиск сессии..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sessions-search"
          />
          <button
            type="button"
            className="button-ghost sessions-refresh-clock"
            onClick={() => setRefreshMenuOpen((v) => !v)}
            aria-label="Настройки автообновления"
            title="Автообновление"
          >
            🕒
          </button>
          {refreshMenuOpen ? (
            <select
              value={String(refreshMs)}
              onChange={(e) => {
                setRefreshMs(Number(e.target.value));
                setRefreshMenuOpen(false);
              }}
            >
              <option value="10000">10 сек</option>
              <option value="30000">30 сек</option>
              <option value="60000">1 мин</option>
              <option value="300000">5 мин</option>
              <option value="0">Откл</option>
            </select>
          ) : null}
        </div>
      </div>
      {filteredItems.length === 0 ? (
        <p className="session-list-empty">{copy.home.sessionsEmpty}</p>
      ) : (
        <ul className="session-list">
          {filteredItems.map((s) => (
            <li key={s.sessionId} className="session-list-item">
              <div className="session-list-main">
                {renamingId === s.sessionId ? (
                  <div className="session-rename-inline">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="icon-button"
                      title="Сохранить"
                      aria-label="Сохранить"
                      onClick={() => void onRenameSave(s.sessionId)}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Отмена"
                      aria-label="Отмена"
                      onClick={() => {
                        setRenamingId(null);
                        setRenameValue("");
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <span className="session-list-id" title={s.displayName}>
                    {s.displayName}
                  </span>
                )}
                <span className="session-list-meta">ID: {s.sessionId}</span>
                <span className="session-list-meta">
                  {copy.home.sessionStarted}:{" "}
                  {s.startedAt
                    ? new Date(s.startedAt).toLocaleString()
                    : s.queuedAt
                      ? new Date(s.queuedAt).toLocaleString()
                      : "—"}
                </span>
                <Link href={`/sessions/${s.sessionId}/status`} className="session-list-status">
                  {tRunStatus(s.status, "ru")}
                  {s.status === "queued"
                    ? " · очередь"
                    : s.currentStepModuleId
                      ? ` · ${s.currentStepModuleId}`
                      : ""}
                </Link>
                <div className="report-card-preview" aria-label="Шаблон отчета">
                  <div className="report-card-preview-main">
                    <span className="report-card-preview-icon" aria-hidden="true">
                      🧾
                    </span>
                    <span>Транскрипт (RDY + IDM)</span>
                  </div>
                  <div className="report-card-preview-side">
                    {s.reportModules.length > 0 ? s.reportModules.join(", ") : "Доп. аналитика ожидается"}
                  </div>
                </div>
              </div>
              <div
                className="session-menu-root"
                data-session-menu-root={s.sessionId}
              >
                <button
                  type="button"
                  className="icon-button session-menu-trigger"
                  aria-expanded={sessionMenuOpenId === s.sessionId}
                  aria-haspopup="menu"
                  aria-label={hc.sessionMenuAria}
                  title={hc.sessionMenuAria}
                  onClick={(e) => {
                    const next = sessionMenuOpenId === s.sessionId ? null : s.sessionId;
                    if (next == null) {
                      setSessionMenuOpenId(null);
                      setSessionMenuPos(null);
                      return;
                    }
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setSessionMenuOpenId(next);
                    setSessionMenuPos({
                      top: rect.bottom + 4,
                      right: window.innerWidth - rect.right,
                    });
                  }}
                >
                  <span className="session-menu-burger" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                </button>
                {sessionMenuOpenId === s.sessionId ? (
                  <div
                    className="session-menu-dropdown"
                    role="menu"
                    style={
                      sessionMenuPos
                        ? {
                            top: sessionMenuPos.top,
                            right: sessionMenuPos.right,
                          }
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className="session-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setSessionMenuOpenId(null);
                        setSessionMenuPos(null);
                        setRenamingId(s.sessionId);
                        setRenameValue(s.displayName);
                      }}
                    >
                      {hc.sessionMenuRename}
                    </button>
                    {s.status === "succeeded" ? (
                      <Link
                        href={`/sessions/${s.sessionId}`}
                        className="session-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setSessionMenuOpenId(null);
                          setSessionMenuPos(null);
                        }}
                      >
                        {hc.sessionMenuReport}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="session-menu-item"
                        role="menuitem"
                        disabled
                        title={hc.sessionMenuReportDisabledHint}
                      >
                        {hc.sessionMenuReport}
                      </button>
                    )}
                    <button
                      type="button"
                      className="session-menu-item session-menu-item--danger"
                      role="menuitem"
                      disabled={deletingId === s.sessionId}
                      onClick={() => {
                        setSessionMenuOpenId(null);
                        setSessionMenuPos(null);
                        if (!window.confirm(`Удалить сессию ${s.sessionId}?`)) {
                          return;
                        }
                        void onDelete(s.sessionId);
                      }}
                    >
                      {deletingId === s.sessionId ? "…" : hc.sessionMenuDelete}
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
