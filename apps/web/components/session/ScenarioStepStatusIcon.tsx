"use client";

import type { StepRunStatus } from "../../types/pipeline.types";

function iconForStatus(status: StepRunStatus) {
  switch (status) {
    case "succeeded":
      return (
        <path
          fill="currentColor"
          d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z"
        />
      );
    case "pending":
      return (
        <>
          <circle cx="10" cy="10" r="7.5" fill="currentColor" opacity="0.22" />
          <circle cx="10" cy="10" r="2.25" fill="currentColor" />
        </>
      );
    case "running":
      return (
        <path
          fill="currentColor"
          d="M11.55 2.2L5.2 11.35H9.5l-1.75 6.45 7.05-9.35h-4.05l1.8-6.25-.03-.05z"
        />
      );
    case "awaiting_human":
      return (
        <path
          fill="currentColor"
          d="M10 10a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
        />
      );
    case "failed":
      return (
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        />
      );
    case "skipped":
      return (
        <path
          fill="currentColor"
          d="M4 4v12l9-6-9-6zm12 1.25v11.5h2.5V5.25H16z"
        />
      );
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function ScenarioStepStatusIcon(props: {
  status: StepRunStatus;
  statusLabel: string;
  detail?: string;
  errorMessage?: string;
}) {
  const { status, statusLabel, detail, errorMessage } = props;
  const d = detail?.trim();
  const e = errorMessage?.trim();
  const hasExtra = Boolean(d || e);

  return (
    <span
      className={`status-step-status-hit${hasExtra ? " status-step-status-hit--rich" : ""}`}
      tabIndex={0}
    >
      <span
        className={`status-step-icon status-step-icon--${status.replace(/_/g, "-")}`}
        role="img"
        aria-label={statusLabel}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          {iconForStatus(status)}
        </svg>
      </span>
      <span className="status-step-tooltip" role="tooltip">
        <span className="status-step-tooltip-status">{statusLabel}</span>
        {d ? <p className="status-step-tooltip-detail">{d}</p> : null}
        {e ? <p className="status-step-tooltip-error">{e}</p> : null}
      </span>
    </span>
  );
}
