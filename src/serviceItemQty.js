// Service item quantity — the frontend mirror of vhaus-bot's
// lib/service-item-quantity.js: a whole number >= 1, default 1. Invalid input
// is reported, never silently coerced (2.5 is not turned into 2, 0 is not
// turned into 1). The backend enforces the same rule on every write.

// → { ok: true, value } | { ok: false, error }
export function parseServiceItemQty(raw) {
  const s = typeof raw === "number" ? String(raw) : String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: "Quantity must be a whole number of at least 1" };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return { ok: false, error: "Quantity must be a whole number of at least 1" };
  return { ok: true, value: n };
}

// Display fallback for legacy rows: NULL / non-integer reads as 1.
export const serviceItemQty = (q) => {
  const n = Number(q);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};
