export const STALE = Symbol("stale");

/**
 * Runs one request at a time and lets only the newest one report back.
 * Starting a request or calling `cancel` aborts the previous one, and a
 * superseded request resolves to `STALE` even if its answer arrives later.
 */
export class LatestOnly {
  private current: AbortController | null = null;

  cancel(): void {
    this.current?.abort();
    this.current = null;
  }

  async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T | typeof STALE> {
    this.cancel();
    const controller = new AbortController();
    this.current = controller;
    try {
      const value = await task(controller.signal);
      return controller.signal.aborted ? STALE : value;
    } catch (error) {
      if (controller.signal.aborted) return STALE;
      throw error;
    } finally {
      if (this.current === controller) this.current = null;
    }
  }
}
