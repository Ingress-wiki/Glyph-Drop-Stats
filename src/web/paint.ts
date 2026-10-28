import { useEffect, useState } from "react";

/**
 * Chart paint comes from the page's CSS tokens, read again when the colour
 * scheme or the width class changes: SVG presentation attributes can't take
 * `var()`.
 */
export interface Paint {
  fg: string;
  muted: string;
  dim: string;
  /** Label size in pixels. */
  text: number;
  shades: readonly string[];
  inkOn: readonly string[];
}

function readPaint(): Paint {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    fg: token("--fg"),
    muted: token("--muted"),
    dim: token("--dim"),
    text: Number.parseFloat(token("--chart-text")) || 13,
    shades: [1, 2, 3, 4, 5].map((step) => token(`--shade-${step}`)),
    inkOn: [1, 2, 3, 4, 5].map((step) => token(`--shade-${step}-fg`)),
  };
}

export function usePaint(): Paint {
  const [paint, setPaint] = useState(readPaint);
  useEffect(() => {
    const queries = [matchMedia("(prefers-color-scheme: dark)"), matchMedia("(max-width: 40rem)")];
    const update = () => setPaint(readPaint());
    for (const query of queries) query.addEventListener("change", update);
    return () => queries.forEach((query) => query.removeEventListener("change", update));
  }, []);
  return paint;
}
