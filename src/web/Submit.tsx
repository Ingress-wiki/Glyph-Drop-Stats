import type { Preview } from "../domain/preview.ts";
import { isReceiptSecret } from "../domain/receipt.ts";
import type { SubmissionSummary } from "../domain/submission.ts";
import type { Outcome } from "../domain/versions.ts";
import type { AppState, Store } from "./app/store.ts";
import type { Messages } from "./i18n/en.ts";
import { issuesText, issueText, messages, problemText, type Locale } from "./i18n/index.ts";
import { confirmationMessage } from "./messages.ts";

/** Outcomes held back from the statistics until someone reviews them. */
const HELD: ReadonlySet<Outcome> = new Set(["update_candidate", "conflict"]);

/** How many unusable records the preview lists; the rest are counted. */
const REJECTED_SHOWN = 40;

export function SubmitView({ store, state }: { store: Store; state: AppState }) {
  const s = messages(state.locale);
  const { check } = state;
  return (
    <div className="page">
      <p className="lede">{s.submit.lede}</p>
      <CheckSection store={store} state={state} s={s} />
      {check.phase === "failed" && (
        <p className="error" role="alert">
          {s.submit.checkFailed(problemText(s, check.problem))}
        </p>
      )}
      {check.phase === "done" && (
        <>
          <PreviewSection s={s} preview={check.preview} />
          {check.preview.ok && check.preview.records.valid > 0 && <SubmitSection store={store} state={state} s={s} valid={check.preview.records.valid} />}
        </>
      )}
      <StatusSection store={store} state={state} s={s} />
    </div>
  );
}

function CheckSection({ store, state, s }: { store: Store; state: AppState; s: Messages }) {
  const { file, check } = state;
  const checking = check.phase === "checking";
  return (
    <section>
      <h2>{s.submit.checkHeading}</h2>
      <form
        className="toolbar bare"
        onSubmit={(event) => {
          event.preventDefault();
          void store.checkFile();
        }}
      >
        {/* The native input says "no file" once cleared, so it hides behind a button and the line below names the file. */}
        <label className="file-button" title={s.submit.chooseFileHint}>
          <input
            id="file"
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              // Cleared, so choosing the same file again still counts as a choice.
              event.target.value = "";
              if (chosen) store.chooseFile(chosen);
            }}
          />
          {s.submit.chooseFile}
        </label>
        <button type="submit" className={file && check.phase === "idle" ? "primary" : undefined} disabled={!file || checking}>
          {checking ? s.submit.checking : s.submit.checkFile}
        </button>
      </form>
      <p className={file ? "file" : "file muted"} data-testid="file">
        {file ? s.submit.fileName(file.name) : s.submit.noFile}
      </p>
    </section>
  );
}

function Outcomes({ s, outcomes }: { s: Messages; outcomes: Record<Outcome, number> }) {
  const shown = (Object.keys(s.outcomes) as Outcome[]).filter((outcome) => outcomes[outcome] > 0);
  if (shown.length === 0) return null;
  return (
    <table className="counts">
      <tbody>
        {shown.map((outcome) => (
          <tr key={outcome}>
            <td className="count">{outcomes[outcome]}</td>
            <td>
              {s.outcomes[outcome]}
              {HELD.has(outcome) && <span className="tag outline">{s.heldForReview}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PreviewSection({ s, preview }: { s: Messages; preview: Preview }) {
  if (!preview.ok) {
    return (
      <section>
        <h2>{s.submit.cantUse}</h2>
        <ul className="issues" role="alert">
          {preview.issues.map((issue, index) => (
            <li key={index}>{issueText(s, issue)}</li>
          ))}
        </ul>
      </section>
    );
  }
  const { records } = preview;
  const shown = preview.rejected.slice(0, REJECTED_SHOWN);
  return (
    <section>
      <h2>{s.submit.summary}</h2>
      <p className="sr-only" data-testid="preview">
        {s.submit.previewMirror(preview.rowCount, records.valid, records.rejected)}
      </p>
      <dl>
        <dt>{s.submit.rows}</dt>
        <dd>{preview.rowCount}</dd>
        <dt>{s.submit.validRecords}</dt>
        <dd>{s.submit.validValue(records.valid, records.byKind.hack, records.byKind.drop)}</dd>
        <dt>{s.submit.gearRead}</dt>
        <dd>
          {s.submit.gearReadValue(records.byReadStatus.read, records.partlyRead, records.byReadStatus.notRead, records.byReadStatus.unavailable)}
        </dd>
        <dt>{s.submit.unusable}</dt>
        <dd>{records.rejected}</dd>
        <dt>{s.submit.exportedBy}</dt>
        <dd>{s.submit.exportedByValue(preview.exporter.appVersion ?? "?", preview.exporter.appBuild ?? "?", preview.formatVersion)}</dd>
        <dt>{s.submit.compared}</dt>
        <dd>
          <Outcomes s={s} outcomes={preview.outcomes} />
        </dd>
      </dl>
      {preview.warnings.map((warning, index) => (
        <p key={index} className="warning">
          {issueText(s, warning)}
        </p>
      ))}
      {preview.rejected.length > 0 && (
        <>
          <h3>
            {s.submit.unusableHeading} <span className="label">{preview.rejected.length}</span>
          </h3>
          <ul className="rejected">
            {shown.map((rejected, index) => (
              <li key={index}>
                <code>{s.submit.rejectedRecord(rejected.recordId, rejected.lines.join(", "))}</code>
                <ul>
                  {rejected.issues.map((issue, i) => (
                    <li key={i}>{issueText(s, { ...issue, line: undefined })}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {preview.rejected.length > shown.length && <p className="muted">{s.submit.more(preview.rejected.length - shown.length)}</p>}
        </>
      )}
    </section>
  );
}

/** The receipt in exact case, selectable, with ways to keep it. */
function Receipt({ store, s, secret }: { store: Store; s: Messages; secret: string }) {
  return (
    <div className="receipt">
      <p className="label">{s.submit.receiptHeading}</p>
      <code data-testid="receipt" aria-label={s.submit.yourReceipt}>
        {secret}
      </code>
      <div className="actions">
        <button type="button" title={s.submit.downloadHint} onClick={() => store.downloadReceipt()}>
          {s.submit.download}
        </button>
        <button type="button" title={s.submit.copyHint} onClick={() => void store.copyReceipt()}>
          {s.submit.copy}
        </button>
      </div>
    </div>
  );
}

function SubmitSection({ store, state, s, valid }: { store: Store; state: AppState; s: Messages; valid: number }) {
  const { submit } = state;
  if (submit.step === "done") {
    const message = confirmationMessage(s, submit.summary, submit.replayed);
    return (
      <section>
        <h2>{message.heading}</h2>
        <p data-testid="submitted">
          {message.heading}. {message.text}
        </p>
        <Outcomes s={s} outcomes={submit.summary.outcomes} />
        <Receipt store={store} s={s} secret={submit.secret} />
      </section>
    );
  }
  if (state.submissionsOpen === false && submit.step === "explain") {
    return (
      <section>
        <h2>{s.submit.heading}</h2>
        <p className="muted" data-testid="closed">
          {s.submit.closed}
        </p>
      </section>
    );
  }
  return (
    <section>
      <h2>{s.submit.heading}</h2>
      {state.testPeriod && <p className="notice">{s.app.testPeriod}</p>}
      <ul>
        {s.submit.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {submit.step === "explain" && (
        <button type="button" className="primary" onClick={() => store.createReceipt()}>
          {s.submit.createReceipt}
        </button>
      )}
      {submit.step === "refused" && (
        <p className="error" role="alert">
          {s.submit.refused(issuesText(s, submit.issues))}
        </p>
      )}
      {"secret" in submit && <Receipt store={store} s={s} secret={submit.secret} />}
      {submit.step === "receipt" && (
        <div className="confirm">
          <label className="check">
            <input type="checkbox" checked={submit.saved} onChange={(event) => store.setSaved(event.target.checked)} />
            {s.submit.saved}
          </label>
          <button type="button" className="primary" disabled={!submit.saved} onClick={() => void store.send()}>
            {s.submit.send(valid)}
          </button>
        </div>
      )}
      {submit.step === "sending" && <p className="muted">{s.submit.sending}</p>}
      {submit.step === "retry" && (
        <>
          <p className="error" role="alert">
            {s.submit.sendFailed(problemText(s, submit.problem))}
          </p>
          <button type="button" className="primary" onClick={() => void store.send()}>
            {s.submit.retry}
          </button>
        </>
      )}
    </section>
  );
}

function summaryLine(s: Messages, locale: Locale, summary: SubmissionSummary): string {
  const when = (seconds: number) => new Date(seconds * 1000).toLocaleString(locale);
  const state = summary.withdrawnAt === null ? s.status.active : s.status.withdrawnAt(when(summary.withdrawnAt));
  return s.status.line(state, when(summary.createdAt), summary.rowCount, summary.rejected);
}

function StatusSection({ store, state, s }: { store: Store; state: AppState; s: Messages }) {
  const { status } = state;
  const busy = status.withdrawal.step === "sending";
  const ready = isReceiptSecret(status.input.trim());
  const outcome = status.looked?.outcome;
  return (
    <section>
      <h2>{s.status.heading}</h2>
      <form
        className="toolbar bare"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy) void store.lookup();
        }}
      >
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          className="receipt-field"
          aria-label={s.a11y.receiptField}
          placeholder={s.status.placeholder}
          title={s.status.hint}
          value={status.input}
          disabled={busy}
          onChange={(event) => store.setStatusInput(event.target.value)}
        />
        <button type="submit" disabled={busy || status.checking || !ready}>
          {s.status.check}
        </button>
      </form>
      {status.checking && <p className="muted">{s.status.checking}</p>}
      {outcome?.kind === "found" && (
        <>
          <p data-testid="status">{summaryLine(s, state.locale, outcome.submission)}</p>
          <Outcomes s={s} outcomes={outcome.submission.outcomes} />
          {outcome.submission.status === "completed" && (
            <>
              {status.withdrawal.step === "idle" && (
                <button type="button" className="danger" onClick={() => store.startWithdraw()}>
                  {s.status.withdraw}
                </button>
              )}
              {status.withdrawal.step === "sending" && <p className="muted">{s.status.withdrawing}</p>}
              {status.withdrawal.step === "refused" && (
                <p className="error" role="alert">
                  {s.status.notWithdrawn(issuesText(s, status.withdrawal.issues))}
                </p>
              )}
            </>
          )}
        </>
      )}
      {outcome?.kind === "refused" && (
        <p className="error" role="alert">
          {issuesText(s, outcome.issues)}
        </p>
      )}
      {outcome?.kind === "failed" && (
        <p className="error" role="alert">
          {s.status.failed(problemText(s, outcome.problem))}
        </p>
      )}
    </section>
  );
}
