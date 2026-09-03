# Словарь комбинаций метрик для full_psycho_analytics

## Назначение

Машинно-читаемый перечень пар метрик лежит рядом: **`psych_full_metric_combinations.v1.json`**.  
LLM в режиме `full_psycho_analytics` должна ссылаться на **`combinationId`** из этого файла в полях `evidence[].combinationId` (и указывать **две метрики** из соответствующей пары в `evidence[].metrics`).

Подробные текстовые таблицы (как во внешнем документе «librosa metric combinations») можно держать отдельно; в пайплайн ENRICHED сейчас попадают **только** поля из `ProsodyEnrichedSegment` (см. `apps/web/lib/local-models/model-manager.ts`). Метрики вроде MFCC/chroma/`speakerTurnDuration` в сегменте **нет** — их нельзя требовать в evidence до расширения обогащения.

## Соответствие имён из внешних документов

| В документации | В ENRICHED / JSON |
|----------------|-------------------|
| `spectralRolloffHz` | `spectralRolloffMeanHz` |
| `centroid` (кратко) | `spectralCentroidMeanHz` |

## Обновление

1. Править **`psych_full_metric_combinations.v1.json`** (версия в поле `version`).
2. При добавлении новых метрик в prosody — расширить `supportedMetricKeys` и массив `combinations` (все новые пары или только релевантные).
