#!/usr/bin/env python3
"""
One-time download: pulls pyannote speaker-diarization-3.1 and all pipeline dependencies
(segmentation, embedding, plda) into a single local folder tree, then patches
pipeline/config.yaml to use absolute local paths so runtime does not need HF_TOKEN.

Requires HF_TOKEN in environment for gated models (run once manually):
  set HF_TOKEN=...   (Windows)
  python scripts/local-models/download_pyannote_offline_bundle.py

Output default: <apps/web>/.models/diarization/offline-bundle/ (resolved from this script location).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_WEB_APP_ROOT = _SCRIPT_DIR.parent.parent
_DEFAULT_OFFLINE_ROOT = _WEB_APP_ROOT / ".models" / "diarization" / "offline-bundle"


def bootstrap_hf_hub():
    try:
        from huggingface_hub import hf_hub_download, snapshot_download  # type: ignore

        return snapshot_download, hf_hub_download
    except Exception:
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface_hub"])
        from huggingface_hub import hf_hub_download, snapshot_download  # type: ignore

        return snapshot_download, hf_hub_download


def bootstrap_yaml():
    try:
        import yaml  # type: ignore

        return yaml
    except Exception:
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyyaml"])
        import yaml  # type: ignore

        return yaml


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(_DEFAULT_OFFLINE_ROOT),
        help="Root folder for the offline bundle",
    )
    parser.add_argument(
        "--pipeline-repo",
        type=str,
        default="pyannote/speaker-diarization-3.1",
    )
    parser.add_argument(
        "--segmentation-repo",
        type=str,
        default="pyannote/segmentation-3.0",
    )
    parser.add_argument(
        "--embedding-repo",
        type=str,
        default="pyannote/wespeaker-voxceleb-resnet34-LM",
    )
    parser.add_argument(
        "--plda-repo",
        type=str,
        default="pyannote/speaker-diarization-community-1",
    )
    args = parser.parse_args()

    token = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
    if not token:
        print(
            "ERROR: Set HF_TOKEN in the environment for gated models (one-time download).",
            file=sys.stderr,
        )
        sys.exit(1)

    snapshot_download, hf_hub_download = bootstrap_hf_hub()
    yaml = bootstrap_yaml()

    root = Path(args.output_dir).resolve()
    pipeline_dir = root / "pipeline"
    seg_dir = root / "segmentation-3.0"
    emb_dir = root / "wespeaker-voxceleb-resnet34-LM"
    emb_local_dir = root / "embedding-local"
    plda_dir = root / "speaker-diarization-community-1"

    pipeline_dir.mkdir(parents=True, exist_ok=True)
    seg_dir.mkdir(parents=True, exist_ok=True)
    emb_dir.mkdir(parents=True, exist_ok=True)
    emb_local_dir.mkdir(parents=True, exist_ok=True)
    plda_dir.mkdir(parents=True, exist_ok=True)

    print("Downloading pipeline...", flush=True)
    snapshot_download(repo_id=args.pipeline_repo, local_dir=str(pipeline_dir), token=token)

    print("Downloading segmentation model...", flush=True)
    snapshot_download(repo_id=args.segmentation_repo, local_dir=str(seg_dir), token=token)

    print("Downloading embedding model...", flush=True)
    snapshot_download(repo_id=args.embedding_repo, local_dir=str(emb_dir), token=token)

    # pyannote 3.1 may load PLDA assets from this repo by default.
    print("Downloading PLDA assets...", flush=True)
    snapshot_download(repo_id=args.plda_repo, local_dir=str(plda_dir), token=token)

    config_path = pipeline_dir / "config.yaml"
    if not config_path.exists():
        raise FileNotFoundError(f"Missing {config_path}")

    with config_path.open("r", encoding="utf-8") as handle:
        cfg = yaml.safe_load(handle)

    if not isinstance(cfg, dict):
        raise RuntimeError("Invalid pipeline config.yaml")

    pipeline = cfg.get("pipeline")
    if not isinstance(pipeline, dict):
        raise RuntimeError("config.yaml: missing pipeline section")

    params = pipeline.get("params")
    if not isinstance(params, dict):
        raise RuntimeError("config.yaml: missing pipeline.params")

    # Ensure required heavy artifacts are present physically (not metadata-only).
    seg_weights = seg_dir / "pytorch_model.bin"
    if not seg_weights.exists():
        hf_hub_download(
            repo_id=args.segmentation_repo,
            filename="pytorch_model.bin",
            local_dir=str(seg_dir),
            token=token,
            force_download=True,
        )
    if not seg_weights.exists():
        raise RuntimeError(f"Segmentation weights missing after download: {seg_weights}")

    embedding_weights = emb_dir / "pytorch_model.bin"
    if not embedding_weights.exists():
        hf_hub_download(
            repo_id=args.embedding_repo,
            filename="pytorch_model.bin",
            local_dir=str(emb_dir),
            token=token,
            force_download=True,
        )
    if not embedding_weights.exists():
        raise RuntimeError(f"Embedding weights missing after download: {embedding_weights}")

    embedding_config = emb_dir / "config.yaml"
    if not embedding_config.exists():
        hf_hub_download(
            repo_id=args.embedding_repo,
            filename="config.yaml",
            local_dir=str(emb_dir),
            token=token,
            force_download=True,
        )
    if not embedding_config.exists():
        raise RuntimeError(f"Embedding config missing after download: {embedding_config}")

    # Avoid "wespeaker" keyword in the configured path so pyannote does not force ONNX branch.
    # This alias folder contains the same model files and is loaded as a regular local pyannote model.
    shutil.copy2(embedding_weights, emb_local_dir / "pytorch_model.bin")
    shutil.copy2(embedding_config, emb_local_dir / "config.yaml")

    # Point to local snapshots (absolute paths, forward slashes for fewer surprises on Windows)
    params["segmentation"] = seg_dir.resolve().as_posix()
    params["embedding"] = emb_local_dir.resolve().as_posix()
    plda_assets_dir = plda_dir / "plda"
    plda_assets_dir.mkdir(parents=True, exist_ok=True)
    params["plda"] = plda_assets_dir.resolve().as_posix()

    # Some environments fetch only metadata for LFS-managed PLDA .npz files.
    # Ensure required artifacts exist physically in local bundle.
    for filename in ("xvec_transform.npz", "plda.npz"):
        target = plda_assets_dir / filename
        if not target.exists():
            hf_hub_download(
                repo_id=args.plda_repo,
                filename=f"plda/{filename}",
                local_dir=str(plda_dir),
                token=token,
                force_download=True,
            )
        if not target.exists():
            raise RuntimeError(
                f"PLDA asset missing after download: {target}. "
                "Check HF token scope and model access."
            )

    cfg["offline_bundle"] = True
    cfg["offline_bundle_version"] = 1

    with config_path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(cfg, handle, sort_keys=False, allow_unicode=True)

    manifest = {
        "pipeline_dir": pipeline_dir.resolve().as_posix(),
        "segmentation_dir": seg_dir.resolve().as_posix(),
        "embedding_dir": emb_dir.resolve().as_posix(),
        "embedding_local_dir": emb_local_dir.resolve().as_posix(),
        "plda_dir": plda_dir.resolve().as_posix(),
        "pipeline_repo": args.pipeline_repo,
        "segmentation_repo": args.segmentation_repo,
        "embedding_repo": args.embedding_repo,
        "plda_repo": args.plda_repo,
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print("OK: offline bundle ready.")
    print(f"  {manifest_path}")
    print("Set PYANNOTE_OFFLINE_PIPELINE to:")
    print(f"  {pipeline_dir.resolve().as_posix()}")


if __name__ == "__main__":
    main()
