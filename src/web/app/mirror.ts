import type { Statistics } from "../../domain/statistics.ts";
import {
  COVERAGE_LABELS,
  DISCLAIMER,
  EXCLUSION_LABELS,
  GUIDE,
  NOTICES,
  OUTCOME_LABELS,
  PANEL_LABELS,
  SUBMIT_NOTES,
  UNPLACED_LABELS,
} from "../copy.ts";
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

function counts(labels: Record<string, string>, values: Record<string, number>): HTMLElement {
  const shown = Object.keys(labels).filter((key) => values[key] > 0);
  return shown.length === 0 ? el("p", {}, "None.") : list(shown.map((key) => `${values[key]} ${labels[key]}`));
}

function statisticsSection(state: AppState): HTMLElement {
  const { outcome, search, sort } = state.statistics;
  const section = el("section", { "aria-label": "Statistics" }, el("h2", {}, "Statistics"));
  if (outcome === null) section.append(el("p", {}, "Loading."));
  else if (outcome.kind === "refused") section.append(el("p", { role: "alert" }, outcome.issues.map((issue) => issue.message).join(" ")));
  else if (outcome.kind === "failed") section.append(el("p", { role: "alert" }, `Couldn't load statistics: ${outcome.message}`));
  else section.append(...statisticsBody(outcome.statistics, search, sort));
  section.append(el("h3", {}, "An important note"), el("p", {}, DISCLAIMER), el("h3", {}, "About these numbers"), list(GUIDE));
  return section;
}

function statisticsBody(statistics: Statistics, search: string, sort: AppState["statistics"]["sort"]): Node[] {
  const { selection, records, items } = statistics;
  const average = items.averagePerObservation === null ? "none" : items.averagePerObservation.toFixed(2);
  const summary = el(
    "dl",
    { "data-testid": "headline" },
    el("dt", {}, "Records"),
    el("dd", {}, String(records.total)),
    el("dt", {}, "Eligible observations"),
    el("dd", {}, `${items.eligible} of ${records.total}`),
    el("dt", {}, "Items"),
    el("dd", {}, String(items.totalQuantity)),
    el("dt", {}, "Per observation"),
    el("dd", {}, average),
  );
  const rows = sortItems(
    items.byItem.filter((row) => matchesSearch(row.item, search)),
    sort,
  );
  const table = el(
    "table",
    { "data-testid": "items" },
    el("caption", {}, `Items from the ${PANEL_LABELS[items.panels]}, over ${items.eligible} eligible observations`),
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        ...["Item", "Quantity", "Per observation", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "Multiplied", "Colour unread"].map((h) =>
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
          ...(row.levels ?? Array<number | null>(8).fill(null)).map((value) => el("td", {}, value === null ? "no levels" : String(value))),
          el("td", {}, String(row.multiplied)),
          el("td", {}, String(row.multipliedUnknown)),
        ),
      ),
    ),
  );
  return [
    summary,
    table,
    el("h3", {}, "Coverage"),
    counts(COVERAGE_LABELS, records.byCoverage),
    el("h3", {}, "Left out of item counts"),
    counts(EXCLUSION_LABELS, items.excluded),
    el("h3", {}, "Couldn't be placed"),
    counts(UNPLACED_LABELS, selection.unplaced),
  ];
}

function outcomes(values: Record<string, number>): HTMLElement {
  return counts(OUTCOME_LABELS, values);
}

function submitSection(state: AppState): HTMLElement {
  const section = el("section", { "aria-label": "Submit" }, el("h2", {}, "Submit"));
  section.append(el("p", { "data-testid": "file" }, state.file ? `File: ${state.file.name}` : "No file chosen."));
  const { check, submit, status } = state;
  if (check.phase === "checking") section.append(el("p", {}, "Checking the file."));
  if (check.phase === "failed") section.append(el("p", { role: "alert" }, `Couldn't check the file: ${check.message}`));
  if (check.phase === "done") {
    const { preview } = check;
    if (!preview.ok) {
      section.append(el("h3", {}, "This file can't be used"), list(preview.issues.map((issue) => issue.message)));
    } else {
      section.append(
        el("h3", {}, "Summary"),
        el("p", { "data-testid": "preview" }, `${preview.rowCount} rows; ${preview.records.valid} valid records; ${preview.records.rejected} unusable.`),
        outcomes(preview.outcomes),
      );
      if (preview.records.valid > 0) {
        section.append(el("h3", {}, "Submitting"), list(SUBMIT_NOTES));
        if ("secret" in submit) section.append(el("p", { "data-testid": "receipt" }, `Your receipt: ${submit.secret}`));
        if (submit.step === "receipt") section.append(el("p", {}, submit.saved ? "Receipt marked as saved." : "Save your receipt, then confirm."));
        if (submit.step === "sending") section.append(el("p", {}, "Submitting."));
        if (submit.step === "retry") section.append(el("p", { role: "alert" }, `Couldn't confirm the submission (${submit.message}). It may have gone through; try again with the same receipt.`));
        if (submit.step === "refused") section.append(el("p", { role: "alert" }, `Not submitted: ${submit.message}`));
        if (submit.step === "done") {
          const message = confirmationMessage(submit.summary, submit.replayed);
          section.append(el("p", { "data-testid": "submitted" }, `${message.heading}. ${message.text}`), outcomes(submit.summary.outcomes));
        }
      }
    }
  }
  section.append(el("h3", {}, "Check or withdraw a submission"));
  const looked = status.looked?.outcome;
  if (status.checking) section.append(el("p", {}, "Checking the receipt."));
  if (looked?.kind === "found") {
    const s = looked.submission;
    section.append(
      el("p", { "data-testid": "status" }, `${s.status === "completed" ? "Active" : "Withdrawn"}; ${s.rowCount} rows; ${s.rejected} unusable records weren't stored.`),
      outcomes(s.outcomes),
    );
  }
  if (looked?.kind === "refused") section.append(el("p", { role: "alert" }, looked.issues.map((issue) => issue.message).join(" ")));
  if (looked?.kind === "failed") section.append(el("p", { role: "alert" }, `Couldn't check: ${looked.message}`));
  if (status.withdrawal.step === "uncertain") section.append(el("p", { role: "alert" }, `Couldn't confirm the withdrawal (${status.withdrawal.message}).`));
  if (status.withdrawal.step === "refused") section.append(el("p", { role: "alert" }, `Not withdrawn: ${status.withdrawal.message}`));
  return section;
}

/** Rebuilds the mirror's content for the current state. */
export function renderMirror(state: AppState, root: HTMLElement): void {
  root.replaceChildren(
    el("h1", {}, "Glyph Drop Stats"),
    el(
      "p",
      { class: "keyboard-help" },
      "Keyboard: Tab moves between controls and Enter or Space activates the focused one. F1 shows statistics, F2 submitting, F3 the filters, F4 how to read the numbers, F8 switches the CRT effect, F9 shows this text view.",
    ),
    state.view === "statistics" ? statisticsSection(state) : submitSection(state),
    el("p", {}, NOTICES),
  );
}

/** One line saying what just happened, for a live region; null when nothing new to say. */
export function announcement(previous: AppState, next: AppState): string | null {
  if (next.notice !== previous.notice && next.notice) return next.notice.text;
  if (next.view !== previous.view) return next.view === "statistics" ? "Statistics" : "Submit";
  if (next.check !== previous.check) {
    if (next.check.phase === "done") {
      const { preview } = next.check;
      return preview.ok ? `Checked: ${preview.records.valid} valid records, ${preview.records.rejected} unusable.` : "This file can't be used.";
    }
    if (next.check.phase === "failed") return "Couldn't check the file.";
  }
  if (next.submit !== previous.submit) {
    const { submit } = next;
    if (submit.step === "receipt" && previous.submit.step !== "receipt") return `Receipt created: ${submit.secret}`;
    if (submit.step === "retry") return "Couldn't confirm the submission; try again with the same receipt.";
    if (submit.step === "refused") return `Not submitted: ${submit.message}`;
    if (submit.step === "done") return confirmationMessage(submit.summary, submit.replayed).heading;
  }
  const looked = next.status.looked;
  if (looked !== previous.status.looked && looked) {
    if (looked.outcome.kind === "found") return looked.outcome.submission.status === "completed" ? "Submission found: active." : "Submission found: withdrawn.";
    return "No submission found.";
  }
  const outcome = next.statistics.outcome;
  if (outcome !== previous.statistics.outcome && outcome?.kind === "ok") {
    return `Statistics: ${outcome.statistics.records.total} records, ${outcome.statistics.items.eligible} eligible.`;
  }
  return null;
}
