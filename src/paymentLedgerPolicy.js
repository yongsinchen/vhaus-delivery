// What a user may DO with one line of the Customer Profile payment ledger. The server re-checks every one of these (this only decides
// which button to OFFER, so a user is never shown an action that will be refused).
//
// A ledger line has an explicit source:
//   PAYMENT_TRANSACTION — a row in `payments` (has an id).
//   SO_DEPOSIT          — the upfront deposit stored on the sales order (no payment id; identified by sales_order_id).
import { proofEditPolicy } from "./paymentProofPolicy";

export const SOURCE_PAYMENT = "PAYMENT_TRANSACTION";
export const SOURCE_DEPOSIT = "SO_DEPOSIT";
const MANAGER_ROLES = ["master", "manager", "company_admin", "operation_manager"];

export const sourceOf = (p) => p?.source_type || (p?._deposit ? SOURCE_DEPOSIT : SOURCE_PAYMENT);
export const roleOf = (user) => String(user?.base_role || user?.role || "").toLowerCase();
export const isPaymentManager = (user) => MANAGER_ROLES.includes(roleOf(user)) || MANAGER_ROLES.includes(String(user?.role || "").toLowerCase());

/** A PENDING payment transaction may be edited in place by its recorder, a manager or Finance (same rule the server enforces). */
export const canChangePending = (p, user) => !!p?.id && p.approval_status === "pending"
  && (isPaymentManager(user) || roleOf(user) === "finance" || (!!user?.id && p.recorded_by === user.id));

export function ledgerActions(p, user) {
  const source = sourceOf(p);
  const proof = proofEditPolicy(p, user);
  const pendingEdit = source === SOURCE_PAYMENT && canChangePending(p, user);
  return {
    source,
    proof,                                   // { mode: replace | append | locked | none, label?, reason? }
    edit: pendingEdit ? { mode: "pending", label: "Edit Payment", title: "Edit this payment — amount, date, method, reference, proof, allocation (while it is pending Finance approval)" } : { mode: "none" },
    canRemove: source === SOURCE_PAYMENT && !!p?.id && (isPaymentManager(user) || pendingEdit),
    onOrder: source === SOURCE_DEPOSIT,      // a deposit is edited from the order until an edit flow is available for it
  };
}
