import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => {
  const token = await getToken();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};
const fmtDateTime = d => d ? new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
const money = v => `RM ${(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS = {
  pending:  { label: "Pending approval", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rejected", cls: "bg-gray-100 text-gray-500" },
  conflict: { label: "Conflict", cls: "bg-orange-100 text-orange-700" },
};

// Field-by-field before/after table from the two JSON snapshots. Canonical
// (P0-18) snapshot column names are before_snapshot / proposed_snapshot —
// NOT before_data/after_data (that was the never-applied migration 073
// design; see migrations/079_document_order_amendments_deprecated.sql).
const FIELDS = [
  ["customer_name", "Customer", "text"], ["customer_contact", "Contact", "text"],
  ["customer_address", "Address", "text"], ["delivery_address", "Delivery address", "text"],
  ["customer_email", "Email", "text"], ["customer_id_no", "IC/ID", "text"],
  ["salesman_name", "Salesperson", "text"],
  ["order_date", "Order date", "text"], ["delivery_date", "Delivery date", "text"], ["delivery_time_slot", "Time slot", "text"],
  ["delivery_type", "Delivery type", "text"], ["remark", "Remark", "text"],
  ["payment_method", "Payment method", "text"],
  ["subtotal", "Subtotal", "money"], ["discount", "Discount", "money"],
  ["admin_charges", "Admin charges", "money"], ["gst_amount", "GST", "money"], ["deposit", "Deposit", "money"],
];
const val = (type, v) => {
  if (v === null || v === undefined || v === "") return type === "money" ? money(0) : "—";
  return type === "money" ? money(v) : String(v);
};
const norm = v => (v ?? "").toString().trim().toLowerCase();

// A 'critical' proposed_snapshot uses `items`; before_snapshot (a raw
// sales_orders row) uses `sales_order_items`. A 'customer_detail' snapshot
// uses `items` on both sides. Normalize to one array either way.
const snapshotItems = snap => (snap?.items || snap?.sales_order_items || []);

// Same identity rule the backend uses for arrival-preservation and conflict
// detection (P0-18) — product_id when known, else code+name+size+color.
// Order-independent, so a reordered-but-unchanged item is never read as a
// replacement (P0-19 §5).
const itemKey = it => it.product_id
  ? `p:${it.product_id}`
  : `t:${norm(it.product_code)}|${norm(it.product_name)}|${norm(it.size)}|${norm(it.color)}`;
const itemOption = it => [it?.size, it?.color, it?.custom_dimensions].filter(Boolean).join(" / ") || "-";

function diffItems(before, after) {
  const beforeMap = new Map(snapshotItems(before).map(it => [itemKey(it), it]));
  const afterMap = new Map(snapshotItems(after).map(it => [itemKey(it), it]));
  const diffs = [];
  for (const [key, it] of afterMap) {
    if (!beforeMap.has(key)) { diffs.push({ type: "added", key, after: it }); continue; }
    const b = beforeMap.get(key);
    const qtyChanged = (Number(b.quantity) || 0) !== (Number(it.quantity) || 0);
    const priceChanged = (Number(b.unit_price) || 0) !== (Number(it.unit_price) || 0);
    const nameChanged = norm(b.product_name) !== norm(it.product_name);
    const optionChanged = norm(b.size) !== norm(it.size) || norm(b.color) !== norm(it.color);
    if (qtyChanged || priceChanged || nameChanged || optionChanged) {
      diffs.push({ type: "changed", key, before: b, after: it, qtyChanged, priceChanged, nameChanged, optionChanged });
    }
  }
  for (const [key, it] of beforeMap) {
    if (!afterMap.has(key)) diffs.push({ type: "removed", key, before: it });
  }
  return diffs;
}

function BeforeAfter({ before, after }) {
  const b = before || {}, a = after || {};
  const rows = FIELDS.filter(([k, , type]) => {
    const bv = b[k], av = a[k];
    if (av === undefined) return false; // field not part of this proposal
    return type === "money" ? (Number(bv) || 0) !== (Number(av) || 0) : norm(bv) !== norm(av);
  });
  const itemDiffs = diffItems(b, a);
  if (rows.length === 0 && itemDiffs.length === 0) return <p className="text-xs text-gray-400">No field-level differences recorded.</p>;
  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="py-1 pr-3 font-medium">Field</th>
                <th className="py-1 pr-3 font-medium">Before</th>
                <th className="py-1 font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, label, type]) => (
                <tr key={k} className="border-t border-gray-100 align-top">
                  <td className="py-1 pr-3 text-gray-600 whitespace-nowrap">{label}</td>
                  <td className="py-1 pr-3 text-red-600 line-through decoration-red-300 break-words">{val(type, b[k])}</td>
                  <td className="py-1 text-emerald-700 font-medium break-words">{val(type, a[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {itemDiffs.length > 0 && (
        <div className="space-y-1.5">
          {itemDiffs.map((d, i) => (
            <div key={d.key || i} className={`rounded-lg p-2 border text-xs ${d.type === "added" ? "border-emerald-200 bg-emerald-50" : d.type === "removed" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
              <p className={`font-bold mb-0.5 ${d.type === "added" ? "text-emerald-700" : d.type === "removed" ? "text-red-700" : "text-amber-700"}`}>
                Item {i + 1} — {d.type === "added" ? "ADDED" : d.type === "removed" ? "REMOVED" : "CHANGED"}
              </p>
              {d.type === "changed" ? (
                <div className="space-y-0.5">
                  {d.nameChanged && <p><span className="text-gray-500">Model: </span>{d.before.product_name || "-"} → <span className="font-medium text-gray-900">{d.after.product_name || "-"}</span></p>}
                  {d.optionChanged && <p><span className="text-gray-500">Option: </span>{itemOption(d.before)} → <span className="font-medium text-gray-900">{itemOption(d.after)}</span></p>}
                  {!d.nameChanged && !d.optionChanged && <p className="text-gray-700 font-medium">{d.after.product_name || "-"}{itemOption(d.after) !== "-" ? ` (${itemOption(d.after)})` : ""}</p>}
                  {d.qtyChanged && <p><span className="text-gray-500">Qty: </span>{d.before.quantity || 0} → <span className="font-medium text-gray-900">{d.after.quantity || 0}</span></p>}
                  {d.priceChanged && <p><span className="text-gray-500">Price: </span>{money(d.before.unit_price)} → <span className="font-medium text-gray-900">{money(d.after.unit_price)}</span></p>}
                </div>
              ) : (
                <p className="text-gray-700">{(d.after || d.before).product_name || "-"} · Option: {itemOption(d.after || d.before)} · Qty: {(d.after || d.before).quantity || 0} · Unit Price: {money((d.after || d.before).unit_price)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AmendmentCard({ a, isApprover, busyId, onDecide }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-900 text-sm">SO {a.order_number || "—"}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS[a.status]?.cls || "bg-gray-100 text-gray-600"}`}>{STATUS[a.status]?.label || a.status}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-50 text-violet-600">{a.category === "customer_detail" ? "Customer Detail" : "Critical"}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {a.customer_name ? `${a.customer_name} · ` : ""}Salesperson {a.before_snapshot?.salesman_name || "—"} · Requested by {a.requested_by_name || "—"} · {fmtDateTime(a.requested_at || a.created_at)}
            {a.reviewed_at && ` · reviewed by ${a.reviewed_by_name || "—"} ${fmtDateTime(a.reviewed_at)}`}
          </p>
        </div>
        {isApprover && a.status === "pending" && !rejecting && (
          <div className="flex gap-2">
            <button onClick={() => setRejecting(true)} disabled={busyId === a.id}
              className="px-3 py-1.5 text-xs rounded-xl border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">Reject</button>
            <button onClick={() => onDecide(a.id, "approve")} disabled={busyId === a.id}
              className="px-4 py-1.5 text-xs rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">Approve</button>
          </div>
        )}
      </div>

      {a.status === "conflict" && (
        <div className="mt-2 bg-orange-50 border border-orange-200 rounded-xl p-2.5 text-xs text-orange-700">
          <span className="font-bold">⚠ AMENDMENT CONFLICT — </span>
          The Sales Order changed since this was requested; it was not auto-applied and nothing was overwritten. Reload the order, review the latest values, and ask the salesperson to resubmit if the change is still needed.
        </div>
      )}
      {a.status === "rejected" && a.decision_note && (
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs text-gray-600"><span className="font-bold">Reason: </span>{a.decision_note}</div>
      )}

      {Array.isArray(a.changes) && a.changes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {a.changes.map((c, i) => <span key={i} className="text-[11px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">{c}</span>)}
        </div>
      )}

      <div className="mt-3 border-t border-gray-100 pt-3">
        <BeforeAfter before={a.before_snapshot} after={a.proposed_snapshot} />
      </div>

      {rejecting && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          <label className="block text-xs font-medium text-gray-500">Reason / Decision Note (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. Customer has not confirmed the model change."
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
          <div className="flex gap-2">
            <button onClick={() => { setRejecting(false); setNote(""); }} disabled={busyId === a.id}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">Cancel</button>
            <button onClick={() => onDecide(a.id, "reject", note)} disabled={busyId === a.id}
              className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Confirm Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderAmendmentsPage({ onDecided } = {}) {
  const { user } = useAuth(); // eslint-disable-line no-unused-vars
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [isApprover, setIsApprover] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending"); // pending | approved | rejected | conflict | all
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const res = await af(`${API}/order-amendments`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to load amendments");
      setRows(Array.isArray(d.amendments) ? d.amendments : []);
      setIsApprover(!!d.is_approver);
    } catch (e) { setLoadError(e.message || "Failed to load amendments"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Approve/reject always call the canonical P0-18 endpoints — this page
  // never applies an amendment itself. A conflict (409) is not a generic
  // error: the backend has already marked the amendment 'conflict', so
  // reload to reflect that distinct state instead of leaving it looking
  // like a transient failure.
  const decide = async (id, action, note) => {
    setBusyId(id);
    try {
      const res = await af(`${API}/order-amendments/${id}/${action}`, { method: "PATCH", body: JSON.stringify(note ? { note } : {}) });
      const d = await res.json();
      if (!res.ok) {
        if (res.status === 409) { toast.error(d.error || "The Sales Order changed since this amendment was requested."); await load(); onDecided?.(); return; }
        throw new Error(d.error || "Failed to update amendment");
      }
      toast.success(action === "approve" ? "Amendment approved — Sales Order updated." : "Amendment rejected — Sales Order left unchanged.");
      await load();
      // App.js's nav badge reads a separate /dashboard/bootstrap count —
      // nudge it too so the badge clears immediately, not just on next
      // page load or company switch.
      onDecided?.();
    } catch (e) { toast.error(e.message); }
    finally { setBusyId(null); }
  };

  const filtered = rows.filter(r => statusFilter === "all" || r.status === statusFilter);
  const pendingCount = rows.filter(r => r.status === "pending").length;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Order Amendments</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {isApprover ? "Review changes made to confirmed orders and approve or reject them." : "Your amendments to confirmed orders, awaiting manager approval."}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
          {[["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["conflict", "Conflict"], ["all", "All"]].map(([k, label]) => (
            <button key={k} onClick={() => setStatusFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === k ? "bg-white text-violet-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {label}{k === "pending" && pendingCount > 0 && <span className="ml-1 bg-red-100 text-red-700 text-xs font-bold px-1.5 rounded-full">{pendingCount}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}

      {!loading && loadError && (
        <div className="text-center py-16 text-red-500">
          <p className="font-medium">{loadError}</p>
          <button onClick={load} className="mt-3 text-sm px-4 py-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100">Retry</button>
        </div>
      )}

      {!loading && !loadError && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📝</div>
          <p className="font-medium">No {statusFilter === "all" ? "" : statusFilter} Sales Order amendments</p>
          <p className="text-xs mt-1">Critical edits to confirmed orders will appear here for approval.</p>
        </div>
      )}

      {!loading && !loadError && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map(a => (
            <AmendmentCard key={a.id} a={a} isApprover={isApprover} busyId={busyId} onDecide={decide} />
          ))}
        </div>
      )}
    </div>
  );
}
