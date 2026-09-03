# Артефакты и контракты

[← К оглавлению](./README.md)

## Оглавление

1. Базовая оболочка и `ArtifactTypeId`  
2. Служебные: `AUDIO_SOURCE`, `LLM_SUBTASK`, `LLM_INSTRUCTIONS`  
3. Аудио, TEXT, сегменты  
4. `READY_SPEAKERS` / `DRAFT_SPEAKERS`  
5. Просодика и чек-лист  
6. Артефакты LLM и `SESSION_REPORT`  

Источник истины по перечислению типов: [`ArtifactTypeId`](../../apps/web/types/artifact.types.ts). Общая оболочка:

```ts
interface ArtifactEnvelope<TData = unknown> {
  type: ArtifactTypeId;
  status: "pending" | "ready" | "error";
  version: "v1";
  producer: { moduleId: string; stepId: string; runId: string };
  quality?: { confidence?: number; coverage?: number; warnings?: string[] };
  explainability?: ExplainabilityRef[];
  data?: TData;
  url?: string;
  createdAt: string;
  errorMessage?: string;
}
```

Ниже — полезная нагрузка `data` (если не оговорено иное, поля описаны с точки зрения фактического использования в коде).

---

## Служебные и транспортные

### `AUDIO_SOURCE`

- **Назначение:** сид из UI сессии (метаданные загрузки), читается модулями `AUDIO_FROM_*`.
- **Производитель:** не модуль пайплайна; подмешивается в стор сессии при подготовке запуска.
- **Потребители:** [`AudioFromUploadModule`](../../apps/web/lib/pipeline/modules/audio-from-upload.module.ts) и аналоги (`kind` в `data`).

### `LLM_SUBTASK`

- **Назначение:** тип **ребра** от шага `LLM_TASK_*` к `LLM_PUPPET`; оркестрация и валидация.
- **Хранение:** в комментарии к типу указано: *не хранится как envelope в сторе* ([`artifact.types.ts`](../../apps/web/types/artifact.types.ts)).
- **Потребитель:** только граф (валидатор, [`listSubtasksForPuppet`](../../apps/web/lib/pipeline/llm-puppet-subtasks.ts)).

### `LLM_INSTRUCTIONS`

- **Назначение:** агрегированные текстовые инструкции для bundle-промпта (`parts[]`).
- **Производитель:** логика в [`mergeEmbeddedConfigIntoInstructionArtifact`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts) при подготовке вызова LLM.
- **Потребитель:** [`buildLlmBundlePrompt`](../../apps/web/lib/pipeline/llm-instructions-artifact.ts) (в JSON payload инструкции вырезаются из `artifacts`, чтобы не дублировать).

---

## Аудио и распознавание

### `AUDIO`

- **`data`:** например `{ sourceType: "upload" | … }`; **`url`** — путь/URL к файлу.
- **Производители:** `AUDIO_FROM_UPLOAD`, `AUDIO_FROM_URL`, `AUDIO_FROM_API`, `AUDIO_FROM_RTSP`.

### `AUDIO_PREPARED`

- **Смысл:** нормализованное аудио + универсальные чанки для таймлайна (см. конфиг `AUDIO_PREPARE`).
- **Производитель:** `AUDIO_PREPARE`.

### `TEXT`

- **`data`:** `{ text: string; segments?: unknown }` — сегменты ASR при наличии.
- **Производитель:** `ASR` ([`asr.module.ts`](../../apps/web/lib/pipeline/modules/asr.module.ts)).

### `TRANSCRIPT_SEGMENTS`

- **Смысл:** сегменты транскрипта (массив с `startTime`, `endTime`, `text`, `speakerId` — как в слиянии).
- **Производитель:** внешний/альтернативный путь к ASR; используется `SPEAKER_TURN_MERGE` и fallback ASR.

### `SPEAKER_SEGMENTS`

- **Производитель:** `DIARIZATION` (входы: `AUDIO_PREPARED`, `TEXT`).

---

## Таймлайн спикеров

### `DRAFT_SPEAKERS` / `READY_SPEAKERS`

- **`data`:** массив объектов `{ speakerId, startTime, endTime, text }` (см. [`SpeakerTurnMergeModule`](../../apps/web/lib/pipeline/modules/speaker-turn-merge.module.ts)).
- **Производитель:** `SPEAKER_TURN_MERGE` создаёт оба; `SPEAKER_DRAFT_EDIT` перезаписывает `READY_SPEAKERS` после UI-паузы.

**Синтетический пример:**

```json
[
  {
    "speakerId": "speaker_00",
    "startTime": 0.0,
    "endTime": 12.4,
    "text": "Доброе утро, начинаем инструктаж по охране труда."
  }
]
```

---

## Обогащение и психослой (rule-engine)

### `ENRICHED_TRANSCRIPT`

- **`data`:** `{ kind: "prosody_enriched_transcript"; sampleRate; globalTempoBpm; segments: ProsodyEnrichedSegment[] }`.
- **Производитель:** `PSYCH_STATE`. Для экономии токенов в промпте LLM сегменты могут быть сжаты до метаданных (`omittedSegmentsForSmallLlm` в [`buildArtifactsForLlmGateway`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts)).

### `PSYCH_LABELS`

- **`data`:** [`PsychMatcherV1Payload`](../../apps/web/lib/pipeline/psych-metric-matcher.ts): `kind: "psych_matcher_v1"`, `entries`, `narrativeHints`, …
- **Производитель:** `PSYCH_STATE`.

---

## Чек-лист

### `CHECKLIST_DEFINITION`

- **Пример файла:** [`apps/web/checklists/checklist.sample.json`](../../apps/web/checklists/checklist.sample.json) — массив `items[]` с `id`, `label`, `priority`, …
- **Производитель:** `CHECKLIST_SOURCE`.

### `CHECKLIST_RESULTS`

- **Ожидаемая форма элементов** (LLM + fallback): см. [`outputSchema`](../../apps/web/lib/pipeline/llm-task-contracts.ts) и [`withChecklistFallback`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts).

---

## LLM: идентичность, суммаризация, психо

### `SPEAKER_IDENTITY_MAP`

- **`data`:** `{ entries: Array<{ speakerId: string; displayName: string; role: string }> }` — в пост-обработке отбрасываются записи без пары displayName+role ([`buildSpeakerIdentityData`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts)).

### `SUMMARY_TEXT`

- **`data`:** `{ text: string }`.
- **Производитель:** `LLM_PUPPET` после подзадачи `LLM_TASK_SUMMARY` (краткий превью-текст из структуры).

### `LLM_SUMMARY`

- **`data`:** `scenario`, `subScenario`, `sections[]`, опционально `quality.notes`, `quality.doNotInfer[]` — см. [`normalizeLlmSummary`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts).

### `LLM_PSYCH_LABELS`

- **`data`:** массив элементов уровня спикера с `labels[]` и `evidence[]` (таймкоды). Правила нормализации: [`normalizePsychLabels`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts) — **элемент отбрасывается, если нет ни одной метки с кодом или нет валидного evidence**.

### `LLM_PSYCH_NARRATIVE`

- **`data`:** `interpretationPolicy: "assistive_non_diagnostic"`, `text`, `timelineEvents[]`, опционально `segmentComments[]` (режим `segmentCommentMode="per_segment"`), опционально `partial: true` если после нормализации нет событий таймлайна ([`normalizePsychNarrative`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts)); предупреждение `psych_narrative_partial_missing_timeline_events` в `quality.warnings`.
- **`segmentComments[]`:** комментарий на сегмент `READY_SPEAKERS` (`speakerId`, `startSec`, `endSec`, `summary`, опц. `tensionDelta`, `patternIds`, `confidence`); постпроцессор дозаполняет пропуски fallback-комментариями.

---

## Прочие типы

### `PSYCH_NARRATIVE`

- Используется **legacy**-веткой [`buildGenericUnionOutput`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts) для несателлитного вызова; основной путь психо LLM — `LLM_PSYCH_NARRATIVE`.

### `STRUCTURED_FEATURES`

- Зарезервирован в типах; прокидывается в контекст psych-задачи при наличии ([`buildArtifactsForLlmGateway`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts)).

### `SESSION_REPORT`

- **`data`:** [`SessionReport`](../../apps/web/types/report.types.ts) — итоговая структура для UI/PDF.
- **Производитель:** `REPORT_OUTPUT`.

---

## Пример составного конверта (сокращённо)

```json
{
  "type": "READY_SPEAKERS",
  "status": "ready",
  "version": "v1",
  "producer": { "moduleId": "SPEAKER_TURN_MERGE", "stepId": "step_merge", "runId": "run_1" },
  "quality": { "confidence": 0.9 },
  "data": [
    { "speakerId": "speaker_00", "startTime": 0, "endTime": 5.2, "text": "..." }
  ],
  "createdAt": "2026-04-18T12:00:00.000Z"
}
```

Детали интеграции LLM и пост-парса — [llm-integration.md](./llm-integration.md).
