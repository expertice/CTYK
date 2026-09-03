# Архитектура (обзор)

[← К оглавлению](./README.md)

## Оглавление

1. Слои: ingestion, canonical timeline, enrichment, analysis, reporting  
2. Порядок зависимостей и LLM-пульт  
3. Диаграмма жизненного цикла RDY → ENR → psych  

## Слои и поток данных

Ниже — соответствие коду (`ArtifactTypeId`, имена модулей из [`ModuleId`](../../apps/web/types/pipeline.types.ts)).

### 1. Ingestion (входы)

| Что приходит | Артефакты | Примечание |
|--------------|-----------|------------|
| Пользовательская сессия с записью | `AUDIO_SOURCE` (сид), `AUDIO` | Источники [`AUDIO_FROM_*`](../../apps/web/lib/pipeline/module-catalog.ts), `AUDIO.data` + `url` |
| Внешний чек-лист JSON | `CHECKLIST_DEFINITION` | [`CHECKLIST_SOURCE`](../../apps/web/lib/pipeline/modules/checklist-source.module.ts) |

ASR ожидает `AUDIO_PREPARED` и/или `AUDIO`; возможен путь без записи через уже готовые `TEXT` / `TRANSCRIPT_SEGMENTS` (см. [`AsrModule`](../../apps/web/lib/pipeline/modules/asr.module.ts)).

### 2. Canonical timeline

**Единый опорный таймлайн для просодики и LLM — `READY_SPEAKERS`** (массив реплик `speakerId`, `startTime`, `endTime`, `text`).

Путь к нему:

1. `SPEAKER_SEGMENTS` ← `DIARIZATION`
2. `READY_SPEAKERS` + `DRAFT_SPEAKERS` ← `SPEAKER_TURN_MERGE` (одинаковые данные; черновик для UI)
3. При необходимости ручной правки: пауза `SPEAKER_DRAFT_EDIT` пишет подтверждённый `READY_SPEAKERS`

`TRANSCRIPT_SEGMENTS` — альтернативный вход слияния (совместимость), если пришёл с диаризации вместо `SPEAKER_SEGMENTS`.

### 3. Enrichment

| Артефакт | Смысл |
|----------|--------|
| `SPEAKER_IDENTITY_MAP` | Карта имён/ролей по `speakerId` (LLM `LLM_TASK_SPEAKER_NAMES`) |
| `ENRICHED_TRANSCRIPT` | Сегменты + просодические метрики (librosa), `kind: "prosody_enriched_transcript"` |

Просодика и лексикон: модуль `PSYCH_STATE` → `PSYCH_LABELS` (`kind: "psych_matcher_v1"`) + `ENRICHED_TRANSCRIPT`.

### 4. Analysis

- **Rule-engine (просодика):** [`runPsychMetricMatcher`](../../apps/web/lib/pipeline/psych-metric-matcher.ts) по обогащённым сегментам и JSON-лексикону.
- **LLM:** подзадачи `LLM_TASK_SUMMARY` | `LLM_TASK_SPEAKER_NAMES` | `LLM_TASK_PSYCH` | `LLM_TASK_CHECKLIST`; исполнение только в **`LLM_PUPPET`** (см. [llm-integration.md](./llm-integration.md)).

### 5. Reporting

- **`SESSION_REPORT`** — результат модуля `REPORT_OUTPUT`; агрегирует доступные артефакты через [`assembleSessionReport`](../../apps/web/lib/report/assemble-report.ts).
- **`SUMMARY_TEXT` / `LLM_SUMMARY`** — текстовое и структурированное резюме; в отчёте суммаризация читает оба (приоритет см. код сборки).

**Planned:** отдельный единый артефакт «LLMSUMMARY» в коде не выделен — используются `SUMMARY_TEXT` + `LLM_SUMMARY` (см. [known-issues-and-gaps.md](./known-issues-and-gaps.md)).

## Кто кого читает/пишет (порядок)

```text
                    ┌─────────────────┐
                    │  READY_SPEAKERS  │◄──── канон для LLM bundle fallback
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   PSYCH_STATE         LLM_TASK_* (граф)    REPORT_OUTPUT
         │                   │                   │
         ▼                   ▼                   ▼
 ENRICHED_TRANSCRIPT   LLM_PUPPET пишет     SESSION_REPORT
 PSYCH_LABELS          бизнес-артефакты
```

Оркестратор учитывает, что **бизнес-выходы `LLM_TASK_*` физически пишет `LLM_PUPPET`**, поэтому зависимости downstream от LLM привязываются к шагу пульта ([`planBatches`](../../apps/web/lib/pipeline/orchestrator.ts)).

## Жизненный цикл RDY → ENR → psych (ASCII)

```text
SPEAKER_SEGMENTS ──► SPEAKER_TURN_MERGE ──► READY_SPEAKERS
                                                 │
                                                 ▼
                                          PSYCH_STATE
                                                 │
                         ┌───────────────────────┴───────────────────────┐
                         ▼                                               ▼
                 ENRICHED_TRANSCRIPT                              PSYCH_LABELS
                 (librosa metrics)                               (psych_matcher_v1)
                         │                                               │
                         └───────────────────────┬───────────────────────┘
                                                 ▼
                                          LLM_TASK_PSYCH + LLM_PUPPET
                                                 │
                                                 ▼
                                    LLM_PSYCH_LABELS, LLM_PSYCH_NARRATIVE
```
