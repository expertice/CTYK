/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getUiCopy } from "../../lib/i18n/ui-copy";

export interface HomeScenarioItem {
  id: string;
  name: string;
  source: "builtin" | "stored";
  latestVersion: number | null;
  updatedAt: string | null;
}

function sortScenarios(items: HomeScenarioItem[]): HomeScenarioItem[] {
  return [...items].sort((a, b) => {
    if (a.source === "builtin" && b.source !== "builtin") return -1;
    if (b.source === "builtin" && a.source !== "builtin") return 1;
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return a.name.localeCompare(b.name, "ru");
  });
}

export default function ScenariosPanel({ scenarios }: { scenarios: HomeScenarioItem[] }) {
  const copy = getUiCopy("ru");
  const hc = copy.home;

  const router = useRouter();
  const [items, setItems] = useState<HomeScenarioItem[]>(scenarios);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [scenarioMenuOpenId, setScenarioMenuOpenId] = useState<string | null>(null);
  const [scenarioMenuPos, setScenarioMenuPos] = useState<{ top: number; right: number } | null>(null);

  const rows = useMemo(() => sortScenarios(items), [items]);

  useEffect(() => {
    setItems(scenarios);
  }, [scenarios]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (scenarioMenuOpenId == null) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const root = t.closest(`[data-scenario-menu-root="${scenarioMenuOpenId}"]`);
      if (root) return;
      setScenarioMenuOpenId(null);
      setScenarioMenuPos(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setScenarioMenuOpenId(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [scenarioMenuOpenId]);

  async function refresh() {
    const r = await fetch("/api/scenarios", { cache: "no-store" });
    if (!r.ok) return;
    const payload = (await r.json()) as { scenarios?: HomeScenarioItem[] };
    setItems(payload.scenarios ?? []);
  }

  async function onRenameSave(id: string) {
    const nextName = renameValue.trim();
    if (!nextName) return;
    const r = await fetch(`/api/scenarios/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });
    if (!r.ok) return;
    await refresh();
    setRenamingId(null);
    setRenameValue("");
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    try {
      const r = await fetch(`/api/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) return;
      await refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="stack">
      <div className="sessions-head">
        <h2>{hc.scenariosTitle}</h2>
        <div className="sessions-refresh" style={{ justifyContent: "flex-end" }}>
          <Link
            href="/scenarios/build"
            className="icon-button"
            aria-label={hc.scenariosOpenBuilder}
            title={hc.scenariosOpenBuilder}
          >
            ⌁
          </Link>
          <button
            type="button"
            className="icon-button"
            onClick={() => router.push("/scenarios/build?newScenario=1")}
            title={hc.scenariosOpenNew}
            aria-label={hc.scenariosOpenNew}
          >
            +
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="session-list-empty">{hc.scenariosEmpty}</p>
      ) : (
        <ul className="session-list session-list--scenarios">
          {rows.map((s) => (
            <li key={s.id} className="session-list-item">
              <div className="session-list-main">
                {renamingId === s.id ? (
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
                      onClick={() => void onRenameSave(s.id)}
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
                  <span className="session-list-id" title={s.name}>
                    {s.name}
                  </span>
                )}
                <span className="session-list-meta">ID: {s.id}</span>
                <span className="session-list-meta session-list-meta--row">
                  {s.source === "builtin" ? (
                    <span className="scenario-badge scenario-badge--builtin">{hc.scenarioBuiltinBadge}</span>
                  ) : (
                    <>
                      {s.latestVersion != null ? (
                        <span className="scenario-badge scenario-badge--stored">
                          {hc.scenarioVersionLabel.replace("{v}", String(s.latestVersion))}
                        </span>
                      ) : null}
                      {s.updatedAt ? (
                        <>
                          {" "}
                          · {hc.scenarioUpdated}: {new Date(s.updatedAt).toLocaleString("ru-RU")}
                        </>
                      ) : null}
                    </>
                  )}
                </span>
              </div>

              <div
                className="session-menu-root"
                data-scenario-menu-root={s.id}
                style={{ marginLeft: "auto" }}
              >
                <button
                  type="button"
                  className="icon-button session-menu-trigger"
                  aria-expanded={scenarioMenuOpenId === s.id}
                  aria-haspopup="menu"
                  aria-label={hc.scenarioMenuAria}
                  title={hc.scenarioMenuAria}
                  onClick={(e) => {
                    const nextId = scenarioMenuOpenId === s.id ? null : s.id;
                    if (nextId == null) {
                      setScenarioMenuOpenId(null);
                      setScenarioMenuPos(null);
                      return;
                    }

                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setScenarioMenuOpenId(nextId);
                    setScenarioMenuPos({
                      top: rect.bottom + 4,
                      right: window.innerWidth - rect.right,
                    });
                  }}
                  disabled={false}
                >
                  <span className="session-menu-burger" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                </button>
                {scenarioMenuOpenId === s.id ? (
                  <div
                    className="session-menu-dropdown"
                    role="menu"
                    data-scenario-menu-root={s.id}
                    style={
                      scenarioMenuPos
                        ? {
                            top: scenarioMenuPos.top,
                            right: scenarioMenuPos.right,
                          }
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className="session-menu-item"
                      role="menuitem"
                      disabled={s.source === "builtin"}
                      onClick={() => {
                        setScenarioMenuOpenId(null);
                        if (s.source === "builtin") return;
                        setRenamingId(s.id);
                        setRenameValue(s.name);
                      }}
                    >
                      {hc.scenarioMenuRename}
                    </button>
                    <button
                      type="button"
                      className="session-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setScenarioMenuOpenId(null);
                        router.push(`/scenarios/build?scenarioId=${encodeURIComponent(s.id)}`);
                      }}
                    >
                      {hc.scenarioMenuEdit}
                    </button>
                    <button
                      type="button"
                      className="session-menu-item session-menu-item--danger"
                      role="menuitem"
                      disabled={s.source === "builtin" || deletingId === s.id}
                      onClick={() => {
                        setScenarioMenuOpenId(null);
                        if (s.source === "builtin") return;
                        if (!window.confirm(`Удалить сценарий ${s.name}?`)) return;
                        void onDelete(s.id);
                      }}
                    >
                      {deletingId === s.id ? "…" : hc.scenarioMenuDelete}
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
