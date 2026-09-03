import { NextResponse } from "next/server";
import type { Scenario } from "../../../../../types/pipeline.types";
import { validateScenarioGraph } from "../../../../../lib/pipeline/validator";
import { parseProcessSettings, toValidationProcessSettings } from "../../../../../lib/pipeline/process-settings";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;

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

  if (!scenario || scenario.id !== id) {
    return NextResponse.json(
      {
        error: "Scenario payload must exist and match route id",
      },
      { status: 400 },
    );
  }

  const process = parseProcessSettings(processRaw);
  const result = validateScenarioGraph(scenario, toValidationProcessSettings(process));
  return NextResponse.json(result, { status: result.valid ? 200 : 400 });
}
