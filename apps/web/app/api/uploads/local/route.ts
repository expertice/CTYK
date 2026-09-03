import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getWebAppRoot } from "../../../../lib/local-models/web-root";

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const uploadsDir = path.join(getWebAppRoot(), "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const safeName = sanitizeFileName(file.name || "audio.wav");
  const targetName = `${Date.now()}_${safeName}`;
  const targetPath = path.join(uploadsDir, targetName);

  const bytes = await file.arrayBuffer();
  await writeFile(targetPath, Buffer.from(bytes));

  return NextResponse.json({
    fileName: targetName,
    localUrl: `local://uploads/${targetName}`,
  });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}
