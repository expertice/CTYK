import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore } from "../../../types/artifact.types";
import type { IProcessingModule } from "../orchestrator";
import { getWebAppRoot } from "../../local-models/web-root";

type ChecklistDefinition = {
  items: Array<{
    id: string;
    label: string;
    category?: string;
    weight?: number;
    priority?: "critical" | "important" | "optional";
  }>;
};

export class ChecklistSourceModule implements IProcessingModule {
  id = "CHECKLIST_SOURCE" as const;

  async run(input: {
    sessionId: string;
    stepId: string;
    runId: string;
    config: Record<string, unknown>;
    artifacts: ArtifactStore;
  }): Promise<Partial<ArtifactStore>> {
    const filePathRaw = typeof input.config.filePath === "string" ? input.config.filePath.trim() : "";
    if (!filePathRaw) {
      throw new Error("CHECKLIST_SOURCE: config.filePath is required");
    }

    const absPath = path.isAbsolute(filePathRaw) ? filePathRaw : path.join(getWebAppRoot(), filePathRaw);
    const raw = await readFile(absPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeChecklistDefinition(parsed);

    return {
      CHECKLIST_DEFINITION: {
        type: "CHECKLIST_DEFINITION",
        status: "ready",
        version: "v1",
        producer: { moduleId: this.id, stepId: input.stepId, runId: input.runId },
        quality: { confidence: 1 },
        data: normalized,
        createdAt: new Date().toISOString(),
      },
    };
  }
}

function normalizeChecklistDefinition(input: unknown): ChecklistDefinition {
  if (!input || typeof input !== "object") {
    throw new Error("CHECKLIST_SOURCE: checklist JSON must be an object");
  }
  const obj = input as Record<string, unknown>;
  const rawItems = obj.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("CHECKLIST_SOURCE: checklist JSON must contain non-empty `items` array");
  }
  const seen = new Set<string>();
  const items: ChecklistDefinition["items"] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!id || !label) continue;
    if (seen.has(id)) {
      throw new Error(`CHECKLIST_SOURCE: duplicate item id: ${id}`);
    }
    seen.add(id);
    const category = typeof o.category === "string" ? o.category.trim() : undefined;
    const weightRaw = o.weight;
    const weight =
      typeof weightRaw === "number" && Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : undefined;
    const pr = o.priority;
    const priority =
      pr === "critical" || pr === "important" || pr === "optional" ? (pr as ChecklistDefinition["items"][number]["priority"]) : undefined;
    items.push({ id, label, ...(category ? { category } : {}), ...(weight ? { weight } : {}), ...(priority ? { priority } : {}) });
  }
  if (items.length === 0) {
    throw new Error("CHECKLIST_SOURCE: no valid items after normalization (need id+label)");
  }
  return { items };
}

