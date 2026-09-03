import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve Next.js app root (`apps/web`) whether `process.cwd()` is the monorepo root or `apps/web`.
 */
export function getWebAppRoot(): string {
  const cwd = process.cwd();
  const scriptRel = path.join("scripts", "local-models", "diarization_local.py");
  if (existsSync(path.join(cwd, scriptRel))) {
    return cwd;
  }
  const nested = path.join(cwd, "apps", "web", scriptRel);
  if (existsSync(nested)) {
    return path.join(cwd, "apps", "web");
  }
  return cwd;
}
