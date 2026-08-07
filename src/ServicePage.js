import React, { useState, useEffect, useCallback , memo } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast, useLoading } from "./UIComponents";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };

const SERVICE_TYPES = { 1: "Warranty Repair", 2: "Assembly / Installation", 3: "Exchange / Replacement" };
const TYPE_ICON = { 1: "🔧", 2: "🪛", 3: "🔄" };
const STATUS_STYLE = {
  open: "bg-gray-100 text-gray-700", scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700", claiming: "bg-violet-100 text-violet-700",
  resolved: "bg-emerald-100 text-emerald-700", closed: "bg-gray-100 text-gray-400",
};
const LEG_STATUS = { pending: "bg-gray-100 text-gray-600", scheduled: "bg-blue-100 text-blue-700", in_progress: "bg-amber-100 text-amber-700", completed: "bg-emerald-100 text-emerald-700" };
const CLAIM_STATUS = { pending: "bg-gray-100 text-gray-600", submitted: "bg-blue-100 text-blue-700", approved: "bg-violet-100 text-violet-700", received: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-600" };
// Per-item action on a service case (matches backend service_items.action_type).
const ITEM_ACTIONS = { 1: "Assemble", 2: "Service", 3: "Claim" };
const ITEM_ACTION_ICON = { 1: "🪛", 2: "🔧", 3: "🔄" };

function ServicePage() {
  const { user, activeCompanyId } = useAuth();
  const toast = useToast();
  const { withLoading } = useLoading();
  const companyId = activeCompanyId || user?.company_id;

  const [services, setServices] = useState([]);
  const [pending, setPending] = useState([]);
  const [tab, setTab] = useState("cases"); // "cases" | "pending"
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [convertModal, setConvertModal] = useState(null);
  const [convertRemark, setConvertRemark] = useState("");

  // Create form
  const [createForm, setCreateForm] = useState({ order_id: "", service_type: 1, description: "", service_date: new Date().toISOString().slice(0, 10), delivery_date: "", schedule_tbc: false, customer_name: "", customer_phone: "", customer_address: "" });
  const [orderSearch, setOrderSearch] = useState("");
  const [orderResults, setOrderResults] = useState([]);
  // Line items entered while creating a case (added later via the detail drawer).
  const [createItems, setCreateItems] = useState([]);

  const [suppliers, setSuppliers] = useState([]); // eslint-disable-line

  const loadServices = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams({ company_id: companyId });
    if (filterStatus) params.set("status", filterStatus);
    const res = await af(`${API}/service-cases?${params}`);
    const d = await res.json();
    setServices(d.services || []);
    setLoading(false);
  }, [companyId, filterStatus]);

  const loadPending = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/service-pending?company_id=${companyId}`);
    const d = await res.json();
    setPending(Array.isArray(d) ? d : []);
  }, [companyId]);

  useEffect(() => { loadServices(); loadPending(); }, [loadServices, loadPending]);
  useEffect(() => {
    if (companyId) af(`${API}/suppliers?company_id=${companyId}`).then(r => r.json()).then(d => setSuppliers(d.suppliers || []));
  }, [companyId]);

  const openDetail = async (svc) => {
    setDetailLoading(true);
    const res = await af(`${API}/service-cases/${svc.id}`);
    const d = await res.json();
    setDetail(d);
    setDetailLoading(false);
  };

  const searchOrders = async (q) => {
    setOrderSearch(q);
    if (q.length < 2) { setOrderResults([]); return; }
    // Search real (non-Service) orders to link to, server-side.
    const res = await af(`${API}/orders?search=${encodeURIComponent(q)}${companyId ? `&company_id=${companyId}` : ""}`);
    const all = await res.json();
    setOrderResults((Array.isArray(all) ? all : []).slice(0, 10));
  };

  const createService = async () => {
    try {
      await withLoading("Creating service case…", async () => {
        const items = createItems
          .filter(i => String(i.description || "").trim())
          .map(i => ({ description: i.description.trim(), action_type: Number(i.action_type) || 2, quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1, arrival_date: Number(i.action_type) === 3 ? (i.arrival_date || null) : null }));
        const res = await af(`${API}/service-cases`, { method: "POST", body: JSON.stringify({ ...createForm, items }) });
        const d = await res.json();
        if (!d.service) throw new Error(d.error || "Failed");
        toast.success("Service case created"); setShowCreate(false); setOrderSearch(""); setCreateItems([]); setCreateForm({ order_id: "", service_type: 1, description: "", service_date: new Date().toISOString().slice(0, 10), delivery_date: "", schedule_tbc: false, customer_name: "", customer_phone: "", customer_address: "" }); loadServices();
      });
    } catch (e) { toast.error(e.message); }
  };

  // ── Service items (per-case line items with their own action + status) ──
  const addServiceItem = async (serviceId) => {
    const description = window.prompt("Item description (e.g. Dining chair):");
    if (!description || !description.trim()) return;
    try {
      await withLoading("Adding item…", async () => {
        await af(`${API}/service-cases/${serviceId}/items`, { method: "POST", body: JSON.stringify({ description: description.trim(), action_type: 2, quantity: 1 }) });
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to add item: " + e.message); }
  };

  const updateServiceItem = async (itemId, updates) => {
    try {
      await withLoading("Updating item…", async () => {
        await af(`${API}/service-items/${itemId}`, { method: "PATCH", body: JSON.stringify(updates) });
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to update item: " + e.message); }
  };

  const deleteServiceItem = async (itemId) => {
    if (!window.confirm("Remove this item?")) return;
    try {
      await withLoading("Removing item…", async () => {
        await af(`${API}/service-items/${itemId}`, { method: "DELETE" });
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to remove item: " + e.message); }
  };

  const updateServiceStatus = async (id, status) => {
    try {
      await withLoading("Updating status…", async () => {
        await af(`${API}/service-cases/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
        loadServices();
        if (detail?.service?.id === id) openDetail(detail.service);
      });
    } catch (e) { toast.error("Failed to update: " + e.message); }
  };

  const updateLeg = async (legId, updates) => {
    try {
      await withLoading("Updating…", async () => {
        await af(`${API}/service-legs/${legId}`, { method: "PATCH", body: JSON.stringify(updates) });
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to update: " + e.message); }
  };

  // Patch arbitrary service-case fields (creation date, schedule date, TBC, …)
  const updateService = async (id, fields) => {
    try {
      await withLoading("Updating…", async () => {
        const res = await af(`${API}/service-cases/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Update failed"); }
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to update: " + e.message); }
  };

  const addClaim = async (serviceId) => {
    const partName = window.prompt("Part name / description:");
    if (!partName) return;
    try {
      await withLoading("Adding claim…", async () => {
        await af(`${API}/service-part-claims`, { method: "POST", body: JSON.stringify({ service_id: serviceId, part_name: partName }) });
      });
      toast.success("Claim added");
      openDetail(detail.service);
    } catch (e) { toast.error("Failed to add claim: " + e.message); }
  };

  const updateClaim = async (claimId, updates) => {
    try {
      await withLoading("Updating claim…", async () => {
        await af(`${API}/service-part-claims/${claimId}`, { method: "PATCH", body: JSON.stringify(updates) });
        if (detail?.service) openDetail(detail.service);
      });
    } catch (e) { toast.error("Failed to update claim: " + e.message); }
  };

  const deleteService = async (id) => {
    if (!window.confirm("Delete this service case? This will also remove all legs and part claims.")) return;
    try {
      await withLoading("Deleting service case…", async () => {
        const res = await af(`${API}/service-cases/${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to delete"); }
        toast.success("Service case deleted"); setDetail(null); loadServices();
      });
    } catch (e) { toast.error(e.message); }
  };

  const convertPending = async (sp) => {
    try {
      await withLoading("Creating service case…", async () => {
        const res = await af(`${API}/service-pending/${sp.id}/convert`, {
          method: "POST", body: JSON.stringify({ remark: convertRemark, service_type: 1 }),
        });
        const d = await res.json();
        if (!d.service) throw new Error(d.error || "Failed to convert");
        toast.success("Service case created"); setConvertModal(null); setConvertRemark(""); loadServices(); loadPending();
      });
    } catch (e) { toast.error(e.message); }
  };

  const removePending = async (id) => {
    if (!window.confirm("Remove this pending service?")) return;
    try {
      await withLoading("Removing…", async () => {
        const res = await af(`${API}/service-pending/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to remove");
        toast.success("Removed"); loadPending();
      });
    } catch (e) { toast.error(e.message); }
  };

  const q = search.trim().toLowerCase();
  const filteredServices = !q ? services : services.filter(svc => [
    svc._order?.so_number, svc.orders?.so_number,
    svc._order?.customer_name, svc.orders?.customer_name, svc.customer_name,
    svc.description, svc.customer_phone, svc._order?.contact,
    svc._assigned?.name, svc.assigned?.name, SERVICE_TYPES[svc.service_type],
  ].filter(Boolean).join(" ").toLowerCase().includes(q));

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">Services</h1>
        <div className="flex gap-2 flex-wrap">
          {tab === "cases" && (
            <>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SO, customer, description..."
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-56 focus:outline-none focus:border-violet-400" />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                <option value="">All Status</option>
                {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </>
          )}
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">+ New Service Case</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab("cases")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === "cases" ? "bg-violet-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-violet-300"}`}>
          Service Cases {filteredServices.length > 0 && <span className="ml-1 text-xs opacity-75">({filteredServices.length})</span>}
        </button>
        <button onClick={() => setTab("pending")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === "pending" ? "bg-amber-500 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-amber-300"}`}>
          Pending {pending.length > 0 && <span className="ml-1 bg-red-100 text-red-700 text-xs font-bold px-1.5 rounded-full">{pending.length}</span>}
        </button>
      </div>

      {/* Pending tab */}
      {tab === "pending" && (
        <div className="space-y-2">
          {pending.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-medium">No pending services</p>
              <p className="text-xs mt-1">Service complaints from orders will appear here</p>
            </div>
          )}
          {pending.map(sp => (
            <div key={sp.id} className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-violet-700 text-sm">SO {sp.so_number}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Pending</span>
                  </div>
                  <p className="text-sm text-gray-800 mt-1">{sp.customer_name}</p>
                  {sp.remark && <p className="text-xs text-gray-500 mt-0.5">{sp.remark}</p>}
                  <p className="text-xs text-gray-400 mt-1">{sp.created_at ? new Date(sp.created_at).toLocaleDateString("en-MY") : ""}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => removePending(sp.id)} className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-xl hover:bg-red-50">Remove</button>
                  <button onClick={() => { setConvertModal(sp); setConvertRemark(""); }} className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-xl hover:bg-amber-600">Create Case</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Service list */}
      {tab === "cases" && loading && <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}
      {tab === "cases" && !loading && filteredServices.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🔧</div>
          <p className="font-medium">{q || filterStatus ? "No matching service cases" : "No service cases"}</p>
          <p className="text-xs mt-1">{q || filterStatus ? "Try a different search or status" : 'Create one from an order or click "+ New Service Case"'}</p>
        </div>
      )}
      {tab === "cases" && <div className="space-y-2">
        {filteredServices.map(svc => (
          <div key={svc.id} onClick={() => openDetail(svc)}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-violet-200 cursor-pointer transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{TYPE_ICON[svc.service_type] || "🔧"}</span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 text-sm">{SERVICE_TYPES[svc.service_type] || `Type ${svc.service_type}`}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[svc.status] || "bg-gray-100"}`}>{svc.status}</span>
                    {svc.source === "legacy_order" && <span className="px-1.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">Legacy</span>}
                    {svc.source === "service_pending" && <span className="px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-600">From pending</span>}
                    {svc.priority === "urgent" && <span className="px-1.5 py-0.5 rounded-full text-xs bg-red-100 text-red-600">Urgent</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {(svc._order?.so_number || svc.orders?.so_number) && <span className="text-violet-600 font-medium">{svc._order?.so_number || svc.orders?.so_number} · </span>}
                    {svc._order?.customer_name || svc.orders?.customer_name || svc.customer_name || "No order linked"}
                    {(svc._order?.salesman || svc.orders?.salesman) && <span className="ml-2 text-gray-400">· {svc._order?.salesman || svc.orders?.salesman}</span>}
                    {(svc._assigned?.name || svc.assigned?.name) && <span className="ml-2 text-gray-400">→ {svc._assigned?.name || svc.assigned?.name}</span>}
                  </p>
                  {svc.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{svc.description}</p>}
                </div>
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0">{svc.created_at ? new Date(svc.created_at).toLocaleDateString("en-MY") : ""}</span>
            </div>
          </div>
        ))}
      </div>}

      {/* Convert Pending Modal */}
      {convertModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-bold text-gray-900">Create Service Case</h3>
              <p className="text-xs text-gray-500 mt-0.5">From <b>SO {convertModal.so_number}</b> — {convertModal.customer_name}</p>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Remark / Issue</label>
                <textarea value={convertRemark} onChange={e => setConvertRemark(e.target.value)} rows={3}
                  placeholder="Describe the issue..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setConvertModal(null)} className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={() => convertPending(convertModal)} className="px-5 py-2 text-sm rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600">Create Case</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-900">New Service Case</h3>
              <button onClick={() => setShowCreate(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Service Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(SERVICE_TYPES).map(([k, v]) => (
                    <button key={k} onClick={() => setCreateForm(f => ({ ...f, service_type: Number(k) }))}
                      className={`py-2.5 rounded-xl text-xs font-medium border transition-colors ${createForm.service_type === Number(k) ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200"}`}>
                      {TYPE_ICON[k]} {v.split("/")[0]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Link to Order (optional)</label>
                {createForm.order_id ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-sm">
                    <span className="text-violet-700 font-medium truncate">{orderSearch || "Order linked"}</span>
                    <button onClick={() => { setCreateForm(f => ({ ...f, order_id: "" })); setOrderSearch(""); }}
                      className="ml-2 text-xs text-gray-500 hover:text-gray-700 shrink-0">Clear</button>
                  </div>
                ) : (
                  <input value={orderSearch} onChange={e => searchOrders(e.target.value)} placeholder="Search SO number or customer..."
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                )}
                {!createForm.order_id && orderResults.length > 0 && (
                  <div className="border border-gray-200 rounded-xl mt-1 max-h-32 overflow-y-auto">
                    {orderResults.map(o => (
                      <button key={o.id} onClick={() => { setCreateForm(f => ({ ...f, order_id: o.id, customer_name: "", customer_phone: "", customer_address: "" })); setOrderSearch(`${o.so_number} — ${o.customer_name}`); setOrderResults([]); }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-violet-50">
                        <span className="font-bold text-violet-700">{o.so_number}</span> {o.customer_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* No linked order → capture customer details directly (backend stores
                  them on the service + its inert delivery order). */}
              {!createForm.order_id && (
                <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">Customer details</p>
                  <input value={createForm.customer_name} onChange={e => setCreateForm(f => ({ ...f, customer_name: e.target.value }))}
                    placeholder="Customer name"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  <input value={createForm.customer_phone} onChange={e => setCreateForm(f => ({ ...f, customer_phone: e.target.value }))}
                    placeholder="Contact number"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  <textarea value={createForm.customer_address} onChange={e => setCreateForm(f => ({ ...f, customer_address: e.target.value }))}
                    placeholder="Address" rows={2}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                <textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What's the issue? What needs to be done?" rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              </div>
              {/* Line items — one row per thing to do, each with its own action.
                  Optional at creation; can also be added from the detail drawer. */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-500">Items (optional)</label>
                  <button type="button" onClick={() => setCreateItems(a => [...a, { description: "", action_type: 2, quantity: 1 }])}
                    className="text-xs px-2 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Item</button>
                </div>
                {createItems.length === 0 ? (
                  <p className="text-xs text-gray-400">No items — you can also add them after creating the case.</p>
                ) : (
                  <div className="space-y-2">
                    {createItems.map((it, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-4 text-right">{i + 1}.</span>
                          <input value={it.description} onChange={e => setCreateItems(a => a.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
                            placeholder="e.g. Dining chair"
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                          <select value={it.action_type} onChange={e => setCreateItems(a => a.map((x, idx) => idx === i ? { ...x, action_type: Number(e.target.value) } : x))}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white shrink-0">
                            {Object.entries(ITEM_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          <input type="number" min="1" value={it.quantity} onChange={e => setCreateItems(a => a.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))}
                            className="w-12 px-1.5 py-1.5 rounded-lg border border-gray-200 text-xs text-center shrink-0" />
                          <button type="button" onClick={() => setCreateItems(a => a.filter((_, idx) => idx !== i))}
                            className="text-gray-300 hover:text-red-500 text-base px-1 shrink-0">×</button>
                        </div>
                        {/* Claim items need the claimed part to arrive first. */}
                        {Number(it.action_type) === 3 && (
                          <div className="flex items-center gap-2 pl-6">
                            <span className="text-xs text-gray-400">Arrival date</span>
                            <input type="date" value={it.arrival_date || ""} onChange={e => setCreateItems(a => a.map((x, idx) => idx === i ? { ...x, arrival_date: e.target.value } : x))}
                              className="px-2 py-1 rounded-lg border border-gray-200 text-xs" />
                            <span className="text-xs text-gray-400">optional — leave blank until the part arrives</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Service Creation Date</label>
                  <input type="date" value={createForm.service_date} onChange={e => setCreateForm(f => ({ ...f, service_date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Schedule Date</label>
                  <input type="date" value={createForm.schedule_tbc ? "" : createForm.delivery_date} disabled={createForm.schedule_tbc}
                    onChange={e => setCreateForm(f => ({ ...f, delivery_date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400 disabled:bg-gray-100 disabled:text-gray-400" />
                  <label className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" checked={createForm.schedule_tbc} onChange={e => setCreateForm(f => ({ ...f, schedule_tbc: e.target.checked }))} />
                    TBC — hidden from delivery route
                  </label>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={createService} className="px-5 py-2 text-sm rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">
            {detailLoading ? (
              <div className="px-6 py-4 space-y-4 animate-pulse"><div className="flex gap-3"><div className="w-12 h-12 bg-gray-200 rounded-full" /><div className="flex-1 space-y-2"><div className="h-4 bg-gray-200 rounded w-1/3" /><div className="h-3 bg-gray-100 rounded w-1/2" /></div></div>{[1,2,3].map(i=><div key={i} className="h-16 bg-gray-50 rounded-xl" />)}</div>
            ) : (
              <>
                <div className="sticky top-0 bg-white border-b px-6 py-4 z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{TYPE_ICON[detail.service?.service_type]}</span>
                      <div>
                        <h2 className="font-bold text-gray-900">{SERVICE_TYPES[detail.service?.service_type]}</h2>
                        <p className="text-xs text-gray-500">{[detail.order?.so_number, detail.order?.customer_name].filter(Boolean).join(" · ")}</p>
                      </div>
                    </div>
                    <button onClick={() => setDetail(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
                  </div>
                </div>
                <div className="px-6 py-4 space-y-5">
                  {/* Status + actions */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLE[detail.service?.status]}`}>{detail.service?.status}</span>
                    <select value={detail.service?.status} onChange={e => updateServiceStatus(detail.service.id, e.target.value)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white">
                      {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => deleteService(detail.service.id)}
                      className="ml-auto text-xs px-3 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">Delete</button>
                  </div>

                  {/* Dates: creation + schedule */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">CREATION DATE</label>
                      <input type="date" value={(detail.service?.service_date || "").slice(0, 10)}
                        onChange={e => updateService(detail.service.id, { service_date: e.target.value || null })}
                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">SCHEDULE DATE</label>
                      <input type="date" value={(detail.service?.due_date || "").slice(0, 10)}
                        disabled={detail.service?.schedule_tbc}
                        onChange={e => updateService(detail.service.id, { delivery_date: e.target.value || null, schedule_tbc: false })}
                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 disabled:bg-gray-100" />
                      <label className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
                        <input type="checkbox" checked={!!detail.service?.schedule_tbc}
                          onChange={e => updateService(detail.service.id, { schedule_tbc: e.target.checked })} />
                        To be confirmed (TBC)
                      </label>
                    </div>
                  </div>

                  {/* Description */}
                  {detail.service?.description && (
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-xs font-bold text-gray-500 mb-1">DESCRIPTION</p>
                      <p className="text-sm text-gray-700">{detail.service.description}</p>
                    </div>
                  )}

                  {/* Items — the work list for this visit, each with its own
                      action + done/pending status. Mirrored to the delivery
                      schedule print server-side. */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-gray-500">ITEMS ({(detail.items || []).length})</p>
                      <button onClick={() => addServiceItem(detail.service.id)} className="text-xs px-3 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Item</button>
                    </div>
                    {(detail.items || []).length === 0 && <p className="text-xs text-gray-400">No items yet</p>}
                    <div className="space-y-2">
                      {(detail.items || []).map((it, idx) => (
                        <div key={it.id} className="bg-white border border-gray-200 rounded-xl p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-gray-400 mr-1">{idx + 1}.</span>
                              <span className="text-sm font-medium text-gray-900">{it.description}</span>
                              {Number(it.quantity) > 1 && <span className="text-xs text-gray-400 ml-1">× {Number(it.quantity)}</span>}
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${it.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                              {it.status === "done" ? "✓ Done" : "Pending"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <select value={it.action_type} onChange={e => updateServiceItem(it.id, { action_type: Number(e.target.value) })}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white">
                              {Object.entries(ITEM_ACTIONS).map(([k, v]) => <option key={k} value={k}>{ITEM_ACTION_ICON[k]} {v}</option>)}
                            </select>
                            <button onClick={() => updateServiceItem(it.id, { status: it.status === "done" ? "pending" : "done" })}
                              className={`text-xs px-3 py-1 rounded-lg ${it.status === "done" ? "bg-gray-100 text-gray-600" : "bg-emerald-600 text-white"}`}>
                              {it.status === "done" ? "Mark pending" : "Mark done"}
                            </button>
                            <button onClick={() => deleteServiceItem(it.id)} className="text-xs px-2 py-1 rounded-lg text-red-500 hover:bg-red-50 ml-auto">Remove</button>
                          </div>
                          {/* Claim items gate delivery readiness on the claimed
                              part arriving — record its arrival date here. */}
                          {Number(it.action_type) === 3 && (
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className="text-xs font-medium text-gray-500">Arrival</span>
                              <input type="date" value={(it.arrival_date || "").slice(0, 10)}
                                onChange={e => updateServiceItem(it.id, { arrival_date: e.target.value || null })}
                                className="text-xs px-2 py-1 rounded-lg border border-gray-200" />
                              {it.arrival_date
                                ? <span className="text-xs text-emerald-600 font-medium">✓ Arrived</span>
                                : <span className="text-xs text-red-500 font-medium">No arrival yet</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Customer info */}
                  {detail.order && (
                    <div className="bg-violet-50 rounded-xl p-3 space-y-1">
                      <p className="text-xs font-bold text-violet-600">CUSTOMER</p>
                      <p className="text-sm font-medium text-gray-900">{detail.order.customer_name}</p>
                      {detail.order.contact && <p className="text-xs text-gray-600">{detail.order.contact}</p>}
                      {detail.order.address && <p className="text-xs text-gray-500">{detail.order.address}</p>}
                      {detail.order.salesman && <p className="text-xs text-gray-500 pt-1">Salesman: <span className="font-medium text-gray-700">{detail.order.salesman}</span></p>}
                    </div>
                  )}

                  {/* Service Legs */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 mb-2">SERVICE LEGS ({(detail.legs || []).length})</p>
                    <div className="space-y-2">
                      {(detail.legs || []).map(leg => (
                        <div key={leg.id} className="bg-white border border-gray-200 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500">Leg {leg.leg_order}</span>
                              <span className="text-xs text-gray-700">{leg.from_location} → {leg.to_location}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEG_STATUS[leg.status] || "bg-gray-100"}`}>{leg.status}</span>
                          </div>
                          {leg.notes && <p className="text-xs text-gray-400 mb-1">{leg.notes}</p>}
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <select value={leg.status} onChange={e => updateLeg(leg.id, { status: e.target.value })}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white">
                              {Object.keys(LEG_STATUS).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <input type="date" value={(leg.scheduled_at || "").slice(0, 10)}
                              onChange={e => updateLeg(leg.id, { scheduled_at: e.target.value || null })}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Part Claims */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-gray-500">PART CLAIMS ({(detail.claims || []).length})</p>
                      <button onClick={() => addClaim(detail.service.id)} className="text-xs px-3 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Claim</button>
                    </div>
                    {(detail.claims || []).length === 0 && <p className="text-xs text-gray-400">No part claims yet</p>}
                    <div className="space-y-2">
                      {(detail.claims || []).map(claim => (
                        <div key={claim.id} className="bg-white border border-gray-200 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-1">
                            <div>
                              <span className="text-sm font-medium text-gray-900">{claim.part_name || claim.part_code || "Part"}</span>
                              {claim.claim_ref && <span className="text-xs text-gray-400 ml-2">Ref: {claim.claim_ref}</span>}
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CLAIM_STATUS[claim.claim_status] || "bg-gray-100"}`}>{claim.claim_status}</span>
                          </div>
                          {claim.notes && <p className="text-xs text-gray-400">{claim.notes}</p>}
                          <div className="flex gap-2 mt-2">
                            {claim.claim_status === "pending" && (
                              <button onClick={() => { const ref = window.prompt("Claim reference:"); if (ref) updateClaim(claim.id, { claim_status: "submitted", claim_ref: ref }); }}
                                className="text-xs px-3 py-1 rounded-lg bg-blue-600 text-white">Submit Claim</button>
                            )}
                            {claim.claim_status === "submitted" && (
                              <button onClick={() => updateClaim(claim.id, { claim_status: "approved" })}
                                className="text-xs px-3 py-1 rounded-lg bg-violet-600 text-white">Approved</button>
                            )}
                            {(claim.claim_status === "approved" || claim.claim_status === "submitted") && (
                              <button onClick={() => updateClaim(claim.id, { claim_status: "received" })}
                                className="text-xs px-3 py-1 rounded-lg bg-emerald-600 text-white">Part Received</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ServicePage);
