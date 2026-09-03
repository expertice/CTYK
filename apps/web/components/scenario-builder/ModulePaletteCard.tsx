"use client";

import type { ModuleCatalogEntry } from "../../lib/pipeline/module-catalog";

export function ModulePaletteCard({
  entry,
  onDragStart,
}: {
  entry: ModuleCatalogEntry;
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="scenario-palette-module-wrap">
      <button
        type="button"
        className="scenario-palette-module-card"
        draggable
        title={entry.description}
        onDragStart={onDragStart}
      >
        <span className="scenario-palette-module-core-label">{entry.label}</span>
      </button>
    </div>
  );
}
