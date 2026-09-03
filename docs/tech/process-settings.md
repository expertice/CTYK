# ProcessSettings

[← К оглавлению](./README.md)

## Оглавление

1. Поля и значения по умолчанию  
2. Таблица применения флагов  
3. Связь с запуском сессии  

Настройки процесса хранятся в **глобальных настройках** клиента (`GlobalSettings.process`) и парсятся функцией [`parseProcessSettings`](../../apps/web/lib/pipeline/process-settings.ts). Тип:

```ts
export interface ProcessSettings {
  enforceGraphModulePortsMatchProgram: boolean;
  enforceEdgeTypeCompatibility: boolean;
  showUniversalInputForReport: boolean;
}
```

Дефолты: все три **`true`** ([`DEFAULT_PROCESS_SETTINGS`](../../apps/web/lib/pipeline/process-settings.ts)).

## Где применяются

| Флаг | Нормализация сценария | Валидация графа | Конструктор (порты/рёбра) |
|------|------------------------|-----------------|---------------------------|
| `enforceGraphModulePortsMatchProgram` | [`toNormalizeProcessSettings`](../../apps/web/lib/pipeline/process-settings.ts) → [`normalizeScenarioIds`](../../apps/web/lib/scenarios/scenario-normalize.ts) и др. | — | [`ScenarioGraphCanvas`](../../apps/web/components/scenario-builder/ScenarioGraphCanvas.tsx): список исходящих портов шага |
| `enforceEdgeTypeCompatibility` | — | [`validateScenarioGraph`](../../apps/web/lib/pipeline/validator.ts): ребро vs `step.produces` | — |
| `showUniversalInputForReport` | — | `validateScenarioGraph`: для `REPORT_OUTPUT` — проверка входящих рёбер | Универсальный вход отчёта (`REPORT_IN_PORT`), подключение без жёсткой привязки к объявленным `produces` предыдущего шага |

### Поведение

- **`enforceGraphModulePortsMatchProgram`** — если включён, набор «выходных портов» узла в UI согласован с тем, что программа считает допустимым выходом модуля (иначе конструктор может показывать расширенный набор портов — зависит от реализации `getScenarioOutputPorts`).

- **`enforceEdgeTypeCompatibility`** — при `true` валидатор требует, чтобы `edge.artifactTypeId` входил в `fromStep.produces`. При `false` такие несоответствия не считаются ошибкой (удобно при черновых сценариях или несинхронизированных `produces`).

- **`showUniversalInputForReport`** — при `true` для модуля `REPORT_OUTPUT` включается отдельная логика: можно подключить любой допустимый тип из [`REPORT_OUTPUT_ACCEPTED_INPUTS`](../../apps/web/lib/pipeline/report-output-inputs.ts) через универсальный вход; валидатор проверяет, что хотя бы одно входящее ребро ведёт на отчёт и тип разрешён. При `false` проверка отчёта по входам для валидатора ослабляется (см. ветку `showUniversalInputForReport` в [`validator.ts`](../../apps/web/lib/pipeline/validator.ts)).

## Связь с запуском пайплайна

На странице новой сессии [`apps/web/app/sessions/new/page.tsx`](../../apps/web/app/sessions/new/page.tsx) процесс-настройки читаются из глобальных настроек и передаются в нормализацию сценария и в `validateScenarioGraph` через [`toNormalizeProcessSettings`](../../apps/web/lib/pipeline/process-settings.ts) / [`toValidationProcessSettings`](../../apps/web/lib/pipeline/process-settings.ts).
