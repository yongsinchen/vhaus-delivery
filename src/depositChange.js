// Order money in Edit Order / Customer Profile (owner decision 2026-10-09).
//
// Edit Order no longer edits money. It shows a read-only summary — order
// total, original deposit, additional payments, total paid, balance — with:
//   Collect Payment        the existing Record Payment (Collect Balance) flow → a separate payment
//   View Payment History   the deposit, every payment of the order, and the deposit audit trail
//   Edit Original Deposit  a DIRECT edit of the deposit (amount / method / proof, RM0 = reversal),
//                          no approval; a reason is required and every change is audited
// A new payment is never treated as a deposit correction, and a deposit edit
// never creates a payment. Approved payment transactions keep their own
// request → approval workflow (Customer Profile → Request change).
import React, { useEffect, useState } from "react";
import { supabase } from "./AuthContext";
import { useToast } from "./UIComponents";
import { PAYMENT_METHODS } from "./RecordPaymentModal";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const af = async (url, opts = {}) => {
  const { data } = await supabase.auth.getSession();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${data?.session?.access_token || ""}`, ...(cid && { "X-Company-ID": cid }), ...(opts.headers || {}) } });
};
export const money = v => (v == null || v === "" ? "—" : `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = ts => (ts ? new Date(ts).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "");

/** Stored proofs → string[]: a JSON array, or (legacy rows) a comma-separated list / single URL. */
export function parseProofs(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (v == null || v === "") return [];
  try { const p = JSON.parse(v); if (Array.isArray(p)) return p.map(String).filter(Boolean); } catch { /* legacy text */ }
  return String(v).split(",").map(s => s.trim()).filter(Boolean);
}

/** The deposit recorded on the order (canonical initial_deposit; legacy rows fall back to `deposit`). */
export const recordedDepositOf = so => (so?.initial_deposit != null ? Number(so.initial_deposit) : (Number(so?.deposit) || 0));

/** Read-only money summary for Edit Order + the three money actions. */
export function PaymentSummaryPanel({ summary, onCollect, onHistory, onEditDeposit }) {
  if (!summary) return <p className="text-xs text-gray-400">Payment summary unavailable — reopen the order.</p>;
  const row = (label, v, cls = "text-gray-800") => (
    <div className="flex items-center justify-between text-sm"><span className="text-gray-500">{label}</span><span className={`font-semibold ${cls}`}>{money(v)}</span></div>
  );
  return (
    <div className="border-t border-gray-100 pt-3 space-y-1.5" data-testid="payment-summary">
      {row("Order total", summary.order_total, "text-gray-900")}
      {row("Original deposit", summary.original_deposit)}
      {row("Additional payments", summary.additional_payments)}
      {row("Total paid", summary.total_paid, "text-emerald-700")}
      <div className="flex items-center justify-between border-t border-gray-100 pt-2">
        <span className="text-sm font-medium text-gray-500">Balance</span>
        <span className="text-lg font-bold text-violet-700" data-testid="summary-balance">{money(summary.balance)}</span>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {onCollect && <button type="button" onClick={onCollect} data-testid="collect-payment-btn" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">💵 Collect Payment</button>}
        {onHistory && <button type="button" onClick={onHistory} data-testid="payment-history-btn" className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs hover:bg-gray-50">🕘 View Payment History</button>}
        {onEditDeposit && <button type="button" onClick={onEditDeposit} data-testid="edit-deposit-btn" className="px-3 py-1.5 rounded-lg border border-violet-200 text-violet-700 text-xs hover:bg-violet-50">✏️ Edit Original Deposit</button>}
      </div>
      <p className="text-[11px] text-gray-400">New money is always a separate payment (Collect Payment). Edit Original Deposit only corrects the deposit taken when the order was made.</p>
    </div>
  );
}

async function uploadProof(file) {
  const { data } = await supabase.auth.getSession();
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch(`${API}/sales-orders/upload-attachment`, { method: "POST", headers: { Authorization: `Bearer ${data?.session?.access_token || ""}` }, body: fd });
  const d = await r.json().catch(() => ({}));
  if (!d.url) throw new Error(d.error || "Upload failed");
  return d.url;
}

const Shell = ({ title, children, onClose, footer }) => (
  <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" role="dialog" aria-label={title}>
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
      <div className="px-5 py-3 border-b flex items-center justify-between"><h3 className="font-bold text-gray-900 text-sm">{title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button></div>
      <div className="px-5 py-4 overflow-y-auto space-y-3 text-sm">{children}</div>
      {footer && <div className="px-5 py-3 border-t flex justify-end gap-2">{footer}</div>}
    </div>
  </div>
);
const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400";

/**
 * Edit Original Deposit — DIRECT (no approval). `current` is what the user sees
 * ({ initial_deposit, payment_method, payment_proofs[] }); it is sent as the
 * stale-form guard, so a deposit changed by someone else meanwhile is refused.
 */
export function DepositEditModal({ salesOrderId, orderNumber, current, mode = "edit", onClose, onSaved }) {
  const toast = useToast();
  const reverse = mode === "reverse";
  const [amount, setAmount] = useState(reverse ? "0" : String(current?.initial_deposit ?? 0));
  const [method, setMethod] = useState(current?.payment_method || "");
  const [proofs, setProofs] = useState(parseProofs(current?.payment_proofs));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setError(null);
    if (!reason.trim()) { setError("Enter a reason for the deposit change."); return; }
    if (amount === "" || !Number.isFinite(Number(amount)) || Number(amount) < 0) { setError("Enter a valid deposit amount."); return; }
    setBusy(true);
    try {
      const r = await af(`${API}/sales-orders/${salesOrderId}/deposit`, { method: "PATCH", body: JSON.stringify({
        initial_deposit: Number(amount), payment_method: method || null, payment_proofs: proofs, reason: reason.trim(),
        expected: { initial_deposit: Number(current?.initial_deposit ?? 0), payment_method: current?.payment_method || null, payment_proofs: parseProofs(current?.payment_proofs) },
      }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(`Not saved — ${d.error || "failed"}`); return; }
      toast.success(Number(amount) === 0 ? "Deposit reversed to RM 0.00 — saved" : "Original deposit saved");
      if (d.warning) toast.warning(d.warning);
      if (d.finance_note) toast.warning(d.finance_note);
      onSaved?.(d);
    } catch (e) { setError(`Not saved — ${e.message}`); } finally { setBusy(false); }
  };
  return (
    <Shell title={`${reverse ? "Reverse" : "Edit"} original deposit${orderNumber ? ` — SO ${orderNumber}` : ""}`} onClose={onClose}
      footer={<><button onClick={onClose} className="px-3 py-1.5 rounded-lg border text-xs">Cancel</button>
        <button onClick={save} disabled={busy} data-testid="save-deposit" className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs disabled:opacity-50">{busy ? "Saving…" : "Save deposit"}</button></>}>
      <p className="text-xs text-gray-500">Current deposit: <b>{money(current?.initial_deposit)}</b>{current?.payment_method ? ` · ${current.payment_method}` : ""}. Saved immediately and recorded in the history (who, when, why).</p>
      {reverse ? <p className="text-xs text-gray-700">The deposit will be set to <b>RM 0.00</b>. Its receipt number and proof are kept in the history.</p> : (<>
        <label className="block"><span className="block text-xs font-medium text-gray-500 mb-1">Deposit amount (RM)</span>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} aria-label="Deposit amount" /></label>
        <label className="block"><span className="block text-xs font-medium text-gray-500 mb-1">Payment method</span>
          <select value={method} onChange={e => setMethod(e.target.value)} className={inputCls + " bg-white"} aria-label="Payment method">
            <option value="">—</option>{[...new Set([method, ...PAYMENT_METHODS].filter(Boolean))].map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <div><span className="block text-xs font-medium text-gray-500 mb-1">Proof</span>
          {proofs.map((u, i) => (
            <div key={u + i} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2 py-1 mb-1"><a href={u} target="_blank" rel="noreferrer" className="flex-1 text-violet-600 underline truncate">{u.split("/").pop()}</a>
              <button type="button" onClick={() => setProofs(p => p.filter((_, j) => j !== i))} className="text-red-400" aria-label="Remove proof">✕</button></div>))}
          <input type="file" accept="image/*,application/pdf" className="text-xs" aria-label="Upload proof" onChange={async e => {
            const f = e.target.files?.[0]; if (!f) return;
            try { const url = await uploadProof(f); setProofs(p => [...p, url]); } catch (err) { toast.error(err.message); } e.target.value = "";
          }} />
          <p className="text-[11px] text-gray-400 mt-1">A proof you take off stays in the history — files are never deleted.</p>
        </div>
      </>)}
      <label className="block"><span className="block text-xs font-medium text-gray-500 mb-1">Reason (required)</span>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className={inputCls} aria-label="Reason" /></label>
      {error && <p className="text-xs text-red-600" data-testid="deposit-error">{error}</p>}
    </Shell>
  );
}

/** The order's deposit, every payment allocated to it, and the deposit change history. */
export function PaymentHistoryModal({ salesOrderId, title, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    af(`${API}/sales-orders/${salesOrderId}/payment-history`).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to load");
      setData(d);
    }).catch(e => setErr(e.message));
  }, [salesOrderId]);
  return (
    <Shell title={title || "Payment history"} onClose={onClose}>
      {err ? <p className="text-xs text-red-600">{err}</p> : !data ? <p className="text-xs text-gray-400">Loading…</p> : (<>
        <div className="space-y-1.5" data-testid="history-lines">
          {(data.lines || []).length === 0 && <p className="text-xs text-gray-400">No deposit or payments yet.</p>}
          {(data.lines || []).map((l, i) => (
            <div key={l.id || `dep-${i}`} className={`rounded-xl border px-3 py-2 text-xs flex items-center justify-between gap-2 ${l.source_type === "SO_DEPOSIT" ? "bg-violet-50 border-violet-100" : "bg-emerald-50 border-emerald-100"}`} data-testid="history-line">
              <div><b>{money(l.amount)}</b> <span className="text-gray-500">{l.source_type === "SO_DEPOSIT" ? "Original deposit" : "Payment"} · {l.payment_method || "—"}</span>
                <div className="text-gray-400">{(l.payment_date || l.paid_at || "").slice(0, 10)}{l.recorded_by_name ? ` · ${l.recorded_by_name}` : ""}{l.or_number != null ? ` · OR #${l.or_number}` : ""}</div></div>
              {l.source_type !== "SO_DEPOSIT" && <span className="text-[10px] font-semibold">{l.approval_status === "pending" ? "Pending approval" : l.approval_status === "rejected" ? "Rejected" : "Approved"}</span>}
            </div>))}
        </div>
        <h4 className="text-xs font-bold text-gray-700 pt-2">Deposit changes</h4>
        {(data.deposit_history || []).filter(e => e.event_type === "deposit.edited").length === 0 ? <p className="text-xs text-gray-400">No changes to the original deposit.</p>
          : (data.deposit_history || []).filter(e => e.event_type === "deposit.edited").map(e => (
            <div key={e.id} className="border rounded-xl p-2 text-xs space-y-0.5" data-testid="deposit-history-row">
              <div><b>{money(e.payload?.before?.initial_deposit)}</b> → <b>{money(e.payload?.after?.initial_deposit)}</b>{e.payload?.edit_type === "reverse" ? " (reversed)" : ""}</div>
              {(e.payload?.before?.payment_method || null) !== (e.payload?.after?.payment_method || null) && <div>Method: {e.payload?.before?.payment_method || "—"} → {e.payload?.after?.payment_method || "—"}</div>}
              {(e.payload?.superseded_proofs || []).length > 0 && <div>Proof taken off: {(e.payload.superseded_proofs).map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="text-violet-600 underline mr-1">{String(u).split("/").pop()}</a>)}</div>}
              <div className="text-gray-500">{e.payload?.actor_name || "—"} · {when(e.created_at)} · “{e.payload?.reason}”</div>
            </div>))}
        {(data.deposit_history || []).some(e => e.event_type === "deposit.commission_recalc_failed") && <p className="text-[11px] text-red-600">A commission recalculation after a deposit change did not finish — ask Finance / a manager to retry it.</p>}
      </>)}
    </Shell>
  );
}
