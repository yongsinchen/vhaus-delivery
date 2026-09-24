// New Service Case form — shared by the Services page and the Orders page SO
// view, and reused to amend a still-pending service request.
//
//   mode "create": approvers POST /service-cases (the case is created now);
//                  everyone else POST /service-requests (created on approval).
//   mode "amend":  PATCH /service-requests/:id on the requester's own pending
//                  request (server re-checks ownership + pending status).
//
// Props:
//   mode        "create" | "amend"
//   isApprover  create directly instead of submitting a request (create only)
//   fixedOrder  { id (legacy orders.id), label } — lock the linked order (Orders page)
//   request     the service_requests row being amended (amend only)
//   onClose     () => void
//   onSaved     (result) => void — after a successful save, inside the loading overlay
import React, { useState } from "react";
import { supabase } from "./AuthContext";
import { useToast, useLoading } from "./UIComponents";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };

export const SERVICE_TYPES = { 1: "Warranty Repair", 2: "Assembly / Installation", 3: "Exchange / Replacement", 4: "Delivery (Missing Item)", 5: "Delivery" };
export const TYPE_ICON = { 1: "🔧", 2: "🪛", 3: "🔄", 4: "🚚", 5: "📦" };
// Per-item action on a service case (matches backend service_items.action_type).
export const ITEM_ACTIONS = { 1: "Assemble", 2: "Service", 3: "Claim" };

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_FORM = () => ({ order_id: "", service_type: 1, description: "", service_date: today(), delivery_date: "", schedule_tbc: false, amount: "", customer_name: "", customer_phone: "", customer_address: "" });

// The requester's own pending request can be amended / deleted.
export const canChangeServiceRequest = (r, user) => !!r && !!user?.id && r.requested_by === user.id && r.status === "pending";

// Delete (withdraw) a pending request after confirming. Returns true on success.
export async function deleteServiceRequest(r, toast) {
  if (!window.confirm(`Delete this ${SERVICE_TYPES[r.service_type] || "service"} request${r.so_number ? ` for SO ${r.so_number}` : ""}?`)) return false;
  try {
    const res = await af(`${API}/service-requests/${r.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to delete request");
    toast.success("Service request deleted");
    return true;
  } catch (e) { toast.error(e.message); return false; }
}

export default function ServiceCaseFormModal({ mode = "create", isApprover = false, fixedOrder = null, request = null, onClose, onSaved }) {
  const toast = useToast();
  const { withLoading } = useLoading();
  const amending = mode === "amend" && request;
  const direct = !amending && isApprover; // approver creating a case directly

  const [form, setForm] = useState(() => {
    if (amending) {
      return {
        order_id: request.order_id || "", service_type: Number(request.service_type) || 1,
        description: request.description || "", service_date: request.service_date || "",
        delivery_date: request.delivery_date || "", schedule_tbc: !!request.schedule_tbc,
        amount: request.amount != null ? String(request.amount) : "",
        customer_name: request.customer_name || "", customer_phone: request.customer_phone || "", customer_address: request.customer_address || "",
      };
    }
    return { ...EMPTY_FORM(), order_id: fixedOrder?.id || "" };
  });
  const [items, setItems] = useState(() => (amending && Array.isArray(request.items) ? request.items.map(i => ({ description: i.description || "", action_type: Number(i.action_type) || 2, quantity: Number(i.quantity) || 1, arrival_date: i.arrival_date || "" })) : []));
  const [orderSearch, setOrderSearch] = useState(fixedOrder?.label || "");
  const [orderResults, setOrderResults] = useState([]);

  // The linked order can't change when it came from the SO, or on amend.
  const orderLocked = !!fixedOrder || amending;
  const lockedLabel = fixedOrder?.label || (request?.so_number ? `SO ${request.so_number}` : "");

  const searchOrders = async (q) => {
    setOrderSearch(q);
    if (q.length < 2) { setOrderResults([]); return; }
    // Search real (non-Service) orders to link to, server-side.
    const res = await af(`${API}/orders?search=${encodeURIComponent(q)}`);
    const all = await res.json();
    setOrderResults((Array.isArray(all) ? all : []).slice(0, 10));
  };

  const save = async () => {
    try {
      await withLoading(amending ? "Saving request…" : direct ? "Creating service case…" : "Submitting request…", async () => {
        const cleanItems = items
          .filter(i => String(i.description || "").trim())
          .map(i => ({ description: i.description.trim(), action_type: Number(i.action_type) || 2, quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1, arrival_date: i.arrival_date || null }));
        const body = { ...form, items: cleanItems };
        let res;
        if (amending) {
          delete body.order_id; // the linked order stays as submitted
          res = await af(`${API}/service-requests/${request.id}`, { method: "PATCH", body: JSON.stringify(body) });
        } else {
          // Approvers create the case directly; salesmen submit a request that a
          // PIC must approve before the case (and its delivery legs) exist.
          res = await af(`${API}/${direct ? "service-cases" : "service-requests"}`, { method: "POST", body: JSON.stringify(body) });
        }
        const d = await res.json();
        if (direct ? !d.service : !d.request) throw new Error(d.error || "Failed");
        toast.success(amending ? "Service request updated" : direct ? "Service case created" : "Service request submitted for approval");
        await onSaved?.(d);
      });
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h3 className="font-bold text-gray-900">{amending ? "Amend Service Request" : "New Service Case"}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Service Type</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SERVICE_TYPES).map(([k, v]) => (
                <button key={k} onClick={() => setForm(f => ({ ...f, service_type: Number(k) }))}
                  className={`py-2.5 rounded-xl text-xs font-medium border transition-colors ${form.service_type === Number(k) ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200"}`}>
                  {TYPE_ICON[k]} {v.split("/")[0]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{orderLocked ? "Linked Order" : "Link to Order (optional)"}</label>
            {orderLocked ? (
              <div className="px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-sm text-violet-700 font-medium truncate">{lockedLabel || "No order linked"}</div>
            ) : form.order_id ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-sm">
                <span className="text-violet-700 font-medium truncate">{orderSearch || "Order linked"}</span>
                <button onClick={() => { setForm(f => ({ ...f, order_id: "" })); setOrderSearch(""); }}
                  className="ml-2 text-xs text-gray-500 hover:text-gray-700 shrink-0">Clear</button>
              </div>
            ) : (
              <input value={orderSearch} onChange={e => searchOrders(e.target.value)} placeholder="Search SO number or customer..."
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            )}
            {!orderLocked && !form.order_id && orderResults.length > 0 && (
              <div className="border border-gray-200 rounded-xl mt-1 max-h-32 overflow-y-auto">
                {orderResults.map(o => (
                  <button key={o.id} onClick={() => { setForm(f => ({ ...f, order_id: o.id, customer_name: "", customer_phone: "", customer_address: "" })); setOrderSearch(`${o.so_number} — ${o.customer_name}`); setOrderResults([]); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-violet-50">
                    <span className="font-bold text-violet-700">{o.so_number}</span> {o.customer_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* No linked order → capture customer details directly (backend stores
              them on the service + its inert delivery order). */}
          {!form.order_id && (
            <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500">Customer details</p>
              <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                placeholder="Customer name"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              <input value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))}
                placeholder="Contact number"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              <textarea value={form.customer_address} onChange={e => setForm(f => ({ ...f, customer_address: e.target.value }))}
                placeholder="Address" rows={2}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What's the issue? What needs to be done?" rows={3}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
          </div>
          {/* Line items — one row per thing to do, each with its own action.
              Optional at creation; can also be added from the detail drawer. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-500">Items (optional)</label>
              <button type="button" onClick={() => setItems(a => [...a, { description: "", action_type: 2, quantity: 1 }])}
                className="text-xs px-2 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Item</button>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-gray-400">No items — you can also add them after creating the case.</p>
            ) : (
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-4 text-right">{i + 1}.</span>
                      <input value={it.description} onChange={e => setItems(a => a.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
                        placeholder="e.g. Dining chair"
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                      <select value={it.action_type} onChange={e => setItems(a => a.map((x, idx) => idx === i ? { ...x, action_type: Number(e.target.value) } : x))}
                        className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white shrink-0">
                        {Object.entries(ITEM_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input type="number" min="1" value={it.quantity} onChange={e => setItems(a => a.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))}
                        className="w-12 px-1.5 py-1.5 rounded-lg border border-gray-200 text-xs text-center shrink-0" />
                      <button type="button" onClick={() => setItems(a => a.filter((_, idx) => idx !== i))}
                        className="text-gray-300 hover:text-red-500 text-base px-1 shrink-0">×</button>
                    </div>
                    {/* Arrival date for any item whose part/stock must arrive
                        before it can be delivered (not just Claim items). */}
                    <div className="flex items-center gap-2 pl-6">
                      <span className="text-xs text-gray-400">Arrival date</span>
                      <input type="date" value={it.arrival_date || ""} onChange={e => setItems(a => a.map((x, idx) => idx === i ? { ...x, arrival_date: e.target.value } : x))}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs" />
                      <span className="text-xs text-gray-400">optional — leave blank until the item arrives</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Service Creation Date</label>
              <input type="date" value={form.service_date} onChange={e => setForm(f => ({ ...f, service_date: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Schedule Date</label>
              <input type="date" value={form.schedule_tbc ? "" : form.delivery_date} disabled={form.schedule_tbc}
                onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400 disabled:bg-gray-100 disabled:text-gray-400" />
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={form.schedule_tbc} onChange={e => setForm(f => ({ ...f, schedule_tbc: e.target.checked }))} />
                TBC — hidden from delivery route
              </label>
            </div>
          </div>
          {Number(form.service_type) === 5 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount <span className="text-gray-400">(RM)</span></label>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t flex gap-3 justify-end shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600">Cancel</button>
          <button onClick={save} className="px-5 py-2 text-sm rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700">{amending ? "Save changes" : direct ? "Create" : "Submit for approval"}</button>
        </div>
      </div>
    </div>
  );
}
