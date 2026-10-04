import { useState, type FormEvent } from "react";
import { isReceiptSecret } from "../domain/receipt.ts";
import { submissionStatus, type StatusResponse } from "./api.ts";
import { OutcomeList } from "./Outcomes.tsx";

export function StatusCheck() {
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState<StatusResponse | { ok: false; message: string } | null>(null);

  async function check(event: FormEvent) {
    event.preventDefault();
    try {
      setResult(await submissionStatus(secret.trim()));
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
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
            setSecret(event.target.value);
            setResult(null);
          }}
        />{" "}
        <button type="submit" disabled={!isReceiptSecret(secret.trim())}>
          Check
        </button>
      </form>
      {result?.ok === true && (
        <>
          <p>
            {result.submission.status === "completed" ? "Active" : "Withdrawn"}, submitted{" "}
            {new Date(result.submission.createdAt * 1000).toLocaleString()}. {result.submission.rowCount} rows;{" "}
            {result.submission.rejected} unusable records weren't stored.
          </p>
          <OutcomeList outcomes={result.submission.outcomes} />
        </>
      )}
      {result?.ok === false && (
        <p className="error">{"issues" in result ? result.issues.map((issue) => issue.message).join(" ") : result.message}</p>
      )}
    </section>
  );
}
