import { describe, expect, it } from "vitest";
import { eventId, OUTSIDE_EVENTS } from "../src/domain/events.ts";
import { UNKNOWN_GROUP } from "../src/domain/statistics.ts";

describe("eventId", () => {
  it("is the name as a URL-safe slug, then the start date", () => {
    expect(eventId("Year 14 - Vector", "2026-11-13")).toBe("year-14-vector-2026-11-13");
    expect(eventId("Leonids: The Lion Awakens", "2026-11-05")).toBe("leonids-the-lion-awakens-2026-11-05");
    expect(eventId("Cempasúchil", "2026-10-12")).toBe("cempasuchil-2026-10-12");
  });

  it("gives a monthly event one id a month", () => {
    expect(eventId("First Saturday 2x AP", "2026-11-07")).not.toBe(eventId("First Saturday 2x AP", "2026-12-05"));
  });

  it("keeps ids short, never empty, and never a group another split uses", () => {
    expect(eventId("あいう", "2026-11-01")).toBe("event-2026-11-01");
    expect(eventId("x".repeat(200), "2026-11-01").length).toBeLessThanOrEqual(71);
    for (const id of [eventId("Outside", "2026-11-01"), eventId("Unknown", "2026-11-01")]) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect([OUTSIDE_EVENTS, UNKNOWN_GROUP]).not.toContain(id);
    }
  });
});
