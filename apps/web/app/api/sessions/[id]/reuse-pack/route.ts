import { NextResponse } from "next/server";
import { getReusePackForSession } from "../../../../../lib/pipeline/async-run-store";

interface Params {
  params: Promise<{ id: string }>;
}

/** Пакет для режима «Повторить»: сценарий родителя + сид артефактов (без выходов LLM). */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const pack = getReusePackForSession(id);
  if (!pack) {
    return NextResponse.json(
      { error: "Session not found or READY_SPEAKERS is not ready for reuse." },
      { status: 404 },
    );
  }
  return NextResponse.json(pack);
}
