import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";

const getToken = async () => {
  let { data } = await supabase.auth.getSession();
  let session = data?.session;
  if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed?.session || session;
  }
  return session?.access_token || "";
};
const authHeaders = async () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${await getToken()}`,
});

const STATUSES = ["draft", "sent", "partial", "received", "cancelled"];
const STATUS_STYLE = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  received: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-600",
};

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [suppliers, setSuppliers] = useState([]);
  const [filterSupplier, setFilterSupplier] = useState("");

  const [detailOrder, setDetailOrder] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [companySettings, setCompanySettings] = useState({});

  const loadOrders = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const headers = await authHeaders();
    const params = new URLSearchParams();
    if (filterStatus) params.set("status", filterStatus);
    if (filterSupplier) params.set("supplier_id", filterSupplier);
    if (search) params.set("search", search);
    const res = await fetch(`${API}/purchase-orders?${params}`, { headers });
    const d = await res.json();
    setOrders(d.orders || []);
    setLoading(false);
  }, [companyId, filterStatus, filterSupplier, search]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  useEffect(() => {
    if (!companyId) return;
    fetch(`${API}/suppliers?company_id=${companyId}`).then(r => r.json()).then(d => setSuppliers(d.suppliers || []));
    fetch(`${API}/company-settings?company_id=${companyId}`).then(r => r.json()).then(d => setCompanySettings(d.settings || {}));
  }, [companyId]);

  const openDetail = async (po) => {
    const headers = await authHeaders();
    const res = await fetch(`${API}/purchase-orders/${po.id}`, { headers });
    const d = await res.json();
    setDetailOrder(d.order || po);
    setDetailOpen(true);
  };

  const changeStatus = async (id, status) => {
    const headers = await authHeaders();
    await fetch(`${API}/purchase-orders/${id}/status`, { method: "PATCH", headers, body: JSON.stringify({ status }) });
    loadOrders();
    if (detailOrder?.id === id) setDetailOrder(prev => prev ? { ...prev, status } : prev);
  };

  const receiveItem = async (itemId, qty) => {
    const headers = await authHeaders();
    await fetch(`${API}/purchase-order-items/${itemId}/receive`, {
      method: "PATCH", headers, body: JSON.stringify({ received_qty: qty }),
    });
    if (detailOrder) {
      const res = await fetch(`${API}/purchase-orders/${detailOrder.id}`, { headers: await authHeaders() });
      const d = await res.json();
      setDetailOrder(d.order);
    }
    loadOrders();
  };

  const copyPOMessage = (po) => {
    const items = po.purchase_order_items || [];
    const companyName = companySettings.company_name || "V Haus";
    const address = companySettings.base_address || companySettings.address || "";
    const lines = items.map((it, i) => {
      const name = [it.product_code, it.product_name].filter(Boolean).join(" ");
      const details = [it.color, it.size, it.custom_dimensions].filter(Boolean).map(d => `- ${d}`);
      if (it.notes) details.push(`- Note: ${it.notes}`);
      return `${i + 1}. ${name} x${it.quantity || 1} unit${details.length ? "\n" + details.join("\n") : ""}`;
    });
    const msg = [
      companyName,
      `PO: ${po.po_number}`,
      `Delivery Date: ${po.expected_date || "ASAP"}`,
      "",
      ...lines,
      "",
      "",
      `${companyName}`,
      address,
    ].join("\n");
    navigator.clipboard.writeText(msg).then(() => alert("PO message copied to clipboard!")).catch(() => {
      const ta = document.createElement("textarea"); ta.value = msg; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      alert("PO message copied to clipboard!");
    });
  };

  const markAsSent = async (id) => {
    await changeStatus(id, "sent");
  };

  const deletePO = async (id) => {
    if (!window.confirm("Delete this draft PO?")) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/purchase-orders/${id}`, { method: "DELETE", headers });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Failed"); return; }
    setDetailOpen(false);
    loadOrders();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Purchase Orders</h1>

      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO number…"
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-48 focus:outline-none focus:border-violet-400" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
          <option value="">All Suppliers</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {loading && <div className="text-center text-gray-400 py-8">Loading…</div>}
        {!loading && orders.length === 0 && <div className="text-center text-gray-400 py-8">No purchase orders yet</div>}
        {!loading && orders.map(po => (
          <div key={po.id} onClick={() => openDetail(po)}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-violet-200 cursor-pointer transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-medium text-violet-700">{po.po_number}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[po.status] || "bg-gray-100"}`}>{po.status}</span>
                </div>
                <p className="font-medium text-gray-900 mt-1">{po.suppliers?.name || "Unknown Supplier"}</p>
                <p className="text-xs text-gray-400">
                  {(po.purchase_order_items || []).length} item{(po.purchase_order_items || []).length !== 1 ? "s" : ""}
                  {po.expected_date ? ` · Expected: ${po.expected_date}` : ""}
                </p>
              </div>
              <select value={po.status} onClick={e => e.stopPropagation()} onChange={e => changeStatus(po.id, e.target.value)}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-violet-400">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>

      {/* Detail Drawer */}
      {detailOpen && detailOrder && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailOpen(false)} />
          <div className="relative w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{detailOrder.po_number}</h2>
                <p className="text-sm text-gray-500">{detailOrder.suppliers?.name}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => copyPOMessage(detailOrder)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100">📋 Copy Message</button>
                {detailOrder.status === "draft" && (
                  <button onClick={() => markAsSent(detailOrder.id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100">✓ Mark as Sent</button>
                )}
                {detailOrder.status === "draft" && (
                  <button onClick={() => deletePO(detailOrder.id)} className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100">Delete</button>
                )}
                <button onClick={() => setDetailOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[detailOrder.status]}`}>{detailOrder.status}</span>
                <select value={detailOrder.status} onChange={e => changeStatus(detailOrder.id, e.target.value)}
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Expected Delivery</label>
                  <input type="date" value={detailOrder.expected_date || ""} onChange={async e => {
                    const val = e.target.value;
                    setDetailOrder(prev => ({ ...prev, expected_date: val }));
                    const headers = await authHeaders();
                    await fetch(`${API}/purchase-orders/${detailOrder.id}`, { method: "PUT", headers, body: JSON.stringify({ expected_date: val, notes: detailOrder.notes }) });
                  }} className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                  <input value={detailOrder.notes || ""} onChange={e => setDetailOrder(prev => ({ ...prev, notes: e.target.value }))}
                    onBlur={async () => {
                      const headers = await authHeaders();
                      await fetch(`${API}/purchase-orders/${detailOrder.id}`, { method: "PUT", headers, body: JSON.stringify({ expected_date: detailOrder.expected_date, notes: detailOrder.notes }) });
                    }}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" placeholder="e.g. Urgent order" />
                </div>
              </div>

              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-center w-16">Qty</th>
                      <th className="px-3 py-2 text-center w-20">Received</th>
                      <th className="px-3 py-2 text-center w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailOrder.purchase_order_items || []).map(it => {
                      const done = (it.received_qty || 0) >= (it.quantity || 1);
                      return (
                        <tr key={it.id} className={`border-t border-gray-50 ${done ? "bg-emerald-50/30" : ""}`}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900">{it.product_name || it.product_code}</p>
                            <p className="text-xs text-gray-400">{[it.size, it.color].filter(Boolean).join(" · ")}</p>
                            {it.custom_dimensions && <p className="text-xs text-amber-600">Custom: {it.custom_dimensions}</p>}
                            {it.notes && <p className="text-xs text-gray-400">{it.notes}</p>}
                            {it.attachment_url && <a href={it.attachment_url} target="_blank" rel="noreferrer" className="text-xs text-violet-600 underline">View drawing</a>}
                          </td>
                          <td className="px-3 py-2 text-center">{it.quantity}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={done ? "text-emerald-700 font-medium" : "text-gray-500"}>{it.received_qty || 0}</span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {done ? (
                              <span className="text-xs text-emerald-600">✓ Received</span>
                            ) : (
                              <button onClick={() => receiveItem(it.id, it.quantity)}
                                className="text-xs px-2 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">
                                Mark Received
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
