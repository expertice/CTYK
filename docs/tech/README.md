# Техническая документация CTYK

Точка входа для инженеров: обзор системы, ссылки на детальные разделы. Кодовая база пайплайна и UI: приложение **Next.js** в каталоге [`apps/web`](../../apps/web).

## О проекте

**CTYK** — система обработки аудиозаписей рабочих коммуникаций (инструктажи, планёрки, разборы по чек-листам) с цепочкой: подготовка аудио → распознавание речи (ASR) → диаризация и слияние реплик → просодический анализ (librosa) и rule-engine по лексикону → опционально LLM (деанон спикеров, суммаризация, психослой, чек-лист) → сборка **SESSION_REPORT** (и экспорт, в т.ч. PDF).

Пользователь собирает сценарий в **графовом конструкторе** (шаги = модули, рёбра = типы артефактов), сохраняет сценарий и запускает сессию; состояние прогона и артефакты ведутся в клиентском рантайме.

## Пайплайн «от аудио до отчёта» (упрощённо)

```text
[AUDIO_*] → AUDIO → AUDIO_PREPARED → TEXT (ASR)
                    ↘              ↗
                      DIARIZATION → SPEAKER_SEGMENTS
                                        ↓
                         SPEAKER_TURN_MERGE → READY_SPEAKERS (+ DRAFT_SPEAKERS)
                                        ↓
              [опц.] SPEAKER_DRAFT_EDIT → READY_SPEAKERS (после паузы)
                                        ↓
                         PSYCH_STATE → ENRICHED_TRANSCRIPT, PSYCH_LABELS
                                        ↓
              LLM_TASK_* ──LLM_SUBTASK──► LLM_PUPPET → SUMMARY_TEXT / LLM_SUMMARY / …
                                        ↓
                         REPORT_OUTPUT → SESSION_REPORT
```

Канонический таймлайн для бизнес-LLM и просодики — **`READY_SPEAKERS`** (см. [`architecture-overview.md`](./architecture-overview.md)).

## Документы

| Документ | Содержание |
|----------|------------|
| [architecture-overview.md](./architecture-overview.md) | Слои ingestion → canonical timeline → enrichment → analysis → reporting; связи и **Planned**. |
| [artifacts-and-contracts.md](./artifacts-and-contracts.md) | Типы `ArtifactTypeId`, оболочка `ArtifactEnvelope`, JSON-полезная нагрузка, продюсеры/потребители. |
| [pipeline-modules.md](./pipeline-modules.md) | Каталог модулей (`ModuleId`), входы/выходы, настройки, ограничения. |
| [llm-integration.md](./llm-integration.md) | Задачи `LlmTask`, пульт `LLM_PUPPET`, промпты, пост-разбор ответа. |
| [ui-and-scenarios.md](./ui-and-scenarios.md) | Конструктор сценария, сессии, отчёт. |
| [process-settings.md](./process-settings.md) | `ProcessSettings`: валидация графа, порты, отчёт. |
| [known-issues-and-gaps.md](./known-issues-and-gaps.md) | Ограничения, расхождения каталога с кодом, планы. |
| [session-reuse-long-sessions.md](./session-reuse-long-sessions.md) | Режим «Повторить» (reuse-pack), длинные записи и LLM. |

## Словарь комбинаций метрик (full_psycho_analytics)

Режим **`psychMode: full_psycho_analytics`** подмешивает в инструкцию LLM перечень разрешённых **`combinationId`** и пар метрик из JSON:

- [`apps/web/lib/pipeline/data/psych_full_metric_combinations.v1.json`](../../apps/web/lib/pipeline/data/psych_full_metric_combinations.v1.json) — канонические идентификаторы для `evidence[].combinationId` в `LLM_PSYCH_FULL_V1`;
- [`apps/web/lib/pipeline/data/psych_full_metric_combinations.md`](../../apps/web/lib/pipeline/data/psych_full_metric_combinations.md) — пояснения и маппинг имён с внешних документов;
- логика загрузки и фильтра по метрикам сессии: [`apps/web/lib/pipeline/psych-full-combinations-dictionary.ts`](../../apps/web/lib/pipeline/psych-full-combinations-dictionary.ts).

Проверка JSON: `node apps/web/scripts/verify-psych-full-dictionary.mjs` (ожидается полный граф пар по `supportedMetricKeys`).

## Ключевые файлы в коде

- Типы артефактов: [`apps/web/types/artifact.types.ts`](../../apps/web/types/artifact.types.ts)
- Модули и `ModuleId`: [`apps/web/types/pipeline.types.ts`](../../apps/web/types/pipeline.types.ts), [`apps/web/lib/pipeline/module-catalog.ts`](../../apps/web/lib/pipeline/module-catalog.ts)
- Контракты LLM-подзадач: [`apps/web/lib/pipeline/llm-task-contracts.ts`](../../apps/web/lib/pipeline/llm-task-contracts.ts)
- Сборка отчёта: [`apps/web/lib/report/assemble-report.ts`](../../apps/web/lib/report/assemble-report.ts)
