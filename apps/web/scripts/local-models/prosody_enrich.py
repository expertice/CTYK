"""
Просодическое обогащение сегментов диаризации через librosa (громкость, ZCR, спектральные метрики, темп речи).
Вывод: одна строка JSON на stdout (без прочего вывода — иначе ломается разбор в Node).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import warnings
from pathlib import Path
from typing import Any


def _json_float(x: Any) -> float:
    """Число для JSON: без NaN/Inf (иначе JSON.parse в Node падает)."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return float(v) if math.isfinite(v) else 0.0


def _json_tempo_bpm(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v <= 0:
        return None
    return float(v)


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def ensure_deps():
    try:
        import librosa  # type: ignore
        import numpy as np  # type: ignore
        return librosa, np
    except Exception:
        import subprocess

        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "librosa", "soundfile", "numpy"],
        )
        import librosa  # type: ignore
        import numpy as np  # type: ignore
        return librosa, np


def main() -> None:
    warnings.filterwarnings("ignore")
    librosa, np = ensure_deps()
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", type=str, default="")
    parser.add_argument("--segments-json", type=str, default="[]")
    parser.add_argument(
        "--segments-json-file",
        type=str,
        default="",
        help="Путь к UTF-8 JSON-массиву сегментов (предпочтительно для длинных записей; иначе ENAMETOOLONG в spawn)",
    )
    args = parser.parse_args()

    audio_path = (args.audio_path or "").strip()
    if not audio_path or not Path(audio_path).is_file():
        _emit({"segments": [], "sampleRate": 16000, "globalTempoBpm": None, "error": "missing_audio"})
        return

    seg_file = (args.segments_json_file or "").strip()
    if seg_file:
        sp = Path(seg_file)
        if not sp.is_file():
            _emit({"segments": [], "sampleRate": 16000, "globalTempoBpm": None, "error": "bad_segments_json"})
            return
        raw_text = sp.read_text(encoding="utf-8")
    else:
        raw_text = args.segments_json or "[]"

    try:
        raw = json.loads(raw_text)
    except json.JSONDecodeError:
        _emit({"segments": [], "sampleRate": 16000, "globalTempoBpm": None, "error": "bad_segments_json"})
        return

    if not isinstance(raw, list) or len(raw) == 0:
        _emit({"segments": [], "sampleRate": 16000, "globalTempoBpm": None})
        return

    y, sr = librosa.load(audio_path, sr=16000, mono=True)
    duration = float(len(y)) / float(sr)

    global_bpm: float | None = None
    try:
        tempo_arr, _ = librosa.beat.beat_track(y=y, sr=sr)
        t0 = np.atleast_1d(tempo_arr)
        if t0.size > 0:
            global_bpm = _json_tempo_bpm(float(t0[0]))
    except Exception:
        global_bpm = None

    out_segments: list[dict[str, Any]] = []

    for item in raw:
        if not isinstance(item, dict):
            continue
        spk = str(item.get("speakerId", "speaker_unknown"))
        try:
            t_start = float(item.get("startTime"))
            t_end = float(item.get("endTime"))
        except (TypeError, ValueError):
            continue
        text = item.get("text")
        if not isinstance(text, str):
            text = ""

        t0_clamped = max(0.0, min(t_start, duration))
        t1_clamped = max(t0_clamped, min(t_end, duration))
        seg_len = max(t1_clamped - t0_clamped, 1e-6)
        chars_per_sec = (len(text) / seg_len) if text else 0.0

        i0 = int(round(t0_clamped * sr))
        i1 = int(round(t1_clamped * sr))
        i1 = max(i1, i0 + 1)
        y_seg = y[i0:i1]
        if y_seg.size < 2:
            y_seg = np.zeros(64, dtype=np.float32)

        rms = float(np.sqrt(np.mean(np.square(y_seg))))
        rms_db = _json_float(20.0 * np.log10(rms + 1e-10))

        zcr = librosa.feature.zero_crossing_rate(y_seg)[0]
        zcr_mean = _json_float(np.mean(zcr))

        cent = librosa.feature.spectral_centroid(y=y_seg, sr=sr)[0]
        cent_mean = _json_float(np.mean(cent))

        rolloff = librosa.feature.spectral_rolloff(y=y_seg, sr=sr, roll_percent=0.85)[0]
        rolloff_mean = _json_float(np.mean(rolloff))

        hop = 256
        rms_frames = librosa.feature.rms(y=y_seg, frame_length=2048, hop_length=hop)[0]
        if rms_frames.size > 0:
            mx = float(np.max(rms_frames) + 1e-12)
            rel = rms_frames / mx
            silence_ratio = float(np.mean(rel < 0.08))
        else:
            silence_ratio = 0.0

        s_mag = np.abs(librosa.stft(y_seg, hop_length=hop))
        if s_mag.shape[1] >= 2:
            diff = np.diff(s_mag, axis=1)
            pos = np.maximum(0.0, diff)
            flux_frames = np.sqrt(np.mean(pos**2, axis=0))
            spectral_flux = _json_float(np.mean(flux_frames))
        else:
            spectral_flux = 0.0

        out_segments.append(
            {
                "speakerId": spk,
                "startTime": _json_float(t0_clamped),
                "endTime": _json_float(t1_clamped),
                "text": text,
                "rmsMeanDb": rms_db,
                "zcrMean": zcr_mean,
                "spectralCentroidMeanHz": cent_mean,
                "spectralRolloffMeanHz": rolloff_mean,
                "charsPerSec": _json_float(chars_per_sec),
                "durationSec": _json_float(seg_len),
                "silenceRatio": silence_ratio,
                "spectralFlux": spectral_flux,
                "globalTempoBpm": global_bpm,
            }
        )

    _emit({"segments": out_segments, "sampleRate": int(sr), "globalTempoBpm": global_bpm})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — хотим всегда отдать валидный JSON при ошибке рантайма
        _emit(
            {
                "segments": [],
                "sampleRate": 16000,
                "globalTempoBpm": None,
                "error": "python_exception",
                "message": str(exc)[:800],
            },
        )
        sys.exit(0)
