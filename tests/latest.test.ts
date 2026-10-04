import { describe, expect, it } from "vitest";
import { LatestOnly, STALE } from "../src/web/latest.ts";

/** A task whose answer the test releases by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("LatestOnly", () => {
  it("drops an earlier answer that arrives after a newer request started", async () => {
    const latest = new LatestOnly();
    const fileA = deferred<string>();
    const fileB = deferred<string>();
    let signalA: AbortSignal | undefined;
    const a = latest.run((signal) => {
      signalA = signal;
      return fileA.promise;
    });
    const b = latest.run(() => fileB.promise);
    expect(signalA?.aborted).toBe(true);
    fileB.resolve("preview of B");
    fileA.resolve("preview of A");
    expect(await b).toBe("preview of B");
    expect(await a).toBe(STALE);
  });

  it("drops an answer after cancel, as when another file is selected", async () => {
    const latest = new LatestOnly();
    const fileA = deferred<string>();
    const a = latest.run(() => fileA.promise);
    latest.cancel();
    fileA.resolve("preview of A");
    expect(await a).toBe(STALE);
  });

  it("swallows the abort error of a superseded request but reports real failures", async () => {
    const latest = new LatestOnly();
    const aborted = deferred<string>();
    const a = latest.run(() => aborted.promise);
    latest.cancel();
    aborted.reject(new Error("aborted"));
    expect(await a).toBe(STALE);
    await expect(latest.run(() => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
  });
});
