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

// Edit Order form: the delivery date to PRE-FILL is the effective one — with
// exactly one active DO that DO's date ("TBC" when it has none), so the form
// shows what is really planned. The backend routes a change of it to that DO
// (PUT /sales-orders/:id): TBC clears the DO's date; a new date becomes the
// DO's Delivery Date Request (10-day rule). With no DO it is the SO's own field.
export function editFormDeliveryDate(order) {
  const e = order?._effective_delivery;
  if (e && e.source === "delivery_order") return e.date || "TBC";
  return order?.delivery_date || "";
}

// The list row's effective delivery after an edit (from the PUT response).
export function effectiveAfterEdit(prev, saved, deliveryOrderUpdated, dateRequest = null) {
  const iso = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  // A date change sent as the DO's Delivery Date Request: applied only when
  // auto-approved; while pending the DO (and so the effective date) is unchanged.
  if (dateRequest && !dateRequest.error) {
    if (dateRequest.status !== "approved") return prev;
    return { ...(prev || {}), source: "delivery_order", date: iso(dateRequest.requested_date), tbc: !iso(dateRequest.requested_date), do_number: dateRequest.do_number || prev?.do_number || null, deliveries: [] };
  }
  if (deliveryOrderUpdated) {
    const date = iso(deliveryOrderUpdated.delivery_date);
    return { source: "delivery_order", date, tbc: !date, do_number: deliveryOrderUpdated.do_number || null, delivery_order_id: deliveryOrderUpdated.id || null, deliveries: [] };
  }
  if (!prev || prev.source === "sales_order") {
    const date = iso(saved?.delivery_date);
    return { source: "sales_order", date, tbc: !date, do_number: null, delivery_order_id: null, deliveries: [] };
  }
  return prev; // an active DO still decides, unchanged by this edit
}
