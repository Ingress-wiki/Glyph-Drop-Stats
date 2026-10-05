import { csv, DROP_ID, dropRecord, hackId, hackRecord, item, type Row } from "./export.ts";

/**
 * Ten synthetic records, each built to exercise one statistics rule. The
 * expected results in `EXPECTED` were worked out by hand from this table,
 * not computed by the code under test.
 *
 * | id  | kind | time                     | level | hacking bonus | portal panel                      | bonus panel  | item verdict (portal) |
 * | --- | ---- | ------------------------ | ----- | ------------- | --------------------------------- | ------------ | --------------------- |
 * | h1  | hack | hour 07 @+08:00          | 6–6   | 120 final     | Resonator ×2 (red), XMP ×1        | Hypercube ×1 | eligible              |
 * | h2  | hack | hour 07 @+08:00          | 5–5   | 0 final       | Resonator ×3 (colour unread)      | —            | eligible              |
 * | h3  | hack | hour 07 @+08:00          | 6–6   | 120 final     | Resonator ×1, panel partly read   | —            | partly_read           |
 * | h4  | hack | hour 07 @+08:00          | 6–6   | 120 final     | unrecognized ×1                   | —            | unidentified_items    |
 * | h5  | hack | hour 07 @+08:00          | 6–6   | 120 final     | "Event Beacon" ×1 (unlisted)      | —            | unlisted_item_names   |
 * | h6  | hack | hour 07 @+08:00          | —     | 120 not final | gear unavailable                  | —            | no_reading            |
 * | d   | drop | day 2026-10-03 @+08:00   | —     | —             | Power Cube ×2                     | —            | eligible              |
 * | h8  | hack | hour 07 @+08:00          | 6–6   | 120 final     | —                                 | Hypercube ×1 | panel_not_seen        |
 * | h9  | hack | UTC hour 23:00 (no offset)| 6–6  | 120 final     | Resonator ×1                      | —            | eligible              |
 * | h10 | hack | hour 07 @+08:00          | 5–6   | 120 final     | Resonator ×1                      | —            | eligible              |
 *
 * Every hour interval is 2026-10-02T23:00Z–2026-10-03T00:00Z.
 */

const SEEN_IN_FULL: Row = { observed_panels_read_in_full: "true", both_panels_read: "false" };
const PARTLY: Row = { observed_panels_read_in_full: "false", both_panels_read: "false" };
const notApplicable = (name: string, extra: Row = {}): Row => ({ item: name, level: "", level_state: "notApplicable", ...extra });
const hypercube = notApplicable("Hypercube", { rarity: "veryRare", rarity_source: "fixed", multiplied: "false" });

export function datasetRecords(): Row[][] {
  const h1 = hackRecord({ record_id: hackId(1), order: "1", observed_panels_read_in_full: "true", both_panels_read: "true" });
  const h2 = hackRecord({
    record_id: hackId(2),
    order: "2",
    ...SEEN_IN_FULL,
    portal_level_low: "5",
    portal_level_high: "5",
    hacking_bonus: "0",
  });
  const h3 = hackRecord({ record_id: hackId(3), order: "3", ...PARTLY });
  const h4 = hackRecord({ record_id: hackId(4), order: "4", ...PARTLY });
  const h5 = hackRecord({ record_id: hackId(5), order: "5", ...SEEN_IN_FULL });
  const h6 = hackRecord({
    record_id: hackId(6),
    order: "6",
    read_status: "unavailable",
    association: "",
    observed_panels_read_in_full: "",
    both_panels_read: "",
    portal_level_low: "",
    portal_level_high: "",
    portal_level_confidence: "",
    portal_level_conflict: "",
    hacking_bonus_final: "false",
  });
  const drop = dropRecord({
    record_id: DROP_ID,
    order: "7",
    ...SEEN_IN_FULL,
    time_bucket_start_utc: "2026-10-02T16:00:00Z",
    time_bucket_end_utc: "2026-10-03T16:00:00Z",
    local_hour: "",
  });
  const h8 = hackRecord({ record_id: hackId(8), order: "8", ...SEEN_IN_FULL });
  const h9 = hackRecord({
    record_id: hackId(9),
    order: "9",
    ...SEEN_IN_FULL,
    local_date: "",
    local_hour: "",
    utc_offset_minutes: "",
  });
  const h10 = hackRecord({ record_id: hackId(10), order: "10", ...SEEN_IN_FULL, portal_level_low: "5" });

  return [
    [
      { ...h1, ...item("portal", 0, { quantity: "2", multiplied: "true" }) },
      { ...h1, ...item("portal", 1, { item: "XMP Burster", multiplied: "false" }) },
      { ...h1, ...item("bonus", 0, hypercube) },
    ],
    [{ ...h2, ...item("portal", 0, { level: "5", quantity: "3" }) }],
    [{ ...h3, ...item("portal", 0, { panel_partial: "true", multiplied: "false" }) }],
    [{ ...h4, ...item("portal", 0, { item: "" }) }],
    [{ ...h5, ...item("portal", 0, notApplicable("Event Beacon")) }],
    [h6],
    [{ ...drop, ...item("portal", 0, { item: "Power Cube", level: "8", quantity: "2", multiplied: "false" }) }],
    [{ ...h8, ...item("bonus", 0, hypercube) }],
    [{ ...h9, ...item("portal", 0, { multiplied: "false" }) }],
    [{ ...h10, ...item("portal", 0, { multiplied: "false" }) }],
  ];
}

export function datasetCsv(): string {
  return csv(datasetRecords().flat());
}

/** Hand-calculated results for the whole dataset with no filter, portal panel. */
export const EXPECTED = {
  records: {
    total: 10,
    byKind: { hack: 9, drop: 1 },
    byReadStatus: { read: 9, notRead: 0, unavailable: 1, unsupported: 0 },
    // both: h1. seen in full: h2, h5 (an unlisted name is still a read name), d, h8, h9, h10.
    // partly: h3 (partial panel), h4 (unrecognized row).
    byCoverage: {
      both_panels_in_full: 1,
      seen_panels_in_full: 6,
      partly_read: 2,
      no_panel: 0,
      notRead: 0,
      unavailable: 1,
      unsupported: 0,
    },
  },
  portalItems: {
    // h1, h2, d, h9, h10
    eligible: 5,
    excluded: { no_reading: 1, panel_not_seen: 1, partly_read: 1, unidentified_items: 1, unlisted_item_names: 1 },
    // Resonator 2 + 3 + 1 + 1, Power Cube 2, XMP Burster 1
    totalQuantity: 10,
    averagePerObservation: 2,
    byItem: [
      // Resonator: L5 ×3 (h2), L6 ×2 + ×1 + ×1 (h1, h9, h10).
      {
        item: "Resonator",
        quantity: 7,
        averagePerObservation: 1.4,
        multiplied: 2,
        multipliedUnknown: 3,
        levels: [0, 0, 0, 0, 3, 4, 0, 0],
      },
      {
        item: "Power Cube",
        quantity: 2,
        averagePerObservation: 0.4,
        multiplied: 0,
        multipliedUnknown: 0,
        levels: [0, 0, 0, 0, 0, 0, 0, 2],
      },
      {
        item: "XMP Burster",
        quantity: 1,
        averagePerObservation: 0.2,
        multiplied: 0,
        multipliedUnknown: 0,
        levels: [0, 0, 0, 0, 0, 1, 0, 0],
      },
    ],
  },
} as const;
