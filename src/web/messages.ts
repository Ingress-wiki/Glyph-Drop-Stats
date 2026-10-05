import type { SubmissionSummary } from "../domain/submission.ts";

/**
 * What the page says after a confirmation. A retry can reach a submission
 * that was withdrawn in the meantime; the server replays it as withdrawn and
 * doesn't reactivate it, and the page must not call it submitted.
 */
export function confirmationMessage(summary: SubmissionSummary, replayed: boolean): { heading: string; text: string } {
  if (summary.status === "withdrawn") {
    return { heading: "Already withdrawn", text: "This submission was already withdrawn. Retrying has not reactivated it." };
  }
  if (replayed) {
    return { heading: "Submitted", text: "This upload had already been confirmed; nothing was counted twice." };
  }
  return { heading: "Submitted", text: "Thank you." };
}
