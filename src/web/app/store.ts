import type { Preview } from "../../domain/preview.ts";
import { receiptText } from "../../domain/receipt.ts";
import type { SubmissionSummary } from "../../domain/submission.ts";
import {
  networkProblem,
  type ApiIssue,
  type ConfirmOutcome,
  type PreviewOutcome,
  type Problem,
  type StatisticsOutcome,
  type StatusOutcome,
  type WithdrawOutcome,
} from "../api.ts";
import type { Messages } from "../i18n/en.ts";
import { LOCALE_KEY, messages, type Locale } from "../i18n/index.ts";
import { DEFAULT_SORT, itemsTsv, type Sort, type SortKey } from "../itemTable.ts";
import { LatestOnly, STALE } from "../latest.ts";
import { EMPTY_FORM, formQuery, type StatsForm } from "../statsForm.ts";

/**
 * Everything the page shows and every action on it, with no drawing. The
 * canvas reads `state` each frame and calls the actions; the accessible
 * mirror renders the same state as text. Keeping the rules here (which
 * answer may update the page, which file a receipt belongs to) lets them be
 * tested without a browser.
 */

export type View = "statistics" | "submit";

export interface StatisticsState {
  form: StatsForm;
  /** Null until the first answer. */
  outcome: StatisticsOutcome | null;
  loading: boolean;
  search: string;
  sort: Sort;
  filtersOpen: boolean;
  guideOpen: boolean;
  disclaimerOpen: boolean;
}

export type CheckState =
  | { phase: "idle" }
  | { phase: "checking" }
  /** `file` is the exact file this preview describes; only it may be submitted. */
  | { phase: "done"; file: File; preview: Preview; checkId: number }
  | { phase: "failed"; problem: Problem };

export type SubmitPhase =
  | { step: "explain" }
  | { step: "receipt"; secret: string; saved: boolean }
  | { step: "sending"; secret: string }
  | { step: "retry"; secret: string; problem: Problem }
  | { step: "refused"; issues: ApiIssue[] }
  | { step: "done"; secret: string; summary: SubmissionSummary; replayed: boolean };

export type Withdrawal =
  | { step: "idle" }
  | { step: "confirming" }
  | { step: "sending" }
  | { step: "uncertain"; problem: Problem }
  | { step: "refused"; issues: ApiIssue[] };

export interface StatusState {
  input: string;
  checking: boolean;
  /** A lookup's answer, with the receipt it was for: withdrawal acts on that receipt only. */
  looked: { secret: string; outcome: StatusOutcome } | null;
  withdrawal: Withdrawal;
}

export interface AppState {
  view: View;
  file: File | null;
  check: CheckState;
  submit: SubmitPhase;
  status: StatusState;
  statistics: StatisticsState;
  crt: boolean;
  /** The page shown as plain HTML instead of the canvas: text can be selected, copied and found. */
  textView: boolean;
  /** The page's language. */
  locale: Locale;
  /** The language picker is open. */
  languageOpen: boolean;
  /** A short message for the status line, by id. A new object each time. */
  notice: { id: keyof Messages["notice"] } | null;
}

export interface StoreDeps {
  previewFile(file: File, signal: AbortSignal): Promise<PreviewOutcome>;
  confirmUpload(file: File, secret: string): Promise<ConfirmOutcome>;
  submissionStatus(secret: string, signal: AbortSignal): Promise<StatusOutcome>;
  withdrawUpload(secret: string): Promise<WithdrawOutcome>;
  fetchStatistics(query: string, signal: AbortSignal): Promise<StatisticsOutcome>;
  newSecret(): string;
  download(name: string, text: string, type: string): void;
  copy(text: string): Promise<void>;
  /** Per-viewer preferences; reads and writes may fail (private windows) and must not matter. */
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  setHash(view: View): void;
  /** The site's address, written into receipts. */
  origin: string;
  now(): Date;
}

export const DISCLAIMER_KEY = "glyph-drop-stats:disclaimer-seen";
export const CRT_KEY = "glyph-drop-stats:crt";
export const TEXT_VIEW_KEY = "glyph-drop-stats:text-view";



export class Store {
  state: AppState;
  private readonly listeners = new Set<() => void>();
  private readonly checks = new LatestOnly();
  private readonly lookups = new LatestOnly();
  private readonly statistics = new LatestOnly();
  private checkCount = 0;

  private readonly deps: StoreDeps;

  constructor(deps: StoreDeps, view: View, locale: Locale) {
    this.deps = deps;
    this.state = {
      view,
      file: null,
      check: { phase: "idle" },
      submit: { step: "explain" },
      status: { input: "", checking: false, looked: null, withdrawal: { step: "idle" } },
      statistics: {
        form: EMPTY_FORM,
        outcome: null,
        loading: false,
        search: "",
        sort: DEFAULT_SORT,
        filtersOpen: false,
        guideOpen: false,
        disclaimerOpen: deps.storage.get(DISCLAIMER_KEY) !== "1",
      },
      crt: deps.storage.get(CRT_KEY) !== "off",
      locale,
      languageOpen: false,
      textView: deps.storage.get(TEXT_VIEW_KEY) === "on",
      notice: null,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private updateStatistics(patch: Partial<StatisticsState>): void {
    this.update({ statistics: { ...this.state.statistics, ...patch } });
  }

  private updateStatus(patch: Partial<StatusState>): void {
    this.update({ status: { ...this.state.status, ...patch } });
  }

  private notify(id: keyof Messages["notice"]): void {
    this.update({ notice: { id } });
  }

  /** The current language's messages. */
  get strings(): Messages {
    return messages(this.state.locale);
  }

  setLocale(locale: Locale): void {
    this.deps.storage.set(LOCALE_KEY, locale);
    this.update({ locale, languageOpen: false });
  }

  setLanguageOpen(languageOpen: boolean): void {
    this.update({ languageOpen });
  }

  // Views

  /** Statistics load fresh every time they are shown. */
  setView(view: View): void {
    this.deps.setHash(view);
    this.update({ view });
    if (view === "statistics") void this.loadStatistics(formQuery(this.state.statistics.form));
  }

  toggleCrt(): void {
    const crt = !this.state.crt;
    this.deps.storage.set(CRT_KEY, crt ? "on" : "off");
    this.update({ crt });
  }

  /**
   * A dialog the canvas shows over the page: the language picker, the
   * first-visit note, the guide or the withdrawal confirmation. Page
   * shortcuts wait until it closes.
   */
  dialogOpen(): boolean {
    const { view, statistics, status, languageOpen } = this.state;
    if (languageOpen) return true;
    if (view === "statistics") return statistics.disclaimerOpen || statistics.guideOpen;
    return status.withdrawal.step === "confirming" || status.withdrawal.step === "uncertain" || status.withdrawal.step === "sending";
  }

  setTextView(textView: boolean): void {
    this.deps.storage.set(TEXT_VIEW_KEY, textView ? "on" : "off");
    this.update({ textView });
  }

  // Statistics

  async loadStatistics(query: string): Promise<void> {
    this.updateStatistics({ loading: true });
    let outcome: StatisticsOutcome;
    try {
      const result = await this.statistics.run((signal) => this.deps.fetchStatistics(query, signal));
      if (result === STALE) return;
      outcome = result;
    } catch (error) {
      outcome = { kind: "failed", problem: networkProblem(error) };
    }
    this.updateStatistics({ outcome, loading: false });
  }

  setFormField(name: keyof StatsForm, value: string): void {
    this.updateStatistics({ form: { ...this.state.statistics.form, [name]: value } });
  }

  /** Pickers apply at once, like a unit switch; ranges wait for `applyFilters`. */
  choose(patch: Partial<Pick<StatsForm, "kind" | "panels">>): void {
    const form = { ...this.state.statistics.form, ...patch };
    this.updateStatistics({ form });
    void this.loadStatistics(formQuery(form));
  }

  applyFilters(): void {
    void this.loadStatistics(formQuery(this.state.statistics.form));
  }

  /** Clears the ranges; the kind and panel pickers keep their choice. */
  clearFilters(): void {
    const { kind, panels } = this.state.statistics.form;
    const form = { ...EMPTY_FORM, kind, panels };
    this.updateStatistics({ form });
    void this.loadStatistics(formQuery(form));
  }

  setSearch(search: string): void {
    this.updateStatistics({ search });
  }

  sortBy(key: SortKey): void {
    const { sort } = this.state.statistics;
    this.updateStatistics({
      sort: sort.key === key ? { key, descending: !sort.descending } : { key, descending: key !== "item" },
    });
  }

  toggleFilters(): void {
    this.updateStatistics({ filtersOpen: !this.state.statistics.filtersOpen });
  }

  setGuideOpen(guideOpen: boolean): void {
    this.updateStatistics({ guideOpen });
  }

  dismissDisclaimer(): void {
    this.deps.storage.set(DISCLAIMER_KEY, "1");
    this.updateStatistics({ disclaimerOpen: false });
  }

  downloadTsv(): void {
    const { outcome } = this.state.statistics;
    if (outcome?.kind !== "ok") return;
    this.deps.download("glyph-drop-stats-items.tsv", itemsTsv(outcome.statistics), "text/tab-separated-values");
  }

  // Checking and submitting a file

  /** A new file discards the preview, the receipt and any check still in flight. */
  chooseFile(file: File | null): void {
    this.checks.cancel();
    this.update({ file, check: { phase: "idle" }, submit: { step: "explain" } });
  }

  async checkFile(): Promise<void> {
    const { file } = this.state;
    if (!file) return;
    this.update({ check: { phase: "checking" }, submit: { step: "explain" } });
    try {
      const result = await this.checks.run((signal) => this.deps.previewFile(file, signal));
      if (result === STALE) return;
      if (result.kind === "failed") {
        this.update({ check: { phase: "failed", problem: result.problem } });
        return;
      }
      this.update({ check: { phase: "done", file, preview: result.preview, checkId: ++this.checkCount } });
    } catch (error) {
      this.update({ check: { phase: "failed", problem: networkProblem(error) } });
    }
  }

  createReceipt(): void {
    if (this.state.submit.step !== "explain") return;
    this.update({ submit: { step: "receipt", secret: this.deps.newSecret(), saved: false } });
  }

  setSaved(saved: boolean): void {
    const { submit } = this.state;
    if (submit.step === "receipt") this.update({ submit: { ...submit, saved } });
  }

  receiptSecret(): string | null {
    const { submit } = this.state;
    return "secret" in submit ? submit.secret : null;
  }

  downloadReceipt(): void {
    const secret = this.receiptSecret();
    if (!secret) return;
    this.deps.download(
      "glyph-drop-stats-receipt.txt",
      receiptText(secret, this.deps.origin, this.deps.now(), this.strings.receiptFile),
      "text/plain",
    );
  }

  async copyReceipt(): Promise<void> {
    const secret = this.receiptSecret();
    if (!secret) return;
    try {
      await this.deps.copy(secret);
      this.notify("receiptCopied");
    } catch {
      this.notify("copyFailed");
    }
  }

  /** Confirms the checked file with the receipt; safe to call again after an uncertain answer. */
  async send(): Promise<void> {
    const { check, submit } = this.state;
    if (check.phase !== "done") return;
    const ready = (submit.step === "receipt" && submit.saved) || submit.step === "retry";
    if (!ready) return;
    const { secret } = submit;
    this.update({ submit: { step: "sending", secret } });
    const outcome = await this.deps.confirmUpload(check.file, secret);
    // The answer belongs to this file; a different file chosen meanwhile has reset the flow.
    if (this.state.check !== check) return;
    switch (outcome.kind) {
      case "submitted":
        this.update({ submit: { step: "done", secret, summary: outcome.submission, replayed: outcome.replayed } });
        return;
      case "refused":
        this.update({ submit: { step: "refused", issues: outcome.issues } });
        return;
      case "uncertain":
        this.update({ submit: { step: "retry", secret, problem: outcome.problem } });
        return;
    }
  }

  // Looking up and withdrawing a submission

  setStatusInput(input: string): void {
    this.lookups.cancel();
    this.updateStatus({ input, checking: false, looked: null, withdrawal: { step: "idle" } });
  }

  async lookup(): Promise<void> {
    const secret = this.state.status.input.trim();
    this.updateStatus({ checking: true, looked: null, withdrawal: { step: "idle" } });
    let outcome: StatusOutcome;
    try {
      const result = await this.lookups.run((signal) => this.deps.submissionStatus(secret, signal));
      if (result === STALE) return;
      outcome = result;
    } catch (error) {
      outcome = { kind: "failed", problem: networkProblem(error) };
    }
    this.updateStatus({ checking: false, looked: { secret, outcome } });
  }

  startWithdraw(): void {
    this.updateStatus({ withdrawal: { step: "confirming" } });
  }

  cancelWithdraw(): void {
    this.updateStatus({ withdrawal: { step: "idle" } });
  }

  /** Withdraws the submission that was looked up; idempotent, so an uncertain answer can be retried. */
  async confirmWithdraw(): Promise<void> {
    const { looked } = this.state.status;
    if (!looked) return;
    this.updateStatus({ withdrawal: { step: "sending" } });
    const outcome = await this.deps.withdrawUpload(looked.secret);
    if (this.state.status.looked?.secret !== looked.secret) return;
    switch (outcome.kind) {
      case "withdrawn":
        this.updateStatus({
          looked: { secret: looked.secret, outcome: { kind: "found", submission: outcome.submission } },
          withdrawal: { step: "idle" },
        });
        return;
      case "refused":
        this.updateStatus({
          withdrawal: { step: "refused", issues: outcome.issues },
        });
        return;
      case "uncertain":
        this.updateStatus({ withdrawal: { step: "uncertain", problem: outcome.problem } });
        return;
    }
  }
}
