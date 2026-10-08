// What a user may do with a payment's PROOF, by payment status. Mirrors PATCH /payments/:id/proof (the server is the authority and
// re-checks everything under a compare-and-set — this only decides which action to OFFER so the UI never shows a button that will fail).
//
//   pending   → "replace": replace / add / remove — recorder, managers and Finance. The payment stays pending; Finance reviews the latest proof.
//   approved  → "append":  managers and Finance only, supplementary proofs only — approved evidence is never replaced or removed.
//   rejected  → "locked":  a rejected payment is void; record a new payment with the corrected proof.
//   no id (a deposit shown from the order itself) → "none".
const MANAGER_ROLES = ["master", "manager", "company_admin", "operation_manager"];

export function proofEditPolicy(payment, user) {
  if (!payment || !payment.id) return { mode: "none" };
  const role = String(user?.base_role || user?.role || "").toLowerCase();
  const effectiveRole = String(user?.role || "").toLowerCase();
  const privileged = MANAGER_ROLES.includes(role) || MANAGER_ROLES.includes(effectiveRole) || role === "finance" || effectiveRole === "finance";
  const status = payment.approval_status || "approved";   // legacy rows with no status are approved
  if (status === "rejected") return { mode: "locked", reason: "Rejected payments are void — record a new payment with the corrected proof." };
  if (status === "pending") {
    const owner = !!user?.id && payment.recorded_by === user.id;
    return privileged || owner ? { mode: "replace", label: "Edit proof" } : { mode: "none" };
  }
  return privileged ? { mode: "append", label: "Add proof" } : { mode: "none" };
}

/** Proof URLs of a payment, oldest first — the LAST one is the latest submitted. */
export const proofList = (payment) => String(payment?.proof_url || "").split(",").map(s => s.trim()).filter(Boolean);
