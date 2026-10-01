// Actual customer payment date — payments.payment_date (DATE, migration 115).
//
// A plain calendar date "YYYY-MM-DD", kept as a STRING end to end: it is never
// parsed with new Date("YYYY-MM-DD") (that is UTC midnight, which can shift a
// day when shown in another zone). "Today" is the Malaysia local date.
// System timestamps stay separate: paid_at = when it was recorded/uploaded
// (payments has no created_at), approved_at = when Finance decided.

const MY_TZ = "Asia/Kuala_Lumpur";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Malaysia local calendar date of an instant, as "YYYY-MM-DD" (en-CA format).
export function myDateOf(instant = new Date()) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: MY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const myToday = () => myDateOf(new Date());

// Frontend mirror of the backend rule (lib/payment-date.js) — returns an error
// message, or null when the date is acceptable.
export function paymentDateError(ymd, today = myToday()) {
  if (!ymd) return "Select the Payment Date";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "Payment Date is not a valid date";
  if (ymd > today) return "Payment Date cannot be later than today";
  return null;
}

// The payment's actual date: the explicit payment_date, else (legacy rows and
// paths that don't capture it) the Malaysia date it was recorded.
export function paymentDateOf(p) {
  if (p?.payment_date) return String(p.payment_date).slice(0, 10);
  return p?.paid_at ? myDateOf(p.paid_at) : "";
}

// "2026-09-28" -> "28 Sep 2026", by string parts (no timezone involved).
export function fmtYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

// Malaysia-local date + time of a system timestamp, for audit display.
export function fmtMyDateTime(instant) {
  if (!instant) return "";
  const d = new Date(instant);
  if (isNaN(d)) return "";
  return `${fmtYmd(myDateOf(d))}, ${new Intl.DateTimeFormat("en-MY", { timeZone: MY_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d)}`;
}
