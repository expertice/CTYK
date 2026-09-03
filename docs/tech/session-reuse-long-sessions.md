# Переиспользование сессии («Повторить») и длинные записи

## Повторить (RDY / ENR / PSY)

- Кнопка **«Повторить»** на странице статуса (при `failed` / `paused`) и в навигации отчёта, если `GET /api/sessions/:id/reuse-pack` возвращает 200.
- Эндпоинт собирает `scenarioSnapshot` последнего рана и подмножество артефактов **без выходов LLM и отчёта**, при условии `READY_SPEAKERS.status === ready`.
- Клиент открывает `/sessions/new?reuseFrom=<sessionId>`: подставляется сценарий родителя (важно для совпадения `producer.stepId` и `canSkipStep` у `SPEAKER_DRAFT_EDIT`), в `POST /api/pipeline/run` уходит полный сид + `metadata.reuseFromSession`.
- Плитки источника аудио, `AUDIO_PREPARE`, `ASR`, `DIARIZATION`, слияние и правка спикеров неактивны при полной цепочке до RDY; `PSYCH_STATE` — при готовых ENR и PSY.

## Длинные записи (> 10 мин)

- Порог: **600 с** длительности из `AUDIO_PREPARED` (подсказка в пакете reuse и баннер на форме новой сессии).
- Для шага `LLM_PUPPET` применяется `applyLongSessionLlmDefaults`: минимум **240 с** таймаута (до clamp **600 с**), `optimizeForSmallContext: true`, пресет `strong` приводится к `medium`.
- Компакция промпта: существующая логика для `psych_state`; для `summary` / `checklist_analysis` / `speaker_names` при `optimizeForSmallContext` — усечение `READY_SPEAKERS` по `maxReadySegmentsForLlm` (пресеты weak/medium/strong), на ретраях — адаптивное снижение лимита.
- В логах: `[ctyk.llm]` с `promptChars` и контекстом trace; таймауты включают `stepId`, `task`, `module`.
