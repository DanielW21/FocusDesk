/**
 * WaterlooWorks has historically emitted timestamps as either ISO strings,
 * epoch seconds, or epoch milliseconds. Keep that transport detail at the
 * edge of the feature so sorting, filtering, and display agree.
 */
export function timestampFromWaterlooWorks(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value))
    return timestampFromNumber(value);

  const text = String(value ?? "").trim();
  if (!text) return Number.NaN;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return timestampFromNumber(Number(text));
  }

  return Date.parse(text);
}

function timestampFromNumber(value: number): number {
  const absolute = Math.abs(value);
  // Ten-digit Unix timestamps are seconds; the thirteen-digit values in the
  // scraped job payload are milliseconds. Avoid treating arbitrary numeric
  // text (for example a job id) as a date.
  if (absolute >= 1_000_000_000 && absolute < 100_000_000_000)
    return value * 1_000;
  if (absolute >= 100_000_000_000 && absolute <= 8.64e15) return value;
  return Number.NaN;
}

export function formatWaterlooWorksDate(value: unknown): string {
  const timestamp = timestampFromWaterlooWorks(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleDateString("en-CA")
    : "—";
}
