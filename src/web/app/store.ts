import type { Preview } from "../../domain/preview.ts";
import { receiptText } from "../../domain/receipt.ts";
import type { SubmissionSummary } from "../../domain/submission.ts";
import {
  networkProblem,
  type ApiIssue,
  type ConfirmOutcome,
  type PreviewOutcome,
  type Problem,
  type SiteConfig,
  type StatisticsOutcome,
  type StatusOutcome,
  type WithdrawOutcome,
} from "../api.ts";
import type { Messages } from "../i18n/en.ts";
import { LOCALE_KEY, messages, type Locale } from "../i18n/index.ts";
import { itemsTsv, type Sort, type SortKey } from "../itemTable.ts";
import { LatestOnly, STALE } from "../latest.ts";
import { EMPTY_FORM, formQuery, type StatsForm } from "../statsForm.ts";
import { address, DEFAULT_VIEW, hasRanges, type ViewState } from "../viewLink.ts";

/**
 * Everything the page shows and every action on it, with no rendering. The
 * React components read `state` and call the actions. Keeping the rules here
 * (which answer may update the page, which file a receipt belongs to) lets
 * them be tested without a browser.
 */

export type View = "statistics" | "submit";

export interface StatisticsState {
  /** The form as typed; ranges apply only when asked. */
  form: StatsForm;
  /** The form the shown answer was asked for: what the page's address records. */
  applied: StatsForm;
  /** Null until the first answer. */
  outcome: StatisticsOutcome | null;
  loading: boolean;
  search: string;
  sort: Sort;
  filtersOpen: boolean;
  guideOpen: boolean;
  disclaimerOpen: boolean;
  /** The comparison group whose level grid is shown; null for every record. */
  gridGroup: string | null;
  /** The item whose count distribution is shown; null for the page's default. */
  distItem: string | null;
  /** The "about this sample" section is expanded. */
  sampleOpen: boolean;
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
  /** The page's language. */
  locale: Locale;
  /**
   * Whether this deployment accepts submissions; null until known (or if it
   * couldn't be read, when the server's refusal still says so).
   */
  submissionsOpen: boolean | null;
  /** Submissions are open for testing only and will be deleted before the site opens to the public. */
  testPeriod: boolean;
  /** A short message for the status line, by id. A new object each time. */
  notice: { id: keyof Messages["notice"] } | null;
}

export interface StoreDeps {
  previewFile(file: File, signal: AbortSignal): Promise<PreviewOutcome>;
  confirmUpload(file: File, secret: string): Promise<ConfirmOutcome>;
  submissionStatus(secret: string, signal: AbortSignal): Promise<StatusOutcome>;
  withdrawUpload(secret: string): Promise<WithdrawOutcome>;
  fetchStatistics(query: string, signal: AbortSignal): Promise<StatisticsOutcome>;
  fetchConfig(): Promise<SiteConfig | null>;
  newSecret(): string;
  download(name: string, text: string, type: string): void;
  copy(text: string): Promise<void>;
  /** Per-viewer preferences; reads and writes may fail (private windows) and must not matter. */
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  /** Records the view in the page's address (query and hash), without a history entry. */
  setAddress(address: string): void;
  /** The site's address, written into receipts. */
  origin: string;
  now(): Date;
}

export const DISCLAIMER_KEY = "glyph-drop-stats:disclaimer-seen";

export class Store {
  state: AppState;
  private readonly listeners = new Set<() => void>();
  private readonly checks = new LatestOnly();
  private readonly lookups = new LatestOnly();
  private readonly statistics = new LatestOnly();
  private checkCount = 0;

  private readonly deps: StoreDeps;

  /** The address last recorded, so it is only written when it changes. */
  private recorded: string;

  /** `initial` is the statistics view to open with, as a linked address describes it. */
  constructor(deps: StoreDeps, view: View, locale: Locale, initial: ViewState = DEFAULT_VIEW) {
    this.deps = deps;
    this.state = {
      view,
      file: null,
      check: { phase: "idle" },
      submit: { step: "explain" },
      status: { input: "", checking: false, looked: null, withdrawal: { step: "idle" } },
      statistics: {
        form: initial.form,
        applied: initial.form,
        outcome: null,
        loading: false,
        search: initial.search,
        sort: initial.sort,
        filtersOpen: hasRanges(initial.form),
        guideOpen: false,
        disclaimerOpen: deps.storage.get(DISCLAIMER_KEY) !== "1",
        gridGroup: initial.gridGroup,
        distItem: initial.item,
        sampleOpen: false,
      },
      locale,
      submissionsOpen: null,
      testPeriod: false,
      notice: null,
    };
    this.recorded = this.address();
  }

  /** The address for the current state: the applied view, and whether submitting. */
  private address(): string {
    const { applied, search, sort, gridGroup, distItem } = this.state.statistics;
    return address({ form: applied, search, sort, gridGroup, item: distItem }, this.state.view === "submit");
  }

  async loadConfig(): Promise<void> {
    const config = await this.deps.fetchConfig();
    if (config) this.update({ submissionsOpen: config.submissionsOpen, testPeriod: config.testPeriod });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    const next = this.address();
    if (next !== this.recorded) {
      this.recorded = next;
      this.deps.setAddress(next);
    }
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
    this.update({ locale });
  }

  // Views

  /** Statistics load fresh every time they are shown. */
  setView(view: View): void {
    this.update({ view });
    if (view === "statistics") void this.loadStatistics();
  }

  /**
   * A modal dialog over the page: the first-visit note, the guide or the
   * withdrawal confirmation. Page shortcuts wait until it closes.
   */
  dialogOpen(): boolean {
    const { view, statistics, status } = this.state;
    if (view === "statistics") return statistics.disclaimerOpen || statistics.guideOpen;
    return status.withdrawal.step === "confirming" || status.withdrawal.step === "uncertain" || status.withdrawal.step === "sending";
  }

  // Statistics

  /** Asks for the statistics `form` describes (the form as it stands, unless given). */
  async loadStatistics(form: StatsForm = this.state.statistics.form): Promise<void> {
    this.updateStatistics({ loading: true, applied: form });
    const query = formQuery(form);
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

  /** Pickers apply at once, like a unit switch; ranges wait for `applyFilters`. A new split's groups start from "all". */
  choose(patch: Partial<Pick<StatsForm, "kind" | "panels" | "multiplied" | "alignment" | "split">>): void {
    const { form: current, gridGroup } = this.state.statistics;
    const form = { ...current, ...patch };
    this.updateStatistics({ form, gridGroup: form.split === current.split ? gridGroup : null });
    void this.loadStatistics(form);
  }

  setGridGroup(gridGroup: string | null): void {
    this.updateStatistics({ gridGroup });
  }

  setDistItem(distItem: string): void {
    this.updateStatistics({ distItem });
  }

  toggleSample(): void {
    this.updateStatistics({ sampleOpen: !this.state.statistics.sampleOpen });
  }

  applyFilters(): void {
    void this.loadStatistics();
  }

  /** Clears the ranges; the pickers keep their choice. */
  clearFilters(): void {
    const { kind, panels, multiplied, alignment, split } = this.state.statistics.form;
    const form = { ...EMPTY_FORM, kind, panels, multiplied, alignment, split };
    this.updateStatistics({ form });
    void this.loadStatistics(form);
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

  /** Copies a link to this view; `url` is the page's address, which the store records but doesn't know the origin of. */
  async copyLink(url: string): Promise<void> {
    try {
      await this.deps.copy(url);
      this.notify("linkCopied");
    } catch {
      this.notify("linkCopyFailed");
    }
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
    if (this.state.submit.step !== "explain" || this.state.submissionsOpen === false) return;
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
