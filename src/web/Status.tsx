import { useRef, useState, type FormEvent } from "react";
import { isReceiptSecret } from "../domain/receipt.ts";
import { submissionStatus, type StatusOutcome } from "./api.ts";
import { LatestOnly, STALE } from "./latest.ts";
import { OutcomeList } from "./Outcomes.tsx";

export function StatusCheck() {
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<StatusOutcome | null>(null);
  // An answer for a receipt that has since been changed must never be shown under the new one.
  const latest = useRef(new LatestOnly());

  async function check(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    try {
      const outcome = await latest.current.run((signal) => submissionStatus(secret.trim(), signal));
      if (outcome !== STALE) setResult(outcome);
    } catch (error) {
      setResult({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <section>
      <h2>Check a submission</h2>
      <form onSubmit={check}>
        <input
          type="password"
          autoComplete="off"
          placeholder="gds1_…"
          aria-label="Receipt"
          value={secret}
          onChange={(event) => {
            latest.current.cancel();
            setSecret(event.target.value);
            setResult(null);
          }}
        />{" "}
        <button type="submit" disabled={!isReceiptSecret(secret.trim())}>
          Check
        </button>
      </form>
      {result?.kind === "found" && (
        <>
          <p>
            {result.submission.status === "completed" ? "Active" : "Withdrawn"}, submitted{" "}
            {new Date(result.submission.createdAt * 1000).toLocaleString()}. {result.submission.rowCount} rows;{" "}
            {result.submission.rejected} unusable records weren't stored.
          </p>
          <OutcomeList outcomes={result.submission.outcomes} />
        </>
      )}
      {result?.kind === "refused" && <p className="error">{result.issues.map((issue) => issue.message).join(" ")}</p>}
      {result?.kind === "failed" && <p className="error">Couldn't check: {result.message}</p>}
    </section>
  );
}
