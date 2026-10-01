// Linked Service info for a Delivery Order / delivery stop — INTERNAL, read-only.
//
// Shows the Service cases of the stop's Sales Order straight from the
// canonical Service records: GET /service-cases?so_number=<SO> (services.order_id
// = the SO's legacy orders.id; company-scoped server-side, fails closed). The
// link is at SO level, so a superseded → regenerated DO keeps showing the same
// cases. Nothing here is copied onto the DO, and nothing is written.
//
// Renders nothing while loading, on error, or when the SO has no Service
// cases — a normal DO looks exactly as before. Active cases (open / scheduled /
// in progress / claiming) are shown; completed ones (resolved / closed /
// cancelled) are tucked under a toggle so history is never mistaken for the
// current job. Never used by the customer-facing DO print.
import { useEffect, useState } from "react";
import { supabase } from "./AuthContext";
import { SERVICE_TYPES, TYPE_ICON, ITEM_ACTIONS } from "./ServiceCaseFormModal";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const af = async (url) => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token || "";
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { headers: { Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};

// Same lifecycle grouping as the Service page (ServicePage STATUS_GROUPS).
export const HISTORY_STATUSES = ["resolved", "closed", "cancelled", "completed"];
export const isHistoricalService = (s) => HISTORY_STATUSES.includes(String(s?.status || "").toLowerCase());

const STATUS_LABEL = { open: "Open", scheduled: "Scheduled", in_progress: "In progress", claiming: "Claiming", resolved: "Resolved", closed: "Closed", cancelled: "Cancelled", completed: "Completed" };
const STATUS_STYLE = {
  open: "bg-gray-100 text-gray-700", scheduled: "bg-blue-100 text-blue-700", in_progress: "bg-amber-100 text-amber-700",
  claiming: "bg-violet-100 text-violet-700", resolved: "bg-emerald-100 text-emerald-700", closed: "bg-gray-100 text-gray-400",
};
const dmy = v => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T00:00:00" : v); return isNaN(d) ? "" : d.toLocaleDateString("en-MY"); };

function ServiceCard({ s, muted }) {
  const items = Array.isArray(s._items) ? s._items : [];
  const scheduled = s.schedule_tbc ? "TBC" : (s.due_date ? dmy(s.due_date) : "");
  const label = s._sv_number || `Service #${s.id}`;
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${muted ? "border-gray-200 bg-gray-50 opacity-80" : "border-violet-200 bg-violet-50"}`}
      data-testid="linked-service-card">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm">{TYPE_ICON[s.service_type] || "🔧"}</span>
        <span className="font-bold text-sm text-violet-800">{label}</span>
        <span className="text-xs text-gray-600">{SERVICE_TYPES[s.service_type] || `Type ${s.service_type}`}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[s.status] || "bg-gray-100 text-gray-600"}`}>{STATUS_LABEL[s.status] || s.status}</span>
      </div>
      <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-0.5">
        {s._order?.so_number && <span>Linked SO: <span className="font-medium text-gray-800">{s._order.so_number}</span></span>}
        {scheduled && <span>Scheduled: <span className="font-medium text-gray-800">{scheduled}</span></span>}
        {s._assigned?.name && <span>Assigned: <span className="font-medium text-gray-800">{s._assigned.name}</span></span>}
      </div>
      {s.description && (
        <p className="mt-1.5 text-sm text-gray-800 whitespace-pre-line break-words">{s.description}</p>
      )}
      {items.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {items.map(it => (
            <li key={it.id} className="flex items-start justify-between gap-2 text-xs">
              <span className="text-gray-800 break-words">
                {ITEM_ACTIONS[it.action_type] && <span className="text-violet-700 font-medium">[{ITEM_ACTIONS[it.action_type]}] </span>}
                {it.description || "—"}
              </span>
              <span className="text-gray-500 whitespace-nowrap">×{Number(it.quantity) || 1}{it.status === "done" ? " · ✓ done" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Presentational part (exported for tests).
export function LinkedServicesView({ services }) {
  const [showHistory, setShowHistory] = useState(false);
  const list = Array.isArray(services) ? services : [];
  if (list.length === 0) return null;
  const active = list.filter(s => !isHistoricalService(s));
  const history = list.filter(isHistoricalService);
  return (
    <div data-testid="linked-services">
      <p className="text-xs font-bold text-violet-700 mb-1">SERVICE{active.length ? ` (${active.length} active)` : ""}</p>
      <div className="space-y-1.5">
        {active.map(s => <ServiceCard key={s.id} s={s} />)}
        {active.length === 0 && <p className="text-xs text-gray-500">No active Service case for this order.</p>}
      </div>
      {history.length > 0 && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setShowHistory(v => !v)} className="text-xs text-gray-500 hover:text-gray-700 underline">
            {showHistory ? "Hide" : "Show"} {history.length} completed Service case{history.length > 1 ? "s" : ""}
          </button>
          {showHistory && <div className="mt-1.5 space-y-1.5">{history.map(s => <ServiceCard key={s.id} s={s} muted />)}</div>}
        </div>
      )}
    </div>
  );
}

export default function LinkedServicesSection({ soNumber }) {
  const [services, setServices] = useState(null);
  useEffect(() => {
    let alive = true;
    setServices(null);
    if (!soNumber) return undefined;
    af(`${API}/service-cases?so_number=${encodeURIComponent(soNumber)}`)
      .then(r => (r.ok ? r.json() : { services: [] }))
      .then(d => { if (alive) setServices(Array.isArray(d.services) ? d.services : []); })
      .catch(() => { if (alive) setServices([]); });
    return () => { alive = false; };
  }, [soNumber]);
  return <LinkedServicesView services={services} />;
}
