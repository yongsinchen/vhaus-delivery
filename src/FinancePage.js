import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

const API = "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}` } }); };
const money = v => `RM ${(Number(v) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const AGING_STYLE = {
  current: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "Current", sub: "0-30 days" },
  "30_60": { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "Overdue", sub: "30-60 days" },
  "60_90": { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", label: "Warning", sub: "60-90 days" },
  "90_plus": { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "Critical", sub: "90+ days" },
};
const TABS = ["Overview", "Aging Detail", "Payments", "Collections", "Reconcile"];

export default function FinancePage() {
  const { user } = useAuth();
  const toast = useToast();
  const companyId = user?.company_id;
  const [tab, setTab] = useState(0);

  const [aging, setAging] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));

  // Reconciliation
  const [uploads, setUploads] = useState([]);
  const [activeUpload, setActiveUpload] = useState(null);
  const [recTxns, setRecTxns] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [orderSearch, setOrderSearch] = useState({});

  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [agingRes, payRes] = await Promise.all([
      af(`${API}/aging-report?company_id=${companyId}`),
      af(`${API}/payments?company_id=${companyId}&limit=500`),
    ]);
    const [agingData, payData] = await Promise.all([agingRes.json(), payRes.json()]);
    setAging(agingData);
    setPayments(payData.payments || []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadUploads = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/statements?company_id=${companyId}`);
    const d = await res.json();
    setUploads(d.uploads || []);
  }, [companyId]);

  const openUpload = async (u) => {
    const res = await af(`${API}/statements/${u.id}`);
    const d = await res.json();
    setActiveUpload(d.upload);
    setRecTxns(d.transactions || []);
  };

  const uploadStatement = async (file, type) => {
    setUploading(true);
    const token = await getToken();
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", type);
    const res = await fetch(`${API}/statements/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const d = await res.json();
    if (d.upload_id) { toast.success(`${d.total} transactions extracted, ${d.matched} auto-matched`); loadUploads(); openUpload({ id: d.upload_id }); }
    else toast.error(d.error || "Failed");
    setUploading(false);
  };

  const updateTxn = async (txnId, updates) => {
    await af(`${API}/statement-transactions/${txnId}`, { method: "PATCH", body: JSON.stringify(updates) });
    if (activeUpload) openUpload(activeUpload);
  };

  const reconcileAll = async () => {
    if (!activeUpload) return;
    setReconciling(true);
    const res = await af(`${API}/statements/${activeUpload.id}/reconcile`, { method: "POST" });
    const d = await res.json();
    toast.success(`${d.reconciled} payments recorded`);
    setReconciling(false);
    loadUploads(); openUpload(activeUpload); loadData();
  };

  const searchOrderForTxn = async (txnId, query) => {
    if (query.length < 2) return;
    const res = await af(`${API}/services?company_id=${companyId}`);
    const all = await res.json();
    const matches = (Array.isArray(all) ? all : []).filter(o => (o.so_number || "").toLowerCase().includes(query.toLowerCase()) || (o.customer_name || "").toLowerCase().includes(query.toLowerCase())).slice(0, 5);
    setOrderSearch(prev => ({ ...prev, [txnId]: matches }));
  };

  useEffect(() => { if (tab === 4) loadUploads(); }, [tab, loadUploads]);

  const filteredPayments = payments.filter(p => {
    const d = (p.paid_at || "").slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  });

  const totalCollected = filteredPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const byMethod = {};
  filteredPayments.forEach(p => { const m = p.payment_method || "Other"; byMethod[m] = (byMethod[m] || 0) + (Number(p.amount) || 0); });

  // Daily collection summary
  const byDate = {};
  filteredPayments.forEach(p => { const d = (p.paid_at || "").slice(0, 10); if (!byDate[d]) byDate[d] = { total: 0, count: 0 }; byDate[d].total += Number(p.amount) || 0; byDate[d].count++; });
  const dailySorted = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]));

  const printAging = () => {
    if (!aging) return;
    const rows = ["90_plus", "60_90", "30_60", "current"].flatMap(bucket =>
      (aging.buckets?.[bucket] || []).map(o => `<tr><td style="border:1px solid #ddd;padding:4px 8px">${o.so_number}</td><td style="border:1px solid #ddd;padding:4px 8px">${o.customer_name}</td><td style="border:1px solid #ddd;padding:4px 8px">${o.contact || ""}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center">${o.days_outstanding}d</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right;font-weight:700">${money(o.balance)}</td><td style="border:1px solid #ddd;padding:4px 8px">${AGING_STYLE[bucket]?.label || bucket}</td></tr>`)
    ).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aging Report</title><style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;font-size:11px;padding:10px}table{border-collapse:collapse;width:100%}th{background:#7C3AED;color:#fff;padding:6px 8px;text-align:left}</style></head><body><h2>Accounts Receivable Aging Report</h2><p style="color:#666">${new Date().toLocaleDateString("en-MY")} · Total: ${money(aging.summary?.total)} · ${aging.summary?.order_count} orders</p><table><thead><tr><th>SO</th><th>Customer</th><th>Contact</th><th>Days</th><th style="text-align:right">Balance</th><th>Bucket</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Finance</h1>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors whitespace-nowrap ${tab === i ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-700 hover:bg-violet-50"}`}>{t}</button>
        ))}
      </div>

      {loading && <div className="space-y-3"><div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{[1,2,3,4,5].map(i=><div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div><div className="grid grid-cols-3 gap-3">{[1,2,3].map(i=><div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div></div>}

      {/* TAB 0: Overview */}
      {!loading && tab === 0 && aging && (
        <div className="space-y-4">
          {/* AR Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(AGING_STYLE).map(([key, style]) => (
              <div key={key} className={`${style.bg} border ${style.border} rounded-2xl p-4`}>
                <p className={`text-xs font-medium ${style.text}`}>{style.label}</p>
                <p className={`text-lg font-bold ${style.text} mt-1`}>{money(aging.summary?.[key] || 0)}</p>
                <p className="text-xs text-gray-400">{style.sub} · {(aging.buckets?.[key] || []).length} orders</p>
              </div>
            ))}
            <div className="bg-gray-900 rounded-2xl p-4 text-white">
              <p className="text-xs text-gray-400">Total AR</p>
              <p className="text-xl font-bold mt-1">{money(aging.summary?.total || 0)}</p>
              <p className="text-xs text-gray-400">{aging.summary?.order_count || 0} outstanding</p>
            </div>
          </div>

          {/* This month collections */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <p className="text-xs text-emerald-600">Collections This Period</p>
              <p className="text-xl font-bold text-emerald-700 mt-1">{money(totalCollected)}</p>
              <p className="text-xs text-gray-400">{filteredPayments.length} payments</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500">By Method</p>
              <div className="mt-2 space-y-1">
                {Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([m, amt]) => (
                  <div key={m} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700">{m}</span>
                    <span className="font-medium text-gray-900">{money(amt)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500">Top Overdue</p>
              <div className="mt-2 space-y-1">
                {(aging.buckets?.["90_plus"] || []).slice(0, 5).map(o => (
                  <div key={o.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 truncate">{o.customer_name}</span>
                    <span className="font-medium text-red-600 flex-shrink-0">{money(o.balance)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: Aging Detail */}
      {!loading && tab === 1 && aging && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={printAging} className="px-4 py-2 rounded-xl text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">🖨 Print Report</button>
          </div>
          {["90_plus", "60_90", "30_60", "current"].map(bucket => {
            const items = aging.buckets?.[bucket] || [];
            if (items.length === 0) return null;
            const style = AGING_STYLE[bucket];
            return (
              <div key={bucket}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-sm font-bold ${style.text}`}>{style.label}</span>
                  <span className="text-xs text-gray-400">{style.sub} · {items.length} orders · {money(items.reduce((s, o) => s + o.balance, 0))}</span>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-xs text-gray-500"><th className="px-4 py-2 text-left">SO</th><th className="px-4 py-2 text-left">Customer</th><th className="px-4 py-2 text-left">Contact</th><th className="px-4 py-2 text-center">Days</th><th className="px-4 py-2 text-right">Balance</th></tr></thead>
                    <tbody>
                      {items.sort((a, b) => b.balance - a.balance).map(o => (
                        <tr key={o.id} className="border-t border-gray-50">
                          <td className="px-4 py-2 font-bold text-violet-700">{o.so_number}</td>
                          <td className="px-4 py-2 text-gray-800">{o.customer_name}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{o.contact || "-"}</td>
                          <td className="px-4 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>{o.days_outstanding}d</span></td>
                          <td className={`px-4 py-2 text-right font-bold ${style.text}`}>{money(o.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: Payments */}
      {!loading && tab === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <span className="text-gray-400">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <span className="text-xs text-gray-500">{filteredPayments.length} payments · {money(totalCollected)}</span>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-xs text-gray-500"><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Method</th><th className="px-4 py-2 text-left">Reference</th><th className="px-4 py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {filteredPayments.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No payments in this period</td></tr>}
                {filteredPayments.map(p => (
                  <tr key={p.id} className="border-t border-gray-50">
                    <td className="px-4 py-2 text-gray-700">{p.paid_at ? new Date(p.paid_at).toLocaleDateString("en-MY") : "-"}</td>
                    <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{p.payment_method || "Cash"}</span></td>
                    <td className="px-4 py-2 text-xs text-gray-500">{p.reference_no || "-"}</td>
                    <td className="px-4 py-2 text-right font-bold text-emerald-700">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Daily Collections */}
      {!loading && tab === 3 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <span className="text-gray-400">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <span className="text-xs text-gray-500">Total: {money(totalCollected)}</span>
          </div>
          <div className="space-y-2">
            {dailySorted.length === 0 && <div className="text-center py-8 text-gray-400">No collections in this period</div>}
            {dailySorted.map(([date, data]) => (
              <div key={date} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-900">{new Date(date + "T00:00").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" })}</p>
                  <p className="text-xs text-gray-500">{data.count} payment{data.count !== 1 ? "s" : ""}</p>
                </div>
                <p className="text-lg font-bold text-emerald-700">{money(data.total)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: Reconcile */}
      {tab === 4 && (
        <div className="space-y-4">
          {/* Upload buttons */}
          <div className="flex gap-3 flex-wrap">
            <label className={`px-4 py-2 rounded-xl text-sm font-medium cursor-pointer ${uploading ? "bg-gray-200 text-gray-400" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
              {uploading ? "Processing..." : "📄 Upload Bank Statement"}
              <input type="file" accept=".csv,.xlsx,.xls,.pdf,image/*" className="hidden" disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadStatement(f, "bank"); e.target.value = ""; }} />
            </label>
            <label className={`px-4 py-2 rounded-xl text-sm font-medium cursor-pointer ${uploading ? "bg-gray-200 text-gray-400" : "bg-violet-600 text-white hover:bg-violet-700"}`}>
              {uploading ? "Processing..." : "💳 Upload Card Statement"}
              <input type="file" accept=".csv,.xlsx,.xls,.pdf,image/*" className="hidden" disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadStatement(f, "card"); e.target.value = ""; }} />
            </label>
          </div>

          {/* Past uploads */}
          {uploads.length > 0 && !activeUpload && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-gray-700">Statement History</h3>
              {uploads.map(u => (
                <div key={u.id} onClick={() => openUpload(u)}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:border-violet-200 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{u.filename}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.type === "card" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>{u.type}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.status === "reconciled" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{u.status}</span>
                    </div>
                    <p className="text-xs text-gray-500">{u.total_transactions} transactions · {u.matched_count} matched · {new Date(u.created_at).toLocaleDateString("en-MY")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Active upload review */}
          {activeUpload && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">{activeUpload.filename}</h3>
                  <p className="text-xs text-gray-500">{recTxns.length} transactions</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setActiveUpload(null); setRecTxns([]); }} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">← Back</button>
                  {recTxns.some(t => t.match_status === "auto_matched" || t.match_status === "confirmed") && (
                    <button onClick={reconcileAll} disabled={reconciling}
                      className="text-xs px-4 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                      {reconciling ? "Recording..." : `✓ Reconcile ${recTxns.filter(t => t.match_status === "auto_matched" || t.match_status === "confirmed").length} Matches`}
                    </button>
                  )}
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 text-center">
                  <p className="text-xs text-emerald-600">Matched</p>
                  <p className="text-lg font-bold text-emerald-700">{recTxns.filter(t => ["auto_matched", "confirmed"].includes(t.match_status)).length}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 text-center">
                  <p className="text-xs text-amber-600">Unmatched</p>
                  <p className="text-lg font-bold text-amber-700">{recTxns.filter(t => t.match_status === "unmatched").length}</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-2 text-center">
                  <p className="text-xs text-blue-600">Reconciled</p>
                  <p className="text-lg font-bold text-blue-700">{recTxns.filter(t => t.match_status === "reconciled").length}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-2 text-center">
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-lg font-bold text-gray-700">{money(recTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0))}</p>
                </div>
              </div>

              {/* Transaction list */}
              <div className="space-y-2">
                {recTxns.map(txn => (
                  <div key={txn.id} className={`bg-white rounded-xl border p-3 ${txn.match_status === "reconciled" ? "border-emerald-200 opacity-50" : txn.match_status === "auto_matched" || txn.match_status === "confirmed" ? "border-emerald-200" : "border-amber-200"}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{money(txn.amount)}</p>
                        <p className="text-xs text-gray-500">{txn.transaction_date || ""} {txn.reference ? `· Ref: ${txn.reference}` : ""}</p>
                        {txn.description && <p className="text-xs text-gray-400 truncate max-w-xs">{txn.description}</p>}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                        txn.match_status === "reconciled" ? "bg-emerald-100 text-emerald-700" :
                        txn.match_status === "auto_matched" ? "bg-emerald-100 text-emerald-700" :
                        txn.match_status === "confirmed" ? "bg-blue-100 text-blue-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>{txn.match_status}</span>
                    </div>

                    {/* Matched order */}
                    {txn._order && (
                      <div className="bg-emerald-50 rounded-lg px-3 py-1.5 flex items-center justify-between mt-1">
                        <span className="text-xs text-emerald-800"><b>{txn._order.so_number}</b> — {txn._order.customer_name} (Bal: {money(txn._order.balance)})</span>
                        {txn.match_status === "auto_matched" && (
                          <div className="flex gap-1">
                            <button onClick={() => updateTxn(txn.id, { match_status: "confirmed" })} className="text-xs px-2 py-0.5 rounded bg-emerald-600 text-white">✓</button>
                            <button onClick={() => updateTxn(txn.id, { match_status: "unmatched", matched_order_id: null })} className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600">✗</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Manual match for unmatched */}
                    {txn.match_status === "unmatched" && (
                      <div className="mt-2">
                        <input placeholder="Search SO # or customer..." onChange={e => searchOrderForTxn(txn.id, e.target.value)}
                          className="w-full px-2 py-1 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                        {(orderSearch[txn.id] || []).length > 0 && (
                          <div className="border border-gray-200 rounded-lg mt-1 max-h-24 overflow-y-auto">
                            {orderSearch[txn.id].map(o => (
                              <button key={o.id} onClick={() => { updateTxn(txn.id, { matched_order_id: o.id, match_status: "confirmed" }); setOrderSearch(prev => ({ ...prev, [txn.id]: [] })); }}
                                className="w-full text-left px-2 py-1 text-xs hover:bg-violet-50">
                                <b className="text-violet-700">{o.so_number}</b> {o.customer_name} — Bal: {money(o.balance)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
