import { createHash } from "node:crypto";
import type { RunRequestBody } from "../../types/pipeline-api.types";

const MAX_METADATA_BYTES = 16 * 1024;

export function validateRunRequestBody(body: unknown): { ok: true; value: RunRequestBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }
  const casted = body as RunRequestBody;
  if (!casted.sessionId || typeof casted.sessionId !== "string") {
    return { ok: false, error: "Missing required field: sessionId" };
  }
  if (!casted.scenarioId && !casted.scenario) {
    return { ok: false, error: "One of fields is required: scenarioId or scenario" };
  }
  if (casted.priority != null) {
    if (!Number.isInteger(casted.priority) || casted.priority < 1 || casted.priority > 10) {
      return { ok: false, error: "priority must be an integer between 1 and 10" };
    }
  }
  if (casted.metadata != null) {
    if (!isDepthWithin(casted.metadata, 2)) {
      return { ok: false, error: "metadata max depth is 2" };
    }
    const size = Buffer.byteLength(JSON.stringify(casted.metadata), "utf8");
    if (size > MAX_METADATA_BYTES) {
      return { ok: false, error: "metadata exceeds 16KB limit" };
    }
    if (typeof casted.metadata === "object" && !Array.isArray(casted.metadata)) {
      const meta = casted.metadata as Record<string, unknown>;
      const rf = meta.reuseFromSession;
      if (rf !== undefined && rf !== null && typeof rf !== "string") {
        return { ok: false, error: "metadata.reuseFromSession must be a string session id" };
      }
    }
  }
  return { ok: true, value: casted };
}

function isDepthWithin(value: unknown, maxDepth: number, depth = 0): boolean {
  if (value == null || typeof value !== "object") {
    return true;
  }
  if (depth >= maxDepth) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((v) => isDepthWithin(v, maxDepth, depth + 1));
  }
  return Object.values(value).every((v) => isDepthWithin(v, maxDepth, depth + 1));
}

export function buildPayloadHash(payload: unknown): string {
  const encoded = JSON.stringify(payload);
  const digest = createHash("sha256").update(encoded).digest("hex");
  return `sha256:${digest}`;
}
