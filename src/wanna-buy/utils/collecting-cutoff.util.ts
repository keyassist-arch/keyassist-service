/**
 * Next occurrence of `weekday` (0=Sun..6=Sat, `Date.getDay()` convention) at
 * `hour:minute` UTC, strictly after `from`. Defaults to the next Monday 23:59 UTC —
 * batches stop collecting new items then, admin quotes Tuesday, users pay by Wednesday.
 */
export function getNextWeeklyCutoff(from: Date, weekday = 1, hour = 23, minute = 59): Date {
  const cutoff = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0),
  );
  const daysUntil = (weekday - cutoff.getUTCDay() + 7) % 7;
  cutoff.setUTCDate(cutoff.getUTCDate() + daysUntil);
  if (cutoff <= from) {
    cutoff.setUTCDate(cutoff.getUTCDate() + 7);
  }
  return cutoff;
}
