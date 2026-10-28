import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { announcement } from "./app/announce.ts";
import type { AppState, Store, View } from "./app/store.ts";
import { LOCALES, messages, problemText, type Locale } from "./i18n/index.ts";
import { SOURCE_URL } from "./site.ts";
import { StatisticsView } from "./Statistics.tsx";
import { SubmitView } from "./Submit.tsx";

function useAppState(store: Store): AppState {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state,
  );
}

/** What the live region says: the latest change worth announcing, kept until the next. */
function useAnnouncement(store: Store): string {
  const [said, setSaid] = useState("");
  useEffect(() => {
    let previous = store.state;
    return store.subscribe(() => {
      const line = announcement(previous, store.state);
      previous = store.state;
      if (line) setSaid(line);
    });
  }, [store]);
  return said;
}

const TABS: readonly { view: View; key: string }[] = [
  { view: "statistics", key: "F1" },
  { view: "submit", key: "F2" },
];

export function App({ store }: { store: Store }) {
  const state = useAppState(store);
  const s = messages(state.locale);
  const said = useAnnouncement(store);
  const { view, statistics, status, notice } = state;
  const { withdrawal } = status;

  useEffect(() => {
    document.documentElement.lang = state.locale;
    document.title = s.app.title;
  }, [state.locale, s]);

  return (
    <>
      <div className="frame" aria-hidden="true" />
      <div className="app">
        <header className="topbar">
          <h1 className="wordmark">{s.app.title}</h1>
          <nav className="tabs" aria-label={s.app.views}>
            {TABS.map((tab) => (
              <button
                key={tab.view}
                type="button"
                aria-current={view === tab.view ? "page" : undefined}
                aria-keyshortcuts={tab.key}
                onClick={() => store.setView(tab.view)}
              >
                {tab.view === "statistics" ? s.app.statistics : s.app.submit}
              </button>
            ))}
          </nav>
          <div className="switches">
            <select aria-label={s.app.language} value={state.locale} onChange={(event) => store.setLocale(event.target.value as Locale)}>
              {LOCALES.map((locale) => (
                <option key={locale} value={locale} lang={locale}>
                  {messages(locale).language.name}
                </option>
              ))}
            </select>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer" title={s.app.source}>
              GitHub
            </a>
          </div>
        </header>
        <main>{view === "statistics" ? <StatisticsView store={store} state={state} /> : <SubmitView store={store} state={state} />}</main>
        <footer className="footer">
          <p>{s.notices}</p>
          <p className="keys">{s.app.keyboardHelp}</p>
        </footer>
      </div>
      <Toast notice={notice} text={notice ? s.notice[notice.id] : ""} />
      <div id="live" className="sr-only" aria-live="polite">
        {said}
      </div>

      <Modal open={view === "statistics" && statistics.disclaimerOpen} title={s.disclaimer.title} onClose={() => store.dismissDisclaimer()}>
        <p>{s.disclaimer.text}</p>
        <form method="dialog">
          <button type="submit" className="primary" data-autofocus>
            {s.disclaimer.ok}
          </button>
        </form>
      </Modal>
      <Modal open={view === "statistics" && statistics.guideOpen} title={s.guide.title} onClose={() => store.setGuideOpen(false)}>
        <ul>
          {s.guide.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <form method="dialog">
          <button type="submit" data-autofocus>
            {s.app.close}
          </button>
        </form>
      </Modal>
      <Modal
        open={view === "submit" && (withdrawal.step === "confirming" || withdrawal.step === "uncertain" || withdrawal.step === "sending")}
        title={s.withdraw.title}
        onClose={() => {
          if (withdrawal.step !== "sending") store.cancelWithdraw();
        }}
      >
        <p>{s.withdraw.note}</p>
        {withdrawal.step === "uncertain" && (
          <p className="error" role="alert">
            {s.withdraw.failed(problemText(s, withdrawal.problem))}
          </p>
        )}
        <div className="actions">
          <button type="button" className="danger" disabled={withdrawal.step === "sending"} onClick={() => void store.confirmWithdraw()}>
            {withdrawal.step === "uncertain" ? s.withdraw.retry : withdrawal.step === "sending" ? s.withdraw.confirming : s.withdraw.confirm}
          </button>
          <button type="button" disabled={withdrawal.step === "sending"} onClick={() => store.cancelWithdraw()} data-autofocus>
            {s.withdraw.keep}
          </button>
        </div>
      </Modal>
    </>
  );
}

/**
 * A short notice in the corner for a few seconds. The store makes a new
 * object for every notice, so the same message twice shows twice. The live
 * region reads it out; this is for the eyes.
 */
function Toast({ notice, text }: { notice: AppState["notice"]; text: string }) {
  const [expired, setExpired] = useState<AppState["notice"]>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setExpired(notice), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return notice && notice !== expired ? (
    <p className="toast" aria-hidden="true">
      {text}
    </p>
  ) : null;
}

/**
 * A native modal dialog: it keeps focus inside, closes on Escape and returns
 * focus to where it was when it closes. The store decides whether it is open.
 * Focus starts on the control marked `data-autofocus`: React's `autoFocus`
 * would fire while the dialog is still closed.
 */
function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal focuses the first control; a dialog names a safer one to start on.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        // Escape asks the store; the effect above closes the dialog if it agrees.
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
