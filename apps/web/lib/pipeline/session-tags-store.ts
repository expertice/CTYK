import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getWebAppRoot } from "../local-models/web-root";

const rootDir = join(getWebAppRoot(), ".runs-async");
const TAGS_PATH = join(rootDir, "session-tags.json");

export type SessionTagType = "speaker" | "label";

export interface SessionTag {
  id: string;
  type: SessionTagType;
  /** Отображаемое значение (имя спикера, метка и т.д.). */
  value: string;
  /** Для type=speaker — исходный id сегмента (SPEAKER_00 …). */
  speakerId?: string;
}

function loadAll(): Record<string, SessionTag[]> {
  try {
    const raw = readFileSync(TAGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, SessionTag[]> = {};
    for (const [sid, arr] of Object.entries(parsed)) {
      if (!Array.isArray(arr)) continue;
      const tags: SessionTag[] = [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id : randomUUID();
        const type = o.type === "speaker" || o.type === "label" ? o.type : "label";
        const value = typeof o.value === "string" ? o.value : "";
        const speakerId = typeof o.speakerId === "string" ? o.speakerId : undefined;
        if (!value.trim()) continue;
        tags.push({ id, type, value: value.trim(), speakerId });
      }
      if (tags.length) out[sid] = tags;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(data: Record<string, SessionTag[]>): void {
  try {
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(TAGS_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // ignore
  }
}

export function getSessionTags(sessionId: string): SessionTag[] {
  return loadAll()[sessionId] ?? [];
}

export function setSessionTags(sessionId: string, tags: SessionTag[]): void {
  const all = loadAll();
  if (tags.length === 0) {
    delete all[sessionId];
  } else {
    all[sessionId] = tags;
  }
  persist(all);
}

/** Синхронизирует теги типа speaker с подписями спикеров из редактора. */
export function upsertSpeakerTagsFromLabels(sessionId: string, labels: Record<string, string>): void {
  const all = loadAll();
  const existing = [...(all[sessionId] ?? [])];
  const nonSpeaker = existing.filter((t) => t.type !== "speaker");
  const speakerTags: SessionTag[] = [];
  for (const [speakerId, raw] of Object.entries(labels)) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    const prev = existing.find((t) => t.type === "speaker" && t.speakerId === speakerId);
    speakerTags.push({
      id: prev?.id ?? `tag_${randomUUID()}`,
      type: "speaker",
      speakerId,
      value,
    });
  }
  all[sessionId] = [...nonSpeaker, ...speakerTags];
  persist(all);
}
