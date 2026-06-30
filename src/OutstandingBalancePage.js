import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => {
  const token = await getToken();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};
const money = v => `RM ${(Number(v) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "due_today", label: "Due Today" },
  { id: "due_week", label: "Due This Week" },
  { id: "overdue", label: "Overdue" },
  { id: "high", label: "Above RM1,000" },
];

function agingBadge(days) {
  if (days <= 30) return { label: "Current", cls: "bg-emerald-100 text-emerald-700" };
  if (days <= 60) return { label: "Overdue", cls: "bg-amber-100 text-amber-700" };
  if (days <= 90) return { label: "Warning", cls: "bg-orange-100 text-orange-700" };
  return { label: "Critical", cls: "bg-red-100 text-red-700" };
}

export default function OutstandingBalancePage({ companyId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await af(`${API}/aging-report?company_id=${companyId}`);
      const d = await res.json();
      const all = Object.values(d.buckets || {}).flat();
      setOrders(all);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = orders;
    if (filter === "due_today") {
      const today = new Date().toISOString().slice(0, 10);
      list = list.filter(o => (o.delivery_date || "").slice(0, 10) === today);
    } else if (filter === "due_week") {
      const now = new Date(); const weekOut = new Date(now); weekOut.setDate(now.getDate() + 7);
      list = list.filter(o => {
        if (!o.delivery_date) return false;
        const d = new Date(o.delivery_date);
        return d >= now && d <= weekOut;
      });
    } else if (filter === "overdue") {
      list = list.filter(o => o.days_outstanding > 30);
    } else if (filter === "high") {
      list = list.filter(o => o.balance > 1000);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o => (o.so_number || "").toLowerCase().includes(q) || (o.customer_name || "").toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => b.days_outstanding - a.days_outstanding);
  }, [orders, filter, search]);

  const total = filtered.reduce((s, o) => s + (o.balance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Outstanding Balance</h1>
          <p className="text-sm text-gray-400 mt-0.5">{filtered.length} orders · {money(total)} total</p>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SO# or customer..."
          className="border rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-violet-300" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f.id ? "bg-violet-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No outstanding balances{filter !== "all" ? " for this filter" : ""}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">SO Number</th>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Order Amount</th>
                  <th className="px-4 py-2 font-medium">Balance</th>
                  <th className="px-4 py-2 font-medium">Delivery Date</th>
                  <th className="px-4 py-2 font-medium">Days Outstanding</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const badge = agingBadge(o.days_outstanding);
                  return (
                    <tr key={o.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-semibold text-violet-700">{o.so_number}</td>
                      <td className="px-4 py-2.5 text-gray-700">{o.customer_name}</td>
                      <td className="px-4 py-2.5 text-gray-500">{money(o.order_amount)}</td>
                      <td className="px-4 py-2.5 font-semibold text-red-600">{money(o.balance)}</td>
                      <td className="px-4 py-2.5 text-gray-500">{o.delivery_date ? new Date(o.delivery_date).toLocaleDateString("en-MY") : "-"}</td>
                      <td className="px-4 py-2.5 text-gray-500">{o.days_outstanding}d</td>
                      <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span></td>
                      <td className="px-4 py-2.5 text-right">
                        {o.contact && <a href={`tel:${o.contact}`} className="text-xs text-violet-600 hover:underline mr-2">Call</a>}
                        {o.contact && <a href={`https://wa.me/6${o.contact.replace(/[^0-9]/g, "").replace(/^0/, "")}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 hover:underline">WhatsApp</a>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
