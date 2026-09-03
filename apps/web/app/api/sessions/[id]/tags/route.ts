import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionTags, setSessionTags, type SessionTag } from "../../../../../lib/pipeline/session-tags-store";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  return NextResponse.json({ sessionId: id, tags: getSessionTags(id) });
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const tags = (body as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) {
    return NextResponse.json({ error: "tags array required" }, { status: 400 });
  }
  const normalized: SessionTag[] = [];
  for (const item of tags) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o.type === "speaker" || o.type === "label" ? o.type : "label";
    const value = typeof o.value === "string" ? o.value.trim() : "";
    const speakerId = typeof o.speakerId === "string" ? o.speakerId : undefined;
    const tid = typeof o.id === "string" ? o.id : `tag_${randomUUID()}`;
    if (!value) continue;
    normalized.push({ id: tid, type, value, speakerId });
  }
  setSessionTags(id, normalized);
  return NextResponse.json({ ok: true, tags: getSessionTags(id) });
}
