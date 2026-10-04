# Statistics (draft, milestone 4)

These rules govern every published number. They come before any query is
written.

## What the data is

- **Only what the app read.** A hack the app didn't follow, panels shown
  while capture was off, and a group with no row read are not in any export.
  The records are a sample of observations, not of all hacks.
- **Players choose what to upload.** That is self-selection. Memorable drops
  may be over-represented. No statistic here is the true drop rate of every
  hack.
- **A drop is a group of panels, not a confirmed hack.** `association` says
  how it was matched; `ordered` is first-in-first-out, not proof.
- **Not captured:** agent level, portal faction, mods, hack type. Drops
  depend on them.
- **OCR can misread, and files can be edited.** Nothing is signed.

## Rules

- Count records by distinct `record_id`, using the one version that counts
  (see `architecture.md`), never rows.
- **A record with an item name not yet on the server's list** is excluded
  from every metric that needs a complete item list, denominators included.
  The number of records excluded this way is shown. Metrics that don't
  depend on items, such as counts by reading status, still include it.
- **Blank is unknown.** A missing reading is never zero drops. A blank
  `multiplied` is neither true nor false.
- Every metric shows:
  - its denominator;
  - the inclusion rule;
  - how many records were excluded or unavailable, and why;
  - its limitations.
- **Eligibility for item averages** (proposed): a `read` record whose
  `observed_panels_read_in_full` is true. Partly read panels undercount, so
  they are reported, not averaged.
- **No confidence intervals in the first release.**
  - Records cluster by player, portal and session, and nothing identifies
    the player.
  - Uploads can't stand in for players: files split a player's history
    arbitrarily and may overlap.
  - So the first release publishes descriptive statistics, sample counts
    and limitations only. Intervals wait for a defensible sampling unit.
- **Records without a UTC offset** come from builds before the offset was
  kept; most current data is like this. Their intervals are UTC hours or
  days. They stay in every UTC-based analysis. They are excluded only from
  analyses that need the original local time, such as by local hour or
  local date. A time zone is never reconstructed for them.
- **Time.** Use the stored interval and its offset. A record whose interval
  overlaps an event boundary can't be assigned to either side and is
  reported separately. `time_basis` is when the app received the hack or
  group, which can fall in the next hour or day.
