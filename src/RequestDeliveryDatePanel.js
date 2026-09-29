// "Request Delivery Date" block for the Orders page SO view — the same request
// flow as the Delivery Date Requests page, scoped to one SO so non-approvers
// don't have to leave the order. Same endpoints, so every rule stays
// server-side: 10-day auto-approval, DO target validation, superseding an
// older open request for the same target.
import React, { useState, useEffect, useCallback } from "react";
import { supabase, useAuth } from "./AuthContext";
import { useToast } from "./UIComponents";
import DeliveryDateRequestActions, { canChangeRequest } from "./DeliveryDateRequestActions";
import LinkedDeliveryPicker, { LinkedChip, linkedSoNumbers } from "./LinkedDeliveryPicker";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => {
  const token = await getToken();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};
const fmt = d => d ? new Date(d + "T00:00").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "TBC / Not Set";
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Mirrors DeliveryDateRequestsPage / doLib.isOperationallyActive() server-side.
const ACTIVE_DO_STATUSES = ["draft", "scheduled", "out_for_delivery", "arrived"];
const STATUS = {
  pending:          { label: "Pending review", cls: "bg-amber-100 text-amber-700" },
  needs_reschedule: { label: "Needs another date", cls: "bg-orange-100 text-orange-700" },
  approved:         { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  rejected:         { label: "Rejected", cls: "bg-gray-100 text-gray-500" },
};
const doItemSummary = (dord) => (dord.delivery_order_items || [])
  .filter(i => i.status !== "cancelled")
  .map(i => `${i.product_name || i.product_code || "item"} x${i.quantity}`)
  .join(", ");

export default function RequestDeliveryDatePanel({ order, onChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const soNumber = order?.order_number;
  const [requests, setRequests] = useState(null); // this user's requests for this SO, newest first
  const [allRequests, setAllRequests] = useState([]); // every visible request — to name linked SOs
  const [linkSos, setLinkSos] = useState([]); // same-customer SOs ticked to deliver together
  const [formOpen, setFormOpen] = useState(false);
  const [activeDos, setActiveDos] = useState(null); // null = not loaded, [] = none active
  const [selectedDoId, setSelectedDoId] = useState(null);
  const [reqDate, setReqDate] = useState("");
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!soNumber) return;
    try {
      const res = await af(`${API}/delivery-date-requests`);
      const d = await res.json();
      setAllRequests(d.requests || []);
      setRequests((d.requests || []).filter(r => r.so_number === soNumber));
    } catch { setRequests([]); }
  }, [soNumber]);
  useEffect(() => { setRequests(null); setFormOpen(false); loadRequests(); }, [loadRequests]);

  const openForm = async () => {
    setFormOpen(true); setReqDate(""); setRemark(""); setActiveDos(null); setSelectedDoId(null); setLinkSos([]);
    try {
      const res = await af(`${API}/delivery-orders?so_number=${encodeURIComponent(soNumber)}`);
      const d = await res.json();
      const dos = (d.delivery_orders || []).filter(dord => !dord.superseded_at && ACTIVE_DO_STATUSES.includes(dord.status));
      setActiveDos(dos);
      if (dos.length === 1) setSelectedDoId(dos[0].id);
    } catch { setActiveDos([]); }
  };

  const submit = async () => {
    if (!reqDate) { toast.warning("Choose a delivery date"); return; }
    if ((activeDos || []).length > 1 && !selectedDoId) { toast.warning("Select which Delivery Order to reschedule"); return; }
    setSaving(true);
    try {
      const res = await af(`${API}/delivery-date-requests`, {
        method: "POST",
        body: JSON.stringify({ so_number: soNumber, requested_date: reqDate, remark, delivery_order_id: selectedDoId || undefined, link_so_numbers: linkSos.length ? linkSos : undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      const linkedNote = (d.linked_requests || []).length ? ` · linked with SO ${d.linked_requests.map(x => x.so_number).join(", ")}` : "";
      toast.success((d.request?.status === "approved" ? "Auto-approved — 10+ days out" : "Request sent for approval") + linkedNote);
      setFormOpen(false);
      loadRequests();
      onChanged?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const pickAlternative = async (r, date) => {
    if (!window.confirm(`Confirm delivery on ${fmt(date)} for SO ${r.so_number}?`)) return;
    const res = await af(`${API}/delivery-date-requests/${r.id}/pick`, { method: "PATCH", body: JSON.stringify({ requested_date: date }) });
    const d = await res.json();
    if (res.ok) { toast.success("Delivery date set"); loadRequests(); onChanged?.(); } else toast.error(d.error || "Failed");
  };

  const openReqs = (requests || []).filter(r => r.status === "pending" || r.status === "needs_reschedule");
  const latestDone = (requests || []).find(r => r.status === "approved" || r.status === "rejected");

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-gray-500">DELIVERY DATE</p>
        {!formOpen && (
          <button onClick={openForm} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700">📅 Request Delivery Date</button>
        )}
      </div>

      {requests === null && <p className="text-xs text-gray-400">Loading requests…</p>}

      {/* Open requests — status, and the reviewer's proposed dates to pick from */}
      <div className="space-y-1.5">
        {openReqs.map(r => (
          <div key={r.id} className="border border-amber-100 bg-amber-50/40 rounded-xl p-2.5 text-xs space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS[r.status]?.cls}`}>{STATUS[r.status]?.label}</span>
              {r.delivery_order_id && <span className="bg-violet-100 text-violet-700 font-bold px-1.5 py-0.5 rounded">{r.delivery_orders?.do_number || "DO"}</span>}
              <span className="text-gray-600">{fmt(r.original_date)} → <b className="text-gray-900">{fmt(r.requested_date)}</b></span>
              <LinkedChip others={linkedSoNumbers(r, allRequests)} />
            </div>
            {r.remark && <p className="text-gray-500">📝 {r.remark}</p>}
            {canChangeRequest(r, user) && (
              <DeliveryDateRequestActions request={r} onChanged={() => { loadRequests(); onChanged?.(); }} />
            )}
            {r.status === "needs_reschedule" && Array.isArray(r.alternative_dates) && r.alternative_dates.length > 0 && (
              <div className="pt-1">
                {r.decision_note && <p className="text-amber-700 mb-1">{r.decision_note}</p>}
                <p className="text-gray-500 mb-1">The reviewer suggested these dates — pick one to confirm:</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.alternative_dates.map((d, i) => (
                    <button key={i} onClick={() => pickAlternative(r, d)} className="px-2.5 py-1 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700">{fmt(d)}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {requests && openReqs.length === 0 && latestDone && !formOpen && (
          <p className="text-xs text-gray-500">
            Last request: <span className={`px-1.5 py-0.5 rounded-full font-medium ${STATUS[latestDone.status]?.cls}`}>{STATUS[latestDone.status]?.label}</span>{" "}
            {fmt(latestDone.requested_date)}{latestDone.status === "rejected" && latestDone.decision_note ? ` — ${latestDone.decision_note}` : ""}
          </p>
        )}
        {requests && requests.length === 0 && !formOpen && (
          <p className="text-xs text-gray-400">No delivery date requested yet. It's applied only after a reviewer approves.</p>
        )}
      </div>

      {formOpen && (
        <div className="mt-2 border border-violet-100 bg-violet-50/40 rounded-xl p-3 space-y-2.5">
          {openReqs.length > 0 && <p className="text-xs text-amber-700">Sending a new request replaces the open one for the same delivery.</p>}
          {/* 0 active DO → SO-level request; 1 → auto-selected; 2+ → must pick. */}
          {activeDos === null ? (
            <p className="text-xs text-gray-400">Checking this order's deliveries…</p>
          ) : activeDos.length === 1 ? (
            <div className="text-xs text-gray-600 bg-white rounded-lg px-3 py-2">
              <b className="text-violet-700">{activeDos[0].do_number}</b> — current {fmt(activeDos[0].delivery_date)}
              {doItemSummary(activeDos[0]) ? <div className="text-gray-400 mt-0.5">{doItemSummary(activeDos[0])}</div> : null}
            </div>
          ) : activeDos.length > 1 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-600">Select Delivery Order to reschedule:</p>
              {activeDos.map(dord => (
                <label key={dord.id} className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 border cursor-pointer bg-white ${selectedDoId === dord.id ? "border-violet-400" : "border-gray-200 hover:bg-gray-50"}`}>
                  <input type="radio" name="so-do-select" className="mt-0.5" checked={selectedDoId === dord.id} onChange={() => setSelectedDoId(dord.id)} />
                  <span>
                    <b className="text-violet-700">{dord.do_number}</b> — current {fmt(dord.delivery_date)}
                    {doItemSummary(dord) ? <div className="text-gray-400 mt-0.5">{doItemSummary(dord)}</div> : null}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          <LinkedDeliveryPicker soNumber={soNumber} selected={linkSos} onChange={setLinkSos} />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Delivery date</label>
            <input type="date" min={localToday()} value={reqDate} onChange={e => setReqDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Remark <span className="text-gray-400">(reason / notes for the reviewer)</span></label>
            <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2} placeholder="e.g. customer requested Saturday; big lorry needed…"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setFormOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100">Cancel</button>
            <button onClick={submit} disabled={saving || !reqDate || activeDos === null || (activeDos.length > 1 && !selectedDoId)}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {saving ? "Sending…" : linkSos.length ? `Send for approval (${linkSos.length + 1} SOs)` : "Send for approval"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
