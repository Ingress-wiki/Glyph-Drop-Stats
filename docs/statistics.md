# Statistics

These rules govern every published number. They are implemented in
`src/domain/statistics.ts` and checked against hand-calculated synthetic
datasets (`tests/helpers/dataset.ts`). The endpoint is `GET /api/statistics`.

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

## Population

- **Only `counted_records`.** Each `record_id` counts once, as its accepted
  version, however many submissions supplied it.
- **What doesn't count:** withdrawn submissions, conflicting copies and
  unreviewed update candidates.
- **Fresh every time.** Statistics are computed on every request; there is
  no cache. A withdrawal changes the next response.

## Filters and placement

Each filter places a record **in**, **out**, or **unplaced**. If any filter
puts a record out, it is out. Otherwise, the first filter that can't judge
it makes it unplaced. Unplaced records are neither counted nor silently
dropped: each reason's total is reported.

| Filter | In | Unplaced when |
| --- | --- | --- |
| Kind | the record's kind | never |
| UTC dates `[from, to)` | the whole interval is inside | the interval crosses `from` or `to` |
| Local dates (inclusive) | its local date is inside | no UTC offset was recorded |
| Local hours (inclusive) | its local hour is inside | no offset, or a whole-day interval |
| Portal level (inclusive) | its whole estimated range is inside | no level (every drop), or the range crosses the filter |
| Hacking or speed bonus (inclusive) | its **final** value is inside | no value (every drop), or the value isn't final |

**Records without a UTC offset** come from builds before the offset was
kept; most current data is like this.
- Their intervals are UTC hours or days, and they stay in every UTC-based
  analysis.
- They are unplaced only by local-date and local-hour filters.
- A time zone is never reconstructed for them.

`time_basis` is when the app received the hack or group, which can fall in
the next hour or day. An interval that crosses an event boundary can't be
assigned to either side.

## Record counts

The page shows matching records by kind, read status and coverage:

| Coverage | Meaning |
| --- | --- |
| both panels in full | `both_panels_read` |
| seen panels in full | read in full, but not both panels (an unlisted item name still counts as read) |
| partly read | a panel partly read, or a row unidentified |
| no panel | read, but no panel seen |
| `notRead`, `unavailable`, `unsupported` | no reading, by status |

## Item metrics

Item metrics use the **portal panel** by default, or the bonus panel, or
both.

A matching record is **eligible** only if its item list for the selected
panels is complete. Otherwise it is left out, and counted under the first
reason that applies:

1. `no_reading`: the gear wasn't read.
2. `panel_not_seen`: a selected panel is missing. **A missing panel is
   unknown, never zero.**
3. `partly_read`: a selected panel was only partly read.
4. `unidentified_items`: an item's name or level is unreadable.
5. `unlisted_item_names`: an item name isn't on the server's list yet.
   Records with such names are excluded until the name is reviewed.

For eligible observations, per item:
- **Quantity:** the summed quantity.
- **Average per eligible observation:** quantity ÷ eligible observations.
  The denominator includes observations without that item, and is shown
  next to the number.
- **Of which multiplied:** quantity the game printed in red, as on the
  first hack of the day.
- **Colour unread:** quantity whose colour wasn't read.

With no eligible observations, the average is shown as "—", not 0.

A blank cell is unknown. A blank `multiplied` is neither true nor false.

## No confidence intervals

The first release publishes descriptive statistics, sample counts and
limitations only.
- Records cluster by player, portal and session, and nothing identifies the
  player.
- Uploads can't stand in for players: files split a player's history
  arbitrarily and may overlap.

Intervals wait for a defensible sampling unit.

## Scale

Each request loads the accepted versions of the counted records into the
Worker (bounded in SQL by any UTC range) and computes in memory. That is
fine at pilot scale (thousands of records). Before it isn't, move the
aggregation into SQL or add a cache that withdrawals invalidate.
