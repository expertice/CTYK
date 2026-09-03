import { NextResponse } from "next/server";
import { deleteAsyncSession, deleteSessionDisplayName, setSessionDisplayName } from "../../../../lib/pipeline/async-run-store";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  deleteSessionDisplayName(id);
  deleteAsyncSession(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "Field 'name' is required" }, { status: 400 });
  }
  setSessionDisplayName(id, name.trim());
  return NextResponse.json({ ok: true });
}
