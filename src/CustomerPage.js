import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast, useDebounce } from "./UIComponents";

const API = "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };
const money = v => `RM ${(Number(v) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const AGING_STYLE = { current: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "Current (0-30d)" }, "30_60": { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "30-60 days" }, "60_90": { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", label: "60-90 days" }, "90_plus": { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "90+ days" } };
const PAYMENT_METHODS = ["Cash", "Bank Transfer", "QR Pay", "Credit Card", "Touch n Go", "Cheque", "Instalment"];

export default function CustomerPage() {
  const { user, activeCompanyId } = useAuth();
  const toast = useToast();
  const companyId = activeCompanyId || user?.company_id;
  const [tab, setTab] = useState(0); // 0=customers, 1=aging
  const TABS = ["Customers", "Aging Report"];

  // Customer list
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [loading, setLoading] = useState(true);

  // Customer detail
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create/Edit
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", ic_number: "", company_name: "", notes: "" });

  // Payment modal
  const [payModal, setPayModal] = useState(null); // { customer, orders }
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payRef, setPayRef] = useState("");
  const [payAllocations, setPayAllocations] = useState([]);
  const [payProofs, setPayProofs] = useState([]); // uploaded proof URLs
  const [payUploading, setPayUploading] = useState(false);

  // Aging
  const [aging, setAging] = useState(null);
  const [agingLoading, setAgingLoading] = useState(false);

  const loadCustomers = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams({ company_id: companyId, limit: "200" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    const res = await af(`${API}/customers?${params}`);
    const d = await res.json();
    setCustomers(d.customers || []);
    setLoading(false);
  }, [companyId, debouncedSearch]);

  const loadAging = useCallback(async () => {
    if (!companyId) return;
    setAgingLoading(true);
    const res = await af(`${API}/aging-report?company_id=${companyId}`);
    const d = await res.json();
    setAging(d);
    setAgingLoading(false);
  }, [companyId]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);
  useEffect(() => { if (tab === 1) loadAging(); }, [tab, loadAging]);

  const openDetail = async (cust) => {
    setDetailLoading(true);
    const res = await af(`${API}/customers/${cust.id}`);
    const d = await res.json();
    setDetail(d);
    setDetailLoading(false);
  };

  const saveCustomer = async () => {
    const url = editId ? `${API}/customers/${editId}` : `${API}/customers`;
    const method = editId ? "PUT" : "POST";
    const res = await af(url, { method, body: JSON.stringify(form) });
    const d = await res.json();
    if (d.customer) { toast.success(editId ? "Customer updated" : "Customer created"); setShowForm(false); setEditId(null); loadCustomers(); }
    else toast.error(d.error || "Failed");
  };

  const openEdit = (c) => {
    setForm({ name: c.name || "", phone: c.phone || "", email: c.email || "", address: c.address || "", ic_number: c.ic_number || "", company_name: c.company_name || "", notes: c.notes || "" });
    setEditId(c.id);
    setShowForm(true);
  };

  const openPayment = (customer, orders) => {
    const withBalance = (orders || []).filter(o => Number(o.balance) > 0);
    setPayAllocations(withBalance.map(o => ({ order_id: o.id, so_number: o.so_number, balance: Number(o.balance), amount: "" })));
    setPayAmount("");
    setPayMethod("Cash");
    setPayRef("");
    setPayProofs([]);
    setPayModal({ customer, orders: withBalance });
  };

  const autoAllocate = (total) => {
    let remaining = Number(total) || 0;
    setPayAllocations(prev => prev.map(a => {
      const alloc = Math.min(remaining, a.balance);
      remaining -= alloc;
      return { ...a, amount: alloc > 0 ? String(alloc) : "" };
    }));
  };

  const submitPayment = async () => {
    const total = Number(payAmount);
    if (!total || total <= 0) { toast.warning("Enter payment amount"); return; }
    const allocations = payAllocations.filter(a => Number(a.amount) > 0).map(a => ({ order_id: a.order_id, amount: Number(a.amount) }));
    const res = await af(`${API}/payments/record`, { method: "POST", body: JSON.stringify({ customer_id: payModal.customer.id, amount: total, payment_method: payMethod, reference_no: payRef || null, proof_url: payProofs.join(", ") || null, allocations }) });
    const d = await res.json();
    if (d.payment) { toast.success(`${money(total)} recorded`); setPayModal(null); if (detail) openDetail(detail.customer); }
    else toast.error(d.error || "Failed");
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">Customers & Finance</h1>
        <button onClick={() => { setForm({ name: "", phone: "", email: "", address: "", ic_number: "", company_name: "", notes: "" }); setEditId(null); setShowForm(true); }}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">+ New Customer</button>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors ${tab === i ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-700 hover:bg-violet-50"}`}>{t}</button>
        ))}
      </div>

      {/* TAB 0: Customer List */}
      {tab === 0 && (
        <div className="space-y-3">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, email..."
            className="w-full sm:w-72 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
          {loading && <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{[1,2,3,4,5,6].map(i=><div key={i} className="h-20 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}
          {!loading && customers.length === 0 && <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-2">👥</div><p>No customers yet</p></div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {customers.map(c => (
              <div key={c.id} onClick={() => openDetail(c)} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-violet-200 cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-sm flex-shrink-0">
                    {(c.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.phone || ""} {c.email ? `· ${c.email}` : ""}</p>
                    {c.company_name && <p className="text-xs text-violet-600">{c.company_name}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 1: Aging Report */}
      {tab === 1 && (
        <div className="space-y-4">
          {agingLoading && <div className="text-center text-gray-400 py-8">Loading aging report...</div>}
          {aging && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {Object.entries(AGING_STYLE).map(([key, style]) => (
                  <div key={key} className={`${style.bg} border ${style.border} rounded-2xl p-4 text-center`}>
                    <p className={`text-xs font-medium ${style.text}`}>{style.label}</p>
                    <p className={`text-lg font-bold ${style.text} mt-1`}>{money(aging.summary?.[key] || 0)}</p>
                    <p className="text-xs text-gray-400">{(aging.buckets?.[key] || []).length} orders</p>
                  </div>
                ))}
                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-center">
                  <p className="text-xs font-medium text-gray-600">Total AR</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{money(aging.summary?.total || 0)}</p>
                  <p className="text-xs text-gray-400">{aging.summary?.order_count || 0} orders</p>
                </div>
              </div>

              {/* Overdue orders list */}
              {["90_plus", "60_90", "30_60", "current"].map(bucket => {
                const items = aging.buckets?.[bucket] || [];
                if (items.length === 0) return null;
                const style = AGING_STYLE[bucket];
                return (
                  <div key={bucket}>
                    <h3 className={`text-sm font-bold ${style.text} mb-2`}>{style.label} ({items.length})</h3>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                      {items.sort((a, b) => b.days_outstanding - a.days_outstanding).map(o => (
                        <div key={o.id} className="flex items-center justify-between px-4 py-3">
                          <div>
                            <span className="text-sm font-bold text-violet-700">{o.so_number}</span>
                            <span className="text-sm text-gray-700 ml-2">{o.customer_name}</span>
                            <p className="text-xs text-gray-400">{o.days_outstanding} days · {o.contact || ""}</p>
                          </div>
                          <span className={`text-sm font-bold ${style.text}`}>{money(o.balance)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{editId ? "Edit Customer" : "New Customer"}</h3>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {[{ k: "name", l: "Name *" }, { k: "phone", l: "Phone" }, { k: "email", l: "Email" }, { k: "address", l: "Address" }, { k: "ic_number", l: "IC / Passport" }, { k: "company_name", l: "Company" }, { k: "notes", l: "Notes" }].map(({ k, l }) => (
                <div key={k}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{l}</label>
                  {k === "notes" || k === "address" ? (
                    <textarea value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} rows={2}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  ) : (
                    <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  )}
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={saveCustomer} className="px-5 py-2 text-sm rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700">{editId ? "Update" : "Create"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Detail Drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">
            {detailLoading ? <div className="px-6 py-4 space-y-4 animate-pulse"><div className="flex gap-3"><div className="w-12 h-12 bg-gray-200 rounded-full" /><div className="flex-1 space-y-2"><div className="h-4 bg-gray-200 rounded w-1/3" /><div className="h-3 bg-gray-100 rounded w-1/2" /></div></div><div className="grid grid-cols-3 gap-3">{[1,2,3].map(i=><div key={i} className="h-16 bg-gray-100 rounded-xl" />)}</div>{[1,2,3].map(i=><div key={i} className="h-12 bg-gray-50 rounded-xl" />)}</div> : (
              <>
                <div className="sticky top-0 bg-white border-b px-6 py-4 z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-lg">
                        {(detail.customer?.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="font-bold text-gray-900">{detail.customer?.name}</h2>
                        <p className="text-xs text-gray-500">{detail.customer?.phone || ""} {detail.customer?.email ? `· ${detail.customer.email}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(detail.customer)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Edit</button>
                      <button onClick={() => setDetail(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 space-y-5">
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-violet-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-violet-600">Orders</p>
                      <p className="text-lg font-bold text-violet-700">{detail.summary?.order_count || 0}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-emerald-600">Total Spent</p>
                      <p className="text-sm font-bold text-emerald-700">{money(detail.summary?.total_spent)}</p>
                    </div>
                    <div className={`rounded-xl p-3 text-center ${(detail.summary?.total_balance || 0) > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                      <p className={`text-xs ${(detail.summary?.total_balance || 0) > 0 ? "text-red-600" : "text-gray-500"}`}>Balance</p>
                      <p className={`text-sm font-bold ${(detail.summary?.total_balance || 0) > 0 ? "text-red-700" : "text-gray-400"}`}>{money(detail.summary?.total_balance)}</p>
                    </div>
                  </div>

                  {/* Pay button */}
                  {(detail.summary?.total_balance || 0) > 0 && (
                    <button onClick={() => openPayment(detail.customer, detail.orders)}
                      className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700">
                      💰 Record Payment ({money(detail.summary.total_balance)} outstanding)
                    </button>
                  )}

                  {/* Customer info */}
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-sm">
                    {detail.customer?.address && <p className="text-gray-600">📍 {detail.customer.address}</p>}
                    {detail.customer?.ic_number && <p className="text-gray-600">🪪 {detail.customer.ic_number}</p>}
                    {detail.customer?.company_name && <p className="text-violet-600">🏢 {detail.customer.company_name}</p>}
                    {detail.customer?.notes && <p className="text-gray-400">📝 {detail.customer.notes}</p>}
                  </div>

                  {/* Orders */}
                  <div>
                    <h3 className="text-sm font-bold text-gray-700 mb-2">Orders ({(detail.orders || []).length})</h3>
                    <div className="space-y-2">
                      {(detail.orders || []).map(o => (
                        <div key={o.id} className="bg-white border border-gray-100 rounded-xl p-3 flex items-center justify-between">
                          <div>
                            <span className="text-sm font-bold text-violet-700">{o.so_number}</span>
                            <span className="text-xs text-gray-500 ml-2">{o.status}</span>
                            {o.type === "Service" && <span className="text-xs text-violet-500 ml-1">(Service)</span>}
                            <p className="text-xs text-gray-400">{o.delivery_date || ""} · {money(o.order_amount)}</p>
                          </div>
                          <div className="text-right">
                            {Number(o.balance) > 0 ? <p className="text-sm font-bold text-red-600">{money(o.balance)}</p> : <p className="text-xs text-emerald-600">Paid</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Payments */}
                  <div>
                    <h3 className="text-sm font-bold text-gray-700 mb-2">Payments ({(detail.payments || []).length})</h3>
                    {(detail.payments || []).length === 0 && <p className="text-xs text-gray-400">No payments recorded</p>}
                    <div className="space-y-2">
                      {(detail.payments || []).map(p => (
                        <div key={p.id} className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between">
                          <div>
                            <span className="text-sm font-bold text-emerald-700">{money(p.amount)}</span>
                            <span className="text-xs text-gray-500 ml-2">{p.payment_method}</span>
                            {p.reference_no && <span className="text-xs text-gray-400 ml-2">Ref: {p.reference_no}</span>}
                            <p className="text-xs text-gray-400">{p.paid_at ? new Date(p.paid_at).toLocaleDateString("en-MY") : ""}</p>
                            {p.proof_url && (
                              <div className="mt-1 flex flex-wrap gap-2">
                                {p.proof_url.split(",").map(u => u.trim()).filter(Boolean).map((u, i) => (
                                  <a key={i} href={u} target="_blank" rel="noreferrer" className="text-xs text-violet-600 underline">📎 Proof {i + 1}</a>
                                ))}
                              </div>
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

      {/* Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">Record Payment</h3>
                <p className="text-xs text-gray-500">{payModal.customer.name} · {payModal.orders.length} order(s) with balance</p>
              </div>
              <button onClick={() => setPayModal(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
            </div>
            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Total Amount (RM)</label>
                <input type="number" value={payAmount} onChange={e => { setPayAmount(e.target.value); autoAllocate(e.target.value); }} autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map(m => (
                    <button key={m} onClick={() => setPayMethod(m)}
                      className={`py-2 rounded-xl text-xs font-medium border ${payMethod === m ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              {payMethod === "Bank Transfer" && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Reference</label>
                  <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Transfer reference"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                </div>
              )}
              {/* Payment Proof upload */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Payment Proof</label>
                <div className="space-y-1">
                  {payProofs.map((url, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2 py-1">
                      <a href={url} target="_blank" rel="noreferrer" className="flex-1 text-violet-600 underline truncate">{url.split("/").pop()}</a>
                      <button type="button" onClick={() => setPayProofs(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">✕</button>
                    </div>
                  ))}
                </div>
                <label className={`mt-1 flex items-center gap-2 text-xs cursor-pointer ${payUploading ? "text-gray-400" : "text-violet-600 hover:text-violet-800"}`}>
                  <span>{payUploading ? "Uploading…" : "+ Upload receipt / screenshot"}</span>
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={payUploading} onChange={async e => {
                    const file = e.target.files?.[0]; if (!file) return;
                    setPayUploading(true);
                    try {
                      const token = await getToken();
                      const fd = new FormData(); fd.append("file", file);
                      const res = await fetch(`${API}/sales-orders/upload-attachment`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
                      const d = await res.json();
                      if (d.url) setPayProofs(prev => [...prev, d.url]);
                      else toast.error(d.error || "Upload failed");
                    } catch (err) { toast.error("Upload failed"); }
                    finally { setPayUploading(false); e.target.value = ""; }
                  }} />
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Allocate to Orders</label>
                <p className="text-xs text-gray-400 mb-2">Amount auto-distributed to oldest orders first. Adjust manually if needed.</p>
                <div className="space-y-2">
                  {payAllocations.map((a, i) => (
                    <div key={a.order_id} className="flex items-center gap-2 bg-gray-50 rounded-xl p-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold text-violet-700">{a.so_number}</span>
                        <span className="text-xs text-red-500 ml-2">Bal: {money(a.balance)}</span>
                      </div>
                      <input type="number" value={a.amount} onChange={e => {
                        const next = [...payAllocations]; next[i] = { ...next[i], amount: e.target.value }; setPayAllocations(next);
                      }} placeholder="0" className="w-24 px-2 py-1 text-sm text-right rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">Allocated: {money(payAllocations.reduce((s, a) => s + (Number(a.amount) || 0), 0))} of {money(payAmount)}</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t">
              <button onClick={submitPayment} disabled={!payAmount || Number(payAmount) <= 0}
                className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                Record {money(payAmount || 0)} Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
