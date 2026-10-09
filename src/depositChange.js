// Deposit changes need approval (migration 117).
//
// An order that ALREADY has a recorded deposit never has it changed directly:
// Edit Order (and Customer Profile → Payment History) submit a deposit-change
// request that a Manager / Finance / Master approves. Until then the order keeps
// — and every screen shows — the approved deposit. Recording the FIRST deposit
// on an order without one is unchanged.
import React from "react";

const money = v => `RM ${Number(v || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Stored proofs → string[]: a JSON array, or (legacy rows) a comma-separated list / single URL. */
export function parseProofs(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (v == null || v === "") return [];
  try { const p = JSON.parse(v); if (Array.isArray(p)) return p.map(String).filter(Boolean); } catch { /* legacy text */ }
  return String(v).split(",").map(s => s.trim()).filter(Boolean);
}
const sameProofs = (a, b) => JSON.stringify(parseProofs(a)) === JSON.stringify(parseProofs(b));

/** The deposit recorded on the order (canonical initial_deposit; legacy rows fall back to `deposit`). */
export const recordedDepositOf = so => (so?.initial_deposit != null ? Number(so.initial_deposit) : (Number(so?.deposit) || 0));

/**
 * Does this Edit Order form change an existing deposit? (Same rule as the server.)
 * The form's Deposit field is the order's paid-to-date (sales_orders.deposit).
 */
export function depositChangeOf(order, form) {
  if (!order || recordedDepositOf(order) <= 0) return { changed: false, amount: false, method: false, proofs: false };
  const loaded = Number(order.deposit) || 0;
  const entered = form.deposit === "" || form.deposit == null ? 0 : Number(form.deposit);
  const amount = Math.abs(entered - loaded) >= 0.005;
  const method = (form.payment_method || null) !== (order.payment_method || null);
  const proofs = !sameProofs(form.payment_proofs, order.payment_proofs);
  return { changed: amount || method || proofs, amount, method, proofs };
}

/** "Deposit Change Pending Approval" — shown in Edit Order while a request waits. */
export function PendingDepositNotice({ request, order }) {
  if (!request) return null;
  const p = request.proposed_snapshot || {}, b = request.before_snapshot || {};
  const reverse = request.request_type === "reverse";
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1" data-testid="pending-deposit-notice">
      <div className="font-semibold">Deposit Change Pending Approval</div>
      <div>Current (approved) deposit: <b>{money(b.initial_deposit ?? recordedDepositOf(order))}</b> → proposed: <b>{reverse ? "Reverse to RM 0.00" : money(p.initial_deposit)}</b>
        {p.entered_paid_total != null && <span className="text-amber-700"> (entered as total paid {money(p.entered_paid_total)})</span>}</div>
      {(p.payment_method || null) !== (b.payment_method || null) && <div>Method: {b.payment_method || "—"} → <b>{p.payment_method || "—"}</b></div>}
      {!sameProofs(p.payment_proofs, b.payment_proofs) && <div>Proof: {parseProofs(b.payment_proofs).length} → <b>{parseProofs(p.payment_proofs).length}</b> file(s)</div>}
      <div className="text-amber-700">By {request.requested_by_name || "—"} · {request.reason}</div>
      <div className="text-amber-700">The order keeps the approved deposit until a Manager / Finance approves. Deposit fields are locked meanwhile.</div>
    </div>
  );
}

/** Shown when the user changes an existing deposit in Edit Order: approval notice + required reason. */
export function DepositChangeReason({ value, onChange }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 space-y-1" data-testid="deposit-change-reason">
      <div className="text-xs text-amber-900"><b>Changing an existing deposit needs Manager / Finance approval.</b> Saving submits a request — the order keeps the current deposit until it is approved.</div>
      <textarea value={value || ""} onChange={e => onChange(e.target.value)} rows={2} placeholder="Reason for the deposit change (required)" aria-label="Reason for the deposit change"
        className="w-full px-2 py-1.5 rounded-lg border border-amber-300 text-xs bg-white focus:outline-none focus:border-amber-500" />
    </div>
  );
}
