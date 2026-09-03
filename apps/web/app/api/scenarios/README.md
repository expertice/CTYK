# Scenario Validation Quickstart

Use this endpoint to validate scenario DAG contracts before running a pipeline.

Endpoint:

`POST /api/scenarios/:id/validate`

Rules enforced now:

- DAG only (no cycles)
- edge artifact must be produced by source step
- required artifacts must be reachable (except root `AUDIO`)
- unique `ScenarioStep.code` inside scenario
- unreachable steps are rejected

## Valid example

```bash
curl -X POST "http://localhost:3000/api/scenarios/scenario_ok/validate" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "scenario_ok",
    "code": "ok",
    "name": "Valid Scenario",
    "description": "ASR to SUMMARY",
    "isActive": true,
    "allowedRoles": ["ADMIN"],
    "instructionTypes": ["intro"],
    "steps": [
      {
        "id": "asr",
        "scenarioId": "scenario_ok",
        "moduleId": "ASR",
        "code": "asr",
        "orderHint": 1,
        "config": {},
        "produces": ["TEXT"],
        "requires": ["AUDIO"]
      },
      {
        "id": "summary",
        "scenarioId": "scenario_ok",
        "moduleId": "SUMMARY",
        "code": "summary",
        "orderHint": 2,
        "config": {},
        "produces": ["SUMMARY_TEXT"],
        "requires": ["TEXT"]
      }
    ],
    "edges": [
      {
        "id": "e1",
        "scenarioId": "scenario_ok",
        "fromStepId": "asr",
        "toStepId": "summary",
        "artifactTypeId": "TEXT"
      }
    ]
  }'
```

Expected `200`:

```json
{
  "valid": true,
  "errors": []
}
```

## Invalid example (cycle + mismatch)

```bash
curl -X POST "http://localhost:3000/api/scenarios/scenario_bad/validate" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "scenario_bad",
    "code": "bad",
    "name": "Invalid Scenario",
    "description": "Contains graph errors",
    "isActive": true,
    "allowedRoles": ["ADMIN"],
    "instructionTypes": ["intro"],
    "steps": [
      {
        "id": "a",
        "scenarioId": "scenario_bad",
        "moduleId": "ASR",
        "code": "dup",
        "orderHint": 1,
        "config": {},
        "produces": ["TEXT"],
        "requires": ["AUDIO"]
      },
      {
        "id": "b",
        "scenarioId": "scenario_bad",
        "moduleId": "SUMMARY",
        "code": "dup",
        "orderHint": 2,
        "config": {},
        "produces": ["SUMMARY_TEXT"],
        "requires": ["TEXT"]
      }
    ],
    "edges": [
      {
        "id": "x1",
        "scenarioId": "scenario_bad",
        "fromStepId": "b",
        "toStepId": "a",
        "artifactTypeId": "SUMMARY_TEXT"
      },
      {
        "id": "x2",
        "scenarioId": "scenario_bad",
        "fromStepId": "a",
        "toStepId": "b",
        "artifactTypeId": "CHECKLIST_RESULTS"
      }
    ]
  }'
```

Expected `400` with one or more errors:

- `cycle_detected`
- `edge_artifact_mismatch`
- `duplicate_step_code`

## Notes

- `:id` in route must match payload `scenario.id`.
- Validation response is deterministic and safe to call from UI builder on every save/check.
