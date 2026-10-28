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
- **Not captured:** agent level, mods, hack type. Drops depend on them.
- **Portal alignment only from newer builds.** DynamicGlyph builds after
  1.0.0 say whether a hack's portal was the player's own faction, the
  enemy's or Machina's. It comes from the portal screen read just before
  the hack, not a verified portal, and neutral portals aren't recognized
  yet. Older records and drops have no alignment.
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
| Portal level (inclusive) | its whole estimated range is inside | no level (every drop), the level is unreliable, or the range crosses the filter |
| Portal alignment | its alignment | no alignment (every drop, and hacks from older builds) |
| Hacking or speed bonus (inclusive) | its **final** value is inside | no value (every drop), or the value isn't final |

**Records without a UTC offset** come from builds before the offset was
kept; most current data is like this.
- Their intervals are UTC hours or days, and they stay in every UTC-based
  analysis.
- They are unplaced only by local-date and local-hour filters.
- A time zone is never reconstructed for them.

**Unreliable portal levels.** The app flags a level as conflicting when its
reads disagree, and every released build through 1.0.0 (2) can read an L1
label as L7. A level flagged conflicting or low-confidence is never used:
the portal-level filter leaves such records unplaced, and the level grid
and the portal-level comparison leave them out.

`time_basis` is when the app received the hack or group, which can fall in
the next hour or day. An interval that crosses an event boundary can't be
assigned to either side.

## Record counts

The page shows matching records by kind, read status, coverage and the
app build that captured them, and how many uploads they came from. Each
record counts toward the earliest completed upload that supplied it.
Records cluster by player, so the upload count is the scale to read every
figure against.

Coverage:

| Coverage | Meaning |
| --- | --- |
| both panels in full | `both_panels_read` **and** `observed_panels_read_in_full`: both panels, neither partial, every row identified |
| seen panels in full | every panel seen read in full with every row identified, but not both panels (an unlisted item name still counts as read) |
| partly read | a panel partly read, or a row whose name or level is unreadable, even when `both_panels_read` is true |
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
4. `unidentified_items`: an item's name or level is unreadable. Excluding
   records with an unreadable level, not just an unreadable name, follows
   the app's "read in full" and keeps the per-level columns complete. It
   reduces coverage and may bias the sample, for example if levels are
   harder to read on some panels or devices. The direction of any effect
   on averages is unknown.
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

- **Chance per observation:** eligible observations with the item ÷
  eligible observations.
- **Average when present:** quantity ÷ observations with the item.
- **By rarity:** quantity that is Common, Rare or Very Rare (in the TSV).

With no eligible observations, the average is shown as "—", not 0.

## Shares, levels and comparisons

Over the eligible observations of the matching records:
- **Rare or better:** the share with a Rare or Very Rare item. An
  observation without one, but with an item whose rarity is unknown (an
  item that has a rarity, with none read), is unknown either way and left
  out of the share's denominator.
- **Portal Key:** the share with a Portal Key.
- **Item level by portal level:** for each exact, reliable portal level,
  each item level's share of the levelled items (Resonators, XMP Bursters,
  Ultra Strikes, Power Cubes). A portal level range is left out.
- **What an observation gives:** the average quantity per eligible
  observation of each levelled item, shields, other mods, Portal Keys and
  everything else.

The comparison groups the matching records by **portal alignment** (the
default), exact reliable portal level, Glyph count, speed command, key
command, **panel effect**, **Ingress event**, **UTC week** or **UTC day**,
each group with the same figures. Records without the value form an
"unknown" group, shown last.

**Panel effect** is the ITO EN (+) or (−) the app read on the record's
panels. The export leaves `panel_effects` blank both when no effect was
shown and in builds that didn't record effects, so readings without an
effect form one group, "No effect shown", that holds both. A record with no
reading, or whose panels showed different effects, is unknown.

**Events and time.** Ingress events can change what a hack gives (more
keys, a bonus item), so figures that mix event and ordinary hacks describe
neither.
- **Ingress event** groups records by the known event whose UTC window
  holds the record's whole time interval, with records touching no event
  as "Outside events". The events are listed in `src/domain/events.ts`,
  each with its source: see [Adding an event](#adding-an-event).
- **UTC week** (Monday to Monday) and **UTC day** group records by the
  period their whole interval lies in, and the page draws each figure as a
  trend over them, with the periods a known event touches shaded. It shows
  changes nobody announced as well as announced ones.
- An interval that crosses an event's start or end, or into the next day
  or week, is unknown, never placed by a guess. A local day outside UTC
  always crosses UTC midnight, so records exported with day precision
  rarely have a UTC day; most have a UTC week.
- Times are when the hack happened (its exported interval), not when it
  was uploaded: an upload this week can hold last month's hacks.

### Adding an event

Add it to `EVENTS` in `src/domain/events.ts`, in time order, with an id (it
goes into links), Niantic's name, the UTC window (start inclusive, end
exclusive) and a `note` saying where the dates come from. An event run in
each player's local time is entered as the widest UTC window it covers, and
its note says so. `tests/events.test.ts` checks the list. The level grid can show every record or
one group.

**Few observations.** A figure resting on fewer than 30 eligible
observations (30 known, for a share) is dimmed and says so. This is a
warning, not a test: there are still no intervals (below).

A blank cell is unknown. A blank `multiplied` is neither true nor false.

## Count distributions

For each item, the eligible observations are counted by how many of it they
had: 0, 1, … up to 9, then 10 or more in one bin. An observation's count is
its total over every slot of the selected panels. With them come:
- **Mean:** the average per eligible observation (as in the item table).
- **Variance:** the sample variance of the count per eligible observation,
  `(n·Σq² − (Σq)²) / n(n − 1)`, from the uncapped counts; none with fewer
  than two eligible observations.
- **Variance ÷ mean:** 1 for a Poisson count. Above 1, counts are more
  spread out than Poisson (more observations with none and more with many);
  below 1, more even.

The page draws the observed counts against what a Poisson distribution with
the same mean would give the same number of observations. This describes
the sample; it is not a goodness-of-fit test (see below).

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
Worker, bounded in SQL by any UTC range, and computes in memory. Panel and
item rows are grouped by version once, so the work grows linearly with the
rows loaded.

Measured in local `wrangler dev` on an Apple-silicon Mac (2026-10-05).
Each upload was a maximum-size synthetic export (2,000 hacks × 25 item
rows):

| Counted records | Item rows | `GET /api/statistics` |
| --- | --- | --- |
| 2,000 | 50,000 | about 0.14 s |
| 6,000 | 150,000 | about 0.4 s |
| 16,000 | 400,000 | about 1.1 s |
| 20,000 | 500,000 | about 1.4 s |

The response stays about 1 KB. Local workerd doesn't enforce production
CPU or memory limits, so before accepting real uploads:
- repeat this on deployed Workers and D1 against a realistic accumulated
  database (the per-upload limit doesn't bound the database);
- watch the 128 MB Worker memory limit, since every counted record's items
  are loaded at once.

When either limit gets close, move the aggregation into SQL or add a cache
that withdrawals invalidate.
