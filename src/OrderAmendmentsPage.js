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

const STATUS = {
  pending:  { label: "Pending approval", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rejected", cls: "bg-gray-100 text-gray-500" },
};

// Field-by-field before/after table from the two JSON snapshots.
const FIELDS = [
  ["status", "Status"], ["customer_name", "Customer"], ["customer_contact", "Contact"],
  ["customer_address", "Address"], ["delivery_address", "Delivery address"],
  ["customer_email", "Email"], ["customer_id_no", "IC/ID"],
  ["order_date", "Order date"], ["delivery_date", "Delivery date"], ["delivery_time_slot", "Time slot"],
  ["delivery_type", "Delivery type"], ["remark", "Remark"], ["salesman_name", "Salesman"],
  ["payment_method", "Payment method"], ["subtotal", "Subtotal"], ["discount", "Discount"],
  ["admin_charges", "Admin charges"], ["gst_amount", "GST"], ["deposit", "Deposit"],
];
const val = v => (v === null || v === undefined || v === "") ? "—" : String(v);
const itemsStr = arr => (Array.isArray(arr) ? arr : []).map(i => `${i.product_name || i.product_code || "item"} ×${Number(i.quantity) || 0} @${Number(i.unit_price) || 0}`).join("\n") || "—";

function BeforeAfter({ before, after }) {
  const b = before || {}, a = after || {};
  const rows = FIELDS.filter(([k]) => val(b[k]) !== val(a[k]));
  const itemsChanged = itemsStr(b.items) !== itemsStr(a.items);
  if (rows.length === 0 && !itemsChanged) return <p className="text-xs text-gray-400">No field-level differences recorded.</p>;
  return (
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
          {rows.map(([k, label]) => (
            <tr key={k} className="border-t border-gray-100 align-top">
              <td className="py-1 pr-3 text-gray-600 whitespace-nowrap">{label}</td>
              <td className="py-1 pr-3 text-red-600 line-through decoration-red-300">{val(b[k])}</td>
              <td className="py-1 text-emerald-700 font-medium">{val(a[k])}</td>
            </tr>
          ))}
          {itemsChanged && (
            <tr className="border-t border-gray-100 align-top">
              <td className="py-1 pr-3 text-gray-600">Items</td>
              <td className="py-1 pr-3 text-red-600 whitespace-pre-line">{itemsStr(b.items)}</td>
              <td className="py-1 text-emerald-700 whitespace-pre-line font-medium">{itemsStr(a.items)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function OrderAmendmentsPage() {
  const { user } = useAuth(); // eslint-disable-line no-unused-vars
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [isApprover, setIsApprover] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending"); // pending | approved | rejected | all
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await af(`${API}/order-amendments`);
      const d = await res.json();
      setRows(Array.isArray(d.amendments) ? d.amendments : []);
      setIsApprover(!!d.is_approver);
    } catch (e) { toast.error("Failed to load amendments"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const decide = async (id, action) => {
    if (action === "reject" && !window.confirm("Reject this amendment? The order stays flagged (Amended) for correction.")) return;
    setBusyId(id);
    try {
      const res = await af(`${API}/order-amendments/${id}/${action}`, { method: "PATCH", body: JSON.stringify({}) });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      toast.success(action === "approve" ? "Amendment approved — order confirmed" : "Amendment rejected");
      load();
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
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {[["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]].map(([k, label]) => (
            <button key={k} onClick={() => setStatusFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === k ? "bg-white text-violet-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {label}{k === "pending" && pendingCount > 0 && <span className="ml-1 bg-red-100 text-red-700 text-xs font-bold px-1.5 rounded-full">{pendingCount}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📝</div>
          <p className="font-medium">No {statusFilter === "all" ? "" : statusFilter} amendments</p>
          <p className="text-xs mt-1">Edits to confirmed orders will appear here for approval.</p>
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {filtered.map(a => (
            <div key={a.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 text-sm">SO {a.order_number || "—"}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS[a.status]?.cls || "bg-gray-100 text-gray-600"}`}>{STATUS[a.status]?.label || a.status}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    By {a.requested_by_name || "—"} · {fmtDateTime(a.created_at)}
                    {a.decided_at && ` · decided by ${a.decided_by_name || "—"} ${fmtDateTime(a.decided_at)}`}
                  </p>
                </div>
                {isApprover && a.status === "pending" && (
                  <div className="flex gap-2">
                    <button onClick={() => decide(a.id, "reject")} disabled={busyId === a.id}
                      className="px-3 py-1.5 text-xs rounded-xl border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">Reject</button>
                    <button onClick={() => decide(a.id, "approve")} disabled={busyId === a.id}
                      className="px-4 py-1.5 text-xs rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                  </div>
                )}
              </div>

              {Array.isArray(a.changes) && a.changes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.changes.map((c, i) => <span key={i} className="text-[11px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">{c}</span>)}
                </div>
              )}

              <div className="mt-3 border-t border-gray-100 pt-3">
                <BeforeAfter before={a.before_data} after={a.after_data} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
