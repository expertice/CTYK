"""
RTSP -> local wav capture via ffmpeg.
Outputs JSON: { localUrl } or { error, message }.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from pathlib import Path
from tempfile import gettempdir
from typing import Any


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rtsp-url", type=str, default="")
    parser.add_argument("--capture-sec", type=float, default=60.0)
    parser.add_argument("--transport", type=str, default="tcp")
    args = parser.parse_args()

    rtsp_url = (args.rtsp_url or "").strip()
    if not rtsp_url:
        _emit({"error": "missing_rtsp_url", "message": "rtsp-url is required"})
        return

    capture_sec = max(1.0, float(args.capture_sec or 60.0))
    transport = "udp" if args.transport == "udp" else "tcp"

    uploads_dir = Path(gettempdir()) / "ctyk-rtsp-capture"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"rtsp_{int(time.time() * 1000)}.wav"
    out_path = uploads_dir / file_name

    ffmpeg_bin = os.getenv("FFMPEG_BIN", "ffmpeg").strip() or "ffmpeg"
    cmd = [
        ffmpeg_bin,
        "-y",
        "-rtsp_transport",
        transport,
        "-i",
        rtsp_url,
        "-t",
        str(capture_sec),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(out_path),
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except Exception as exc:
        _emit({"error": "ffmpeg_failed", "message": str(exc)[:800]})
        return

    if not out_path.exists():
        _emit({"error": "output_missing", "message": "capture output file is missing"})
        return

    _emit({"localUrl": f"file://{out_path}"})


if __name__ == "__main__":
    main()
