// Malaysia business-calendar helpers for the UI.
//
// "Today", "this month", a date preset or a default route date mean the Malaysia (Asia/Kuala_Lumpur, UTC+8) calendar day —
// not the browser's or the UTC day. The old pattern `new Date().toISOString().slice(0, 10)` is the UTC date: between 00:00 and
// 08:00 Malaysia time it is still YESTERDAY (a driver opening the app at 07:30 was shown yesterday's route), and
// `new Date("YYYY-MM-DDT00:00:00")` + `toISOString()` (local midnight read back as UTC) is a day early in any UTC+ browser.
//
// Everything here is calendar arithmetic on YYYY-MM-DD strings, so it is identical in every browser timezone.
// Audit timestamps (created_at, paid_at, …) are NOT calendar dates and stay as ISO timestamps.

export const MY_TZ = "Asia/Kuala_Lumpur";

/** Malaysia calendar date (YYYY-MM-DD) of an instant (default: now). */
export const malaysiaToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: MY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Malaysia calendar month (YYYY-MM). */
export const malaysiaMonth = (now = new Date()) => malaysiaToday(now).slice(0, 7);

/** First day of the Malaysia calendar month (YYYY-MM-01). */
export const malaysiaMonthStart = (now = new Date()) => `${malaysiaMonth(now)}-01`;

/** Add whole calendar days to a YYYY-MM-DD string (UTC-anchored — no timezone can shift the day). */
export const addDaysISO = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The Malaysia calendar date `n` days before today. */
export const malaysiaDaysAgo = (n, now = new Date()) => addDaysISO(malaysiaToday(now), -n);

/** Render a YYYY-MM-DD calendar date without letting the browser zone shift it. */
export const formatCalendarDate = (iso, options = { weekday: "long", day: "numeric", month: "short", year: "numeric" }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-MY", { ...options, timeZone: "UTC" });
