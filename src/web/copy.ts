import type { Coverage, ItemExclusion, UnplacedReason } from "../domain/statistics.ts";
import type { Outcome } from "../domain/versions.ts";

/** Everything the page says, shared by the canvas and its accessible mirror. */

// Each label follows a count: "2 with no portal level".
export const UNPLACED_LABELS: Record<UnplacedReason, string> = {
  crosses_utc_boundary: "whose interval crosses a boundary of the UTC dates",
  no_local_time: "with no local time (recorded in UTC only)",
  no_local_hour: "with no local hour (whole-day interval)",
  no_portal_level: "with no portal level (includes every drop)",
  portal_level_crosses_filter: "whose portal level range crosses the filter",
  no_hacking_bonus: "with no hacking bonus (includes every drop)",
  hacking_bonus_not_final: "whose hacking bonus isn't final",
  no_speed_bonus: "with no speed bonus (includes every drop)",
  speed_bonus_not_final: "whose speed bonus isn't final",
};

export const COVERAGE_LABELS: Record<Coverage, string> = {
  both_panels_in_full: "with portal and bonus panels read in full",
  seen_panels_in_full: "with every panel seen read in full",
  partly_read: "with a panel partly read, or a row unidentified",
  no_panel: "read, but with no panel seen",
  notRead: "not read (timed out or capture lost)",
  unavailable: "with no gear reading",
  unsupported: "saved in an unsupported format",
};

export const EXCLUSION_LABELS: Record<ItemExclusion, string> = {
  no_reading: "with no gear reading",
  panel_not_seen: "without the selected panel",
  partly_read: "with the selected panel partly read",
  unidentified_items: "with an unreadable item or level",
  unlisted_item_names: "with an item name awaiting review",
};

export const PANEL_LABELS = { portal: "portal panel", bonus: "bonus panel", both: "portal and bonus panels" } as const;
export const OUTCOME_LABELS: Record<Outcome, string> = {
  new: "new records",
  duplicate: "already submitted",
  duplicate_other_precision: "already submitted, with a different time precision",
  update_candidate: "more complete than the accepted copy",
  conflict: "different from the accepted copy",
};

export const HELD: ReadonlySet<Outcome> = new Set(["update_candidate", "conflict"]);

export const SUBMIT_NOTES = [
  "Only the checked fields of the valid records are stored, never the file itself. Unusable records aren't stored.",
  "You get a private receipt. It is the only way to see or withdraw this submission, and it can't be recovered if lost.",
  "Withdrawing removes this submission's support. A record another active submission also supplied stays in the statistics.",
  "A record already accepted from an earlier submission isn't replaced. A different or more complete copy is kept for review.",
];

export const WITHDRAW_NOTE =
  "Withdrawal stops this submission contributing to statistics. It does not currently delete its stored data. It can't be undone. A record that another active submission also supplied keeps counting, and no other version of a record takes its place.";

export const GUIDE = [
  "Records are hacks and drop groups players submitted. Each counts once, as its accepted version. Withdrawn submissions, conflicting copies and unreviewed updates don't count.",
  "Eligible observations had their gear read, with every selected panel seen, read in full and every item identified. Anything less is left out and counted below the table: a missing panel is unknown, not zero.",
  "Per observation is quantity ÷ eligible observations, including observations without that item.",
  "Shading brightens as a value approaches its column's largest. It means more, not better.",
  "Filters that can't judge a record (a drop has no portal level; an old record has no local time) set it aside and say so, instead of guessing.",
  "Only what the app read is here, and players choose what to submit. Agent level, faction, mods and hack type aren't recorded. There are no confidence intervals: records cluster by player and session.",
];

export const DISCLAIMER =
  "These are descriptive counts of what players chose to submit, from what the DynamicGlyph app managed to read on their screens. They are not the drop rate of every hack played. Drop groups aren't confirmed hacks, the app can misread, and files can be edited. Brighter cells mean more items in that column; they don't mean better, rarer or certain.";

export const NOTICES =
  "Code under the MIT licence. Drawn with synth-ui (MIT, © Cyandev). Mixed-case text uses the X.org misc-fixed 5×7 font (public domain). Licence texts: /licenses/. Not affiliated with Niantic or Ingress; item names are theirs.";
