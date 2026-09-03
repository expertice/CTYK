import { NextResponse } from "next/server";
import { listAsyncSessions } from "../../../lib/pipeline/async-run-store";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ sessions: listAsyncSessions() });
}
