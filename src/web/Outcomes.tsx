import type { Outcome } from "../domain/versions.ts";

const LABELS: Record<Outcome, string> = {
  new: "new records",
  duplicate: "already submitted",
  duplicate_other_precision: "already submitted, with a different time precision",
  update_candidate: "more complete than the accepted copy",
  conflict: "different from the accepted copy",
};

const HELD: ReadonlySet<Outcome> = new Set(["update_candidate", "conflict"]);

export function OutcomeList({ outcomes }: { outcomes: Record<Outcome, number> }) {
  const shown = (Object.keys(LABELS) as Outcome[]).filter((outcome) => outcomes[outcome] > 0);
  if (shown.length === 0) return null;
  return (
    <table className="outcomes">
      <tbody>
        {shown.map((outcome) => (
          <tr key={outcome}>
            <td className="count">{outcomes[outcome]}</td>
            <td>
              {LABELS[outcome]}
              {HELD.has(outcome) && <span className="tag outline">held for review</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
