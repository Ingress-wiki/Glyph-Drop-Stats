import type { SubmissionSummary } from "../domain/submission.ts";
import type { Messages } from "./i18n/en.ts";

/**
 * What the page says after a confirmation. A retry can reach a submission
 * that was withdrawn in the meantime; the server replays it as withdrawn and
 * doesn't reactivate it, and the page must not call it submitted.
 */
export function confirmationMessage(
  s: Messages,
  summary: SubmissionSummary,
  replayed: boolean,
): { heading: string; text: string } {
  if (summary.status === "withdrawn") return { heading: s.submit.alreadyWithdrawn, text: s.submit.alreadyWithdrawnText };
  return { heading: s.submit.submitted, text: replayed ? s.submit.replayedText : s.submit.submittedText };
}
