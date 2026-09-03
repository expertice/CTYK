# REPORT_OUTPUT: render-input спецификация

## Цель
`REPORT_OUTPUT` должен быть универсальным рендером входных артефактов.  
Пользователь в плитке модуля включает/выключает чекбоксами, какие типы попадут в итоговый `SESSION_REPORT`.

## Конфиг шага
- `config.sections` — совместимость со старыми секциями (`summary`, `transcript`, `psych`, `checklist`).
- `config.strict` — строгая проверка наличия данных.
- `config.renderInputs` — объект `Record<ArtifactTypeId, boolean>`, где:
  - ключ = тип входного артефакта, поддерживаемый `REPORT_OUTPUT`,
  - `true` = рендерить в итоговый отчет,
  - `false` = не включать в отчет.

При отсутствии `renderInputs` используется дефолт: все поддержанные входы включены.

## UI-поведение
- В плитке `REPORT_OUTPUT` показывается полный список поддержанных входов.
- Каждый пункт — чекбокс.
- Переключение чекбокса сразу пишет значение в `step.config.renderInputs`.

## Результат сборки отчета
- `assembleSessionReport` строит:
  - базовые секции (`summary`, `transcript`, `psych`, `checklist`) по `sections`,
  - `artifactSections[]` по включенным `renderInputs` и готовым (`status=ready`) артефактам.
- Для каждой `artifactSections[]` секции сохраняются:
  - `artifactType`,
  - `sourceModuleId`,
  - `title`,
  - `text`,
  - `evidence[]`.
