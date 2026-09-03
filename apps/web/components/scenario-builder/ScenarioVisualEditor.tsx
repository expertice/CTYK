"use client";

import { useMemo } from "react";
import type { ArtifactTypeId } from "../../types/artifact.types";
import type { ModuleId, Scenario, ScenarioEdge, ScenarioStep, UserRole } from "../../types/pipeline.types";
import { orderedScenarioSteps } from "../../lib/scenarios/scenario-order";
import { ALL_ARTIFACT_TYPES, ALL_MODULE_IDS } from "./scenario-constants";
import { getDefaultModuleConfig } from "../../lib/pipeline/module-default-config";

export interface ScenarioVisualEditorCopy {
  sectionMeta: string;
  sectionSteps: string;
  sectionEdges: string;
  fieldId: string;
  fieldCode: string;
  fieldName: string;
  fieldDescription: string;
  fieldModule: string;
  fieldStepCode: string;
  fieldOrder: string;
  fieldStepId: string;
  fieldRequires: string;
  fieldProduces: string;
  fieldFromStep: string;
  fieldToStep: string;
  fieldArtifact: string;
  rolesLabel: string;
  addStep: string;
  addEdge: string;
  removeStep: string;
  removeEdge: string;
}

function normalizeIds(scenario: Scenario): Scenario {
  const id = scenario.id;
  return {
    ...scenario,
    steps: scenario.steps.map((s) => ({ ...s, scenarioId: id })),
    edges: scenario.edges.map((e) => ({ ...e, scenarioId: id })),
  };
}

export function ScenarioVisualEditor({
  scenario,
  onChange,
  copy,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  copy: ScenarioVisualEditorCopy;
}) {
  function patchScenario(partial: Partial<Scenario>) {
    onChange(normalizeIds({ ...scenario, ...partial } as Scenario));
  }

  function updateStep(index: number, patch: Partial<ScenarioStep>) {
    const steps = scenario.steps.map((s, i) =>
      i === index ? { ...s, ...patch, scenarioId: scenario.id } : s,
    );
    onChange(normalizeIds({ ...scenario, steps }));
  }

  function addStep() {
    const nextStepCode = (() => {
      const used = new Set(scenario.steps.map((s) => s.code));
      const nums = scenario.steps
        .map((s) => {
          const m = /^step_(\d+)$/.exec(s.code);
          return m ? Number(m[1]) : null;
        })
        .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
      let i = Math.max(1, (nums.length ? Math.max(...nums) : 0) + 1);
      while (used.has(`step_${i}`)) i++;
      return `step_${i}`;
    })();
    const st: ScenarioStep = {
      id: `step_${Date.now()}`,
      scenarioId: scenario.id,
      moduleId: "ASR",
      code: nextStepCode,
      orderHint: scenario.steps.length + 1,
      config: getDefaultModuleConfig("ASR"),
      produces: ["TEXT"],
      requires: ["AUDIO"],
    };
    onChange(normalizeIds({ ...scenario, steps: [...scenario.steps, st] }));
  }

  function removeStep(index: number) {
    const removed = scenario.steps[index];
    const steps = scenario.steps.filter((_, i) => i !== index);
    const edges = scenario.edges.filter((e) => e.fromStepId !== removed?.id && e.toStepId !== removed?.id);
    onChange(normalizeIds({ ...scenario, steps, edges }));
  }

  function addEdge() {
    const ids = scenario.steps.map((s) => s.id);
    if (ids.length < 2) return;
    const edge: ScenarioEdge = {
      id: `edge_${Date.now()}`,
      scenarioId: scenario.id,
      fromStepId: ids[0],
      toStepId: ids[1],
      artifactTypeId: "TEXT",
    };
    onChange(normalizeIds({ ...scenario, edges: [...scenario.edges, edge] }));
  }

  function updateEdge(index: number, patch: Partial<ScenarioEdge>) {
    const edges = scenario.edges.map((e, i) => (i === index ? { ...e, ...patch, scenarioId: scenario.id } : e));
    onChange(normalizeIds({ ...scenario, edges }));
  }

  function removeEdge(index: number) {
    const edges = scenario.edges.filter((_, i) => i !== index);
    onChange(normalizeIds({ ...scenario, edges }));
  }

  const stepIds = scenario.steps.map((s) => s.id);
  const stepsInPipelineOrder = useMemo(() => orderedScenarioSteps(scenario), [scenario]);

  function stepStorageIndex(stepId: string): number {
    return scenario.steps.findIndex((s) => s.id === stepId);
  }

  return (
    <div className="scenario-visual stack">
      <div className="card stack scenario-visual-section">
        <h3>{copy.sectionMeta}</h3>
        <div className="grid-2">
          <label className="field">
            {copy.fieldId}
            <input
              value={scenario.id}
              onChange={(e) => {
                const id = e.target.value;
                onChange(
                  normalizeIds({
                    ...scenario,
                    id,
                    steps: scenario.steps.map((s) => ({ ...s, scenarioId: id })),
                    edges: scenario.edges.map((ed) => ({ ...ed, scenarioId: id })),
                  }),
                );
              }}
            />
          </label>
          <label className="field">
            {copy.fieldCode}
            <input value={scenario.code} onChange={(e) => patchScenario({ code: e.target.value })} />
          </label>
        </div>
        <label className="field">
          {copy.fieldName}
          <input value={scenario.name} onChange={(e) => patchScenario({ name: e.target.value })} />
        </label>
        <label className="field">
          {copy.fieldDescription}
          <textarea
            value={scenario.description}
            onChange={(e) => patchScenario({ description: e.target.value })}
            rows={2}
            className="scenario-visual-textarea"
          />
        </label>
        <label className="field scenario-visual-roles">
          <span>{copy.rolesLabel}</span>
          <select
            multiple
            className="scenario-multi-select"
            value={scenario.allowedRoles}
            onChange={(e) => {
              const v = Array.from(e.target.selectedOptions, (o) => o.value as UserRole);
              patchScenario({ allowedRoles: v });
            }}
          >
            {(["ADMIN", "OTPB_EXPERT", "INSTRUCTOR", "VIEWER"] as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card stack scenario-visual-section">
        <div className="scenario-visual-section-head">
          <h3>{copy.sectionSteps}</h3>
          <button type="button" onClick={addStep}>
            {copy.addStep}
          </button>
        </div>
        {stepsInPipelineOrder.map((step, orderIdx) => {
          const index = stepStorageIndex(step.id);
          if (index < 0) return null;
          return (
            <div key={step.id} className="scenario-step-card">
              <div className="scenario-step-card-head">
                <strong>
                  <span className="scenario-step-order-badge">#{orderIdx + 1}</span> {step.id}
                </strong>
                <button type="button" className="button-ghost" onClick={() => removeStep(index)}>
                  {copy.removeStep}
                </button>
              </div>
              <div className="grid-2">
                <label className="field">
                  {copy.fieldStepId}
                  <input value={step.id} onChange={(e) => updateStep(index, { id: e.target.value })} />
                </label>
                <label className="field">
                  {copy.fieldModule}
                  <select
                    value={step.moduleId}
                    onChange={(e) => updateStep(index, { moduleId: e.target.value as ModuleId })}
                  >
                    {ALL_MODULE_IDS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid-2">
                <label className="field">
                  {copy.fieldStepCode}
                  <input value={step.code} onChange={(e) => updateStep(index, { code: e.target.value })} />
                </label>
                <label className="field">
                  {copy.fieldOrder}
                  <input
                    type="number"
                    value={step.orderHint}
                    onChange={(e) => updateStep(index, { orderHint: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="grid-2">
                <label className="field">
                  {copy.fieldRequires}
                  <select
                    multiple
                    className="scenario-multi-select"
                    disabled={step.moduleId === "REPORT_OUTPUT"}
                    value={step.requires}
                    onChange={(e) =>
                      updateStep(index, {
                        requires: Array.from(e.target.selectedOptions, (o) => o.value as ArtifactTypeId),
                      })
                    }
                  >
                    {ALL_ARTIFACT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {step.moduleId === "REPORT_OUTPUT" ? (
                    <span className="field-hint">У «Отчёт» входы задаются рёбрами на холсте (один порт, несколько типов).</span>
                  ) : null}
                </label>
                <label className="field">
                  {copy.fieldProduces}
                  <select
                    multiple
                    className="scenario-multi-select"
                    value={step.produces}
                    onChange={(e) =>
                      updateStep(index, {
                        produces: Array.from(e.target.selectedOptions, (o) => o.value as ArtifactTypeId),
                      })
                    }
                  >
                    {ALL_ARTIFACT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card stack scenario-visual-section">
        <div className="scenario-visual-section-head">
          <h3>{copy.sectionEdges}</h3>
          <button type="button" onClick={addEdge} disabled={stepIds.length < 2}>
            {copy.addEdge}
          </button>
        </div>
        {scenario.edges.map((edge, index) => (
          <div key={edge.id} className="scenario-edge-card">
            <div className="scenario-edge-card-head">
              <code>{edge.id}</code>
              <button type="button" className="button-ghost" onClick={() => removeEdge(index)}>
                {copy.removeEdge}
              </button>
            </div>
            <div className="grid-3 scenario-edge-grid">
              <label className="field">
                {copy.fieldFromStep}
                <select
                  value={edge.fromStepId}
                  onChange={(e) => updateEdge(index, { fromStepId: e.target.value })}
                >
                  {stepIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {copy.fieldToStep}
                <select value={edge.toStepId} onChange={(e) => updateEdge(index, { toStepId: e.target.value })}>
                  {stepIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {copy.fieldArtifact}
                <select
                  value={edge.artifactTypeId}
                  onChange={(e) => updateEdge(index, { artifactTypeId: e.target.value as ArtifactTypeId })}
                >
                  {ALL_ARTIFACT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
