import type { AccountView } from "../domain/account.ts";
import { isReceiptSecret } from "../domain/receipt.ts";
import type { AccountConfirm, AccountMessage, AccountState, AppState, Store } from "./app/store.ts";
import type { Messages } from "./i18n/en.ts";
import { messages, problemText, type Locale } from "./i18n/index.ts";
import { accountMessageText } from "./messages.ts";

const when = (locale: Locale, seconds: number) => new Date(seconds * 1000).toLocaleString(locale);

function Message({ s, message }: { s: Messages; message: AccountMessage | null }) {
  const text = accountMessageText(s, message);
  if (!text || !message) return null;
  return message.kind === "done" ? (
    <p role="status" data-testid="account-message">
      {text}
    </p>
  ) : (
    <p className={message.kind === "cancelled" ? "muted" : "error"} role="alert" data-testid="account-message">
      {text}
    </p>
  );
}

const sameConfirm = (a: AccountConfirm | null, b: AccountConfirm) => a !== null && a.what === b.what && ("id" in a ? "id" in b && a.id === b.id : true);

/** A button for a change that can't be undone: the first press asks, inline, and the second does it. */
function Confirmed({ store, account, s, ask, label, question }: { store: Store; account: AccountState; s: Messages; ask: AccountConfirm; label: string; question: string }) {
  if (!sameConfirm(account.confirm, ask)) {
    return (
      <button type="button" className="danger" disabled={account.busy !== null} onClick={() => store.askAccount(ask)}>
        {label}
      </button>
    );
  }
  return (
    <div className="confirm-inline" role="group" aria-label={question}>
      <p>{question}</p>
      <div className="actions">
        <button type="button" className="danger" disabled={account.busy !== null} onClick={() => void store.confirmAccount()}>
          {s.account.confirm}
        </button>
        <button type="button" disabled={account.busy !== null} onClick={() => store.cancelAccountConfirm()} autoFocus>
          {s.account.keep}
        </button>
      </div>
    </div>
  );
}

/**
 * The optional account. Signed out, it says what an account is for and what
 * it keeps; signed in, it shows the player's own submissions, agent keys and
 * passkeys, each with what can be done to it.
 */
export function AccountPage({ store, state }: { store: Store; state: AppState }) {
  const s = messages(state.locale);
  const { account } = state;
  return (
    <div className="page account">
      {account.view ? <SignedIn store={store} state={state} s={s} view={account.view} /> : <SignedOut store={store} state={state} s={s} />}
    </div>
  );
}

function SignedOut({ store, state, s }: { store: Store; state: AppState; s: Messages }) {
  const { account } = state;
  const busy = account.busy !== null;
  return (
    <>
      <section>
        <h2>
          {s.account.heading} <span className="tag">{s.account.optional}</span>
        </h2>
        <p className="lede">{s.account.lede}</p>
        {account.loadProblem && (
          <p className="error" role="alert">
            {s.account.loadFailed(problemText(s, account.loadProblem))}
          </p>
        )}
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void store.createAccount()}>
            {s.account.create}
          </button>
          <button type="button" disabled={busy} onClick={() => void store.signIn()}>
            {s.account.signIn}
          </button>
        </div>
        {(account.busy === "register" || account.busy === "signIn") && <p className="muted">{s.account.working}</p>}
        <Message s={s} message={account.message} />
      </section>
      <section>
        <h2>{s.account.storedHeading}</h2>
        <ul>
          {s.account.stored.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {state.testPeriod && <p className="notice">{s.account.testPeriod}</p>}
      </section>
    </>
  );
}

function SignedIn({ store, state, s, view }: { store: Store; state: AppState; s: Messages; view: AccountView }) {
  const { account, locale } = state;
  const busy = account.busy !== null;
  const ready = isReceiptSecret(account.receiptInput.trim());
  return (
    <>
      <section>
        <h2>{s.account.yours}</h2>
        <p className="muted">{s.account.created(when(locale, view.createdAt))}</p>
        <Message s={s} message={account.message} />
        {busy && <p className="muted">{account.busy === "addPasskey" ? s.account.working : s.account.sending}</p>}
        <button type="button" disabled={busy} onClick={() => void store.signOut()}>
          {s.account.signOut}
        </button>
      </section>

      <section data-testid="account-submissions">
        <h2>{s.account.submissionsHeading}</h2>
        {state.testPeriod && <p className="notice">{s.account.testPeriod}</p>}
        {view.submissions.length === 0 && <p className="muted">{s.account.noSubmissions}</p>}
        <ul className="rows">
          {view.submissions.map((submission) => (
            <li key={submission.id}>
              <span>
                {s.status.line(
                  submission.withdrawnAt === null ? s.status.active : s.status.withdrawnAt(when(locale, submission.withdrawnAt)),
                  when(locale, submission.createdAt),
                  submission.rowCount,
                  submission.rejected,
                )}
              </span>
              {submission.status === "completed" && (
                <Confirmed store={store} account={account} s={s} ask={{ what: "withdraw", id: submission.id }} label={s.account.withdraw} question={s.account.withdrawConfirm} />
              )}
            </li>
          ))}
        </ul>
        <form
          className="toolbar bare"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) void store.addReceiptToAccount();
          }}
        >
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="receipt-field"
            aria-label={s.account.addField}
            placeholder={s.account.addPlaceholder}
            title={s.status.hint}
            value={account.receiptInput}
            disabled={busy}
            onChange={(event) => store.setAccountReceipt(event.target.value)}
          />
          <button type="submit" disabled={busy || !ready}>
            {s.account.add}
          </button>
        </form>
      </section>

      <section data-testid="account-keys">
        <h2>{s.account.keysHeading}</h2>
        <p className="muted">{s.account.keysExplain}</p>
        {account.newKey && (
          <div className="receipt">
            <p className="label">{s.agentKey.yourKey}</p>
            <code data-testid="account-key-value" aria-label={s.agentKey.yourKey}>
              {account.newKey}
            </code>
            <div className="actions">
              <button type="button" onClick={() => void store.copyNewKey()}>
                {s.agentKey.copy}
              </button>
            </div>
            <p className="notice">{s.agentKey.shownOnce}</p>
          </div>
        )}
        {view.agentKeys.length === 0 && <p className="muted">{s.account.noKeys}</p>}
        <ul className="rows">
          {view.agentKeys.map((key) => (
            <li key={key.id}>
              <span>{s.account.key(when(locale, key.createdAt))}</span>
              <Confirmed store={store} account={account} s={s} ask={{ what: "revokeKey", id: key.id }} label={s.account.revoke} question={s.account.revokeConfirm} />
            </li>
          ))}
        </ul>
        <p>
          <button type="button" disabled={busy || account.newKey !== null} onClick={() => void store.createAccountKey()}>
            {s.account.createKey}
          </button>{" "}
          <a href="#agents">{s.agentKey.guide}</a>
        </p>
      </section>

      <section data-testid="account-passkeys">
        <h2>{s.account.passkeysHeading}</h2>
        <p className="muted">{s.account.passkeysExplain}</p>
        <ul className="rows">
          {view.passkeys.map((passkey) => (
            <li key={passkey.id}>
              <span>{s.account.passkey(when(locale, passkey.createdAt), passkey.lastUsedAt === null ? null : when(locale, passkey.lastUsedAt), passkey.backedUp)}</span>
              {view.passkeys.length > 1 && (
                <Confirmed store={store} account={account} s={s} ask={{ what: "removePasskey", id: passkey.id }} label={s.account.remove} question={s.account.removeConfirm} />
              )}
            </li>
          ))}
        </ul>
        <button type="button" disabled={busy} onClick={() => void store.addPasskey()}>
          {s.account.addPasskey}
        </button>
      </section>

      <section>
        <h2>{s.account.deleteHeading}</h2>
        <p className="muted">{s.account.deleteExplain}</p>
        <Confirmed store={store} account={account} s={s} ask={{ what: "delete" }} label={s.account.delete} question={s.account.deleteConfirm} />
      </section>
    </>
  );
}

/**
 * Beside a receipt the player holds (just submitted, or looked up): an offer
 * to keep its submission in the optional account. Nothing is offered until
 * the page knows whether someone is signed in, or if it couldn't tell.
 */
export function KeepInAccount({ store, state, s, secret }: { store: Store; state: AppState; s: Messages; secret: string }) {
  const { account } = state;
  if (!account.known || account.loadProblem) return null;
  const here = account.claimFor === secret;
  const added = here && account.message?.task === "claim" && account.message.kind === "done";
  const busy = account.busy !== null;
  return (
    <div className="keep-in-account" data-testid="keep-in-account">
      {added ? (
        <p role="status">
          {s.account.inAccount}{" "}
          <a href="#account">{s.account.open}</a>
        </p>
      ) : account.view ? (
        <button type="button" disabled={busy} onClick={() => void store.keepInAccount(secret)}>
          {s.account.offerSignedIn}
        </button>
      ) : (
        <>
          <p className="muted">{s.account.offer}</p>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void store.keepInAccount(secret, "register")}>
              {s.account.offerCreate}
            </button>
            <button type="button" disabled={busy} onClick={() => void store.keepInAccount(secret, "signIn")}>
              {s.account.offerSignIn}
            </button>
          </div>
        </>
      )}
      {here && busy && <p className="muted">{account.busy === "claim" ? s.account.sending : s.account.working}</p>}
      {here && !added && <Message s={s} message={account.message} />}
    </div>
  );
}
