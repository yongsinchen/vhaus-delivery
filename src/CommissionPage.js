import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast, useLoading } from "./UIComponents";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };
const money = v => `RM ${(Number(v) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
// Parse a response that is SUPPOSED to be JSON, but say something useful when it
// isn't. An unknown route returns Express's HTML 404 page, which would otherwise
// surface to the user as "Unexpected token '<'" and tell them nothing.
const readJson = async (res, label) => {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch {
    throw new Error(res.status === 404
      ? `${label} not found on the server (404). The backend may not have this endpoint deployed yet.`
      : `${label} returned ${res.status} ${res.statusText || ""} instead of JSON.`);
  }
};
// Sort commission rows by their Sales Order number in ascending order. `numeric`
// keeps SO-2 before SO-10 (natural order), and blanks sink to the bottom.
const bySoAsc = (a, b) => String(a.orders?.so_number || "~").localeCompare(String(b.orders?.so_number || "~"), undefined, { numeric: true, sensitivity: "base" });

// --- Month helpers -----------------------------------------------------------
// The month selector is a PAYOUT month, always stored as "YYYY-MM-01". A payout
// month is fed by the orders of the month BEFORE it (see getPayoutMonth in
// vhaus-bot/server.js), so August's payout covers July's orders. Both months are
// shown in the UI because the distinction is not obvious from the number alone.
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
const currentMonth = () => monthKey(new Date());
const shiftMonth = (m, n) => { const [y, mo] = m.slice(0, 7).split("-").map(Number); return monthKey(new Date(y, mo - 1 + n, 1)); };
const monthLabel = m => { const [y, mo] = m.slice(0, 7).split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" }); };
const orderMonthLabel = m => monthLabel(shiftMonth(m, -1));

// Total sales a salesman generated in the batch — the net amount commission is
// computed on, summed over their orders. Shared by the card, the sort, and the
// printed report so all three can never disagree.
const totalSalesOf = u => u.commissions.reduce((s, c) => s + (Number(c.net_amount) || 0), 0);

// --- Remembered filters ------------------------------------------------------
// Kept per user AND per company: one person's August at Vhaus PG is not their
// August at UGL. Sort and search persist across sessions (localStorage). The month
// deliberately uses sessionStorage instead — it survives a refresh, but reopening
// the page weeks later starts on the current month rather than silently showing a
// stale one, which is the confusion this whole change is meant to remove.
const prefsKey = (companyId, userId) => `pulseCommissionPrefs:${companyId || "-"}:${userId || "-"}`;
const readPrefs = (store, key) => { try { return JSON.parse(store.getItem(key) || "{}") || {}; } catch { return {}; } };
const writePrefs = (store, key, patch) => { try { store.setItem(key, JSON.stringify({ ...readPrefs(store, key), ...patch })); } catch { /* private mode / quota — filters just don't persist */ } };

const SORTS = [
  { key: "name", label: "Name", get: u => (u.name || "").toLowerCase() },
  { key: "sales", label: "Total Sales", get: totalSalesOf },
  { key: "payout", label: "Total Payout", get: u => Number(u.total) || 0 },
  { key: "orders", label: "Order Count", get: u => u.commissions.length },
];

const ALL_TABS = ["Payout", "All Commissions", "Rules", "Product Incentives", "Holds", "Driver Commission"];
const STATUS_STYLE = { pending: "bg-gray-100 text-gray-600", eligible: "bg-emerald-100 text-emerald-700", held: "bg-red-100 text-red-600", paid: "bg-blue-100 text-blue-700" };

// A paid commission is never mutated — corrections go through adjustments. The
// backend enforces this; the UI hides the control so nobody is offered a 409.
const isPaid = c => c.status === "paid" || !!c.paid_at;

// Per-item incentive switches for one sales order. Each button is one product
// incentive the order's items earn, labelled with the product name. Eligibility is
// the manager's decision alone — there is no rule behind it — so these are plain
// toggles. Rendered only for master/director/manager (COMMISSION_APPROVE); the
// backend authorises independently, so hiding them is UX, not security.
//
// Keyed on the product incentive rather than the item, because order items carry no
// stable id — see matchProductIncentives in vhaus-bot/lib/commission.js.
function IncentiveItems({ orderId, canToggle, paid, onChanged }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!orderId) { setItems(null); return; }
    (async () => {
      try {
        const res = await af(`${API}/orders/${orderId}/incentive-items`);
        const d = await readJson(res, "Incentive items");
        if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
        if (alive) setItems(d.items || []);
      } catch { if (alive) setItems([]); }
    })();
    return () => { alive = false; };
  }, [orderId]);

  const toggle = async (row) => {
    setBusy(row.incentive_id);
    try {
      const res = await af(`${API}/orders/${orderId}/incentive-items`, {
        method: "PATCH", body: JSON.stringify({ incentive_id: row.incentive_id, excluded: !row.excluded }),
      });
      const d = await readJson(res, "Incentive toggle");
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      setItems(d.items || []);
      toast.success(row.excluded ? `${row.product_name} incentive counted` : `${row.product_name} incentive excluded`);
      onChanged?.();
    } catch (e) { toast.error("Failed: " + e.message); }
    finally { setBusy(null); }
  };

  if (items === null) return <p className="text-xs text-gray-400 py-1">Loading incentive items…</p>;
  if (items.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-[11px] text-gray-400">Eligibility per item{canToggle && !paid ? " — click to switch" : ""}</p>
      {items.map(row => (
        <div key={row.incentive_id} className="flex items-center justify-between gap-2">
          <button onClick={() => canToggle && !paid && toggle(row)} disabled={!canToggle || paid || busy === row.incentive_id}
            title={canToggle && !paid ? (row.excluded ? `Count ${row.product_name} towards commission` : `Exclude ${row.product_name} from commission`) : undefined}
            className={`text-left text-xs px-2 py-1 rounded-lg font-medium transition-colors flex-1 truncate disabled:cursor-default ${row.excluded ? "bg-gray-100 text-gray-400 line-through" : "bg-emerald-50 text-emerald-800"} ${canToggle && !paid ? (row.excluded ? "hover:bg-gray-200" : "hover:bg-emerald-100") : ""}`}>
            {busy === row.incentive_id ? "…" : row.product_name}
            {row.qty > 1 && <span className="text-[10px] opacity-70"> ×{row.qty}</span>}
          </button>
          <span className={`text-xs flex-shrink-0 ${row.excluded ? "text-gray-400 line-through" : "text-gray-700"}`}>{money(row.amount)}</span>
        </div>
      ))}
      <p className="text-[10px] text-gray-400">Order-level amounts, shared between the salesmen on this order.</p>
    </div>
  );
}

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

// Compact breakdown chips for the four commission components (Phase C).
// commission_amt = tier + clearance + product_incentive + package_incentive.
// Only rendered when at least one non-tier component is non-zero, so plain
// orders (the common case) don't get extra visual noise.
function CommissionBreakdown({ c }) {
  const tier = Number(c.tier_commission_amt) || 0;
  const clearance = Number(c.clearance_commission_amt) || 0;
  const product = Number(c.product_incentive_amt) || 0;
  const pkg = Number(c.package_incentive_amt) || 0;
  if (clearance === 0 && product === 0 && pkg === 0) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
      <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600">Tier {money(tier)}</span>
      {clearance !== 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-700">Clearance +{money(clearance)}</span>}
      {product !== 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700">Product +{money(product)}</span>}
      {pkg !== 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700">Package +{money(pkg)}</span>}
    </div>
  );
}

// Order + commission detail for a single row. Rendered as a modal rather than a
// navigation because the app has no router (App.js drives pages from useState), so
// leaving the page would discard the month, search and sort the user set up.
// Everything shown here already travels with the commission row — no extra fetch.
function OrderDetailModal({ c, onClose, canWaiveIncentive, onIncentiveChanged }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!c) return null;
  const o = c.orders || {};
  const row = (label, value) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-800 text-right">{value}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h3 className="font-bold text-gray-900">{o.so_number || "Order"}</h3>
            <p className="text-xs text-gray-500">{o.customer_name || "—"}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">×</button>
        </div>
        <div className="px-6 py-4">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Order</p>
          {row("Order date", o.order_date || "—")}
          {row("Order status", o.status || "—")}
          {row("Order amount", money(o.order_amount))}
          {row("Outstanding balance", <span className={Number(o.balance) > 0 ? "text-amber-600 font-medium" : ""}>{money(o.balance)}</span>)}

          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mt-4 mb-1">Commission</p>
          {row("Salesman", c.users?.name || c.users?.salesman_name || "—")}
          {row("Role", c.role_name || "—")}
          {row("Status", <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[c.status] || "bg-gray-100"}`}>{c.status}</span>)}
          {row("Net amount", money(c.net_amount))}
          {row("Rate", `${c.rate_pct}%${c.incentive_pct > 0 ? ` + ${c.incentive_pct}% incentive` : ""}`)}
          {Number(c.tier_commission_amt) !== 0 && row("Tier", money(c.tier_commission_amt))}
          {Number(c.clearance_commission_amt) !== 0 && row("Clearance", money(c.clearance_commission_amt))}
          {/* This is the salesman's SHARE of the order's payable incentive; the
              per-item list below shows the order-level amounts it comes from. */}
          {Number(c.product_incentive_amt) !== 0 && row("Product incentive", money(c.product_incentive_amt))}
          {Number(c.package_incentive_amt) !== 0 && row("Package incentive", money(c.package_incentive_amt))}
          {row("Deposit gate met", c.deposit_met ? "Yes" : "No")}
          {row("Payout month", c.payout_month ? monthLabel(c.payout_month) : "Not scheduled yet")}
          {c.paid_at && row("Paid on", new Date(c.paid_at).toLocaleDateString())}
          {commissionReason(c) && row("Why not paid", <span className="text-amber-600">{commissionReason(c)}</span>)}

          <IncentiveItems orderId={c.order_id} canToggle={canWaiveIncentive} paid={isPaid(c)} onChanged={onIncentiveChanged} />

          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <span className="text-sm font-medium text-gray-600">Commission</span>
            <span className="text-lg font-bold text-emerald-700">{money(c.commission_amt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommissionPage() {
  const { user, activeCompanyId, activeRoleKey, canPerm } = useAuth();
  const toast = useToast();
  const { withLoading } = useLoading();
  const companyId = activeCompanyId || user?.company_id;
  // Part-time is a salesman-equivalent role — treat it as salesman here so the
  // commission view (own payout/history only) matches a salesman's.
  const rawRole = (activeRoleKey || user?.role || "").toLowerCase();
  const effectiveRole = rawRole === "part_time" ? "salesman" : rawRole;
  const isSalesman = effectiveRole === "salesman";
  // Salesmen see only their own payout/history — Rules, Product Incentives, and
  // Holds are admin-only actions that affect everyone's commission, not personal views.
  const TABS = isSalesman ? ["Payout", "All Commissions"] : ALL_TABS;
  const [tab, setTab] = useState(0);

  const storeKey = prefsKey(companyId, user?.id);
  const [payout, setPayout] = useState(null);
  const [payoutMonth, setPayoutMonth] = useState(() => readPrefs(sessionStorage, prefsKey(companyId, user?.id)).month || currentMonth());
  const [search, setSearch] = useState(() => readPrefs(localStorage, prefsKey(companyId, user?.id)).search || "");
  const [sortKey, setSortKey] = useState(() => readPrefs(localStorage, prefsKey(companyId, user?.id)).sortKey || "payout");
  const [sortDir, setSortDir] = useState(() => readPrefs(localStorage, prefsKey(companyId, user?.id)).sortDir || "desc");
  const [payoutLoading, setPayoutLoading] = useState(true);
  const [detail, setDetail] = useState(null); // commission row shown in the order-details modal
  const [commissions, setCommissions] = useState([]);
  const [rules, setRules] = useState([]);
  const [branchOverrides, setBranchOverrides] = useState([]); // per-branch override earner rows
  const [boUsers, setBoUsers] = useState([]); // candidate earners (all active users)
  const [boSavingId, setBoSavingId] = useState(null); // branch_id being saved
  const [holds, setHolds] = useState([]); // eslint-disable-line
  const [incentives, setIncentives] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [incForm, setIncForm] = useState({ product_name: "", product_code: "", incentive_amount: "", start_date: "", end_date: "" });
  const [showIncForm, setShowIncForm] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState([]);
  const [channels, setChannels] = useState(["branch"]);
  const [loading, setLoading] = useState(true);

  // Driver (delivery) commission report — GET /delivery-commissions, month-scoped
  // by the shared payout-month selector (rows are bucketed by delivery month + 1,
  // same convention as salesman payout).
  const [driverComms, setDriverComms] = useState([]);
  const [driverCommsLoading, setDriverCommsLoading] = useState(false);

  // Rule form
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ role_name: "salesman", tier_name: "", min_net: 0, max_net: "", rate_pct: 3, incentive_pct: 0, deposit_gate_pct: 30, payout_day: 25, user_id: "", channel: "branch" });

  const loadPayout = useCallback(async () => {
    if (!companyId) return;
    setPayoutLoading(true);
    try {
      const res = await af(`${API}/commission-payout?company_id=${companyId}&payout_month=${payoutMonth}`);
      const d = await res.json();
      setPayout(d);
    } finally { setPayoutLoading(false); }
  }, [companyId, payoutMonth]);

  // Month-scoped at the query level: the backend returns only this payout batch,
  // never the full history. Without payout_month this endpoint returns every
  // commission ever recorded, which is what made the page read as accumulated.
  const loadCommissions = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await af(`${API}/commissions?company_id=${companyId}&payout_month=${payoutMonth}`);
      const d = await res.json();
      setCommissions(d.commissions || []);
    } finally { setLoading(false); }
  }, [companyId, payoutMonth]);

  const loadRules = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/commission-rules?company_id=${companyId}`);
    const d = await res.json();
    setRules(d.rules || []);
  }, [companyId]);

  const loadBranchOverrides = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/branch-commission-overrides?company_id=${companyId}`);
    const d = await res.json();
    setBranchOverrides((d.branches || []).map(b => ({ ...b, _user: b.override_user_id || "", _rate: b.override_rate_pct != null ? String(b.override_rate_pct) : "" })));
    setBoUsers(d.users || []);
  }, [companyId]);

  const saveBranchOverride = async (row) => {
    setBoSavingId(row.branch_id);
    try {
      await withLoading("Saving branch override…", async () => {
        const res = await af(`${API}/branch-commission-overrides/${row.branch_id}`, {
          method: "PUT",
          body: JSON.stringify({ user_id: row._user || null, rate_pct: row._user ? (row._rate === "" ? 0 : Number(row._rate)) : null }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Failed");
        toast.success(row._user ? "Branch override saved" : "Branch override cleared");
        loadBranchOverrides();
      });
    } catch (e) { toast.error(e.message || "Failed to save"); }
    finally { setBoSavingId(null); }
  };

  const loadIncentives = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/product-incentives?company_id=${companyId}`);
    const d = await res.json();
    setIncentives(d.incentives || []);
  }, [companyId]);

  useEffect(() => { if (tab === 0) loadPayout(); }, [tab, loadPayout]);
  // Holds (tab 4) renders from `commissions` too, so it has to trigger the load —
  // previously opening Holds directly showed "No held commissions" until you had
  // visited All Commissions first.
  useEffect(() => { if (tab === 1 || tab === 4) loadCommissions(); }, [tab, loadCommissions]);

  // `companyId` resolves after the first render, and switching company changes the
  // storage key, so prefs are (re)loaded whenever the key changes. `prefsLoaded`
  // gates the writers below: without it they would fire on the render where the key
  // has changed but the state still holds the previous company's values, saving them
  // under the new company's key. It is set in the same batch as the loaded values,
  // so by the time the writers see a matching key the state is already correct.
  const [prefsLoaded, setPrefsLoaded] = useState(null);
  useEffect(() => {
    if (prefsLoaded === storeKey) return;
    const l = readPrefs(localStorage, storeKey);
    const s = readPrefs(sessionStorage, storeKey);
    setSearch(l.search || "");
    setSortKey(l.sortKey || "payout");
    setSortDir(l.sortDir || "desc");
    setPayoutMonth(s.month || currentMonth());
    setPrefsLoaded(storeKey);
  }, [storeKey, prefsLoaded]);

  // Remember the month for the session, and sort/search for good.
  useEffect(() => { if (prefsLoaded === storeKey) writePrefs(sessionStorage, storeKey, { month: payoutMonth }); }, [prefsLoaded, storeKey, payoutMonth]);
  useEffect(() => { if (prefsLoaded === storeKey) writePrefs(localStorage, storeKey, { search, sortKey, sortDir }); }, [prefsLoaded, storeKey, search, sortKey, sortDir]);

  // Search and sort are applied client-side: /commission-payout already returns the
  // whole month grouped per salesman, so this is instant and needs no round-trip.
  const needle = search.trim().toLowerCase();
  const visibleUsers = useMemo(() => {
    const sort = SORTS.find(s => s.key === sortKey) || SORTS[2];
    const dir = sortDir === "asc" ? 1 : -1;
    return (payout?.users || [])
      .filter(u => !needle || (u.name || "").toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => { const x = sort.get(a), y = sort.get(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }, [payout, needle, sortKey, sortDir]);

  // Same keyword narrows the flat commission lists, matched on salesman name.
  const visibleCommissions = useMemo(() => commissions.filter(c => {
    if (!needle) return true;
    return `${c.users?.name || ""} ${c.users?.salesman_name || ""}`.toLowerCase().includes(needle);
  }), [commissions, needle]);

  const visibleTotal = useMemo(() => visibleUsers.reduce((s, u) => s + (Number(u.total) || 0), 0), [visibleUsers]);
  const isFiltered = needle.length > 0;
  const atCurrentMonth = payoutMonth >= currentMonth();
  useEffect(() => { if (tab === 2) {
    loadRules();
    loadBranchOverrides();
    af(`${API}/salesman-names?company_id=${companyId}`).then(r=>r.json()).then(d => setSalesmen(d.salesmen || []));
    af(`${API}/company-settings?company_id=${companyId}`).then(r=>r.json()).then(d => { try { const ch = JSON.parse(d.settings?.sales_channels || '["branch"]'); if (Array.isArray(ch)) setChannels(ch); } catch {} });
  } }, [tab, loadRules, loadBranchOverrides, companyId]);
  useEffect(() => { if (tab === 3) loadIncentives(); }, [tab, loadIncentives]);

  const loadDriverComms = useCallback(async () => {
    if (!companyId) return;
    setDriverCommsLoading(true);
    try {
      const res = await af(`${API}/delivery-commissions?company_id=${companyId}&payout_month=${payoutMonth}`);
      const d = await readJson(res, "Driver commissions");
      setDriverComms(d.delivery_commissions || []);
    } catch (e) { toast.error(e.message); setDriverComms([]); }
    finally { setDriverCommsLoading(false); }
  }, [companyId, payoutMonth, toast]);
  useEffect(() => { if (tab === 5) loadDriverComms(); }, [tab, loadDriverComms]);
  const driverCommTotal = useMemo(() => driverComms.filter(d => d.status !== "reversed").reduce((s, d) => s + (Number(d.commission_amt) || 0), 0), [driverComms]);
  // Group the flat rows per driver so each driver's payout is its own section
  // with a subtotal, instead of one stacked table. Sorted by subtotal desc.
  const driverCommGroups = useMemo(() => {
    const map = new Map();
    for (const dc of driverComms) {
      const key = dc.driver_user_id || dc.driver?.name || "—";
      if (!map.has(key)) map.set(key, { key, name: dc.driver?.name || "Unassigned", rows: [], total: 0 });
      const g = map.get(key);
      g.rows.push(dc);
      if (dc.status !== "reversed") g.total += Number(dc.commission_amt) || 0;
    }
    return [...map.values()]
      .map(g => ({ ...g, total: Math.round(g.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);
  }, [driverComms]);

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

  // Per-item incentive switches live in the order-details modal. COMMISSION_APPROVE
  // is held by master, director and manager only; this check is UX — the backend
  // authorises. After a switch the backend re-runs the real commission calculation,
  // so reloading is what brings every downstream figure back in step: the row, the
  // salesman's total, Total Payout and the printed report.
  const canToggleIncentive = canPerm("COMMISSION_APPROVE");
  const onIncentiveChanged = useCallback(() => { loadPayout(); loadCommissions(); }, [loadPayout, loadCommissions]);

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

      {/* Shared month / search / sort toolbar — Payout, All Commissions and Holds
          are all views of the same payout batch, so they share one set of controls
          rather than each tab filtering independently. */}
      {(tab === 0 || tab === 1 || tab === 4) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <button onClick={() => setPayoutMonth(m => shiftMonth(m, -1))} title="Previous month"
                className="w-9 h-9 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">‹</button>
              {/* Changing the month re-runs the loaders through their useEffect deps,
                  so there is nothing to refresh by hand. */}
              <input type="month" value={payoutMonth.slice(0, 7)}
                onChange={e => { if (e.target.value) setPayoutMonth(e.target.value + "-01"); }}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
              <button onClick={() => setPayoutMonth(m => shiftMonth(m, 1))} disabled={atCurrentMonth}
                title={atCurrentMonth ? "Already at the latest payout month" : "Next month"}
                className="w-9 h-9 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed">›</button>
              {!atCurrentMonth && (
                <button onClick={() => setPayoutMonth(currentMonth())}
                  className="ml-1 px-3 py-2 rounded-xl text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100">This month</button>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Payout <b className="text-gray-700">{monthLabel(payoutMonth)}</b> · orders dated {orderMonthLabel(payoutMonth)}
            </p>
            <div className="flex-1" />
            {!isSalesman && (
              <div className="relative">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search salesman…"
                  className="pl-3 pr-8 py-2 w-56 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                {search && <button onClick={() => setSearch("")} title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>}
              </div>
            )}
          </div>
          {tab === 0 && !isSalesman && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-gray-400 mr-1">Sort by</span>
              {SORTS.map(s => (
                <button key={s.key}
                  onClick={() => { if (sortKey === s.key) setSortDir(d => (d === "asc" ? "desc" : "asc")); else { setSortKey(s.key); setSortDir(s.key === "name" ? "asc" : "desc"); } }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${sortKey === s.key ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  {s.label}{sortKey === s.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: Driver Commission */}
      {tab === 5 && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <button onClick={() => setPayoutMonth(m => shiftMonth(m, -1))} title="Previous month"
                className="w-9 h-9 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">‹</button>
              <input type="month" value={payoutMonth.slice(0, 7)}
                onChange={e => { if (e.target.value) setPayoutMonth(e.target.value + "-01"); }}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
              <button onClick={() => setPayoutMonth(m => shiftMonth(m, 1))} disabled={atCurrentMonth}
                title={atCurrentMonth ? "Already at the latest payout month" : "Next month"}
                className="w-9 h-9 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">›</button>
              {!atCurrentMonth && <button onClick={() => setPayoutMonth(currentMonth())} className="ml-1 px-3 py-2 rounded-xl text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100">This month</button>}
            </div>
            <p className="text-xs text-gray-500">Payout <b className="text-gray-700">{monthLabel(payoutMonth)}</b> · delivered {orderMonthLabel(payoutMonth)}</p>
            <div className="flex-1" />
            <span className="text-sm font-bold text-gray-700">Total: {money(driverCommTotal)}</span>
          </div>

          {driverCommsLoading && <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}

          {!driverCommsLoading && driverComms.length === 0 && (
            <div className="text-center py-10">
              <p className="text-gray-500 font-medium">No driver commissions for {monthLabel(payoutMonth)}</p>
              <p className="text-xs text-gray-400 mt-1">A driver earns commission when the first delivery trip of an order completes. Set a rate under Company Settings → Operations to enable it.</p>
            </div>
          )}

          {!driverCommsLoading && driverComms.length > 0 && driverCommGroups.map(g => (
            <div key={g.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-violet-50 border-b border-violet-100">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-800">{g.name}</span>
                  <span className="text-xs text-gray-500">{g.rows.filter(r => r.status !== "reversed").length} order(s)</span>
                </div>
                <span className="text-sm font-bold text-violet-700">{money(g.total)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-2 font-medium">SO</th>
                      <th className="px-4 py-2 font-medium text-right">Order Amount</th>
                      <th className="px-4 py-2 font-medium text-center">Rate</th>
                      <th className="px-4 py-2 font-medium text-right">Commission</th>
                      <th className="px-4 py-2 font-medium text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(dc => (
                      <tr key={dc.id} className={`border-b border-gray-50 last:border-0 ${dc.status === "reversed" ? "opacity-50" : ""}`}>
                        <td className="px-4 py-2 font-medium text-gray-800">{dc.orders?.so_number || "—"}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{money(dc.base_amount)}</td>
                        <td className="px-4 py-2 text-center text-gray-600">{dc.rate_pct}%</td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-800">{money(dc.commission_amt)}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[dc.status] || "bg-gray-100 text-gray-500"}`}>{dc.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 0: Payout */}
      {tab === 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {payout && (payout.users || []).length > 0 && (
              <button onClick={() => {
                // Print exactly what is on screen — the same search filter and sort
                // order — so a printed report can never disagree with the page it
                // was printed from.
                const rows = visibleUsers.flatMap(u => {
                  const eligible = u.commissions.filter(c => c.status === "eligible").sort(bySoAsc);
                  const pending = u.commissions.filter(c => c.status === "pending").sort(bySoAsc);
                  const totalSales = totalSalesOf(u);
                  const adjTotal = u.adjustments.reduce((s, a) => s + (Number(a.delta_amt) || 0), 0);
                  const holdTotal = u.holds.filter(h => h.status === "held").reduce((s, h) => s + (Number(h.held_amt) || 0), 0);
                  return [`<tr style="background:#f3f0ff"><td colspan="6" style="border:1px solid #ddd;padding:6px 8px;font-weight:700">${u.name} <span style="font-weight:400;color:#666">(${u.role}) · Total Sales: ${money(totalSales)}</span></td><td style="border:1px solid #ddd;padding:6px 8px;font-weight:700;text-align:right">${money(u.total)}</td></tr>`,
                    // commission_amt already excludes a switched-off incentive, so the
                    // printed figures follow automatically. The marker exists so a reader
                    // can see WHY a row pays less than its rate implies.
                    ...eligible.map(c => `<tr><td style="border:1px solid #ddd;padding:4px 8px">${c.orders?.so_number || ""}</td><td style="border:1px solid #ddd;padding:4px 8px">${c.orders?.customer_name || ""}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center">${c.rate_pct}%</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right">${money(c.net_amount)}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center;color:green">Eligible</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center">${c.deposit_met ? "✓" : "✗"}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right;font-weight:600">${money(c.commission_amt)}</td></tr>`),
                    ...pending.map(c => `<tr style="opacity:0.5"><td style="border:1px solid #ddd;padding:4px 8px">${c.orders?.so_number || ""}</td><td style="border:1px solid #ddd;padding:4px 8px">${c.orders?.customer_name || ""}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center">${c.rate_pct}%</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right">${money(c.net_amount)}</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center;color:orange">Pending</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:center;color:red">✗ &lt;30%</td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right">${money(c.commission_amt)}</td></tr>`),
                    ...(adjTotal !== 0 ? [`<tr style="background:#fef3c7"><td colspan="5" style="border:1px solid #ddd;padding:4px 8px;color:#92400e">Adjustments</td><td></td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right;font-weight:600;color:${adjTotal >= 0 ? "green" : "red"}">${money(adjTotal)}</td></tr>`] : []),
                    ...(holdTotal > 0 ? [`<tr style="background:#fee2e2"><td colspan="5" style="border:1px solid #ddd;padding:4px 8px;color:#991b1b">Wrong-item Holds</td><td></td><td style="border:1px solid #ddd;padding:4px 8px;text-align:right;font-weight:600;color:red">-${money(holdTotal)}</td></tr>`] : []),
                  ];
                });
                const w = window.open("", "_blank"); if (!w) return;
                w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Commission Payout</title><style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;font-size:11px;padding:10px}table{border-collapse:collapse;width:100%}th{background:#7C3AED;color:#fff;padding:6px 8px;text-align:left;font-size:10px}</style></head><body><h2>Commission Payout Report</h2><p style="color:#666">Payout month: ${monthLabel(payoutMonth)} · Orders dated: ${orderMonthLabel(payoutMonth)}<br/>Total: ${money(visibleTotal)} · ${visibleUsers.length} person(s)${isFiltered ? ` · filtered by "${search.trim()}"` : ""}</p><table><thead><tr><th>SO</th><th>Customer</th><th>Rate</th><th style="text-align:right">Net</th><th>Status</th><th>Deposit</th><th style="text-align:right">Commission</th></tr></thead><tbody>${rows.join("")}</tbody></table><p style="text-align:right;font-size:14px;font-weight:700;margin-top:12px">Total Payout: ${money(visibleTotal)}</p></body></html>`);
                w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
              }} className="px-4 py-2 rounded-xl text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">🖨 Print Report</button>
            )}
            {payout && !payoutLoading && (
              <span className="text-sm font-bold text-gray-700">
                Total Payout: {money(visibleTotal)}
                {isFiltered && <span className="ml-1 font-normal text-gray-400">({visibleUsers.length} of {(payout.users || []).length} shown)</span>}
              </span>
            )}
          </div>

          {payoutLoading && <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-28 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}

          {!payoutLoading && payout && (payout.users || []).length === 0 && (
            <div className="text-center py-10">
              <p className="text-gray-500 font-medium">No commission records found</p>
              <p className="text-xs text-gray-400 mt-1">Nothing is scheduled for payout in {monthLabel(payoutMonth)} (orders dated {orderMonthLabel(payoutMonth)}).</p>
              {/* Recalculate lives on the All Commissions tab and is admin-only, so
                  only point there for people who can actually act on it. */}
              {!isSalesman && <p className="text-xs text-gray-400 mt-1">If you expected records here, check the Rules tab, then run "Recalculate All Orders" under All Commissions.</p>}
            </div>
          )}

          {!payoutLoading && payout && (payout.users || []).length > 0 && visibleUsers.length === 0 && (
            <div className="text-center py-10">
              <p className="text-gray-500 font-medium">No salesman matches "{search.trim()}"</p>
              <button onClick={() => setSearch("")} className="text-xs text-violet-600 hover:underline mt-1">Clear search</button>
            </div>
          )}

          {!payoutLoading && payout && visibleUsers.map(u => {
            const eligible = u.commissions.filter(c => c.status === "eligible" || c.status === "paid").sort(bySoAsc);
            const pending = u.commissions.filter(c => c.status === "pending").sort(bySoAsc);
            // eslint-disable-next-line no-unused-vars
            const held = u.commissions.filter(c => c.status === "held");
            const pendingTotal = pending.reduce((s, c) => s + (Number(c.commission_amt) || 0), 0);
            const totalSales = totalSalesOf(u);
            return (
            <div key={u.user_id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-bold text-gray-900 text-lg">{u.name}</p>
                  <p className="text-xs text-gray-500">{u.role} · {u.commissions.length} order(s)</p>
                  <p className="text-xs font-semibold text-gray-600 mt-0.5">Total Sales: {money(totalSales)}</p>
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
                    <div key={c.id} onClick={() => setDetail(c)} title="View order details"
                      className="text-xs py-1.5 border-t border-gray-50 cursor-pointer hover:bg-violet-50/60 rounded-lg px-1 -mx-1">
                      <div className="flex items-center justify-between">
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
                      <CommissionBreakdown c={c} />
                      {c.status === "paid" && c.paid_at && <p className="text-[11px] text-blue-600 mt-0.5">Paid {new Date(c.paid_at).toLocaleDateString()}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* Pending commissions */}
              {pending.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-bold text-amber-600 mb-1">PENDING DEPOSIT &lt; 30% ({pending.length})</p>
                  {pending.map(c => (
                    <div key={c.id} onClick={() => setDetail(c)} title="View order details"
                      className="text-xs py-1.5 border-t border-gray-50 opacity-80 cursor-pointer hover:bg-violet-50/60 hover:opacity-100 rounded-lg px-1 -mx-1">
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
                      <CommissionBreakdown c={c} />
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
              <button onClick={async () => {
                try {
                  await withLoading("Re-syncing missing orders… this may take a moment", async () => {
                    const res = await af(`${API}/sales-orders/resync-missing`, { method: "POST" });
                    const d = await res.json();
                    if (d.error) throw new Error(d.error);
                    const msg = `${d.synced}/${d.missing} synced, ${d.commissioned} commissioned${d.failed ? `, ${d.failed} FAILED` : ""}`;
                    if (d.failed) { toast.error(msg + " — see console"); console.warn("Re-sync failures:", d.errors); }
                    else toast.success(msg);
                    loadCommissions();
                  });
                } catch (e) { toast.error("Re-sync failed: " + e.message); }
              }} className="px-4 py-2 rounded-xl text-sm bg-amber-600 text-white hover:bg-amber-700" title="Find confirmed sales orders that never created a delivery/commission row and sync them">🔗 Re-sync Missing Orders</button>
            </div>
          )}
          {loading && <div className="space-y-2">{[1,2,3,4].map(i=><div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}
          {!loading && commissions.length === 0 && (
            <div className="text-center py-10">
              <p className="text-gray-500 font-medium">No commission records found</p>
              <p className="text-xs text-gray-400 mt-1">Nothing in the {monthLabel(payoutMonth)} payout batch (orders dated {orderMonthLabel(payoutMonth)}).</p>
              {!isSalesman && <p className="text-xs text-gray-400 mt-1">Set up rules first, then click "Recalculate All Orders".</p>}
            </div>
          )}
          {!loading && commissions.length > 0 && visibleCommissions.length === 0 && (
            <div className="text-center py-10">
              <p className="text-gray-500 font-medium">No commissions match "{search.trim()}"</p>
              <button onClick={() => setSearch("")} className="text-xs text-violet-600 hover:underline mt-1">Clear search</button>
            </div>
          )}
          {!loading && visibleCommissions.map(c => (
            <div key={c.id} onClick={() => setDetail(c)} title="View order details"
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between cursor-pointer hover:border-violet-200 hover:shadow transition-shadow">
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
                <CommissionBreakdown c={c} />
                {commissionReason(c) && <p className="text-xs text-amber-600 mt-0.5">{commissionReason(c)}</p>}
                {c.status === "paid" && c.paid_at && <p className="text-xs text-blue-600 mt-0.5">Paid {new Date(c.paid_at).toLocaleDateString()}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <p className="text-sm font-bold text-gray-900">{money(c.commission_amt)}</p>
                {!isSalesman && (
                  <div className="flex gap-1">
                    {/* stopPropagation: the whole card opens the details modal. */}
                    <button onClick={e => { e.stopPropagation(); addAdjustment(c.id); }} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200" title="Adjust">±</button>
                    {c.status !== "held" && <button onClick={e => { e.stopPropagation(); addHold(c.id); }} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100" title="Hold">🔒</button>}
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
          {/* Branch override earner — a specific person earns a flat % of a
              branch's legit (deposit-paid) sales, on top of the salesmen. */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="font-bold text-gray-900">Branch Override Commission</h3>
            <p className="text-xs text-gray-500 mt-0.5 mb-3">Assign one person per branch to earn a flat % of that branch's legit (deposit-paid) sales, at their own rate. Leave the person blank to remove.</p>
            {branchOverrides.length === 0 && <p className="text-xs text-gray-400">No branches found.</p>}
            <div className="space-y-2">
              {branchOverrides.map((b, i) => (
                <div key={b.branch_id} className="flex flex-wrap items-center gap-2 bg-gray-50 rounded-xl p-2">
                  <span className="text-sm font-medium text-gray-700 min-w-[110px]">{b.branch_name}</span>
                  <select value={b._user} onChange={e => setBranchOverrides(prev => prev.map((r, j) => j === i ? { ...r, _user: e.target.value } : r))}
                    className="flex-1 min-w-[150px] px-3 py-1.5 rounded-lg border border-gray-200 text-sm bg-white">
                    <option value="">— No override —</option>
                    {boUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.1" min="0" max="100" value={b._rate} disabled={!b._user}
                      onChange={e => setBranchOverrides(prev => prev.map((r, j) => j === i ? { ...r, _rate: e.target.value } : r))}
                      placeholder="Rate" className="w-20 px-2 py-1.5 text-sm text-right rounded-lg border border-gray-200 disabled:bg-gray-100" />
                    <span className="text-xs text-gray-400">%</span>
                  </div>
                  <button onClick={() => saveBranchOverride(b)} disabled={boSavingId === b.branch_id}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                    {boSavingId === b.branch_id ? "Saving…" : "Save"}</button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">The rate is per person — the same earner uses one rate across every branch they override. Override earns nothing until the order's deposit gate is met.</p>
          </div>

          <button onClick={() => setShowRuleForm(true)} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">+ Add Rule</button>
          {rules.length === 0 && <div className="text-center py-8 text-gray-400"><p>No commission rules set.</p><p className="text-xs mt-1">Add rules to auto-calculate commissions on orders.</p></div>}
          <div className="space-y-2">
            {rules.map(r => (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.role_name === "salesman" ? "bg-emerald-100 text-emerald-700" : r.role_name === "part_time" ? "bg-teal-100 text-teal-700" : "bg-violet-100 text-violet-700"}`}>{r.role_name === "part_time" ? "Part-Time" : r.role_name}</span>
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
                      <option value="part_time">Part-Time</option>
                    </select>
                  </div>
                  {(ruleForm.role_name === "salesman" || ruleForm.role_name === "part_time") && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Apply to (blank = all {ruleForm.role_name === "part_time" ? "part-timers" : "salesmen"})</label>
                      <select value={ruleForm.user_id} onChange={e => setRuleForm(f => ({ ...f, user_id: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                        <option value="">All {ruleForm.role_name === "part_time" ? "Part-Timers" : "Salesmen"} (company-wide tier)</option>
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
          {loading && <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}
          {!loading && visibleCommissions.filter(c => c.status === "held").length === 0 && (
            <div className="text-center py-10">
              <p className="text-gray-500 font-medium">No commission records found</p>
              <p className="text-xs text-gray-400 mt-1">
                {isFiltered ? `No held commissions match "${search.trim()}" in ` : "Nothing is held in "}
                the {monthLabel(payoutMonth)} payout batch.
              </p>
            </div>
          )}
          {!loading && visibleCommissions.filter(c => c.status === "held").map(c => (
            <div key={c.id} onClick={() => setDetail(c)} title="View order details"
              className="bg-red-50 rounded-2xl border border-red-200 p-4 flex items-center justify-between cursor-pointer hover:border-red-300">
              <div>
                <span className="font-bold text-violet-700 text-sm">{c.orders?.so_number}</span>
                <span className="text-sm text-gray-700 ml-2">{c.orders?.customer_name}</span>
                <p className="text-xs text-gray-500 mt-0.5">{c.users?.name || "?"} · {money(c.commission_amt)} held</p>
              </div>
              <button onClick={e => {
                e.stopPropagation();
                const hold = c._holds?.[0];
                if (hold) releaseHold(hold.id);
              }} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex-shrink-0">Release Hold</button>
            </div>
          ))}
        </div>
      )}

      <OrderDetailModal c={detail} onClose={() => setDetail(null)}
        canWaiveIncentive={canToggleIncentive} onIncentiveChanged={onIncentiveChanged} />
    </div>
  );
}

export default memo(CommissionPage);
