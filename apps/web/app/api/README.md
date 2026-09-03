# Transcribator API Quickstart

Minimal manual flow for local smoke testing:

1. Start pipeline run
2. Poll session status
3. Fetch final report

## 1) Start run

Endpoint:

`POST /api/pipeline/run`

Minimal request (uses built-in sample scenario):

```bash
curl -X POST "http://localhost:3000/api/pipeline/run" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session_demo_1",
    "artifacts": {
      "AUDIO": {
        "type": "AUDIO",
        "status": "ready",
        "version": "v1",
        "producer": {
          "moduleId": "ASR",
          "stepId": "seed",
          "runId": "seed"
        },
        "quality": {},
        "url": "file:///tmp/demo.mp3",
        "createdAt": "2026-03-30T00:00:00.000Z"
      }
    }
  }'
```

Expected `200` response:

```json
{
  "runId": "run_xxx",
  "status": "succeeded",
  "stepCount": 5,
  "message": "Pipeline run completed"
}
```

## 2) Check status

Endpoint:

`GET /api/sessions/:id/status`

Example:

```bash
curl "http://localhost:3000/api/sessions/session_demo_1/status"
```

Expected `200` response:

```json
{
  "runId": "run_xxx",
  "status": "succeeded",
  "progress": 100,
  "currentStepIds": [],
  "steps": []
}
```

Possible errors:

- `404` when no run is found for this session id

## 3) Get report

Endpoint:

`GET /api/sessions/:id/report`

Example:

```bash
curl "http://localhost:3000/api/sessions/session_demo_1/report"
```

Expected `200` response:

```json
{
  "sessionId": "session_demo_1",
  "generatedAt": "2026-03-30T00:00:00.000Z",
  "interpretationPolicy": "assistive_non_diagnostic",
  "checklistResults": [],
  "transcript": [],
  "psychStateSummary": {
    "labels": [],
    "narrative": {
      "text": "Psych narrative is not available yet",
      "evidence": []
    }
  },
  "summary": {
    "text": "Summary is not available yet",
    "evidence": []
  }
}
```

Possible errors:

- `404` when no run is found
- `409` when run exists but report is not ready yet

## Notes

- Current run and status storage is in-memory only.
- Server restart resets run history.
- This is intentional for initial iteration speed; persistent storage should be added next.
