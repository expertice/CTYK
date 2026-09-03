import { NextResponse } from "next/server";
import { getJobStatus } from "../../../../lib/pipeline/async-run-store";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const job = getJobStatus(id);
  if (!job) {
    return NextResponse.json({ error: `No job found for id ${id}` }, { status: 404 });
  }
  return NextResponse.json(job);
}
