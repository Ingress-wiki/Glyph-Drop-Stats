import { useState } from "react";
import type { Preview } from "../domain/preview.ts";
import { newReceiptSecret, receiptText } from "../domain/receipt.ts";
import type { SubmissionSummary } from "../domain/submission.ts";
import { RetryableError, submit } from "./api.ts";
import { OutcomeList } from "./Outcomes.tsx";

type Phase =
  | { step: "explain" }
  | { step: "receipt"; secret: string; saved: boolean }
  | { step: "sending"; secret: string }
  | { step: "retry"; secret: string; message: string }
  | { step: "refused"; message: string }
  | { step: "done"; secret: string; summary: SubmissionSummary; replayed: boolean };

function downloadReceipt(secret: string) {
  const blob = new Blob([receiptText(secret, window.location.origin, new Date())], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "glyph-drop-stats-receipt.txt";
  link.click();
  URL.revokeObjectURL(url);
}

/** Submits exactly the file whose preview is shown; the parent remounts this for a new file. */
export function SubmitPanel({ file, preview }: { file: File; preview: Extract<Preview, { ok: true }> }) {
  const [phase, setPhase] = useState<Phase>({ step: "explain" });

  async function send(secret: string) {
    setPhase({ step: "sending", secret });
    try {
      const response = await submit(file, secret);
      if (response.ok) {
        setPhase({ step: "done", secret, summary: response.submission, replayed: response.replayed });
      } else {
        setPhase({ step: "refused", message: response.issues.map((issue) => issue.message).join(" ") });
      }
    } catch (error) {
      // The upload may or may not have committed. Retrying with the same receipt is safe either way.
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RetryableError) setPhase({ step: "retry", secret, message });
      else setPhase({ step: "refused", message });
    }
  }

  if (phase.step === "done") {
    return (
      <section>
        <h2>Submitted</h2>
        <p>{phase.replayed ? "This upload had already been confirmed; nothing was counted twice." : "Thank you."}</p>
        <OutcomeList outcomes={phase.summary.outcomes} />
        <ReceiptBox secret={phase.secret} />
      </section>
    );
  }

  return (
    <section>
      <h2>Submit</h2>
      <ul>
        <li>
          Only the checked fields of {preview.records.valid} valid records are stored, never the file itself. Unusable
          records aren't stored.
        </li>
        <li>
          You get a private receipt. It is the only way to see or withdraw this submission, and it can't be recovered if
          lost.
        </li>
        <li>
          Withdrawing removes this submission's support. A record another active submission also supplied stays in the
          statistics.
        </li>
        <li>
          A record already accepted from an earlier submission isn't replaced. A different or more complete copy is kept
          for review.
        </li>
      </ul>
      {phase.step === "explain" && (
        <button type="button" onClick={() => setPhase({ step: "receipt", secret: newReceiptSecret(), saved: false })}>
          Create my receipt
        </button>
      )}
      {phase.step !== "explain" && phase.step !== "refused" && <ReceiptBox secret={phase.secret} />}
      {phase.step === "receipt" && (
        <p>
          <label>
            <input
              type="checkbox"
              checked={phase.saved}
              onChange={(event) => setPhase({ ...phase, saved: event.target.checked })}
            />{" "}
            I've saved my receipt
          </label>{" "}
          <button type="button" disabled={!phase.saved} onClick={() => send(phase.secret)}>
            Submit {preview.records.valid} records
          </button>
        </p>
      )}
      {phase.step === "sending" && <p>Submitting…</p>}
      {phase.step === "retry" && (
        <p className="error">
          Couldn't confirm the submission ({phase.message}). It may have gone through.{" "}
          <button type="button" onClick={() => send(phase.secret)}>
            Try again with the same receipt
          </button>
        </p>
      )}
      {phase.step === "refused" && <p className="error">Not submitted: {phase.message}</p>}
    </section>
  );
}

function ReceiptBox({ secret }: { secret: string }) {
  return (
    <div className="receipt">
      <p>
        <strong>Your receipt.</strong> Keep it private.
      </p>
      <code>{secret}</code>{" "}
      <button type="button" onClick={() => downloadReceipt(secret)}>
        Download
      </button>
    </div>
  );
}
