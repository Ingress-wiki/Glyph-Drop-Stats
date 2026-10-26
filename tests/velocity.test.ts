import { describe, expect, it } from "vitest";
import { releaseVelocity } from "../src/web/velocity.ts";

describe("releaseVelocity", () => {
  it("measures the finger's speed over its last 80 ms", () => {
    const samples = [
      { t: 0, x: 0, y: 500 },
      { t: 100, x: 0, y: 400 },
      { t: 140, x: 0, y: 380 },
      { t: 180, x: 10, y: 300 },
    ];
    expect(releaseVelocity(samples, 180)).toEqual({ x: 0.125, y: -1.25 });
  });

  it("is zero when the finger stopped before lifting, or barely moved", () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 10, x: 0, y: 50 }], 300)).toEqual({ x: 0, y: 0 });
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }], 0)).toEqual({ x: 0, y: 0 });
    expect(releaseVelocity([{ t: 5, x: 0, y: 0 }, { t: 5, x: 0, y: 9 }], 5)).toEqual({ x: 0, y: 0 });
  });
});
