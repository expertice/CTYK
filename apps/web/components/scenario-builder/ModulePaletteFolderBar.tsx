"use client";

import { useCallback, useState } from "react";
import type { ModuleCatalogEntry } from "../../lib/pipeline/module-catalog";
import { ModulePaletteCard } from "./ModulePaletteCard";

export interface PaletteFolderDef {
  id: string;
  label: string;
  entries: ModuleCatalogEntry[];
}

export function ModulePaletteFolderBar({
  folders,
  tailModules,
  bindDrag,
}: {
  folders: PaletteFolderDef[];
  tailModules: ModuleCatalogEntry[];
  bindDrag: (m: ModuleCatalogEntry) => (e: React.DragEvent<HTMLButtonElement>) => void;
}) {
  /** Аккордеон: одновременно открыта не больше одной папки. */
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id));
  }, []);

  return (
    <div className="scenario-palette-folder-root">
      <div className="scenario-module-palette-row scenario-module-palette-row--with-folder">
        {folders.map((f) => {
          const isOpen = openId === f.id;
          return (
            <div key={f.id} className="scenario-palette-folder-toggle-wrap">
              <button
                id={`palette-folder-${f.id}`}
                type="button"
                className="scenario-palette-folder-toggle"
                aria-expanded={isOpen}
                aria-controls={`palette-folder-panel-${f.id}`}
                onClick={() => toggle(f.id)}
              >
                <span className="scenario-palette-folder-icon" aria-hidden>
                  <svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      fill="currentColor"
                      fillOpacity="0.92"
                      d="M2 2.5h5.2l1.4 1.5H16a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5a1 1 0 011-1z"
                    />
                    <path
                      fill="currentColor"
                      fillOpacity="0.35"
                      d="M2 3.5h5.5l1.2 1.2-.3.3H2v-1.5z"
                    />
                  </svg>
                </span>
                <span className="scenario-palette-folder-label">{f.label}</span>
                <span className="scenario-palette-folder-chevron" aria-hidden>
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>
            </div>
          );
        })}
        {tailModules.map((m) => (
          <ModulePaletteCard key={m.id} entry={m} onDragStart={bindDrag(m)} />
        ))}
      </div>
      {folders.map((f) =>
        openId === f.id ? (
          <div
            key={f.id}
            id={`palette-folder-panel-${f.id}`}
            role="region"
            className="scenario-palette-folder-panel"
            aria-labelledby={`palette-folder-${f.id}`}
          >
            <div className="scenario-module-palette-row scenario-module-palette-row--folder-pick">
              {f.entries.map((m) => (
                <ModulePaletteCard key={m.id} entry={m} onDragStart={bindDrag(m)} />
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}
