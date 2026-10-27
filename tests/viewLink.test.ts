import { describe, expect, it } from "vitest";
import { EMPTY_FORM } from "../src/web/statsForm.ts";
import { address, DEFAULT_VIEW, hasRanges, viewFromQuery, viewQuery, type ViewState } from "../src/web/viewLink.ts";

describe("view links", () => {
  it("write nothing for the default view", () => {
    expect(viewQuery(DEFAULT_VIEW)).toBe("");
    expect(address(DEFAULT_VIEW, false)).toBe("");
    expect(address(DEFAULT_VIEW, true)).toBe("#submit");
  });

  it("round-trip every part of a view, in the forms the page shows", () => {
    const view: ViewState = {
      form: { ...EMPTY_FORM, kind: "hack", panels: "both", alignment: "enemy", split: "panelEffect", utcFrom: "2026-10-01", utcTo: "2026-10-03", portalLevelMin: "6", portalLevelMax: "8" },
      search: "shield",
      sort: { key: "item", descending: false },
      gridGroup: "ITO EN (+)",
      item: "Portal Shield",
    };
    const query = viewQuery(view);
    expect(query).toBe(
      "kind=hack&panels=both&alignment=enemy&split=panelEffect&utcFrom=2026-10-01&utcTo=2026-10-03&portalLevelMin=6&portalLevelMax=8&group=ITO+EN+%28%2B%29&item=Portal+Shield&q=shield&sort=item",
    );
    expect(viewFromQuery(`?${query}`)).toEqual(view);
  });

  it("mark a descending sort with a minus, and leave the default sort out", () => {
    expect(viewQuery({ ...DEFAULT_VIEW, sort: { key: "L8", descending: true } })).toBe("sort=-L8");
    expect(viewFromQuery("sort=-L8").sort).toEqual({ key: "L8", descending: true });
    expect(viewQuery({ ...DEFAULT_VIEW, sort: { key: "quantity", descending: true } })).toBe("");
  });

  it("ignore choices not on their list, unknown parameters and unknown sort keys", () => {
    expect(viewFromQuery("kind=all&panels=sideways&split=faction&sort=-colour&utm_source=x")).toEqual(DEFAULT_VIEW);
  });

  it("pass ranges through as typed, for the server to validate", () => {
    const view = viewFromQuery("portalLevelMin=nine&localHourFrom= 7 ");
    expect(view.form).toMatchObject({ portalLevelMin: "nine", localHourFrom: "7" });
    expect(hasRanges(view.form)).toBe(true);
    expect(hasRanges(EMPTY_FORM)).toBe(false);
  });
});
