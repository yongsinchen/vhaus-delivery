import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import LoginPage from "./LoginPage";
import { supabase, useAuth, roleLabel } from "./AuthContext";

// Lazy load all pages — only loaded when navigated to
const DeliverySchedule = lazy(() => import("./DeliverySchedule"));
const UserManagement = lazy(() => import("./UserManagement"));
const ResetPasswordPage = lazy(() => import("./ResetPassword"));
const ProductsPage = lazy(() => import("./ProductsPage"));
const OrdersPage = lazy(() => import("./OrdersPage"));
const SuppliersPage = lazy(() => import("./SuppliersPage"));
const CompanySettingsPage = lazy(() => import("./CompanySettingsPage"));
const PurchaseOrdersPage = lazy(() => import("./PurchaseOrdersPage"));
const InventoryPage = lazy(() => import("./InventoryPage"));
const WarehousePage = lazy(() => import("./WarehousePage"));
const DriverPage = lazy(() => import("./DriverPage"));
const ServicePage = lazy(() => import("./ServicePage"));
const CustomerPage = lazy(() => import("./CustomerPage"));
const FinancePage = lazy(() => import("./FinancePage"));
const CommissionPage = lazy(() => import("./CommissionPage"));
const UserPermissionsPage = lazy(() => import("./UserPermissionsPage"));

// ── Constants ─────────────────────────────────────────────────────
const BACKEND = "https://vhaus-bot-production.up.railway.app";
const authFetch = async (url, opts = {}) => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};
const EMPTY_ITEM = { itemCode: "", itemName: "", unit: "1", supplier: "", itemOrderDate: "", supplierSentDate: "", arrivalDate: "" };
const EMPTY_ORDER = { soNumber: "", customerName: "", address: "", contact: "", orderDate: "", salesman: "", orderAmount: "", balance: "", deliveryDate: "", timeSlot: "", plateNo: "", type: "Delivery", serviceNote: "", remark: "", status: "Pending", items: [{ ...EMPTY_ITEM }] };

// ── Helpers ───────────────────────────────────────────────────────
const fmt = d => d ? new Date(d).toLocaleDateString("en-MY") : "-";
const now = new Date();
const todayStr = now.toISOString().split("T")[0];

// toDb removed — dashboard writes now go through backend API
const fromDb = o => ({
  id: o.id, created_at: o.created_at, soNumber: o.so_number, customerName: o.customer_name,
  address: o.address, contact: o.contact, orderDate: o.order_date, salesman: o.salesman,
  orderAmount: o.order_amount, balance: o.balance, deliveryDate: o.delivery_date,
  timeSlot: o.time_slot, plateNo: o.plate_no, type: o.type, serviceNote: o.service_note,
  svNumber: o.sv_number, remark: o.remark, status: o.status,
  items: typeof o.items === "string" ? JSON.parse(o.items || "[]") : (o.items || []),
  photoUrl: o.photo_url || null,
  linkedSo: o.linked_so || null,
});

// ── Design tokens ─────────────────────────────────────────────────
const statusColor = s => ({
  "Pending": "bg-amber-100 text-amber-800",
  "Out for Delivery": "bg-blue-100 text-blue-800",
  "Delivered": "bg-emerald-100 text-emerald-800",
  "Serviced": "bg-violet-100 text-violet-800",
  "Flagged": "bg-red-100 text-red-800",
  "In Progress": "bg-indigo-100 text-indigo-800",
}[s] || "bg-gray-100 text-gray-700");

const tripStatusColor = s => ({
  "Scheduled": "bg-amber-100 text-amber-700",
  "Assigned": "bg-blue-100 text-blue-700",
  "Out for Delivery": "bg-indigo-100 text-indigo-700",
  "Completed": "bg-emerald-100 text-emerald-700",
  "Cancelled": "bg-gray-100 text-gray-400",
}[s] || "bg-gray-100 text-gray-500");

// ── Nav config ────────────────────────────────────────────────────
const NAV = [
  { id: "overview",   label: "Overview",         icon: "⊞",  canKey: null },
  { id: "orders",     label: "Orders",           icon: "◫",  canKey: "viewMonthly" },
  { id: "deliveries", label: "Deliveries",       icon: "⬡",  canKey: "viewSchedule" },
  { id: "ready",      label: "Ready to Deliver", icon: "◈",  canKey: "viewMonthly" },
  { id: "services",   label: "Services",         icon: "🔧", canKey: "viewService" },
  { id: "operations", label: "Operations",       icon: "⚙",  canKey: "viewServicePending", adminOnly: true },
  { id: "products",   label: "Products",         icon: "📦", canKey: null, manageOnly: true },
  { id: "purchase",   label: "Purchase Orders",   icon: "📋", canKey: null, manageOnly: true },
  { id: "inventory",  label: "Inventory",          icon: "📊", canKey: null, manageOnly: true },
  { id: "warehouse",  label: "Warehouse",          icon: "🏭", canKey: null, manageOnly: true },
  { id: "driver",     label: "Driver",             icon: "🚛", canKey: null, manageOnly: false },
  { id: "customers",  label: "Customers",        icon: "👥", canKey: null, manageOnly: false },
  { id: "finance",    label: "Finance",          icon: "💰", canKey: null, manageOnly: true },
  { id: "commission", label: "Commission",       icon: "📊", canKey: null, manageOnly: true },
  { id: "suppliers",  label: "Suppliers",        icon: "🏷", canKey: null, manageOnly: true },
  { id: "team",       label: "Team",             icon: "◉",  canKey: "manageUsers" },
  { id: "permissions",label: "Permissions",      icon: "🔐", canKey: "manageCompanies" },
  { id: "settings",   label: "Settings",         icon: "⚙",  canKey: null, manageOnly: true },
];

// ── Stat Card ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = false, onClick }) {
  return (
    <button onClick={onClick} className={`rounded-2xl p-4 text-left w-full transition-all hover:scale-[1.02] active:scale-[0.99] ${accent ? "bg-violet-600 text-white shadow-lg shadow-violet-200" : "bg-white border border-gray-100 shadow-sm"}`}>
      <p className={`text-xs font-medium mb-1 ${accent ? "text-violet-200" : "text-gray-400"}`}>{label}</p>
      <p className={`text-3xl font-bold tracking-tight ${accent ? "text-white" : "text-gray-900"}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${accent ? "text-violet-200" : "text-gray-400"}`}>{sub}</p>}
    </button>
  );
}

// ── Badge ─────────────────────────────────────────────────────────
function Badge({ children, color = "gray" }) {
  const c = { gray:"bg-gray-100 text-gray-600", violet:"bg-violet-100 text-violet-700", amber:"bg-amber-100 text-amber-700", emerald:"bg-emerald-100 text-emerald-700", red:"bg-red-100 text-red-700", blue:"bg-blue-100 text-blue-700", indigo:"bg-indigo-100 text-indigo-700" }[color] || "bg-gray-100 text-gray-600";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c}`}>{children}</span>;
}

// ── Order Card (mobile-first) ─────────────────────────────────────
// ── Order View Modal ──────────────────────────────────────────────
function OrderViewModal({ order: o, onClose, onEdit, onDelete, onViewPhoto, orders, handleView, onRefresh }) {
  const hasBalance = parseFloat(o.balance) > 0;
  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  useEffect(() => {
    if (!o.soNumber) return;
    setTripsLoading(true);
    fetch(`${BACKEND}/order-trips/so/${o.soNumber}`)
      .then(r => r.json()).then(d => setTrips(Array.isArray(d) ? d : [])).catch(() => setTrips([])).finally(() => setTripsLoading(false));
  }, [o.soNumber]);

  const Row = ({ label, value, highlight }) => (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${highlight || "text-gray-800"}`}>{value || "-"}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white rounded-t-3xl z-10">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-violet-700">{o.soNumber}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor(o.status)}`}>{o.status}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${o.type === "Service" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>{o.type}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 text-lg font-bold">×</button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Row label="Customer" value={o.customerName} />
            <Row label="Contact" value={o.contact} />
            <Row label="Salesman" value={o.salesman} />
            <div className="col-span-2 sm:col-span-3 bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Address</p>
              <p className="text-sm font-medium text-gray-800 whitespace-pre-line">{(o.address || "-").replace(/\s*(ADDRESS \d+:\s*)/gi, "\n$1").trim()}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Row label="Delivery Date" value={fmt(o.deliveryDate)} />
            <Row label="Time Slot" value={o.timeSlot} highlight="text-violet-700 font-semibold" />
            <Row label="Order Amount" value={`RM ${o.orderAmount || 0}`} />
            <Row label="Balance" value={`RM ${o.balance || 0}`} highlight={hasBalance ? "text-red-600 font-bold" : "text-emerald-600"} />
          </div>
          {o.items?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Items ({o.items.length})</p>
              <div className="space-y-2">
                {o.items.map((item, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs bg-violet-100 text-violet-700 font-bold px-2 py-0.5 rounded-full">#{i+1}</span>
                      {item.itemCode && <span className="text-xs text-gray-400">[{item.itemCode}]</span>}
                      <span className="text-sm font-semibold text-gray-800 flex-1">{item.itemName || "-"}</span>
                      <span className="text-xs text-gray-500">×{item.unit}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div><span className="text-gray-400">Supplier: </span><span className="font-medium">{item.supplier || "-"}</span></div>
                      <div><span className="text-gray-400">Ordered: </span><span className="font-medium">{fmt(item.itemOrderDate)}</span></div>
                      <div><span className="text-gray-400">Sent: </span><span className="font-medium">{fmt(item.supplierSentDate)}</span></div>
                      <div>
                        <span className="text-gray-400">Arrived: </span>
                        <input type="date" value={item.arrivalDate || ""} onChange={async e => {
                          const val = e.target.value;
                          const token = (await supabase.auth.getSession()).data?.session?.access_token;
                          await fetch(`${BACKEND}/orders/${o.id}/item-arrival`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ item_index: i, arrival_date: val }) });
                          o.items[i].arrivalDate = val;
                          if (onRefresh) onRefresh();
                        }} className={`text-xs border rounded px-1.5 py-0.5 w-[110px] focus:outline-none focus:border-violet-400 ${item.arrivalDate ? "border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold" : "border-red-300 bg-red-50 text-red-500"}`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Linked SO for service orders */}
          {o.type === "Service" && (o.svNumber || o.linkedSo) && (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 flex items-center gap-3">
              <span className="text-2xl">🔧</span>
              <div>
                {o.svNumber && <p className="font-bold text-violet-700">{o.svNumber}</p>}
                {o.linkedSo && <p className="text-sm text-gray-600">Linked to: <button onClick={() => { const orig = orders?.find(x => x.soNumber === o.linkedSo); if(orig) { onClose(); setTimeout(() => handleView(orig), 100); }}} className="font-semibold text-violet-600 hover:underline">{o.linkedSo}</button></p>}
              </div>
            </div>
          )}

          {/* SO Photo */}
          {o.photoUrl && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Sales Order Photo</p>
              <button onClick={() => onViewPhoto(o.photoUrl)} className="block w-full overflow-hidden rounded-2xl border-2 border-violet-100 hover:border-violet-300 transition-colors">
                <img src={o.photoUrl} alt="Sales order" className="w-full object-cover max-h-48" />
                <p className="text-xs text-center text-violet-600 py-2 bg-violet-50">Tap to view full size</p>
              </button>
            </div>
          )}

          {(o.remark || o.serviceNote) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {o.remark && <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-1">Remark</p><p className="text-sm text-gray-700">{o.remark}</p></div>}
              {o.serviceNote && <div className="bg-violet-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-1">Service Note</p><p className="text-sm text-violet-700 font-medium">{o.serviceNote}</p></div>}
            </div>
          )}
          {(tripsLoading || trips.length > 0) && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Trips {trips.length > 0 && `(${trips.length})`}</p>
              {tripsLoading ? <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" /> : (
                <div className="space-y-2">
                  {trips.map(trip => (
                    <div key={trip.id} className={`rounded-xl p-3 border flex items-center justify-between gap-3 flex-wrap ${trip.status === "Completed" ? "bg-emerald-50 border-emerald-200" : trip.status === "Cancelled" ? "bg-gray-50 border-gray-200 opacity-60" : "bg-violet-50 border-violet-200"}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-gray-700">Trip {trip.trip_no}/{trip.total_trips}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${tripStatusColor(trip.status)}`}>{trip.status}</span>
                        {trip.trip_no === 1 && <span className="text-xs text-emerald-600 font-medium">💰 Commission</span>}
                        {trip.sv_number && <span className="text-xs text-violet-500 font-medium">{trip.sv_number}</span>}
                      </div>
                      <p className="text-xs font-semibold text-gray-700">{trip.scheduled_date ? new Date(trip.scheduled_date+"T00:00:00").toLocaleDateString("en-MY",{weekday:"short",day:"numeric",month:"short"}) : <span className="text-gray-400 italic">TBC</span>}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t flex items-center justify-between sticky bottom-0 bg-white rounded-b-3xl">
          <button onClick={() => { if(window.confirm("Delete this order? This cannot be undone.")) onDelete(o.id); }} className="text-xs text-red-400 hover:text-red-600">Delete</button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded-xl hover:bg-gray-200">Close</button>
            <button onClick={onEdit} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700">Edit Order</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DO Review Item ────────────────────────────────────────────────
function DoReviewItem({ item, orders, onResolve, onDismiss, onView, warehouses, onAddToStock, companyId }) {
  const [linkSo, setLinkSo] = useState(item.so_number || "");
  const [selectedItemIdx, setSelectedItemIdx] = useState("");
  const [stockMode, setStockMode] = useState(false);
  const [stockProduct, setStockProduct] = useState("");
  const [stockWarehouse, setStockWarehouse] = useState("");
  const [stockQty, setStockQty] = useState(item.quantity || "1");
  const [productSearch, setProductSearch] = useState(item.item_name || "");
  const [productResults, setProductResults] = useState([]);
  const reasonMap = {
    showroom: { icon: "🏷️", label: "Showroom Stock", color: "bg-blue-50 border-blue-200 text-blue-700" },
    no_so: { icon: "❓", label: "No SO Found", color: "bg-gray-50 border-gray-200 text-gray-600" },
    so_not_found: { icon: "🔍", label: "SO Not in System", color: "bg-amber-50 border-amber-200 text-amber-700" },
    item_not_matched: { icon: "⚠️", label: "Item Not Matched", color: "bg-yellow-50 border-yellow-200 text-yellow-700" },
    duplicate_arrival: { icon: "🔁", label: "Duplicate Arrival", color: "bg-violet-50 border-violet-200 text-violet-700" },
  };
  const r = reasonMap[item.reason] || { icon: "❓", label: item.reason, color: "bg-gray-50 border-gray-200 text-gray-600" };
  const matchedOrder = orders.find(o => o.soNumber === linkSo.trim());
  const matchedItems = matchedOrder?.items || [];
  const needsMatch = ["so_not_found","no_so","item_not_matched"].includes(item.reason);
  const handleResolve = () => {
    if (!linkSo.trim()) return alert("Enter SO number.");
    if (!matchedOrder) return alert(`SO ${linkSo} not found.`);
    const code = selectedItemIdx !== "" ? (matchedItems[parseInt(selectedItemIdx)]?.itemCode || matchedItems[parseInt(selectedItemIdx)]?.itemName) : item.item_code;
    onResolve(item.id, linkSo.trim(), code);
  };
  return (
    <div className={`bg-white rounded-2xl border-2 overflow-hidden shadow-sm ${r.color.split(" ").slice(1,2)[0]} ${r.color.split(" ").slice(0,1)[0]}`}>
      <div className={`px-4 py-3 flex items-center justify-between flex-wrap gap-2 ${r.color}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span>{r.icon}</span>
          <span className="font-bold text-sm text-gray-800">{item.item_name || "-"}</span>
          {item.item_code && <span className="text-xs text-gray-500">[{item.item_code}]</span>}
          <Badge color="gray">{r.label}</Badge>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onDismiss(item.id)} className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-xl hover:bg-gray-50">Dismiss</button>
          {item.reason === "showroom"
            ? <button onClick={() => onResolve(item.id)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-xl hover:bg-blue-700">Acknowledge</button>
            : !needsMatch && <button onClick={() => onResolve(item.id, item.so_number, item.item_code)} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-xl hover:bg-emerald-700">Resolve</button>
          }
        </div>
      </div>
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Supplier",item.supplier],["DO #",item.do_number],["DO Date",item.do_date?fmt(item.do_date):"-"],["Qty",item.quantity]].map(([l,v]) => (
          <div key={l} className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-0.5">{l}</p><p className="text-sm font-semibold">{v||"-"}</p></div>
        ))}
        {item.so_number && (
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-0.5">SO from DO</p>
            <button onClick={() => { const o = orders.find(x => x.soNumber === item.so_number); if(o) onView(o); }} className="text-sm font-bold text-violet-700 hover:underline">{item.so_number}</button>
          </div>
        )}
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-0.5">Logged</p><p className="text-sm font-semibold">{item.created_at ? new Date(item.created_at).toLocaleDateString("en-MY") : "-"}</p></div>
      </div>
      {needsMatch && !stockMode && (
        <div className="px-4 pb-4 border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-gray-600">Match to Sales Order</p>
            <button onClick={() => setStockMode(true)} className="text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100">📦 Add to Stock Instead</button>
          </div>
          <div className="flex gap-2">
            <input value={linkSo} onChange={e => { setLinkSo(e.target.value); setSelectedItemIdx(""); }} placeholder="SO number" className="flex-1 border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
            {matchedOrder && <span className="text-xs text-emerald-600 font-medium self-center">✓ {matchedOrder.customerName}</span>}
            {linkSo && !matchedOrder && <span className="text-xs text-red-500 self-center">Not found</span>}
          </div>
          {matchedOrder && matchedItems.length > 0 && (
            <select value={selectedItemIdx} onChange={e => setSelectedItemIdx(e.target.value)} className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
              <option value="">Select item...</option>
              {matchedItems.map((oi, idx) => <option key={idx} value={idx}>{idx+1}. {oi.itemCode?`[${oi.itemCode}] `:""}{oi.itemName} ×{oi.unit||1}{oi.arrivalDate?` (arrived)`:""}</option>)}
            </select>
          )}
          {matchedOrder && <div className="flex justify-end"><button onClick={handleResolve} disabled={matchedItems.length>0&&selectedItemIdx===""} className="text-sm bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 disabled:opacity-40">Set Arrival & Resolve</button></div>}
        </div>
      )}
      {(needsMatch && stockMode) || item.reason === "showroom" ? (
        <div className="px-4 pb-4 border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-gray-600">📦 Add to Inventory Stock</p>
            {needsMatch && <button onClick={() => setStockMode(false)} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">← Match SO Instead</button>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Product (from master list)</label>
            <input value={productSearch} onChange={e => {
              const val = e.target.value;
              setProductSearch(val);
              clearTimeout(window._doProductSearchTimer);
              if (val.length >= 2) {
                window._doProductSearchTimer = setTimeout(async () => {
                  const res = await authFetch(`${BACKEND}/products?company_id=${companyId}&search=${encodeURIComponent(val)}&limit=10&is_active=true`);
                  const d = await res.json();
                  setProductResults(d.products || []);
                }, 300);
              } else setProductResults([]);
            }} placeholder="Search product code or name…" className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
            {productResults.length > 0 && (
              <div className="border border-gray-200 rounded-xl mt-1 max-h-32 overflow-y-auto">
                {productResults.map(p => (
                  <button key={p.id} onClick={() => { setStockProduct(p.id); setProductSearch(`${p.code} ${p.name} ${p.size||""}`); setProductResults([]); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-violet-50 ${stockProduct === p.id ? "bg-violet-50 font-medium" : ""}`}>
                    <span className="font-mono text-violet-700">{p.code}</span> {p.name} {p.size ? <span className="text-gray-400">· {p.size}</span> : ""}
                  </button>
                ))}
              </div>
            )}
            {!stockProduct && productSearch.length >= 2 && productResults.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">⚠️ Product not found in master list. Please add it in Products first.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Warehouse</label>
              <select value={stockWarehouse} onChange={e => setStockWarehouse(e.target.value)} className="w-full border rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300">
                <option value="">Select location</option>
                {(warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Quantity</label>
              <input type="number" value={stockQty} onChange={e => setStockQty(e.target.value)} className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={() => { if (!stockProduct || !stockWarehouse) { alert("Select product and warehouse"); return; } onAddToStock(item.id, stockProduct, stockWarehouse, stockQty); }}
              disabled={!stockProduct || !stockWarehouse}
              className="text-sm bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 disabled:opacity-40">Add to Stock & Resolve</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function App() {
  const { user, signOut, can, availableCompanies, activeCompanyId, switchCompany } = useAuth();
  const { loading: authLoading } = useAuth();
  const companyId = activeCompanyId || user?.company_id;
  const isMaster = user?.role === "master";
  const isSalesman = user?.role === "salesman";

  // ── State ───────────────────────────────────────────────────────
  const [page, setPage] = useState("overview");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_ORDER, items: [{ ...EMPTY_ITEM }] });
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [viewOrder, setViewOrder] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalResults, setGlobalResults] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);


  // Operations
  const [servicePending, setServicePending] = useState([]);
  const [spLoading, setSpLoading] = useState(false);
  const [doReview, setDoReview] = useState([]);
  const [doReviewLoading, setDoReviewLoading] = useState(false);
  const [convertModal, setConvertModal] = useState(null);
  const [convertRemark, setConvertRemark] = useState("");
  const [converting, setConverting] = useState(false);
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [opsTab, setOpsTab] = useState("service_pending");
  const [calMonthStr, setCalMonthStr] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`);
  const [calSalesman, setCalSalesman] = useState(isSalesman ? (user?.salesman_name || "") : "");
  const [services, setServices] = useState([]); // eslint-disable-line -- used in overview calendar
  const [servicesLoading, setServicesLoading] = useState(false); // eslint-disable-line
  const [supplierDOs, setSupplierDOs] = useState([]);
  const [doWarehouses, setDoWarehouses] = useState([]);
  const [supplierDOsLoading, setSupplierDOsLoading] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [doDateFrom, setDoDateFrom] = useState("");
  const [doDateTo, setDoDateTo] = useState("");
  const [viewPhoto, setViewPhoto] = useState(null);
  const [doDetail, setDoDetail] = useState(null);
  const [convertDate, setConvertDate] = useState("");
  const [serviceDateModal, setServiceDateModal] = useState(null); // { id, soNumber, svNumber, customerName }
  const [serviceDateValue, setServiceDateValue] = useState("");
  const [serviceDateSaving, setServiceDateSaving] = useState(false);

  const saveServiceDate = async () => {
    if (!serviceDateModal || !serviceDateValue) return;
    setServiceDateSaving(true);
    try {
      const res = await authFetch(`${BACKEND}/orders/${serviceDateModal.id}/set-date`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_date: serviceDateValue }),
      });
      if (!res.ok) { const d = await res.json(); alert("Failed: " + (d.error || "Unknown")); setServiceDateSaving(false); return; }
      setServices(prev => prev.map(o => o.id === serviceDateModal.id ? { ...o, deliveryDate: serviceDateValue } : o));
      setServiceDateModal(null); setServiceDateValue("");
    } catch (e) { alert("Failed: " + e.message); }
    setServiceDateSaving(false);
  };

  // ── Data loading ────────────────────────────────────────────────
  const loadOrders = async () => {
    if (orders.length === 0) setLoading(true); setError(null);
    let q = supabase.from("orders").select("*").order("created_at", { ascending: true });
    // Scope to the user's own company (master included). Only a user with no
    // company_id (super-admin) sees everything.
    if (companyId) q = q.eq("company_id", companyId);
    const { data, error: err } = await q;
    if (err) { setError("Failed to load orders: " + err.message); setLoading(false); return; }
    const all = (data || []).map(fromDb);
    if (isSalesman && user?.salesman_name) {
      const name = user.salesman_name.toLowerCase().trim();
      setOrders(all.filter(o => (o.salesman||"").split("/").map(s=>s.trim().toLowerCase()).includes(name)));
    } else { setOrders(all); }
    setLoading(false);

  };

  const loadServicePending = async () => {
    setSpLoading(true);
    try {
      const url = companyId ? `${BACKEND}/service-pending?company_id=${companyId}` : `${BACKEND}/service-pending`;
      const d = await authFetch(url).then(r => r.json());
      setServicePending(Array.isArray(d) ? d : []);
    } catch(e) {} setSpLoading(false);
  };

  const loadDoReview = async () => {
    setDoReviewLoading(true);
    try { const d = await authFetch(`${BACKEND}/do-review`).then(r => r.json()); setDoReview(Array.isArray(d) ? d : []); }
    catch(e) {} setDoReviewLoading(false);
  };

  const loadServices = async () => {
    setServicesLoading(true);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("company_id", companyId);
      if (isSalesman && user?.salesman_name) params.set("salesman", user.salesman_name);
      const d = await authFetch(`${BACKEND}/services?${params}`).then(r => r.json());
      setServices(Array.isArray(d) ? d.map(fromDb) : []);
    } catch(e) { console.error(e); }
    setServicesLoading(false);
  };

  const loadSupplierDOs = async () => {
    setSupplierDOsLoading(true);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("company_id", companyId);
      if (supplierFilter) params.set("supplier", supplierFilter);
      if (doDateFrom) params.set("from_date", doDateFrom);
      if (doDateTo) params.set("to_date", doDateTo);
      const d = await authFetch(`${BACKEND}/supplier-deliveries?${params}`).then(r => r.json());
      setSupplierDOs(Array.isArray(d) ? d : []);
    } catch(e) { console.error(e); }
    setSupplierDOsLoading(false);
  };

  // Load data once user is authenticated and profile is loaded
  useEffect(() => {
    if (!user) return; // wait for auth
    loadOrders();
    loadServicePending();
    loadDoReview();
    loadServices();
    if (companyId) authFetch(`${BACKEND}/warehouses?company_id=${companyId}`).then(r=>r.json()).then(d=>setDoWarehouses(d.warehouses||[]));
  }, [user?.id, user?.company_id, user?.role]); // eslint-disable-line

  // ── Derived data ────────────────────────────────────────────────

  // Ready to deliver logic
  const readyOrders = useMemo(() => orders.filter(o => {
    if (o.status === "Delivered" || o.status === "Serviced") return false;
    if (o.type === "Service") return false;
    const items = o.items || [];
    return items.length > 0 && items.some(i => i.arrivalDate);
  }), [orders]);

  const todayOrders = useMemo(() => orders.filter(o => o.deliveryDate === todayStr), [orders]);

  // ── Actions ─────────────────────────────────────────────────────
  const handleView = o => setViewOrder(o);
  const handleEdit = o => { setForm({ ...o, items: o.items?.length ? o.items : [{ ...EMPTY_ITEM }] }); setEditId(o.id); setShowForm(true); };
  const handleDelete = async id => {
    try {
      const res = await authFetch(`${BACKEND}/orders/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); alert("Failed: " + (d.error || "Unknown")); return; }
      setOrders(p => p.filter(o => o.id !== id)); setViewOrder(null);
    } catch (e) { alert("Failed to delete: " + e.message); }
  };
  const handleSubmit = async () => {
    if (!form.soNumber) return alert("SO Number required.");
    setSaving(true);
    try {
      const items = (form.items || []).filter(i => i.itemName).map(i => ({
        product_name: i.itemName, product_code: i.itemCode, quantity: Number(i.unit) || 1,
        unit_price: Number(i.unitPrice) || 0, supplier_name: i.supplier || null,
      }));
      const body = {
        order_number: form.soNumber, customer_name: form.customerName, customer_contact: form.contact,
        customer_address: form.address, salesman_names: form.salesman, delivery_date: form.deliveryDate || null,
        delivery_time_slot: form.timeSlot || null, delivery_type: form.type || "Delivery",
        remark: form.remark || null, status: "confirmed",
        subtotal: Number(form.orderAmount) || 0, deposit: (Number(form.orderAmount) || 0) - (Number(form.balance) || 0),
        items,
      };
      let res;
      if (editId) {
        const listRes = await authFetch(`${BACKEND}/sales-orders?search=${encodeURIComponent(form.soNumber)}&limit=1`);
        const listData = await listRes.json();
        const soId = listData?.orders?.[0]?.id;
        if (soId) {
          res = await authFetch(`${BACKEND}/sales-orders/${soId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        }
      } else {
        res = await authFetch(`${BACKEND}/sales-orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }
      if (res && !res.ok) { const d = await res.json(); alert("Error: " + (d.error || "Unknown")); setSaving(false); return; }
      await loadOrders();
    } catch (e) { alert("Error: " + e.message); }
    setForm({ ...EMPTY_ORDER, items: [{ ...EMPTY_ITEM }] }); setEditId(null); setShowForm(false); setSaving(false);
  };

  const resolveDoReview = async (id, soNumber=null, itemCode=null) => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const res = await fetch(`${BACKEND}/do-review/${id}/resolve`, { method:"PATCH", headers:{"Content-Type":"application/json", Authorization: `Bearer ${token}`}, body: JSON.stringify({ so_number: soNumber, item_code: itemCode }) }).then(r=>r.json());
    if (res.success) { loadDoReview(); loadOrders(); } else alert("Failed: "+(res.error||"Unknown"));
  };
  const addToStockDoReview = async (id, product_id, warehouse_id, quantity) => {
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const res = await fetch(`${BACKEND}/do-review/${id}/add-to-stock`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ product_id, warehouse_id, quantity: Number(quantity) || 1 }) });
    const d = await res.json();
    if (d.success) { loadDoReview(); alert("Added to stock & resolved"); } else alert(d.error || "Failed");
  };

  const dismissDoReview = async id => {
    if (!window.confirm("Dismiss this item?")) return;
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const res = await fetch(`${BACKEND}/do-review/${id}/dismiss`, { method:"PATCH", headers:{Authorization:`Bearer ${token}`} }).then(r=>r.json());
    if (res.success) loadDoReview();
  };
  const confirmConvert = async () => {
    if (!convertModal || converting) return;
    setConverting(true);
    const d = await fetch(`${BACKEND}/service-pending/${convertModal.id}/convert`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ remark: convertRemark, delivery_date: convertDate||null }) }).then(r=>r.json());
    if (d.success) { setConvertModal(null); setConvertRemark(""); setConvertDate(""); loadServicePending(); loadOrders(); alert(`Converted: ${d.svNumber}`); }
    else alert("Failed: "+(d.error||"Unknown"));
    setConverting(false);
  };
  const recordPayment = async () => {
    if (!paymentModal || !paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) return alert("Invalid amount.");
    setPaymentSaving(true);
    try {
      const res = await authFetch(`${BACKEND}/payments/record`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: paymentModal.id, amount, payment_method: "cash" }),
      });
      if (!res.ok) { const d = await res.json(); alert("Failed: " + (d.error || "Unknown")); setPaymentSaving(false); return; }
      const newBalance = Math.max(0, parseFloat(paymentModal.balance||0) - amount).toFixed(2);
      setOrders(p => p.map(o => o.id===paymentModal.id ? {...o,balance:newBalance} : o));
      setPaymentModal(null); setPaymentAmount("");
    } catch (e) { alert("Failed: " + e.message); }
    setPaymentSaving(false);
  };
  const handleGlobalSearch = v => {
    setGlobalSearch(v);
    if (!v.trim()) { setGlobalResults([]); return; }
    const q = v.toLowerCase();
    setGlobalResults(orders.filter(o => o.soNumber?.toLowerCase().includes(q) || o.customerName?.toLowerCase().includes(q) || o.contact?.includes(q) || o.items?.some(i => i.itemName?.toLowerCase().includes(q))));
  };

  const setItem = (idx, k, v) => setForm(p => ({ ...p, items: p.items.map((it, i) => i===idx ? {...it,[k]:v} : it) }));
  const addItem = () => setForm(p => ({ ...p, items: [...p.items, { ...EMPTY_ITEM }] }));
  const removeItem = idx => setForm(p => ({ ...p, items: p.items.filter((_,i) => i!==idx) }));

  // ── Auth guards ─────────────────────────────────────────────────
  if (window.location.pathname === "/reset-password") return <ResetPasswordPage />;
  if (authLoading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center"><div className="text-5xl mb-3">⚡</div><p className="text-gray-500 font-medium">Loading PulseOS...</p></div></div>;
  if (!user) return <LoginPage />;
  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center"><div className="text-5xl mb-3">⚡</div><p className="text-gray-500 font-medium">Loading your data...</p></div></div>;
  if (error) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center bg-white rounded-2xl shadow p-8"><div className="text-4xl mb-3">⚠️</div><p className="text-red-600 mb-4">{error}</p><button onClick={loadOrders} className="bg-violet-600 text-white px-4 py-2 rounded-xl text-sm">Retry</button></div></div>;

  // ── Nav items visible to this user ──────────────────────────────
  const visibleNav = NAV.filter(n => {
    if (n.id === "operations") return can("viewServicePending") || can("viewDoReview");
    if (n.id === "team") return can("manageUsers");
    if (n.manageOnly) return ["master","manager","company_admin"].includes(user?.role);
    if (n.canKey) return can(n.canKey);
    return true;
  });

  // ── Sidebar ─────────────────────────────────────────────────────
  const Sidebar = ({ mobile = false }) => (
    <div className={`flex flex-col h-full ${mobile ? "" : "w-60"}`} style={{ background: "#0F0A1E" }}>
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-white font-bold text-lg">⚡</div>
          <span className="text-white font-bold text-lg tracking-wide">PulseOS</span>
        </div>
        {availableCompanies.length > 1 ? (
          <select value={activeCompanyId || ""} onChange={async e => { const ok = await switchCompany(e.target.value); if (ok) window.location.reload(); }}
            className="w-full mt-2 px-2 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-purple-200 border border-white/10 focus:outline-none focus:border-violet-400 cursor-pointer">
            {availableCompanies.map(c => <option key={c.companyId} value={c.companyId} className="bg-gray-900 text-white">{c.companyName} ({c.roleName})</option>)}
          </select>
        ) : (
          <p className="text-xs mt-2 font-medium truncate" style={{color:"#C4B5FD"}}>{user?.companies?.name || "V Haus Living"}</p>
        )}
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNav.map(n => (
          <button key={n.id} onClick={() => { setPage(n.id); if(mobile) setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${page===n.id ? "bg-violet-600 text-white shadow-lg shadow-violet-900/50" : "text-purple-300 hover:bg-white/5 hover:text-white"}`}>
            <span className="text-base w-5 text-center">{n.icon}</span>
            <span>{n.label}</span>
            {n.id === "operations" && (servicePending.length + doReview.length) > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{servicePending.length + doReview.length}</span>
            )}
            {n.id === "ready" && readyOrders.length > 0 && (
              <span className="ml-auto bg-amber-400 text-gray-900 text-xs font-bold px-1.5 py-0.5 rounded-full">{readyOrders.length}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-violet-700 flex items-center justify-center text-violet-200 font-bold text-sm flex-shrink-0">{user?.name?.charAt(0)?.toUpperCase()}</div>
          <div className="min-w-0">
            <p className="text-white text-xs font-semibold truncate">{user?.name}</p>
            <p className="text-xs truncate" style={{color:"#9F7AEA"}}>{roleLabel(user?.role)}</p>
          </div>
        </div>
        <button onClick={signOut} className="w-full text-xs py-2 rounded-xl font-medium transition-colors" style={{color:"#9F7AEA",background:"rgba(255,255,255,0.05)"}} onMouseEnter={e=>e.target.style.background="rgba(255,255,255,0.1)"} onMouseLeave={e=>e.target.style.background="rgba(255,255,255,0.05)"}>Sign out</button>
      </div>
    </div>
  );

  // ── Page content ────────────────────────────────────────────────
  const balanceOrders = orders.filter(o => parseFloat(o.balance) > 0).sort((a,b) => new Date(a.deliveryDate)-new Date(b.deliveryDate));
  const flaggedOrders = orders.filter(o => o.status === "Flagged");

  const renderPage = () => {
    // OVERVIEW
    if (page === "overview") return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Good {now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="text-gray-400 text-sm mt-1">{new Date().toLocaleDateString("en-MY", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Today's Deliveries" value={todayOrders.length} sub={`${todayOrders.filter(o=>o.status==="Delivered").length} delivered`} accent onClick={() => setPage("deliveries")} />
          <StatCard label="Ready to Deliver" value={readyOrders.filter(o=>!o.deliveryDate).length} sub="items arrived, no date" onClick={() => setPage("ready")} />
          <StatCard label="Outstanding Balance" value={`RM ${balanceOrders.reduce((s,o)=>s+parseFloat(o.balance||0),0).toLocaleString()}`} sub={`${balanceOrders.length} orders`} />
          <StatCard label="Flagged Orders" value={flaggedOrders.length} sub="need attention" onClick={() => setPage("orders")} />
        </div>

        {/* Today's orders */}
        {todayOrders.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-800">Today's Deliveries</h2>
              <Badge color="violet">{todayStr}</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {todayOrders.map(o => (
                <div key={o.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:border-violet-200 transition-colors" onClick={() => handleView(o)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-violet-700 text-sm">{o.soNumber}</span>
                        {o.type === "Service" && <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Service</span>}
                      </div>
                      <p className="font-semibold text-gray-800 text-sm">{o.customerName}</p>
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{(o.address || "").replace(/ADDRESS \d+:\s*/gi, "").trim()}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor(o.status)}`}>{o.status}</span>
                      {o.timeSlot && <Badge color="violet">⏰ {o.timeSlot}</Badge>}
                      {parseFloat(o.balance) > 0 && <span className="text-xs font-bold text-red-600">RM {o.balance}</span>}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {o.items?.filter(i=>i.itemName).map((item,i) => (
                      <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.arrivalDate ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                        {item.arrivalDate ? "✓" : "·"} {item.itemName}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Next 3 days */}
        <div>
          <h2 className="font-bold text-gray-800 mb-3">Next 3 Days</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[1,2,3].map(offset => {
              const d = new Date(now); d.setDate(d.getDate()+offset);
              const ds = d.toISOString().split("T")[0];
              const dayOrders = orders.filter(o => o.deliveryDate === ds);
                  const someNotArrived = dayOrders.some(o => o.items?.some(i => !i.arrivalDate));
              return (
                <div key={ds} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-bold text-gray-800 text-sm">{d.toLocaleDateString("en-MY",{weekday:"long"})}</p>
                      <p className="text-xs text-gray-400">{fmt(ds)}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${dayOrders.length > 0 ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-400"}`}>{dayOrders.length} orders</span>
                  </div>
                  {dayOrders.length > 0 && (
                    <div className="mt-2">
                      {someNotArrived
                        ? <p className="text-xs text-amber-600 font-medium">⚠️ Some items not arrived</p>
                        : <p className="text-xs text-emerald-600 font-medium">✅ All items ready</p>}
                      <div className="mt-1.5 space-y-1">
                        {dayOrders.map(o => (
                          <button key={o.id} onClick={() => handleView(o)} className="w-full text-left text-xs bg-gray-50 rounded-lg px-2 py-1.5 hover:bg-violet-50">
                            <span className="font-semibold text-violet-700">{o.soNumber}</span> — {o.customerName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {dayOrders.length === 0 && <p className="text-xs text-gray-300 mt-1">No deliveries scheduled</p>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly Calendar */}
        {(() => {
          const [calYear, calMonth] = calMonthStr.split("-").map(Number);
          const firstDow = (new Date(calYear, calMonth - 1, 1).getDay() + 6) % 7;
          const lastDay = new Date(calYear, calMonth, 0).getDate();
          const cells = [];
          for (let i = 0; i < firstDow; i++) cells.push(null);
          for (let d = 1; d <= lastDay; d++) cells.push(d);
          while (cells.length % 7 !== 0) cells.push(null);
          const weeks = [];
          for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
          const getDs = d => d ? `${calYear}-${String(calMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}` : null;
          const calSalesmen = [...new Set(orders.map(o => o.salesman).filter(Boolean))].sort();
          // Pre-build date→orders map (O(n) instead of O(n*days))
          const ordersByDate = {};
          orders.forEach(o => { if (o.deliveryDate) { if (!ordersByDate[o.deliveryDate]) ordersByDate[o.deliveryDate] = []; ordersByDate[o.deliveryDate].push(o); } });
          const ordersOnDay = d => ordersByDate[getDs(d)] || [];
          const isMyOrder = o => {
            if (!calSalesman) return false;
            return (o.salesman || "").split("/").map(s => s.trim().toLowerCase()).includes(calSalesman.toLowerCase());
          };
          return (
            <div>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-bold text-gray-800">Monthly Overview</h2>
                  {!isSalesman && (
                    <select value={calSalesman} onChange={e => setCalSalesman(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white">
                      <option value="">All salesmen</option>
                      {calSalesmen.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  {calSalesman && <span className="text-xs text-violet-600 font-medium">Highlighting: {calSalesman}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { const [y,m] = calMonthStr.split("-").map(Number); const pm = m===1?12:m-1; const py = m===1?y-1:y; setCalMonthStr(`${py}-${String(pm).padStart(2,"0")}`); }} className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 font-bold">‹</button>
                  <span className="text-sm font-semibold text-gray-700 min-w-32 text-center">{new Date(calYear, calMonth-1, 1).toLocaleString("en-MY",{month:"long",year:"numeric"})}</span>
                  <button onClick={() => { const [y,m] = calMonthStr.split("-").map(Number); const nm = m===12?1:m+1; const ny = m===12?y+1:y; setCalMonthStr(`${ny}-${String(nm).padStart(2,"0")}`); }} className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 font-bold">›</button>
                  <button onClick={() => setCalMonthStr(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`)} className="text-xs text-violet-600 hover:underline px-2">Today</button>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Day headers */}
                <div className="grid grid-cols-7 border-b border-gray-100">
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
                    <div key={d} className={`py-2 text-center text-xs font-bold ${d==="Sat"||d==="Sun" ? "text-violet-400" : "text-gray-400"}`}>{d}</div>
                  ))}
                </div>
                {/* Weeks */}
                {weeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-0">
                    {week.map((day, di) => {
                      const ds = getDs(day);
                      const dayOrders = day ? ordersOnDay(day) : [];
                      const deliveries = dayOrders.filter(o => o.type === "Delivery");
                      const services = dayOrders.filter(o => o.type === "Service");
                      const isToday = ds === todayStr;
                      const isEmpty = day && dayOrders.length === 0;
                      const isWeekend = di >= 5;
                      const hasUnconfirmed = deliveries.some(o => o.status === "Pending");
                      const allDelivered = deliveries.length > 0 && deliveries.every(o => o.status === "Delivered");
                      return (
                        <div key={di} className={`min-h-20 p-1.5 border-r border-gray-50 last:border-r-0 cursor-pointer transition-colors hover:bg-violet-50 ${!day ? "bg-gray-50/50" : isToday ? "bg-violet-50" : isWeekend ? "bg-gray-50/30" : ""}`}
                          onClick={() => { if (ds) { setPage("orders"); } }}>
                          {day && (
                            <>
                              <div className="flex items-center justify-between mb-1">
                                <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-violet-600 text-white" : isWeekend ? "text-violet-400" : "text-gray-500"}`}>{day}</span>
                                {dayOrders.length > 0 && (
                                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${allDelivered ? "bg-emerald-100 text-emerald-700" : hasUnconfirmed ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{dayOrders.length}</span>
                                )}
                              </div>
                              {isEmpty && <div className="mt-1 text-center"><span className="text-xs text-gray-200">—</span></div>}
                              {deliveries.length > 0 && (
                                <div className="space-y-0.5">
                                  {deliveries.slice(0,3).map(o => {
                                    const mine = isMyOrder(o);
                                    const highlight = calSalesman ? mine : true;
                                    return (
                                      <div key={o.id} onClick={e=>{e.stopPropagation();handleView(o);}}
                                        className={`text-xs px-1 py-0.5 rounded font-medium truncate leading-tight transition-opacity hover:opacity-80 ${
                                          o.status==="Delivered" ? (highlight?"bg-emerald-100 text-emerald-700":"bg-emerald-50 text-emerald-300")
                                          : o.status==="Flagged" ? (highlight?"bg-red-100 text-red-600":"bg-red-50 text-red-300")
                                          : highlight ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-400"
                                        } ${!highlight?"opacity-50":""}`}>
                                        {mine && calSalesman && <span className="mr-0.5">★</span>}{o.soNumber}
                                      </div>
                                    );
                                  })}
                                  {deliveries.length > 3 && <div className="text-xs text-gray-400 px-1">+{deliveries.length - 3} more</div>}
                                </div>
                              )}
                              {services.length > 0 && (
                                <div className="mt-0.5">
                                  {services.slice(0,1).map(o => (
                                    <div key={o.id} onClick={e=>{e.stopPropagation();handleView(o);}} className="text-xs px-1 py-0.5 rounded font-medium truncate leading-tight bg-indigo-100 text-indigo-700 hover:opacity-80">
                                      🔧 {o.soNumber}
                                    </div>
                                  ))}
                                  {services.length > 1 && <div className="text-xs text-gray-400 px-1">+{services.length-1} svc</div>}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-violet-100"></div><span className="text-xs text-gray-400">Pending delivery</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-100"></div><span className="text-xs text-gray-400">Delivered</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-indigo-100"></div><span className="text-xs text-gray-400">Service</span></div>
                {calSalesman && <div className="flex items-center gap-1.5"><span className="text-xs text-violet-600">★</span><span className="text-xs text-gray-400">{calSalesman}'s orders · others dimmed</span></div>}
                <span className="text-xs text-gray-300">· Click any date to see orders</span>
              </div>
            </div>
          );
        })()}

        {/* Outstanding balances */}
        {balanceOrders.length > 0 && (
          <div>
            <h2 className="font-bold text-gray-800 mb-3">Outstanding Balances</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 border-b border-gray-100">{["SO","Customer","Salesman","Amount","Balance","Delivery","Aging"].map(h=><th key={h} className="px-4 py-2.5 text-left font-semibold text-gray-500">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {balanceOrders.map((o,i) => {
                      const aging = o.deliveryDate ? Math.floor((now-new Date(o.deliveryDate))/(86400000)) : null;
                      return (
                        <tr key={i} className="hover:bg-violet-50 cursor-pointer" onClick={() => handleView(o)}>
                          <td className="px-4 py-3 font-bold text-violet-700">{o.soNumber}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{o.customerName}</td>
                          <td className="px-4 py-3 text-gray-500">{o.salesman||"-"}</td>
                          <td className="px-4 py-3 text-gray-600">RM {o.orderAmount}</td>
                          <td className="px-4 py-3 font-bold text-red-600">RM {o.balance}</td>
                          <td className="px-4 py-3 text-gray-500">{o.deliveryDate ? fmt(o.deliveryDate) : <span className="italic text-gray-300">TBC</span>}</td>
                          <td className={`px-4 py-3 font-semibold ${aging>30?"text-red-600":aging>14?"text-amber-600":"text-gray-500"}`}>{aging!==null?`${aging}d`:"-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );

    // ORDERS (unified — reads from sales_orders)
    if (page === "orders") return <OrdersPage />;

    // DELIVERIES
    if (page === "deliveries") return (
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-4">Deliveries</h1>
        <DeliverySchedule readOnly={!can("editSchedule")} companyId={companyId} isMaster={isMaster} currentUser={user} />
      </div>
    );

    // READY TO DELIVER
    if (page === "ready") return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ready to Deliver</h1>
          <p className="text-sm text-gray-400 mt-1">Orders where items have arrived at the warehouse</p>
        </div>

        {/* Full ready */}
        {(() => {
          const full = readyOrders.filter(o => o.items?.length>0 && o.items.every(i=>i.arrivalDate));
          const partial = readyOrders.filter(o => o.items?.some(i=>i.arrivalDate) && o.items.some(i=>!i.arrivalDate));
          const waiting = orders.filter(o => o.status!=="Delivered"&&o.status!=="Serviced"&&o.type!=="Service"&&o.items?.length>0&&o.items.every(i=>!i.arrivalDate));
          return (
            <>
              {full.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <h2 className="font-bold text-gray-800">All items arrived ({full.length})</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {full.map(o => (
                      <div key={o.id} className="bg-white rounded-2xl border-2 border-emerald-200 shadow-sm p-4 cursor-pointer hover:border-emerald-400 transition-colors" onClick={() => handleView(o)}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div><span className="font-bold text-violet-700 text-sm">{o.soNumber}</span><p className="font-semibold text-gray-800 text-sm mt-0.5">{o.customerName}</p></div>
                          <div>{o.deliveryDate ? <Badge color="blue">📅 {fmt(o.deliveryDate)}</Badge> : <Badge color="amber">No date set</Badge>}</div>
                        </div>
                        <p className="text-xs text-gray-400 truncate mb-2">{(o.address || "").replace(/ADDRESS \d+:\s*/gi, "").trim()}</p>
                        <div className="space-y-1">
                          {o.items?.filter(i=>i.itemName).map((item,i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-xs flex-shrink-0">✓</span>
                              <span className="text-gray-700 font-medium truncate">{item.itemName}</span>
                              <span className="text-gray-400 flex-shrink-0">{fmt(item.arrivalDate)}</span>
                            </div>
                          ))}
                        </div>
                        {isSalesman && can("recordPayment") && parseFloat(o.balance) > 0 && (
                          <button onClick={e=>{e.stopPropagation();setPaymentModal(o);}} className="mt-3 w-full text-xs bg-emerald-600 text-white py-1.5 rounded-xl hover:bg-emerald-700">💰 Record Payment</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {partial.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                    <h2 className="font-bold text-gray-800">Partial arrival ({partial.length})</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {partial.map(o => (
                      <div key={o.id} className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm p-4 cursor-pointer hover:border-amber-400 transition-colors" onClick={() => handleView(o)}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div><span className="font-bold text-violet-700 text-sm">{o.soNumber}</span><p className="font-semibold text-gray-800 text-sm mt-0.5">{o.customerName}</p></div>
                          {o.deliveryDate ? <Badge color="blue">📅 {fmt(o.deliveryDate)}</Badge> : <Badge color="amber">No date</Badge>}
                        </div>
                        <p className="text-xs text-gray-400 truncate mb-2">{(o.address || "").replace(/ADDRESS \d+:\s*/gi, "").trim()}</p>
                        <div className="space-y-1">
                          {o.items?.filter(i=>i.itemName).map((item,i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className={`w-4 h-4 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${item.arrivalDate?"bg-emerald-100 text-emerald-600":"bg-gray-100 text-gray-400"}`}>{item.arrivalDate?"✓":"·"}</span>
                              <span className={`font-medium truncate ${item.arrivalDate?"text-gray-700":"text-gray-400"}`}>{item.itemName}</span>
                              {item.arrivalDate && <span className="text-gray-400 flex-shrink-0">{fmt(item.arrivalDate)}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {waiting.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-gray-300"></div>
                    <h2 className="font-bold text-gray-800">Waiting for items ({waiting.length})</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {waiting.map(o => (
                      <div key={o.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer opacity-60 hover:opacity-100 transition-opacity" onClick={() => handleView(o)}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div><span className="font-bold text-violet-700 text-sm">{o.soNumber}</span><p className="font-semibold text-gray-800 text-sm mt-0.5">{o.customerName}</p></div>
                        </div>
                        <p className="text-xs text-gray-400 truncate">{o.items?.filter(i=>i.itemName).map(i=>i.itemName).join(", ")}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {readyOrders.length === 0 && waiting.length === 0 && (
                <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-3">📦</div><p className="font-medium">No orders to show</p></div>
              )}
            </>
          );
        })()}
      </div>
    );

    // OPERATIONS
    if (page === "operations") return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Operations</h1>
        <div className="flex gap-2">
          {can("viewServicePending") && <button onClick={()=>setOpsTab("service_pending")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${opsTab==="service_pending"?"bg-violet-600 text-white":"bg-white border border-gray-200 text-gray-600 hover:border-violet-300"}`}>🔧 Service Pending {servicePending.length>0&&<span className="ml-1 bg-red-100 text-red-700 text-xs font-bold px-1.5 rounded-full">{servicePending.length}</span>}</button>}
          {can("viewDoReview") && <button onClick={()=>setOpsTab("do_review")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${opsTab==="do_review"?"bg-violet-600 text-white":"bg-white border border-gray-200 text-gray-600 hover:border-violet-300"}`}>📦 DO Review {doReview.length>0&&<span className="ml-1 bg-orange-100 text-orange-700 text-xs font-bold px-1.5 rounded-full">{doReview.length}</span>}</button>}
          <button onClick={()=>{ setOpsTab("supplier_do"); loadSupplierDOs(); }} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${opsTab==="supplier_do"?"bg-violet-600 text-white":"bg-white border border-gray-200 text-gray-600 hover:border-violet-300"}`}>🚚 Supplier DOs</button>
        </div>

        {opsTab === "service_pending" && (
          <div>
            {spLoading ? <div className="space-y-2 py-4">{[1,2,3].map(i=><div key={i} className="h-14 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
            : servicePending.length === 0
            ? <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-3">✅</div><p className="font-medium">All deliveries settled</p></div>
            : <div className="space-y-3">{servicePending.map(sp => (
                <div key={sp.id} className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm overflow-hidden">
                  <div className="bg-amber-50 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-violet-700 text-sm">SO {sp.so_number}</span>
                      <Badge color="amber">Not Settled</Badge>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { if(window.confirm("Remove?")) fetch(`${BACKEND}/service-pending/${sp.id}`,{method:"DELETE"}).then(()=>loadServicePending()); }} className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-xl hover:bg-red-50">Remove</button>
                      <button onClick={() => { setConvertModal(sp); setConvertRemark(""); }} className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-xl hover:bg-amber-600">Convert to Service</button>
                    </div>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[["Driver",sp.driver],["Helper",sp.helper],["Date",sp.date?fmt(sp.date):"-"],["Reported",sp.created_at?new Date(sp.created_at).toLocaleDateString("en-MY"):"-"]].map(([l,v])=>(
                      <div key={l} className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-0.5">{l}</p><p className="text-sm font-semibold">{v||"-"}</p></div>
                    ))}
                    {sp.note && <div className="col-span-2 sm:col-span-4 bg-amber-50 border border-amber-200 rounded-xl p-3"><p className="text-xs font-bold text-amber-700 mb-1">Issue</p><p className="text-sm text-gray-800">{sp.note}</p></div>}
                  </div>
                </div>
              ))}</div>}
          </div>
        )}

        {opsTab === "supplier_do" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <input value={supplierFilter} onChange={e=>setSupplierFilter(e.target.value)} placeholder="Supplier name..." className="col-span-2 sm:col-span-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                <input type="date" value={doDateFrom} onChange={e=>setDoDateFrom(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                <input type="date" value={doDateTo} onChange={e=>setDoDateTo(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                <button onClick={loadSupplierDOs} className="bg-violet-600 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-violet-700">Search</button>
              </div>
            </div>
            {supplierDOsLoading ? <div className="space-y-2 py-4">{[1,2,3].map(i=><div key={i} className="h-14 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
            : supplierDOs.length === 0
            ? <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-3">📦</div><p className="font-medium">No supplier DOs found</p><p className="text-sm mt-1">DOs are logged automatically when warehouse scans them in Telegram</p></div>
            : <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-50 border-b border-gray-100">{["Supplier","DO #","DO Date","Reference","Review Status","Photo","Logged",""].map(h=><th key={h} className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {supplierDOs.map((d,i)=>(
                        <tr key={i} className="hover:bg-gray-50 cursor-pointer" onClick={async ()=>{
                          const res = await authFetch(`${BACKEND}/supplier-deliveries/${d.id}`);
                          const data = await res.json();
                          setDoDetail({ ...d, ...data.delivery, items: data.items || [] });
                        }}>
                          <td className="px-4 py-3 font-semibold text-gray-800">{d.supplier||"-"}</td>
                          <td className="px-4 py-3 text-violet-700 font-medium">{d.do_number||"-"}</td>
                          <td className="px-4 py-3 text-gray-600">{d.do_date?fmt(d.do_date):"-"}</td>
                          <td className="px-4 py-3 text-gray-500">{d.supplier_reference||"-"}</td>
                          <td className="px-4 py-3">{doReview.filter(r=>r.do_number===d.do_number).length>0?<Badge color="amber">{doReview.filter(r=>r.do_number===d.do_number).length} pending</Badge>:<Badge color="emerald">All matched</Badge>}</td>
                          <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>{d.photo_url?<button onClick={()=>setViewPhoto(d.photo_url)} className="text-violet-600 hover:underline font-medium">View 📷</button>:<span className="text-gray-300">-</span>}</td>
                          <td className="px-4 py-3 text-gray-400">{d.created_at?new Date(d.created_at).toLocaleDateString("en-MY"):"-"}</td>
                          <td className="px-4 py-3 whitespace-nowrap" onClick={e=>e.stopPropagation()}>
                            <button onClick={async ()=>{
                              if (!window.confirm(`Delete DO #${d.do_number||""}? This also removes related review items.`)) return;
                              const token = (await supabase.auth.getSession()).data?.session?.access_token;
                              await fetch(`${BACKEND}/supplier-deliveries/${d.id}`, { method:"DELETE", headers:{Authorization:`Bearer ${token}`} });
                              loadSupplierDOs(); loadDoReview();
                            }} className="text-xs text-red-500 hover:underline">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>}
          </div>
        )}

        {/* DO Detail Drawer */}
        {doDetail && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDoDetail(null)} />
            <div className="relative w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">DO #{doDetail.do_number || "-"}</h2>
                  <p className="text-sm text-gray-500">{doDetail.supplier} · {doDetail.do_date ? fmt(doDetail.do_date) : "-"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {doDetail.photo_url && <button onClick={() => setViewPhoto(doDetail.photo_url)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-violet-100">📷 Photo</button>}
                  <button onClick={() => setDoDetail(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                </div>
              </div>
              <div className="px-6 py-4 space-y-4">
                {/* Editable header */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">DO Number</label>
                    <input value={doDetail.do_number || ""} onChange={e => setDoDetail(prev => ({ ...prev, do_number: e.target.value }))}
                      onBlur={async () => { const token = (await supabase.auth.getSession()).data?.session?.access_token; await fetch(`${BACKEND}/supplier-deliveries/${doDetail.id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ do_number: doDetail.do_number, supplier: doDetail.supplier, do_date: doDetail.do_date, supplier_reference: doDetail.supplier_reference }) }); loadSupplierDOs(); }}
                      className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
                    <input value={doDetail.supplier || ""} onChange={e => setDoDetail(prev => ({ ...prev, supplier: e.target.value }))}
                      onBlur={async () => { const token = (await supabase.auth.getSession()).data?.session?.access_token; await fetch(`${BACKEND}/supplier-deliveries/${doDetail.id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ do_number: doDetail.do_number, supplier: doDetail.supplier, do_date: doDetail.do_date, supplier_reference: doDetail.supplier_reference }) }); loadSupplierDOs(); }}
                      className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Reference</label>
                    <input value={doDetail.supplier_reference || ""} onChange={e => setDoDetail(prev => ({ ...prev, supplier_reference: e.target.value }))}
                      onBlur={async () => { const token = (await supabase.auth.getSession()).data?.session?.access_token; await fetch(`${BACKEND}/supplier-deliveries/${doDetail.id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ do_number: doDetail.do_number, supplier: doDetail.supplier, do_date: doDetail.do_date, supplier_reference: doDetail.supplier_reference }) }); loadSupplierDOs(); }}
                      className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  </div>
                </div>

                {/* Items list */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-gray-700">Items ({doDetail.items?.length || 0})</h3>
                    <button onClick={() => { setDoDetail(null); setPage("warehouse"); }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100">🏭 Go to Warehouse</button>
                  </div>
                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="px-3 py-2 text-left">SO #</th>
                          <th className="px-3 py-2 text-center">Qty</th>
                          <th className="px-3 py-2 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(doDetail.items || []).length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-xs">No items recorded</td></tr>}
                        {(doDetail.items || []).map((item, idx) => {
                          const reasonStyle = {
                            showroom: "bg-blue-100 text-blue-700",
                            no_so: "bg-gray-100 text-gray-600",
                            so_not_found: "bg-amber-100 text-amber-700",
                            item_not_matched: "bg-yellow-100 text-yellow-700",
                            duplicate_arrival: "bg-violet-100 text-violet-700",
                          };
                          const isResolved = item.status === "Resolved" || item.status === "Dismissed";
                          return (
                            <tr key={item.id || idx} className={`border-t border-gray-50 ${isResolved ? "opacity-50" : ""}`}>
                              <td className="px-3 py-2">
                                <p className="font-medium text-gray-900">{item.item_name || "-"}</p>
                                {item.item_code && <p className="text-xs text-violet-600 font-mono">{item.item_code}</p>}
                              </td>
                              <td className="px-3 py-2">
                                {item.so_number ? <span className="text-xs font-mono text-violet-700">{item.so_number}</span> : <span className="text-xs text-gray-400">—</span>}
                              </td>
                              <td className="px-3 py-2 text-center text-xs">{item.quantity || "-"}</td>
                              <td className="px-3 py-2 text-center">
                                {isResolved
                                  ? <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">{item.status}</span>
                                  : <span className={`px-2 py-0.5 rounded-full text-xs ${reasonStyle[item.reason] || "bg-gray-100 text-gray-600"}`}>{item.reason?.replace(/_/g, " ") || "pending"}</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {opsTab === "do_review" && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{doReview.length} items pending review</p>
              <div className="flex gap-2">
                <label className="text-xs border border-violet-200 bg-violet-50 text-violet-700 px-3 py-1.5 rounded-xl hover:bg-violet-100 cursor-pointer flex items-center gap-1">
                  📤 Upload DO
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const token = (await supabase.auth.getSession()).data?.session?.access_token;
                    const fd = new FormData();
                    fd.append("file", file);
                    const btn = e.target.parentElement;
                    btn.textContent = "Processing...";
                    try {
                      const res = await fetch(`${BACKEND}/do-upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
                      const d = await res.json();
                      if (!res.ok) { alert(d.error || "Upload failed"); return; }
                      let msg = `DO Processed: ${d.supplier || "Unknown"}\n${d.matched} matched, ${d.pending_review} pending review, ${d.showroom} showroom`;
                      if (d.unrecognized > 0) msg += `\n\n⚠️ ${d.unrecognized} item(s) not in product master:\n${(d.results?.unrecognized || []).map(u => `${u.code} — ${u.name}`).join("\n")}\n\nPlease add these to Products.`;
                      alert(msg);
                      loadDoReview();
                    } catch (err) { alert("Upload failed: " + err.message); }
                    finally { btn.innerHTML = "📤 Upload DO"; e.target.value = ""; }
                  }} />
                </label>
                <button onClick={loadDoReview} className="text-xs border border-gray-200 bg-white px-3 py-1.5 rounded-xl hover:bg-gray-50">Refresh</button>
              </div>
            </div>
            {doReviewLoading ? <div className="space-y-2 py-4">{[1,2,3].map(i=><div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
            : doReview.length === 0
            ? <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-3">✅</div><p className="font-medium">All DO items matched</p></div>
            : <div className="space-y-3">{doReview.map(item => <DoReviewItem key={item.id} item={item} orders={orders} onResolve={resolveDoReview} onDismiss={dismissDoReview} onView={handleView} warehouses={doWarehouses} onAddToStock={addToStockDoReview} companyId={companyId} />)}</div>}
          </div>
        )}
      </div>
    );

    // SERVICES
    if (page === "services") return <ServicePage />;

    // TEAM
    if (page === "team") return (
      <div><h1 className="text-xl font-bold text-gray-900 mb-4">Team</h1><UserManagement /></div>
    );

    if (page === "permissions") return <UserPermissionsPage />;

    // PRODUCTS
    if (page === "products") return <ProductsPage />;

    // PURCHASE ORDERS
    if (page === "purchase") return <PurchaseOrdersPage />;

    // INVENTORY
    if (page === "inventory") return <InventoryPage />;

    // WAREHOUSE
    if (page === "warehouse") return <WarehousePage />;

    // DRIVER
    if (page === "driver") return <DriverPage />;

    // CUSTOMERS
    if (page === "customers") return <CustomerPage />;

    // FINANCE
    if (page === "finance") return <FinancePage />;

    // COMMISSION
    if (page === "commission") return <CommissionPage />;

    // SUPPLIERS
    if (page === "suppliers") return <SuppliersPage />;

    // SETTINGS
    if (page === "settings") return <CompanySettingsPage />;

    return null;
  };

  // ── Layout ──────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden" style={{fontFamily:"Inter,system-ui,sans-serif",background:"#F8F7FF"}}>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0 w-60 h-full">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-60 z-10">
            <Sidebar mobile />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex-shrink-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
          <button className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600" onClick={() => setSidebarOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div className="flex-1 lg:hidden">
            <p className="font-bold text-gray-900 text-sm">PulseOS</p>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => { setShowSearch(true); setGlobalSearch(""); setGlobalResults([]); }} className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm">🔍</button>
            <button onClick={loadOrders} className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm">🔄</button>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 py-6 pb-24 lg:pb-6">
            <Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-3 border-violet-200 border-t-violet-600 rounded-full animate-spin" /></div>}>{renderPage()}</Suspense>
          </div>
        </div>

        {/* Mobile bottom nav */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-lg z-40 safe-area-bottom">
          <div className="flex">
            {visibleNav.slice(0,5).map(n => (
              <button key={n.id} onClick={() => setPage(n.id)} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 px-1 relative transition-colors ${page===n.id?"text-violet-700":"text-gray-400 hover:text-gray-600"}`}>
                <span className="text-xl leading-none">{n.icon}</span>
                <span className="text-xs font-medium leading-none">{n.label.split(" ")[0]}</span>
                {page===n.id && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-violet-600 rounded-full" />}
                {n.id==="operations" && (servicePending.length+doReview.length)>0 && <div className="absolute top-1.5 right-2 w-2 h-2 bg-red-500 rounded-full" />}
                {n.id==="ready" && readyOrders.length>0 && <div className="absolute top-1.5 right-2 w-2 h-2 bg-amber-400 rounded-full" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────── */}

      {/* Order view */}
      {viewOrder && <OrderViewModal order={viewOrder} onClose={() => setViewOrder(null)} onEdit={() => { setViewOrder(null); handleEdit(viewOrder); }} onDelete={handleDelete} onViewPhoto={setViewPhoto} orders={orders} handleView={handleView} onRefresh={loadOrders} />}

      {/* Add/Edit Order form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white rounded-t-3xl">
              <h2 className="font-bold text-gray-900">{editId ? "Edit Order" : "New Sales Order"}</h2>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold">×</button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Order Info</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[{k:"soNumber",l:"SO Number",req:true},{k:"customerName",l:"Customer Name",req:true},{k:"contact",l:"Contact"},{k:"orderDate",l:"Order Date",t:"date"},{k:"salesman",l:"Salesman"},{k:"orderAmount",l:"Order Amount (RM)",t:"number"},{k:"balance",l:"Balance (RM)",t:"number"}].map(({k,l,t,req})=>(
                    <div key={k}><label className="text-xs font-medium text-gray-600 block mb-1">{l}{req&&<span className="text-red-500"> *</span>}</label><input type={t||"text"} value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" /></div>
                  ))}
                  <div><label className="text-xs font-medium text-gray-600 block mb-1">Type</label><select value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value}))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"><option>Delivery</option><option>Service</option></select></div>
                  <div className="sm:col-span-2"><label className="text-xs font-medium text-gray-600 block mb-1">Address</label><textarea value={form.address} onChange={e=>setForm(p=>({...p,address:e.target.value}))} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none" /></div>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Delivery Info</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[{k:"deliveryDate",l:"Delivery Date",t:"date"},{k:"timeSlot",l:"Time Slot"},{k:"plateNo",l:"Plate No"}].map(({k,l,t})=>(
                    <div key={k}><label className="text-xs font-medium text-gray-600 block mb-1">{l}</label><input type={t||"text"} value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" /></div>
                  ))}
                  <div><label className="text-xs font-medium text-gray-600 block mb-1">Status</label><select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white">{["Pending","Out for Delivery","Delivered","Serviced","Flagged"].map(s=><option key={s}>{s}</option>)}</select></div>
                  {form.type==="Service" && <div className="sm:col-span-2"><label className="text-xs font-medium text-gray-600 block mb-1">Service Note</label><textarea value={form.serviceNote} onChange={e=>setForm(p=>({...p,serviceNote:e.target.value}))} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none" /></div>}
                  <div className="sm:col-span-2"><label className="text-xs font-medium text-gray-600 block mb-1">Remark</label><textarea value={form.remark} onChange={e=>setForm(p=>({...p,remark:e.target.value}))} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none" /></div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Items</p>
                  <button onClick={addItem} className="text-xs bg-violet-50 text-violet-600 border border-violet-200 px-3 py-1 rounded-xl hover:bg-violet-100">+ Add Item</button>
                </div>
                <div className="space-y-3">
                  {form.items.map((item,idx)=>(
                    <div key={idx} className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                      <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-gray-600">Item {idx+1}</span>{form.items.length>1&&<button onClick={()=>removeItem(idx)} className="text-xs text-red-400 hover:text-red-600">Remove</button>}</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[{k:"itemCode",l:"Item Code"},{k:"itemName",l:"Item Name"},{k:"unit",l:"Qty"},{k:"supplier",l:"Supplier"},{k:"itemOrderDate",l:"Order Date",t:"date"},{k:"supplierSentDate",l:"Sent Date",t:"date"},{k:"arrivalDate",l:"Arrival Date",t:"date"}].map(({k,l,t})=>(
                          <div key={k}><label className="text-xs text-gray-400 block mb-0.5">{l}</label><input type={t||"text"} value={item[k]} onChange={e=>setItem(idx,k,e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-300" /></div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end sticky bottom-0 bg-white rounded-b-3xl">
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 text-sm bg-gray-100 rounded-xl hover:bg-gray-200">Cancel</button>
              <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50">{saving ? "Saving..." : editId ? "Update Order" : "Save Order"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Global search */}
      {showSearch && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 pt-16 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center gap-3 p-4 border-b">
              <span className="text-gray-400">🔍</span>
              <input autoFocus value={globalSearch} onChange={e=>handleGlobalSearch(e.target.value)} placeholder="Search SO, customer, item..." className="flex-1 text-sm focus:outline-none" />
              <button onClick={()=>setShowSearch(false)} className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold text-sm">×</button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {globalSearch && globalResults.length===0 && <div className="text-center py-8 text-gray-400 text-sm">No results</div>}
              {globalResults.map((o,i) => (
                <div key={i} onClick={()=>{handleView(o);setShowSearch(false);}} className="px-4 py-3 hover:bg-violet-50 cursor-pointer border-b border-gray-50 last:border-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-violet-700 text-sm">{o.soNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(o.status)}`}>{o.status}</span>
                  </div>
                  <p className="text-sm text-gray-700">{o.customerName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{o.items?.map(i=>i.itemName).filter(Boolean).join(", ")}</p>
                </div>
              ))}
              {!globalSearch && <div className="text-center py-8 text-gray-400 text-sm">Start typing...</div>}
            </div>
          </div>
        </div>
      )}

      {/* Service Date Modal */}
      {serviceDateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-bold text-gray-900 mb-1">Set Service Date</h3>
            <p className="text-sm text-gray-500 mb-1">
              {serviceDateModal.svNumber && <span className="font-bold text-violet-700">{serviceDateModal.svNumber} </span>}
              {serviceDateModal.customerName}
            </p>
            <p className="text-xs text-gray-400 mb-4">SO: {serviceDateModal.soNumber}</p>
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 block mb-1">Service Date</label>
              <input type="date" value={serviceDateValue} onChange={e => setServiceDateValue(e.target.value)}
                autoFocus className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            {serviceDateValue && (
              <div className="bg-violet-50 rounded-xl p-3 mb-4 text-xs text-violet-700">
                <p>📅 Service scheduled for <span className="font-bold">{fmt(serviceDateValue)}</span></p>
                <p className="mt-0.5 text-gray-500">This order will appear in Delivery Schedule on that date.</p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setServiceDateModal(null); setServiceDateValue(""); }} disabled={serviceDateSaving}
                className="px-4 py-2 text-sm bg-gray-100 rounded-xl hover:bg-gray-200">Cancel</button>
              <button onClick={saveServiceDate} disabled={!serviceDateValue || serviceDateSaving}
                className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50">
                {serviceDateSaving ? "Saving..." : "Confirm Date"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {viewPhoto && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4" onClick={()=>setViewPhoto(null)}>
          <div className="relative max-w-4xl w-full">
            <img src={viewPhoto} alt="Document" className="w-full h-auto rounded-2xl shadow-2xl max-h-[85vh] object-contain" />
            <button onClick={()=>setViewPhoto(null)} className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white text-xl hover:bg-black/70">×</button>
            <a href={viewPhoto} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} className="absolute bottom-3 right-3 bg-violet-600 text-white text-xs px-3 py-2 rounded-xl hover:bg-violet-700">Open full ↗</a>
          </div>
        </div>
      )}

      {/* Convert service pending modal */}
      {convertModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full">
            <h3 className="font-bold text-gray-900 mb-1">Convert to Service Order</h3>
            <p className="text-sm text-gray-500 mb-4">A new service order will be created linked to <span className="font-semibold text-violet-700">SO {convertModal.so_number}</span>. Original delivery order stays intact.</p>
            <div className="space-y-3 mb-4">
              <div><label className="text-xs font-medium text-gray-600 block mb-1">Service Date (optional)</label><input type="date" value={convertDate} onChange={e=>setConvertDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" /></div>
              <div><label className="text-xs font-medium text-gray-600 block mb-1">Admin Remark (optional)</label><textarea value={convertRemark} onChange={e=>setConvertRemark(e.target.value)} placeholder="Notes for this service..." rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none" /></div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={()=>{setConvertModal(null);setConvertRemark("");}} disabled={converting} className="px-4 py-2 text-sm bg-gray-100 rounded-xl hover:bg-gray-200 disabled:opacity-50">Cancel</button>
              <button onClick={confirmConvert} disabled={converting} className="px-4 py-2 text-sm bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50">{converting?"Converting...":"Confirm Convert"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment modal */}
      {paymentModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-bold text-gray-900 mb-1">Record Payment</h3>
            <p className="text-sm text-gray-500 mb-1">SO <span className="font-semibold text-violet-700">{paymentModal.soNumber}</span> — {paymentModal.customerName}</p>
            <p className="text-sm text-gray-500 mb-4">Balance: <span className="font-bold text-red-600">RM {paymentModal.balance}</span></p>
            <input type="number" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} placeholder="Amount (RM)" autoFocus className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 mb-4" />
            <div className="flex gap-3 justify-end">
              <button onClick={()=>{setPaymentModal(null);setPaymentAmount("");}} disabled={paymentSaving} className="px-4 py-2 text-sm bg-gray-100 rounded-xl hover:bg-gray-200">Cancel</button>
              <button onClick={recordPayment} disabled={paymentSaving} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50">{paymentSaving?"Saving...":"Record Payment"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}