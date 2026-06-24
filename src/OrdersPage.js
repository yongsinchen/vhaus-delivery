import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth, supabase } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";

const getToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
};
const authHeaders = async () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${await getToken()}`,
});

const STATUSES = ["draft", "confirmed", "delivered", "cancelled"];
const STATUS_STYLE = {
  draft: "bg-gray-100 text-gray-600",
  confirmed: "bg-violet-100 text-violet-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-600",
};

const EMPTY_ORDER = {
  customer_name: "", customer_contact: "", customer_address: "",
  status: "draft", notes: "", items: [],
};

export default function OrdersPage() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  // Order builder drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_ORDER);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Product picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [productLoading, setProductLoading] = useState(false);

  const loadOrders = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const headers = await authHeaders();
    const params = new URLSearchParams();
    if (filterStatus) params.set("status", filterStatus);
    if (search) params.set("search", search);
    const res = await fetch(`${API}/sales-orders?${params}`, { headers });
    const d = await res.json();
    setOrders(d.orders || []);
    setLoading(false);
  }, [companyId, filterStatus, search]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // ── Product search for picker ─────────────────────────────────────
  const searchProducts = useCallback(async (q) => {
    if (!companyId) return;
    setProductLoading(true);
    const params = new URLSearchParams({ company_id: companyId, limit: 30, is_active: "true" });
    if (q) params.set("search", q);
    const res = await fetch(`${API}/products?${params}`);
    const d = await res.json();
    setProducts(d.products || []);
    setProductLoading(false);
  }, [companyId]);

  useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(() => searchProducts(productSearch), 250);
    return () => clearTimeout(t);
  }, [pickerOpen, productSearch, searchProducts]);

  // ── Order CRUD ────────────────────────────────────────────────────
  const openNew = () => {
    setEditId(null);
    setForm(EMPTY_ORDER);
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (o) => {
    setEditId(o.id);
    setForm({
      customer_name: o.customer_name || "",
      customer_contact: o.customer_contact || "",
      customer_address: o.customer_address || "",
      status: o.status || "draft",
      notes: o.notes || "",
      items: (o.sales_order_items || []).map(it => ({
        product_id: it.product_id, product_code: it.product_code, product_name: it.product_name,
        size: it.size, color: it.color, is_custom: it.is_custom,
        custom_dimensions: it.custom_dimensions || "", quantity: it.quantity ?? 1,
        unit_price: it.unit_price ?? "", unit_cost: it.unit_cost ?? "",
        attachment_url: it.attachment_url || "", notes: it.notes || "",
      })),
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const addLineItem = (p) => {
    setForm(f => ({
      ...f,
      items: [...f.items, {
        product_id: p.id, product_code: p.code, product_name: p.name,
        size: p.size || "", color: p.color || "", is_custom: p.is_customizable || false,
        custom_dimensions: "", quantity: 1, unit_price: p.unit_price ?? "", unit_cost: p.unit_cost ?? "",
        attachment_url: "", notes: "",
      }],
    }));
    setPickerOpen(false);
    setProductSearch("");
  };

  const updateItem = (idx, field, value) =>
    setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [field]: value } : it) }));

  const removeItem = (idx) =>
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const uploadAttachment = async (idx, file) => {
    if (!file) return;
    const token = await getToken();
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/sales-orders/upload-attachment`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
    });
    const d = await res.json();
    if (res.ok && d.url) updateItem(idx, "attachment_url", d.url);
    else alert(d.error || "Upload failed");
  };

  const total = form.items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 1), 0);

  const saveOrder = async () => {
    if (!form.customer_name.trim()) { setFormError("Customer name is required"); return; }
    if (form.items.length === 0) { setFormError("Add at least one product"); return; }
    setSaving(true);
    setFormError("");
    const headers = await authHeaders();
    const body = {
      customer_name: form.customer_name, customer_contact: form.customer_contact || null,
      customer_address: form.customer_address || null, status: form.status, notes: form.notes || null,
      items: form.items.map(it => ({
        ...it,
        quantity: Number(it.quantity) || 1,
        unit_price: it.unit_price === "" ? null : Number(it.unit_price),
        unit_cost: it.unit_cost === "" ? null : Number(it.unit_cost),
      })),
    };
    const url = editId ? `${API}/sales-orders/${editId}` : `${API}/sales-orders`;
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
    const d = await res.json();
    setSaving(false);
    if (!res.ok) { setFormError(d.error || "Failed to save"); return; }
    setDrawerOpen(false);
    loadOrders();
  };

  const changeStatus = async (o, status) => {
    const headers = await authHeaders();
    await fetch(`${API}/sales-orders/${o.id}/status`, { method: "PATCH", headers, body: JSON.stringify({ status }) });
    loadOrders();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-500">{orders.length} order{orders.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={openNew} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors">
          + New Order
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order # or customer…"
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-64 focus:outline-none focus:border-violet-400" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      {/* Orders list */}
      <div className="space-y-2">
        {loading && <div className="text-center text-gray-400 py-8">Loading…</div>}
        {!loading && orders.length === 0 && <div className="text-center text-gray-400 py-8">No orders yet</div>}
        {!loading && orders.map(o => (
          <div key={o.id} onClick={() => openEdit(o)}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-violet-200 cursor-pointer transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-medium text-violet-700">{o.order_number}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[o.status] || "bg-gray-100 text-gray-600"}`}>{o.status}</span>
                </div>
                <p className="font-medium text-gray-900 mt-1">{o.customer_name}</p>
                <p className="text-xs text-gray-400">
                  {(o.sales_order_items || []).length} item{(o.sales_order_items || []).length !== 1 ? "s" : ""}
                  {o.salesman_name ? ` · ${o.salesman_name}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-gray-900">RM {Number(o.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <select value={o.status} onClick={e => e.stopPropagation()} onChange={e => changeStatus(o, e.target.value)}
                  className="mt-1 text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-violet-400">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Order Builder Drawer ───────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setDrawerOpen(false)} />
          <div className="relative w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-900">{editId ? "Edit Order" : "New Order"}</h2>
              <button onClick={() => !saving && setDrawerOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {formError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{formError}</div>}

              {/* Customer info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Customer Name *" value={form.customer_name} onChange={v => setForm(f => ({ ...f, customer_name: v }))} />
                <Field label="Contact" value={form.customer_contact} onChange={v => setForm(f => ({ ...f, customer_contact: v }))} />
              </div>
              <Field label="Address" value={form.customer_address} onChange={v => setForm(f => ({ ...f, customer_address: v }))} />

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Items</label>
                  <button onClick={() => { setPickerOpen(true); setProductSearch(""); searchProducts(""); }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Product</button>
                </div>

                {form.items.length === 0 && <p className="text-sm text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-xl">No items added</p>}

                <div className="space-y-2">
                  {form.items.map((it, i) => (
                    <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-gray-900">
                            <span className="font-mono text-violet-700">{it.product_code}</span> {it.product_name}
                          </p>
                          <p className="text-xs text-gray-400">{[it.size, it.color].filter(Boolean).join(" · ")}</p>
                        </div>
                        {it.is_custom && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 shrink-0">Custom</span>}
                        <button onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500 text-sm shrink-0">✕</button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <NumField label="Qty" value={it.quantity} onChange={v => updateItem(i, "quantity", v)} />
                        <NumField label="Unit Price" value={it.unit_price} onChange={v => updateItem(i, "unit_price", v)} />
                        <div className="flex flex-col justify-end">
                          <span className="text-xs text-gray-400 mb-1">Line Total</span>
                          <span className="text-sm font-medium text-gray-900 py-1.5">
                            {((Number(it.unit_price) || 0) * (Number(it.quantity) || 1)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      {/* Customizable extras */}
                      {it.is_custom && (
                        <div className="space-y-2 pt-1">
                          <Field label="Custom Dimensions / Spec" value={it.custom_dimensions}
                            onChange={v => updateItem(i, "custom_dimensions", v)} placeholder='e.g. W55" or 5.5FT' small />
                          <AttachmentField idx={i} url={it.attachment_url} onUpload={uploadAttachment} onClear={() => updateItem(i, "attachment_url", "")} />
                        </div>
                      )}
                      <Field label="Item Note" value={it.notes} onChange={v => updateItem(i, "notes", v)} small />
                    </div>
                  ))}
                </div>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-sm font-medium text-gray-500">Subtotal</span>
                <span className="text-lg font-bold text-gray-900">RM {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>

              {/* Status + notes */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                  {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
              <Field label="Order Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} />

              <button onClick={saveOrder} disabled={saving}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editId ? "Update Order" : "Create Order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Product Picker ─────────────────────────────────────────── */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPickerOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <input autoFocus value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search products…"
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              <button onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl px-1">✕</button>
            </div>
            <div className="overflow-y-auto p-2">
              {productLoading && <p className="text-center text-gray-400 py-6 text-sm">Searching…</p>}
              {!productLoading && products.length === 0 && <p className="text-center text-gray-400 py-6 text-sm">No products found</p>}
              {!productLoading && products.map(p => (
                <button key={p.id} onClick={() => addLineItem(p)}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-violet-50 transition-colors flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      <span className="font-mono text-violet-700">{p.code}</span> {p.name}
                    </p>
                    <p className="text-xs text-gray-400">{[p.size, p.color, p.suppliers?.name].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.is_customizable && <span className="px-1.5 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">Custom</span>}
                    <span className="text-sm text-gray-600">{p.unit_price != null ? p.unit_price.toFixed(2) : "—"}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, small }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full px-3 ${small ? "py-1.5 text-xs" : "py-2 text-sm"} rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400`} />
    </div>
  );
}

function NumField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-1.5 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400" />
    </div>
  );
}

function AttachmentField({ idx, url, onUpload, onClear }) {
  const ref = useRef();
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">Site Measurement / Drawing</label>
      {url ? (
        <div className="flex items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-violet-700 underline truncate flex-1">View attachment</a>
          <button onClick={onClear} className="text-xs text-gray-400 hover:text-red-500">Remove</button>
        </div>
      ) : (
        <>
          <input ref={ref} type="file" accept="image/*,.pdf" className="hidden"
            onChange={e => onUpload(idx, e.target.files[0])} />
          <button onClick={() => ref.current?.click()}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">📎 Upload file</button>
        </>
      )}
    </div>
  );
}
