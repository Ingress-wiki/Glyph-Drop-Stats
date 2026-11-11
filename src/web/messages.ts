import type { SubmissionSummary } from "../domain/submission.ts";
import type { AccountMessage } from "./app/store.ts";
import type { Messages } from "./i18n/en.ts";
import { issuesText, problemText } from "./i18n/index.ts";

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

/** How the last account task ended, in words; null when there is nothing to say. */
export function accountMessageText(s: Messages, message: AccountMessage | null): string | null {
  if (!message) return null;
  switch (message.kind) {
    case "done":
      return s.account.done[message.task];
    case "refused":
      return issuesText(s, message.issues);
    case "failed":
      return s.account.failed(problemText(s, message.problem));
    case "cancelled":
      return s.account.cancelled;
    case "unsupported":
      return s.account.unsupported;
  }
}
