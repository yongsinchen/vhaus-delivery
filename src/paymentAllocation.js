// Payment allocation — pure helper functions, extracted from
// RecordPaymentModal.js so they can be tested directly with plain Node
// (that file contains JSX and can't be `require()`d outside a bundler).
// No React, no fetch, no DOM — safe to import from a component or a script.

// Deterministic suggestion order when neither the business nor this codebase
// defines a payment-allocation priority: oldest order_date first, then
// created_at, then immutable id. A UI suggestion only — every row stays
// editable, and nothing posts until Finance presses Confirm.
export const sortOldestFirst = (list) => [...list].sort((a, b) => {
  const ad = a.order_date || a.delivery_date || "", bd = b.order_date || b.delivery_date || "";
  if (ad !== bd) return ad < bd ? -1 : 1;
  const ac = a.created_at || "", bc = b.created_at || "";
  if (ac !== bc) return ac < bc ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : 1;
});

// Allocation rows for the chosen kind. Deposit collection is only offered on
// orders that have NO deposit yet (a new order); once an order has a deposit,
// only its balance can be collected. The initiating order (the one Record
// Payment was opened FROM, if any) is moved to the front — oldest-first still
// governs the ordering of every OTHER order, so a customer's other
// outstanding orders still fill in a deterministic, predictable sequence.
export const allocsFor = (orders, kind, initiatingOrderId) => {
  const sorted = sortOldestFirst((orders || [])
    .filter(o => (kind === "deposit" ? !o._hasDeposit : o._hasDeposit)));
  if (initiatingOrderId != null) {
    const idx = sorted.findIndex(o => String(o.id) === String(initiatingOrderId));
    if (idx > 0) { const [initiating] = sorted.splice(idx, 1); sorted.unshift(initiating); }
  }
  return sorted.map(o => ({ order_id: o.id, so_number: o.so_number, balance: Number(o.balance), amount: "" }));
};

// Tag each outstanding order: does it already have a deposit paid? (Anything
// paid means balance < the full order amount.) Deposit collection applies to
// orders with none yet; balance collection to those that already have one.
// Cancelled and Service orders are never payment targets.
export const tagOutstanding = (orders) => (orders || []).filter(o => Number(o.balance) > 0 && o.status !== "Cancelled" && o.type !== "Service")
  .map(o => ({ ...o, _hasDeposit: Number(o.balance) < (Number(o.order_amount) || 0) }));
export const defaultKind = (list) => (list.some(o => !o._hasDeposit) ? "deposit" : "balance"); // default to deposit only if a no-deposit order exists

// Fills orders in the order the list is given (already sorted by allocsFor),
// each capped at its own outstanding balance — a starting suggestion only.
export const autoAllocateInto = (allocations, total) => {
  let remaining = Number(total) || 0;
  return allocations.map(a => {
    const alloc = Math.min(remaining, a.balance);
    remaining = Math.round((remaining - alloc) * 100) / 100;
    return { ...a, amount: alloc > 0 ? String(alloc) : "" };
  });
};

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
