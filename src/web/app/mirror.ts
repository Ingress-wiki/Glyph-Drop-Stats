import type { Statistics } from "../../domain/statistics.ts";
import type { Messages } from "../i18n/en.ts";
import { issuesText, issueText, messages, problemText } from "../i18n/index.ts";
import { matchesSearch } from "../items.ts";
import { sortItems } from "../itemTable.ts";
import { confirmationMessage } from "../messages.ts";
import type { AppState } from "./store.ts";

/**
 * The canvas has no text a screen reader or the browser's find can use, so
 * the same state is kept here as plain HTML: visually hidden while the
 * canvas works, shown in its place when it can't be drawn. It is built
 * with `textContent` only, so nothing a file or server says becomes markup.
 */

type Child = Node | string | null | false;

function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) {
    if (child === null || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const list = (items: readonly string[]) => el("ul", {}, ...items.map((item) => el("li", {}, item)));

function counts(s: Messages, labels: Record<string, string>, values: Record<string, number>): HTMLElement {
  const shown = Object.keys(labels).filter((key) => values[key] > 0);
  return shown.length === 0 ? el("p", {}, s.stats.noneMirror) : list(shown.map((key) => `${values[key]} ${labels[key]}`));
}

function statisticsSection(s: Messages, state: AppState): HTMLElement {
  const { outcome, search, sort } = state.statistics;
  const section = el("section", { "aria-label": s.app.statistics }, el("h2", {}, s.app.statistics));
  if (outcome === null) section.append(el("p", {}, s.stats.loading));
  else if (outcome.kind === "refused") section.append(el("p", { role: "alert" }, issuesText(s, outcome.issues)));
  else if (outcome.kind === "failed") section.append(el("p", { role: "alert" }, s.stats.loadFailed(problemText(s, outcome.problem))));
  else section.append(...statisticsBody(s, outcome.statistics, search, sort));
  section.append(el("h3", {}, s.disclaimer.title), el("p", {}, s.disclaimer.text), el("h3", {}, s.guide.title), list(s.guide.points));
  return section;
}

function statisticsBody(s: Messages, statistics: Statistics, search: string, sort: AppState["statistics"]["sort"]): Node[] {
  const { selection, records, items } = statistics;
  const headline = s.stats.mirrorHeadline;
  const average = items.averagePerObservation === null ? s.stats.averageNone : items.averagePerObservation.toFixed(2);
  const summary = el(
    "dl",
    { "data-testid": "headline" },
    el("dt", {}, headline.records),
    el("dd", {}, String(records.total)),
    el("dt", {}, headline.eligible),
    el("dd", {}, s.stats.headline.eligibleValue(items.eligible, records.total)),
    el("dt", {}, headline.items),
    el("dd", {}, String(items.totalQuantity)),
    el("dt", {}, headline.perObservation),
    el("dd", {}, average),
  );
  const rows = sortItems(
    items.byItem.filter((row) => matchesSearch(row.item, search, s.stats.categories)),
    sort,
  );
  const columns = s.stats.mirrorColumns;
  const levels = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
  const table = el(
    "table",
    { "data-testid": "items" },
    el("caption", {}, s.stats.mirrorCaption(s.panels[items.panels], items.eligible)),
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        ...[columns.item, columns.quantity, columns.perObservation, ...levels, columns.multiplied, columns.colourUnread].map((h) =>
          el("th", { scope: "col" }, h),
        ),
      ),
    ),
    el(
      "tbody",
      {},
      ...rows.map((row) =>
        el(
          "tr",
          {},
          el("th", { scope: "row" }, row.item),
          el("td", {}, String(row.quantity)),
          el("td", {}, row.averagePerObservation.toFixed(2)),
          ...(row.levels ?? Array<number | null>(8).fill(null)).map((value) => el("td", {}, value === null ? s.stats.noLevels : String(value))),
          el("td", {}, String(row.multiplied)),
          el("td", {}, String(row.multipliedUnknown)),
        ),
      ),
    ),
  );
  return [
    summary,
    table,
    el("h3", {}, s.stats.breakdowns.coverage),
    counts(s, s.coverage, records.byCoverage),
    el("h3", {}, s.stats.breakdowns.leftOut),
    counts(s, s.exclusions, items.excluded),
    el("h3", {}, s.stats.breakdowns.unplaced),
    counts(s, s.unplaced, selection.unplaced),
  ];
}

function submitSection(s: Messages, state: AppState): HTMLElement {
  const section = el("section", { "aria-label": s.app.submit }, el("h2", {}, s.app.submit));
  section.append(el("p", { "data-testid": "file" }, state.file ? s.submit.fileName(state.file.name) : s.submit.noFileMirror));
  const { check, submit, status } = state;
  if (check.phase === "checking") section.append(el("p", {}, s.submit.checking));
  if (check.phase === "failed") section.append(el("p", { role: "alert" }, s.submit.checkFailed(problemText(s, check.problem))));
  if (check.phase === "done") {
    const { preview } = check;
    if (!preview.ok) {
      section.append(el("h3", {}, s.submit.cantUse), list(preview.issues.map((issue) => issueText(s, issue))));
    } else {
      section.append(
        el("h3", {}, s.submit.summary),
        el("p", { "data-testid": "preview" }, s.submit.previewMirror(preview.rowCount, preview.records.valid, preview.records.rejected)),
        counts(s, s.outcomes, preview.outcomes),
      );
      if (preview.records.valid > 0) {
        section.append(el("h3", {}, s.submit.heading));
        if (state.submissionsOpen === false && submit.step === "explain") section.append(el("p", { "data-testid": "closed" }, s.submit.closed));
        else section.append(list(s.submit.notes));
        if ("secret" in submit) section.append(el("p", { "data-testid": "receipt" }, s.submit.receiptMirror(submit.secret)));
        if (submit.step === "receipt") section.append(el("p", {}, s.submit.savedMirror(submit.saved)));
        if (submit.step === "sending") section.append(el("p", {}, s.submit.sending));
        if (submit.step === "retry") section.append(el("p", { role: "alert" }, s.submit.sendFailed(problemText(s, submit.problem))));
        if (submit.step === "refused") section.append(el("p", { role: "alert" }, s.submit.refused(issuesText(s, submit.issues))));
        if (submit.step === "done") {
          const message = confirmationMessage(s, submit.summary, submit.replayed);
          section.append(el("p", { "data-testid": "submitted" }, `${message.heading}. ${message.text}`), counts(s, s.outcomes, submit.summary.outcomes));
        }
      }
    }
  }
  section.append(el("h3", {}, s.status.heading));
  const looked = status.looked?.outcome;
  if (status.checking) section.append(el("p", {}, s.status.checking));
  if (looked?.kind === "found") {
    const found = looked.submission;
    section.append(
      el("p", { "data-testid": "status" }, s.status.mirrorLine(found.status === "completed", found.rowCount, found.rejected)),
      counts(s, s.outcomes, found.outcomes),
    );
  }
  if (looked?.kind === "refused") section.append(el("p", { role: "alert" }, issuesText(s, looked.issues)));
  if (looked?.kind === "failed") section.append(el("p", { role: "alert" }, s.status.failed(problemText(s, looked.problem))));
  const { withdrawal } = status;
  if (withdrawal.step === "uncertain") section.append(el("p", { role: "alert" }, s.withdraw.failed(problemText(s, withdrawal.problem))));
  if (withdrawal.step === "refused") section.append(el("p", { role: "alert" }, s.status.notWithdrawn(issuesText(s, withdrawal.issues))));
  return section;
}

/** Rebuilds the mirror's content for the current state. */
export function renderMirror(state: AppState, root: HTMLElement): void {
  const s = messages(state.locale);
  root.replaceChildren(
    el("h1", {}, s.app.title),
    el("p", { class: "keyboard-help" }, s.app.keyboardHelp),
    state.view === "statistics" ? statisticsSection(s, state) : submitSection(s, state),
    el("p", {}, s.notices),
  );
}

/** One line saying what just happened, for a live region; null when nothing new to say. */
export function announcement(previous: AppState, next: AppState): string | null {
  const s = messages(next.locale);
  if (next.locale !== previous.locale) return s.language.name;
  if (next.notice !== previous.notice && next.notice) return s.notice[next.notice.id];
  if (next.view !== previous.view) return next.view === "statistics" ? s.app.statistics : s.app.submit;
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
