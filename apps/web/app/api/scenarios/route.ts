import { NextResponse } from "next/server";
import { sampleScenario } from "../../../lib/pipeline/sample-scenario";
import { parseProcessSettings } from "../../../lib/pipeline/process-settings";
import { listStoredScenarioSummaries, saveNewScenarioVersion } from "../../../lib/scenarios/scenario-store";
import type { Scenario } from "../../../types/pipeline.types";

export interface ScenarioListItem {
  id: string;
  name: string;
  source: "builtin" | "stored";
  latestVersion: number | null;
  updatedAt: string | null;
}

/** GET: встроенный сценарий + все сохранённые на диске (с версиями). */
export async function GET(): Promise<NextResponse> {
  const stored = await listStoredScenarioSummaries();
  const scenarios: ScenarioListItem[] = [
    {
      id: sampleScenario.id,
      name: sampleScenario.name,
      source: "builtin",
      latestVersion: null,
      updatedAt: null,
    },
    ...stored.map((s) => ({
      id: s.id,
      name: s.name,
      source: "stored" as const,
      latestVersion: s.latestVersion,
      updatedAt: s.updatedAt,
    })),
  ];
  return NextResponse.json({ scenarios });
}

/** POST: новая версия сценария (валидация графа на сервере). */
export async function POST(request: Request): Promise<NextResponse> {
  let scenario: Scenario;
  let processRaw: unknown;
  try {
    const body = (await request.json()) as Scenario | { scenario?: Scenario; process?: unknown };
    if ("scenario" in body && body.scenario) {
      scenario = body.scenario;
      processRaw = body.process;
    } else {
      scenario = body as Scenario;
      processRaw = undefined;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!scenario?.id || !Array.isArray(scenario.steps) || !Array.isArray(scenario.edges)) {
    return NextResponse.json({ error: "Invalid scenario payload" }, { status: 400 });
  }

  if (scenario.id === sampleScenario.id) {
    return NextResponse.json(
      {
        error: "Reserved id: duplicate the built-in scenario under a new id before saving",
      },
      { status: 409 },
    );
  }

  const result = await saveNewScenarioVersion(scenario, parseProcessSettings(processRaw));
  if (!result.ok) {
    return NextResponse.json({ valid: false, errors: result.errors }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    id: scenario.id,
    version: result.version,
  });
}
