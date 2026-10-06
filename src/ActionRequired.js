// Phase 4A — Operations "Action Required".
//
// ActionRequiredPanel: count cards on Overview (GET /operations/action-required).
//   The backend returns only the categories this user may open, for the active
//   company only; a card's number is the length of the list it drills into.
// ActionCategoryList: the focused list behind a delivery / service card,
//   shown inside Deliveries → Delivery Orders (GET /operations/action-required/:category).
// Read-only: no action here changes anything; rows link to the existing pages.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./AuthContext";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const af = async (url) => {
  const { data } = await supabase.auth.getSession();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { headers: { Authorization: `Bearer ${data?.session?.access_token || ""}`, ...(cid && { "X-Company-ID": cid }) } });
};

// Display order, wording and where each card drills to.
export const ACTION_CARDS = [
  { key: "tbc", label: "TBC Delivery", sub: "no delivery date yet", target: "deliveries" },
  { key: "pending_date_approval", label: "Date Approvals", sub: "waiting for a decision", target: "delivery-approvals" },
  { key: "pending_amendment", label: "Order Amendments", sub: "waiting for approval", target: "order-amendments" },
  { key: "unscheduled_delivery", label: "Unscheduled Delivery", sub: "dated, no team", target: "deliveries" },
  { key: "unscheduled_service", label: "Unscheduled Service", sub: "dated, no team", target: "deliveries" },
  { key: "past_dated_delivery", label: "Past-dated Delivery", sub: "date passed, not completed", target: "deliveries" },
  { key: "past_dated_service", label: "Past-dated Service", sub: "date passed, still open", target: "deliveries" },
];
export const FOCUS_CATEGORIES = ["unscheduled_delivery", "unscheduled_service", "past_dated_delivery", "past_dated_service"];
const dmy = iso => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const labelOf = key => ACTION_CARDS.find(c => c.key === key)?.label || key;

export function ActionRequiredPanel({ companyId, onOpen }) {
  const [state, setState] = useState({ loading: true, data: null, hidden: false, error: null });
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const r = await af(`${API}/operations/action-required`);
      if (r.status === 403 || r.status === 401) return setState({ loading: false, data: null, hidden: true, error: null });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed to load");
      setState({ loading: false, data: d, hidden: false, error: null });
    } catch (e) { setState({ loading: false, data: null, hidden: false, error: e.message }); }
  }, []);
  useEffect(() => { load(); }, [load, companyId]); // switching company reloads the counts
  if (state.hidden) return null;
  const counts = state.data?.counts || {};
  const cards = ACTION_CARDS.filter(c => c.key in counts);
  return (
    <section data-testid="action-required" aria-label="Action Required">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-800">Action Required</h2>
        <button type="button" onClick={load} className="text-xs text-gray-400 hover:text-gray-700">{state.loading ? "Loading…" : "Refresh"}</button>
      </div>
      {state.error ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Couldn't load Action Required — {state.error}</div>
      ) : state.loading && !state.data ? (
        <div className="text-xs text-gray-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
          {cards.map(c => {
            const n = counts[c.key];
            return (
              <button key={c.key} type="button" data-testid={`action-card-${c.key}`} onClick={() => onOpen(c)}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${n > 0 ? "bg-white border-amber-300 hover:bg-amber-50" : "bg-gray-50 border-gray-200 hover:bg-gray-100"}`}>
                <div className={`text-2xl font-bold ${n > 0 ? "text-amber-700" : "text-gray-400"}`}>{n}</div>
                <div className="text-xs font-semibold text-gray-700">{c.label}</div>
                <div className="text-[11px] text-gray-400">{c.sub}</div>
              </button>
            );
          })}
        </div>
      )}
      {(counts.past_dated_delivery > 0 || counts.past_dated_service > 0) && (
        <p className="text-[11px] text-gray-400 mt-1.5">Past-dated includes older work whose completion was never recorded — it is listed, not changed.</p>
      )}
    </section>
  );
}

export function ActionCategoryList({ category, onClose, onOpenOrder = null, onGoToSchedule = null }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [filter, setFilter] = useState("");
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const r = await af(`${API}/operations/action-required/${category}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 403 ? "You don't have access to this list." : d.error || "Failed to load");
      setState({ loading: false, data: d, error: null });
    } catch (e) { setState({ loading: false, data: null, error: e.message }); }
  }, [category]);
  useEffect(() => { load(); }, [load]);
  const ft = filter.trim().toLowerCase();
  const entries = (state.data?.entries || []).filter(e => !ft || [e.so_number, e.do_number, e.sv_number, e.customer_name, e.contact, e.address, e.salesperson, e.team, e.items]
    .some(v => String(v || "").toLowerCase().includes(ft)));
  return (
    <div data-testid="action-category-list">
      <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2 bg-amber-50">
        <h3 className="text-sm font-bold text-amber-900">Action Required · {labelOf(category)} <span className="font-normal text-amber-700" data-testid="action-list-count">({state.data ? state.data.count : "…"})</span></h3>
        <div className="flex items-center gap-2">
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter SO / DO / customer / team…" aria-label="Filter list" className="border rounded px-2 py-1 text-xs w-56" />
          <button type="button" onClick={load} className="bg-white border border-gray-300 rounded-lg px-3 py-1 text-xs hover:bg-gray-50">Refresh</button>
          <button type="button" onClick={onClose} data-testid="action-list-close" className="bg-white border border-gray-300 rounded-lg px-3 py-1 text-xs hover:bg-gray-50">× All Delivery Orders</button>
        </div>
      </div>
      {state.loading && !state.data ? <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
        : state.error ? <div className="p-6 text-center text-red-600 text-sm">{state.error}</div>
        : entries.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">{ft ? "Nothing matches the filter." : "Nothing here — all clear."}</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">DO / Service #</th><th className="px-3 py-2">SO #</th><th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Address</th><th className="px-3 py-2">Salesperson</th><th className="px-3 py-2">Items</th><th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Team</th><th className="px-3 py-2">Why</th><th className="px-3 py-2"></th>
              </tr></thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.key} className="border-t align-top" data-testid="action-row">
                    <td className="px-3 py-2 whitespace-nowrap">{e.date ? dmy(e.date) : "TBC"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">
                      {e.kind === "service" ? <span className="text-purple-700">{e.sv_number || "Service"}</span> : e.do_number || <span className="text-gray-400">no DO</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{e.so_number || "—"}</td>
                    <td className="px-3 py-2"><div className="font-medium text-gray-800">{e.customer_name || "—"}</div>{e.contact && <div className="text-gray-500">{e.contact}</div>}</td>
                    <td className="px-3 py-2 max-w-[220px]">{e.address || "—"}</td>
                    <td className="px-3 py-2">{e.salesperson || "—"}</td>
                    <td className="px-3 py-2 max-w-[240px]">{e.items || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{String(e.status || "").replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{e.team || <span className="text-gray-400">Unassigned</span>}</td>
                    <td className="px-3 py-2 text-amber-800">{e.reason}</td>
                    <td className="px-3 py-2 whitespace-nowrap space-x-1">
                      {onGoToSchedule && e.date && <button type="button" onClick={() => onGoToSchedule(e.date)} className="border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">Schedule</button>}
                      {onOpenOrder && e.sales_order_id && e.kind !== "service" && <button type="button" onClick={() => onOpenOrder(e.sales_order_id)} className="border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">Order</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
