import type { Outcome } from "../domain/versions.ts";

const LABELS: Record<Outcome, string> = {
  new: "new records",
  duplicate: "already submitted",
  duplicate_other_precision: "already submitted, with a different time precision",
  update_candidate: "more complete than the accepted copy (held for review)",
  conflict: "different from the accepted copy (held for review)",
};

export function OutcomeList({ outcomes }: { outcomes: Record<Outcome, number> }) {
  const shown = (Object.keys(LABELS) as Outcome[]).filter((outcome) => outcomes[outcome] > 0);
  if (shown.length === 0) return null;
  return (
    <ul>
      {shown.map((outcome) => (
        <li key={outcome}>
          {outcomes[outcome]} {LABELS[outcome]}
        </li>
      ))}
    </ul>
  );
}
