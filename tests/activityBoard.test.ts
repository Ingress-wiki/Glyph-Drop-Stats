import { describe, expect, it } from "vitest";
import { decodeBoard, parseActivityBoard } from "../src/domain/activityBoard.ts";

/** A synthetic board row in the page's layout: a status, the name, then labelled START, END and LOCATION. */
const row = (name: string, start: string, end: string, location = "Global") =>
  `<div class="row"><div class='vertical-rl white-text upcoming-background exo-400'>UPCOMING</div>` +
  `<div class="title-content-layout"><div class="white-text exo-bold-400 darker-green-background">${name}</div>` +
  `<div class="label-date-time-layout"><div class="yellow-text exo-bold-400">START:</div><div class="yellow-text exo-400">${start}</div></div>` +
  `<div class="label-date-time-layout"><div class="yellow-text exo-bold-400">END:</div><div class="yellow-text exo-400">${end}</div></div>` +
  `<div class="location-layout"><div class="yellow-text exo-bold-400">LOCATION:</div><div class="yellow-text exo-400">${location}</div></div></div></div>`;
const page = (...rows: string[]) => `<html><head><style>.row {}</style></head><body>${rows.join("")}</body></html>`;
const t = (iso: string) => Date.parse(iso) / 1000;

describe("parseActivityBoard", () => {
  it("reads a global event's UTC window", () => {
    const { events, skipped } = parseActivityBoard(page(row("Test Campaign", "2026-11-13T18:00:00 UTC", "2026-11-23T18:00:00 UTC")));
    expect(skipped).toEqual([]);
    expect(events).toEqual([
      { id: "test-campaign-2026-11-13", name: "Test Campaign", startUtc: t("2026-11-13T18:00:00Z"), endUtc: t("2026-11-23T18:00:00Z"), note: "Ingress activity board; UTC" },
    ]);
  });

  it("holds a local-time event as the UTC window it covers in every time zone", () => {
    const [event] = parseActivityBoard(page(row("Monthly Day", "2026-11-07T08:00:00 Etc/UTC", "2026-11-07T20:00:00 Etc/UTC"))).events;
    // 08:00 at UTC+14 is 18:00 UTC the day before; 20:00 at UTC−12 is 08:00 UTC the day after.
    expect([event.startUtc, event.endUtc]).toEqual([t("2026-11-06T18:00:00Z"), t("2026-11-08T08:00:00Z")]);
    expect(event.id).toBe("monthly-day-2026-11-07");
    expect(event.note).toContain("local times");
  });

  it("takes a local event listed with no length as the whole local day, and lists a repeated row once", () => {
    const listed = row("All Day", "2026-11-08T00:00:00 Etc/UTC", "2026-11-08T00:00:00 Etc/UTC");
    const { events } = parseActivityBoard(page(listed, listed));
    expect(events).toHaveLength(1);
    expect([events[0].startUtc, events[0].endUtc]).toEqual([t("2026-11-07T10:00:00Z"), t("2026-11-09T12:00:00Z")]);
    expect(events[0].note).toContain("whole local day");
  });

  it("orders events by start, notes a location that isn't global, and decodes entities", () => {
    const { events } = parseActivityBoard(
      page(
        row("Later &amp; Louder", "2026-12-01T18:00:00 UTC", "2026-12-02T18:00:00 UTC", "Tokyo, Japan"),
        row("Earlier", "2026-11-01T18:00:00 UTC", "2026-11-02T18:00:00 UTC"),
      ),
    );
    expect(events.map((e) => e.name)).toEqual(["Earlier", "Later & Louder"]);
    expect(events[1].note).toBe("Ingress activity board; UTC; location: Tokyo, Japan");
  });

  it("skips a named row whose times it can't read, and says which", () => {
    const { events, skipped } = parseActivityBoard(
      page(
        row("No Times", "soon", "later"),
        row("Backwards", "2026-11-02T18:00:00 UTC", "2026-11-01T18:00:00 UTC"),
        row("Zero UTC", "2026-11-02T18:00:00 UTC", "2026-11-02T18:00:00 UTC"),
        row("Mixed", "2026-11-02T18:00:00 UTC", "2026-11-03T18:00:00 Etc/UTC"),
        row("Fine", "2026-11-02T18:00:00 UTC", "2026-11-03T18:00:00 UTC"),
      ),
    );
    expect(events.map((e) => e.name)).toEqual(["Fine"]);
    expect(skipped).toEqual(["No Times", "Backwards", "Zero UTC", "Mixed"]);
  });

  it("finds nothing on a page without event rows", () => {
    expect(parseActivityBoard("<html><body>Maintenance</body></html>")).toEqual({ events: [], skipped: [] });
  });
});

describe("decodeBoard", () => {
  it("reads UTF-8, and Windows-1252 when the bytes aren't UTF-8", () => {
    expect(decodeBoard(new TextEncoder().encode("Cempasúchil"))).toBe("Cempasúchil");
    expect(decodeBoard(new Uint8Array([0x43, 0x65, 0x6d, 0x70, 0x61, 0x73, 0xfa, 0x63, 0x68, 0x69, 0x6c]))).toBe("Cempasúchil");
    expect(decodeBoard(new Uint8Array([0x93, 0x41, 0x94, 0x20, 0x80]))).toBe("“A” €");
  });
});
