import { describe, expect, it } from "vitest";
import { EVENTS, OUTSIDE_EVENTS } from "../src/domain/events.ts";
import { UNKNOWN_GROUP } from "../src/domain/statistics.ts";

describe("the event list", () => {
  it("has a URL-safe, unique id for each event, none taken by another group", () => {
    const ids = EVENTS.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect([OUTSIDE_EVENTS, UNKNOWN_GROUP]).not.toContain(id);
    }
  });

  it("lists events in time order, each a whole-second window that doesn't overlap the next", () => {
    EVENTS.forEach((event, index) => {
      expect(Number.isInteger(event.startUtc) && Number.isInteger(event.endUtc)).toBe(true);
      expect(event.startUtc).toBeLessThan(event.endUtc);
      const next = EVENTS[index + 1];
      if (next) expect(event.endUtc).toBeLessThanOrEqual(next.startUtc);
    });
  });

  it("names each event and says where its dates come from", () => {
    for (const event of EVENTS) {
      expect(event.name.trim()).not.toBe("");
      expect(event.note.trim()).not.toBe("");
    }
  });
});
