// Delivery date to SHOW for a Sales Order — reads the backend's
// `_effective_delivery` (vhaus-bot lib/effective-delivery), the one
// precedence rule shared with the Delivery Assistant and Telegram bot:
//   exactly 1 active DO → that DO's date (none = TBC, legitimately)
//   2+ active DOs       → "N deliveries", each listed — never one guessed date
//   no active DO        → the SO's own delivery_date, exactly as before
// Once a DO exists the SO's own delivery_date is historical and can read
// "TBC" while the DO is scheduled — showing it was the false-TBC bug. The SO's
// own field is still what the edit form edits; this is display only.
//
// → { kind: "date" | "tbc" | "multiple" | "none", text, doNumber, deliveries }
export function effectiveDeliveryDisplay(order) {
  const e = order?._effective_delivery;
  if (e && e.source === "delivery_order") {
    return e.date
      ? { kind: "date", text: e.date, doNumber: e.do_number || null, deliveries: [] }
      : { kind: "tbc", text: "TBC", doNumber: e.do_number || null, deliveries: [] };
  }
  if (e && e.source === "multiple_delivery_orders") {
    const deliveries = Array.isArray(e.deliveries) ? e.deliveries : [];
    return { kind: "multiple", text: `${deliveries.length} deliveries`, doNumber: null, deliveries };
  }
  // No active DO (or an older backend without the field): the SO's own value.
  const d = order?.delivery_date;
  if (!d) return { kind: "none", text: null, doNumber: null, deliveries: [] };
  return { kind: d === "TBC" ? "tbc" : "date", text: d, doNumber: null, deliveries: [] };
}
