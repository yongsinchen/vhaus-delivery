import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast, useLoading } from "./UIComponents";

const API = "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };
const money = v => `RM ${(Number(v) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

const ALL_TABS = ["Payout", "All Commissions", "Rules", "Product Incentives", "Holds"];
const STATUS_STYLE = { pending: "bg-gray-100 text-gray-600", eligible: "bg-emerald-100 text-emerald-700", held: "bg-red-100 text-red-600", paid: "bg-blue-100 text-blue-700" };

// Explain why a commission hasn't been paid yet, so salesmen never have to wonder.
function commissionReason(c) {
  if (c.status === "paid") return null;
  if (c.status === "held") {
    const hold = (c.wrong_item_holds || c._holds || []).find(h => h.status === "held") || (c.wrong_item_holds || c._holds || [])[0];
    const reasons = { wrong_item: "Wrong Item Hold", cancelled: "Cancelled Order" };
    return hold ? (reasons[hold.hold_reason] || `Held: ${hold.hold_reason || "under review"}`) : "Wrong Item Hold";
  }
  if (c.orders?.status === "Cancelled") return "Cancelled Order";
  if (c.status === "pending") {
    if (!c.deposit_met) return "Waiting for Deposit";
    return "Pending Approval";
  }
  if (c.status === "eligible") {
    if (c.orders?.balance > 0) return "Eligible — awaiting balance collection before payout";
    return null;
  }
  return null;
}

export default function CommissionPage() {
  const { user, activeCompanyId, activeRoleKey } = useAuth();
  const toast = useToast();
  const { withLoading } = useLoading();
  const companyId = activeCompanyId || user?.company_id;
  const effectiveRole = (activeRoleKey || user?.role || "").toLowerCase();
  const isSalesman = effectiveRole === "salesman";
  // Salesmen see only their own payout/history — Rules, Product Incentives, and
  // Holds are admin-only actions that affect everyone's commission, not personal views.
  const TABS = isSalesman ? ["Payout", "All Commissions"] : ALL_TABS;
  const [tab, setTab] = useState(0);

  const [payout, setPayout] = useState(null);
  const [payoutMonth, setPayoutMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; });
  const [commissions, setCommissions] = useState([]);
  const [rules, setRules] = useState([]);
  const [holds, setHolds] = useState([]); // eslint-disable-line
  const [incentives, setIncentives] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [incForm, setIncForm] = useState({ product_name: "", product_code: "", incentive_amount: "", start_date: "", end_date: "" });
  const [showIncForm, setShowIncForm] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState([]);
  const [channels, setChannels] = useState(["branch"]);
  const [loading, setLoading] = useState(true);

  // Rule form
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ role_name: "salesman", tier_name: "", min_net: 0, max_net: "", rate_pct: 3, incentive_pct: 0, deposit_gate_pct: 30, payout_day: 25, user_id: "", channel: "branch" });

  const loadPayout = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/commission-payout?company_id=${companyId}&payout_month=${payoutMonth}`);
    const d = await res.json();
    setPayout(d);
  }, [companyId, payoutMonth]);

  const loadCommissions = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const res = await af(`${API}/commissions?company_id=${companyId}`);
    const d = await res.json();
    setCommissions(d.commissions || []);
    setLoading(false);
  }, [companyId]);

  const loadRules = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/commission-rules?company_id=${companyId}`);
    const d = await res.json();
    setRules(d.rules || []);
  }, [companyId]);

  const loadIncentives = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/product-incentives?company_id=${companyId}`);
    const d = await res.json();
    setIncentives(d.incentives || []);
  }, [companyId]);

  useEffect(() => { if (tab === 0) loadPayout(); }, [tab, loadPayout]);
  useEffect(() => { if (tab === 1) loadCommissions(); }, [tab, loadCommissions]);
  useEffect(() => { if (tab === 2) {
    loadRules();
    af(`${API}/salesman-names?company_id=${companyId}`).then(r=>r.json()).then(d => setSalesmen(d.salesmen || []));
    af(`${API}/company-settings?company_id=${companyId}`).then(r=>r.json()).then(d => { try { const ch = JSON.parse(d.settings?.sales_channels || '["branch"]'); if (Array.isArray(ch)) setChannels(ch); } catch {} });
  } }, [tab, loadRules, companyId]);
  useEffect(() => { if (tab === 3) loadIncentives(); }, [tab, loadIncentives]);

  const saveRule = async () => {
    try {
      await withLoading("Saving rule…", async () => {
        const payload = { ...ruleForm };
        if (!payload.user_id) delete payload.user_id;
        const res = await af(`${API}/commission-rules`, { method: "POST", body: JSON.stringify(payload) });
        const d = await res.json();
        if (!d.rule) throw new Error(d.error || "Failed");
        toast.success("Rule created"); setShowRuleForm(false); loadRules();
      });
    } catch (e) { toast.error(e.message); }
  };

  const saveIncentive = async () => {
    try {
      await withLoading("Saving incentive…", async () => {
        const res = await af(`${API}/product-incentives`, { method: "POST", body: JSON.stringify(incForm) });
        const d = await res.json();
        if (!d.incentive) throw new Error(d.error || "Failed");
        toast.success("Incentive added"); setShowIncForm(false); setIncForm({ product_name: "", product_code: "", incentive_amount: "", start_date: "", end_date: "" }); loadIncentives();
      });
    } catch (e) { toast.error(e.message); }
  };

  const deleteIncentive = async (id) => {
    try {
      await withLoading("Removing incentive…", async () => {
        await af(`${API}/product-incentives/${id}`, { method: "DELETE" });
        toast.success("Removed"); loadIncentives();
      });
    } catch (e) { toast.error("Failed to remove: " + e.message); }
  };

  const searchProducts = async (q) => {
    setProductSearch(q);
    if (q.length < 2) { setProductResults([]); return; }
    const res = await af(`${API}/products?company_id=${companyId}&search=${encodeURIComponent(q)}&limit=10`);
    const d = await res.json();
    setProductResults(d.products || []);
  };

  const deleteRule = async (id) => {
    try {
      await withLoading("Deactivating rule…", async () => {
        await af(`${API}/commission-rules/${id}`, { method: "DELETE" });
        toast.success("Rule deactivated"); loadRules();
      });
    } catch (e) { toast.error("Failed: " + e.message); }
  };

  const addAdjustment = async (commId) => {
    const amount = window.prompt("Adjustment amount (negative for clawback):");
    if (!amount) return;
    const reason = window.prompt("Reason:") || "";
    try {
      await withLoading("Recording adjustment…", async () => {
        await af(`${API}/commission-adjustments`, { method: "POST", body: JSON.stringify({ commission_id: commId, delta_amt: Number(amount), reason, adjustment_type: Number(amount) < 0 ? "clawback" : "bonus" }) });
        toast.success("Adjustment recorded"); loadCommissions(); loadPayout();
      });
    } catch (e) { toast.error("Failed: " + e.message); }
  };

  const addHold = async (commId) => {
    try {
      await withLoading("Holding commission…", async () => {
        await af(`${API}/wrong-item-holds`, { method: "POST", body: JSON.stringify({ commission_id: commId }) });
        toast.warning("Commission held"); loadCommissions(); loadPayout();
      });
    } catch (e) { toast.error("Failed: " + e.message); }
  };

  const releaseHold = async (holdId) => {
    try {
      await withLoading("Releasing hold…", async () => {
        await af(`${API}/wrong-item-holds/${holdId}`, { method: "PATCH", body: JSON.stringify({ status: "released" }) });
        toast.success("Hold released"); loadCommissions(); loadPayout();
      });
    } catch (e) { toast.error("Failed: " + e.message); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Commissions</h1>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <button key={t} onClick={() => setTab(i)} className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors whitespace-nowrap ${tab === i ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-700 hover:bg-violet-50"}`}>{t}</button>)}
      </div>

      {/* TAB 0: Payout */}
      {tab === 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="month" value={payoutMonth.slice(0, 7)} onChange={e => setPayoutMonth(e.target.value + "-01")} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <button onClick={loadPayout} className="px-4 py-2 rounded-xl text-sm bg-violet-600 text-white hover:bg-violet-700">Refresh</button>
            {payout && (payout.users || []).length > 0 && (
              <button onClick={() => {
                const rows = (payout.users || []).flatMap(u => {
                  const eligible = u.commissions.filter(c => c.status === "eligible");
                  const pending = u.commissions.filter(c => c.status === "pending");
                  const adjTotal = u.adjustments.reduce((s, a) => s + (Number(a.delta_amt) || 0), 0);
                  const holdTotal = u.holds.filter(h => h.status === "held").reduce((s, h) => s + (Number(h.held_amt) || 0), 0);
                  return [`<tr style="background:#f3f0ff"><td colspan="6" style="border:1px solid #ddd;padding:6px 8px;font-weight:700">${u.name} <span style="font-weight:400;color:#666">(${u.role})</span></td><td style="border:1px solid #ddd;padding:6px 8px;font-weight:700;text-align:right">${money(u.total)}</td></tr>`,
                    ...eligible.map(c => `<tr><td style="border:1px solid #ddd;padding:4px 8px">${c.orders?.so_number || ""}</td><td style="border:1px solid #ddd;padding:4px 8px">${c.orders?.customer_name || ""}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center">${c.rate_pct}%</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right">${money(c.net_amount)}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center;color:green">Eligible</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center">${c.deposit_met ? "✓" : "✗"}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right;font-weight:600">${money(c.commission_amt)}</td></tr>`),
                    ...pending.map(c => `<tr style="opacity:0.5"><td style="border:1px solid #ddd;padding:4px 8px">${c.orders?.so_number || ""}</td><td style="border:1px solid #ddd;padding:4px 8px">${c.orders?.customer_name || ""}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center">${c.rate_pct}%</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right">${money(c.net_amount)}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center;color:orange">Pending</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center;color:red">✗ &lt;30%</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right">${money(c.commission_amt)}</td></tr>`),
                    ...(adjTotal !== 0 ? [`<tr style="background:#fef3c7"><td colspan="5" style="border:1px solid #ddd;padding:4px 8px;color:#92400e">Adjustments</td><td></td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right;font-weight:600;color:${adjTotal >= 0 ? "green" : "red"}">${money(adjTotal)}</td></tr>`] : []),
                    ...(holdTotal > 0 ? [`<tr style="background:#fee2e2"><td colspan="5" style="border:1px solid #ddd;padding:4px 8px;color:#991b1b">Wrong-item Holds</td><td></td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right;font-weight:600;color:red">-${money(holdTotal)}</td></tr>`] : []),
                  ];
                });
                const w = window.open("", "_blank"); if (!w) return;
                w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Commission Payout</title><style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;font-size:11px;padding:10px}table{border-collapse:collapse;width:100%}th{background:#7C3AED;color:#fff;padding:6px 8px;text-align:left;font-size:10px}</style></head><body><h2>Commission Payout Report</h2><p style="color:#666">Month: ${payoutMonth.slice(0,7)} · Total: ${money(payout.total)} · ${(payout.users||[]).length} person(s)</p><table><thead><tr><th>SO</th><th>Customer</th><th>Rate</th><th style="text-align:right">Net</th><th>Status</th><th>Deposit</th><th style="text-align:right">Commission</th></tr></thead><tbody>${rows.join("")}</tbody></table><p style="text-align:right;font-size:14px;font-weight:700;margin-top:12px">Total Payout: ${money(payout.total)}</p></body></html>`);
                w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
              }} className="px-4 py-2 rounded-xl text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">🖨 Print Report</button>
            )}
            {payout && <span className="text-sm font-bold text-gray-700">Total Payout: {money(payout.total)}</span>}
          </div>

          {payout && (payout.users || []).length === 0 && <div className="text-center py-8 text-gray-400">No commissions for this month. Set up rules and click "Recalculate All" in the All Commissions tab.</div>}

          {payout && (payout.users || []).map(u => {
            const eligible = u.commissions.filter(c => c.status === "eligible" || c.status === "paid");
            const pending = u.commissions.filter(c => c.status === "pending");
            // eslint-disable-next-line no-unused-vars
            const held = u.commissions.filter(c => c.status === "held");
            const pendingTotal = pending.reduce((s, c) => s + (Number(c.commission_amt) || 0), 0);
            return (
            <div key={u.user_id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-bold text-gray-900 text-lg">{u.name}</p>
                  <p className="text-xs text-gray-500">{u.role} · {u.commissions.length} order(s)</p>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold ${u.total >= 0 ? "text-emerald-700" : "text-red-600"}`}>{money(u.total)}</p>
                  {pending.length > 0 && <p className="text-xs text-amber-600">+ {money(pendingTotal)} pending deposit</p>}
                </div>
              </div>

              {/* Eligible commissions */}
              {eligible.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-bold text-emerald-600 mb-1">ELIGIBLE ({eligible.length})</p>
                  {eligible.map(c => (
                    <div key={c.id} className="flex items-center justify-between text-xs py-1.5 border-t border-gray-50">
                      <div>
                        <span className="font-bold text-violet-700">{c.orders?.so_number || "?"}</span>
                        <span className="text-gray-500 ml-2">{c.orders?.customer_name || ""}</span>
                        {c.orders?.order_amount && <span className="text-gray-400 ml-1">({money(c.orders.order_amount)})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">{c.rate_pct}%{c.incentive_pct > 0 ? ` +RM${Math.round(Number(c.net_amount) * Number(c.incentive_pct) / 100)}` : ""}</span>
                        <span className="font-bold text-emerald-700">{money(c.commission_amt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pending commissions */}
              {pending.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-bold text-amber-600 mb-1">PENDING DEPOSIT &lt; 30% ({pending.length})</p>
                  {pending.map(c => (
                    <div key={c.id} className="text-xs py-1.5 border-t border-gray-50 opacity-80">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-violet-700">{c.orders?.so_number || "?"}</span>
                          <span className="text-gray-500 ml-2">{c.orders?.customer_name || ""}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-amber-600">⏳ {c.rate_pct}%</span>
                          <span className="text-gray-400">{money(c.commission_amt)}</span>
                        </div>
                      </div>
                      <p className="text-amber-600 mt-0.5">{commissionReason(c)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Adjustments */}
              {u.adjustments.length > 0 && u.adjustments.map(a => (
                <div key={a.id} className="flex items-center justify-between text-xs py-1 border-t border-gray-50 bg-amber-50 px-2 rounded">
                  <span className="text-amber-700">Adjustment: {a.reason || a.adjustment_type}</span>
                  <span className={`font-bold ${Number(a.delta_amt) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{money(a.delta_amt)}</span>
                </div>
              ))}
              {u.holds.filter(h => h.status === "held").length > 0 && (
                <div className="text-xs text-red-600 py-1 border-t border-gray-50">
                  <p className="font-medium">🔒 {u.holds.filter(h => h.status === "held").length} hold(s) — {money(u.holds.filter(h => h.status === "held").reduce((s, h) => s + Number(h.held_amt), 0))} withheld</p>
                  {u.holds.filter(h => h.status === "held").map(h => (
                    <p key={h.id} className="text-red-500">{h.hold_reason === "wrong_item" ? "Wrong Item Hold" : h.hold_reason === "cancelled" ? "Cancelled Order" : `Held: ${h.hold_reason || "under review"}`}</p>
                  ))}
                </div>
              )}
            </div>
          ); })}
        </div>
      )}

      {/* TAB 1: All Commissions */}
      {tab === 1 && (
        <div className="space-y-2">
          {!isSalesman && (
            <div className="flex gap-2 mb-2">
              <button onClick={async () => {
                try {
                  await withLoading("Recalculating all commissions… this may take a moment", async () => {
                    const res = await af(`${API}/commissions/recalculate-all`, { method: "POST" });
                    const d = await res.json();
                    toast.success(`${d.calculated}/${d.total} orders calculated`);
                    loadCommissions();
                  });
                } catch (e) { toast.error("Recalculation failed: " + e.message); }
              }} className="px-4 py-2 rounded-xl text-sm bg-violet-600 text-white hover:bg-violet-700">🔄 Recalculate All Orders</button>
            </div>
          )}
          {loading && <div className="space-y-2">{[1,2,3,4].map(i=><div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}
          {!loading && commissions.length === 0 && <div className="text-center py-8 text-gray-400">No commissions yet. Set up rules first, then click "Recalculate All Orders".</div>}
          {commissions.map(c => (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-violet-700 text-sm">{c.orders?.so_number || "?"}</span>
                  <span className="text-sm text-gray-700">{c.orders?.customer_name || ""}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[c.status] || "bg-gray-100"}`}>{c.status}</span>
                  {!c.deposit_met && <span className="text-xs text-amber-600">⏳ Deposit &lt; 30%</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {c.users?.name || c.users?.salesman_name || "?"} · {c.role_name} · {c.rate_pct}%{c.incentive_pct > 0 ? ` +${c.incentive_pct}% incentive` : ""} on {money(c.net_amount)}
                </p>
                {commissionReason(c) && <p className="text-xs text-amber-600 mt-0.5">{commissionReason(c)}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <p className="text-sm font-bold text-gray-900">{money(c.commission_amt)}</p>
                {!isSalesman && (
                  <div className="flex gap-1">
                    <button onClick={() => addAdjustment(c.id)} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200" title="Adjust">±</button>
                    {c.status !== "held" && <button onClick={() => addHold(c.id)} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100" title="Hold">🔒</button>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 2: Rules */}
      {tab === 2 && (
        <div className="space-y-4">
          <button onClick={() => setShowRuleForm(true)} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">+ Add Rule</button>
          {rules.length === 0 && <div className="text-center py-8 text-gray-400"><p>No commission rules set.</p><p className="text-xs mt-1">Add rules to auto-calculate commissions on orders.</p></div>}
          <div className="space-y-2">
            {rules.map(r => (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.role_name === "salesman" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>{r.role_name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.channel === "branch" ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-700"}`}>{r.channel || "branch"}</span>
                    {r.tier_name && <span className="text-sm font-medium text-gray-700">{r.tier_name}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Rate: <b>{r.rate_pct}%</b>{r.incentive_pct > 0 ? ` + ${r.incentive_pct}% incentive` : ""}
                    · Net range: {money(r.min_net)}{r.max_net ? ` — ${money(r.max_net)}` : "+"}
                    · Deposit gate: {r.deposit_gate_pct}% · Payout: {r.payout_day}th
                  </p>
                </div>
                <button onClick={() => deleteRule(r.id)} className="text-xs text-red-500 hover:underline">Remove</button>
              </div>
            ))}
          </div>

          {showRuleForm && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">Add Commission Rule</h3>
                  <button onClick={() => setShowRuleForm(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500">×</button>
                </div>
                <div className="px-6 py-5 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Channel</label>
                    <select value={ruleForm.channel} onChange={e => setRuleForm(f => ({ ...f, channel: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white mb-3">
                      {channels.map(ch => <option key={ch} value={ch}>{ch === "branch" ? "Branch (Normal)" : ch}</option>)}
                    </select>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                    <select value={ruleForm.role_name} onChange={e => setRuleForm(f => ({ ...f, role_name: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                      <option value="salesman">Salesman</option>
                      <option value="branch_manager">Branch Manager (Override)</option>
                    </select>
                  </div>
                  {ruleForm.role_name === "salesman" && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Apply to (blank = all salesmen)</label>
                      <select value={ruleForm.user_id} onChange={e => setRuleForm(f => ({ ...f, user_id: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                        <option value="">All Salesmen (company-wide tier)</option>
                        {salesmen.map(s => <option key={s.id} value={s.id}>{s.salesman_name || s.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div><label className="block text-xs font-medium text-gray-500 mb-1">Tier Name</label>
                    <input value={ruleForm.tier_name} onChange={e => setRuleForm(f => ({ ...f, tier_name: e.target.value }))} placeholder="e.g. Standard, Senior, Top" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Rate %</label>
                      <input type="number" step="0.5" value={ruleForm.rate_pct} onChange={e => setRuleForm(f => ({ ...f, rate_pct: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Incentive %</label>
                      <input type="number" step="0.5" value={ruleForm.incentive_pct} onChange={e => setRuleForm(f => ({ ...f, incentive_pct: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Min Net (RM)</label>
                      <input type="number" value={ruleForm.min_net} onChange={e => setRuleForm(f => ({ ...f, min_net: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Max Net (RM, blank=no limit)</label>
                      <input type="number" value={ruleForm.max_net} onChange={e => setRuleForm(f => ({ ...f, max_net: e.target.value }))} placeholder="No limit" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Deposit Gate %</label>
                      <input type="number" value={ruleForm.deposit_gate_pct} onChange={e => setRuleForm(f => ({ ...f, deposit_gate_pct: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Payout Day</label>
                      <input type="number" value={ruleForm.payout_day} onChange={e => setRuleForm(f => ({ ...f, payout_day: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                  </div>
                </div>
                <div className="px-6 py-4 border-t flex gap-3 justify-end">
                  <button onClick={() => setShowRuleForm(false)} className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600">Cancel</button>
                  <button onClick={saveRule} className="px-5 py-2 text-sm rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700">Create Rule</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Product Incentives */}
      {tab === 3 && (
        <div className="space-y-4">
          <button onClick={() => setShowIncForm(true)} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">+ Add Incentive Product</button>
          {incentives.length === 0 && <div className="text-center py-8 text-gray-400"><p>No product incentives set.</p><p className="text-xs mt-1">Add products that earn bonus incentive when sold.</p></div>}
          <div className="space-y-2">
            {incentives.map(inc => (
              <div key={inc.id} className={`bg-white rounded-2xl border shadow-sm p-4 flex items-center justify-between ${inc.is_active ? "border-gray-100" : "border-gray-50 opacity-50"}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{inc.product_name || inc.product_code || "?"}</span>
                    {inc.product_code && <span className="text-xs font-mono text-violet-600">{inc.product_code}</span>}
                    <span className="text-sm font-bold text-emerald-700">{money(inc.incentive_amount)}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {inc.start_date ? `From ${inc.start_date}` : "No start date"}
                    {inc.end_date ? ` to ${inc.end_date}` : " — ongoing"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => {
                    const amt = window.prompt("New incentive amount (RM):", inc.incentive_amount);
                    if (amt) af(`${API}/product-incentives/${inc.id}`, { method: "PUT", body: JSON.stringify({ incentive_amount: Number(amt) }) }).then(() => { toast.success("Updated"); loadIncentives(); });
                  }} className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Edit RM</button>
                  <button onClick={() => deleteIncentive(inc.id)} className="text-xs text-red-500 hover:underline">Remove</button>
                </div>
              </div>
            ))}
          </div>

          {showIncForm && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">Add Incentive Product</h3>
                  <button onClick={() => setShowIncForm(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500">×</button>
                </div>
                <div className="px-6 py-5 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Search Product</label>
                    <input value={productSearch} onChange={e => searchProducts(e.target.value)} placeholder="Type product code or name..."
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                    {productResults.length > 0 && (
                      <div className="border border-gray-200 rounded-xl mt-1 max-h-32 overflow-y-auto">
                        {productResults.map(p => (
                          <button key={p.id} onClick={() => { setIncForm(f => ({ ...f, product_id: p.id, product_code: p.code, product_name: p.name })); setProductSearch(`${p.code} ${p.name}`); setProductResults([]); }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-violet-50">
                            <span className="font-mono text-violet-700">{p.code}</span> {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Incentive Amount (RM)</label>
                    <input type="number" value={incForm.incentive_amount} onChange={e => setIncForm(f => ({ ...f, incentive_amount: e.target.value }))}
                      placeholder="e.g. 150" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Start Date (optional)</label>
                      <input type="date" value={incForm.start_date} onChange={e => setIncForm(f => ({ ...f, start_date: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">End Date (optional)</label>
                      <input type="date" value={incForm.end_date} onChange={e => setIncForm(f => ({ ...f, end_date: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" /></div>
                  </div>
                </div>
                <div className="px-6 py-4 border-t flex gap-3 justify-end">
                  <button onClick={() => setShowIncForm(false)} className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600">Cancel</button>
                  <button onClick={saveIncentive} disabled={!incForm.incentive_amount} className="px-5 py-2 text-sm rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50">Add Incentive</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Holds */}
      {tab === 4 && (
        <div className="space-y-2">
          {commissions.filter(c => c.status === "held").length === 0 && <div className="text-center py-8 text-gray-400">No held commissions</div>}
          {commissions.filter(c => c.status === "held").map(c => (
            <div key={c.id} className="bg-red-50 rounded-2xl border border-red-200 p-4 flex items-center justify-between">
              <div>
                <span className="font-bold text-violet-700 text-sm">{c.orders?.so_number}</span>
                <span className="text-sm text-gray-700 ml-2">{c.orders?.customer_name}</span>
                <p className="text-xs text-gray-500 mt-0.5">{c.users?.name || "?"} · {money(c.commission_amt)} held</p>
              </div>
              <button onClick={() => {
                const hold = c._holds?.[0];
                if (hold) releaseHold(hold.id);
              }} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Release Hold</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
