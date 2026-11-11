import type { SubmissionSummary } from "./submission.ts";

/**
 * What a signed-in player's account page shows: only their own things. The
 * ids are handles for acting on one row (withdrawing a submission, removing
 * a passkey, revoking a key), never secrets.
 */
export interface AccountView {
  /** Unix seconds. */
  createdAt: number;
  submissions: (SubmissionSummary & { id: number })[];
  passkeys: { id: string; createdAt: number; lastUsedAt: number | null; backedUp: boolean }[];
  agentKeys: { id: number; createdAt: number }[];
}
