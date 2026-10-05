import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Preview } from "../domain/preview.ts";
import { LatestOnly, STALE } from "./latest.ts";
import { OutcomeList } from "./Outcomes.tsx";
import { StatisticsView } from "./Statistics.tsx";
import { StatusCheck } from "./Status.tsx";
import { SubmitPanel } from "./Submit.tsx";

type State =
  | { phase: "idle" }
  | { phase: "checking" }
  /** `file` is the exact file this preview describes; only it may be submitted. */
  | { phase: "done"; file: File; preview: Preview; checkId: number }
  | { phase: "failed"; message: string };

function isPreview(value: unknown): value is Preview {
  return typeof value === "object" && value !== null && "ok" in value;
}

type View = "statistics" | "submit";

/** The statistics dashboard is the root page; `#submit` opens the submit view. */
const viewFromHash = (): View => (window.location.hash === "#submit" ? "submit" : "statistics");

export function App() {
  const [view, setViewState] = useState<View>(viewFromHash);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  // A slow answer for an earlier file must never be shown, or later confirmed, while another
  // file is selected.
  const latest = useRef(new LatestOnly());
  const checks = useRef(0);

  useEffect(() => {
    const follow = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  function setView(next: View) {
    setViewState(next);
    const url = next === "submit" ? "#submit" : window.location.pathname + window.location.search;
    window.history.replaceState(null, "", url);
  }

  async function check(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setState({ phase: "checking" });
    try {
      const preview = await latest.current.run(async (signal) => {
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "text/csv" },
          body: file,
          signal,
        });
        const body: unknown = await response.json();
        if (!isPreview(body)) throw new Error(`Unexpected response (${response.status}).`);
        return body;
      });
      if (preview !== STALE) setState({ phase: "done", file, preview, checkId: ++checks.current });
    } catch (error) {
      setState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <>
      <div className="frame" aria-hidden="true" />
      <div className="app">
        <header className="topbar">
          <h1 className="wordmark">Glyph Drop Stats</h1>
          <nav className="tabs" aria-label="Views">
            {(["statistics", "submit"] as const).map((name) => (
              <button
                key={name}
                type="button"
                aria-current={view === name ? "page" : undefined}
                onClick={() => setView(name)}
              >
                {name === "submit" ? "Submit" : "Statistics"}
              </button>
            ))}
          </nav>
        </header>
        <main>
          {/* Statistics load fresh each time they are shown. */}
          {view === "statistics" && <StatisticsView />}
          {/* The submit view stays mounted while hidden, so switching never discards a receipt or a check in progress. */}
          <div className="page" hidden={view !== "submit"}>
            <p className="lede">
              Check a DynamicGlyph gear export (<code>DynamicGlyph-gear-v1-….csv</code>), then submit it if you want
              to. Checking stores nothing.
            </p>
            <section>
              <h2>Check a file</h2>
              <form className="toolbar bare" onSubmit={check}>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Export file"
                  onChange={(event) => {
                    latest.current.cancel();
                    setFile(event.target.files?.[0] ?? null);
                    setState({ phase: "idle" });
                  }}
                />
                <button type="submit" disabled={!file || state.phase === "checking"}>
                  {state.phase === "checking" ? "Checking…" : "Check file"}
                </button>
              </form>
            </section>
            {state.phase === "failed" && <p className="error">Couldn't check the file: {state.message}</p>}
            {state.phase === "done" && <PreviewView preview={state.preview} />}
            {state.phase === "done" && state.preview.ok && state.preview.records.valid > 0 && (
              <SubmitPanel key={state.checkId} file={state.file} preview={state.preview} />
            )}
            <StatusCheck />
          </div>
        </main>
        <footer className="footer">
          Code under the MIT licence · No accounts; original files are never stored · Data from DynamicGlyph exports
          players chose to submit · Not affiliated with Niantic or Ingress; item names are theirs
        </footer>
      </div>
    </>
  );
}

function PreviewView({ preview }: { preview: Preview }) {
  if (!preview.ok) {
    return (
      <section>
        <h2>This file can't be used</h2>
        <ul className="error">
          {preview.issues.map((issue, index) => (
            <li key={index}>
              {issue.message}
              {issue.line !== undefined && ` (line ${issue.line})`}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const { records } = preview;
  return (
    <>
      <section>
        <h2>Summary</h2>
        <dl>
          <dt>Rows</dt>
          <dd>{preview.rowCount}</dd>
          <dt>Valid records</dt>
          <dd>
            {records.valid} ({records.byKind.hack} hacks, {records.byKind.drop} drop groups)
          </dd>
          <dt>Gear read</dt>
          <dd>
            {records.byReadStatus.read} read ({records.partlyRead} partly), {records.byReadStatus.notRead} not read,{" "}
            {records.byReadStatus.unavailable} unavailable, {records.byReadStatus.unsupported} unsupported
          </dd>
          <dt>Compared with accepted data</dt>
          <dd>
            <OutcomeList outcomes={preview.outcomes} />
          </dd>
          <dt>Unusable records</dt>
          <dd>{records.rejected}</dd>
          <dt>Exported by</dt>
          <dd>
            DynamicGlyph {preview.exporter.appVersion ?? "?"} ({preview.exporter.appBuild ?? "?"}), format v
            {preview.formatVersion}
          </dd>
        </dl>
        {preview.warnings.map((warning, index) => (
          <p key={index}>{warning.message}</p>
        ))}
      </section>
      {preview.rejected.length > 0 && (
        <section>
          <h2>Unusable records</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Lines</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {preview.rejected.map((rejected, index) => (
                  <tr key={index}>
                    <td>
                      <code>{rejected.recordId ?? "unknown"}</code>
                    </td>
                    <td>{rejected.lines.join(", ")}</td>
                    <td>
                      {rejected.issues.map((issue, issueIndex) => (
                        <div key={issueIndex}>{issue.message}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
