// "Deliver together" suggestions for a delivery date request — shared by the
// Delivery Date Requests page and the Orders page SO view. Lists the same
// customer's (same phone) other undelivered SOs from
// GET /delivery-date-requests/linkable; ticked SOs are sent as
// link_so_numbers and become one linked request (same date, decided together,
// kept together on the Delivery Schedule). The server re-validates everything.
import React, { useState, useEffect } from "react";
import { supabase } from "./AuthContext";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => {
  const token = await getToken();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};
const fmt = d => (d && /^\d{4}-\d{2}-\d{2}/.test(d)) ? new Date(d.slice(0, 10) + "T00:00").toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "TBC";

// Other SO numbers a request is linked with, from a list of request rows.
export const linkedSoNumbers = (r, rows) => (!r?.link_group_id ? [] : [...new Set((rows || [])
  .filter(x => x.link_group_id === r.link_group_id && x.id !== r.id && x.so_number !== r.so_number)
  .map(x => x.so_number))]);

export function LinkedChip({ others }) {
  if (!others || others.length === 0) return null;
  return (
    <span title="Linked delivery — these SOs are requested, approved and delivered together"
      className="text-xs px-2 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700">🔗 Linked with SO {others.join(", ")}</span>
  );
}

export default function LinkedDeliveryPicker({ soNumber, selected, onChange }) {
  const [data, setData] = useState(null); // { phone, orders } | null while loading

  useEffect(() => {
    let alive = true;
    setData(null);
    if (!soNumber) return undefined;
    af(`${API}/delivery-date-requests/linkable?so_number=${encodeURIComponent(soNumber)}`)
      .then(r => (r.ok ? r.json() : { orders: [] }))
      .then(d => { if (alive) setData({ phone: d.phone || null, orders: Array.isArray(d.orders) ? d.orders : [] }); })
      .catch(() => { if (alive) setData({ phone: null, orders: [] }); });
    return () => { alive = false; };
  }, [soNumber]);

  if (!soNumber || !data || data.orders.length === 0) return null;
  const toggle = (no) => onChange(selected.includes(no) ? selected.filter(x => x !== no) : [...selected, no]);

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 space-y-2">
      <div>
        <p className="text-xs font-bold text-teal-800">🔗 Deliver together?</p>
        <p className="text-[11px] text-teal-700">This customer{data.phone ? ` (${data.phone})` : ""} has {data.orders.length} other undelivered SO{data.orders.length === 1 ? "" : "s"}. Tick to request the same date — they'll be approved and scheduled together.</p>
      </div>
      <div className="space-y-1">
        {data.orders.map(o => {
          const on = selected.includes(o.so_number);
          return (
            <label key={o.so_number} title={o.linkable ? "" : "This SO has several active Delivery Orders — request its date separately"}
              className={`flex items-start gap-2 text-xs rounded-lg px-2.5 py-2 border bg-white ${o.linkable ? "cursor-pointer" : "opacity-50 cursor-not-allowed"} ${on ? "border-teal-400" : "border-gray-200 hover:bg-gray-50"}`}>
              <input type="checkbox" className="mt-0.5" disabled={!o.linkable} checked={on} onChange={() => toggle(o.so_number)} />
              <span className="min-w-0">
                <b className="text-violet-700">SO {o.so_number}</b>
                <span className="text-gray-500"> · {o.item_count} item{o.item_count === 1 ? "" : "s"} · current {fmt(o.delivery_date)}</span>
                {o.open_request && <span className="block text-amber-700">Has an open request for {fmt(o.open_request.requested_date)} — linking replaces it</span>}
                {!o.linkable && <span className="block text-gray-400">Several active deliveries — request separately</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
