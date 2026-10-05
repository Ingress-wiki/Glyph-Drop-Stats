import { useRef, useState, type FormEvent } from "react";
import { isReceiptSecret } from "../domain/receipt.ts";
import type { SubmissionSummary } from "../domain/submission.ts";
import { submissionStatus, withdrawUpload, type StatusOutcome } from "./api.ts";
import { LatestOnly, STALE } from "./latest.ts";
import { OutcomeList } from "./Outcomes.tsx";

type Withdrawal =
  | { step: "idle" }
  | { step: "confirming" }
  | { step: "sending" }
  | { step: "uncertain"; message: string }
  | { step: "refused"; message: string };

/** A lookup's answer, with the receipt it was for: withdrawal acts on that receipt only. */
type Looked = { secret: string; outcome: StatusOutcome };

export function StatusCheck() {
  const [input, setInput] = useState("");
  const [looked, setLooked] = useState<Looked | null>(null);
  const [withdrawal, setWithdrawal] = useState<Withdrawal>({ step: "idle" });
  // An answer for a receipt that has since been changed must never be shown under the new one.
  const latest = useRef(new LatestOnly());
  const busy = withdrawal.step === "sending";

  async function check(event: FormEvent) {
    event.preventDefault();
    const secret = input.trim();
    setLooked(null);
    setWithdrawal({ step: "idle" });
    try {
      const outcome = await latest.current.run((signal) => submissionStatus(secret, signal));
      if (outcome !== STALE) setLooked({ secret, outcome });
    } catch (error) {
      setLooked({ secret, outcome: { kind: "failed", message: error instanceof Error ? error.message : String(error) } });
    }
  }

  async function withdraw(secret: string) {
    setWithdrawal({ step: "sending" });
    const outcome = await withdrawUpload(secret);
    switch (outcome.kind) {
      case "withdrawn":
        setLooked({ secret, outcome: { kind: "found", submission: outcome.submission } });
        setWithdrawal({ step: "idle" });
        return;
      case "refused":
        setWithdrawal({ step: "refused", message: outcome.issues.map((issue) => issue.message).join(" ") });
        return;
      case "uncertain":
        setWithdrawal({ step: "uncertain", message: outcome.message });
        return;
    }
  }

  const outcome = looked?.outcome;
  return (
    <section>
      <h2>Check or withdraw a submission</h2>
      <form className="toolbar bare" onSubmit={check}>
        <input
          type="password"
          autoComplete="off"
          placeholder="gds1_…"
          aria-label="Receipt"
          value={input}
          disabled={busy}
          onChange={(event) => {
            latest.current.cancel();
            setInput(event.target.value);
            setLooked(null);
            setWithdrawal({ step: "idle" });
          }}
        />{" "}
        <button type="submit" disabled={busy || !isReceiptSecret(input.trim())}>
          Check
        </button>
      </form>
      {looked && outcome?.kind === "found" && (
        <>
          <SummaryText submission={outcome.submission} />
          <OutcomeList outcomes={outcome.submission.outcomes} />
          {outcome.submission.status === "completed" && (
            <WithdrawControls
              withdrawal={withdrawal}
              onStart={() => setWithdrawal({ step: "confirming" })}
              onCancel={() => setWithdrawal({ step: "idle" })}
              onConfirm={() => withdraw(looked.secret)}
            />
          )}
        </>
      )}
      {outcome?.kind === "refused" && <p className="error">{outcome.issues.map((issue) => issue.message).join(" ")}</p>}
      {outcome?.kind === "failed" && <p className="error">Couldn't check: {outcome.message}</p>}
    </section>
  );
}

function SummaryText({ submission }: { submission: SubmissionSummary }) {
  const when = (seconds: number) => new Date(seconds * 1000).toLocaleString();
  return (
    <p>
      {submission.withdrawnAt === null ? "Active" : `Withdrawn ${when(submission.withdrawnAt)}`}, submitted{" "}
      {when(submission.createdAt)}. {submission.rowCount} rows; {submission.rejected} unusable records weren't stored.
    </p>
  );
}

function WithdrawControls(props: {
  withdrawal: Withdrawal;
  onStart: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { withdrawal } = props;
  if (withdrawal.step === "idle") {
    return (
      <button type="button" onClick={props.onStart}>
        Withdraw this submission
      </button>
    );
  }
  return (
    <div className="receipt">
      <p>
        Withdrawal stops this submission contributing to statistics. It does not currently delete its stored data. It
        can't be undone. A record that another active submission also supplied keeps counting, and no other version of a
        record takes its place.
      </p>
      {withdrawal.step === "confirming" && (
        <>
          <button type="button" onClick={props.onConfirm}>
            Withdraw
          </button>{" "}
          <button type="button" onClick={props.onCancel}>
            Keep it
          </button>
        </>
      )}
      {withdrawal.step === "sending" && <p>Withdrawing…</p>}
      {withdrawal.step === "uncertain" && (
        <p className="error">
          Couldn't confirm the withdrawal ({withdrawal.message}). It may have gone through.{" "}
          <button type="button" onClick={props.onConfirm}>
            Try again
          </button>
        </p>
      )}
      {withdrawal.step === "refused" && <p className="error">Not withdrawn: {withdrawal.message}</p>}
    </div>
  );
}
