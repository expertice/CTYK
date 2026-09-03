"""
Подготовка аудио к транскрибации/диаризации:
- нормализация в mono + target sample rate (ffmpeg)
- расчёт длительности через ffprobe
- универсальная чанковка (даже короткие файлы дают 1 чанк)
Вывод: JSON c preparedUrl/path и chunks.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _to_local_path(audio_path: str) -> str:
    if audio_path.startswith("file://"):
        return audio_path.replace("file://", "")
    return audio_path


def _ffprobe_duration(audio_path: str, ffprobe_bin: str) -> float:
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        audio_path,
    ]
    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode("utf-8", errors="replace").strip()
    try:
        v = float(out)
        if math.isfinite(v) and v > 0:
            return v
    except Exception:
        pass
    return 0.0


def _build_chunks(duration_sec: float, chunk_sec: float, overlap_sec: float) -> list[dict[str, Any]]:
    if duration_sec <= 0:
        return []
    c = max(1.0, chunk_sec)
    ov = max(0.0, min(overlap_sec, c * 0.8))
    step = max(0.2, c - ov)
    out: list[dict[str, Any]] = []
    start = 0.0
    idx = 0
    while start < duration_sec:
        end = min(duration_sec, start + c)
        out.append(
            {
                "chunkId": f"chunk_{idx:04d}",
                "startSec": round(start, 3),
                "endSec": round(end, 3),
                "durationSec": round(max(0.0, end - start), 3),
            }
        )
        if end >= duration_sec:
            break
        start += step
        idx += 1
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", type=str, default="")
    parser.add_argument("--target-sample-rate", type=int, default=16000)
    parser.add_argument("--target-channels", type=int, default=1)
    parser.add_argument("--chunk-sec", type=float, default=120.0)
    parser.add_argument("--overlap-sec", type=float, default=1.0)
    args = parser.parse_args()

    src = _to_local_path((args.audio_path or "").strip())
    if not src or not Path(src).exists():
        _emit(
            {
                "error": "missing_audio",
                "preparedPath": "",
                "sampleRate": args.target_sample_rate,
                "channels": args.target_channels,
                "durationSec": 0,
                "chunks": [],
            }
        )
        return

    ffmpeg_bin = os.getenv("FFMPEG_BIN", "ffmpeg").strip() or "ffmpeg"
    ffprobe_bin = os.getenv("FFPROBE_BIN", "ffprobe").strip() or "ffprobe"

    prepared_dir = Path(tempfile.gettempdir()) / "ctyk-audio-prepared"
    prepared_dir.mkdir(parents=True, exist_ok=True)
    target = prepared_dir / f"{Path(src).stem}_{int(time.time() * 1000)}.wav"

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        src,
        "-ac",
        str(args.target_channels),
        "-ar",
        str(args.target_sample_rate),
        "-c:a",
        "pcm_s16le",
        str(target),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    duration = _ffprobe_duration(str(target), ffprobe_bin)
    chunks = _build_chunks(duration, float(args.chunk_sec), float(args.overlap_sec))
    _emit(
        {
            "preparedPath": str(target),
            "sampleRate": int(args.target_sample_rate),
            "channels": int(args.target_channels),
            "durationSec": duration,
            "chunks": chunks,
        }
    )


if __name__ == "__main__":
    main()
