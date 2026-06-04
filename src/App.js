import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import DeliverySchedule from "./DeliverySchedule";

const SUPABASE_URL = "https://lrfyjcupucpdqmbqqbbk.supabase.co";
const SUPABASE_KEY = "sb_publishable_eAA_n21UDdPrecDlwfa8xQ_3PmFAMkm";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const EMPTY_ITEM = { itemCode: "", itemName: "", unit: "1", supplier: "", itemOrderDate: "", supplierSentDate: "", arrivalDate: "" };
const EMPTY_ORDER = { soNumber: "", customerName: "", address: "", contact: "", orderDate: "", salesman: "", orderAmount: "", balance: "", deliveryDate: "", timeSlot: "", plateNo: "", type: "Delivery", serviceNote: "", remark: "", status: "Pending", items: [{ ...EMPTY_ITEM }] };

const fmt = d => d ? new Date(d).toLocaleDateString("en-MY") : "-";
const fmtMonth = d => d ? `${new Date(d).getFullYear()}-${String(new Date(d).getMonth()+1).padStart(2,"0")}` : "";
const monthLabel = ym => { const [y,m] = ym.split("-"); return new Date(y, m-1, 1).toLocaleString("en-MY", { month: "long", year: "numeric" }); };
const now = new Date();
const todayStr = now.toISOString().split("T")[0];
const thisMonth = fmtMonth(todayStr);
const statusColor = s => ({ "Pending": "bg-yellow-100 text-yellow-800", "Out for Delivery": "bg-blue-100 text-blue-800", "Delivered": "bg-green-100 text-green-800", "Serviced": "bg-purple-100 text-purple-800", "Flagged": "bg-red-100 text-red-800" }[s] || "bg-gray-100 text-gray-700");
const prevMonth = ym => { const [y,m] = ym.split("-").map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`; };
const nextMonthYm = ym => { const [y,m] = ym.split("-").map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,"0")}`; };

const toDb = o => ({
  so_number: o.soNumber, customer_name: o.customerName, address: o.address, contact: o.contact,
  order_date: o.orderDate, salesman: o.salesman, order_amount: o.orderAmount, balance: o.balance,
  delivery_date: o.deliveryDate, time_slot: o.timeSlot, plate_no: o.plateNo, type: o.type,
  service_note: o.serviceNote, remark: o.remark, status: o.status, items: JSON.stringify(o.items || [])
});

const fromDb = o => ({
  id: o.id, created_at: o.created_at, soNumber: o.so_number, customerName: o.customer_name,
  address: o.address, contact: o.contact, orderDate: o.order_date, salesman: o.salesman,
  orderAmount: o.order_amount, balance: o.balance, deliveryDate: o.delivery_date,
  timeSlot: o.time_slot, plateNo: o.plate_no, type: o.type, serviceNote: o.service_note,
  remark: o.remark, status: o.status,
  items: typeof o.items === "string" ? JSON.parse(o.items || "[]") : (o.items || [])
});

const TABS = ["Summary", "Monthly View", "Service", "Daily View", "Delivery Schedule", "🚨 Flagged", "🔧 Service Pending", "Add Order"];

// ── Order View Modal ───testing───────────────────────────────────────────
const OrderViewModal = ({ order: o, onClose, onEdit, onDelete }) => {
  const hasBalance = parseFloat(o.balance) > 0;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-10 px-4 pb-10 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xl font-bold text-blue-700">{o.soNumber}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor(o.status)}`}>{o.status}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${o.type === "Service" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{o.type}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none">x</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Customer */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Customer</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Customer Name</p><p className="text-sm font-semibold text-gray-800">{o.customerName || "-"}</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Contact</p><p className="text-sm font-semibold text-gray-800">{o.contact || "-"}</p></div>
              <div className="bg-gray-50 rounded-lg p-3 sm:col-span-1"><p className="text-xs text-gray-400 mb-1">Address</p><p className="text-sm text-gray-800 leading-snug">{o.address || "-"}</p></div>
            </div>
          </div>

          {/* Status Banner */}
          <div className={`rounded-lg px-4 py-3 flex items-center gap-3 ${
            o.status === "Delivered" ? "bg-green-50 border border-green-200" :
            o.status === "Out for Delivery" ? "bg-blue-50 border border-blue-200" :
            o.status === "Flagged" ? "bg-red-50 border border-red-200" :
            o.status === "Serviced" ? "bg-purple-50 border border-purple-200" :
            "bg-yellow-50 border border-yellow-200"
          }`}>
            <div className="flex-1">
              <p className="text-xs text-gray-400 mb-0.5">Current Status</p>
              <p className={`text-sm font-bold ${
                o.status === "Delivered" ? "text-green-700" :
                o.status === "Out for Delivery" ? "text-blue-700" :
                o.status === "Flagged" ? "text-red-700" :
                o.status === "Serviced" ? "text-purple-700" :
                "text-yellow-700"
              }`}>{o.status}</p>
            </div>
            <span className={`text-xs px-3 py-1 rounded-full font-semibold ${statusColor(o.status)}`}>{o.status}</span>
          </div>

          {/* Delivery */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Delivery</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Delivery Date</p><p className="text-sm font-semibold text-gray-800">{fmt(o.deliveryDate)}</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Time Slot</p><p className="text-sm font-semibold text-indigo-700">{o.timeSlot || "-"}</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Plate No</p><p className="text-sm font-semibold text-gray-800">{o.plateNo || "-"}</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Salesman</p><p className="text-sm font-semibold text-gray-800">{o.salesman || "-"}</p></div>
            </div>
          </div>

          {/* Payment */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Payment</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Order Amount</p><p className="text-sm font-semibold text-gray-800">RM {o.orderAmount || "0"}</p></div>
              <div className={`rounded-lg p-3 ${hasBalance ? "bg-red-50" : "bg-green-50"}`}>
                <p className="text-xs text-gray-400 mb-1">Balance</p>
                <p className={`text-sm font-bold ${hasBalance ? "text-red-600" : "text-green-600"}`}>RM {o.balance || "0"}</p>
              </div>
              {hasBalance && <div className="bg-red-50 rounded-lg p-3 flex items-center gap-2"><span className="text-red-500 text-lg">⚠️</span><p className="text-xs text-red-600 font-medium">Outstanding balance remaining</p></div>}
            </div>
          </div>

          {/* Items */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Items ({o.items?.length || 0})</p>
            <div className="space-y-2">
              {o.items?.map((item, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">Item {i+1}</span>
                    {item.itemCode && <span className="text-xs text-gray-400">[{item.itemCode}]</span>}
                    <span className="text-sm font-semibold text-gray-800">{item.itemName || "-"}</span>
                    <span className="text-xs text-gray-500 ml-auto">Qty: {item.unit}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div><span className="text-gray-400">Supplier:</span> <span className="font-medium">{item.supplier || "-"}</span></div>
                    <div><span className="text-gray-400">Item Order:</span> <span className="font-medium">{fmt(item.itemOrderDate)}</span></div>
                    <div><span className="text-gray-400">Sent Out:</span> <span className="font-medium">{fmt(item.supplierSentDate)}</span></div>
                    <div><span className="text-gray-400">Arrival:</span> <span className="font-medium">{fmt(item.arrivalDate)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {(o.remark || o.serviceNote) && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Notes</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {o.remark && <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Remark</p><p className="text-sm text-gray-800">{o.remark}</p></div>}
                {o.serviceNote && <div className="bg-purple-50 rounded-lg p-3"><p className="text-xs text-gray-400 mb-1">Service Note</p><p className="text-sm text-purple-700 font-medium">{o.serviceNote}</p></div>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between">
          <button onClick={() => { if (window.confirm("Delete this order? This cannot be undone.")) onDelete(o.id); }} className="text-xs text-red-400 hover:text-red-600 hover:underline">Delete Order</button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
            <button onClick={onEdit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">✏️ Edit Order</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("Summary");
  const [form, setForm] = useState({ ...EMPTY_ORDER, items: [{ ...EMPTY_ITEM }] });
  const [editId, setEditId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [filterSalesman, setFilterSalesman] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [showDeleteId, setShowDeleteId] = useState(null);
  const [browseMonth, setBrowseMonth] = useState(thisMonth);
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalResults, setGlobalResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [viewOrder, setViewOrder] = useState(null);

  const [servicePending, setServicePending] = useState([]);
  const [spLoading, setSpLoading] = useState(false);

  const BACKEND = "https://vhaus-bot-production.up.railway.app";

  const loadServicePending = async () => {
    setSpLoading(true);
    try {
      const res = await fetch(`${BACKEND}/service-pending`);
      const data = await res.json();
      setServicePending(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load service pending:", e);
    }
    setSpLoading(false);
  };

  const [convertModal, setConvertModal] = useState(null); // { id, soNumber, note }
  const [convertRemark, setConvertRemark] = useState("");
  const [converting, setConverting] = useState(false);

  const openConvertModal = (sp) => {
    setConvertModal(sp);
    setConvertRemark("");
  };

  const confirmConvert = async () => {
    if (!convertModal || converting) return;
    setConverting(true);
    try {
      const res = await fetch(`${BACKEND}/service-pending/${convertModal.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark: convertRemark }),
      });
      const data = await res.json();
      if (data.success) {
        setConvertModal(null);
        setConvertRemark("");
        loadServicePending();
        loadOrders();
        alert(`✅ Converted to Service Order: ${data.svNumber}`);
      } else {
        alert("Failed to convert: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
    setConverting(false);
  };

  const removeServicePending = async (id) => {
    if (!window.confirm("Remove this service pending? This cannot be undone.")) return;
    try {
      const res = await fetch(`${BACKEND}/service-pending/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) loadServicePending();
      else alert("Failed: " + (data.error || "Unknown error"));
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  const loadOrders = async () => {
    setLoading(true); setError(null);
    const { data, error: err } = await supabase.from("orders").select("*").order("created_at", { ascending: true });
    if (err) setError("Failed to load orders: " + err.message);
    else setOrders((data || []).map(fromDb));
    setLoading(false);
  };

  useEffect(() => { loadOrders(); loadServicePending(); }, []); // eslint-disable-line

  const salesmen = useMemo(() => [...new Set(orders.map(o => o.salesman).filter(Boolean))], [orders]);

  const filtered = useMemo(() => orders.filter(o => {
    if (filterSalesman && o.salesman !== filterSalesman) return false;
    if (filterStatus && o.status !== filterStatus) return false;
    if (search) {
      const itemMatch = o.items?.some(i => `${i.itemCode} ${i.itemName}`.toLowerCase().includes(search.toLowerCase()));
      if (!`${o.soNumber} ${o.customerName}`.toLowerCase().includes(search.toLowerCase()) && !itemMatch) return false;
    }
    return true;
  }), [orders, filterSalesman, filterStatus, search]);

  const browseOrders = filtered.filter(o => {
    // Include all orders where delivery date falls in browse month
    if (o.deliveryDate && fmtMonth(o.deliveryDate) === browseMonth) return true;
    // Also include Service orders with no date (TBC) - show in current browse month if order_date matches
    if (o.type === "Service" && !o.deliveryDate && fmtMonth(o.orderDate) === browseMonth) return true;
    return false;
  });
  const tbcOrders = filtered.filter(o => !o.deliveryDate || o.deliveryDate === "");
  const services = filtered.filter(o => o.type === "Service");
  const allDeliveryDates = [...new Set(orders.filter(o => o.deliveryDate).map(o => o.deliveryDate))].sort();
  const dailyOrders = selectedDate ? orders.filter(o => o.deliveryDate === selectedDate) : [];

  const setItem = (idx, key, val) => setForm(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [key]: val } : it) }));
  const addItem = () => setForm(p => ({ ...p, items: [...p.items, { ...EMPTY_ITEM }] }));
  const removeItem = idx => setForm(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const handleGlobalSearch = v => {
    setGlobalSearch(v);
    if (!v.trim()) { setGlobalResults([]); return; }
    const q = v.toLowerCase();
    setGlobalResults(orders.filter(o =>
      o.soNumber?.toLowerCase().includes(q) || o.customerName?.toLowerCase().includes(q) ||
      o.contact?.includes(q) || o.items?.some(i => i.itemName?.toLowerCase().includes(q) || i.itemCode?.toLowerCase().includes(q))
    ));
  };

  const handleView = o => setViewOrder(o);
  const handleEdit = o => { setForm({ ...o, items: o.items?.length ? o.items : [{ ...EMPTY_ITEM }] }); setEditId(o.id); setActiveTab("Add Order"); };
  const handleDelete = async id => {
    await supabase.from("orders").delete().eq("id", id);
    setOrders(prev => prev.filter(o => o.id !== id));
    setShowDeleteId(null);
    setViewOrder(null);
  };
  const updateStatus = async (o, status) => { setOrders(prev => prev.map(x => x.id === o.id ? { ...x, status } : x)); await supabase.from("orders").update({ status }).eq("id", o.id); };

  const handleSubmit = async () => {
    if (!form.soNumber || !form.deliveryDate) return alert("SO Number and Delivery Date are required.");
    setSaving(true);
    const payload = toDb(form);
    if (editId !== null) {
      const { error: err } = await supabase.from("orders").update(payload).eq("id", editId);
      if (err) { alert("Error updating: " + err.message); setSaving(false); return; }
      setOrders(prev => prev.map(o => o.id === editId ? { ...form } : o));
      setEditId(null);
    } else {
      const { data, error: err } = await supabase.from("orders").insert(payload).select();
      if (err) { alert("Error saving: " + err.message); setSaving(false); return; }
      if (data?.[0]) setOrders(prev => [...prev, fromDb(data[0])]);
    }
    setForm({ ...EMPTY_ORDER, items: [{ ...EMPTY_ITEM }] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setActiveTab("Summary");
    setSaving(false);
  };

  const MonthNav = () => (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={() => setBrowseMonth(prevMonth(browseMonth))} className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-50 font-medium">Prev</button>
      <input type="month" value={browseMonth} onChange={e => setBrowseMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-medium text-blue-700" />
      <button onClick={() => setBrowseMonth(nextMonthYm(browseMonth))} className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-50 font-medium">Next</button>
      {browseMonth !== thisMonth && <button onClick={() => setBrowseMonth(thisMonth)} className="text-xs text-blue-500 hover:underline">Back to current month</button>}
    </div>
  );

  // SO number cell with view + edit
  const SoCell = ({ o }) => (
    <div className="flex items-center gap-1 whitespace-nowrap">
      <button onClick={() => handleView(o)} className="font-bold text-blue-700 hover:underline text-xs">{o.soNumber}</button>
      <button onClick={() => handleEdit(o)} className="text-gray-300 hover:text-blue-500 text-xs" title="Edit order">✏️</button>
    </div>
  );

  const OrderTable = ({ list, showService = false }) => (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100 text-gray-600">
            {["SO #","Customer","Contact","Time Slot","Plate No","Order Date","Salesman","Amount","Balance","Items","Supplier","Item Order","Sent Out","Arrival","Delivery Date","Status", showService ? "Service Note" : "Remark"].map(h => (
              <th key={h} className="border border-gray-200 px-2 py-2 whitespace-nowrap text-left font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.length === 0
            ? <tr><td colSpan={17} className="text-center py-8 text-gray-400">No records found</td></tr>
            : list.map((o, i) => {
              const rowSpan = o.items?.length || 1;
              return o.items?.map((item, ii) => (
                <tr key={`${i}-${ii}`} className={`${ii === 0 ? "border-t-2 border-gray-300" : ""} hover:bg-blue-50`}>
                  {ii === 0 && <>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 align-top"><SoCell o={o} /></td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 align-top"><div className="font-medium whitespace-nowrap">{o.customerName}</div><div className="text-gray-400 text-xs max-w-40 leading-tight">{o.address}</div></td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">{o.contact}</td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top font-medium text-indigo-700">{o.timeSlot || "-"}</td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">{o.plateNo || "-"}</td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">{fmt(o.orderDate)}</td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">{o.salesman}</td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">RM {o.orderAmount}</td>
                    <td rowSpan={rowSpan} className={`border border-gray-200 px-2 py-1 whitespace-nowrap align-top font-medium ${parseFloat(o.balance) > 0 ? "text-red-600" : "text-gray-700"}`}>RM {o.balance}</td>
                  </>}
                  <td className="border border-gray-200 px-2 py-1">
                    <div className="flex gap-1 items-center">
                      <span className="text-gray-400 w-4">{ii + 1}.</span>
                      <div>{item.itemCode && <span className="text-gray-400 mr-1">[{item.itemCode}]</span>}<span className="font-medium">{item.itemName}</span><span className="ml-1 text-gray-500">x{item.unit}</span></div>
                    </div>
                  </td>
                  <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">{item.supplier || "-"}</td>
                  <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">{fmt(item.itemOrderDate)}</td>
                  <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">{fmt(item.supplierSentDate)}</td>
                  <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">{fmt(item.arrivalDate)}</td>
                  {ii === 0 && <>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top font-medium">{fmt(o.deliveryDate)}</td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">
                      <select value={o.status} onChange={e => updateStatus(o, e.target.value)} className={`text-xs rounded px-1 py-0.5 border-0 font-medium cursor-pointer ${statusColor(o.status)}`}>
                        {["Pending","Out for Delivery","Delivered","Serviced","Flagged"].map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 max-w-32 align-top">{showService ? o.serviceNote : o.remark}</td>
                  </>}
                </tr>
              ));
            })}
        </tbody>
      </table>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center"><div className="text-4xl mb-3">🏠</div><div className="text-gray-600 font-medium">Loading V Haus Delivery Sheet...</div><div className="text-xs text-gray-400 mt-1">Connecting to database</div></div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center bg-white rounded-xl shadow p-8"><div className="text-4xl mb-3">⚠️</div><div className="text-red-600 font-medium mb-2">{error}</div><button onClick={loadOrders} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button></div>
    </div>
  );

  const nm = nextMonthYm(thisMonth);
  const serviceOrders = orders.filter(o => o.type === "Service");
  const thisMonthOrders = orders.filter(o => o.type === "Delivery" && fmtMonth(o.deliveryDate) === thisMonth);
  const nextMonthOrders = orders.filter(o => o.type === "Delivery" && fmtMonth(o.deliveryDate) === nm);
  const noDateOrders = orders.filter(o => !o.deliveryDate || o.deliveryDate === "");
  const balanceOrders = orders.filter(o => parseFloat(o.balance) > 0).sort((a, b) => new Date(a.deliveryDate) - new Date(b.deliveryDate));

  const [y, m] = thisMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const weeks = [];
  let day = 1 - firstDow;
  while (day <= lastDay) { const week = []; for (let d = 0; d < 7; d++) { week.push((day < 1 || day > lastDay) ? null : day); day++; } weeks.push(week); }
  const getDateStr = d => d ? `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` : null;
  const ordersOnDay = d => { const ds = getDateStr(d); return ds ? orders.filter(o => o.deliveryDate === ds) : []; };

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <div className="bg-gradient-to-r from-blue-700 to-blue-500 text-white px-4 py-3 shadow">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-lg font-bold tracking-wide">🏠 V Haus Living (Pg) Delivery Sheet</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => { setShowSearch(true); setGlobalSearch(""); setGlobalResults([]); }} className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white text-xs px-3 py-1.5 rounded-lg">🔍 Search SO</button>
            <button onClick={loadOrders} className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white text-xs px-3 py-1.5 rounded-lg">🔄 Refresh</button>
            <div className="flex gap-3 text-center text-xs">
              <div className="bg-white bg-opacity-20 rounded-lg px-3 py-1"><div className="font-bold text-lg">{orders.length}</div><div>Total</div></div>
              <div className="bg-white bg-opacity-20 rounded-lg px-3 py-1"><div className="font-bold text-lg">{orders.filter(o => o.status === "Pending").length}</div><div>Pending</div></div>
              <div className="bg-white bg-opacity-20 rounded-lg px-3 py-1"><div className="font-bold text-lg">{serviceOrders.length}</div><div>Service</div></div>
              <div className="bg-red-500 bg-opacity-80 rounded-lg px-3 py-1"><div className="font-bold text-lg">{orders.filter(o => o.status === "Flagged").length}</div><div>Flagged</div></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => { setActiveTab(t); if (t !== "Add Order") { setEditId(null); setForm({ ...EMPTY_ORDER, items: [{ ...EMPTY_ITEM }] }); } }}
              className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === t ? "border-blue-600 text-blue-700 bg-blue-50" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}>
              {t === "Add Order" ? (editId !== null ? "✏️ Edit Order" : "➕ Add Order") : t === "Monthly View" ? `📅 ${monthLabel(browseMonth)}` : t}
            </button>
          ))}
        </div>
      </div>

      {!["Add Order","Summary","Daily View","🚨 Flagged","🔧 Service Pending"].includes(activeTab) && (
        <div className="max-w-7xl mx-auto px-4 pt-3 flex flex-wrap gap-2">
          <input placeholder="🔍 Search..." value={search} onChange={e => setSearch(e.target.value)} className="border rounded-lg px-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <select value={filterSalesman} onChange={e => setFilterSalesman(e.target.value)} className="border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">All Salesmen</option>{salesmen.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">All Statuses</option>{["Pending","Out for Delivery","Delivered","Serviced","Flagged"].map(s => <option key={s}>{s}</option>)}
          </select>
          {(search || filterSalesman || filterStatus) && <button onClick={() => { setSearch(""); setFilterSalesman(""); setFilterStatus(""); }} className="text-xs text-red-500 hover:underline">Clear</button>}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-4">

        {/* SUMMARY */}
        {activeTab === "Summary" && (
          <div>
            <h2 className="text-base font-bold text-gray-700 mb-3">📊 Summary — {monthLabel(thisMonth)}</h2>
            <div className="flex flex-col gap-4">

              {/* Row 1: 4 summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {[
                  { label: "🔧 Total Service", count: serviceOrders.length, color: "bg-green-500", border: "border-green-300", items: serviceOrders },
                  { label: `📅 ${monthLabel(thisMonth)}`, count: thisMonthOrders.length, color: "bg-blue-500", border: "border-blue-300", items: thisMonthOrders },
                  { label: `📅 ${monthLabel(nm)}`, count: nextMonthOrders.length, color: "bg-orange-400", border: "border-orange-300", items: nextMonthOrders },
                  { label: "📦 TBC / No Date", count: noDateOrders.length, color: "bg-gray-500", border: "border-gray-300", items: noDateOrders },
                ].map(({ label, count, color, border, items }) => (
                  <div key={label} className={`rounded-xl border-2 ${border} overflow-hidden shadow-sm`}>
                    <div className={`${color} text-white px-4 py-2 flex items-center justify-between`}>
                      <span className="text-xs font-semibold">{label}</span>
                      <span className="text-lg font-bold">{count}</span>
                    </div>
                    {items && items.length > 0 && (
                      <div className="bg-white px-3 py-2 flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {items.map((o, i) => (
                          <span key={i} className="flex items-center gap-0.5">
                            <button onClick={() => handleView(o)} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 cursor-pointer font-medium text-gray-700 border border-gray-200">{o.soNumber}</button>
                          </span>
                        ))}
                      </div>
                    )}
                    {items && items.length === 0 && <div className="bg-white px-3 py-2 text-xs text-gray-400">No orders</div>}
                  </div>
                ))}
              </div>

              {/* Row 2: Calendar (full width) + Outstanding Balance (full width below) */}
              <div className="flex flex-col gap-4">

                {/* Calendar */}
                <div className="min-w-0 overflow-x-auto">
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <table className="w-full min-w-[720px] text-xs border-collapse table-fixed">
                      <thead>
                        <tr>
                          {["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d => (
                            <th key={d} className={`px-1 py-2 border border-gray-200 text-center font-bold text-xs ${d === "SAT" || d === "SUN" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{d}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {weeks.map((week, wi) => (
                          <tr key={wi}>
                            {week.map((day, di) => {
                              const dayOrders = day ? ordersOnDay(day) : [];
                              const isToday = getDateStr(day) === todayStr;
                              return (
                                <td key={di} className={`border border-gray-200 px-1 py-1 align-top h-16 ${!day ? "bg-gray-50" : isToday ? "bg-yellow-50" : di >= 5 ? "bg-blue-50" : ""}`}>
                                  {day && <>
                                    <div className={`text-xs font-bold mb-0.5 ${isToday ? "text-yellow-600" : "text-gray-400"}`}>{day}</div>
                                    <div className="flex flex-col gap-0.5">
                                      {dayOrders.map((o, oi) => (
                                        <button key={oi} onClick={() => handleView(o)} className={`text-xs px-1 rounded hover:opacity-80 truncate text-left leading-tight ${o.type === "Service" ? "bg-green-200 text-green-800" : "bg-blue-200 text-blue-800"}`}>{o.soNumber}</button>
                                      ))}
                                    </div>
                                  </>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Outstanding Balance */}
                <div className="min-w-0">
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-3 py-2 bg-red-50 border-b border-red-100 flex items-center justify-between">
                      <span className="text-xs font-bold text-red-700">💰 Outstanding Balances</span>
                      <span className="text-xs text-red-500 font-medium">{balanceOrders.length} order(s)</span>
                    </div>
                    <div className="overflow-x-auto">
                    <table className="text-xs border-collapse w-full" style={{minWidth:"700px"}}>
                      <thead>
                        <tr className="bg-gray-100">
                          {["No","SO No","Customer","Sales Person","Amount","Balance","Deliver Date","Aging (days)","Remark"].map(h => (
                            <th key={h} className="border border-gray-200 px-2 py-2 text-center whitespace-nowrap font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {balanceOrders.length === 0
                          ? <tr><td colSpan={9} className="text-center py-6 text-gray-400">No outstanding balances</td></tr>
                          : balanceOrders.map((o, i) => {
                            const delDate = o.deliveryDate ? new Date(o.deliveryDate) : null;
                            const dateDif = delDate ? Math.floor((now - delDate) / (1000 * 60 * 60 * 24)) : null;
                            const aging = dateDif !== null ? dateDif : null;
                            const agingColor = aging === null ? "" : aging > 30 ? "text-red-700 font-bold" : aging > 14 ? "text-orange-600 font-semibold" : "text-gray-600";
                            return (
                              <tr key={i} className="hover:bg-red-50">
                                <td className="border border-gray-200 px-2 py-1.5 text-center text-gray-500">{i + 1}</td>
                                <td className="border border-gray-200 px-2 py-1.5 text-center">
                                  <button onClick={() => handleView(o)} className="font-bold text-blue-700 hover:underline whitespace-nowrap">{o.soNumber}</button>
                                </td>
                                <td className="border border-gray-200 px-2 py-1.5 whitespace-nowrap">
                                  <div className="font-medium text-gray-800">{o.customerName || "-"}</div>
                                  <div className="text-gray-400 text-xs">{o.contact || ""}</div>
                                </td>
                                <td className="border border-gray-200 px-2 py-1.5 text-center whitespace-nowrap">{o.salesman || "-"}</td>
                                <td className="border border-gray-200 px-2 py-1.5 text-right whitespace-nowrap">RM {o.orderAmount}</td>
                                <td className="border border-gray-200 px-2 py-1.5 text-right whitespace-nowrap font-bold text-red-600">RM {o.balance}</td>
                                <td className="border border-gray-200 px-2 py-1.5 text-center whitespace-nowrap">{o.deliveryDate ? fmt(o.deliveryDate) : <span className="text-gray-400 italic">TBC</span>}</td>
                                <td className={`border border-gray-200 px-2 py-1.5 text-center whitespace-nowrap ${agingColor}`}>{aging !== null ? `${aging}d` : "-"}</td>
                                <td className="border border-gray-200 px-2 py-1.5 text-gray-500 max-w-xs">{o.remark || "-"}</td>
                              </tr>
                            );
                          })}
                        {balanceOrders.length > 0 && (
                          <tr className="bg-red-50 font-bold">
                            <td colSpan={5} className="border border-gray-200 px-2 py-1.5 text-right text-gray-600">Total Outstanding:</td>
                            <td className="border border-gray-200 px-2 py-1.5 text-right text-red-600">RM {balanceOrders.reduce((s, o) => s + parseFloat(o.balance || 0), 0).toLocaleString()}</td>
                            <td colSpan={3} className="border border-gray-200"></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}
 {/* Delivery Schedule */}
{activeTab === "Delivery Schedule" && <DeliverySchedule />}

        {/* SERVICE PENDING */}
        {activeTab === "🔧 Service Pending" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-700">🔧 Service Pending</h2>
                <p className="text-xs text-gray-400 mt-0.5">Orders not settled by driver. Convert to a Service Order (SV-xxx) or remove if not applicable.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="bg-orange-100 text-orange-700 font-bold text-sm px-3 py-1 rounded-full">{servicePending.length} pending</span>
                <button onClick={loadServicePending} className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50">🔄 Refresh</button>
              </div>
            </div>
            {spLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
            ) : servicePending.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-4xl mb-3">✅</div>
                <div className="font-medium">No pending services</div>
                <div className="text-xs mt-1">All deliveries settled</div>
              </div>
            ) : (
              <div className="space-y-4">
                {servicePending.map(sp => (
                  <div key={sp.id} className="bg-white border-2 border-orange-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="bg-orange-50 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="text-orange-500 text-lg">🔧</span>
                        <div>
                          <span className="font-bold text-blue-700 text-sm">SO {sp.so_number}</span>
                          <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full ml-2">Not Settled</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => removeServicePending(sp.id)}
                          className="text-xs bg-white border border-red-300 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50"
                        >
                          🗑 Remove
                        </button>
                        <button
                          onClick={() => openConvertModal(sp)}
                          className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600"
                        >
                          → Convert to Service
                        </button>
                      </div>
                    </div>
                    <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-1">🚚 Driver</p>
                        <p className="text-sm font-semibold">{sp.driver || "-"}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-1">🤝 Helper (Kelindan)</p>
                        <p className="text-sm font-semibold">{sp.helper || "-"}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-1">📅 Date</p>
                        <p className="text-sm font-semibold">{sp.date ? fmt(sp.date) : "-"}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-1">🕒 Reported</p>
                        <p className="text-sm font-semibold">{sp.created_at ? new Date(sp.created_at).toLocaleDateString("en-MY") : "-"}</p>
                      </div>
                      {sp.note && (
                        <div className="col-span-2 sm:col-span-4 bg-orange-50 border border-orange-200 rounded-lg p-3">
                          <p className="text-xs font-bold text-orange-600 mb-1">📝 Issue / Note</p>
                          <p className="text-sm text-gray-800">{sp.note}</p>
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-2 border-t bg-gray-50">
                      <p className="text-xs text-gray-400">
                        Convert to create a new Service Order with running number (SV-001, SV-002...).
                        Remove if the issue is resolved or not applicable.
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FLAGGED ORDERS */}
        {activeTab === "🚨 Flagged" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-700">🚨 Flagged Orders</h2>
                <p className="text-xs text-gray-400 mt-0.5">Orders reported by salesmen as having incorrect information. Edit and mark as Pending when fixed.</p>
              </div>
              <span className="bg-red-100 text-red-700 font-bold text-sm px-3 py-1 rounded-full">{orders.filter(o => o.status === "Flagged").length} flagged</span>
            </div>
            {orders.filter(o => o.status === "Flagged").length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-4xl mb-3">✅</div>
                <div className="font-medium">No flagged orders</div>
                <div className="text-xs mt-1">All orders are clean</div>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.filter(o => o.status === "Flagged").map(o => {
                  const flagMatch = o.remark?.match(/FLAGGED by (.+?) \((.+?)\): (.+?)(?= \||$)/);
                  const flagNote = flagMatch ? flagMatch[3] : null;
                  const flagBy = flagMatch ? flagMatch[1] : null;
                  const flagTime = flagMatch ? flagMatch[2] : null;
                  return (
                    <div key={o.id} className="bg-white border-2 border-red-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="bg-red-50 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <span className="text-red-500 text-lg">🚨</span>
                          <div>
                            <span className="font-bold text-blue-700 text-sm">{o.soNumber}</span>
                            <span className="text-gray-500 text-xs ml-2">{o.customerName}</span>
                          </div>
                          <span className="text-xs bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded-full">Flagged</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleView(o)} className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50">👁 View</button>
                          <button onClick={() => handleEdit(o)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">✏️ Edit & Fix</button>
                        </div>
                      </div>
                      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {flagNote && (
                          <div className="sm:col-span-2 bg-red-50 border border-red-200 rounded-lg p-3">
                            <p className="text-xs font-bold text-red-600 mb-1">⚠️ Issue Reported</p>
                            <p className="text-sm text-gray-800">{flagNote}</p>
                            {flagBy && <p className="text-xs text-gray-400 mt-1">by {flagBy}{flagTime ? ` · ${flagTime}` : ""}</p>}
                          </div>
                        )}
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Delivery Date</p>
                          <p className="text-sm font-semibold">{fmt(o.deliveryDate)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Salesman</p>
                          <p className="text-sm font-semibold">{o.salesman || "-"}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Amount / Balance</p>
                          <p className="text-sm font-semibold">RM {o.orderAmount} / <span className={parseFloat(o.balance) > 0 ? "text-red-600" : "text-green-600"}>RM {o.balance}</span></p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Items</p>
                          <p className="text-sm text-gray-700">{o.items?.map(i => i.itemName).filter(Boolean).join(", ") || "-"}</p>
                        </div>
                        {o.remark && (
                          <div className="sm:col-span-2 bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-400 mb-1">Full Remark</p>
                            <p className="text-xs text-gray-600 leading-relaxed">{o.remark}</p>
                          </div>
                        )}
                      </div>
                      <div className="px-4 py-2 border-t bg-gray-50 flex items-center justify-between">
                        <p className="text-xs text-gray-400">After editing, change status back to <strong>Pending</strong> to resolve this flag.</p>
                        <button
                          onClick={async () => {
                            await updateStatus(o, "Pending");
                          }}
                          className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700"
                        >
                          ✅ Mark as Resolved
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* MONTHLY VIEW */}
        {activeTab === "Monthly View" && (
          <div>
            <MonthNav />
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-base font-bold text-gray-700">
                📅 {monthLabel(browseMonth)}
              </h2>
              <div className="flex gap-2 flex-wrap">
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">🚚 {browseOrders.filter(o => o.type === "Delivery").length} Delivery</span>
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-medium">🔧 {browseOrders.filter(o => o.type === "Service").length} Service</span>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">Total: {browseOrders.length}</span>
              </div>
            </div>
            <OrderTable list={browseOrders} />
            {/* TBC / No Date section */}
            {tbcOrders.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-bold text-gray-600">📦 TBC / No Date Set</h3>
                  <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{tbcOrders.length} orders</span>
                </div>
                <p className="text-xs text-gray-400 mb-3">Orders without a confirmed delivery date. Salesman to update when customer arranges.</p>
                <OrderTable list={tbcOrders} />
              </div>
            )}
          </div>
        )}

        {/* SERVICE */}
        {activeTab === "Service" && (
          <div>
            <h2 className="text-base font-bold text-gray-700 mb-3">🔧 Service Orders</h2>
            <OrderTable list={services} showService />
          </div>
        )}

        {/* DAILY VIEW */}
        {activeTab === "Daily View" && (
          <div>
            <h2 className="text-base font-bold text-gray-700 mb-3">📆 Daily View</h2>
            <div className="mb-3">
              <label className="text-xs text-gray-500 block mb-1">Select Date</label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-2">Dates with orders:</p>
              <div className="flex flex-wrap gap-1">
                {allDeliveryDates.map(d => <button key={d} onClick={() => setSelectedDate(d)} className={`text-xs px-2 py-1 rounded-full border transition-colors ${selectedDate === d ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}>{fmt(d)}</button>)}
              </div>
            </div>
            {selectedDate ? (
              <>
                <h3 className="font-semibold text-sm text-gray-700 mb-2">
                  Orders on {fmt(selectedDate)} — {dailyOrders.length} order(s)
                  <span className="ml-3 text-xs font-normal text-gray-400">🚚 {dailyOrders.filter(o => o.type === "Delivery").length} Delivery | 🔧 {dailyOrders.filter(o => o.type === "Service").length} Service</span>
                </h3>
                <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
                  <table className="min-w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600">
                        {["Time Slot","Plate No","SO #","Customer","Contact","Type","Items","Supplier","Arrival","Amount","Balance","Status","Remark / Service Note"].map(h => (
                          <th key={h} className="border border-gray-200 px-2 py-2 whitespace-nowrap text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dailyOrders.length === 0
                        ? <tr><td colSpan={13} className="text-center py-8 text-gray-400">No orders.</td></tr>
                        : dailyOrders.map((o, i) => {
                          const isService = o.type === "Service";
                          const rowSpan = o.items?.length || 1;
                          return o.items?.map((item, ii) => (
                            <tr key={`${i}-${ii}`} className={`${ii === 0 ? "border-t-2 border-gray-300" : ""} ${isService ? "bg-purple-50 hover:bg-purple-100" : "hover:bg-blue-50"}`}>
                              {ii === 0 && <>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top font-medium text-indigo-700">{o.timeSlot || "-"}</td>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">{o.plateNo || "-"}</td>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 align-top"><SoCell o={o} /></td>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 align-top">
                                  <div className="font-medium whitespace-nowrap">{o.customerName}</div>
                                  <div className="text-gray-400 text-xs max-w-40 leading-tight">{o.address}</div>
                                  <div className="text-gray-400 text-xs">{o.salesman}</div>
                                </td>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">{o.contact}</td>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">
                                  {isService ? <span className="bg-purple-200 text-purple-800 text-xs font-bold px-2 py-0.5 rounded-full">SERVICE</span> : <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">DELIVERY</span>}
                                </td>
                              </>}
                              <td className="border border-gray-200 px-2 py-1">
                                <div className="flex gap-1 items-center">
                                  <span className="text-gray-400 w-4">{ii + 1}.</span>
                                  <div>{item.itemCode && <span className="text-gray-400 mr-1">[{item.itemCode}]</span>}<span className="font-medium">{item.itemName}</span><span className="ml-1 text-gray-500">x{item.unit}</span></div>
                                </div>
                              </td>
                              <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">{item.supplier || "-"}</td>
                              <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">{fmt(item.arrivalDate)}</td>
                              {ii === 0 && <>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">RM {o.orderAmount}</td>
                                <td rowSpan={rowSpan} className={`border border-gray-200 px-2 py-1 whitespace-nowrap align-top font-medium ${parseFloat(o.balance) > 0 ? "text-red-600" : "text-gray-700"}`}>RM {o.balance}</td>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 whitespace-nowrap align-top">
                                  <select value={o.status} onChange={e => updateStatus(o, e.target.value)} className={`text-xs rounded px-1 py-0.5 border-0 font-medium cursor-pointer ${statusColor(o.status)}`}>
                                    {["Pending","Out for Delivery","Delivered","Serviced","Flagged"].map(s => <option key={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td rowSpan={rowSpan} className="border border-gray-200 px-2 py-1 align-top max-w-40">
                                  {isService && o.serviceNote && <div className="text-purple-700 font-medium mb-1">{o.serviceNote}</div>}
                                  {o.remark && <div className="text-gray-500">{o.remark}</div>}
                                </td>
                              </>}
                            </tr>
                          ));
                        })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <p className="text-xs text-gray-400">Select a date to view orders.</p>}
          </div>
        )}

        {/* ADD / EDIT ORDER */}
        {activeTab === "Add Order" && (
          <div className="max-w-3xl">
            <h2 className="text-base font-bold text-gray-700 mb-4">{editId !== null ? "✏️ Edit Sales Order" : "➕ New Sales Order"}</h2>
            <div className="bg-white rounded-xl shadow p-5 space-y-4">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Order Information</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[{k:"soNumber",l:"SO Number",req:true},{k:"customerName",l:"Customer Name",req:true},{k:"contact",l:"Contact"},{k:"orderDate",l:"Order Date",t:"date"},{k:"salesman",l:"Salesman Name"},{k:"orderAmount",l:"Order Amount (RM)",t:"number"},{k:"balance",l:"Balance (RM)",t:"number"}].map(({k,l,t,req}) => (
                    <div key={k}>
                      <label className="text-xs font-medium text-gray-600 block mb-0.5">{l}{req && <span className="text-red-500"> *</span>}</label>
                      <input type={t||"text"} value={form[k]} onChange={e => setForm(p => ({...p,[k]:e.target.value}))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-0.5">Type</label>
                    <select value={form.type} onChange={e => setForm(p => ({...p,type:e.target.value}))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                      <option>Delivery</option><option>Service</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-gray-600 block mb-0.5">Address</label>
                    <textarea value={form.address} onChange={e => setForm(p => ({...p,address:e.target.value}))} rows={2} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Delivery Information</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[{k:"deliveryDate",l:"Delivery Date",t:"date",req:true},{k:"timeSlot",l:"Time Slot (e.g. 10.00 - 12.00)"},{k:"plateNo",l:"Plate No"}].map(({k,l,t,req}) => (
                    <div key={k}>
                      <label className="text-xs font-medium text-gray-600 block mb-0.5">{l}{req && <span className="text-red-500"> *</span>}</label>
                      <input type={t||"text"} value={form[k]} onChange={e => setForm(p => ({...p,[k]:e.target.value}))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-0.5">Status</label>
                    <select value={form.status} onChange={e => setForm(p => ({...p,status:e.target.value}))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                      {["Pending","Out for Delivery","Delivered","Serviced","Flagged"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  {form.type === "Service" && (
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-gray-600 block mb-0.5">Service Note</label>
                      <textarea value={form.serviceNote} onChange={e => setForm(p => ({...p,serviceNote:e.target.value}))} rows={2} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-gray-600 block mb-0.5">Remark</label>
                    <textarea value={form.remark} onChange={e => setForm(p => ({...p,remark:e.target.value}))} rows={2} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Items</p>
                  <button onClick={addItem} className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-100">+ Add Item</button>
                </div>
                <div className="space-y-3">
                  {form.items.map((item, idx) => (
                    <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-600">Item {idx + 1}</span>
                        {form.items.length > 1 && <button onClick={() => removeItem(idx)} className="text-xs text-red-400 hover:text-red-600">Remove</button>}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[{k:"itemCode",l:"Item Code"},{k:"itemName",l:"Item Name"},{k:"unit",l:"Unit"},{k:"supplier",l:"Supplier"}].map(({k,l}) => (
                          <div key={k}>
                            <label className="text-xs text-gray-500 block mb-0.5">{l}</label>
                            <input value={item[k]} onChange={e => setItem(idx, k, e.target.value)} className="w-full border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300" />
                          </div>
                        ))}
                        {[{k:"itemOrderDate",l:"Item Order Date"},{k:"supplierSentDate",l:"Supplier Sent Date"},{k:"arrivalDate",l:"Arrival Date"}].map(({k,l}) => (
                          <div key={k}>
                            <label className="text-xs text-gray-500 block mb-0.5">{l}</label>
                            <input type="date" value={item[k]} onChange={e => setItem(idx, k, e.target.value)} className="w-full border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-4 items-center">
              <button onClick={handleSubmit} disabled={saving} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : editId !== null ? "Update Order" : "Save Order"}
              </button>
              {editId !== null && (
                <button onClick={() => { setEditId(null); setForm({ ...EMPTY_ORDER, items: [{ ...EMPTY_ITEM }] }); setActiveTab("Summary"); }} className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-300">Cancel</button>
              )}
              {saved && <span className="text-green-600 text-sm font-medium">Saved!</span>}
            </div>
          </div>
        )}

      </div>

      {/* Order View Modal */}
      {viewOrder && (
        <OrderViewModal
          order={viewOrder}
          onClose={() => setViewOrder(null)}
          onEdit={() => { setViewOrder(null); handleEdit(viewOrder); }}
          onDelete={handleDelete}
        />
      )}

      {/* Search Modal */}
      {showSearch && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-20 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center gap-2 p-4 border-b">
              <span className="text-lg">🔍</span>
              <input autoFocus value={globalSearch} onChange={e => handleGlobalSearch(e.target.value)} placeholder="Search SO number, customer, contact, item..." className="flex-1 text-sm focus:outline-none" />
              <button onClick={() => setShowSearch(false)} className="text-gray-400 hover:text-gray-600 text-lg font-bold">x</button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {globalSearch && globalResults.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No results found</div>}
              {globalResults.map((o, i) => (
                <div key={i} onClick={() => { handleView(o); setShowSearch(false); }} className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-blue-700 text-sm">{o.soNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.type === "Service" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{o.type}</span>
                  </div>
                  <div className="text-sm text-gray-700">{o.customerName}</div>
                  <div className="text-xs text-gray-400 flex gap-3 mt-0.5">
                    <span>📅 {fmt(o.deliveryDate)}</span>
                    <span>👤 {o.salesman}</span>
                    {parseFloat(o.balance) > 0 && <span className="text-red-500">💰 RM {o.balance} outstanding</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{o.items?.map(i => i.itemName).filter(Boolean).join(", ")}</div>
                </div>
              ))}
              {!globalSearch && <div className="text-center py-8 text-gray-400 text-sm">Start typing to search...</div>}
            </div>
          </div>
        </div>
      )}

      {/* Convert Service Pending Modal */}
      {convertModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full">
            <h3 className="font-bold text-gray-800 mb-1">Convert to Service Order</h3>
            <p className="text-sm text-gray-500 mb-4">SO <span className="font-semibold text-blue-700">{convertModal.so_number}</span> will be converted to a new Service Order with a SV number.</p>
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 block mb-1">Remark (optional)</label>
              <textarea
                value={convertRemark}
                onChange={e => setConvertRemark(e.target.value)}
                placeholder="e.g. Missing 1 pillow, needs to be replaced"
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setConvertModal(null); setConvertRemark(""); }}
                disabled={converting}
                className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmConvert}
                disabled={converting}
                className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
              >
                {converting ? "Converting..." : "✅ Confirm Convert"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showDeleteId !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold text-gray-800 mb-2">Delete Order?</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure? This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDeleteId(null)} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={() => handleDelete(showDeleteId)} className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
