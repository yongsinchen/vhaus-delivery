import { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";

const statusColor = s => ({
  "Pending": "bg-yellow-100 text-yellow-800",
  "Confirmed": "bg-green-100 text-green-800",
  "Out for Delivery": "bg-blue-100 text-blue-800",
  "Delivered": "bg-gray-100 text-gray-600",
  "In Progress": "bg-indigo-100 text-indigo-800",
}[s] || "bg-gray-100 text-gray-700");

const tripStatusColor = s => ({
  "Scheduled": "bg-yellow-100 text-yellow-700",
  "Assigned": "bg-blue-100 text-blue-700",
  "Out for Delivery": "bg-indigo-100 text-indigo-700",
  "Completed": "bg-green-100 text-green-700",
  "Cancelled": "bg-gray-100 text-gray-400",
}[s] || "bg-gray-100 text-gray-500");

const getMalaysiaDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

const todayMY = getMalaysiaDate();

const parseItems = items => {
  try { return typeof items === "string" ? JSON.parse(items || "[]") : (items || []); }
  catch { return []; }
};

const EMPTY_VEHICLE = { driver_name: "", vehicle_plate: "", vehicle_type: "", status: "Active" };
const EMPTY_ROUTE = { vehicle_id: "", lorry_plate: "", driver_name: "", area: "", notes: "" };

// ── Trip Card (for multi-trip orders in unassigned/assigned) ──────
function TripCard({ trip, routes, isLocked, onAssign, onDragStart }) {
  const order = trip.orders || {};
  const items = parseItems(order.items);
  const [showItems, setShowItems] = useState(false);

  return (
    <div
      className="bg-purple-50 border border-purple-200 rounded-lg p-2 cursor-grab"
      draggable
      onDragStart={onDragStart}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-purple-700 text-xs">{trip.so_number}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${tripStatusColor(trip.status)}`}>
            Trip {trip.trip_no}/{trip.total_trips}
          </span>
          {trip.sv_number && <span className="text-xs text-purple-400">{trip.sv_number}</span>}
        </div>
        {parseFloat(order.balance) > 0 && <span className="text-red-500 text-xs font-medium">RM {order.balance}</span>}
      </div>

      <p className="text-xs font-medium text-gray-700">{order.customer_name || "-"}</p>
      <p className="text-xs text-gray-400 leading-tight truncate">{order.address}</p>
      {order.time_slot && <p className="text-xs text-indigo-600 font-medium">{order.time_slot}</p>}

      {/* Commission note — only trip 1 earns commission */}
      {trip.trip_no === 1 && (
        <p className="text-xs text-green-600 font-medium mt-0.5">💰 Commission trip</p>
      )}
      {trip.trip_no > 1 && (
        <p className="text-xs text-gray-400 mt-0.5">No commission (trip {trip.trip_no})</p>
      )}

      <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>

      <button onClick={() => setShowItems(p => !p)} className="text-xs text-gray-400 hover:text-purple-600 mt-1">
        👁 {showItems ? "Hide Items" : "View Items"}
      </button>
      {showItems && (
        <div className="bg-white border border-gray-100 rounded p-2 mt-1 space-y-1">
          {items.map((item, i) => (
            <p key={i} className="text-xs text-gray-600">
              {i+1}. {item.itemCode ? `[${item.itemCode}] ` : ""}{item.itemName} x{item.unit || 1}
            </p>
          ))}
        </div>
      )}

      {/* Assign dropdown */}
      {routes && routes.length > 0 && !isLocked && (
        <select
          onChange={e => { if (e.target.value) onAssign(e.target.value, trip.id, "trip"); }}
          className="mt-2 w-full text-xs border rounded px-1 py-1 text-gray-600"
        >
          <option value="">Assign to route...</option>
          {routes.filter(r => r.status === "Pending").map(r => (
            <option key={r.id} value={r.id}>{r.lorry_plate || r.driver_name} {r.area ? `(${r.area})` : ""}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Assigned Order Card ───────────────────────────────────────────
function AssignedOrderCard({ ro, routeId, index, isLocked, onUnassign, onDragStart, onDragOver, onDrop, onSaved, isTrip }) {
  const o = isTrip ? (ro.orders || {}) : ro.orders;
  const [scheduledTime, setScheduledTime] = useState(ro.scheduled_time_range || "");
  const [editingTime, setEditingTime] = useState(!ro.scheduled_time_range);
  const [routeNote, setRouteNote] = useState(ro.route_note || "");
  const [showItems, setShowItems] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!o) return null;

  const items = parseItems(o.items);
  const preferredTime = o.time_slot || "";
  const tripInfo = isTrip ? ro : null;

  const saveScheduledTime = async () => {
    if (!scheduledTime.trim()) return;
    setSaving(true);
    await fetch(`${API}/delivery/routes/${routeId}/orders/${o.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_time_range: scheduledTime })
    });
    setSaving(false); setEditingTime(false);
    if (onSaved) onSaved();
  };

  const saveRouteNote = async (val) => {
    setRouteNote(val);
    await fetch(`${API}/delivery/routes/${routeId}/orders/${o.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route_note: val })
    });
  };

  return (
    <div
      className={`rounded-lg p-2 border ${isTrip ? "bg-purple-50 border-purple-200" : "bg-gray-50 border-gray-200"} ${isLocked ? "opacity-80" : "cursor-grab"}`}
      draggable={!isLocked}
      onDragStart={() => !isLocked && onDragStart(index)}
      onDragOver={e => { e.preventDefault(); !isLocked && onDragOver(index); }}
      onDrop={() => !isLocked && onDrop(index)}
    >
      {/* Row 1 */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {!isLocked && <span className="text-gray-300 text-xs select-none cursor-grab">⋮⋮</span>}
        <span className="text-xs text-gray-400 font-medium flex-shrink-0">#{index + 1}</span>
        <span className={`font-bold text-xs flex-shrink-0 ${isTrip ? "text-purple-700" : "text-blue-700"}`}>{o.so_number}</span>
        {isTrip && tripInfo && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${tripStatusColor(tripInfo.status)}`}>
            Trip {tripInfo.trip_no}/{tripInfo.total_trips}
          </span>
        )}
        <span className="text-xs font-medium text-gray-700 truncate flex-1">{o.customer_name}</span>
        {parseFloat(o.balance) > 0 && <span className="text-red-500 text-xs font-medium flex-shrink-0">RM {o.balance}</span>}
        {!isLocked && (
          <button onClick={() => onUnassign(routeId, o.id)} className="text-gray-300 hover:text-red-500 text-xs flex-shrink-0" title="Unassign">x</button>
        )}
      </div>

      {/* Commission badge */}
      {isTrip && tripInfo && (
        <p className={`text-xs font-medium mb-1 ${tripInfo.trip_no === 1 ? "text-green-600" : "text-gray-400"}`}>
          {tripInfo.trip_no === 1 ? "💰 Commission trip" : `No commission (trip ${tripInfo.trip_no})`}
        </p>
      )}

      <div className="space-y-1.5 mb-1.5">
        <p className="text-xs text-gray-400 truncate">{o.address}</p>
        <p className="text-xs text-gray-500"><span className="text-gray-400">Order Date:</span> {o.order_date || "-"}</p>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 flex-shrink-0">Preferred:</span>
          {preferredTime
            ? <span className="text-xs font-medium text-purple-600 bg-purple-50 rounded px-1.5 py-0.5">{preferredTime}</span>
            : <span className="text-xs text-gray-300">-</span>}
        </div>
        {!isLocked && (
          editingTime ? (
            <div className="flex items-center gap-1">
              <input value={scheduledTime} onChange={e => setScheduledTime(e.target.value)}
                placeholder="Actual scheduled time..."
                className={`flex-1 text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 min-w-0 ${scheduledTime ? "border-blue-300 bg-blue-50 text-blue-700 font-medium" : "border-gray-200 text-gray-500"}`}
              />
              {preferredTime && <button onClick={() => setScheduledTime(preferredTime)} className="text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 px-1.5 py-1 rounded flex-shrink-0">Use</button>}
              <button onClick={saveScheduledTime} disabled={saving} className="text-xs bg-blue-600 text-white hover:bg-blue-700 px-2 py-1 rounded flex-shrink-0 disabled:opacity-50">{saving ? "..." : "Save"}</button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-blue-700 font-medium bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 flex-1 truncate">⏰ {scheduledTime}</span>
              <button onClick={() => setEditingTime(true)} className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded flex-shrink-0">Edit</button>
            </div>
          )
        )}
        {isLocked && scheduledTime && <span className="text-xs text-blue-700 font-medium bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 inline-block">⏰ {scheduledTime}</span>}
        {o.remark && <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded p-2 text-xs"><span className="font-semibold">Remark: </span>{o.remark}</div>}
      </div>

      <div className="space-y-1">
        <button onClick={() => setShowItems(p => !p)} className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1">
          👁️ <span>{showItems ? "Hide Items" : "View Items"}</span>
        </button>
        {showItems && (
          <div className="bg-white border border-gray-100 rounded-lg p-2 space-y-1.5">
            {items.length === 0 ? <p className="text-xs text-gray-400">No items found.</p>
              : items.map((item, i) => (
                <div key={i} className="text-xs border-b border-gray-50 pb-1.5 last:border-0 last:pb-0">
                  <p className="font-medium text-gray-700">{i+1}. {item.itemCode ? `[${item.itemCode}] ` : ""}{item.itemName || "-"} <span className="text-gray-400">x{item.unit || 1}</span></p>
                  {item.supplier && <p className="text-gray-400 ml-3">Supplier: {item.supplier}</p>}
                  <p className="ml-3"><span className="text-gray-400">Arrival: </span>{item.arrivalDate ? <span className="text-gray-600">{item.arrivalDate}</span> : <span className="text-red-600 font-semibold">No arrival date</span>}</p>
                </div>
              ))}
          </div>
        )}
        {!isLocked && (
          <input value={routeNote} onChange={e => setRouteNote(e.target.value)}
            onBlur={e => saveRouteNote(e.target.value)}
            placeholder="Route note (optional)"
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 text-gray-500"
          />
        )}
        {isLocked && routeNote && <p className="text-xs text-gray-400 italic">{routeNote}</p>}
      </div>
    </div>
  );
}

// ── Print CSS ─────────────────────────────────────────────────────
const PRINT_STYLE = `@media print { body * { visibility: hidden; } .print-area, .print-area * { visibility: visible; } .print-area { position: absolute; left: 0; top: 0; width: 100%; } @page { size: A4 landscape; margin: 8mm; } }`;

// ── Route Print View ──────────────────────────────────────────────
function RoutePrintView({ route, onClose }) {
  const parseItemsSafe = items => { try { return typeof items === "string" ? JSON.parse(items || "[]") : (items || []); } catch { return []; } };
  const handlePrint = () => { setTimeout(() => window.print(), 300); window.onafterprint = () => onClose(); };
  const dateStr = route.delivery_date || "-";
  const vehicleStr = [route.lorry_plate, route.driver_name, route.area].filter(Boolean).join(" / ");
  const allRows = [];
  (route.orders || []).forEach(ro => {
    const o = ro.orders;
    if (!o) return;
    const items = parseItemsSafe(o.items);
    const displayItems = items.length > 0 ? items : [{}];
    displayItems.forEach((item, idx) => { allRows.push({ o, ro, item, idx, rowspan: displayItems.length, isFirst: idx === 0 }); });
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-start justify-center pt-6 px-4 pb-6 overflow-y-auto">
      <style>{PRINT_STYLE}</style>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl">
        <div className="flex items-center justify-between px-6 py-3 border-b no-print">
          <h3 className="font-bold text-gray-800">🖨️ Print Preview — {route.lorry_plate || "Route"}</h3>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
            <button onClick={handlePrint} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">🖨️ Print</button>
          </div>
        </div>
        <div className="print-area p-4">
          <div className="text-center mb-3">
            <h1 style={{ fontSize:"14px", fontWeight:"bold", margin:0 }}>V Haus Living (Pg) Delivery Schedule</h1>
            <p style={{ fontSize:"11px", margin:"2px 0 0 0", color:"#444" }}>Date: {dateStr} &nbsp;|&nbsp; Vehicle: {vehicleStr || "-"}</p>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"10px" }}>
            <thead>
              <tr style={{ backgroundColor:"#c6efce", textAlign:"center" }}>
                {["SO / Customer","Trip","Check","Naik","Plate NO","No.","Code","Item","Unit","Supplier","Order Date","Supplier Sent","JB Sent","Arrival PG","Remark"].map(h => (
                  <th key={h} style={{ border:"1px solid #000", padding:"3px 4px", whiteSpace:"nowrap", fontWeight:"bold" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allRows.length === 0 && <tr><td colSpan={15} style={{ border:"1px solid #000", padding:"6px", textAlign:"center", color:"#888" }}>No orders assigned.</td></tr>}
              {allRows.map((row, i) => {
                const { o, ro, item, idx, rowspan, isFirst } = row;
                const hasBalance = parseFloat(o.balance) > 0;
                const tripLabel = ro.trip_no ? `Trip ${ro.trip_no}/${ro.total_trips}` : "-";
                return (
                  <tr key={`${o.id}-${idx}`} style={{ verticalAlign:"top" }}>
                    {isFirst && (
                      <td rowSpan={rowspan} style={{ border:"1px solid #000", padding:"3px 4px", minWidth:"140px", verticalAlign:"top" }}>
                        <div style={{ fontWeight:"bold" }}>{o.so_number}</div>
                        <div>{o.customer_name}</div>
                        {o.contact && <div style={{ color:"#555" }}>{o.contact}</div>}
                        {o.address && <div style={{ color:"#555", fontSize:"9px" }}>{o.address}</div>}
                        {hasBalance && <div style={{ color:"red", fontWeight:"bold" }}>Bal: RM {o.balance}</div>}
                        {ro.scheduled_time_range && <div style={{ color:"#1e40af", fontWeight:"bold" }}>⏰ {ro.scheduled_time_range}</div>}
                      </td>
                    )}
                    {isFirst && <td rowSpan={rowspan} style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center", verticalAlign:"top", fontSize:"9px", color:ro.trip_no > 1 ? "#6b7280" : "#059669" }}>{tripLabel}{ro.trip_no === 1 ? "\n💰" : ""}</td>}
                    <td style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center", minWidth:"28px" }}></td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center", minWidth:"28px" }}></td>
                    {isFirst && <td rowSpan={rowspan} style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center", verticalAlign:"top" }}>{route.lorry_plate || "-"}</td>}
                    <td style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center" }}>{idx + 1}</td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px" }}>{item.itemCode || ""}</td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px", minWidth:"120px" }}>{item.itemName || ""}</td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center" }}>{item.unit || ""}</td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px" }}>{item.supplier || ""}</td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center" }}>{item.itemOrderDate || ""}</td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center" }}>{item.supplierSentDate || ""}</td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center" }}></td>
                    <td style={{ border:"1px solid #000", padding:"3px 4px", textAlign:"center" }}>{item.arrivalDate ? item.arrivalDate : <span style={{ color:"red", fontWeight:"bold" }}>No arrival</span>}</td>
                    {isFirst && <td rowSpan={rowspan} style={{ border:"1px solid #000", padding:"3px 4px", verticalAlign:"top", minWidth:"80px" }}>{o.remark && <div>{o.remark}</div>}{ro.route_note && <div style={{ color:"#555", fontStyle:"italic" }}>{ro.route_note}</div>}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop:"8px", fontSize:"9px", color:"#888", textAlign:"right" }}>Printed: {new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</div>
        </div>
      </div>
    </div>
  );
}

function VehicleModal({ vehicles, onClose, onRefresh }) {
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ ...EMPTY_VEHICLE });
  const [editVehicleId, setEditVehicleId] = useState(null);
  const [editVehicle, setEditVehicle] = useState({});
  const createVehicle = async () => {
    if (!newVehicle.driver_name && !newVehicle.vehicle_plate) return alert("Please enter driver name or vehicle plate.");
    await fetch(`${API}/delivery/vehicles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newVehicle) });
    setNewVehicle({ ...EMPTY_VEHICLE }); setShowAddVehicle(false); onRefresh();
  };
  const saveVehicle = async (id) => {
    await fetch(`${API}/delivery/vehicles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editVehicle) });
    setEditVehicleId(null); onRefresh();
  };
  const deleteVehicle = async (id) => {
    if (!window.confirm("Delete this vehicle?")) return;
    await fetch(`${API}/delivery/vehicles/${id}`, { method: "DELETE" }); onRefresh();
  };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-10 px-4 pb-10 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-bold text-gray-800 text-base">🚛 Manage Vehicles</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">x</button>
        </div>
        <div className="px-6 py-4">
          {showAddVehicle ? (
            <div className="bg-blue-50 rounded-xl p-4 mb-4 border border-blue-200">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-3">Add New Vehicle</p>
              <div className="grid grid-cols-2 gap-3">
                {[{k:"driver_name",l:"Driver Name"},{k:"vehicle_plate",l:"Vehicle Plate"},{k:"vehicle_type",l:"Vehicle Type",span:true}].map(({k,l,span}) => (
                  <div key={k} className={span ? "col-span-2" : ""}>
                    <label className="text-xs text-gray-500 block mb-0.5">{l}</label>
                    <input value={newVehicle[k]} onChange={e => setNewVehicle(p => ({...p,[k]:e.target.value}))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Status</label>
                  <select value={newVehicle.status} onChange={e => setNewVehicle(p => ({...p,status:e.target.value}))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    <option>Active</option><option>Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end mt-3">
                <button onClick={() => setShowAddVehicle(false)} className="px-4 py-1.5 text-xs bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button onClick={createVehicle} className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Vehicle</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddVehicle(true)} className="mb-4 text-xs bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700">+ Add Vehicle</button>
          )}
          <div className="space-y-2">
            {vehicles.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No vehicles added yet.</p>}
            {vehicles.map(v => (
              <div key={v.id} className="border border-gray-200 rounded-lg p-3">
                {editVehicleId === v.id ? (
                  <div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {[{k:"driver_name",l:"Driver Name"},{k:"vehicle_plate",l:"Vehicle Plate"},{k:"vehicle_type",l:"Vehicle Type"}].map(({k,l}) => (
                        <div key={k}><label className="text-xs text-gray-400 block mb-0.5">{l}</label><input value={editVehicle[k]||""} onChange={e => setEditVehicle(p => ({...p,[k]:e.target.value}))} className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" /></div>
                      ))}
                      <div><label className="text-xs text-gray-400 block mb-0.5">Status</label><select value={editVehicle.status||"Active"} onChange={e => setEditVehicle(p => ({...p,status:e.target.value}))} className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"><option>Active</option><option>Inactive</option></select></div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditVehicleId(null)} className="px-3 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
                      <button onClick={() => saveVehicle(v.id)} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800">🚛 {v.vehicle_plate || "No Plate"}</span>
                      {v.driver_name && <span className="text-xs text-gray-500">👤 {v.driver_name}</span>}
                      {v.vehicle_type && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{v.vehicle_type}</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v.status === "Active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{v.status}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditVehicleId(v.id); setEditVehicle({...v}); }} className="text-gray-400 hover:text-blue-600 text-xs">✏️</button>
                      <button onClick={() => deleteVehicle(v.id)} className="text-gray-400 hover:text-red-500 text-xs">🗑️</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
        </div>
      </div>
    </div>
  );
}

function AddRouteModal({ activeVehicles, onClose, onCreate, onGoToVehicles }) {
  const [newRoute, setNewRoute] = useState({ ...EMPTY_ROUTE });
  const onVehicleSelect = (vehicleId) => {
    const v = activeVehicles.find(v => String(v.id) === String(vehicleId));
    if (v) setNewRoute(p => ({ ...p, vehicle_id: v.id, lorry_plate: v.vehicle_plate || "", driver_name: v.driver_name || "" }));
    else setNewRoute(p => ({ ...p, vehicle_id: "" }));
  };
  const handleCreate = async () => {
    if (!newRoute.lorry_plate && !newRoute.driver_name) return alert("Please select a vehicle or enter lorry plate / driver name.");
    const res = await onCreate(newRoute);
    if (res && res.error) alert(res.error);
  };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 className="font-bold text-gray-800 mb-4">Add New Route</h3>
        <div className="mb-3">
          <label className="text-xs text-gray-500 block mb-0.5">Select Vehicle (Active only)</label>
          <select value={newRoute.vehicle_id} onChange={e => onVehicleSelect(e.target.value)} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">-- Select Vehicle --</option>
            {activeVehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_plate ? `${v.vehicle_plate} — ` : ""}{v.driver_name || "Unknown driver"}{v.vehicle_type ? ` (${v.vehicle_type})` : ""}</option>)}
          </select>
          {activeVehicles.length === 0 && <p className="text-xs text-orange-500 mt-1">No active vehicles. <button onClick={onGoToVehicles} className="underline">Add vehicle first</button></p>}
        </div>
        <p className="text-xs text-gray-400 mb-2">Or enter manually:</p>
        <div className="space-y-2">
          {[{k:"lorry_plate",l:"Lorry Plate No"},{k:"driver_name",l:"Driver Name"},{k:"area",l:"Area / Zone"},{k:"notes",l:"Notes"}].map(({k,l}) => (
            <div key={k}><label className="text-xs text-gray-500 block mb-0.5">{l}</label><input value={newRoute[k]} onChange={e => setNewRoute(p => ({...p,[k]:e.target.value}))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
          ))}
        </div>
        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleCreate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create Route</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

// ── Auto Scheduler Modal ──────────────────────────────────────────
function AutoSchedulerModal({ date, companyId, onClose, onApproved }) {
  const API_URL = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
  const [step, setStep] = useState("loading"); // loading | duration | preview | approving
  const [orders, setOrders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [settings, setSettings] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []); // eslint-disable-line

  const loadOrders = async () => {
    setStep("loading");
    try {
      const res = await fetch(`${API_URL}/auto-schedule/orders?date=${date}${companyId ? `&company_id=${companyId}` : ""}`);
      const data = await res.json();
      if (data.error) { setError(data.error); setStep("error"); return; }
      setOrders(data.orders.map(o => ({ ...o, estimatedDuration: o.estimatedDuration || o.suggestedDuration || 90 })));
      setVehicles(data.vehicles);
      setSettings(data.settings);
      setStep(data.orders.length === 0 ? "empty" : "duration");
    } catch (e) { setError(e.message); setStep("error"); }
  };

  const updateDuration = (soNumber, val) => {
    setOrders(prev => prev.map(o => o.so_number === soNumber ? { ...o, estimatedDuration: parseInt(val) || 0 } : o));
  };

  const generateSchedule = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/auto-schedule/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, company_id: companyId, orders, vehicles, settings }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || "Failed to generate schedule"); setGenerating(false); return; }
      setSchedule(data.schedule);
      setStep("preview");
    } catch (e) { setError(e.message); }
    setGenerating(false);
  };

  const approveSchedule = async () => {
    setStep("approving");
    try {
      const durations = orders.map(o => ({
        itemType: o.itemType,
        itemKeywords: o.itemKeywords,
        area: schedule?.vehicles?.flatMap(v => v.stops).find(s => s.so_number === o.so_number)?.area || "",
        duration_minutes: o.estimatedDuration,
      }));
      const res = await fetch(`${API_URL}/auto-schedule/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, company_id: companyId, schedule, durations }),
      });
      const data = await res.json();
      if (data.success) { onApproved(); onClose(); }
      else { setError(data.error || "Failed to approve"); setStep("preview"); }
    } catch (e) { setError(e.message); setStep("preview"); }
  };

  const timeColor = (type) => type === "Wardrobe" ? "text-orange-600" : type === "Service" ? "text-purple-600" : "text-blue-600";
  const typeBadge = (type) => type === "Wardrobe" ? "bg-orange-100 text-orange-700" : type === "Service" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-start justify-center z-50 pt-6 px-4 pb-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-600 to-blue-500 rounded-t-2xl">
          <div>
            <h2 className="text-white font-bold text-base">⚡ Auto-Schedule</h2>
            <p className="text-blue-100 text-xs mt-0.5">{date} · {vehicles.length} vehicle(s) available</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-blue-200 text-2xl font-bold leading-none">×</button>
        </div>

        <div className="px-6 py-5">
          {/* Loading */}
          {step === "loading" && <div className="text-center py-12 text-gray-400">Loading orders...</div>}

          {/* Error */}
          {step === "error" && <div className="text-center py-8"><p className="text-red-600 mb-4">{error}</p><button onClick={loadOrders} className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg">Retry</button></div>}

          {/* Empty */}
          {step === "empty" && <div className="text-center py-12 text-gray-400"><div className="text-4xl mb-3">📦</div><p>No unassigned orders for {date}.</p></div>}

          {/* Step 1: Duration input */}
          {step === "duration" && (
            <div>
              <p className="text-sm text-gray-500 mb-4">Set estimated duration for each order. AI will use this to build the optimal schedule.</p>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {orders.map(o => {
                  const items = Array.isArray(o.items) ? o.items : [];
                  return (
                    <div key={o.so_number} className="border border-gray-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-blue-700 text-sm">{o.so_number}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadge(o.itemType)}`}>{o.itemType}</span>
                          <span className="text-xs text-gray-500">{o.customer_name}</span>
                        </div>
                        {o.time_slot && <span className="text-xs text-indigo-600 font-medium">⏰ {o.time_slot}</span>}
                      </div>
                      <p className="text-xs text-gray-400 mb-1 truncate">📍 {o.address}</p>
                      <p className="text-xs text-gray-400 mb-2 truncate">📦 {items.map(i => i.itemName).filter(Boolean).join(", ") || "-"}</p>
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Duration (min):</label>
                        <input
                          type="number"
                          value={o.estimatedDuration}
                          onChange={e => updateDuration(o.so_number, e.target.value)}
                          min="15" max="480" step="15"
                          className="w-24 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                        <span className={`text-xs font-medium ${timeColor(o.itemType)}`}>
                          ≈ {Math.floor(o.estimatedDuration / 60)}h {o.estimatedDuration % 60 > 0 ? `${o.estimatedDuration % 60}m` : ""}
                          {o.suggestedDuration === o.estimatedDuration && " (AI suggested)"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
              <div className="flex gap-3 justify-end mt-4">
                <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                <button onClick={generateSchedule} disabled={generating || orders.some(o => !o.estimatedDuration)} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                  {generating ? "⏳ Generating..." : "⚡ Generate Schedule"}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === "preview" && schedule && (
            <div>
              <p className="text-sm text-gray-500 mb-1">{schedule.summary}</p>
              {schedule.overflow?.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                  <p className="text-xs font-bold text-orange-700 mb-1">⚠️ {schedule.overflow.length} order(s) cannot fit today:</p>
                  {schedule.overflow.map(o => <p key={o.so_number} className="text-xs text-orange-600">• SO {o.so_number} — {o.reason}</p>)}
                </div>
              )}
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {schedule.vehicles?.map((v, vi) => (
                  <div key={vi} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-blue-50 px-4 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-blue-800">🚛 {v.vehicle_plate || "Vehicle " + (vi+1)}</span>
                        {v.driver_name && <span className="text-xs text-gray-500">👤 {v.driver_name}</span>}
                      </div>
                      <div className="text-xs text-gray-500">
                        {v.stops?.length} stops · Return: {v.return_time}
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {v.stops?.map((stop, si) => (
                        <div key={si} className="px-4 py-2.5 flex items-start gap-3">
                          <div className="text-xs text-blue-600 font-bold w-24 flex-shrink-0 pt-0.5">
                            {stop.start_time} - {stop.end_time}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-gray-800">{stop.so_number}</span>
                              <span className="text-xs text-gray-600">{stop.customer_name}</span>
                              {stop.area && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">📍 {stop.area}</span>}
                            </div>
                            <p className="text-xs text-gray-400 truncate mt-0.5">{stop.address}</p>
                            {stop.notes && <p className="text-xs text-orange-600 mt-0.5">📝 {stop.notes}</p>}
                          </div>
                          <div className="text-xs text-gray-400 flex-shrink-0">{stop.duration_minutes}min</div>
                        </div>
                      ))}
                    </div>
                    {v.warnings?.length > 0 && (
                      <div className="px-4 py-2 bg-yellow-50 border-t border-yellow-100">
                        {v.warnings.map((w, wi) => <p key={wi} className="text-xs text-yellow-700">⚠️ {w}</p>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
              <div className="flex gap-3 justify-between mt-4">
                <button onClick={() => setStep("duration")} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">← Adjust Durations</button>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                  <button onClick={approveSchedule} className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">✅ Approve & Create Routes</button>
                </div>
              </div>
            </div>
          )}

          {/* Approving */}
          {step === "approving" && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">⚡</div>
              <p className="text-gray-600 font-medium">Creating routes...</p>
              <p className="text-xs text-gray-400 mt-1">Setting up delivery schedule and confirming routes.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DeliverySchedule() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [routes, setRoutes] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [trips, setTrips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editRouteId, setEditRouteId] = useState(null);
  const [editRoute, setEditRoute] = useState({});
  const [dragOrder, setDragOrder] = useState(null);
  const [draggingAssigned, setDraggingAssigned] = useState(null);
  const [printRoute, setPrintRoute] = useState(null);
  const [showAutoScheduler, setShowAutoScheduler] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [routeRes, unassignedRes, tripsRes] = await Promise.all([
        fetch(`${API}/delivery/routes?date=${date}`),
        fetch(`${API}/delivery/unassigned?date=${date}`),
        fetch(`${API}/order-trips?date=${date}`),
      ]);
      const [routeData, unassignedData, tripsData] = await Promise.all([
        routeRes.json(), unassignedRes.json(), tripsRes.json()
      ]);
      setRoutes(Array.isArray(routeData) ? routeData : []);
      setUnassigned(Array.isArray(unassignedData) ? unassignedData : []);
      setTrips(Array.isArray(tripsData) ? tripsData : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [date]);

  const loadVehicles = useCallback(async () => {
    try { const res = await fetch(`${API}/delivery/vehicles`); const data = await res.json(); setVehicles(Array.isArray(data) ? data : []); }
    catch (e) { console.error(e); }
  }, []);

  const [serviceOrders, setServiceOrders] = useState([]);

  const loadServiceOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API}/delivery/unassigned?date=${date}`);
      const data = await res.json();
      setServiceOrders(Array.isArray(data) ? data.filter(o => o.type === "Service") : []);
    } catch (e) { console.error("loadServiceOrders error:", e); }
  }, [date]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadVehicles(); }, [loadVehicles]);
  useEffect(() => { loadServiceOrders(); }, [loadServiceOrders]);

  const activeVehicles = vehicles.filter(v => v.status === "Active");

  // Build combined unassigned list: regular orders + service orders + scheduled trips
  const combinedUnassigned = [
    ...unassigned.filter(o => !o.is_multi_trip && o.type !== "Service").map(o => ({ ...o, _type: "order" })),
    ...serviceOrders.map(o => ({ ...o, _type: "service" })),
    ...trips.map(t => ({ ...t, _type: "trip" })),
  ].sort((a, b) => {
    const aTime = (a._type === "order" || a._type === "service") ? (a.time_slot || "") : (a.orders?.time_slot || "");
    const bTime = (b._type === "order" || b._type === "service") ? (b.time_slot || "") : (b.orders?.time_slot || "");
    return aTime.localeCompare(bTime);
  });

  const createRoute = async (newRoute) => {
    const res = await fetch(`${API}/delivery/routes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newRoute, delivery_date: date }) });
    const data = await res.json();
    if (res.status === 409 || data.error) return { error: data.error };
    setShowAddRoute(false); loadData();
  };

  const updateRoute = async (id) => {
    await fetch(`${API}/delivery/routes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editRoute) });
    setEditRouteId(null); loadData();
  };

  const deleteRoute = async (id) => {
    if (!window.confirm("Delete this route?")) return;
    const res = await fetch(`${API}/delivery/routes/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadData();
  };

  const assignItem = async (routeId, id, type) => {
    const route = routes.find(r => r.id === routeId);
    const seqNo = (route?.orders?.length || 0) + 1;
    if (type === "trip") {
      // Assign trip — update trip status to Assigned + set scheduled_date
      await fetch(`${API}/order-trips/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Assigned", scheduled_date: date }) });
      // Also add to delivery_route_orders using the SO's order id
      const trip = trips.find(t => t.id === id);
      if (trip) {
        const tripOrder = unassigned.find(o => o.so_number === trip.so_number);
        if (tripOrder) {
          await fetch(`${API}/delivery/routes/${routeId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: tripOrder.id, sequence_no: seqNo }) });
        }
      }
    } else {
      const res = await fetch(`${API}/delivery/routes/${routeId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: id, sequence_no: seqNo }) });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
    }
    loadData();
  };

  const unassignOrder = async (routeId, orderId) => {
    const res = await fetch(`${API}/delivery/routes/${routeId}/orders/${orderId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadData();
  };

  const updateStatus = async (routeId, status) => {
    await fetch(`${API}/delivery/routes/${routeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    await loadData();
  };

  const updateSeq = async (routeId, orderId, seq) => {
    await fetch(`${API}/delivery/routes/${routeId}/orders/${orderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequence_no: parseInt(seq) }) });
  };

  const handleAssignedDragStart = (routeId, fromIndex) => setDraggingAssigned({ routeId, fromIndex });
  const handleAssignedDrop = async (routeId, toIndex) => {
    if (!draggingAssigned || draggingAssigned.routeId !== routeId) return;
    const { fromIndex } = draggingAssigned;
    if (fromIndex === toIndex) { setDraggingAssigned(null); return; }
    const route = routes.find(r => r.id === routeId);
    if (!route) return;
    const newOrders = [...route.orders];
    const [moved] = newOrders.splice(fromIndex, 1);
    newOrders.splice(toIndex, 0, moved);
    setRoutes(prev => prev.map(r => r.id === routeId ? { ...r, orders: newOrders } : r));
    setDraggingAssigned(null);
    await Promise.all(newOrders.map((ro, i) => updateSeq(routeId, ro.orders?.id || ro.order_id, i + 1)));
    loadData();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-base font-bold text-gray-700">🚚 Delivery Schedule</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-medium text-blue-700" />
          <button onClick={loadData} className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-50">🔄 Refresh</button>
          <button onClick={() => setShowVehicleModal(true)} className="bg-gray-700 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-gray-800">🚛 Manage Vehicles</button>
          <button onClick={() => setShowAddRoute(true)} className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-blue-700">+ Add Route</button>
        </div>
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>}
      {showVehicleModal && <VehicleModal vehicles={vehicles} onClose={() => setShowVehicleModal(false)} onRefresh={loadVehicles} />}
      {showAddRoute && <AddRouteModal activeVehicles={activeVehicles} onClose={() => setShowAddRoute(false)} onCreate={createRoute} onGoToVehicles={() => { setShowAddRoute(false); setShowVehicleModal(true); }} />}
      {printRoute && <RoutePrintView route={printRoute} onClose={() => setPrintRoute(null)} />}
      {showAutoScheduler && (
        <AutoSchedulerModal
          date={date}
          companyId={companyId}
          onClose={() => setShowAutoScheduler(false)}
          onApproved={() => { loadData(); loadServiceOrders(); }}
        />
      )}

      <div className="flex flex-col xl:flex-row gap-4">
        {/* Unassigned Panel — mixed orders + trips */}
        <div className="xl:w-72 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b bg-orange-50 rounded-t-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-orange-700">
                  📦 Unassigned <span className="ml-1 bg-orange-200 text-orange-800 text-xs px-2 py-0.5 rounded-full">{combinedUnassigned.length}</span>
                </h3>
              </div>
              <div className="flex gap-2 mt-1 flex-wrap">
                <span className="text-xs text-gray-500">🔵 Delivery</span>
                <span className="text-xs text-purple-600">🟣 Service</span>
                <span className="text-xs text-purple-400">🔷 Trips</span>
              </div>
            </div>
            <div className="p-3 space-y-2 max-h-screen overflow-y-auto">
              {combinedUnassigned.length === 0
                ? <p className="text-xs text-gray-400 text-center py-4">All assigned!</p>
                : combinedUnassigned.map(item => {
                    if (item._type === "trip") {
                      return (
                        <TripCard
                          key={`trip-${item.id}`}
                          trip={item}
                          routes={routes}
                          onAssign={assignItem}
                          onDragStart={() => setDragOrder({ ...item, _type: "trip" })}
                        />
                      );
                    }
                    // Service order card
                    if (item._type === "service") {
                      const items = parseItems(item.items);
                      return (
                        <div key={`service-${item.id}`} className="bg-purple-50 border border-purple-200 rounded-lg p-2 cursor-grab"
                          draggable onDragStart={() => setDragOrder({ ...item, _type: "order" })}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1">
                              <span className="text-xs bg-purple-200 text-purple-800 font-bold px-1.5 py-0.5 rounded">SVC</span>
                              <span className="font-bold text-purple-700 text-xs">{item.so_number}</span>
                              {item.sv_number && <span className="text-xs text-purple-400">{item.sv_number}</span>}
                            </div>
                            {parseFloat(item.balance) > 0 && <span className="text-red-500 text-xs font-medium">RM {item.balance}</span>}
                          </div>
                          <p className="text-xs font-medium text-gray-700">{item.customer_name}</p>
                          <p className="text-xs text-gray-400 leading-tight">{item.address}</p>
                          {item.time_slot && <p className="text-xs text-indigo-600 font-medium">{item.time_slot}</p>}
                          {item.service_note && <p className="text-xs text-purple-600 mt-0.5 truncate">📝 {item.service_note}</p>}
                          <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
                          {routes.length > 0 && (
                            <select onChange={e => { if (e.target.value) assignItem(e.target.value, item.id, "order"); }}
                              className="mt-2 w-full text-xs border rounded px-1 py-1 text-gray-600">
                              <option value="">Assign to route...</option>
                              {routes.filter(r => r.status === "Pending" || r.status === "Confirmed").map(r => (
                                <option key={r.id} value={r.id}>{r.lorry_plate || r.driver_name} {r.area ? `(${r.area})` : ""}{r.status === "Confirmed" ? " ✅" : ""}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    }

                    // Regular delivery order card
                    const items = parseItems(item.items);
                    return (
                      <div key={`order-${item.id}`} className="bg-orange-50 border border-orange-200 rounded-lg p-2 cursor-grab"
                        draggable onDragStart={() => setDragOrder({ ...item, _type: "order" })}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-blue-700 text-xs">{item.so_number}</span>
                          {parseFloat(item.balance) > 0 && <span className="text-red-500 text-xs font-medium">RM {item.balance}</span>}
                        </div>
                        <p className="text-xs font-medium text-gray-700">{item.customer_name}</p>
                        <p className="text-xs text-gray-400 leading-tight">{item.address}</p>
                        {item.time_slot && <p className="text-xs text-indigo-600 font-medium">{item.time_slot}</p>}
                        <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
                        {routes.length > 0 && (
                          <select onChange={e => { if (e.target.value) assignItem(e.target.value, item.id, "order"); }}
                            className="mt-2 w-full text-xs border rounded px-1 py-1 text-gray-600">
                            <option value="">Assign to route...</option>
                            {routes.filter(r => r.status === "Pending").map(r => (
                              <option key={r.id} value={r.id}>{r.lorry_plate || r.driver_name} {r.area ? `(${r.area})` : ""}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
            </div>
          </div>
        </div>

        {/* Route Cards */}
        <div className="flex-1 min-w-0">
          {routes.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-2">🚛</div>
              <p className="text-sm">No routes created for this date.</p>
              <p className="text-xs mt-1">Click "+ Add Route" to get started.</p>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {routes.map(route => {
              const isLocked = route.status === "Out for Delivery" || route.status === "Delivered";
              const isConfirmed = route.status === "Confirmed";
              return (
                <div key={route.id} className={`bg-white rounded-xl border shadow-sm ${isLocked ? "border-gray-300" : isConfirmed ? "border-green-300" : "border-gray-200"}`}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={() => {
                    if (!dragOrder || isLocked || isConfirmed) return;
                    assignItem(route.id, dragOrder.id, dragOrder._type);
                    setDragOrder(null);
                  }}>
                  {/* Route Header */}
                  {editRouteId === route.id ? (
                    <div className="px-4 py-3 border-b space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        {[{k:"lorry_plate",l:"Lorry Plate"},{k:"driver_name",l:"Driver"},{k:"area",l:"Area"},{k:"notes",l:"Notes"}].map(({k,l}) => (
                          <div key={k}><label className="text-xs text-gray-400">{l}</label><input value={editRoute[k]||""} onChange={e => setEditRoute(p => ({...p,[k]:e.target.value}))} className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" /></div>
                        ))}
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditRouteId(null)} className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
                        <button onClick={() => updateRoute(route.id)} className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                      </div>
                    </div>
                  ) : (
                    <div className={`px-4 py-3 border-b rounded-t-xl ${isLocked ? "bg-gray-50" : isConfirmed ? "bg-green-50" : "bg-blue-50"}`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-blue-800 text-sm">🚛 {route.lorry_plate || "No Plate"}</span>
                            {route.driver_name && <span className="text-xs text-gray-600">👤 {route.driver_name}</span>}
                            {route.area && <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">📍 {route.area}</span>}
                            {isLocked && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">🔒 Locked</span>}
                          </div>
                          {route.notes && <p className="text-xs text-gray-500 mt-1">{route.notes}</p>}
                          <p className="text-xs text-gray-400 mt-0.5">{route.orders?.length || 0} stops</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <div className="flex flex-col items-end gap-1">
                            <select value={route.status} onChange={e => updateStatus(route.id, e.target.value)}
                              className={`text-xs rounded px-2 py-0.5 border-0 font-medium cursor-pointer ${statusColor(route.status)}`}>
                              {isLocked
                                ? ["Out for Delivery","Delivered"].map(s => <option key={s}>{s}</option>)
                                : isConfirmed
                                ? ["Confirmed","Pending"].concat(route.delivery_date === todayMY ? ["Out for Delivery"] : []).map(s => <option key={s}>{s}</option>)
                                : ["Pending","Confirmed"].concat(route.delivery_date === todayMY ? ["Out for Delivery"] : [], ["Delivered"]).map(s => <option key={s}>{s}</option>)
                              }
                            </select>
                            {!isLocked && !isConfirmed && route.delivery_date !== todayMY && (
                              <p className="text-xs text-orange-400 text-right">Out for Delivery only on delivery date.</p>
                            )}
                            {isConfirmed && (
                              <p className="text-xs text-green-600 text-right font-medium">🔒 Confirmed — set to Pending to edit</p>
                            )}
                          </div>
                          <button onClick={() => setPrintRoute(route)} className="text-gray-400 hover:text-gray-700 text-xs" title="Print">🖨️</button>
                          {!isLocked && !isConfirmed && <>
                            <button onClick={() => { setEditRouteId(route.id); setEditRoute({...route}); }} className="text-gray-400 hover:text-blue-600 text-xs">✏️</button>
                            <button onClick={() => deleteRoute(route.id)} className="text-gray-400 hover:text-red-500 text-xs">🗑️</button>
                          </>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Assigned Orders */}
                  <div className="p-3 space-y-2 min-h-16">
                    {(!route.orders || route.orders.length === 0) && (
                      <p className="text-xs text-gray-300 text-center py-3">
                        {isLocked ? "No orders in this route." : isConfirmed ? "Route confirmed — unlock to Pending to edit." : "Drop orders or trips here"}
                      </p>
                    )}
                    {route.orders?.map((ro, index) => {
                      // Check if this is a multi-trip order
                      const linkedTrip = trips.find(t => t.so_number === ro.orders?.so_number);
                      return (
                        <AssignedOrderCard
                          key={ro.id}
                          ro={linkedTrip ? { ...ro, ...linkedTrip, orders: ro.orders } : ro}
                          routeId={route.id}
                          index={index}
                          isLocked={isLocked}
                          isTrip={!!linkedTrip}
                          onUnassign={unassignOrder}
                          onDragStart={(fromIndex) => handleAssignedDragStart(route.id, fromIndex)}
                          onDragOver={() => {}}
                          onDrop={(toIndex) => handleAssignedDrop(route.id, toIndex)}
                          onSaved={loadData}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}