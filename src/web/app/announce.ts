import type { Messages } from "../i18n/en.ts";
import { issuesText, messages } from "../i18n/index.ts";
import { accountMessageText, confirmationMessage } from "../messages.ts";
import type { AppState, View } from "./store.ts";

/** A view's name, as its tab and announcements say it. */
export function viewName(s: Messages, view: View): string {
  return { statistics: s.app.statistics, submit: s.app.submit, agents: s.app.agents, account: s.app.account }[view];
}

/** One line saying what just happened, for a live region; null when nothing new to say. */
export function announcement(previous: AppState, next: AppState): string | null {
  const s = messages(next.locale);
  if (next.locale !== previous.locale) return s.language.name;
  if (next.notice !== previous.notice && next.notice) return s.notice[next.notice.id];
  if (next.view !== previous.view) return viewName(s, next.view);
  if (next.account.message !== previous.account.message) {
    const text = accountMessageText(s, next.account.message);
    if (text) return text;
  }
  if (next.check !== previous.check) {
    if (next.check.phase === "done") {
      const { preview } = next.check;
      return preview.ok ? s.announce.checked(preview.records.valid, preview.records.rejected) : s.announce.cantUse;
    }
    if (next.check.phase === "failed") return s.announce.checkFailed;
  }
  if (next.submit !== previous.submit) {
    const { submit } = next;
    if (submit.step === "receipt" && previous.submit.step !== "receipt") return s.announce.receiptCreated(submit.secret);
    if (submit.step === "retry") return s.announce.retry;
    if (submit.step === "refused") return s.submit.refused(issuesText(s, submit.issues));
    if (submit.step === "done") return confirmationMessage(s, submit.summary, submit.replayed).heading;
  }
  const looked = next.status.looked;
  if (looked !== previous.status.looked && looked) {
    if (looked.outcome.kind === "found") return s.announce.found(looked.outcome.submission.status === "completed");
    return s.announce.notFound;
  }
  const outcome = next.statistics.outcome;
  if (outcome !== previous.statistics.outcome && outcome?.kind === "ok") {
    return s.announce.statistics(outcome.statistics.records.total, outcome.statistics.items.eligible);
  }
  return null;
}
