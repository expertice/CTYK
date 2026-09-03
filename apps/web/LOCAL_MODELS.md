# Local ASR and Diarization Runtime

This project supports local model execution for:

- ASR (`ASR` module)
- Diarization (`DIARIZATION` module)

## How it works

1. Pipeline modules call local Python adapters.
2. If required Python packages/models are missing, adapters can auto-install them (ASR).
3. Models are stored under `apps/web/.models/`.

## Scenario versions (pipeline builder)

Custom scenarios saved from `/scenarios/build` are stored under `apps/web/.scenarios/<id>/` (`meta.json`, `versions/<n>.json`). The built-in `scenario_default` is not written to disk; saving under the same id is rejected (duplicate the sample under a new id first).

## Pyannote without HF_TOKEN at runtime (recommended)

Gated Hub models (`speaker-diarization-3.1`, `segmentation-3.0`, embedding, etc.) can be downloaded **once** into a self-contained folder. The download script patches `config.yaml` so sub-models load from **absolute local paths** and sets `offline_bundle: true`. The Python runner then uses **no Hub token** and sets offline mode for Hugging Face libraries.

**One-time download** (from `apps/web`, requires `HF_TOKEN` in the environment and accepted model terms on huggingface.co):

```bash
pnpm models:pyannote-offline
```

Default output: `apps/web/.models/diarization/offline-bundle/` (pipeline in `offline-bundle/pipeline/`).

**Runtime** (Next.js / Python): do **not** set `HF_TOKEN` if you use this bundle — it is not required for diarization.

Optional overrides:

- `PYANNOTE_OFFLINE_PIPELINE` — absolute path to the pipeline directory (same as `offline-bundle/pipeline`).
- `DIARIZATION_LOCAL_MODEL_PATH` — relative to `apps/web` or absolute, if you do not use `PYANNOTE_OFFLINE_PIPELINE`.

Resolution order when the UI does not pass a path: `PYANNOTE_OFFLINE_PIPELINE` → `DIARIZATION_LOCAL_MODEL_PATH` → existing `offline-bundle/pipeline` → legacy `pyannote-local` → default `offline-bundle/pipeline`.

## GPU (CUDA) PyTorch in the same venv as pyannote

The app probes **Torch CUDA** via the same `PYTHON_BIN` venv. If you previously installed **CPU-only** wheels (`2.2.2+cpu`), `torch.cuda.is_available()` is `False` even when the NVIDIA driver works — use a **CUDA build** of `torch` / `torchaudio` / `torchvision` **with matching versions**.

Example (Windows, Python 3.12, PyTorch 2.2.2 + CUDA 12.1 — matches `pyannote.audio` 3.1.x in this project):

```bash
.\.venv-pyannote\Scripts\python.exe -m pip install --upgrade torch==2.2.2 torchvision==0.17.2 torchaudio==2.2.2 --index-url https://download.pytorch.org/whl/cu121
```

Verify:

```bash
.\.venv-pyannote\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
```

## Environment variables

```env
PYTHON_BIN=python
ASR_LOCAL_MODEL=small
ASR_MODEL_CACHE_DIR=.models/asr
DIARIZATION_LOCAL_MODEL=pyannote/speaker-diarization-3.1
DIARIZATION_MODEL_CACHE_DIR=.models/diarization
# Optional — path to local pyannote snapshot or offline pipeline dir:
DIARIZATION_LOCAL_MODEL_PATH=.models/diarization/offline-bundle/pipeline
# Optional — absolute path to offline pipeline directory:
# PYANNOTE_OFFLINE_PIPELINE=
# Only for one-time download script or hf_pyannote Hub mode:
# HF_TOKEN=
```

Notes:

- **Offline bundle**: no `HF_TOKEN` at runtime for `local_pyannote` when `config.yaml` contains `offline_bundle: true` (produced by `pnpm models:pyannote-offline`).
- **Hub / partial local snapshot** without the offline bundle: gated dependencies may still hit the Hub → set `HF_TOKEN` and accept terms for each model page.
- `hf_pyannote` mode requires `HF_TOKEN` at runtime.
- `heuristic` mode uses no models.

## Project model storage

Default layout under `apps/web/.models/`:

- `asr/`
- `diarization/`
- `diarization/offline-bundle/` — full offline pyannote bundle (after one-time download)
- `diarization/pyannote-local/` — legacy single-repo snapshot (optional)

## First run behavior

- **ASR**: may install `faster-whisper` and download the Whisper model into `ASR_MODEL_CACHE_DIR`.
- **Diarization**: install `pyannote.audio` as needed; with offline bundle, loads fully locally without Hub auth.
- Local adapters automatically normalize input audio to mono 16k WAV via `ffmpeg` (if available), which improves stability on MP3/VBR sources.

## Production

- Bake the offline bundle into the deployment image, or mount it read-only.
- Pin Python package versions.
- Avoid putting `HF_TOKEN` in the runtime environment if you rely on the offline bundle only.
