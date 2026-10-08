import type { Context } from "@synth-ui/core";
import { textField, useTheme } from "@synth-ui/widgets";
import type { Preview } from "../../domain/preview.ts";
import { isReceiptSecret } from "../../domain/receipt.ts";
import type { SubmissionSummary } from "../../domain/submission.ts";
import type { Outcome } from "../../domain/versions.ts";
import { HELD, OUTCOME_LABELS, SUBMIT_NOTES } from "../copy.ts";
import type { Store } from "../app/store.ts";
import { confirmationMessage } from "../messages.ts";
import { COLORS, FONT } from "./theme.ts";
import {
  actionButton,
  BUTTON_H,
  bullets,
  errorLine,
  focus,
  heading,
  keyValue,
  paragraph,
  selectableText,
  toggle,
} from "./ui.ts";

export interface SubmitEnv {
  /** Opens the browser's file picker; the chosen file arrives through `store.chooseFile`. */
  openFilePicker(): void;
}

/** The submit view's width: a readable column, centred. */
const COLUMN_W = 380;

export function drawSubmit(ctx: Context, store: Store, env: SubmitEnv): void {
  const pad = Math.floor((ctx.bounds.w - Math.min(ctx.bounds.w, COLUMN_W)) / 2);
  ctx.inset(pad, 0, pad, 0);
  ctx.column({ gap: 4 }, (col) => {
    paragraph(col, "Check a DynamicGlyph gear export (DynamicGlyph-gear-v1-….csv), then submit it if you want to. Checking stores nothing.", { color: COLORS.ash });
    col.place({ w: 0, h: 6 });
    checkSection(col, store, env);
    const { check } = store.state;
    if (check.phase === "failed") errorLine(col, `Couldn't check the file: ${check.message}`);
    if (check.phase === "done") {
      previewSection(col, check.preview);
      if (check.preview.ok && check.preview.records.valid > 0) submitSection(col, store, check.preview.records.valid);
    }
    statusSection(col, store);
  });
}

function checkSection(ctx: Context, store: Store, env: SubmitEnv): void {
  const { colors: c } = useTheme(ctx);
  heading(ctx, "CHECK A FILE");
  const { file, check } = store.state;
  ctx.row({ gap: 4, h: BUTTON_H }, (row) => {
    if (actionButton(row, { key: "choose", label: "CHOOSE FILE", hint: "Pick a DynamicGlyph export, or drop it on the page" })) env.openFilePicker();
    const checking = check.phase === "checking";
    if (actionButton(row, { key: "check", label: checking ? "CHECKING..." : "CHECK FILE", disabled: !file || checking, on: Boolean(file) && check.phase === "idle" })) {
      void store.checkFile();
    }
  });
  paragraph(ctx, file ? file.name : "No file chosen. You can also drop one on the page.", { color: file ? c.paper : c.muted });
  ctx.place({ w: 0, h: 4 });
}

function outcomeRows(ctx: Context, outcomes: Record<Outcome, number>): void {
  const { colors: c } = useTheme(ctx);
  for (const outcome of Object.keys(OUTCOME_LABELS) as Outcome[]) {
    const n = outcomes[outcome];
    if (n === 0) continue;
    const r = ctx.place({ w: ctx.bounds.w, h: 9 });
    const count = String(n);
    ctx.text(count, r.x + 24 - ctx.measureText(count, { font: FONT.mixed }), r.y, { color: c.paper, font: FONT.mixed });
    const end = ctx.text(OUTCOME_LABELS[outcome], r.x + 30, r.y, { color: c.text, font: FONT.mixed });
    if (HELD.has(outcome)) {
      const tag = "HELD FOR REVIEW";
      const tw = ctx.measureText(tag, { font: FONT.small });
      ctx.strokeRect({ x: end + 4, y: r.y - 1, w: tw + 5, h: 9 }, c.accent);
      ctx.text(tag, end + 7, r.y + 1, { color: c.accent, font: FONT.small });
    }
  }
}

function previewSection(ctx: Context, preview: Preview): void {
  if (!preview.ok) {
    heading(ctx, "THIS FILE CAN'T BE USED");
    for (const issue of preview.issues) errorLine(ctx, issue.line === undefined ? issue.message : `${issue.message} (line ${issue.line})`);
    ctx.place({ w: 0, h: 4 });
    return;
  }
  const { records } = preview;
  heading(ctx, "SUMMARY");
  keyValue(ctx, "Rows", String(preview.rowCount));
  keyValue(ctx, "Valid records", `${records.valid} (${records.byKind.hack} hacks, ${records.byKind.drop} drop groups)`);
  keyValue(
    ctx,
    "Gear read",
    `${records.byReadStatus.read} read (${records.partlyRead} partly), ${records.byReadStatus.notRead} not read, ${records.byReadStatus.unavailable} unavailable`,
  );
  keyValue(ctx, "Unusable records", String(records.rejected));
  keyValue(ctx, "Exported by", `DynamicGlyph ${preview.exporter.appVersion ?? "?"} (${preview.exporter.appBuild ?? "?"}), format v${preview.formatVersion}`);
  ctx.text("COMPARED WITH ACCEPTED DATA", ctx.bounds.x, ctx.place({ w: ctx.bounds.w, h: 8 }).y + 1, { color: COLORS.muted, font: FONT.small });
  outcomeRows(ctx, preview.outcomes);
  for (const warning of preview.warnings) paragraph(ctx, warning.message, { color: COLORS.flame });
  if (preview.rejected.length > 0) {
    ctx.place({ w: 0, h: 4 });
    heading(ctx, "UNUSABLE RECORDS", String(preview.rejected.length));
    const shown = preview.rejected.slice(0, 40);
    for (const rejected of shown) {
      paragraph(ctx, `${rejected.recordId ?? "unknown record"} · line ${rejected.lines.join(", ")}`, { color: COLORS.paper });
      for (const issue of rejected.issues) paragraph(ctx, issue.message, { color: COLORS.ash, indent: 8 });
    }
    if (preview.rejected.length > shown.length) {
      paragraph(ctx, `…and ${preview.rejected.length - shown.length} more.`, { color: COLORS.muted });
    }
  }
  ctx.place({ w: 0, h: 6 });
}

function receiptBox(ctx: Context, store: Store, secret: string): void {
  const { colors: c } = useTheme(ctx);
  const top = ctx.cursor.y;
  ctx.column({ gap: 4 }, (box) => {
    box.inset(5, 5, 5, 5);
    paragraph(box, "YOUR RECEIPT. KEEP IT PRIVATE.", { font: FONT.caps, color: c.paper });
    selectableText(box, { key: "receipt:text", label: "Your receipt", text: secret, color: c.flame });
    box.row({ gap: 4, h: BUTTON_H }, (row) => {
      if (actionButton(row, { key: "receipt:download", label: "DOWNLOAD", hint: "Save the receipt as a text file" })) store.downloadReceipt();
      if (actionButton(row, { key: "receipt:copy", label: "COPY", hint: "Copy the receipt exactly, case and all" })) void store.copyReceipt();
    });
    box.place({ w: 0, h: 1 });
  });
  const box = { x: ctx.bounds.x, y: top, w: ctx.bounds.w, h: ctx.cursor.y - top };
  ctx.strokeRect(box, c.accent);
  ctx.place({ w: 0, h: 4 });
}

function submitSection(ctx: Context, store: Store, valid: number): void {
  const { submit } = store.state;
  if (submit.step === "done") {
    const message = confirmationMessage(submit.summary, submit.replayed);
    heading(ctx, message.heading.toUpperCase());
    paragraph(ctx, message.text);
    outcomeRows(ctx, submit.summary.outcomes);
    ctx.place({ w: 0, h: 4 });
    receiptBox(ctx, store, submit.secret);
    return;
  }
  heading(ctx, "SUBMIT");
  bullets(ctx, SUBMIT_NOTES);
  ctx.place({ w: 0, h: 4 });
  if (submit.step === "explain") {
    if (actionButton(ctx, { key: "receipt:create", label: "CREATE MY RECEIPT", on: true })) store.createReceipt();
    return;
  }
  if (submit.step === "refused") {
    errorLine(ctx, `Not submitted: ${submit.message}`);
    return;
  }
  receiptBox(ctx, store, submit.secret);
  if (submit.step === "receipt") {
    if (toggle(ctx, { key: "receipt:saved", label: "I've saved my receipt", checked: submit.saved })) store.setSaved(!submit.saved);
    ctx.place({ w: 0, h: 2 });
    if (actionButton(ctx, { key: "submit:send", label: `SUBMIT ${valid} RECORDS`, disabled: !submit.saved, on: submit.saved })) void store.send();
  }
  if (submit.step === "sending") paragraph(ctx, "Submitting…", { color: COLORS.ash });
  if (submit.step === "retry") {
    errorLine(ctx, `Couldn't confirm the submission (${submit.message}). It may have gone through.`);
    if (actionButton(ctx, { key: "submit:retry", label: "TRY AGAIN WITH THE SAME RECEIPT", on: true })) void store.send();
  }
  ctx.place({ w: 0, h: 6 });
}

function summaryLine(summary: SubmissionSummary): string {
  const when = (seconds: number) => new Date(seconds * 1000).toLocaleString();
  const state = summary.withdrawnAt === null ? "Active" : `Withdrawn ${when(summary.withdrawnAt)}`;
  return `${state}, submitted ${when(summary.createdAt)}. ${summary.rowCount} rows; ${summary.rejected} unusable records weren't stored.`;
}

function statusSection(ctx: Context, store: Store): void {
  const { status } = store.state;
  heading(ctx, "CHECK OR WITHDRAW A SUBMISSION");
  const busy = status.withdrawal.step === "sending";
  ctx.row({ gap: 4, h: 11 }, (row) => {
    // The receipt is stored on every keystroke, so a pending lookup is cancelled as soon as it
    // changes; the field then never sees a "new" text to commit, so Enter is taken here.
    const seen = row.state(() => ({ focused: false }), { key: "status:receipt:focus" });
    const enter = seen.focused && row.takeKey("Enter");
    const field = textField(
      row,
      { key: "status:receipt", value: status.input, placeholder: "PASTE YOUR RECEIPT", font: FONT.mixed, w: Math.max(row.bounds.w - 50, 60), hint: "Your receipt, as gds1_…" },
    );
    seen.focused = field.it.focused;
    if (field.it.focused) focus.next = "Receipt, text field";
    if (!busy && field.changed) store.setStatusInput(field.text);
    if (!busy && enter && isReceiptSecret(field.text.trim())) void store.lookup();
    if (actionButton(row, { key: "status:check", label: "CHECK", disabled: busy || status.checking || !isReceiptSecret(status.input.trim()) })) {
      void store.lookup();
    }
  });
  ctx.place({ w: 0, h: 2 });
  if (status.checking) paragraph(ctx, "Checking…", { color: COLORS.ash });
  const outcome = status.looked?.outcome;
  if (outcome?.kind === "found") {
    paragraph(ctx, summaryLine(outcome.submission));
    outcomeRows(ctx, outcome.submission.outcomes);
    ctx.place({ w: 0, h: 4 });
    if (outcome.submission.status === "completed") {
      const { withdrawal } = status;
      if (withdrawal.step === "idle" && actionButton(ctx, { key: "withdraw:start", label: "WITHDRAW THIS SUBMISSION" })) store.startWithdraw();
      if (withdrawal.step === "sending") paragraph(ctx, "Withdrawing…", { color: COLORS.ash });
      if (withdrawal.step === "refused") errorLine(ctx, `Not withdrawn: ${withdrawal.message}`);
    }
  }
  if (outcome?.kind === "refused") errorLine(ctx, outcome.issues.map((issue) => issue.message).join(" "));
  if (outcome?.kind === "failed") errorLine(ctx, `Couldn't check: ${outcome.message}`);
  ctx.place({ w: 0, h: 8 });
}
