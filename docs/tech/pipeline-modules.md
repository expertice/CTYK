# Модули пайплайна

[← К оглавлению](./README.md)

## Оглавление

1. Таблица модулей (`ModuleId`)  
2. Связь с `ProcessSettings` и валидатором  

Каталог для UI и документации: [`PIPELINE_MODULE_CATALOG`](../../apps/web/lib/pipeline/module-catalog.ts). Реестр исполнителей: [`createDefaultModuleRegistry`](../../apps/web/lib/pipeline/modules/index.ts).

Легенда: **requires / produces** — типичные `typicalRequires` / `typicalProduces` из каталога; фактические входы на шаге могут собираться по рёбрам (`gatherInboundArtifactsForStep`). Подзадачи **`LLM_TASK_*`** в рантайме **не пишут артефакты сами** ([`LlmTaskSatelliteModule.run` возвращает `{}`](../../apps/web/lib/pipeline/modules/llm-task-satellite.module.ts)); выходы формиру **`LLM_PUPPET`**.

| `ModuleId` | Назначение | Requires (типично) | Produces (типично) | Настройки (выборочно) | Ограничения / примечания |
|------------|------------|--------------------|--------------------|-------------------------|---------------------------|
| `AUDIO_FROM_UPLOAD` | Локальный файл → `AUDIO` | `AUDIO_SOURCE` | `AUDIO` | `localUrl` | Нужен URL в конфиге или заранее в `AUDIO.url` |
| `AUDIO_FROM_URL` | HTTP(S) загрузка | `AUDIO_SOURCE` | `AUDIO` | `url` | |
| `AUDIO_FROM_API` | Запрос к API | `AUDIO_SOURCE` | `AUDIO` | `endpoint`, `method`, `headers`, `body` | |
| `AUDIO_FROM_RTSP` | Захват RTSP → wav | `AUDIO_SOURCE` | `AUDIO` | `rtspUrl`, `captureSec`, `transport` | ffmpeg |
| `CHECKLIST_SOURCE` | JSON чек-листа | — | `CHECKLIST_DEFINITION` | `filePath` | Путь относительно `apps/web` если относительный |
| `AUDIO_PREPARE` | Нормализация, чанки | `AUDIO` | `AUDIO_PREPARED` | `targetSampleRate`, `targetChannels`, `chunkSec`, `overlapSec` | |
| `ASR` | faster-whisper | `AUDIO_PREPARED`, `AUDIO` | `TEXT` | `whisperModel`, `asrDevice`, `asrComputeType` | Fallback: готовые `TRANSCRIPT_SEGMENTS`/`TEXT` без аудио |
| `DIARIZATION` | pyannote / эвристика | `AUDIO_PREPARED`, `TEXT` | `SPEAKER_SEGMENTS` | `diarizationModel`, `diarizationMode`, пороги слияния | |
| `SPEAKER_TURN_MERGE` | Слияние соседних сегментов | `SPEAKER_SEGMENTS`* | `READY_SPEAKERS`, `DRAFT_SPEAKERS` | — | *или `TRANSCRIPT_SEGMENTS` по входящим рёбрам |
| `SPEAKER_DRAFT_EDIT` | Пауза, правка таблицы | `DRAFT_SPEAKERS` | `READY_SPEAKERS` | — | Пропуск шага если `READY_SPEAKERS` уже от этого шага ([`orchestrator`](../../apps/web/lib/pipeline/orchestrator.ts)) |
| `PSYCH_STATE` | librosa + matcher | `READY_SPEAKERS`, `AUDIO_PREPARED`* | `ENRICHED_TRANSCRIPT`, `PSYCH_LABELS` | `requireReadySpeakers`, `fallbackSource` | *валидация допускает `AUDIO` как fallback для аудио-URL |
| `LLM_TASK_SUMMARY` | Подзадача суммаризации | по контракту `READY_SPEAKERS` | по контракту + ребро `LLM_SUBTASK` | `instructionPrompt`, `summaryScenario`, `summarySubScenario`, `llmRunOrder` | Исполнение в `LLM_PUPPET` |
| `LLM_TASK_SPEAKER_NAMES` | Деанон | `READY_SPEAKERS` | `SPEAKER_IDENTITY_MAP`, `LLM_SUBTASK` | `speakerNamePrompt`, `llmRunOrder` | |
| `LLM_TASK_PSYCH` | Психо LLM | `READY_SPEAKERS`, `PSYCH_LABELS` | `LLM_PSYCH_LABELS`, `LLM_PSYCH_NARRATIVE`, `LLM_SUBTASK` | `enableLlmLexiconCheck`, `llmLexiconCheckMode`, `weakRuleThreshold`, `maxExtraLabels` | |
| `LLM_TASK_CHECKLIST` | Чек-лист LLM | `READY_SPEAKERS`, `CHECKLIST_DEFINITION` | `CHECKLIST_RESULTS`, `LLM_SUBTASK` | `instructionPrompt`, `llmRunOrder` | |
| `LLM_PUPPET` | Единственный вызов LLM | `LLM_SUBTASK` (ребро) | каталог перечисляет `SUMMARY_TEXT`, `LLM_SUMMARY`, … | `llmBaseUrl`, `llmApiKey`, `llmModel`, пресет [`LlmBehaviorConfig`](../../apps/web/lib/pipeline/llm-behavior-presets.ts) | Параметры исполнения только с шага пульта |
| `REPORT_OUTPUT` | Сборка отчёта | — (мультивход) | `SESSION_REPORT` | `sections`, `strict`, `renderInputs` | Допустимые типы входов: [`REPORT_OUTPUT_ACCEPTED_INPUTS`](../../apps/web/lib/pipeline/report-output-inputs.ts) |

## process-settings и модули

Поведение конструктора (порты, универсальный вход отчёта) зависит от [`ProcessSettings`](./process-settings.md). Валидация графа — [`validateScenarioGraph`](../../apps/web/lib/pipeline/validator.ts).

## TODO в коде

Явных `TODO` в перечисленных модулях может не быть; узкие места и расхождения вынесены в [known-issues-and-gaps.md](./known-issues-and-gaps.md).
