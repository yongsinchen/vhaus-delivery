import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };
const money = v => `RM ${(Number(v) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const todayStr = () => new Date().toISOString().slice(0, 10);

function StatCard({ label, value, sub, tone = "violet" }) {
  const tones = { violet: "text-violet-700", emerald: "text-emerald-700", amber: "text-amber-700", red: "text-red-600", gray: "text-gray-800" };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs text-gray-400 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function PerformancePage() {
  const toast = useToast();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayStr());
  const [branchId, setBranchId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (branchId) params.set("branch_id", branchId);
      const res = await af(`${API}/branch-performance?${params}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to load");
      setData(d);
      if (!branchId && d.branch?.id) setBranchId(d.branch.id);
    } catch (e) { toast.error(e.message || "Failed to load performance"); setData(null); }
    setLoading(false);
  }, [from, to, branchId, toast]);
  useEffect(() => { load(); }, [load]);

  const exportExcel = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Orders");
      ws.mergeCells("A1:H1");
      ws.getCell("A1").value = `${data.branch?.name || "Branch"} — Orders ${data.period?.from} to ${data.period?.to}`;
      ws.getCell("A1").font = { bold: true, size: 13 };
      const headRow = 3;
      const heads = ["SO #", "Order Date", "Customer", "Salesman", "Status", "Amount (RM)", "Deposit (RM)", "Balance (RM)"];
      heads.forEach((h, i) => { const c = ws.getCell(headRow, i + 1); c.value = h; c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } }; });
      (data.orders || []).forEach((o, i) => {
        const r = headRow + 1 + i;
        ws.getCell(r, 1).value = o.so_number || "";
        ws.getCell(r, 2).value = o.order_date || "";
        ws.getCell(r, 3).value = o.customer_name || "";
        ws.getCell(r, 4).value = o.salesman || "";
        ws.getCell(r, 5).value = o.status || "";
        ws.getCell(r, 6).value = Number(o.order_amount) || 0;
        ws.getCell(r, 7).value = o.deposit != null ? Number(o.deposit) : "";
        ws.getCell(r, 8).value = Number(o.balance) || 0;
      });
      ws.columns = [{ width: 12 }, { width: 12 }, { width: 26 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }];
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(data.branch?.name || "branch").replace(/[^\w.-]+/g, "_")}-orders-${data.period?.from}_${data.period?.to}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error("Export failed: " + (e.message || "")); }
    setExporting(false);
  };

  const m = data?.metrics || {};

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Branch Performance</h1>
          <p className="text-sm text-gray-400 mt-1">{data?.is_master ? "Sales, orders and collections by branch." : "Your branch's sales, orders and collections."}</p>
        </div>
        <button onClick={exportExcel} disabled={exporting || !data} className="px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
          {exporting ? "Exporting…" : "📊 Export orders (Excel)"}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-2">
        {data?.is_master && (data.branches || []).length > 0 && (
          <select value={branchId} onChange={e => setBranchId(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
            {(data.branches || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <label className="text-xs text-gray-500 flex items-center gap-1">From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="text-xs text-gray-500 flex items-center gap-1">To
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" /></label>
        {!data?.is_master && data?.branch && <span className="text-sm font-semibold text-violet-700 ml-1">{data.branch.name}</span>}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{[1,2,3,4,5,6].map(i => <div key={i} className="h-20 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>
      ) : !data ? (
        <p className="text-sm text-gray-400">No data.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total sales (legit)" value={money(m.total_sales)} sub={`${m.legit_order_count} legit orders`} tone="violet" />
            <StatCard label="Total orders" value={m.total_order_count} sub={`${m.pending_deposit_count} pending deposit`} tone="gray" />
            <StatCard label="Collected (period)" value={money(m.collected)} tone="emerald" />
            <StatCard label="Outstanding" value={money(m.outstanding)} tone="red" />
            <StatCard label="Legit orders" value={m.legit_order_count} tone="violet" />
            <StatCard label="Pending deposit" value={m.pending_deposit_count} sub="confirmed, no deposit yet" tone="amber" />
          </div>

          {/* Per-salesman breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-bold text-gray-700">By salesman <span className="text-xs font-normal text-gray-400">· split orders share the amount</span></h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-xs text-gray-500 text-left"><th className="px-4 py-2">Salesman</th><th className="px-4 py-2 text-right">Legit orders</th><th className="px-4 py-2 text-right">Sales</th></tr></thead>
                <tbody>
                  {(data.salesmen || []).length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No sales in this period.</td></tr>}
                  {(data.salesmen || []).map(s => (
                    <tr key={s.name} className="border-t border-gray-50">
                      <td className="px-4 py-2 text-gray-800">{s.name}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{s.orders}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">{money(s.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Order list preview */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-700">Orders <span className="text-gray-400 font-normal">({(data.orders || []).length})</span></h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-xs text-gray-500 text-left">
                  <th className="px-4 py-2">SO #</th><th className="px-4 py-2">Date</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Salesman</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Balance</th>
                </tr></thead>
                <tbody>
                  {(data.orders || []).slice(0, 200).map((o, i) => (
                    <tr key={`${o.so_number}-${i}`} className="border-t border-gray-50">
                      <td className="px-4 py-2 font-medium text-violet-700">{o.so_number}{!o.legit && <span className="ml-1 text-[10px] text-amber-600">(no deposit)</span>}</td>
                      <td className="px-4 py-2 text-gray-500">{o.order_date}</td>
                      <td className="px-4 py-2 text-gray-700">{o.customer_name}</td>
                      <td className="px-4 py-2 text-gray-500">{o.salesman}</td>
                      <td className="px-4 py-2 text-gray-500">{o.status}</td>
                      <td className="px-4 py-2 text-right text-gray-800">{money(o.order_amount)}</td>
                      <td className="px-4 py-2 text-right text-red-600">{money(o.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(data.orders || []).length > 200 && <p className="px-4 py-2 text-xs text-gray-400">Showing first 200 — export for the full list.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
