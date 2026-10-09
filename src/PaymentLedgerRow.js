// One line of the Customer Profile payment ledger — an SO deposit or a payment transaction, each clearly labelled.
// Display + action buttons only; every write is done by the parent through the canonical backend routes.
import React from "react";
import { paymentDateOf, fmtYmd } from "./paymentDate";
import { formatMoney } from "./UIComponents";
import { proofList } from "./paymentProofPolicy";
import { ledgerActions } from "./paymentLedgerPolicy";
import { RequestBadge } from "./AmendmentRequests";

const money = v => `RM ${formatMoney(v)}`;
const btn = "text-xs text-violet-600 hover:text-violet-800 border border-violet-200 hover:border-violet-300 rounded-lg px-2 py-1";

export default function PaymentLedgerRow({ p, user, onReceipt, onViewProof, onEditProof, onEdit, onRemove, onDepositRequest, onPaymentRequest, onHistory }) {
  const a = ledgerActions(p, user);
  const dep = a.source === "SO_DEPOSIT";
  return (
    <div className={`border rounded-xl p-3 flex items-center justify-between ${dep ? "bg-violet-50 border-violet-100" : "bg-emerald-50 border-emerald-100"}`} data-testid="ledger-row" data-source={a.source}>
      <div>
        <span className={`text-sm font-bold ${dep ? "text-violet-700" : "text-emerald-700"}`}>{money(p.amount)}</span>
        <span className="text-xs text-gray-500 ml-2">{p.payment_method}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-2 ${dep ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`} data-testid="source-badge"
          title={dep ? "Upfront deposit stored on the sales order itself" : "Payment transaction in the payments ledger"}>{dep ? "Order deposit" : "Payment"}</span>
        {dep && p.so_number && <span className="text-xs text-gray-400 ml-2">SO {p.so_number}</span>}
        {p.reference_no && <span className="text-xs text-gray-400 ml-2">Ref: {p.reference_no}</span>}
        <p className="text-xs text-gray-400" data-testid="payment-meta">{dep ? "Order date " : ""}{fmtYmd(paymentDateOf(p))}{p.recorded_by_name ? ` · Recorded by ${p.recorded_by_name}` : ""}</p>
        {p.proof_url && (
          <div className="mt-1 flex flex-wrap gap-2">
            {proofList(p).map((u, i, all) => (
              <button type="button" key={i} onClick={() => onViewProof?.(u)} className="text-xs text-violet-600 underline hover:text-violet-800">📎 Proof {i + 1}{all.length > 1 && i === all.length - 1 ? " · latest" : ""}</button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {p.approval_status === "pending" && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Pending approval</span>}
        {p.approval_status === "rejected" && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Rejected</span>}
        {p.approval_status === "approved" && a.source === "PAYMENT_TRANSACTION" && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700" data-testid="approval-label">Approved</span>}
        {dep && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500" data-testid="approval-label" title="An order deposit is counted from the moment it is entered on the order; any CHANGE to it needs Manager / Finance approval">Deposit</span>}
        <RequestBadge request={dep ? p.deposit_request : p.amendment_request} prefix={dep ? "Deposit change" : "Change"} />
        {p.or_number != null && <span className="text-[10px] text-gray-400">OR #{p.or_number}</span>}
        <button onClick={() => onReceipt?.(p)} title={p.approval_status === "rejected" ? "Reprint (VOID)" : "Print Payment Acknowledgement"} className={btn}>🧾 {p.approval_status === "rejected" ? "Void copy" : "Receipt"}</button>
        {(a.proof.mode === "replace" || a.proof.mode === "append") && (
          <button onClick={() => onEditProof?.(p, a.proof.mode)} data-testid="edit-proof-btn"
            title={a.proof.mode === "append" ? "Approved payment — add a supplementary proof (existing evidence is kept)" : "Replace or add the proof — the payment stays pending"} className={btn}>📎 {a.proof.label}</button>
        )}
        {a.proof.mode === "locked" && <span className="text-[10px] text-gray-400" title={a.proof.reason} data-testid="proof-locked">Proof locked</span>}
        {a.edit.mode !== "none" && (
          <button onClick={() => onEdit?.(p, a.edit)} title={a.edit.title} data-testid="edit-payment-btn" className={btn}>✏️ {a.edit.label}</button>
        )}
        {a.canRemove && (
          <button onClick={() => onRemove?.(p)} title={p.approval_status === "pending" ? "Delete this payment (before Finance approves it)" : "Remove payment"}
            className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded-lg px-2 py-1">{p.approval_status === "pending" ? "🗑 Delete" : "Remove"}</button>
        )}
        {a.deposit?.canEdit && <button onClick={() => onDepositRequest?.(p, "edit")} className={btn} data-testid="edit-deposit-btn" title="Request a change to this deposit (Manager / Finance approval)">✏️ Edit Deposit</button>}
        {a.deposit?.canReverse && <button onClick={() => onDepositRequest?.(p, "reverse")} className={btn} data-testid="reverse-deposit-btn" title="Request a reversal to RM0 (Manager / Finance approval)">↩ Reverse Deposit</button>}
        {a.deposit?.blockedReason && <span className="text-[10px] text-gray-400" title={a.deposit.blockedReason}>Ask Finance</span>}
        {a.requestChange && <button onClick={() => onPaymentRequest?.(p, "edit")} className={btn} data-testid="request-change-btn" title="This payment is approved — request a change (Manager / Finance approval)">✏️ Request change</button>}
        {a.requestChange && <button onClick={() => onPaymentRequest?.(p, "reverse")} className={btn} data-testid="request-reversal-btn" title="Request a reversal (Manager / Finance approval)">↩ Request reversal</button>}
        {(dep ? p.deposit_request : p.amendment_request) && <button onClick={() => onHistory?.(p)} className={btn} data-testid="history-btn" title="Amendment history and approval status">🕘 History</button>}
      </div>
    </div>
  );
}
