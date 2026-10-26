/** A finger's speed at release is measured over this many ms. */
const SAMPLE_MS = 80;

/** Velocity in CSS px per ms over the last `SAMPLE_MS`, zero when the finger stopped before lifting. */
export function releaseVelocity(samples: readonly { t: number; x: number; y: number }[], now: number): { x: number; y: number } {
  const recent = samples.filter((sample) => now - sample.t <= SAMPLE_MS);
  if (recent.length < 2) return { x: 0, y: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = last.t - first.t;
  return dt <= 0 ? { x: 0, y: 0 } : { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}
