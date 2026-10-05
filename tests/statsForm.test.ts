import { describe, expect, it } from "vitest";
import { parseStatsQuery } from "../src/domain/statsQuery.ts";
import { EMPTY_FORM, formQuery } from "../src/web/statsForm.ts";

describe("formQuery", () => {
  it("sends nothing for an empty form", () => {
    expect(formQuery(EMPTY_FORM)).toBe("");
  });

  it("turns inclusive UTC dates into whole days", () => {
    const query = formQuery({ ...EMPTY_FORM, utcFrom: "2026-10-03", utcTo: "2026-10-03" });
    const parsed = parseStatsQuery(new URLSearchParams(query));
    expect(parsed).toMatchObject({
      ok: true,
      filter: { utc: { from: Date.UTC(2026, 9, 3) / 1000, to: Date.UTC(2026, 9, 4) / 1000 } },
    });
  });

  it("carries the end of a month and year over", () => {
    expect(formQuery({ ...EMPTY_FORM, utcFrom: "2026-12-01", utcTo: "2026-12-31" })).toContain("utcTo=2027-01-01T00%3A00%3A00Z");
  });

  it("passes the other fields through for the server to validate", () => {
    const query = formQuery({ ...EMPTY_FORM, kind: "hack", panels: "both", portalLevelMin: "6", portalLevelMax: " 8 " });
    expect(parseStatsQuery(new URLSearchParams(query))).toMatchObject({
      ok: true,
      filter: { kind: "hack", panels: "both", portalLevel: { min: 6, max: 8 } },
    });
    expect(parseStatsQuery(new URLSearchParams(formQuery({ ...EMPTY_FORM, portalLevelMin: "6" })))).toMatchObject({ ok: false });
  });
});
