import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IngressEvent } from "../../src/domain/events.ts";
import type { Statistics } from "../../src/domain/statistics.ts";
import { handleApi } from "../../src/worker/api.ts";
import type { Db } from "../../src/worker/db.ts";
import { loadEvents, refreshEvents, saveBoard } from "../../src/worker/events.ts";
import { localD1 } from "../helpers/d1.ts";

let db: Db;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const d1 = await localD1();
  db = d1.db;
  dispose = d1.dispose;
});
beforeEach(async () => {
  await db.prepare("DELETE FROM ingress_events").run();
});
afterAll(() => dispose());

const NOW = Date.parse("2026-11-04T12:00:00Z") / 1000;
const event = (id: string, from: string, to: string, name = id): IngressEvent => ({ id, name, startUtc: Date.parse(from) / 1000, endUtc: Date.parse(to) / 1000, note: "test" });
const running = event("running", "2026-10-12T18:00:00Z", "2026-11-11T18:00:00Z");
const upcoming = event("upcoming", "2026-11-13T18:00:00Z", "2026-11-23T18:00:00Z");
const ended = event("ended", "2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z");

/** A board page with one synthetic event row. */
const board = (name: string, start: string, end: string) =>
  `<div class="row"><div class="white-text exo-bold-400 darker-green-background">${name}</div>` +
  `<div><div class="yellow-text exo-bold-400">START:</div><div class="yellow-text exo-400">${start}</div></div>` +
  `<div><div class="yellow-text exo-bold-400">END:</div><div class="yellow-text exo-400">${end}</div></div></div>`;

describe("saveBoard", () => {
  it("adds events, and updates one whose window changed", async () => {
    await saveBoard(db, [running, upcoming], NOW);
    await saveBoard(db, [running, { ...upcoming, endUtc: upcoming.endUtc + 3600, name: "Renamed" }], NOW + 60);
    expect(await loadEvents(db)).toEqual([running, { ...upcoming, endUtc: upcoming.endUtc + 3600, name: "Renamed" }]);
    expect(await db.prepare("SELECT first_seen, last_seen FROM ingress_events WHERE id = 'upcoming'").first()).toEqual({ first_seen: NOW, last_seen: NOW + 60 });
  });

  it("removes an upcoming event the board stopped listing, and keeps running and past ones", async () => {
    await saveBoard(db, [ended, running, upcoming], NOW - 86_400 * 60);
    const { removed } = await saveBoard(db, [event("new", "2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z")], NOW);
    expect(removed).toBe(1);
    expect((await loadEvents(db)).map((e) => e.id)).toEqual(["ended", "running", "new"]);
  });
});

describe("refreshEvents", () => {
  const answer = (body: string, status = 200) => async () => new Response(body, { status });

  it("stores what the board lists", async () => {
    const result = await refreshEvents(db, answer(board("Year Test", "2026-11-13T18:00:00 UTC", "2026-11-23T18:00:00 UTC")), NOW);
    expect(result).toEqual({ events: 1, removed: 0, skipped: [] });
    expect((await loadEvents(db)).map((e) => e.id)).toEqual(["year-test-2026-11-13"]);
  });

  it("refuses a failed or unreadable page, removing nothing", async () => {
    await saveBoard(db, [upcoming], NOW);
    await expect(refreshEvents(db, answer("down", 503), NOW)).rejects.toThrow("HTTP 503");
    await expect(refreshEvents(db, answer("<html><body>Maintenance</body></html>"), NOW)).rejects.toThrow("no event could be read");
    await expect(refreshEvents(db, answer(board("Odd", "soon", "later")), NOW)).rejects.toThrow("unreadable: Odd");
    expect((await loadEvents(db)).map((e) => e.id)).toEqual(["upcoming"]);
  });
});

describe("statistics", () => {
  it("answers with the stored events, to name event groups and shade trends", async () => {
    await saveBoard(db, [running, upcoming], NOW);
    const response = await handleApi(new Request("https://stats.test/api/statistics?split=event"), { DB: db });
    const body = (await response.json()) as { statistics: Statistics };
    expect(body.statistics.events).toEqual([running, upcoming]);
  });
});
