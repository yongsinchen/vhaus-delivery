// Create Delivery Order modal — the "pick which items (arrived or not) go on
// this shipment" flow. Self-contained and driven by a salesOrderId so it can be
// opened from the Orders page (viewing an order) or the Delivery Date Requests
// page (right after approving a requested date). Talks to the same backend
// endpoints that own the arrival/allocation rules, so behaviour is identical
// wherever it's opened.
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const authHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token || "";
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) };
};

export default function CreateDeliveryOrderModal({ salesOrderId, orderNumber, defaultDate, onClose, onCreated }) {
  const toast = useToast();
  const [doData, setDoData] = useState(null);     // { items, can_override_arrival }
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState({});           // sales_order_item_id -> qty string
  const [date, setDate] = useState(defaultDate && defaultDate !== "TBC" ? defaultDate : "");
  const [remark, setRemark] = useState("");
  const [override, setOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/sales-orders/${salesOrderId}/delivery-orders`, { headers });
      if (!res.ok) { setDoData(null); toast.error("You don't have permission to create delivery orders"); onClose(); return; }
      const d = await res.json();
      setDoData({ items: d.items || [], can_override_arrival: !!d.can_override_arrival });
      // Prefill from the deterministic recommendation (ready items, full qty).
      const prefill = {};
      try {
        const rec = await (await fetch(`${API}/sales-orders/${salesOrderId}/delivery-recommendation`, { headers })).json();
        for (const s of (rec.suggested_items_for_next_do || [])) prefill[s.sales_order_item_id] = String(s.quantity);
      } catch { /* recommendation is best-effort */ }
      setPick(prefill);
    } catch { setDoData(null); toast.error("Network error"); onClose(); }
    finally { setLoading(false); }
  }, [salesOrderId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const items = Object.entries(pick)
      .map(([id, q]) => ({ sales_order_item_id: id, quantity: Number(q) }))
      .filter(i => i.quantity > 0);
    if (items.length === 0) { toast.warning("Select at least one item with quantity"); return; }
    for (const i of items) {
      const summary = (doData?.items || []).find(s => s.sales_order_item_id === i.sales_order_item_id);
      if (summary && i.quantity > summary.remaining_qty) { toast.error(`${summary.product_name}: only ${summary.remaining_qty} remaining`); return; }
    }
    setSaving(true);
    try {
      const headers = await authHeaders();
      const payload = { items, delivery_date: date || null, remark: remark || null, override_arrival: override };
      let res = await fetch(`${API}/sales-orders/${salesOrderId}/delivery-orders`, { method: "POST", headers, body: JSON.stringify(payload) });
      let d = await res.json();
      // Soft-blocked date — retry once with a dispatcher-entered reason.
      if (!res.ok && d.blocked_date) {
        const reason = window.prompt(`${d.error}\n\nEnter a reason to schedule anyway, or leave blank to cancel:`, "");
        if (!reason || !reason.trim()) { setSaving(false); return; }
        res = await fetch(`${API}/sales-orders/${salesOrderId}/delivery-orders`, { method: "POST", headers, body: JSON.stringify({ ...payload, override_reason: reason.trim() }) });
        d = await res.json();
      }
      if (!res.ok) { toast.error(d.error || "Failed to create Delivery Order"); setSaving(false); return; }
      toast.success(`${d.delivery_order.do_number} created`);
      onCreated && onCreated(d.delivery_order);
      onClose();
    } catch { toast.error("Network error"); }
    setSaving(false);
  };

  const openItems = (doData?.items || []).filter(i => i.remaining_qty > 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-5 py-3.5 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">Create Delivery Order</h3>
            <p className="text-xs text-gray-500">{orderNumber ? `${orderNumber} · ` : ""}pick items and quantities for this shipment</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-gray-400 py-6 text-center">Loading items…</p>
          ) : openItems.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nothing left to schedule — every item is already delivered or fully allocated.</p>
          ) : openItems.map(it => {
            const picked = pick[it.sales_order_item_id] || "";
            const blocked = !it.arrived && !override;
            return (
              <div key={it.sales_order_item_id} className={`flex items-center gap-2 rounded-xl border p-2.5 ${blocked ? "border-amber-200 bg-amber-50/50" : "border-gray-200"}`}>
                <input type="checkbox" checked={Number(picked) > 0} disabled={blocked}
                  onChange={e => setPick(p => ({ ...p, [it.sales_order_item_id]: e.target.checked ? String(it.remaining_qty) : "" }))} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{it.product_name}{it.size ? ` (${it.size})` : ""}</p>
                  <p className="text-[10px] text-gray-400">
                    {it.remaining_qty} of {it.ordered_qty} remaining
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded-full font-medium ${it.arrived ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{it.arrived ? "arrived" : "not arrived"}</span>
                  </p>
                </div>
                <input type="number" min="1" max={it.remaining_qty} value={picked} disabled={blocked}
                  onChange={e => {
                    const v = e.target.value; const n = Number(v);
                    setPick(p => ({ ...p, [it.sales_order_item_id]: v === "" ? "" : String(Math.max(0, Math.min(it.remaining_qty, n || 0))) }));
                  }}
                  className="w-16 px-2 py-1.5 text-sm text-right rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400 disabled:bg-gray-50" />
              </div>
            );
          })}
          {!loading && openItems.some(i => !i.arrived) && (
            <label className={`flex items-center gap-2 text-xs rounded-xl p-2.5 ${doData.can_override_arrival ? "text-amber-700 bg-amber-50 cursor-pointer" : "text-gray-400 bg-gray-50 cursor-not-allowed"}`}>
              <input type="checkbox" checked={override} disabled={!doData.can_override_arrival} onChange={e => setOverride(e.target.checked)} />
              {doData.can_override_arrival
                ? "Override arrival check — schedule items that have not arrived yet"
                : "Overriding arrival requires Manager approval."}
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Target delivery date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Remark</label>
              <input value={remark} onChange={e => setRemark(e.target.value)} placeholder="Optional"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          </div>
        </div>
        <div className="px-5 py-3.5 border-t">
          <button onClick={create} disabled={saving || loading || !Object.values(pick).some(v => Number(v) > 0)}
            className="w-full py-2.5 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
            {saving ? "Creating…" : "Create Delivery Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
