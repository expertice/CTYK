/**
 * Заменяет speaker_XX и типичные «Спикер 01» на displayName из карты (SPEAKER_IDENTITY_MAP / строки RDY).
 */
export function substituteSpeakerRefsInPsychText(
  text: string,
  lookup: Map<string, { displayName?: string; role?: string }>,
): string {
  let out = text;
  const entries = [...lookup.entries()]
    .map(([speakerId, v]) => ({
      speakerId,
      displayName: typeof v.displayName === "string" ? v.displayName.trim() : "",
    }))
    .filter((e) => e.displayName.length > 0)
    .sort((a, b) => b.speakerId.length - a.speakerId.length);

  for (const { speakerId, displayName } of entries) {
    const esc = speakerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${esc}\\b`, "gi"), displayName);
    const m = /^speaker_(\d+)$/i.exec(speakerId);
    if (m) {
      const fullNum = m[1];
      const unpadded = String(parseInt(fullNum, 10));
      out = out.replace(new RegExp(`Спикер\\s*${fullNum}\\b`, "gi"), displayName);
      if (unpadded !== fullNum) {
        out = out.replace(new RegExp(`Спикер\\s*${unpadded}\\b`, "gi"), displayName);
      }
    }
  }
  return out;
}
