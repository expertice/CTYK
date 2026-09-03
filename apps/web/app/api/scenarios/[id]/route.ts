import { NextResponse } from "next/server";
import { sampleScenario } from "../../../../lib/pipeline/sample-scenario";
import {
  deleteStoredScenario,
  listScenarioVersionSummaries,
  loadScenarioVersion,
  renameStoredScenario,
} from "../../../../lib/scenarios/scenario-store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * GET: тело сценария (встроенный или с диска).
 * Query: `version` — номер версии; без параметра — последняя для stored, для builtin всегда эталон.
 * Query: `versionsOnly=true` — список версий с датами (для stored).
 */
export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const url = new URL(request.url);
  const versionsOnly = url.searchParams.get("versionsOnly") === "true";

  if (id === sampleScenario.id) {
    if (versionsOnly) {
      return NextResponse.json({ versions: [] as Array<{ version: number; savedAt: string }> });
    }
    return NextResponse.json({
      source: "builtin",
      version: null,
      savedAt: null,
      scenario: sampleScenario,
    });
  }

  if (versionsOnly) {
    const versions = await listScenarioVersionSummaries(id);
    return NextResponse.json({ versions });
  }

  const versionParam = url.searchParams.get("version");
  const version = versionParam ? Number.parseInt(versionParam, 10) : undefined;
  const loaded = await loadScenarioVersion(id, Number.isNaN(version) ? undefined : version);
  if (!loaded) {
    return NextResponse.json({ error: `Scenario not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json({
    source: "stored",
    version: loaded.version,
    savedAt: loaded.savedAt,
    scenario: loaded.scenario,
  });
}

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (id === sampleScenario.id) {
    return NextResponse.json({ error: "Builtin scenario cannot be renamed" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const casted = body as { name?: unknown };
  const nextName = typeof casted.name === "string" ? casted.name.trim() : "";
  if (!nextName) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const updated = await renameStoredScenario(id, nextName);
    return NextResponse.json({ ok: true, scenario: updated }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Rename failed";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}

export async function DELETE(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (id === sampleScenario.id) {
    return NextResponse.json({ error: "Builtin scenario cannot be deleted" }, { status: 409 });
  }

  try {
    await deleteStoredScenario(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete failed";
    if (/not found|enoent/i.test(msg)) {
      return NextResponse.json({ ok: true, alreadyDeleted: true }, { status: 200 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
