# UI: конструктор сценариев и отчёт

[← К оглавлению](./README.md)

## Оглавление

1. Модель сценария (`Scenario`)  
2. Порты, универсальный вход отчёта, LLM-пульт  
3. Примеры бизнес-сценариев  
4. Сборка `SESSION_REPORT`  

## Приложение

Основной фронтенд: **Next.js** (`apps/web`), страницы сессий и конструктор — под [`apps/web/app`](../../apps/web/app), компоненты графа — [`ScenarioGraphCanvas.tsx`](../../apps/web/components/scenario-builder/ScenarioGraphCanvas.tsx).

## Что такое сценарий

Модель данных: [`Scenario`](../../apps/web/types/pipeline.types.ts):

- **`steps`** — узлы графа (`ScenarioStep`: `moduleId`, уникальный `code`, `config`, `requires`, `produces`).
- **`edges`** — связи `fromStepId` → `toStepId` с **`artifactTypeId`** (тип «провода»).

Сценарии сохраняются в локальном хранилище пользователя (каталог `.scenarios` под рабочей директорией web-приложения при разработке; см. фактические пути в репозитории).

## Шаги (модули) и отображение

Палитра модулей сгруппирована так же, как в [`module-catalog.ts`](../../apps/web/lib/pipeline/module-catalog.ts):

- **Источник:** `AUDIO_FROM_*`, `CHECKLIST_SOURCE`
- **Обработка:** `AUDIO_PREPARE` … `PSYCH_STATE`
- **Модули LLM:** `LLM_TASK_*`, `LLM_PUPPET`
- **Отчёт:** `REPORT_OUTPUT`

У каждого шага на канвасе отображаются исходящие **порты** по типам артефактов; набор портов может зависеть от [`ProcessSettings.enforceGraphModulePortsMatchProgram`](./process-settings.md).

### Универсальный вход `REPORT_OUTPUT`

При `showUniversalInputForReport === true` отчёт может принимать один из типов из [`REPORT_OUTPUT_ACCEPTED_INPUTS`](../../apps/web/lib/pipeline/report-output-inputs.ts) через специальный порт (реализация в [`ScenarioGraphCanvas`](../../apps/web/components/scenario-builder/ScenarioGraphCanvas.tsx)).

### LLM: подзадачи и пульт

Рёбра типа **`LLM_SUBTASK`** соединяют каждый `LLM_TASK_*` с единственным **`LLM_PUPPET`**. Порядок вызовов задаётся **`llmRunOrder`** в `config` шагов подзадач (уникальные числа 1…N, см. валидацию в [`validator.ts`](../../apps/web/lib/pipeline/validator.ts)).

## Бизнес-сценарии

В коде не зашиты отдельные продуктовые пакеты «только инструктаж» — сценарий полностью определяется графом. Пример заготовки: [`sampleScenario`](../../apps/web/lib/pipeline/sample-scenario.ts) («Базовое распознавание»: загрузка → подготовка → ASR → отчёт только с транскриптом).

**Реализовано фактически:** любой сценарий из доступных `ModuleId`, включая чек-лист и многошаговый LLM.

**Planned:** явный каталог «готовых сценариев» для инструктажа/планёрок как отдельные пресеты — если появятся в репозитории, их нужно будет описать отдельно (сейчас опора на пользовательские `.scenarios`).

## Как `REPORT_OUTPUT` собирает отчёт

Модуль [`ReportOutputModule`](../../apps/web/lib/pipeline/modules/report-output.module.ts) вызывает [`assembleSessionReport`](../../apps/web/lib/report/assemble-report.ts) с:

- **`sections`** — флаги `summary`, `transcript`, `psych`, `checklist` из `config.sections`;
- **`strict`** — если `true`, отсутствие нужных артефактов даёт ошибку;
- **`renderInputs`** — какие типы артефактов участвуют в рендере (чекбоксы по типам).

Сборка:

- **Транскрипт:** из сегментов (`TRANSCRIPT_SEGMENTS`, `SPEAKER_SEGMENTS`, `READY_SPEAKERS`, `DRAFT_SPEAKERS`, `ENRICHED_TRANSCRIPT`) с опциональным наложением [`SPEAKER_IDENTITY_MAP`](../../apps/web/lib/report/assemble-report.ts).
- **Психослой:** предпочтение `LLM_PSYCH_LABELS` над `PSYCH_LABELS`; текст нарратива из `LLM_PSYCH_NARRATIVE` или `PSYCH_NARRATIVE`.
- **Суммаризация:** `SUMMARY_TEXT` или текст из структуры `LLM_SUMMARY` ([`readSummaryTextFromLlmSummary`](../../apps/web/lib/report/assemble-report.ts)); сырой `TEXT` в блок резюме **не** подставляется (см. комментарий в коде).
- **Чек-лист:** из `CHECKLIST_RESULTS`.

Результат кладётся в **`SESSION_REPORT.data`** (`SessionReport`).
