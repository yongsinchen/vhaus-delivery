import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

const API = "https://vhaus-bot-production.up.railway.app";
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

export default function ServicePage() {
  const { user, activeCompanyId } = useAuth();
  const toast = useToast();
  const companyId = activeCompanyId || user?.company_id;

  const [services, setServices] = useState([]);
  const [pending, setPending] = useState([]);
  const [tab, setTab] = useState("cases"); // "cases" | "pending"
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [convertModal, setConvertModal] = useState(null);
  const [convertRemark, setConvertRemark] = useState("");

  // Create form
  const [createForm, setCreateForm] = useState({ order_id: "", service_type: 1, description: "" });
  const [orderSearch, setOrderSearch] = useState("");
  const [orderResults, setOrderResults] = useState([]);

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
    const res = await af(`${API}/services?company_id=${companyId}`);
    const all = await res.json();
    const filtered = (Array.isArray(all) ? all : []).filter(o =>
      (o.so_number || "").toLowerCase().includes(q.toLowerCase()) ||
      (o.customer_name || "").toLowerCase().includes(q.toLowerCase())
    ).slice(0, 10);
    setOrderResults(filtered);
  };

  const createService = async () => {
    const res = await af(`${API}/service-cases`, { method: "POST", body: JSON.stringify(createForm) });
    const d = await res.json();
    if (d.service) { toast.success("Service case created"); setShowCreate(false); setCreateForm({ order_id: "", service_type: 1, description: "" }); loadServices(); }
    else toast.error(d.error || "Failed");
  };

  const updateServiceStatus = async (id, status) => {
    await af(`${API}/service-cases/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    loadServices();
    if (detail?.service?.id === id) openDetail(detail.service);
  };

  const updateLeg = async (legId, updates) => {
    await af(`${API}/service-legs/${legId}`, { method: "PATCH", body: JSON.stringify(updates) });
    if (detail?.service) openDetail(detail.service);
    loadServices();
  };

  const addClaim = async (serviceId) => {
    const partName = window.prompt("Part name / description:");
    if (!partName) return;
    await af(`${API}/service-part-claims`, { method: "POST", body: JSON.stringify({ service_id: serviceId, part_name: partName }) });
    toast.success("Claim added");
    openDetail(detail.service);
  };

  const updateClaim = async (claimId, updates) => {
    await af(`${API}/service-part-claims/${claimId}`, { method: "PATCH", body: JSON.stringify(updates) });
    if (detail?.service) openDetail(detail.service);
  };

  const deleteService = async (id) => {
    if (!window.confirm("Delete this service case? This will also remove all legs and part claims.")) return;
    const res = await af(`${API}/service-cases/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Service case deleted"); setDetail(null); loadServices(); }
    else { const d = await res.json(); toast.error(d.error || "Failed to delete"); }
  };

  const convertPending = async (sp) => {
    const res = await af(`${API}/service-pending/${sp.id}/convert`, {
      method: "POST", body: JSON.stringify({ remark: convertRemark, service_type: 1 }),
    });
    const d = await res.json();
    if (d.service) { toast.success("Service case created"); setConvertModal(null); setConvertRemark(""); loadServices(); loadPending(); }
    else toast.error(d.error || "Failed to convert");
  };

  const removePending = async (id) => {
    if (!window.confirm("Remove this pending service?")) return;
    const res = await af(`${API}/service-pending/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Removed"); loadPending(); }
    else toast.error("Failed to remove");
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">Services</h1>
        <div className="flex gap-2">
          {tab === "cases" && (
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
              <option value="">All Status</option>
              {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">+ New Service Case</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab("cases")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === "cases" ? "bg-violet-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-violet-300"}`}>
          Service Cases {services.length > 0 && <span className="ml-1 text-xs opacity-75">({services.length})</span>}
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
      {tab === "cases" && !loading && services.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🔧</div>
          <p className="font-medium">No service cases</p>
          <p className="text-xs mt-1">Create one from an order or click "+ New Service Case"</p>
        </div>
      )}
      {tab === "cases" && <div className="space-y-2">
        {services.map(svc => (
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
                <input value={orderSearch} onChange={e => searchOrders(e.target.value)} placeholder="Search SO number or customer..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                {orderResults.length > 0 && (
                  <div className="border border-gray-200 rounded-xl mt-1 max-h-32 overflow-y-auto">
                    {orderResults.map(o => (
                      <button key={o.id} onClick={() => { setCreateForm(f => ({ ...f, order_id: o.id })); setOrderSearch(`${o.so_number} — ${o.customer_name}`); setOrderResults([]); }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-violet-50">
                        <span className="font-bold text-violet-700">{o.so_number}</span> {o.customer_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                <textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What's the issue? What needs to be done?" rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
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
                        <p className="text-xs text-gray-500">{detail.order?.so_number} · {detail.order?.customer_name}</p>
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

                  {/* Description */}
                  {detail.service?.description && (
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-xs font-bold text-gray-500 mb-1">DESCRIPTION</p>
                      <p className="text-sm text-gray-700">{detail.service.description}</p>
                    </div>
                  )}

                  {/* Customer info */}
                  {detail.order && (
                    <div className="bg-violet-50 rounded-xl p-3 space-y-1">
                      <p className="text-xs font-bold text-violet-600">CUSTOMER</p>
                      <p className="text-sm font-medium text-gray-900">{detail.order.customer_name}</p>
                      {detail.order.contact && <p className="text-xs text-gray-600">{detail.order.contact}</p>}
                      {detail.order.address && <p className="text-xs text-gray-500">{detail.order.address}</p>}
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
                          {leg.scheduled_at && <p className="text-xs text-blue-600 mb-1">Scheduled: {new Date(leg.scheduled_at).toLocaleDateString("en-MY")}</p>}
                          {leg.notes && <p className="text-xs text-gray-400 mb-1">{leg.notes}</p>}
                          <div className="flex gap-2 mt-1">
                            {leg.status === "pending" && (
                              <>
                                <input type="date" onChange={e => updateLeg(leg.id, { scheduled_at: e.target.value, status: "scheduled" })}
                                  className="text-xs px-2 py-1 rounded-lg border border-gray-200" />
                              </>
                            )}
                            {leg.status === "scheduled" && (
                              <button onClick={() => updateLeg(leg.id, { status: "in_progress" })}
                                className="text-xs px-3 py-1 rounded-lg bg-amber-500 text-white">Start</button>
                            )}
                            {leg.status === "in_progress" && (
                              <button onClick={() => updateLeg(leg.id, { status: "completed" })}
                                className="text-xs px-3 py-1 rounded-lg bg-emerald-600 text-white">Complete</button>
                            )}
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
