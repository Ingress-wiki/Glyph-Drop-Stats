import { useRef, useState, type FormEvent } from "react";
import type { Preview } from "../domain/preview.ts";
import { LatestOnly, STALE } from "./latest.ts";

type State =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "done"; preview: Preview }
  | { phase: "failed"; message: string };

function isPreview(value: unknown): value is Preview {
  return typeof value === "object" && value !== null && "ok" in value;
}

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  // A slow answer for an earlier file must never be shown, or later confirmed, while another
  // file is selected.
  const latest = useRef(new LatestOnly());

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
      if (preview !== STALE) setState({ phase: "done", preview });
    } catch (error) {
      setState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <main>
      <h1>Glyph Drop Stats</h1>
      <p className="lede">
        Check a DynamicGlyph gear export (<code>DynamicGlyph-gear-v1-….csv</code>). Checking stores nothing.
      </p>
      <section>
        <form onSubmit={check}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              latest.current.cancel();
              setFile(event.target.files?.[0] ?? null);
              setState({ phase: "idle" });
            }}
          />{" "}
          <button type="submit" disabled={!file || state.phase === "checking"}>
            {state.phase === "checking" ? "Checking…" : "Check file"}
          </button>
        </form>
      </section>
      {state.phase === "failed" && <p className="error">Couldn't check the file: {state.message}</p>}
      {state.phase === "done" && <PreviewView preview={state.preview} />}
    </main>
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
          <table>
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
        </section>
      )}
    </>
  );
}
