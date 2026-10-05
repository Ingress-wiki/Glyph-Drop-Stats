import { describe, expect, it } from "vitest";
import type { SubmissionSummary } from "../src/domain/submission.ts";
import { confirmationMessage } from "../src/web/messages.ts";

const ACTIVE: SubmissionSummary = {
  status: "completed",
  createdAt: 1_791_158_163,
  withdrawnAt: null,
  rowCount: 7,
  rejected: 0,
  outcomes: { new: 3, duplicate: 0, duplicate_other_precision: 0, update_candidate: 0, conflict: 0 },
};
const WITHDRAWN: SubmissionSummary = { ...ACTIVE, status: "withdrawn", withdrawnAt: 1_791_160_000 };

describe("confirmationMessage", () => {
  it("thanks the player for a new submission", () => {
    expect(confirmationMessage(ACTIVE, false)).toEqual({ heading: "Submitted", text: "Thank you." });
  });

  it("says a replay counted nothing twice", () => {
    expect(confirmationMessage(ACTIVE, true).text).toContain("nothing was counted twice");
  });

  it("never calls a withdrawn submission submitted, even when replayed", () => {
    for (const replayed of [true, false]) {
      expect(confirmationMessage(WITHDRAWN, replayed)).toEqual({
        heading: "Already withdrawn",
        text: "This submission was already withdrawn. Retrying has not reactivated it.",
      });
    }
  });
});
