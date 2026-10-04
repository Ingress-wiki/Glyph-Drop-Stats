import type { Outcome } from "./versions.ts";

/** What the server reports about one submission to the holder of its receipt. */
export interface SubmissionSummary {
  status: "completed" | "withdrawn";
  /** Unix seconds. */
  createdAt: number;
  rowCount: number;
  /** Records in the file that failed validation; they were not stored. */
  rejected: number;
  outcomes: Record<Outcome, number>;
}
