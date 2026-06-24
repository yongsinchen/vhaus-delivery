import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth, supabase } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";

const getToken = async () => {
  let { data } = await supabase.auth.getSession();
  let session = data?.session;
  // Refresh if the access token is expired or about to expire within 60s
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

const STATUSES = ["draft", "confirmed", "delivered", "cancelled"];
const STATUS_STYLE = {
  draft: "bg-gray-100 text-gray-600",
  confirmed: "bg-violet-100 text-violet-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-600",
};

const DELIVERY_TYPES = ["Delivery", "Self Pickup", "Service"];

const PAYMENT_METHODS = ["Cash", "Card", "Online Transfer", "E-Wallet", "Cheque"];

const EMPTY_ORDER = {
  customer_name: "", customer_contact: "", customer_address: "",
  status: "draft", notes: "", items: [],
  delivery_type: "Delivery", delivery_date: "", delivery_time_slot: "", remark: "",
  discount: "", deposit: "", payment_method: "",
  branch_id: "", salesman_names: "",
  country: "", gst_rate: 0,
};

// Company details for the printed sales order
const DEFAULT_COMPANY = {
  name: "V HAUS LIVING (PG) SDN. BHD.",
  reg: "202301043392 (1537308-U)",
  address: "2084 Jalan Rozhan, Taman Impian Ria, 14000 Bukit Mertajam, Pulau Pinang",
  hotline: "014-388 9328",
  bank: "CIMB 8011211457",
  branches_display: "Georgetown — 014-388 9328 | Alma — 014-388 9328 | Mutiara Rini — 017-721 6389 | Ros Merah — 018-277 8389 | Kulai — 018-277 8389",
};

const TERMS = [
  "All orders are confirmed only upon payment of a deposit. Deposits are strictly non-refundable.",
  "Full payment must be settled prior to delivery or collection of goods.",
  "Delivery dates provided are estimates only. The Company shall not be liable for any delay caused by suppliers, manufacturing, transportation, or any cause beyond its reasonable control.",
  "Goods sold are not returnable, refundable, or exchangeable once the order is confirmed, except for genuine manufacturing defects reported within 3 days of delivery.",
  "Customised, made-to-order, and special-size items cannot be cancelled, refunded, or exchanged under any circumstances.",
  "Natural materials (wood, rattan, leather, fabric) may vary in colour, grain, and texture. Such variations are inherent characteristics and shall not be regarded as defects.",
  "The customer must inspect all goods upon delivery. Signing the delivery note constitutes acceptance of the goods in good condition.",
  "Ownership of goods remains with the Company until full payment is received. Goods stored beyond 14 days from the agreed delivery date at the customer's request may incur storage charges.",
  "Warranty (where applicable) covers manufacturing defects only and excludes normal wear and tear, misuse, or improper care.",
  "The Company's total liability shall not exceed the purchase value of the goods. This agreement is governed by the laws of Malaysia.",
];

const money = (v) => (v == null || v === "" ? "" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function printSalesOrder(order, signatureDataUrl, co) {
  const COMPANY = co || DEFAULT_COMPANY;
  const items = order.items || order.sales_order_items || [];
  let gross = 0;
  const MIN_ROWS = 8;
  const itemRows = items.map((it, i) => {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.unit_price) || 0;
    const line = qty * price;
    gross += line;
    const spec = [it.size, it.color, it.custom_dimensions].filter(Boolean).join(" · ");
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.product_name || it.product_code || "")}${spec ? `<div class="spec">${esc(spec)}</div>` : ""}${it.notes ? `<div class="spec">${esc(it.notes)}</div>` : ""}</td>
      <td class="c">${qty}</td>
      <td class="r">${it.unit_price === 0 || it.unit_price == null ? "" : money(price)}</td>
      <td class="r">${line ? money(line) : ""}</td>
    </tr>`;
  });
  for (let i = items.length; i < MIN_ROWS; i++) {
    itemRows.push(`<tr><td class="c">${i + 1}</td><td></td><td></td><td></td><td></td></tr>`);
  }

  const discount = Number(order.discount) || 0;
  const deposit = Number(order.deposit) || 0;
  const subtotal = order.subtotal != null && order.subtotal !== "" ? Number(order.subtotal) : gross;
  const afterDisc = subtotal - discount;
  const orderGstRate = Number(order.gst_rate) || 0;
  const orderGst = Number(order.gst_amount) || Math.round(afterDisc * orderGstRate) / 100;
  const total = afterDisc + orderGst;
  const balance = total - deposit;
  const dateStr = order.created_at ? new Date(order.created_at).toLocaleDateString("en-MY") : new Date().toLocaleDateString("en-MY");

  const sig = signatureDataUrl || order.customer_signature || null;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sales Order ${esc(order.order_number || "")}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 8mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px; }
    .sheet { width: 100%; border: 1px solid #111; }
    .pad { padding: 6px 10px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #111; }
    .brand { display: flex; align-items: center; gap: 8px; }
    .logo { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg,#7C3AED,#a855f7,#f59e0b); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 900; font-size: 20px; }
    .bname { font-size: 18px; font-weight: 900; letter-spacing: 1px; line-height: 1; }
    .bname small { display:block; font-size: 8px; font-weight: 600; letter-spacing: 2px; color:#555; margin-top:2px; }
    .co { font-size: 9px; text-align: right; line-height: 1.3; }
    .co b { font-size: 10px; }
    .branches { font-size: 8px; color:#333; margin-top:2px; }
    .titlebar { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #111; background:#f5f5f5; }
    .title { font-size: 16px; font-weight: 900; letter-spacing: 1px; }
    .sono { font-size: 12px; font-weight: 800; }
    .sono b { color: #d6336c; font-size: 14px; }
    .cust td { padding: 3px 10px; vertical-align: top; font-size: 10px; }
    .cust .lbl { font-weight: 700; white-space: nowrap; width: 80px; }
    .cust .val { border-bottom: 1px dotted #999; }
    table.items { width: 100%; border-collapse: collapse; }
    table.items th { border-top: 1px solid #111; border-bottom: 1px solid #111; border-right: 1px solid #ccc; background:#f5f5f5; padding: 4px 6px; font-size: 9px; }
    table.items td { border-right: 1px solid #ccc; border-bottom: 1px solid #eee; padding: 3px 6px; height: 18px; font-size: 10px; }
    table.items td:last-child, table.items th:last-child { border-right: none; }
    .c { text-align: center; } .r { text-align: right; }
    .spec { font-size: 8px; color: #555; }
    .totbox { display: flex; border-top: 1px solid #111; }
    .totbox .left { flex: 1; border-right: 1px solid #111; padding: 5px 10px; font-size: 9px; }
    .totbox .right { width: 200px; }
    .totbox .right .trow { display: flex; justify-content: space-between; padding: 3px 10px; border-bottom: 1px solid #eee; font-size: 10px; }
    .totbox .right .trow.grand { font-weight: 900; font-size: 11px; background:#f5f5f5; }
    .notes { font-size: 8px; line-height: 1.4; border-top: 1px solid #111; }
    .notes h5 { margin: 0 0 2px; font-size: 9px; }
    .terms { font-size: 7.5px; line-height: 1.3; color:#222; border-top: 1px solid #111; }
    .terms ol { margin: 2px 0 0; padding-left: 14px; }
    .terms li { margin-bottom: 1px; }
    .ack { font-size: 8px; font-style: italic; margin-top: 3px; }
    .foot { display: flex; border-top: 1px solid #111; }
    .foot .col { flex: 1; padding: 5px 10px; display: flex; flex-direction: column; }
    .foot .col + .col { border-left: 1px solid #111; }
    .sigspace { flex: 1; display: flex; align-items: flex-end; justify-content: center; min-height: 50px; }
    .sigspace img { height: 40px; }
    .sigline { border-top: 1px solid #111; padding-top: 2px; text-align: center; font-size: 9px; margin-top: 4px; }
    @media print { body { margin: 0; } }
  </style></head><body>
    <div class="sheet">
      <div class="head pad">
        <div class="brand">
          <div class="logo">V</div>
          <div class="bname">V-HAUS LIVING<small>WE HOUSE YOUR HOUSE</small></div>
        </div>
        <div class="co">
          <b>${esc(COMPANY.name)}</b> ${esc(COMPANY.reg)}<br>
          ${esc(COMPANY.address)}<br>
          Hotline: ${esc(COMPANY.hotline)}
          <div class="branches">${esc(COMPANY.branches_display || "")}</div>
        </div>
      </div>
      <div class="titlebar pad">
        <div class="title">SALES ORDER</div>
        <div class="sono">NO: <b>${esc(order.order_number || "")}</b></div>
      </div>
      <table class="cust" style="width:100%;border-bottom:1px solid #111;border-collapse:collapse;">
        <tr><td class="lbl">NAME</td><td class="val">${esc(order.customer_name || "")}</td><td class="lbl">ORDER DATE</td><td class="val">${dateStr}</td></tr>
        <tr><td class="lbl">ADDRESS</td><td class="val" rowspan="2">${esc(order.customer_address || "")}</td><td class="lbl">DELIVERY DATE</td><td class="val">${esc(order.delivery_date || "")} ${esc(order.delivery_time_slot || "")}</td></tr>
        <tr><td class="lbl">SALES ASST</td><td class="val">${esc(order.salesman_name || "")}</td></tr>
        <tr><td class="lbl">H/P NO</td><td class="val">${esc(order.customer_contact || "")}</td><td class="lbl">TYPE</td><td class="val">${esc(order.delivery_type || "")}</td></tr>
      </table>
      <table class="items">
        <thead><tr><th style="width:28px">NO</th><th>DESCRIPTION</th><th style="width:36px">QTY</th><th style="width:70px">UNIT PRICE</th><th style="width:80px">AMOUNT (MYR)</th></tr></thead>
        <tbody>${itemRows.join("")}</tbody>
      </table>
      <div class="totbox">
        <div class="left"><b>REMARKS:</b><br>${esc(order.remark || order.notes || "")}</div>
        <div class="right">
          <div class="trow"><span>Subtotal</span><span>${money(subtotal)}</span></div>
          ${discount ? `<div class="trow"><span>Discount</span><span>-${money(discount)}</span></div>` : ""}
          ${orderGst ? `<div class="trow"><span>GST (${orderGstRate}%)</span><span>${money(orderGst)}</span></div>` : ""}
          <div class="trow grand"><span>TOTAL${orderGst ? " (incl. GST)" : ""}</span><span>${money(total)}</span></div>
          <div class="trow"><span>DEPOSIT</span><span>${money(deposit)}</span></div>
          <div class="trow grand"><span>BALANCE</span><span>${money(balance)}</span></div>
        </div>
      </div>
      <div class="notes pad">
        <h5>IMPORTANT NOTES</h5>
        - Full payment shall be made prior to delivery.<br>
        - Cheque: crossed "A/C Payee Only", payable to ${esc(COMPANY.name)}. Bank: ${esc(COMPANY.bank)}
      </div>
      <div class="terms pad">
        <h5>TERMS &amp; CONDITIONS</h5>
        <ol>${TERMS.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
        <div class="ack">I acknowledge and agree to abide by the conditions of sale stated above.</div>
      </div>
      <div class="foot">
        <div class="col">
          <b>PAYMENT METHOD:</b> ${esc(order.payment_method || "")}
          <div class="sigspace">${sig ? `<img src="${sig}" />` : ""}</div>
          <div class="sigline">Customer Signature</div>
        </div>
        <div class="col">
          <b>SALES ASSISTANT:</b> <i>${esc(order.salesman_name || "")}</i>
          <div class="sigspace"></div>
          <div class="sigline">Authorised Signature</div>
        </div>
      </div>
    </div>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups to print."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 350);
}

export default function OrdersPage() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [orders, setOrders] = useState([]);
  const [branches, setBranches] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [companyInfo, setCompanyInfo] = useState(DEFAULT_COMPANY);
  const [countries, setCountries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  // Order builder drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [form, setForm] = useState(EMPTY_ORDER);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Product picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [signOrder, setSignOrder] = useState(null);
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

  useEffect(() => {
    if (!companyId) return;
    fetch(`${API}/branches?company_id=${companyId}`).then(r => r.json()).then(d => setBranches(d.branches || []));
    fetch(`${API}/admin/users/list?company_id=${companyId}`).then(r => r.json()).then(d => {
      const names = (d || []).filter(u => u.salesman_name && u.is_active).map(u => u.salesman_name);
      setSalesmen([...new Set(names)].sort());
    });
    fetch(`${API}/company-settings?company_id=${companyId}`).then(r => r.json()).then(d => {
      if (d.settings && d.settings.company_name) {
        setCompanyInfo({
          name: d.settings.company_name || DEFAULT_COMPANY.name,
          reg: d.settings.registration_no || DEFAULT_COMPANY.reg,
          address: d.settings.address || DEFAULT_COMPANY.address,
          hotline: d.settings.hotline || DEFAULT_COMPANY.hotline,
          bank: d.settings.bank_account || DEFAULT_COMPANY.bank,
          branches_display: d.settings.branches_display || DEFAULT_COMPANY.branches_display,
        });
      }
      try {
        const list = JSON.parse(d.settings?.countries || "[]");
        if (Array.isArray(list) && list.length) setCountries(list);
      } catch {}
    });
  }, [companyId]);

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
    setEditingOrder(null);
    setForm({ ...EMPTY_ORDER, salesman_names: user?.salesman_name || "", branch_id: user?.branch_id || "" });
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (o) => {
    setEditId(o.id);
    setEditingOrder(o);
    setForm({
      customer_name: o.customer_name || "",
      customer_contact: o.customer_contact || "",
      customer_address: o.customer_address || "",
      status: o.status || "draft",
      notes: o.notes || "",
      delivery_type: o.delivery_type || "Delivery",
      delivery_date: o.delivery_date || "",
      delivery_time_slot: o.delivery_time_slot || "",
      remark: o.remark || "",
      discount: o.discount ?? "", deposit: o.deposit ?? "", payment_method: o.payment_method || "",
      branch_id: o.branch_id || "", salesman_names: o.salesman_name || "",
      country: o.country || "", gst_rate: o.gst_rate ?? 0,
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

  const subtotal = form.items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 1), 0);
  const discountVal = Number(form.discount) || 0;
  const depositVal = Number(form.deposit) || 0;
  const gstRate = Number(form.gst_rate) || 0;
  const afterDiscount = subtotal - discountVal;
  const gstAmount = Math.round(afterDiscount * gstRate) / 100;
  const totalAfterDiscount = afterDiscount + gstAmount;
  const balanceVal = totalAfterDiscount - depositVal;

  const saveOrder = async () => {
    if (!form.customer_name.trim()) { setFormError("Customer name is required"); return; }
    if (form.items.length === 0) { setFormError("Add at least one product"); return; }
    setSaving(true);
    setFormError("");
    const headers = await authHeaders();
    const body = {
      customer_name: form.customer_name, customer_contact: form.customer_contact || null,
      customer_address: form.customer_address || null, status: form.status, notes: form.notes || null,
      delivery_type: form.delivery_type, delivery_date: form.delivery_date || null,
      delivery_time_slot: form.delivery_time_slot || null, remark: form.remark || null,
      discount: form.discount === "" ? 0 : Number(form.discount),
      deposit: form.deposit === "" ? 0 : Number(form.deposit),
      payment_method: form.payment_method || null,
      branch_id: form.branch_id || null,
      salesman_names: form.salesman_names || null,
      country: form.country || null,
      gst_rate: gstRate, gst_amount: gstAmount,
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
    if (!editId && d.order) {
      setSignOrder(d.order);
    }
  };

  const saveSignature = async (orderId, sigData) => {
    if (!sigData || !orderId) return;
    const headers = await authHeaders();
    await fetch(`${API}/sales-orders/${orderId}/signature`, {
      method: "PATCH", headers, body: JSON.stringify({ signature: sigData }),
    });
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
                  {o.delivery_type ? ` · ${o.delivery_type}` : ""}
                  {o.delivery_date ? ` · 📅 ${o.delivery_date}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-gray-900">RM {Number(o.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <div className="flex items-center gap-1 mt-1 justify-end">
                  <button onClick={e => { e.stopPropagation(); setSignOrder(o); }}
                    className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-violet-100 hover:text-violet-700">🖨 Print</button>
                  <select value={o.status} onClick={e => e.stopPropagation()} onChange={e => changeStatus(o, e.target.value)}
                    className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-violet-400">
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
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
              <div className="flex items-center gap-2">
                {editId && (
                  <button onClick={() => setSignOrder({ ...editingOrder, ...form, items: form.items })}
                    className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-violet-100 hover:text-violet-700">🖨 Print</button>
                )}
                <button onClick={() => !saving && setDrawerOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
            </div>
            <div className="px-6 py-4 space-y-4">
              {formError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{formError}</div>}

              {/* Branch & Salesman */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Branch *</label>
                  <select value={form.branch_id} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                    <option value="">Select branch</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Sales Assistant(s)</label>
                  <div className="flex flex-wrap gap-1 mb-1 min-h-[24px]">
                    {(form.salesman_names || "").split("/").map(s => s.trim()).filter(Boolean).map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs">
                        {s}
                        <button type="button" onClick={() => {
                          const names = form.salesman_names.split("/").map(n => n.trim()).filter(Boolean).filter((_, j) => j !== i);
                          setForm(f => ({ ...f, salesman_names: names.join(" / ") }));
                        }} className="text-violet-400 hover:text-violet-700">×</button>
                      </span>
                    ))}
                    {!(form.salesman_names || "").trim() && <span className="text-xs text-gray-400">No salesman selected</span>}
                  </div>
                  <select value="" onChange={e => {
                    const val = e.target.value;
                    if (!val) return;
                    const current = (form.salesman_names || "").split("/").map(s => s.trim()).filter(Boolean);
                    if (!current.includes(val)) {
                      setForm(f => ({ ...f, salesman_names: [...current, val].join(" / ") }));
                    }
                  }} className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-xs bg-white focus:outline-none focus:border-violet-400">
                    <option value="">+ Add salesman</option>
                    {salesmen.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Customer info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Customer Name *" value={form.customer_name} onChange={v => setForm(f => ({ ...f, customer_name: v }))} />
                <Field label="Contact" value={form.customer_contact} onChange={v => setForm(f => ({ ...f, customer_contact: v }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Address" value={form.customer_address} onChange={v => setForm(f => ({ ...f, customer_address: v }))} />
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Country</label>
                  <select value={form.country} onChange={e => {
                    const c = countries.find(x => x.code === e.target.value);
                    setForm(f => ({ ...f, country: e.target.value, gst_rate: c?.gst_rate ?? 0 }));
                  }} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                    <option value="">Select country</option>
                    {countries.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code}){c.gst_rate ? ` — GST ${c.gst_rate}%` : ""}</option>)}
                  </select>
                </div>
              </div>

              {/* Delivery details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                  <select value={form.delivery_type} onChange={e => setForm(f => ({ ...f, delivery_type: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                    {DELIVERY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Delivery Date</label>
                  <input type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                </div>
                <Field label="Time Slot" value={form.delivery_time_slot} onChange={v => setForm(f => ({ ...f, delivery_time_slot: v }))} placeholder="e.g. 2-5pm" />
              </div>

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

              {/* Totals */}
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-medium text-gray-900">RM {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Discount (RM)" value={form.discount} onChange={v => setForm(f => ({ ...f, discount: v }))} />
                  <NumField label="Deposit (RM)" value={form.deposit} onChange={v => setForm(f => ({ ...f, deposit: v }))} />
                </div>
                {gstRate > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">GST ({gstRate}%)</span>
                    <span className="text-gray-700">{gstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Total{gstRate > 0 ? " (incl. GST)" : ""}</span>
                  <span className="font-bold text-gray-900">RM {totalAfterDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                  <span className="text-sm font-medium text-gray-500">Balance</span>
                  <span className="text-lg font-bold text-violet-700">RM {balanceVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Payment Method</label>
                <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                  <option value="">—</option>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
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
              <Field label="Remark" value={form.remark} onChange={v => setForm(f => ({ ...f, remark: v }))} />

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

      {signOrder && (
        <SignaturePad
          onDone={async (sig) => {
            if (sig && signOrder.id) await saveSignature(signOrder.id, sig);
            printSalesOrder(signOrder, sig, companyInfo);
            setSignOrder(null);
            loadOrders();
          }}
          onCancel={() => { printSalesOrder(signOrder, null, companyInfo); setSignOrder(null); }}
        />
      )}
    </div>
  );
}

function SignaturePad({ onDone, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => { drawing.current = false; };

  const clear = () => {
    const c = canvasRef.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  };

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const confirm = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    const hasContent = pixels.some((v, i) => i % 4 === 3 && v > 0);
    onDone(hasContent ? c.toDataURL("image/png") : null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
        <h3 className="text-lg font-bold text-gray-900">Customer Signature</h3>
        <p className="text-xs text-gray-500">Sign below with your finger or mouse</p>
        <canvas
          ref={canvasRef} width={400} height={160}
          className="w-full border border-gray-200 rounded-xl bg-gray-50 cursor-crosshair touch-none"
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        <div className="flex gap-2">
          <button onClick={clear} className="flex-1 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">Clear</button>
          <button onClick={onCancel} className="flex-1 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
          <button onClick={confirm} className="flex-1 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">Confirm & Print</button>
        </div>
      </div>
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
