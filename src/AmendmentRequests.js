// Deposit-change + approved-payment amendment requests (migration 117) — UI.
//
//   (deposit edits are direct since 2026-10-09 — see depositChange.js; older deposit requests still show here)
//   PaymentAmendmentModal   … → an APPROVED payment → Request change / Request reversal
//   RequestHistoryModal     every request of one deposit / payment (before → after, decision)
//   AmendmentApprovalQueue  Finance → Amendments: Manager / Finance / Master approve or reject
//
// Nothing here changes money directly: every action is a request the backend
// validates (company, role, no self-approval, unchanged since requested) and a
// Manager / Finance / Master approves. The approved values then appear in the
// ledger; until then the current approved values stay everywhere.
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "./AuthContext";
import { useToast } from "./UIComponents";
import { PAYMENT_METHODS } from "./RecordPaymentModal";
import { parseProofs } from "./depositChange";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const af = async (url, opts = {}) => {
  const { data } = await supabase.auth.getSession();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${data?.session?.access_token || ""}`, ...(cid && { "X-Company-ID": cid }), ...(opts.headers || {}) } });
};
const send = async (url, body) => {
  const r = await af(url, { method: "POST", body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || "Request failed"); e.code = d.code; throw e; }
  return d;
};
export const money = v => (v == null || v === "" ? "—" : `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = ts => (ts ? new Date(ts).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "");

export const STATUS_LABEL = { pending: "Pending approval", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", stale: "Out of date — not applied" };
export const STATUS_CLS = { pending: "bg-amber-100 text-amber-800", approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-600", withdrawn: "bg-gray-100 text-gray-500", stale: "bg-gray-200 text-gray-600" };
export const RequestBadge = ({ request, prefix = "Change" }) => request ? (
  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_CLS[request.status] || ""}`} data-testid="request-badge"
    title={request.reason}>{prefix} {STATUS_LABEL[request.status]?.toLowerCase() || request.status}</span>
) : null;

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
const Field = ({ label, children }) => <label className="block"><span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>{children}</label>;
const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400";

/** Change or reverse an APPROVED payment (pending payments keep the direct Edit Payment flow). */
export function PaymentAmendmentModal({ payment, mode, onClose, onDone }) {
  const toast = useToast();
  const reverse = mode === "reverse";
  const allocs = payment.payment_allocations || [];
  const [amount, setAmount] = useState(String(payment.amount ?? ""));
  const [method, setMethod] = useState(payment.payment_method || "");
  const [ref, setRef] = useState(payment.reference_no || "");
  const [date, setDate] = useState(payment.payment_date || "");
  const [proof, setProof] = useState(payment.proof_url || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const amountLocked = allocs.length > 1; // a split payment's amount is changed with its allocations (Finance)
  const submit = async () => {
    if (!reason.trim()) { toast.error("Enter a reason"); return; }
    setBusy(true);
    try {
      await send(`${API}/payments/${payment.id}/amendment-requests`, reverse ? { request_type: "reverse", reason }
        : { request_type: "edit", ...(amountLocked ? {} : { amount: Number(amount) }), payment_method: method || null, reference_no: ref || null, payment_date: date || null, proof_url: proof || null, reason });
      toast.success(reverse ? "Payment reversal submitted for approval" : "Payment change submitted for approval");
      onDone?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title={`${reverse ? "Reverse" : "Change"} approved payment${payment.or_number != null ? ` — OR #${payment.or_number}` : ""}`} onClose={onClose}
      footer={<><button onClick={onClose} className="px-3 py-1.5 rounded-lg border text-xs">Cancel</button>
        <button onClick={submit} disabled={busy} data-testid="submit-payment-request" className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs disabled:opacity-50">{busy ? "Submitting…" : "Submit for approval"}</button></>}>
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">This payment is already approved — the change needs Manager / Finance approval. It stays as it is until then.</div>
      {reverse ? <p className="text-xs text-gray-600">Proposed: reverse this {money(payment.amount)} payment. The original details are kept in the request history.</p> : (<>
        <Field label="Amount (RM)"><input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} disabled={amountLocked} className={inputCls + " disabled:bg-gray-50"} aria-label="Amount" /></Field>
        {amountLocked && <p className="text-[11px] text-gray-500">This payment is split across {allocs.length} orders — ask Finance to change its amount and allocation.</p>}
        <Field label="Payment method"><select value={method} onChange={e => setMethod(e.target.value)} className={inputCls + " bg-white"} aria-label="Payment method">
          {[...new Set([method, ...PAYMENT_METHODS].filter(Boolean))].map(m => <option key={m} value={m}>{m}</option>)}</select></Field>
        <Field label="Reference / approval code"><input value={ref} onChange={e => setRef(e.target.value)} className={inputCls} aria-label="Reference" /></Field>
        <Field label="Payment date"><input type="date" value={date || ""} onChange={e => setDate(e.target.value)} className={inputCls} aria-label="Payment date" /></Field>
        <Field label="Proof">{proof && <a href={proof} target="_blank" rel="noreferrer" className="block text-xs text-violet-600 underline truncate mb-1">{proof.split("/").pop()}</a>}
          <input type="file" accept="image/*,application/pdf" className="text-xs" aria-label="Upload proof" onChange={async e => {
            const f = e.target.files?.[0]; if (!f) return; try { setProof(await uploadProof(f)); } catch (err) { toast.error(err.message); } e.target.value = "";
          }} /></Field>
      </>)}
      <Field label="Reason (required)"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className={inputCls} aria-label="Reason" /></Field>
    </Shell>
  );
}

// Before → after rows for one request (only fields that exist for that record type).
export function changeRows(r) {
  const b = r.before_snapshot || {}, p = r.proposed_snapshot || {};
  const proofsTxt = v => { const l = parseProofs(v); return l.length ? `${l.length} file(s)` : "—"; };
  if (r.kind === "deposit" || r.sales_order_id) {
    return [
      ["Deposit amount", money(b.initial_deposit), r.request_type === "reverse" ? "RM 0.00 (reverse)" : money(p.initial_deposit)],
      ["Payment method", b.payment_method || "—", p.payment_method || "—"],
      ["Proof", proofsTxt(b.payment_proofs), proofsTxt(p.payment_proofs)],
      ...(p.entered_paid_total != null ? [["Typed in Edit Order (total paid)", money(b.paid_to_date), money(p.entered_paid_total)]] : []),
    ];
  }
  if (r.request_type === "reverse") return [["Payment", money(b.amount), "Reversed (RM 0.00)"]];
  return [
    ["Amount", money(b.amount), money(p.amount)],
    ["Payment date", b.payment_date || "—", p.payment_date || "—"],
    ["Method", b.payment_method || "—", p.payment_method || "—"],
    ["Reference", b.reference_no || "—", p.reference_no || "—"],
    ["Proof", b.proof_url ? String(b.proof_url).split("/").pop() : "—", p.proof_url ? String(p.proof_url).split("/").pop() : "—"],
  ];
}
const ChangeTable = ({ r }) => (
  <table className="w-full text-xs" data-testid="change-table"><thead><tr className="text-gray-400"><th className="text-left font-medium py-0.5">Field</th><th className="text-left font-medium">Before</th><th className="text-left font-medium">After</th></tr></thead>
    <tbody>{changeRows(r).map(([f, a, b]) => <tr key={f} className={a !== b ? "text-gray-900" : "text-gray-400"}><td className="py-0.5 pr-2">{f}</td><td className="pr-2">{a}</td><td className={a !== b ? "font-semibold" : ""}>{b}</td></tr>)}</tbody></table>
);

export function RequestHistoryModal({ kind, salesOrderId, paymentId, title, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    const qs = kind === "deposit" ? `kind=deposit&sales_order_id=${salesOrderId}` : `kind=payment&payment_id=${paymentId}`;
    af(`${API}/amendment-requests?${qs}`).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Failed"); setRows(d.requests || []); }).catch(e => setErr(e.message));
  }, [kind, salesOrderId, paymentId]);
  return (
    <Shell title={title || "Amendment history"} onClose={onClose}>
      {err ? <p className="text-red-600 text-xs">{err}</p> : !rows ? <p className="text-gray-400 text-xs">Loading…</p> : rows.length === 0 ? <p className="text-gray-400 text-xs">No change requests yet.</p>
        : rows.map(r => (
          <div key={r.id} className="border rounded-xl p-3 space-y-1" data-testid="history-row">
            <div className="flex items-center justify-between gap-2"><b className="text-xs">{r.request_type === "reverse" ? "Reversal" : "Change"}</b><RequestBadge request={r} prefix="" /></div>
            <ChangeTable r={r} />
            <p className="text-[11px] text-gray-500">Requested by {r.requested_by_name || "—"} · {when(r.requested_at)} · “{r.reason}”</p>
            {r.reviewed_at && <p className="text-[11px] text-gray-500">{STATUS_LABEL[r.status]} by {r.reviewed_by_name || "—"} · {when(r.reviewed_at)}{r.decision_note ? ` · “${r.decision_note}”` : ""}</p>}
          </div>))}
    </Shell>
  );
}

/** Finance → Amendments. Deposit changes and approved-payment changes in one queue, same controls. */
export function AmendmentApprovalQueue({ user }) {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({});
  const load = useCallback(async () => {
    setData(null);
    try {
      const r = await af(`${API}/amendment-requests${status ? `?status=${status}` : ""}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to load");
      setData(d);
    } catch (e) { setData({ requests: [], error: e.message }); }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const act = async (r, action) => {
    if (action === "reject" && !String(notes[r.id] || "").trim()) { toast.error("Add a note explaining the rejection"); return; }
    setBusy(r.id + action);
    try {
      const d = await send(`${API}/amendment-requests/${r.kind}/${r.id}/${action === "retry" ? "retry-recalc" : action}`, { note: notes[r.id] || null });
      if (d.warning) toast.warning(d.warning); else toast.success({ approve: "Approved and applied", reject: "Rejected — nothing changed", withdraw: "Request withdrawn", retry: "Commission recalculated" }[action]);
      load();
    } catch (e) { toast.error(e.message); if (e.code === "stale" || e.code === "already_decided") load(); } finally { setBusy(null); }
  };
  const rows = data?.requests || [];
  return (
    <div className="space-y-3" data-testid="amendment-queue">
      <div className="flex items-center gap-2 flex-wrap">
        {[["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["stale", "Out of date"], ["", "All"]].map(([k, l]) => (
          <button key={k || "all"} onClick={() => setStatus(k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${status === k ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600"}`}>{l}</button>))}
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800">Refresh</button>
      </div>
      {data?.error && <p className="text-xs text-red-600">{data.error}</p>}
      {!data ? <p className="text-xs text-gray-400">Loading…</p> : rows.length === 0 ? <p className="text-xs text-gray-400">Nothing here.</p> : rows.map(r => {
        const own = r.requested_by === (data.me || user?.id);
        const b = r.before_snapshot || {};
        return (
          <div key={r.kind + r.id} className="bg-white border rounded-2xl p-4 space-y-2" data-testid="queue-row">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full mr-2 ${r.kind === "deposit" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}>{r.kind === "deposit" ? "Order deposit" : "Payment"}</span>
                <b className="text-sm">{r.request_type === "reverse" ? "Reverse" : "Change"}</b>
                <span className="text-xs text-gray-500 ml-2">
                  {r.kind === "deposit" ? `SO ${r.sales_order?.order_number || b.order_number || ""} · ${r.sales_order?.customer_name || ""}` : `${b.or_number != null ? `OR #${b.or_number} · ` : ""}${money(b.amount)}`}
                </span>
              </div>
              <RequestBadge request={r} prefix="" />
            </div>
            <ChangeTable r={r} />
            <p className="text-[11px] text-gray-500">Requested by <b>{r.requested_by_name || "—"}</b> · {when(r.requested_at)} · Reason: “{r.reason}”</p>
            {r.reviewed_at && <p className="text-[11px] text-gray-500">{STATUS_LABEL[r.status]} by {r.reviewed_by_name || "—"} · {when(r.reviewed_at)}{r.decision_note ? ` · “${r.decision_note}”` : ""}</p>}
            {r.commission_review && <p className="text-[11px] rounded-lg bg-orange-50 border border-orange-200 text-orange-800 px-2 py-1" data-testid="commission-review">⚠ {r.commission_review.note} ({(r.commission_review.paid_commissions || []).length} paid commission row(s))</p>}
            {r.status === "approved" && r.recalc_status === "failed" && <div className="text-[11px] rounded-lg bg-red-50 border border-red-200 text-red-700 px-2 py-1 flex items-center justify-between gap-2">
              <span>Commission recalculation failed: {r.recalc_error}</span>
              {data.is_approver && <button onClick={() => act(r, "retry")} disabled={busy === r.id + "retry"} className="underline">Retry commission</button>}</div>}
            {r.status === "pending" && data.is_approver && (own
              ? <p className="text-[11px] text-gray-400" data-testid="own-request">Your own request — another Manager / Finance must decide it.</p>
              : <div className="flex items-center gap-2 flex-wrap">
                  <input value={notes[r.id] || ""} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} placeholder="Note (required to reject)" aria-label="Decision note" className="flex-1 min-w-[160px] px-2 py-1.5 rounded-lg border text-xs" />
                  <button onClick={() => act(r, "reject")} disabled={!!busy} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs" data-testid="reject-btn">Reject</button>
                  <button onClick={() => act(r, "approve")} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs" data-testid="approve-btn">{busy === r.id + "approve" ? "Applying…" : "Approve"}</button>
                </div>)}
            {r.status === "pending" && own && <button onClick={() => act(r, "withdraw")} className="text-[11px] text-gray-500 underline">Withdraw my request</button>}
          </div>
        );
      })}
    </div>
  );
}
