// Copy a Customer Stop's delivery details to the clipboard (Delivery Schedule).
//
// Pure text builder + a clipboard helper with a safe fallback. The values are
// exactly what the board already shows for the stop — the schedule row's joined
// legacy `orders` record (customer_name / contact / address) and its canonical
// current `balance` (orders.balance, the ledger-derived outstanding that the
// stop already displays as "Bal RM …"). Nothing is recalculated here.
//
// A stop is ONE order, or a Deliver Together group of several. For a group the
// customer details are printed once (when the members agree) and BALANCE is a
// TOTAL with a per-SO breakdown, so a single SO's balance can never be read as
// the whole stop's. If group members disagree on name / contact / address, each
// distinct value is listed with the SO(s) it belongs to rather than silently
// picking one.
import { formatMoney } from "./UIComponents";

const clean = v => String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim();
// One line per field in the clipboard text: collapse internal line breaks.
const oneLine = v => clean(v).replace(/,?\s*\n\s*/g, ", ");

const money = v => {
  if (v == null || v === "" || !Number.isFinite(Number(v))) return null;
  return `RM ${formatMoney(v)}`;
};

// Distinct non-empty values of `pick` across the orders, in first-seen order,
// each with the SO numbers that carry it.
function distinct(orders, pick) {
  const seen = new Map();
  for (const o of orders) {
    const v = oneLine(pick(o));
    if (!v) continue;
    if (!seen.has(v)) seen.set(v, []);
    seen.get(v).push(o.so_number || "");
  }
  return [...seen.entries()].map(([value, sos]) => ({ value, sos }));
}

function field(label, orders, pick) {
  const vals = distinct(orders, pick);
  if (vals.length === 0) return `${label}: -`;
  if (vals.length === 1) return `${label}: ${vals[0].value}`;
  return vals.map(v => `${label} (${v.sos.filter(Boolean).join(", ") || "?"}): ${v.value}`).join("\n");
}

/**
 * @param {Array<object>} orders  the stop's order records (schedule.orders), one per child
 * @returns {string}
 */
export function buildStopCopyText(orders) {
  const list = (Array.isArray(orders) ? orders : []).filter(Boolean);
  if (list.length === 0) return "";
  const lines = [
    field("NAME", list, o => o.customer_name),
    field("CONTACT", list, o => o.contact),
    field("ADDRESS", list, o => o.address),
  ];
  if (list.length === 1) {
    lines.push(`BALANCE: ${money(list[0].balance) || "-"}`);
  } else {
    // Deliver Together: TOTAL plus each SO's own balance. A member whose balance
    // is unknown is shown as "-" and flagged so the total can't pass as complete.
    const known = list.map(o => ({ so: o.so_number || "?", amt: money(o.balance) ? Number(o.balance) : null }));
    const total = known.reduce((s, k) => s + (k.amt || 0), 0);
    const incomplete = known.some(k => k.amt == null);
    lines.push(`BALANCE (TOTAL${incomplete ? ", INCOMPLETE" : ""}): ${money(total)}`);
    for (const k of known) lines.push(`  ${k.so}: ${k.amt == null ? "-" : money(k.amt)}`);
  }
  return lines.join("\n");
}

/**
 * Copy text. Uses the async Clipboard API when available (secure context),
 * otherwise a hidden-textarea + execCommand("copy") fallback. Resolves true on
 * success, false if neither route worked — never throws.
 */
export async function copyTextToClipboard(text) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy route */ }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false; } catch { ok = false; }
    document.body.removeChild(ta);
    return !!ok;
  } catch { return false; }
}

/** Build + copy + feedback in one call. `toast` is the app's useToast(). */
export async function copyStopDetails(orders, toast) {
  const text = buildStopCopyText(orders);
  if (!text) { toast?.error?.("Nothing to copy"); return false; }
  const ok = await copyTextToClipboard(text);
  if (ok) toast?.success?.("Copied");
  else toast?.error?.("Couldn't copy — select and copy manually");
  return ok;
}
