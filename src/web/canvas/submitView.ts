import type { Context } from "@synth-ui/core";
import { textField, useTheme } from "@synth-ui/widgets";
import type { Preview } from "../../domain/preview.ts";
import { isReceiptSecret } from "../../domain/receipt.ts";
import type { SubmissionSummary } from "../../domain/submission.ts";
import type { Outcome } from "../../domain/versions.ts";
import type { Store } from "../app/store.ts";
import type { Messages } from "../i18n/en.ts";
import { issuesText, issueText, problemText, type Locale } from "../i18n/index.ts";
import { confirmationMessage } from "../messages.ts";
import { COLORS, FONT } from "./theme.ts";
import {
  actionButton,
  announceField,
  buttonHeight,
  buttonWidth,
  bullets,
  errorLine,
  heading,
  keyValue,
  lineHeight,
  paragraph,
  selectableText,
  toggle,
} from "./ui.ts";

/** Outcomes held back from the statistics until someone reviews them. */
export const HELD: ReadonlySet<Outcome> = new Set(["update_candidate", "conflict"]);

export interface SubmitEnv {
  /** Opens the browser's file picker; the chosen file arrives through `store.chooseFile`. */
  openFilePicker(): void;
}

/** The submit view's width: a readable column, centred. */
const COLUMN_W = 380;

export function drawSubmit(ctx: Context, store: Store, env: SubmitEnv): void {
  const s = store.strings;
  const pad = Math.floor((ctx.bounds.w - Math.min(ctx.bounds.w, COLUMN_W)) / 2);
  ctx.inset(pad, 0, pad, 0);
  ctx.column({ gap: 4 }, (col) => {
    paragraph(col, s.submit.lede, { color: COLORS.ash });
    col.place({ w: 0, h: 6 });
    checkSection(col, store, s, env);
    const { check } = store.state;
    if (check.phase === "failed") errorLine(col, s.submit.checkFailed(problemText(s, check.problem)));
    if (check.phase === "done") {
      previewSection(col, s, check.preview);
      if (check.preview.ok && check.preview.records.valid > 0) submitSection(col, store, s, check.preview.records.valid);
    }
    statusSection(col, store, s);
  });
}

function checkSection(ctx: Context, store: Store, s: Messages, env: SubmitEnv): void {
  const { colors: c } = useTheme(ctx);
  heading(ctx, s.submit.checkHeading);
  const { file, check } = store.state;
  ctx.row({ gap: 4, h: buttonHeight(ctx) }, (row) => {
    if (actionButton(row, { key: "choose", label: s.submit.chooseFile, hint: s.submit.chooseFileHint })) env.openFilePicker();
    const checking = check.phase === "checking";
    const label = checking ? s.submit.checking : s.submit.checkFile;
    if (actionButton(row, { key: "check", label, disabled: !file || checking, on: Boolean(file) && check.phase === "idle" })) {
      void store.checkFile();
    }
  });
  paragraph(ctx, file ? file.name : s.submit.noFile, { color: file ? c.paper : c.muted });
  ctx.place({ w: 0, h: 4 });
}

function outcomeRows(ctx: Context, s: Messages, outcomes: Record<Outcome, number>): void {
  const { colors: c } = useTheme(ctx);
  const mixedH = lineHeight(ctx, FONT.mixed);
  const smallH = lineHeight(ctx, FONT.small);
  for (const outcome of Object.keys(s.outcomes) as Outcome[]) {
    const n = outcomes[outcome];
    if (n === 0) continue;
    const r = ctx.place({ w: ctx.bounds.w, h: mixedH + 2 });
    const count = String(n);
    ctx.text(count, r.x + 24 - ctx.measureText(count, { font: FONT.mixed }), r.y, { color: c.paper, font: FONT.mixed });
    const end = ctx.text(s.outcomes[outcome], r.x + 30, r.y, { color: c.text, font: FONT.mixed });
    if (HELD.has(outcome)) {
      const tag = s.heldForReview;
      const tw = ctx.measureText(tag, { font: FONT.small });
      const ty = r.y + Math.floor((mixedH - smallH) / 2);
      ctx.strokeRect({ x: end + 4, y: ty - 2, w: tw + 5, h: smallH + 3 }, c.accent);
      ctx.text(tag, end + 7, ty, { color: c.accent, font: FONT.small });
    }
  }
}

function previewSection(ctx: Context, s: Messages, preview: Preview): void {
  if (!preview.ok) {
    heading(ctx, s.submit.cantUse);
    for (const issue of preview.issues) errorLine(ctx, issueText(s, issue));
    ctx.place({ w: 0, h: 4 });
    return;
  }
  const { records } = preview;
  heading(ctx, s.submit.summary);
  keyValue(ctx, s.submit.rows, String(preview.rowCount));
  keyValue(ctx, s.submit.validRecords, s.submit.validValue(records.valid, records.byKind.hack, records.byKind.drop));
  keyValue(
    ctx,
    s.submit.gearRead,
    s.submit.gearReadValue(records.byReadStatus.read, records.partlyRead, records.byReadStatus.notRead, records.byReadStatus.unavailable),
  );
  keyValue(ctx, s.submit.unusable, String(records.rejected));
  keyValue(
    ctx,
    s.submit.exportedBy,
    s.submit.exportedByValue(preview.exporter.appVersion ?? "?", preview.exporter.appBuild ?? "?", preview.formatVersion),
  );
  const label = ctx.place({ w: ctx.bounds.w, h: lineHeight(ctx, FONT.small) + 2 });
  ctx.text(s.submit.compared, label.x, label.y + 1, { color: COLORS.muted, font: FONT.small });
  outcomeRows(ctx, s, preview.outcomes);
  for (const warning of preview.warnings) paragraph(ctx, issueText(s, warning), { color: COLORS.flame });
  if (preview.rejected.length > 0) {
    ctx.place({ w: 0, h: 4 });
    heading(ctx, s.submit.unusableHeading, String(preview.rejected.length));
    const shown = preview.rejected.slice(0, 40);
    for (const rejected of shown) {
      paragraph(ctx, s.submit.rejectedRecord(rejected.recordId, rejected.lines.join(", ")), { color: COLORS.paper });
      for (const issue of rejected.issues) paragraph(ctx, issueText(s, { ...issue, line: undefined }), { color: COLORS.ash, indent: 8 });
    }
    if (preview.rejected.length > shown.length) paragraph(ctx, s.submit.more(preview.rejected.length - shown.length), { color: COLORS.muted });
  }
  ctx.place({ w: 0, h: 6 });
}

function receiptBox(ctx: Context, store: Store, s: Messages, secret: string): void {
  const { colors: c } = useTheme(ctx);
  const top = ctx.cursor.y;
  ctx.column({ gap: 4 }, (box) => {
    box.inset(5, 5, 5, 5);
    paragraph(box, s.submit.receiptHeading, { font: FONT.caps, color: c.paper });
    // Receipts are case-sensitive ASCII; every language's text face draws ASCII in exact case.
    selectableText(box, { key: "receipt:text", label: s.submit.yourReceipt, text: secret, color: c.flame });
    box.row({ gap: 4, h: buttonHeight(box) }, (row) => {
      if (actionButton(row, { key: "receipt:download", label: s.submit.download, hint: s.submit.downloadHint })) store.downloadReceipt();
      if (actionButton(row, { key: "receipt:copy", label: s.submit.copy, hint: s.submit.copyHint })) void store.copyReceipt();
    });
    box.place({ w: 0, h: 1 });
  });
  const box = { x: ctx.bounds.x, y: top, w: ctx.bounds.w, h: ctx.cursor.y - top };
  ctx.strokeRect(box, c.accent);
  ctx.place({ w: 0, h: 4 });
}

function submitSection(ctx: Context, store: Store, s: Messages, valid: number): void {
  const { submit } = store.state;
  if (submit.step === "done") {
    const message = confirmationMessage(s, submit.summary, submit.replayed);
    heading(ctx, message.heading);
    paragraph(ctx, message.text);
    outcomeRows(ctx, s, submit.summary.outcomes);
    ctx.place({ w: 0, h: 4 });
    receiptBox(ctx, store, s, submit.secret);
    return;
  }
  heading(ctx, s.submit.heading);
  bullets(ctx, s.submit.notes);
  ctx.place({ w: 0, h: 4 });
  if (submit.step === "explain") {
    if (actionButton(ctx, { key: "receipt:create", label: s.submit.createReceipt, on: true })) store.createReceipt();
    return;
  }
  if (submit.step === "refused") {
    errorLine(ctx, s.submit.refused(issuesText(s, submit.issues)));
    return;
  }
  receiptBox(ctx, store, s, submit.secret);
  if (submit.step === "receipt") {
    if (toggle(ctx, { key: "receipt:saved", label: s.submit.saved, checked: submit.saved })) store.setSaved(!submit.saved);
    ctx.place({ w: 0, h: 2 });
    if (actionButton(ctx, { key: "submit:send", label: s.submit.send(valid), disabled: !submit.saved, on: submit.saved })) void store.send();
  }
  if (submit.step === "sending") paragraph(ctx, s.submit.sending, { color: COLORS.ash });
  if (submit.step === "retry") {
    errorLine(ctx, s.submit.sendFailed(problemText(s, submit.problem)));
    if (actionButton(ctx, { key: "submit:retry", label: s.submit.retry, on: true })) void store.send();
  }
  ctx.place({ w: 0, h: 6 });
}

function summaryLine(s: Messages, locale: Locale, summary: SubmissionSummary): string {
  const when = (seconds: number) => new Date(seconds * 1000).toLocaleString(locale);
  const state = summary.withdrawnAt === null ? s.status.active : s.status.withdrawnAt(when(summary.withdrawnAt));
  return s.status.line(state, when(summary.createdAt), summary.rowCount, summary.rejected);
}

function statusSection(ctx: Context, store: Store, s: Messages): void {
  const { status } = store.state;
  heading(ctx, s.status.heading);
  const busy = status.withdrawal.step === "sending";
  const fieldH = lineHeight(ctx, FONT.mixed) + 4;
  ctx.row({ gap: 4, h: Math.max(fieldH, buttonHeight(ctx)) }, (row) => {
    // The receipt is stored on every keystroke, so a pending lookup is cancelled as soon as it
    // changes; the field then never sees a "new" text to commit, so Enter is taken here.
    const seen = row.state(() => ({ focused: false }), { key: "status:receipt:focus" });
    const enter = seen.focused && row.takeKey("Enter");
    const checkW = buttonWidth(row, s.status.check);
    const field = textField(
      row,
      { key: "status:receipt", value: status.input, placeholder: s.status.placeholder, font: FONT.mixed, w: Math.max(row.bounds.w - checkW - 4, 60), hint: s.status.hint },
    );
    seen.focused = field.it.focused;
    if (field.it.focused) announceField(s.a11y.receiptField);
    if (!busy && field.changed) store.setStatusInput(field.text);
    if (!busy && enter && isReceiptSecret(field.text.trim())) void store.lookup();
    if (actionButton(row, { key: "status:check", label: s.status.check, disabled: busy || status.checking || !isReceiptSecret(status.input.trim()) })) {
      void store.lookup();
    }
  });
  ctx.place({ w: 0, h: 2 });
  if (status.checking) paragraph(ctx, s.status.checking, { color: COLORS.ash });
  const outcome = status.looked?.outcome;
  if (outcome?.kind === "found") {
    paragraph(ctx, summaryLine(s, store.state.locale, outcome.submission));
    outcomeRows(ctx, s, outcome.submission.outcomes);
    ctx.place({ w: 0, h: 4 });
    if (outcome.submission.status === "completed") {
      const { withdrawal } = status;
      if (withdrawal.step === "idle" && actionButton(ctx, { key: "withdraw:start", label: s.status.withdraw })) store.startWithdraw();
      if (withdrawal.step === "sending") paragraph(ctx, s.status.withdrawing, { color: COLORS.ash });
      if (withdrawal.step === "refused") errorLine(ctx, s.status.notWithdrawn(issuesText(s, withdrawal.issues)));
    }
  }
  if (outcome?.kind === "refused") errorLine(ctx, issuesText(s, outcome.issues));
  if (outcome?.kind === "failed") errorLine(ctx, s.status.failed(problemText(s, outcome.problem)));
  ctx.place({ w: 0, h: 8 });
}
