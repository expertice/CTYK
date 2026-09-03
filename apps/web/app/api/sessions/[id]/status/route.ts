import { NextResponse } from "next/server";
import { getSessionStatusExtended } from "../../../../../lib/pipeline/async-run-store";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const status = getSessionStatusExtended(id);

  if (!status) {
    return NextResponse.json(
      {
        error: `No pipeline run found for session ${id}`,
      },
      { status: 404 },
    );
  }

  return NextResponse.json(status);
}
