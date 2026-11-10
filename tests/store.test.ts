import { describe, expect, it, vi } from "vitest";
import { hashAgentKey } from "../src/domain/agentKey.ts";
import type { Preview } from "../src/domain/preview.ts";
import { computeStatistics, NO_FILTER } from "../src/domain/statistics.ts";
import type { SubmissionSummary } from "../src/domain/submission.ts";
import type {
  ConfirmOutcome,
  LinkKeyOutcome,
  PreviewOutcome,
  StatisticsOutcome,
  StatusOutcome,
  WithdrawOutcome,
} from "../src/web/api.ts";
import { announcement } from "../src/web/app/announce.ts";
import { DISCLAIMER_KEY, Store, type StoreDeps } from "../src/web/app/store.ts";
import { LOCALE_KEY, type Locale } from "../src/web/i18n/index.ts";
import { EMPTY_FORM } from "../src/web/statsForm.ts";
import { viewFromQuery } from "../src/web/viewLink.ts";

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const SUMMARY: SubmissionSummary = {
  status: "completed",
  createdAt: 1_791_158_163,
  withdrawnAt: null,
  rowCount: 7,
  rejected: 0,
  outcomes: { new: 3, duplicate: 0, duplicate_other_precision: 0, update_candidate: 0, conflict: 0 },
};

const PREVIEW = { ok: true, rowCount: 7 } as unknown as Preview;
const NEW_KEY = `gdsr_${"n".repeat(43)}`;
const OTHER_KEY = `gdsr_${"o".repeat(43)}`;
const fileA = new File(["a"], "a.csv");
const fileB = new File(["b"], "b.csv");

function setup(overrides: Partial<StoreDeps> = {}, locale: Locale = "en") {
  const saved = new Map<string, string>();
  const deps: StoreDeps = {
    previewFile: vi.fn(async (): Promise<PreviewOutcome> => ({ kind: "ok", preview: PREVIEW })),
    confirmUpload: vi.fn(async (): Promise<ConfirmOutcome> => ({ kind: "submitted", replayed: false, submission: SUMMARY })),
    submissionStatus: vi.fn(async (): Promise<StatusOutcome> => ({ kind: "found", submission: SUMMARY })),
    withdrawUpload: vi.fn(
      async (): Promise<WithdrawOutcome> => ({
        kind: "withdrawn",
        alreadyWithdrawn: false,
        submission: { ...SUMMARY, status: "withdrawn", withdrawnAt: 1_791_160_000 },
      }),
    ),
    linkAgentKey: vi.fn(async (): Promise<LinkKeyOutcome> => ({ kind: "linked", submissions: 1 })),
    revokeAgentKey: vi.fn(async () => ({ kind: "revoked" as const, found: true })),
    fetchStatistics: vi.fn(async (): Promise<StatisticsOutcome> => ({ kind: "ok", statistics: computeStatistics([], NO_FILTER) })),
    fetchConfig: vi.fn(async () => ({ submissionsOpen: true, testPeriod: false })),
    newSecret: vi.fn(() => `gds1_${"a".repeat(43)}`),
    newAgentKey: vi.fn(() => NEW_KEY),
    download: vi.fn(),
    copy: vi.fn(async () => {}),
    storage: { get: (key) => saved.get(key) ?? null, set: (key, value) => void saved.set(key, value) },
    setAddress: vi.fn(),
    origin: "https://stats.test",
    now: () => new Date(Date.UTC(2026, 9, 6)),
    ...overrides,
  };
  return { store: new Store(deps, "submit", locale), deps, saved };
}

async function checkedStore(overrides: Partial<StoreDeps> = {}) {
  const context = setup(overrides);
  context.store.chooseFile(fileA);
  await context.store.checkFile();
  return context;
}

describe("checking a file", () => {
  it("shows the preview for the file that was checked", async () => {
    const { store } = await checkedStore();
    expect(store.state.check).toMatchObject({ phase: "done", file: fileA, preview: PREVIEW });
  });

  it("drops a slow answer for an earlier file", async () => {
    const answers = [deferred<PreviewOutcome>(), deferred<PreviewOutcome>()];
    let call = 0;
    const { store } = setup({ previewFile: () => answers[call++].promise });
    store.chooseFile(fileA);
    const first = store.checkFile();
    store.chooseFile(fileB);
    const second = store.checkFile();
    answers[1].resolve({ kind: "ok", preview: PREVIEW });
    answers[0].resolve({ kind: "ok", preview: { ok: false, issues: [] } });
    await Promise.all([first, second]);
    expect(store.state.check).toMatchObject({ phase: "done", file: fileB, preview: PREVIEW });
  });

  it("reports a failed check", async () => {
    const { store } = await checkedStore({ previewFile: async () => ({ kind: "failed", problem: { kind: "network", detail: "offline" } }) });
    expect(store.state.check).toEqual({ phase: "failed", problem: { kind: "network", detail: "offline" } });
  });

  it("discards the receipt and preview when another file is chosen", async () => {
    const { store } = await checkedStore();
    store.createReceipt();
    store.chooseFile(fileB);
    expect(store.state.check).toEqual({ phase: "idle" });
    expect(store.state.submit).toEqual({ step: "explain" });
  });
});

describe("submitting", () => {
  it("waits until the receipt is saved", async () => {
    const { store, deps } = await checkedStore();
    store.createReceipt();
    await store.send();
    expect(deps.confirmUpload).not.toHaveBeenCalled();
    store.setSaved(true);
    await store.send();
    expect(deps.confirmUpload).toHaveBeenCalledWith(fileA, `gds1_${"a".repeat(43)}`);
    expect(store.state.submit).toMatchObject({ step: "done", replayed: false, summary: SUMMARY });
  });

  it("keeps the receipt and retries with it after an uncertain answer", async () => {
    const answers: ConfirmOutcome[] = [
      { kind: "uncertain", problem: { kind: "network", detail: "connection lost" } },
      { kind: "submitted", replayed: true, submission: SUMMARY },
    ];
    const { store, deps } = await checkedStore({ confirmUpload: vi.fn(async () => answers.shift()!) });
    store.createReceipt();
    store.setSaved(true);
    await store.send();
    expect(store.state.submit).toEqual({ step: "retry", secret: `gds1_${"a".repeat(43)}`, problem: { kind: "network", detail: "connection lost" } });
    await store.send();
    expect(store.state.submit).toMatchObject({ step: "done", replayed: true });
    expect(vi.mocked(deps.confirmUpload).mock.calls.map((call) => call[1])).toEqual([
      `gds1_${"a".repeat(43)}`,
      `gds1_${"a".repeat(43)}`,
    ]);
  });

  it("reports a clear refusal", async () => {
    const { store } = await checkedStore({
      confirmUpload: async () => ({ kind: "refused", issues: [{ code: "receipt_in_use", message: "Used." }] }),
    });
    store.createReceipt();
    store.setSaved(true);
    await store.send();
    expect(store.state.submit).toEqual({ step: "refused", issues: [{ code: "receipt_in_use", message: "Used." }] });
  });

  it("ignores an answer that arrives after another file was chosen", async () => {
    const answer = deferred<ConfirmOutcome>();
    const { store } = await checkedStore({ confirmUpload: () => answer.promise });
    store.createReceipt();
    store.setSaved(true);
    const sending = store.send();
    store.chooseFile(fileB);
    answer.resolve({ kind: "submitted", replayed: false, submission: SUMMARY });
    await sending;
    expect(store.state.submit).toEqual({ step: "explain" });
  });

  it("downloads and copies the exact receipt", async () => {
    const { store, deps } = await checkedStore();
    store.createReceipt();
    store.downloadReceipt();
    const [name, text] = vi.mocked(deps.download).mock.calls[0];
    expect(name).toBe("glyph-drop-stats-receipt.txt");
    expect(text).toContain(`Receipt: gds1_${"a".repeat(43)}`);
    await store.copyReceipt();
    expect(deps.copy).toHaveBeenCalledWith(`gds1_${"a".repeat(43)}`);
    expect(store.state.notice).toEqual({ id: "receiptCopied" });
  });

  it("says so when copying fails", async () => {
    const { store } = await checkedStore({ copy: async () => Promise.reject(new Error("denied")) });
    store.createReceipt();
    await store.copyReceipt();
    expect(store.state.notice).toEqual({ id: "copyFailed" });
  });
});

describe("looking up and withdrawing", () => {
  it("never shows an earlier receipt's answer under a newer one", async () => {
    const slow = deferred<StatusOutcome>();
    const { store } = setup({
      submissionStatus: vi.fn((secret: string) =>
        secret === "A" ? slow.promise : Promise.resolve<StatusOutcome>({ kind: "refused", issues: [{ code: "not_found", message: "No." }] }),
      ),
    });
    store.setStatusInput("A");
    const first = store.lookup();
    store.setStatusInput("B");
    await store.lookup();
    slow.resolve({ kind: "found", submission: SUMMARY });
    await first;
    expect(store.state.status.looked).toMatchObject({ secret: "B", outcome: { kind: "refused" } });
  });

  it("withdraws the receipt that was looked up and shows it withdrawn", async () => {
    const { store, deps } = setup();
    store.setStatusInput("  A  ");
    await store.lookup();
    store.startWithdraw();
    await store.confirmWithdraw();
    expect(deps.withdrawUpload).toHaveBeenCalledWith("A");
    expect(store.state.status.looked?.outcome).toMatchObject({ kind: "found", submission: { status: "withdrawn" } });
    expect(store.state.status.withdrawal).toEqual({ step: "idle" });
  });

  it("offers a retry after an uncertain withdrawal", async () => {
    const { store } = setup({ withdrawUpload: async () => ({ kind: "uncertain", problem: { kind: "network", detail: "lost" } }) });
    store.setStatusInput("A");
    await store.lookup();
    await store.confirmWithdraw();
    expect(store.state.status.withdrawal).toEqual({ step: "uncertain", problem: { kind: "network", detail: "lost" } });
  });
});

describe("the AI agents page", () => {
  it("is a view of its own in the address, with no dialog to wait for", () => {
    const { store, deps } = setup();
    store.setView("agents");
    expect(vi.mocked(deps.setAddress).mock.calls.at(-1)?.[0]).toBe("#agents");
    expect(store.dialogOpen()).toBe(false);
    expect(announcement({ ...store.state, view: "submit" }, store.state)).toBe("AI agents");
  });

  it("copies an address or command and says so", async () => {
    const { store, deps } = setup();
    await store.copyText("https://stats.test/mcp");
    expect(deps.copy).toHaveBeenCalledWith("https://stats.test/mcp");
    expect(store.state.notice?.id).toBe("textCopied");
    const failing = setup({ copy: vi.fn(async () => Promise.reject(new Error("denied"))) });
    await failing.store.copyText("x");
    expect(failing.store.state.notice?.id).toBe("textCopyFailed");
  });
});

describe("agent keys", () => {
  async function looked(overrides: Partial<StoreDeps> = {}) {
    const context = setup(overrides);
    context.store.setStatusInput("A");
    await context.store.lookup();
    return context;
  }

  it("makes a key in the page, sends only its hash with the receipt, and shows the key once", async () => {
    const { store, deps } = await looked();
    await store.createAgentKey();
    expect(deps.linkAgentKey).toHaveBeenCalledWith("A", await hashAgentKey(NEW_KEY));
    expect(store.state.status.agentKey).toEqual({ step: "linked", key: NEW_KEY, submissions: 1 });
    await store.copyAgentKey();
    expect(deps.copy).toHaveBeenCalledWith(NEW_KEY);
    expect(store.state.notice?.id).toBe("keyCopied");
  });

  it("adds the submission to a pasted key without showing that key again", async () => {
    const { store, deps } = await looked({ linkAgentKey: vi.fn(async (): Promise<LinkKeyOutcome> => ({ kind: "linked", submissions: 3 })) });
    store.setKeyInput(`  ${OTHER_KEY} `);
    await store.addToAgentKey();
    expect(deps.linkAgentKey).toHaveBeenCalledWith("A", await hashAgentKey(OTHER_KEY));
    expect(store.state.status.agentKey).toEqual({ step: "linked", key: null, submissions: 3 });
  });

  it("revokes the pasted key and clears the field, saying when none matched", async () => {
    const { store, deps } = await looked({ revokeAgentKey: vi.fn(async () => ({ kind: "revoked" as const, found: false })) });
    store.setKeyInput(OTHER_KEY);
    await store.revokeAgentKey();
    expect(deps.revokeAgentKey).toHaveBeenCalledWith(OTHER_KEY);
    expect(store.state.status.agentKey).toEqual({ step: "revoked", found: false });
    expect(store.state.status.keyInput).toBe("");
  });

  it("retries an uncertain link with the same key, which is safe", async () => {
    const link = vi.fn<StoreDeps["linkAgentKey"]>(async () => ({ kind: "uncertain", problem: { kind: "network", detail: "lost" } }));
    const { store, deps } = await looked({ linkAgentKey: link });
    await store.createAgentKey();
    expect(store.state.status.agentKey).toEqual({ step: "uncertain", action: "create", key: NEW_KEY, problem: { kind: "network", detail: "lost" } });
    link.mockResolvedValueOnce({ kind: "linked", submissions: 1 });
    await store.retryAgentKey();
    expect(deps.newAgentKey).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenLastCalledWith("A", await hashAgentKey(NEW_KEY));
    expect(store.state.status.agentKey).toEqual({ step: "linked", key: NEW_KEY, submissions: 1 });
  });

  it("shows a refusal, and drops an answer that arrives after another receipt was looked up", async () => {
    const { store } = await looked({ linkAgentKey: vi.fn(async (): Promise<LinkKeyOutcome> => ({ kind: "refused", issues: [{ code: "submission_withdrawn", message: "No." }] })) });
    await store.createAgentKey();
    expect(store.state.status.agentKey).toMatchObject({ step: "refused" });

    const slow = deferred<LinkKeyOutcome>();
    const late = await looked({ linkAgentKey: vi.fn(() => slow.promise) });
    const pending = late.store.createAgentKey();
    late.store.setStatusInput("B");
    slow.resolve({ kind: "linked", submissions: 1 });
    await pending;
    expect(late.store.state.status.agentKey).toEqual({ step: "idle" });
  });

  it("needs a looked-up submission, and starts afresh with each lookup", async () => {
    const { store, deps } = setup();
    await store.createAgentKey();
    expect(deps.linkAgentKey).not.toHaveBeenCalled();
    store.setStatusInput("A");
    await store.lookup();
    await store.createAgentKey();
    await store.lookup();
    expect(store.state.status.agentKey).toEqual({ step: "idle" });
  });
});

describe("statistics", () => {
  it("loads fresh every time the view is shown, and records the view in the address", async () => {
    const { store, deps } = setup();
    store.setView("statistics");
    await vi.waitFor(() => expect(store.state.statistics.outcome?.kind).toBe("ok"));
    store.setView("submit");
    store.setView("statistics");
    expect(deps.fetchStatistics).toHaveBeenCalledTimes(2);
    // The test store opens on the submit view: its address is "#submit".
    expect(vi.mocked(deps.setAddress).mock.calls.map((call) => call[0])).toEqual(["", "#submit", ""]);
  });

  it("applies pickers at once and ranges only on apply", async () => {
    const { store, deps } = setup();
    store.choose({ panels: "portal" });
    expect(vi.mocked(deps.fetchStatistics).mock.calls.at(-1)?.[0]).toBe("panels=portal");
    store.choose({ multiplied: "include" });
    expect(vi.mocked(deps.fetchStatistics).mock.calls.at(-1)?.[0]).toBe("panels=portal&multiplied=include");
    store.setFormField("portalLevelMin", "6");
    store.setFormField("portalLevelMax", "8");
    expect(deps.fetchStatistics).toHaveBeenCalledTimes(2);
    store.applyFilters();
    expect(vi.mocked(deps.fetchStatistics).mock.calls.at(-1)?.[0]).toBe("panels=portal&multiplied=include&portalLevelMin=6&portalLevelMax=8");
    store.clearFilters();
    expect(vi.mocked(deps.fetchStatistics).mock.calls.at(-1)?.[0]).toBe("panels=portal&multiplied=include");
    expect(store.state.statistics.form.portalLevelMin).toBe("");
  });

  it("records the applied view in the address, not ranges still being typed", () => {
    const { store, deps } = setup();
    store.setView("statistics");
    const recorded = () => vi.mocked(deps.setAddress).mock.calls.at(-1)?.[0];
    store.choose({ split: "panelEffect" });
    expect(recorded()).toBe("?split=panelEffect");
    store.setFormField("portalLevelMin", "6");
    store.setFormField("portalLevelMax", "8");
    expect(recorded()).toBe("?split=panelEffect");
    store.applyFilters();
    expect(recorded()).toBe("?split=panelEffect&portalLevelMin=6&portalLevelMax=8");
    store.setSearch("shield");
    store.sortBy("item");
    expect(recorded()).toBe("?split=panelEffect&portalLevelMin=6&portalLevelMax=8&q=shield&sort=item");
  });

  it("opens a linked view as it was seen, with its filters shown", async () => {
    const saved = new Map<string, string>();
    const { deps } = setup();
    const linked = viewFromQuery("split=glyphCount&portalLevelMin=6&portalLevelMax=6&q=res&group=4");
    const store = new Store({ ...deps, storage: { get: (key) => saved.get(key) ?? null, set: () => {} } }, "statistics", "en", linked);
    expect(store.state.statistics).toMatchObject({ search: "res", gridGroup: "4", filtersOpen: true });
    await store.loadStatistics();
    expect(vi.mocked(deps.fetchStatistics).mock.calls.at(-1)?.[0]).toBe("split=glyphCount&portalLevelMin=6&portalLevelMax=6");
    // Already the page's address: nothing to record.
    expect(deps.setAddress).not.toHaveBeenCalled();
  });

  it("copies a link to the view and says so", async () => {
    const { store, deps } = setup();
    await store.copyLink("https://stats.test/?split=panelEffect");
    expect(deps.copy).toHaveBeenCalledWith("https://stats.test/?split=panelEffect");
    expect(store.state.notice).toEqual({ id: "linkCopied" });
    vi.mocked(deps.copy).mockRejectedValueOnce(new Error("refused"));
    await store.copyLink("https://stats.test/");
    expect(store.state.notice).toEqual({ id: "linkCopyFailed" });
  });

  it("keeps the alignment and split through Clear, and starts a new split's grid from every record", () => {
    const { store, deps } = setup();
    store.choose({ alignment: "enemy", split: "glyphCount" });
    expect(vi.mocked(deps.fetchStatistics).mock.calls.at(-1)?.[0]).toBe("alignment=enemy&split=glyphCount");
    store.setGridGroup("4");
    store.choose({ kind: "hack" });
    expect(store.state.statistics.gridGroup).toBe("4");
    store.choose({ split: "portalLevel" });
    expect(store.state.statistics.gridGroup).toBeNull();
    store.clearFilters();
    expect(vi.mocked(deps.fetchStatistics).mock.calls.at(-1)?.[0]).toBe("kind=hack&alignment=enemy&split=portalLevel");
  });

  it("opens and closes the sample details", () => {
    const { store } = setup();
    expect(store.state.statistics.sampleOpen).toBe(false);
    store.toggleSample();
    expect(store.state.statistics.sampleOpen).toBe(true);
  });

  it("drops a slow answer for an earlier filter", async () => {
    const answers = [deferred<StatisticsOutcome>(), deferred<StatisticsOutcome>()];
    let call = 0;
    const { store } = setup({ fetchStatistics: () => answers[call++].promise });
    const first = store.loadStatistics({ ...EMPTY_FORM, kind: "hack" });
    const second = store.loadStatistics({ ...EMPTY_FORM, kind: "drop" });
    answers[1].resolve({ kind: "refused", issues: [{ code: "x", message: "newer" }] });
    answers[0].resolve({ kind: "failed", problem: { kind: "network", detail: "older" } });
    await Promise.all([first, second]);
    expect(store.state.statistics.outcome).toMatchObject({ kind: "refused" });
  });

  it("sorts, searches and downloads the item table", async () => {
    const { store, deps } = setup();
    store.sortBy("item");
    expect(store.state.statistics.sort).toEqual({ key: "item", descending: false });
    store.sortBy("item");
    expect(store.state.statistics.sort).toEqual({ key: "item", descending: true });
    store.setSearch("mod");
    expect(store.state.statistics.search).toBe("mod");
    store.downloadTsv();
    expect(deps.download).not.toHaveBeenCalled();
    await store.loadStatistics();
    store.downloadTsv();
    expect(vi.mocked(deps.download).mock.calls[0][0]).toBe("glyph-drop-stats-items.tsv");
  });
});

describe("dialogs", () => {
  it("reports the first-visit note, the guide and the withdrawal confirmation as open dialogs", async () => {
    const { store } = setup();
    store.setView("statistics");
    expect(store.dialogOpen()).toBe(true); // the first-visit note
    store.dismissDisclaimer();
    expect(store.dialogOpen()).toBe(false);
    store.setGuideOpen(true);
    expect(store.dialogOpen()).toBe(true);
    store.setGuideOpen(false);
    store.setView("submit");
    store.setStatusInput("A");
    await store.lookup();
    expect(store.dialogOpen()).toBe(false);
    store.startWithdraw();
    expect(store.dialogOpen()).toBe(true);
    store.cancelWithdraw();
    expect(store.dialogOpen()).toBe(false);
  });
});

describe("per-viewer preferences", () => {
  it("shows the first-visit note until it is dismissed", () => {
    const first = setup();
    expect(first.store.state.statistics.disclaimerOpen).toBe(true);
    first.store.dismissDisclaimer();
    expect(first.saved.get(DISCLAIMER_KEY)).toBe("1");
    expect(first.store.state.statistics.disclaimerOpen).toBe(false);
  });
});

describe("language", () => {
  it("starts in the given language, switches, and remembers the choice", () => {
    const { store, saved } = setup({}, "ja");
    expect(store.state.locale).toBe("ja");
    store.setLocale("ko");
    expect(store.state.locale).toBe("ko");
    expect(store.strings.language.name).toBe("한국어");
    expect(saved.get(LOCALE_KEY)).toBe("ko");
  });

  it("writes the receipt file in the page's language", async () => {
    const { store, deps } = await checkedStore();
    store.setLocale("zh-Hans");
    store.createReceipt();
    store.downloadReceipt();
    const [, text] = vi.mocked(deps.download).mock.calls[0];
    expect(text).toContain(store.strings.receiptFile.title);
    expect(text).toContain(`gds1_${"a".repeat(43)}`);
  });
});

describe("a deployment with submissions closed", () => {
  it("still checks files but makes no receipt", async () => {
    const { store } = await checkedStore({ fetchConfig: async () => ({ submissionsOpen: false, testPeriod: false }) });
    await store.loadConfig();
    expect(store.state.submissionsOpen).toBe(false);
    expect(store.state.check.phase).toBe("done");
    store.createReceipt();
    expect(store.state.submit).toEqual({ step: "explain" });
  });

  it("assumes nothing when the setting can't be read", async () => {
    const { store } = setup({ fetchConfig: async () => null });
    await store.loadConfig();
    expect(store.state.submissionsOpen).toBeNull();
    expect(store.state.testPeriod).toBe(false);
  });
});

describe("a deployment in a test period", () => {
  it("makes receipts and says everything will be deleted", async () => {
    const { store } = await checkedStore({ fetchConfig: async () => ({ submissionsOpen: true, testPeriod: true }) });
    expect(store.state.testPeriod).toBe(false);
    await store.loadConfig();
    expect(store.state.testPeriod).toBe(true);
    store.createReceipt();
    expect(store.state.submit.step).toBe("receipt");
  });
});

describe("announcements", () => {
  /** What the live region says for each change `act` makes. */
  async function said(store: Store, act: () => unknown): Promise<string | null> {
    const before = store.state;
    await act();
    return announcement(before, store.state);
  }

  it("says what a check, a receipt and a confirmation did", async () => {
    const preview = { ok: true, rowCount: 7, records: { valid: 6, rejected: 1 } } as unknown as Preview;
    const { store } = setup({ previewFile: vi.fn(async (): Promise<PreviewOutcome> => ({ kind: "ok", preview })) });
    store.chooseFile(fileA);
    expect(await said(store, () => store.checkFile())).toBe("Checked: 6 valid records, 1 unusable.");
    expect(await said(store, () => store.createReceipt())).toBe(`Receipt created: gds1_${"a".repeat(43)}`);
    store.setSaved(true);
    expect(await said(store, () => store.send())).toBe("Submitted");
  });

  it("says a copied receipt every time, and names a new view or language", async () => {
    const { store } = await checkedStore();
    store.createReceipt();
    expect(await said(store, () => store.copyReceipt())).toBe("Receipt copied");
    expect(await said(store, () => store.copyReceipt())).toBe("Receipt copied");
    expect(await said(store, () => store.setView("statistics"))).toBe("Statistics");
    expect(await said(store, () => store.setLocale("ko"))).toBe("한국어");
  });

  it("stays quiet when nothing worth saying changed", async () => {
    const { store } = setup();
    expect(await said(store, () => store.setSearch("res"))).toBeNull();
  });
});
