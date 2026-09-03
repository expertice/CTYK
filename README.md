# CTYK

Пайплайн: аудио → ASR → диаризация → анализ → отчёт (Next.js, `apps/web`).

## Быстрый старт

**Нужно:** Node.js 20+, [pnpm](https://pnpm.io) 10+, Python 3.12, [ffmpeg](https://ffmpeg.org) в `PATH` (для аудио).

```bash
git clone https://github.com/expertice/CTYK.git
cd CTYK
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Открыть http://localhost:3000

## Опционально (локальные модели)

- **ASR / diarization** — при первом прогоне Python-пакеты и модели подтянутся сами (см. `apps/web/LOCAL_MODELS.md`).
- **Pyannote offline** (без `HF_TOKEN` на рантайме): принять условия моделей на Hugging Face, в `.env.local` указать `HF_TOKEN`, затем из `apps/web`:

  ```bash
  pnpm models:pyannote-offline
  ```

- **LLM** — локальный Ollama (или другой провайдер в настройках UI).
- Путь к ffmpeg, если не в `PATH`: `FFMPEG_BIN=...` в `.env.local`.

Подробнее: [`apps/web/LOCAL_MODELS.md`](apps/web/LOCAL_MODELS.md), [`docs/tech/README.md`](docs/tech/README.md).
