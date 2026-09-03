import argparse
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path


def bootstrap_faster_whisper():
    try:
        from faster_whisper import WhisperModel  # type: ignore
        return WhisperModel
    except Exception:
        import subprocess
        import sys

        subprocess.check_call([sys.executable, "-m", "pip", "install", "faster-whisper"])
        from faster_whisper import WhisperModel  # type: ignore
        return WhisperModel


def normalize_audio_path(audio_path: str) -> str:
    if not audio_path or not Path(audio_path).exists():
        return audio_path

    ffmpeg_bin = os.getenv("FFMPEG_BIN", "ffmpeg").strip() or "ffmpeg"
    normalized_dir = Path(tempfile.gettempdir()) / "ctyk-audio-normalized"
    normalized_dir.mkdir(parents=True, exist_ok=True)
    target = normalized_dir / f"{Path(audio_path).stem}_{int(time.time() * 1000)}.wav"

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        audio_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(target),
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if target.exists():
            return str(target)
    except Exception:
        # Fall back to original source when ffmpeg is unavailable or conversion fails.
        return audio_path
    return audio_path


def run_whisper(audio_path: str, model_name: str, cache_dir: str, device: str, compute_type: str):
    WhisperModel = bootstrap_faster_whisper()
    asr_device = (device or os.getenv("ASR_DEVICE", "auto")).strip().lower() or "auto"
    asr_compute_type = (compute_type or os.getenv("ASR_COMPUTE_TYPE", "int8")).strip() or "int8"
    strict_gpu = asr_device == "gpu_strict"
    if strict_gpu:
        asr_device = "cuda"
    model = WhisperModel(
        model_name,
        download_root=cache_dir,
        device=asr_device,
        compute_type=asr_compute_type,
    )

    if not audio_path or not Path(audio_path).exists():
        return {
            "text": "Локальная ASR модель готова, но аудиофайл не найден. Возвращен мок-текст.",
            "segments": [
                {"startTime": 0, "endTime": 6, "text": "Проведен вводный инструктаж по технике безопасности."},
                {"startTime": 6, "endTime": 13, "text": "Обозначены опасные зоны и порядок действий."},
            ],
            "model": model_name,
            "downloaded": True,
        }

    def should_fallback_to_cpu(error: Exception) -> bool:
        text = str(error).lower()
        return "cublas64_12.dll" in text or "cudnn64" in text or "cuda" in text

    normalized_audio = normalize_audio_path(audio_path)

    def transcribe_to_segments(current_model):
        segments_iter, info = current_model.transcribe(normalized_audio, vad_filter=True, language="ru")
        segments = []
        full_text_parts = []
        for seg in segments_iter:
            text = (seg.text or "").strip()
            segments.append(
                {
                    "startTime": float(seg.start),
                    "endTime": float(seg.end),
                    "text": text,
                }
            )
            full_text_parts.append(text)
        return segments, full_text_parts, info

    try:
        segments, full_text_parts, info = transcribe_to_segments(model)
    except RuntimeError as err:
        # CUDA issues may surface either on `transcribe(...)` or while consuming `segments_iter`.
        if should_fallback_to_cpu(err) and asr_device != "cpu" and not strict_gpu:
            model = WhisperModel(model_name, download_root=cache_dir, device="cpu", compute_type="int8")
            segments, full_text_parts, info = transcribe_to_segments(model)
        else:
            raise

    return {
        "text": " ".join([x for x in full_text_parts if x]),
        "segments": segments,
        "model": model_name,
        "downloaded": True,
        "language": getattr(info, "language", "unknown"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", type=str, default="")
    parser.add_argument("--model-name", type=str, default="small")
    parser.add_argument("--cache-dir", type=str, default=".models/asr")
    parser.add_argument("--device", type=str, default="")
    parser.add_argument("--compute-type", type=str, default="")
    args = parser.parse_args()

    os.makedirs(args.cache_dir, exist_ok=True)
    payload = run_whisper(args.audio_path, args.model_name, args.cache_dir, args.device, args.compute_type)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
