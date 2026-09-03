import { NextResponse } from "next/server";
import type { ArtifactStore } from "../../../../types/artifact.types";
import type { Scenario } from "../../../../types/pipeline.types";
import type { RunAcceptedResponse, RunRequestBody } from "../../../../types/pipeline-api.types";
import { validateScenarioGraph } from "../../../../lib/pipeline/validator";
import { sampleScenario } from "../../../../lib/pipeline/sample-scenario";
import { normalizeScenarioIds } from "../../../../lib/scenarios/scenario-normalize";
import { buildPayloadHash, validateRunRequestBody } from "../../../../lib/pipeline/run-contract";
import { createQueuedRun } from "../../../../lib/pipeline/async-run-store";
import { enqueuePipelineJob } from "../../../../lib/queue/pipeline-queue";
import {
  parseProcessSettings,
  toNormalizeProcessSettings,
  toValidationProcessSettings,
} from "../../../../lib/pipeline/process-settings";

export async function POST(request: Request): Promise<NextResponse> {
  let bodyRaw: unknown;
  try {
    bodyRaw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = validateRunRequestBody(bodyRaw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.value;
  const process = parseProcessSettings(body.process);

  const scenarioBase = body.scenario ?? { ...sampleScenario, id: body.scenarioId ?? sampleScenario.id };
  const scenario = normalizeScenarioIds(
    applyLocalModelConfig(scenarioBase, body.localModels),
    toNormalizeProcessSettings(process),
  );

  const validation = validateScenarioGraph(scenario, toValidationProcessSettings(process));
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: "Scenario graph is invalid",
        validation,
      },
      { status: 400 },
    );
  }

  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  try {
    const payloadHash = buildPayloadHash({
      sessionId: body.sessionId,
      scenario,
      artifacts: body.artifacts ?? {},
      localModels: body.localModels,
      metadata: body.metadata ?? {},
    });
    const created = createQueuedRun({
      sessionId: body.sessionId,
      scenario,
      artifacts: body.artifacts ?? {},
      payloadHash,
      priority: body.priority ?? 5,
      idempotencyKey,
      metadata: body.metadata,
    });
    if (!created.duplicated) {
      enqueuePipelineJob({
        runId: created.run.runId,
        jobId: created.job.jobId,
        sessionId: body.sessionId,
        scenarioId: scenario.id,
        scenarioSnapshot: scenario,
        artifactsSeed: body.artifacts ?? {},
        localModels: body.localModels,
        metadata: body.metadata,
        payloadHash,
      });
    }
    const response: RunAcceptedResponse = {
      runId: created.run.runId,
      jobId: created.job.jobId,
      sessionId: body.sessionId,
      status: "queued",
      queuedAt: created.job.enqueuedAt,
    };
    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_HASH_CONFLICT") {
      return NextResponse.json(
        { error: "Idempotency conflict with different payload hash" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: "Failed to enqueue pipeline job",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

function applyLocalModelConfig(
  scenario: Scenario,
  localModels?: RunRequestBody["localModels"],
): Scenario {
  if (!localModels) {
    return scenario;
  }

  return {
    ...scenario,
    steps: scenario.steps.map((step) => {
      if (step.moduleId === "ASR") {
        return {
          ...step,
          config: {
            ...step.config,
            whisperModel: localModels.whisperModel,
            asrDevice: localModels.asrDevice,
            asrComputeType: localModels.asrComputeType,
          },
        };
      }
      if (step.moduleId === "DIARIZATION") {
        return {
          ...step,
          config: {
            ...step.config,
            diarizationModel: localModels.diarizationModel,
            localPyannoteModelPath: localModels.localPyannoteModelPath,
            diarizationMode: localModels.diarizationMode,
            diarizationMergeGapSec: localModels.diarizationMergeGapSec,
            diarizationMinTurnSec: localModels.diarizationMinTurnSec,
            diarizationDeviceMode: localModels.diarizationDeviceMode,
          },
        };
      }
      return step;
    }),
  };
}
