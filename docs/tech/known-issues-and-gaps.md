# Известные вопросы и пробелы

[← К оглавлению](./README.md)

## Оглавление

1. Каталог vs код (`LLM_PUPPET`, префиксы `LLM_`)  
2. `LLM_SUBTASK` как ребро  
3. Суммаризация и legacy-пути  
4. Провайдер и структура репозитория  

Ниже — расхождения между желаемой архитектурой и **текущим кодом**, либо ограничения, о которых полезно помнить при ревью.

## Каталог `LLM_PUPPET` vs фактические выходы

В [`PIPELINE_MODULE_CATALOG`](../../apps/web/lib/pipeline/module-catalog.ts) у `LLM_PUPPET` в `typicalProduces` перечислены в т.ч. `PSYCH_LABELS`, `PSYCH_NARRATIVE`. Фактический путь сателлитов `LLM_TASK_*` использует [`buildLlmOutputForModule`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts) и для психо пишет **`LLM_PSYCH_LABELS` / `LLM_PSYCH_NARRATIVE`**. Артефакты `PSYCH_*` без префикса `LLM_` относятся к **rule-engine** (`PSYCH_STATE`) или к legacy-ветке [`buildGenericUnionOutput`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts).

## `LLM_SUBTASK` в контракте подзадач

В [`llm-task-contracts.ts`](../../apps/web/lib/pipeline/llm-task-contracts.ts) в `outputArtifacts` указан `LLM_SUBTASK`. Физически это **тип ребра**, а не envelope в сторе ([комментарий в `artifact.types.ts`](../../apps/web/types/artifact.types.ts)). Подзадача не производит отдельный blob в `ArtifactStore` при `run`.

## Суммаризация: два артефакта

Структурированное резюме — `LLM_SUMMARY`, краткая строка для превью — `SUMMARY_TEXT`. Отдельного типа «единый LLMSUMMARY» в `ArtifactTypeId` нет; отчёт объединяет логику чтения в [`assembleSessionReport`](../../apps/web/lib/report/assemble-report.ts).

## Legacy LLM-путь

[`buildGenericUnionOutput`](../../apps/web/lib/pipeline/modules/llm-engine.module.ts) пишет `PSYCH_LABELS`/`PSYCH_NARRATIVE` для сценариев без контрактного `LlmTaskContract` — при рефакторинге стоит не смешивать с каноническим `LLM_TASK_PSYCH`.

## Провайдер LLM

Клиент собирается под **OpenAI-compatible** HTTP API (`llmBaseUrl` на пульте). Прямые SDK облаков в типах [`LlmProvider`](../../apps/web/lib/ai/llm-engine.ts) зарезервированы; фактическая интеграция — через [`resolveLlmProviderClient`](../../apps/web/lib/ai/provider-factory.ts) (см. код).

## Проверка отчёта без универсального входа

Если `showUniversalInputForReport` выключен, валидация входов `REPORT_OUTPUT` в [`validateScenarioGraph`](../../apps/web/lib/pipeline/validator.ts) ведёт себя иначе — граф можно собрать «вручную», но UX/ошибки могут отличаться.

## Монорепозиторий

В корне может отсутствовать один общий `package.json`; основное приложение — [`apps/web/package.json`](../../apps/web/package.json). Документация по путям относится к структуре **текущего** репозитория.
