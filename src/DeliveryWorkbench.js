// Delivery Operations workbench (Phase 3A) — Service jobs inside Deliveries →
// Delivery Orders, plus one cross-date search over Delivery Orders and Service.
//
// A Service is NOT a Delivery Order. It is listed from the canonical Service
// records (GET /delivery-workbench/services) and assigned to a team through
// the SAME schedule endpoints the board uses for a Service stop — POST
// /delivery-schedules { order_id: the Service's inert order }, PATCH team_id,
// DELETE — so the Delivery Schedule screen, print, PDF and Excel show it
// exactly as if it had been dropped on the board. No DO is ever created.
//
// Team options come from the caller (`loadTeams(date)`), which reuses the
// board's own team-status rule (only Pending/Confirmed teams of that date).
import { useEffect, useState } from "react";
import { useToast } from "./UIComponents";
import LinkedServicesSection from "./LinkedServicesSection";
import { SERVICE_TYPES, ITEM_ACTIONS } from "./ServiceCaseFormModal";
import { serviceItemQty } from "./serviceItemQty";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";

export const SERVICE_STATUS_LABEL = { open: "Open", scheduled: "Scheduled", in_progress: "In progress", claiming: "Claiming", resolved: "Resolved", completed: "Completed", closed: "Closed", cancelled: "Cancelled" };
const SERVICE_STATUS_CLS = { open: "bg-gray-100 text-gray-700", scheduled: "bg-blue-100 text-blue-700", in_progress: "bg-amber-100 text-amber-700", claiming: "bg-violet-100 text-violet-700", resolved: "bg-green-100 text-green-700", completed: "bg-green-100 text-green-700", closed: "bg-gray-200 text-gray-500", cancelled: "bg-gray-200 text-gray-500" };
export const dmy = iso => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export const ServiceBadge = () => <span className="text-[10px] bg-purple-200 text-purple-800 font-bold px-1.5 py-0.5 rounded" data-testid="service-badge">SERVICE</span>;
export const DeliveryBadge = () => <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.5 rounded" data-testid="delivery-badge">DELIVERY</span>;

/** Workbench filters for Service rows — same date / team filters as the DO list. */
export function filterServices(services, { dateFilter = "", teamFilter = "", showPast = false, today = "" } = {}) {
  return (services || [])
    .filter(s => !dateFilter || s.operational_date === dateFilter)
    // Past-dated live cases are hidden from the planning view unless asked for
    // (a date filter always shows that day in full). Lifecycle is untouched.
    .filter(s => dateFilter || showPast || !s.operational_date || s.operational_date >= today)
    .filter(s => {
      if (!teamFilter) return true;
      const teamId = s.schedule?.team_id || null;
      return teamFilter === "unassigned" ? !teamId : teamId === teamFilter;
    })
    .sort((a, b) => {
      const ad = a.operational_date || "", bd = b.operational_date || "";
      if (!ad && bd) return -1;
      if (ad && !bd) return 1;
      return ad.localeCompare(bd) || String(a.sv_number || "").localeCompare(String(b.sv_number || ""));
    });
}

function notSchedulableReason(svc) {
  if (svc.terminal) return null;
  if (!svc.operational_date) return "Date TBC — set the date in Service first";
  if (!svc.legacy_order_id) return "No schedulable order for this case";
  if (svc.schedule && ["out_for_delivery", "out for delivery", "arrived", "delivered"].includes(String(svc.schedule.status || "").toLowerCase())) return `On the road (${svc.schedule.status})`;
  return "Not schedulable";
}

/** Assign / Reassign / Move to Unassigned for one Service — canonical schedule endpoints only. */
export function ServiceTeamControl({ svc, canAssign, loadTeams, af, postWithBlockRetry, onChanged }) {
  const toast = useToast();
  const [teams, setTeams] = useState(null);
  const [pick, setPick] = useState(svc.schedule?.team_id || "");
  const [busy, setBusy] = useState(false);
  const current = svc.schedule?.team_id || "";
  useEffect(() => { setPick(svc.schedule?.team_id || ""); }, [svc.schedule?.team_id]);
  useEffect(() => {
    let alive = true;
    if (canAssign && svc.schedulable && svc.operational_date && loadTeams) {
      loadTeams(svc.operational_date).then(t => { if (alive) setTeams(t); }).catch(() => { if (alive) setTeams([]); });
    }
    return () => { alive = false; };
  }, [canAssign, svc.schedulable, svc.operational_date, loadTeams]);

  if (svc.terminal) return null;
  if (!svc.schedulable) return <span className="text-[11px] text-gray-400">{notSchedulableReason(svc)}</span>;
  if (!canAssign) return null;

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const data = await fn();
      if (data?.error) { if (!data.cancelled) toast.error(data.error); return; }
      toast.success(ok);
      onChanged?.();
    } catch (e) { toast.error(e.message || "Failed"); }
    finally { setBusy(false); }
  };
  const assign = () => run(async () => {
    const team = (teams || []).find(t => t.id === pick);
    return postWithBlockRetry(`${API}/delivery-schedules`, { order_id: svc.legacy_order_id, team_id: pick, scheduled_date: svc.operational_date, sort_order: (team?.stops || 0) + 1 });
  }, `${svc.sv_number || "Service"} assigned`);
  const reassign = () => run(async () => {
    const res = await af(`${API}/delivery-schedules/${svc.schedule.id}`, { method: "PATCH", body: JSON.stringify({ team_id: pick }) });
    return res.json();
  }, `${svc.sv_number || "Service"} reassigned`);
  const unassign = () => run(async () => {
    const res = await af(`${API}/delivery-schedules/${svc.schedule.id}`, { method: "DELETE" });
    return res.json();
  }, `${svc.sv_number || "Service"} moved to Unassigned — date kept`);

  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid="service-team-control">
      <select value={pick} onChange={e => setPick(e.target.value)} disabled={busy || teams === null} className="border rounded px-1.5 py-1 text-xs max-w-[180px]" aria-label="Team">
        <option value="">{teams === null ? "Loading teams…" : teams.length ? "Choose team…" : "No open team on this date"}</option>
        {(teams || []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        {current && !(teams || []).some(t => t.id === current) && <option value={current}>{svc.schedule.team_label || "Current team"}</option>}
      </select>
      {!svc.schedule && <button type="button" disabled={busy || !pick} onClick={assign} className="bg-purple-600 text-white px-2 py-1 rounded text-xs disabled:opacity-40">Assign</button>}
      {svc.schedule && <button type="button" disabled={busy || !pick || pick === current} onClick={reassign} className="bg-purple-600 text-white px-2 py-1 rounded text-xs disabled:opacity-40">Reassign</button>}
      {svc.schedule && <button type="button" disabled={busy} onClick={unassign} className="border border-gray-300 px-2 py-1 rounded text-xs hover:bg-gray-50 disabled:opacity-40" title="Remove the team — the Service date and case are kept">Unassign</button>}
    </div>
  );
}

function ServiceDetail({ svc }) {
  return (
    <div className="space-y-2 max-w-3xl text-xs" data-testid="service-detail">
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-gray-600">
        {svc.customer_contact && <span>📞 <span className="text-gray-800">{svc.customer_contact}</span></span>}
        {svc.customer_address && <span>📍 <span className="text-gray-800">{svc.customer_address}</span></span>}
        {svc.assigned_to_name && <span>Technician: <span className="text-gray-800">{svc.assigned_to_name}</span></span>}
        {svc.service_date && svc.service_date !== svc.operational_date && <span>Service date on case: <span className="text-gray-800">{dmy(svc.service_date)}</span></span>}
      </div>
      {(svc.description || svc.issue_description) && (
        <div>
          <p className="font-bold text-gray-600 mb-0.5">SERVICE NOTE</p>
          <p className="text-gray-800 whitespace-pre-line break-words">{svc.description || svc.issue_description}</p>
        </div>
      )}
      <div>
        <p className="font-bold text-gray-600 mb-0.5">ITEMS</p>
        {svc.items.length === 0 ? <p className="text-gray-400">No items.</p> : (
          <ul className="space-y-0.5">
            {svc.items.map(it => (
              <li key={it.id} className="text-gray-800 break-words">
                {ITEM_ACTIONS[it.action_type] && <span className="text-purple-700 font-medium">[{ITEM_ACTIONS[it.action_type]}] </span>}
                {it.description || "—"} <span className="text-gray-500">×{serviceItemQty(it.quantity)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const itemsLine = svc => svc.items.map(i => `${i.description || "item"} ×${serviceItemQty(i.quantity)}`).join(", ");

/** One Service row in the Delivery Orders table (7 columns, same layout as a DO row). */
export function ServiceRow({ svc, open, onToggle, teamControl }) {
  return (
    <>
      <tr className="border-t bg-purple-50/40" data-testid="service-row">
        <td className="px-3 py-2 whitespace-nowrap">
          <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1 hover:underline font-bold text-purple-700" title="Show Service note and items">
            <span aria-hidden="true" className="text-gray-400 text-[10px]">{open ? "▾" : "▸"}</span>
            <ServiceBadge /> {svc.sv_number || "Service"}
          </button>
        </td>
        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{svc.so_number || "—"}</td>
        <td className="px-3 py-2">
          <div>{svc.customer_name || "—"}</div>
          <div className="text-[10px] text-gray-400">{SERVICE_TYPES[svc.service_type] || `Type ${svc.service_type}`}</div>
        </td>
        <td className="px-3 py-2 text-gray-500 max-w-[240px] truncate" title={itemsLine(svc)}>{itemsLine(svc) || svc.description || "—"}</td>
        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full font-medium ${SERVICE_STATUS_CLS[svc.status] || "bg-gray-100 text-gray-600"}`}>{SERVICE_STATUS_LABEL[svc.status] || svc.status}</span></td>
        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{svc.schedule?.team_label || (svc.schedule ? "Team" : "—")}</td>
        <td className="sticky right-0 z-10 bg-white px-3 py-2 whitespace-nowrap border-l border-gray-200 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col gap-1">
            <span className="text-gray-700">{svc.operational_date ? dmy(svc.operational_date) : <span className="text-amber-600 font-semibold">TBC</span>}</span>
            {teamControl}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-purple-50/30" data-testid="service-detail-row">
          <td colSpan={7} className="px-4 py-3"><ServiceDetail svc={svc} /></td>
        </tr>
      )}
    </>
  );
}

// ── Search ────────────────────────────────────────────────────────
const DO_TERMINAL = ["completed", "cancelled"];
const doTeamLabel = o => {
  const scheds = o.delivery_schedules || [];
  const s = scheds.find(x => !["delivered", "failed"].includes(String(x.status || "").toLowerCase())) || scheds[scheds.length - 1];
  const t = s?.delivery_teams;
  return t ? [t.delivery_vehicles?.vehicle_plate, t.driver?.name].filter(Boolean).join(" · ") || null : null;
};

function DeliveryResult({ o, onGoToSchedule, renderDoActions }) {
  const [open, setOpen] = useState(false);
  const so = o.sales_orders || {};
  const items = (o.delivery_order_items || []).filter(i => i.status !== "cancelled");
  const terminal = !!o.superseded_at || DO_TERMINAL.includes(String(o.status || "").toLowerCase());
  return (
    <div className="border border-gray-200 rounded-xl px-3 py-2.5 bg-white" data-testid="search-result-delivery">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <DeliveryBadge />
            <span className="font-bold text-violet-700 text-sm">{o.do_number}</span>
            {so.order_number && <span className="text-xs text-gray-500">SO {so.order_number}</span>}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700">{o.superseded_at ? "Superseded" : o.status}</span>
          </div>
          <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap gap-x-4">
            <span>Customer: <b className="text-gray-800">{so.customer_name || "—"}</b></span>
            <span>Delivery Date: <b className="text-gray-800">{o.delivery_date ? dmy(o.delivery_date) : "TBC"}</b></span>
            <span>Team: <b className="text-gray-800">{doTeamLabel(o) || "—"}</b></span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={() => setOpen(v => !v)} className="border border-gray-300 px-2 py-1 rounded text-xs hover:bg-gray-50">{open ? "Hide" : "View"}</button>
          {!terminal && o.delivery_date && onGoToSchedule && (
            <button type="button" onClick={() => onGoToSchedule(o.delivery_date)} className="bg-blue-600 text-white px-2 py-1 rounded text-xs" title="Open the schedule board on this date to assign or reassign">Go to Schedule</button>
          )}
          {renderDoActions?.(o)}
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <div className="text-gray-600 flex flex-wrap gap-x-4">
            {(o.contact || so.customer_contact) && <span>📞 {o.contact || so.customer_contact}</span>}
            {(o.delivery_address || so.customer_address) && <span>📍 {o.delivery_address || so.customer_address}</span>}
          </div>
          <ul className="space-y-0.5">{items.map((i, k) => <li key={i.id || k} className="text-gray-800">{i.product_name || i.product_code || "item"} <span className="text-gray-500">×{Number(i.quantity)}</span></li>)}</ul>
          <LinkedServicesSection soNumber={so.order_number} />
        </div>
      )}
    </div>
  );
}

function ServiceResult({ svc, teamControl }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-purple-200 rounded-xl px-3 py-2.5 bg-purple-50/40" data-testid="search-result-service">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <ServiceBadge />
            <span className="font-bold text-purple-700 text-sm">{svc.sv_number || "Service"}</span>
            {svc.so_number && <span className="text-xs text-gray-500">SO {svc.so_number}</span>}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${SERVICE_STATUS_CLS[svc.status] || "bg-gray-100 text-gray-600"}`}>{SERVICE_STATUS_LABEL[svc.status] || svc.status}</span>
          </div>
          <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap gap-x-4">
            <span>Customer: <b className="text-gray-800">{svc.customer_name || "—"}</b></span>
            <span>Service Date: <b className="text-gray-800">{svc.operational_date ? dmy(svc.operational_date) : "TBC"}</b></span>
            <span>Type: <b className="text-gray-800">{SERVICE_TYPES[svc.service_type] || svc.service_type}</b></span>
            <span>Team: <b className="text-gray-800">{svc.schedule?.team_label || "—"}</b></span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap">
          <button type="button" onClick={() => setOpen(v => !v)} className="border border-gray-300 px-2 py-1 rounded text-xs hover:bg-gray-50">{open ? "Hide" : "View"}</button>
          {teamControl}
        </div>
      </div>
      {open && <div className="mt-2"><ServiceDetail svc={svc} /></div>}
    </div>
  );
}

/** Cross-date search results (DO / SO / Service / customer / phone / address / item). */
export function WorkbenchSearchResults({ query, af, onGoToSchedule, renderDoActions, renderServiceControl, refreshKey = 0 }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      af(`${API}/delivery-workbench/search?q=${encodeURIComponent(query)}`)
        .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Search failed"); return d; })
        .then(d => { if (alive) setState({ loading: false, data: d, error: null }); })
        .catch(e => { if (alive) setState({ loading: false, data: null, error: e.message }); });
    }, 300); // debounce
    return () => { alive = false; clearTimeout(t); };
  }, [query, af, refreshKey, tick]);

  const { loading, data, error } = state;
  if (loading && !data) return <div className="p-6 text-center text-gray-400 text-sm" data-testid="search-loading">Searching…</div>;
  if (error) return <div className="p-6 text-center text-red-500 text-sm">{error}</div>;
  const dos = data?.delivery_orders || [], svcs = data?.services || [];
  if (!dos.length && !svcs.length) return <div className="p-6 text-center text-gray-400 text-sm" data-testid="search-empty">No Delivery Order or Service matches “{query}”.</div>;
  return (
    <div className={`p-3 space-y-4 ${loading ? "opacity-60" : ""}`} data-testid="search-results">
      {dos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-gray-500">DELIVERY ({dos.length}{data.truncated?.delivery_orders ? "+, showing the most recent" : ""})</p>
          {dos.map(o => <DeliveryResult key={o.id} o={o} onGoToSchedule={onGoToSchedule} renderDoActions={renderDoActions} />)}
        </div>
      )}
      {svcs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-gray-500">SERVICE ({svcs.length}{data.truncated?.services ? "+, showing the most recent" : ""})</p>
          {svcs.map(s => <ServiceResult key={s.id} svc={s} teamControl={renderServiceControl?.(s, () => setTick(x => x + 1))} />)}
        </div>
      )}
    </div>
  );
}
