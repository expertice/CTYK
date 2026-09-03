import type { UserRole } from "./pipeline.types";

export type FeedbackTargetType = "checklist_item" | "psych_label" | "summary_span" | "transcript_segment";
export type FeedbackResolution = "open" | "accepted" | "rejected" | "fixed";
export type FeedbackReasonCode =
  | "wrong_label"
  | "missing_evidence"
  | "bad_transcript"
  | "unsafe_statement"
  | "other";

export interface SessionFeedback {
  id: string;
  sessionId: string;
  runId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  sourceStepId: string;
  role: UserRole;
  reasonCode: FeedbackReasonCode;
  comment?: string;
  proposedValue?: unknown;
  createdAt: string;
  resolution: FeedbackResolution;
  resolvedAt?: string;
  resolvedBy?: string;
}
