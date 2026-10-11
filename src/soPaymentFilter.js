// Filter a customer's payment history down to a single Sales Order, reusing the
// EXACT rows the backend already returns from GET /customers/:id (detail.payments):
//   - deposit lines  { _deposit:true, so_number, order_id, amount, ... }
//       one per SO, amount = sales_orders.initial_deposit (fallback deposit)
//   - payment rows   { id, order_id, amount, payment_allocations:[{order_id,amount}], ... }
//       a split / 2C2P payment carries allocations to several orders.
//
// For a split payment we must show ONLY the amount allocated to the selected SO,
// never the whole payment. Deposit lines and payment rows are already separate
// in the source (the deposit lives on sales_orders, not in `payments`), so
// including both does NOT double-count. No fake rows are synthesised.
//
// Identify the SO by its LEGACY order id (orders.id — what payments/allocations
// key on) and/or its so_number (what deposit lines carry). Pass whichever are
// known; both are matched. Company isolation is already enforced upstream (the
// customer detail is company-scoped), so this is a pure client-side narrowing.

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// Returns { rows, total } where each row is the original payment/deposit object
// plus `so_amount` = the portion attributable to this SO. `total` is their sum.
export function filterPaymentsForSo(payments, { orderId = null, soNumber = null } = {}) {
  const rows = [];
  for (const p of (Array.isArray(payments) ? payments : [])) {
    if (!p) continue;

    if (p._deposit) {
      // Deposit line belongs to exactly one SO.
      const match = (soNumber != null && p.so_number === soNumber) || sameId(p.order_id, orderId);
      if (match) rows.push({ ...p, so_amount: Number(p.amount) || 0 });
      continue;
    }

    const allocs = Array.isArray(p.payment_allocations) ? p.payment_allocations : [];
    if (allocs.length) {
      // Split / 2C2P payment: only the allocation(s) to THIS order count.
      const mine = allocs.filter(a => sameId(a.order_id, orderId));
      if (mine.length) {
        const so_amount = mine.reduce((s, a) => s + (Number(a.amount) || 0), 0);
        rows.push({ ...p, so_amount });
      }
      continue;
    }

    // Plain single-order payment.
    if (sameId(p.order_id, orderId)) rows.push({ ...p, so_amount: Number(p.amount) || 0 });
  }

  const total = rows.reduce((s, r) => s + (Number(r.so_amount) || 0), 0);
  return { rows, total: Math.round(total * 100) / 100 };
}

