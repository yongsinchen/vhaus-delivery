import React, { useState, useEffect, useCallback, memo } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast } from "./UIComponents";
import CreateDeliveryOrderModal from "./CreateDeliveryOrderModal";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => {
  const token = await getToken();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};
const fmt = d => d ? new Date(d + "T00:00").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "-";
const todayStr = new Date().toISOString().slice(0, 10);

const STATUS = {
  pending:          { label: "Pending review", cls: "bg-amber-100 text-amber-700" },
  needs_reschedule: { label: "Needs another date", cls: "bg-orange-100 text-orange-700" },
  approved:         { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  rejected:         { label: "Rejected", cls: "bg-gray-100 text-gray-500" },
};

function DeliveryDateRequestsPage() {
  const { user } = useAuth(); // eslint-disable-line no-unused-vars
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [isApprover, setIsApprover] = useState(false);
  const [loading, setLoading] = useState(true);
  const [doFor, setDoFor] = useState(null); // { salesOrderId, orderNumber, date } — Create DO after approval

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await af(`${API}/delivery-date-requests`);
      const d = await res.json();
      setRows(d.requests || []);
      setIsApprover(!!d.is_approver);
    } catch (e) { toast.error("Failed to load requests"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  // ── Salesman: new request ────────────────────────────────────────
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null);
  const [reqDate, setReqDate] = useState("");
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const search = async (term) => {
    setQ(term);
    if (term.trim().length < 2) { setResults([]); return; }
    const res = await af(`${API}/orders?search=${encodeURIComponent(term.trim())}`);
    const d = await res.json();
    setResults(Array.isArray(d) ? d : []);
  };
  const submitRequest = async () => {
    if (!picked) { toast.warning("Pick an order first"); return; }
    if (!reqDate) { toast.warning("Choose a delivery date"); return; }
    setSaving(true);
    try {
      const res = await af(`${API}/delivery-date-requests`, { method: "POST", body: JSON.stringify({ order_id: picked.id, requested_date: reqDate, remark }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      toast.success("Request sent for approval");
      setPicked(null); setQ(""); setResults([]); setReqDate(""); setRemark("");
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  const pickAlternative = async (r, date) => {
    if (!window.confirm(`Confirm delivery on ${fmt(date)} for SO ${r.so_number}?`)) return;
    const res = await af(`${API}/delivery-date-requests/${r.id}/pick`, { method: "PATCH", body: JSON.stringify({ requested_date: date }) });
    const d = await res.json();
    if (res.ok) { toast.success("Delivery date set"); load(); } else toast.error(d.error || "Failed");
  };

  // ── PIC actions ──────────────────────────────────────────────────
  const [proposeFor, setProposeFor] = useState(null); // request being given alternatives
  const [altDates, setAltDates] = useState(["", "", ""]);
  const [altNote, setAltNote] = useState("");
  const approve = async (r) => {
    const res = await af(`${API}/delivery-date-requests/${r.id}/approve`, { method: "PATCH", body: JSON.stringify({}) });
    const d = await res.json();
    if (res.ok) {
      toast.success(`Approved — SO ${r.so_number} set to ${fmt(r.requested_date)}`);
      load();
      // Straight after approving, open the Create Delivery Order picker so the
      // admin can build a DO from the SO's items (arrived or not) — same flow
      // as the Orders page. Needs the sales_order id; legacy requests without
      // one just approve as before.
      const soId = d.request?.sales_order_id || r.sales_order_id;
      if (soId) setDoFor({ salesOrderId: soId, orderNumber: `SO ${r.so_number}`, date: r.requested_date });
    } else toast.error(d.error || "Failed");
  };
  const reject = async (r) => {
    const note = window.prompt("Reason for rejecting (optional):") ?? null;
    const res = await af(`${API}/delivery-date-requests/${r.id}/reject`, { method: "PATCH", body: JSON.stringify({ note }) });
    if (res.ok) { toast.success("Rejected"); load(); } else { const d = await res.json().catch(() => ({})); toast.error(d.error || "Failed"); }
  };
  const submitPropose = async () => {
    const dates = altDates.map(d => d.trim()).filter(Boolean);
    if (dates.length === 0) { toast.warning("Add at least one date"); return; }
    const res = await af(`${API}/delivery-date-requests/${proposeFor.id}/propose`, { method: "PATCH", body: JSON.stringify({ alternative_dates: dates, note: altNote }) });
    const d = await res.json();
    if (res.ok) { toast.success("Alternative dates sent to the salesman"); setProposeFor(null); setAltDates(["", "", ""]); setAltNote(""); load(); }
    else toast.error(d.error || "Failed");
  };

  const open = rows.filter(r => r.status === "pending" || r.status === "needs_reschedule");
  const done = rows.filter(r => r.status === "approved" || r.status === "rejected");

  const Badge = ({ s }) => <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS[s]?.cls || "bg-gray-100 text-gray-500"}`}>{STATUS[s]?.label || s}</span>;

  const Card = ({ r }) => (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-violet-700">SO {r.so_number}</span>
            <Badge s={r.status} />
          </div>
          <p className="text-sm text-gray-700 mt-0.5">{r.customer_name || ""}</p>
          <p className="text-sm mt-1"><span className="text-gray-400">Requested date:</span> <b className="text-gray-900">{fmt(r.requested_date)}</b></p>
          {r.remark && <p className="text-xs text-gray-500 mt-1 bg-gray-50 rounded-lg px-2 py-1.5">📝 {r.remark}</p>}
          <p className="text-xs text-gray-400 mt-1">by {r.requested_by_name || "salesman"} · {new Date(r.created_at).toLocaleDateString("en-MY")}</p>
        </div>
        {isApprover && (r.status === "pending" || r.status === "needs_reschedule") && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <button onClick={() => approve(r)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
            <button onClick={() => { setProposeFor(r); setAltDates(["", "", ""]); setAltNote(""); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600">Propose dates</button>
            <button onClick={() => reject(r)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50">Reject</button>
          </div>
        )}
      </div>

      {/* PIC's proposed alternatives */}
      {r.status === "needs_reschedule" && Array.isArray(r.alternative_dates) && r.alternative_dates.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          {r.decision_note && <p className="text-xs text-amber-700 mb-2">{r.decision_note}</p>}
          <p className="text-xs text-gray-500 mb-1.5">{isApprover ? "Proposed to the salesman:" : "The reviewer suggested these dates — pick one to confirm:"}</p>
          <div className="flex flex-wrap gap-2">
            {r.alternative_dates.map((d, i) => (
              isApprover
                ? <span key={i} className="text-xs px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium">{fmt(d)}</span>
                : <button key={i} onClick={() => pickAlternative(r, d)} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700">{fmt(d)}</button>
            ))}
          </div>
        </div>
      )}
      {r.status === "rejected" && r.decision_note && <p className="text-xs text-gray-400 mt-2 border-t border-gray-100 pt-2">{r.decision_note}</p>}
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Delivery Date {isApprover ? "Approvals" : "Requests"}</h1>
        <p className="text-sm text-gray-400 mt-1">{isApprover
          ? "Review the dates salesmen requested. Approve to set the date, or propose alternatives if it can't fit."
          : "Request a delivery date for an order. It's applied only after a reviewer approves."}</p>
      </div>

      {/* Salesman: create a request */}
      {!isApprover && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">New request</h2>
          {picked ? (
            <div className="flex items-center justify-between bg-violet-50 rounded-xl px-3 py-2">
              <span className="text-sm"><b className="text-violet-700">SO {picked.so_number}</b> · {picked.customer_name}</span>
              <button onClick={() => { setPicked(null); setQ(""); }} className="text-xs text-gray-400 hover:text-red-500">change</button>
            </div>
          ) : (
            <div className="relative">
              <input value={q} onChange={e => search(e.target.value)} placeholder="Search order by SO number or customer…"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white rounded-xl border border-gray-200 shadow-lg max-h-56 overflow-y-auto">
                  {results.map(o => (
                    <button key={o.id} onClick={() => { setPicked(o); setResults([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50 border-b border-gray-50 last:border-0">
                      <b className="text-violet-700">SO {o.so_number}</b> <span className="text-gray-600">· {o.customer_name}</span>
                      {o.delivery_date && <span className="text-xs text-gray-400 ml-1">(current: {o.delivery_date})</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Delivery date</label>
              <input type="date" min={todayStr} value={reqDate} onChange={e => setReqDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Remark <span className="text-gray-400">(reason / notes for the reviewer)</span></label>
            <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2} placeholder="e.g. customer requested Saturday; big lorry needed…"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
          </div>
          <button onClick={submitRequest} disabled={saving || !picked || !reqDate}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
            {saving ? "Sending…" : "Send for approval"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>
      ) : (
        <>
          <div>
            <h2 className="text-sm font-bold text-gray-700 mb-2">{isApprover ? `Awaiting review (${open.length})` : `Open (${open.length})`}</h2>
            {open.length === 0 ? <p className="text-sm text-gray-400">Nothing awaiting {isApprover ? "your review" : "approval"}.</p>
              : <div className="space-y-3">{open.map(r => <Card key={r.id} r={r} />)}</div>}
          </div>
          {done.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 mb-2">Recent decisions</h2>
              <div className="space-y-3">{done.slice(0, 30).map(r => <Card key={r.id} r={r} />)}</div>
            </div>
          )}
        </>
      )}

      {/* Propose alternatives modal */}
      {proposeFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setProposeFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">Propose dates · SO {proposeFor.so_number}</h3>
              <button onClick={() => setProposeFor(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-gray-500">Requested: <b>{fmt(proposeFor.requested_date)}</b>. Suggest up to 3 dates that can fit.</p>
              {altDates.map((d, i) => (
                <input key={i} type="date" min={todayStr} value={d} onChange={e => setAltDates(a => a.map((x, j) => j === i ? e.target.value : x))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              ))}
              <textarea value={altNote} onChange={e => setAltNote(e.target.value)} rows={2} placeholder="Note to the salesman (optional)…"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              <button onClick={submitPropose} className="w-full py-2.5 rounded-xl text-sm font-medium bg-amber-500 text-white hover:bg-amber-600">Send suggestions</button>
            </div>
          </div>
        </div>
      )}

      {doFor && (
        <CreateDeliveryOrderModal
          salesOrderId={doFor.salesOrderId}
          orderNumber={doFor.orderNumber}
          defaultDate={doFor.date}
          onClose={() => setDoFor(null)}
          onCreated={() => { setDoFor(null); load(); }}
        />
      )}
    </div>
  );
}

export default memo(DeliveryDateRequestsPage);
