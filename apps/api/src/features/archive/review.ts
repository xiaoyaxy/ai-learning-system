export function localDate(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
export function reviewDates(instant: string, timezone: string) {
  const date = localDate(instant, timezone);
  const add = (days: number) => {
    const calendar = new Date(date + "T00:00:00Z");
    calendar.setUTCDate(calendar.getUTCDate() + days);
    return calendar.toISOString().slice(0, 10);
  };
  return { day1: add(1), day3: add(3) };
}
