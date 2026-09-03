import { existsSync } from "node:fs";
import path from "node:path";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { getWebAppRoot } from "../local-models/web-root";
import { validateScenarioGraph } from "../pipeline/validator";
import type { ProcessSettings } from "../pipeline/process-settings";
import { toNormalizeProcessSettings, toValidationProcessSettings } from "../pipeline/process-settings";
import type { Scenario } from "../../types/pipeline.types";
import type { ScenarioValidationError } from "../pipeline/validator";
import { normalizeScenarioIds } from "./scenario-normalize";

const SCENARIOS_DIR = path.join(getWebAppRoot(), ".scenarios");

export interface StoredScenarioMeta {
  id: string;
  name: string;
  latestVersion: number;
  updatedAt: string;
}

interface VersionPayload {
  version: number;
  savedAt: string;
  scenario: Scenario;
}

export interface ScenarioVersionSummary {
  version: number;
  savedAt: string;
}

export function scenarioFolderName(id: string): string {
  return id.replace(/[^\w.\-]+/g, "_");
}

export { normalizeScenarioIds } from "./scenario-normalize";

export async function listStoredScenarioSummaries(): Promise<StoredScenarioMeta[]> {
  if (!existsSync(SCENARIOS_DIR)) {
    return [];
  }
  const entries = await readdir(SCENARIOS_DIR, { withFileTypes: true });
  const result: StoredScenarioMeta[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const folder = path.join(SCENARIOS_DIR, ent.name);
    const metaPath = path.join(folder, "meta.json");
    try {
      const raw = await readFile(metaPath, "utf8");
      const meta = JSON.parse(raw) as StoredScenarioMeta;
      if (!meta?.id || typeof meta.latestVersion !== "number") continue;
      const latestPath = path.join(folder, "versions", `${meta.latestVersion}.json`);
      if (!existsSync(latestPath)) continue;
      result.push(meta);
    } catch {
      // skip broken folder
    }
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

export async function listVersionNumbers(id: string): Promise<number[]> {
  const versDir = path.join(SCENARIOS_DIR, scenarioFolderName(id), "versions");
  if (!existsSync(versDir)) {
    return [];
  }
  const files = await readdir(versDir);
  const nums = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => Number.parseInt(f.replace(/\.json$/, ""), 10))
    .filter((n) => !Number.isNaN(n));
  nums.sort((a, b) => a - b);
  return nums;
}

export async function listScenarioVersionSummaries(id: string): Promise<ScenarioVersionSummary[]> {
  const versDir = path.join(SCENARIOS_DIR, scenarioFolderName(id), "versions");
  if (!existsSync(versDir)) {
    return [];
  }
  const files = await readdir(versDir);
  const parsed: ScenarioVersionSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const version = Number.parseInt(file.replace(/\.json$/, ""), 10);
    if (Number.isNaN(version)) continue;
    try {
      const raw = await readFile(path.join(versDir, file), "utf8");
      const payload = JSON.parse(raw) as Partial<VersionPayload>;
      parsed.push({
        version,
        savedAt:
          typeof payload.savedAt === "string" && payload.savedAt.length > 0
            ? payload.savedAt
            : new Date(0).toISOString(),
      });
    } catch {
      // ignore broken version file
    }
  }
  parsed.sort((a, b) => b.version - a.version);
  return parsed;
}

export async function loadScenarioVersion(
  id: string,
  version?: number,
): Promise<{ scenario: Scenario; version: number; savedAt: string } | null> {
  const folder = path.join(SCENARIOS_DIR, scenarioFolderName(id));
  const metaPath = path.join(folder, "meta.json");
  let targetVersion = version;
  if (targetVersion == null) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as StoredScenarioMeta;
      targetVersion = meta.latestVersion;
    } catch {
      return null;
    }
  }
  const vfPath = path.join(folder, "versions", `${targetVersion}.json`);
  try {
    const raw = await readFile(vfPath, "utf8");
    const payload = JSON.parse(raw) as VersionPayload;
    return {
      scenario: normalizeScenarioIds(payload.scenario),
      version: payload.version,
      savedAt: payload.savedAt,
    };
  } catch {
    return null;
  }
}

export async function saveNewScenarioVersion(
  scenario: Scenario,
  process?: ProcessSettings,
): Promise<{ ok: true; version: number } | { ok: false; errors: ScenarioValidationError[] }> {
  const normalized = normalizeScenarioIds(
    scenario,
    process ? toNormalizeProcessSettings(process) : undefined,
  );
  const validation = validateScenarioGraph(
    normalized,
    process ? toValidationProcessSettings(process) : undefined,
  );
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  const folder = path.join(SCENARIOS_DIR, scenarioFolderName(normalized.id));
  const versionsDir = path.join(folder, "versions");
  await mkdir(versionsDir, { recursive: true });

  let nextVersion = 1;
  try {
    const prev = JSON.parse(await readFile(path.join(folder, "meta.json"), "utf8")) as StoredScenarioMeta;
    nextVersion = prev.latestVersion + 1;
  } catch {
    nextVersion = 1;
  }

  const savedAt = new Date().toISOString();
  const body: VersionPayload = {
    version: nextVersion,
    savedAt,
    scenario: normalized,
  };
  await writeFile(path.join(versionsDir, `${nextVersion}.json`), JSON.stringify(body, null, 2), "utf8");

  const meta: StoredScenarioMeta = {
    id: normalized.id,
    name: normalized.name,
    latestVersion: nextVersion,
    updatedAt: savedAt,
  };
  await writeFile(path.join(folder, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

  return { ok: true, version: nextVersion };
}

export async function renameStoredScenario(
  id: string,
  nextName: string,
): Promise<StoredScenarioMeta> {
  const folder = path.join(SCENARIOS_DIR, scenarioFolderName(id));
  const metaPath = path.join(folder, "meta.json");

  const metaRaw = await readFile(metaPath, "utf8");
  const meta = JSON.parse(metaRaw) as StoredScenarioMeta;
  if (!meta?.id || typeof meta.latestVersion !== "number") {
    throw new Error(`Scenario meta not found: ${id}`);
  }

  const latestVersion = meta.latestVersion;
  const versionPath = path.join(folder, "versions", `${latestVersion}.json`);
  const versionRaw = await readFile(versionPath, "utf8");
  const payload = JSON.parse(versionRaw) as VersionPayload;

  payload.scenario.name = nextName;

  const savedAt = new Date().toISOString();
  payload.savedAt = savedAt;
  await writeFile(versionPath, JSON.stringify(payload, null, 2), "utf8");

  const updatedMeta: StoredScenarioMeta = {
    ...meta,
    name: nextName,
    updatedAt: savedAt,
  };
  await writeFile(metaPath, JSON.stringify(updatedMeta, null, 2), "utf8");
  return updatedMeta;
}

export async function deleteStoredScenario(id: string): Promise<void> {
  const folder = path.join(SCENARIOS_DIR, scenarioFolderName(id));
  await rm(folder, { recursive: true, force: true });
}
