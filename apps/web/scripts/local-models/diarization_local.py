import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def try_bootstrap_pyannote():
    try:
        from pyannote.audio import Pipeline  # type: ignore
        return Pipeline
    except Exception:
        try:
            import subprocess

            subprocess.check_call([sys.executable, "-m", "pip", "install", "pyannote.audio"])
            from pyannote.audio import Pipeline  # type: ignore
            return Pipeline
        except Exception:
            return None


def try_bootstrap_hf_hub():
    try:
        from huggingface_hub import snapshot_download  # type: ignore
        return snapshot_download
    except Exception:
        try:
            import subprocess

            subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface_hub"])
            from huggingface_hub import snapshot_download  # type: ignore
            return snapshot_download
        except Exception:
            return None


def heuristic_diarization(segments):
    diarized = []
    for index, seg in enumerate(segments):
        diarized.append(
            {
                "speakerId": "speaker_1" if index % 2 == 0 else "speaker_2",
                "startTime": seg.get("startTime", 0),
                "endTime": seg.get("endTime", 0),
                "text": seg.get("text", ""),
            }
        )
    if not diarized:
        diarized = [
            {
                "speakerId": "speaker_1",
                "startTime": 0,
                "endTime": 10,
                "text": "Heuristic diarization fallback: no ASR segments.",
            }
        ]
    return diarized


def overlap(a_start, a_end, b_start, b_end):
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def attach_text_from_asr(diarized_segments: List[Dict[str, Any]], asr_segments: List[Dict[str, Any]]):
    """Attach ASR text to diarization segments: each ASR segment is assigned once
    to the diarization window with maximum time overlap (reduces duplicate lines).
    """
    for seg in diarized_segments:
        seg["text"] = ""

    for asr in asr_segments:
        text = str(asr.get("text", "")).strip()
        if not text:
            continue
        a_start = float(asr.get("startTime", 0))
        a_end = float(asr.get("endTime", 0))
        best_idx = -1
        best_ov = 0.0
        for i, seg in enumerate(diarized_segments):
            d_start = float(seg.get("startTime", 0))
            d_end = float(seg.get("endTime", 0))
            ov = overlap(d_start, d_end, a_start, a_end)
            if ov > best_ov:
                best_ov = ov
                best_idx = i
        if best_idx < 0 or best_ov <= 0:
            continue
        target = diarized_segments[best_idx]
        existing = str(target.get("text", "")).strip()
        target["text"] = f"{existing} {text}".strip() if existing else text

    return diarized_segments


def try_bootstrap_yaml():
    try:
        import yaml  # type: ignore

        return yaml
    except Exception:
        try:
            import subprocess

            subprocess.check_call([sys.executable, "-m", "pip", "install", "pyyaml"])
            import yaml  # type: ignore

            return yaml
        except Exception:
            return None


def create_legacy_compatible_config(config_path: Path) -> str:
    yaml = try_bootstrap_yaml()
    if yaml is None:
        raise RuntimeError("pyyaml is required to patch legacy pyannote config")
    with config_path.open("r", encoding="utf-8") as handle:
        cfg = yaml.safe_load(handle)
    if not isinstance(cfg, dict):
        raise RuntimeError("invalid pyannote config structure")
    pipeline = cfg.get("pipeline")
    if isinstance(pipeline, dict):
        params = pipeline.get("params")
        if isinstance(params, dict):
            # Some pyannote versions do not accept `plda` pipeline arg.
            params.pop("plda", None)
            # Older versions treat directory strings as HF repo IDs.
            # Rewrite local model dirs to explicit checkpoint files.
            for key in ("segmentation", "embedding"):
                value = params.get(key)
                if isinstance(value, str):
                    p = Path(value)
                    if p.is_dir():
                        candidate = p / "pytorch_model.bin"
                        if candidate.exists():
                            params[key] = candidate.resolve().as_posix()
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".yaml", encoding="utf-8") as tmp:
        yaml.safe_dump(cfg, tmp, sort_keys=False, allow_unicode=True)
        return tmp.name


def is_offline_bundle(pipeline_path: str) -> bool:
    config_path = Path(pipeline_path) / "config.yaml"
    if not config_path.exists():
        return False
    yaml = try_bootstrap_yaml()
    if yaml is None:
        return False
    try:
        with config_path.open("r", encoding="utf-8") as handle:
            cfg = yaml.safe_load(handle)
        return isinstance(cfg, dict) and cfg.get("offline_bundle") is True
    except Exception:
        return False


def strip_hf_tokens_from_env() -> None:
    for key in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACEHUB_API_TOKEN"):
        os.environ.pop(key, None)


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
        # Fall back to source path when ffmpeg is unavailable or conversion fails.
        return audio_path
    return audio_path


def ensure_gpu_available_if_strict(device_mode: str) -> None:
    mode = (device_mode or "").strip().lower()
    if mode != "gpu_strict":
        return
    try:
        import torch  # type: ignore
    except Exception as err:
        raise RuntimeError(f"gpu_strict mode requires torch with CUDA support: {err}") from err
    if not torch.cuda.is_available():
        raise RuntimeError("gpu_strict mode requested but CUDA is not available in current Python runtime")


def ensure_local_model(model_name: str, local_model_path: str, hf_token: str):
    local_path = Path(local_model_path)
    local_path.mkdir(parents=True, exist_ok=True)
    has_files = any(local_path.iterdir())
    if has_files:
        return

    snapshot_download = try_bootstrap_hf_hub()
    if snapshot_download is None:
        raise RuntimeError("huggingface_hub is not available locally to download pyannote model")

    # Attempt tokenless first for public models.
    try:
        snapshot_download(repo_id=model_name, local_dir=str(local_path), token=hf_token or None)
        return
    except Exception as tokenless_error:
        raise RuntimeError(
            f"Failed to download model '{model_name}' into '{local_model_path}'. "
            f"Error: {tokenless_error}"
        )


def run_pyannote_diarization_offline(model_source: str, audio_path: str, device_mode: str):
    if not audio_path:
        raise RuntimeError("audio path is required for pyannote diarization")
    if not Path(audio_path).exists():
        raise RuntimeError(f"audio file not found: {audio_path}")
    if not Path(model_source).exists():
        raise RuntimeError(f"offline pipeline path not found: {model_source}")
    ensure_gpu_available_if_strict(device_mode)

    # Ensure no accidental Hub auth / network use for fully local bundles.
    strip_hf_tokens_from_env()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    Pipeline = try_bootstrap_pyannote()
    if Pipeline is None:
        raise RuntimeError("pyannote.audio is not available locally")

    source_path = Path(model_source)
    # Older pyannote versions expect a file path to config.yaml for local pipelines.
    config_path = source_path / "config.yaml" if source_path.is_dir() else source_path
    offline_source = str(config_path if config_path.exists() else source_path)

    try:
        pipeline = Pipeline.from_pretrained(offline_source, token=False)
    except TypeError as err:
        text = str(err)
        if "unexpected keyword argument 'plda'" in text:
            patched = create_legacy_compatible_config(Path(offline_source))
            pipeline = Pipeline.from_pretrained(patched)
        else:
            try:
                pipeline = Pipeline.from_pretrained(offline_source, use_auth_token=None)
            except TypeError as err2:
                text2 = str(err2)
                if "unexpected keyword argument 'plda'" in text2:
                    patched = create_legacy_compatible_config(Path(offline_source))
                    pipeline = Pipeline.from_pretrained(patched)
                else:
                    pipeline = Pipeline.from_pretrained(offline_source)
            except Exception as err3:
                text3 = str(err3)
                if "LocalEntryNotFoundError" in text3 or "speaker-diarization-community-1" in text3:
                    raise RuntimeError(
                        "Offline bundle is incomplete (missing PLDA assets). "
                        "Re-run one-time download: `pnpm models:pyannote-offline`."
                    ) from err3
                raise
    except Exception as err:
        text = str(err)
        if "LocalEntryNotFoundError" in text or "speaker-diarization-community-1" in text:
            raise RuntimeError(
                "Offline bundle is incomplete (missing PLDA assets). "
                "Re-run one-time download: `pnpm models:pyannote-offline`."
            ) from err
        raise

    normalized_audio = normalize_audio_path(audio_path)

    try:
        diarization = pipeline(normalized_audio)
    except Exception as err:
        raise RuntimeError(
            "pyannote offline pipeline failed on audio. Common causes: missing FFmpeg/torchcodec for decoding, "
            "or invalid audio format. Original error: " + str(err)
        ) from err

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(
            {
                "speakerId": str(speaker).replace(" ", "_").lower(),
                "startTime": float(turn.start),
                "endTime": float(turn.end),
                "text": "",
            }
        )
    return postprocess_diarization_segments(segments)


def run_pyannote_diarization(model_source: str, audio_path: str, hf_token: str, device_mode: str):
    if not audio_path:
        raise RuntimeError("audio path is required for pyannote diarization")
    if not Path(audio_path).exists():
        raise RuntimeError(f"audio file not found: {audio_path}")
    ensure_gpu_available_if_strict(device_mode)

    # Speaker-diarization pipeline loads gated sub-models (e.g. segmentation-3.0) from the Hub.
    # Hugging Face auth must be visible to nested downloads.
    if hf_token:
        os.environ["HF_TOKEN"] = hf_token
        os.environ["HUGGING_FACE_HUB_TOKEN"] = hf_token

    Pipeline = try_bootstrap_pyannote()
    if Pipeline is None:
        raise RuntimeError("pyannote.audio is not available locally")

    token = hf_token or None
    try:
        pipeline = Pipeline.from_pretrained(model_source, token=token)
    except TypeError:
        try:
            pipeline = Pipeline.from_pretrained(model_source, use_auth_token=token)
        except Exception as err:
            raise RuntimeError(
                "Failed to load pyannote Pipeline. Ensure HF_TOKEN is set and you accepted "
                "model terms for pyannote/speaker-diarization-3.1 and dependency models "
                "(e.g. pyannote/segmentation-3.0) on huggingface.co."
            ) from err

    normalized_audio = normalize_audio_path(audio_path)

    try:
        diarization = pipeline(normalized_audio)
    except Exception as err:
        raise RuntimeError(
            "pyannote pipeline failed on audio. Common causes: missing FFmpeg/torchcodec for decoding, "
            "or invalid audio format. Original error: " + str(err)
        ) from err

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(
            {
                "speakerId": str(speaker).replace(" ", "_").lower(),
                "startTime": float(turn.start),
                "endTime": float(turn.end),
                "text": "",
            }
        )
    return postprocess_diarization_segments(segments)


def postprocess_diarization_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Reduce diarization fragmentation:
    - sort segments by time
    - drop extremely short turns
    - merge adjacent turns of the same speaker separated by a small gap
    """
    if not segments:
        return segments

    merge_gap = float(os.getenv("DIARIZATION_MERGE_GAP_SEC", "0.25") or 0.25)
    min_turn = float(os.getenv("DIARIZATION_MIN_TURN_SEC", "0.40") or 0.40)

    ordered = sorted(
        segments,
        key=lambda s: (float(s.get("startTime", 0.0)), float(s.get("endTime", 0.0))),
    )

    cleaned: List[Dict[str, Any]] = []
    for seg in ordered:
        start = float(seg.get("startTime", 0.0))
        end = float(seg.get("endTime", 0.0))
        if end <= start:
            continue
        if (end - start) < min_turn:
            continue
        cleaned.append(
            {
                "speakerId": str(seg.get("speakerId", "speaker_unknown")),
                "startTime": start,
                "endTime": end,
                "text": "",
            }
        )

    if not cleaned:
        return []

    merged: List[Dict[str, Any]] = [cleaned[0]]
    for seg in cleaned[1:]:
        last = merged[-1]
        if seg["speakerId"] == last["speakerId"] and seg["startTime"] - last["endTime"] <= merge_gap:
            last["endTime"] = max(float(last["endTime"]), float(seg["endTime"]))
        else:
            merged.append(seg)

    return merged


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-name", type=str, default="pyannote/speaker-diarization-3.1")
    parser.add_argument("--cache-dir", type=str, default=".models/diarization")
    parser.add_argument("--local-model-path", type=str, default="")
    parser.add_argument("--mode", type=str, default="local_pyannote")
    parser.add_argument("--audio-path", type=str, default="")
    parser.add_argument("--segments-json", type=str, default="")
    parser.add_argument(
        "--segments-json-file",
        type=str,
        default="",
        help="UTF-8 file with {\"segments\": [...]} for long ASR output (avoids CLI length limits)",
    )
    parser.add_argument("--merge-gap-sec", type=str, default="")
    parser.add_argument("--min-turn-sec", type=str, default="")
    parser.add_argument("--device-mode", type=str, default="auto")
    args = parser.parse_args()

    os.makedirs(args.cache_dir, exist_ok=True)

    if args.merge_gap_sec:
        os.environ["DIARIZATION_MERGE_GAP_SEC"] = str(args.merge_gap_sec)
    if args.min_turn_sec:
        os.environ["DIARIZATION_MIN_TURN_SEC"] = str(args.min_turn_sec)

    seg_file = (args.segments_json_file or "").strip()
    if seg_file:
        sp = Path(seg_file)
        if not sp.is_file():
            raise RuntimeError(f"segments-json-file not found: {seg_file}")
        payload = json.loads(sp.read_text(encoding="utf-8"))
    else:
        payload = json.loads(args.segments_json or "{}")
    segments = payload.get("segments", [])
    hf_token = os.getenv("HF_TOKEN", "")

    provider = "heuristic"
    downloaded = False

    if args.mode == "heuristic" or args.model_name == "heuristic":
        output = {
            "segments": heuristic_diarization(segments),
            "model": args.model_name,
            "downloaded": False,
            "provider": "heuristic",
        }
        print(json.dumps(output, ensure_ascii=False))
        return

    if args.mode == "local_pyannote":
        if not args.local_model_path:
            raise RuntimeError("local_pyannote mode requires --local-model-path")
        if is_offline_bundle(args.local_model_path):
            provider = "local_pyannote"
            downloaded = True
            raw_segments = run_pyannote_diarization_offline(args.local_model_path, args.audio_path, args.device_mode)
        else:
            ensure_local_model(args.model_name, args.local_model_path, hf_token)
            provider = "local_pyannote"
            downloaded = True
            raw_segments = run_pyannote_diarization(args.local_model_path, args.audio_path, hf_token, args.device_mode)
    elif args.mode == "hf_pyannote":
        if not os.getenv("HF_TOKEN"):
            raise RuntimeError("HF_TOKEN is required for hf_pyannote mode")
        provider = "pyannote"
        downloaded = True
        raw_segments = run_pyannote_diarization(args.model_name, args.audio_path, hf_token, args.device_mode)
    else:
        raise RuntimeError(f"Unsupported diarization mode: {args.mode}")

    output = {
        "segments": attach_text_from_asr(raw_segments, segments),
        "model": args.model_name,
        "downloaded": downloaded,
        "provider": provider,
    }
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
