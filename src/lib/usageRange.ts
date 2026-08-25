export const USAGE_RANGES = ["1h", "1d", "1w", "1m"] as const;

export type UsageRange = (typeof USAGE_RANGES)[number];

export function isUsageRange(value: string): value is UsageRange {
  return (USAGE_RANGES as readonly string[]).includes(value);
}

export function rangeMs(range: UsageRange): number {
  switch (range) {
    case "1h":
      return 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    case "1w":
      return 7 * 24 * 60 * 60 * 1000;
    case "1m":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

export function bucketMs(range: UsageRange): number {
  switch (range) {
    case "1h":
      return 5 * 60 * 1000;
    case "1d":
      return 60 * 60 * 1000;
    case "1w":
      return 6 * 60 * 60 * 1000;
    case "1m":
      return 24 * 60 * 60 * 1000;
  }
}

export function emptyTimeBuckets<T>(
  range: UsageRange,
  factory: (t: Date) => T,
  now = Date.now(),
): { bucketStart: number; step: number; series: T[] } {
  const sinceMs = now - rangeMs(range);
  const step = bucketMs(range);
  const bucketStart = Math.floor(sinceMs / step) * step;
  const bucketCount = Math.ceil((now - bucketStart) / step) + 1;
  const series: T[] = [];
  for (let i = 0; i < bucketCount; i++) {
    series.push(factory(new Date(bucketStart + i * step)));
  }
  return { bucketStart, step, series };
}
