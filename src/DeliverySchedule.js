import { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";

const statusColor = s => ({
  "Pending": "bg-yellow-100 text-yellow-800",
  "Out for Delivery": "bg-blue-100 text-blue-800",
  "Delivered": "bg-green-100 text-green-800",
}[s] || "bg-gray-100 text-gray-700");

const parseItems = items => {
  try { return typeof items === "string" ? JSON.parse(items || "[]") : (items || []); }
  catch { return []; }
};

const EMPTY_VEHICLE = { driver_name: "", vehicle_plate: "", vehicle_type: "", status: "Active" };
const EMPTY_ROUTE = { vehicle_id: "", lorry_plate: "", driver_name: "", area: "", notes: "" };

// ── Assigned Order Card ───────────────────────────────────────────
function AssignedOrderCard({ ro, routeId, index, isLocked, onUnassign, onDragStart, onDragOver, onDrop, onSaved }) {
  const o = ro.orders;
  const [scheduledTime, setScheduledTime] = useState(ro.scheduled_time_range || "");
  const [editingTime, setEditingTime] = useState(!ro.scheduled_time_range);
  const [routeNote, setRouteNote] = useState(ro.route_note || "");
  const [showItems, setShowItems] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!o) return null;

  const items = parseItems(o.items);
  const preferredTime = o.time_slot || "";

  const saveScheduledTime = async () => {
    if (!scheduledTime.trim()) return;
    setSaving(true);
    await fetch(`${API}/delivery/routes/${routeId}/orders/${o.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_time_range: scheduledTime })
    });
    setSaving(false);
    setEditingTime(false);
    if (onSaved) onSaved();
  };

  const usePreferred = () => { if (preferredTime) setScheduledTime(preferredTime); };

  const saveRouteNote = async (val) => {
    setRouteNote(val);
    await fetch(`${API}/delivery/routes/${routeId}/orders/${o.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route_note: val })
    });
  };

  return (
    <div
      className={`bg-gray-50 border rounded-lg p-2 ${isLocked ? "border-gray-200 opacity-80" : "border-gray-200 cursor-grab"}`}
      draggable={!isLocked}
      onDragStart={() => !isLocked && onDragStart(index)}
      onDragOver={e => { e.preventDefault(); !isLocked && onDragOver(index); }}
      onDrop={() => !isLocked && onDrop(index)}
    >
      {/* Row 1: Handle | # | SO | Customer | Balance | Unassign */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {!isLocked && <span className="text-gray-300 text-xs select-none cursor-grab">⋮⋮</span>}
        <span className="text-xs text-gray-400 font-medium flex-shrink-0">#{index + 1}</span>
        <span className="font-bold text-blue-700 text-xs flex-shrink-0">{o.so_number}</span>
        <span className="text-xs font-medium text-gray-700 truncate flex-1">{o.customer_name}</span>
        {parseFloat(o.balance) > 0 && <span className="text-red-500 text-xs font-medium flex-shrink-0">RM {o.balance}</span>}
        {!isLocked && (
          <button onClick={() => onUnassign(routeId, o.id)} className="text-gray-300 hover:text-red-500 text-xs flex-shrink-0" title="Unassign">x</button>
        )}
      </div>

      {/* Row 2: Address | Preferred | Scheduled */}
      <div className="space-y-1.5 mb-1.5">
        <p className="text-xs text-gray-400 truncate">{o.address}</p>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 flex-shrink-0">Preferred:</span>
          {preferredTime
            ? <span className="text-xs font-medium text-purple-600 bg-purple-50 rounded px-1.5 py-0.5">{preferredTime}</span>
            : <span className="text-xs text-gray-300">-</span>}
        </div>

        {!isLocked && (
          editingTime ? (
            <div className="flex items-center gap-1">
              <input
                value={scheduledTime}
                onChange={e => setScheduledTime(e.target.value)}
                placeholder="Actual scheduled time..."
                className={`flex-1 text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 min-w-0 ${scheduledTime ? "border-blue-300 bg-blue-50 text-blue-700 font-medium" : "border-gray-200 text-gray-500"}`}
              />
              {preferredTime && (
                <button onClick={usePreferred} className="text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 px-1.5 py-1 rounded whitespace-nowrap flex-shrink-0">Use</button>
              )}
              <button onClick={saveScheduledTime} disabled={saving} className="text-xs bg-blue-600 text-white hover:bg-blue-700 px-2 py-1 rounded flex-shrink-0 disabled:opacity-50">
                {saving ? "..." : "Save"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-blue-700 font-medium bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 flex-1 truncate">⏰ {scheduledTime}</span>
              <button onClick={() => setEditingTime(true)} className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded flex-shrink-0">Edit</button>
            </div>
          )
        )}

        {isLocked && scheduledTime && (
          <span className="text-xs text-blue-700 font-medium bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 inline-block">⏰ {scheduledTime}</span>
        )}
      </div>

      {/* Row 3: Eye + Items + Route Note */}
      <div className="space-y-1">
        <button onClick={() => setShowItems(p => !p)} className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1">
          👁️ <span>{showItems ? "Hide Items" : "View Items"}</span>
        </button>

        {showItems && (
          <div className="bg-white border border-gray-100 rounded-lg p-2 space-y-1.5">
            {items.length === 0
              ? <p className="text-xs text-gray-400">No items found.</p>
              : items.map((item, i) => (
                <div key={i} className="text-xs">
                  <p className="font-medium text-gray-700">
                    {i + 1}. {item.itemCode ? `[${item.itemCode}] ` : ""}{item.itemName || "-"} <span className="text-gray-400">x{item.unit || 1}</span>
                  </p>
                  {item.supplier && <p className="text-gray-400 ml-3">Supplier: {item.supplier}</p>}
                  {item.arrivalDate && <p className="text-gray-400 ml-3">Arrival: {item.arrivalDate}</p>}
                </div>
              ))}
          </div>
        )}

        {!isLocked && (
          <input
            value={routeNote}
            onChange={e => setRouteNote(e.target.value)}
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

// ── Vehicle Modal ─────────────────────────────────────────────────
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
                {[{ k: "driver_name", l: "Driver Name" }, { k: "vehicle_plate", l: "Vehicle Plate" }, { k: "vehicle_type", l: "Vehicle Type (e.g. Lorry, Van)", span: true }].map(({ k, l, span }) => (
                  <div key={k} className={span ? "col-span-2" : ""}>
                    <label className="text-xs text-gray-500 block mb-0.5">{l}</label>
                    <input value={newVehicle[k]} onChange={e => setNewVehicle(p => ({ ...p, [k]: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Status</label>
                  <select value={newVehicle.status} onChange={e => setNewVehicle(p => ({ ...p, status: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
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
                      {[{ k: "driver_name", l: "Driver Name" }, { k: "vehicle_plate", l: "Vehicle Plate" }, { k: "vehicle_type", l: "Vehicle Type" }].map(({ k, l }) => (
                        <div key={k}>
                          <label className="text-xs text-gray-400 block mb-0.5">{l}</label>
                          <input value={editVehicle[k] || ""} onChange={e => setEditVehicle(p => ({ ...p, [k]: e.target.value }))} className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
                        </div>
                      ))}
                      <div>
                        <label className="text-xs text-gray-400 block mb-0.5">Status</label>
                        <select value={editVehicle.status || "Active"} onChange={e => setEditVehicle(p => ({ ...p, status: e.target.value }))} className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300">
                          <option>Active</option><option>Inactive</option>
                        </select>
                      </div>
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
                      <button onClick={() => { setEditVehicleId(v.id); setEditVehicle({ ...v }); }} className="text-gray-400 hover:text-blue-600 text-xs">✏️</button>
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

// ── Add Route Modal ───────────────────────────────────────────────
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
            {activeVehicles.map(v => (
              <option key={v.id} value={v.id}>{v.vehicle_plate ? `${v.vehicle_plate} — ` : ""}{v.driver_name || "Unknown driver"}{v.vehicle_type ? ` (${v.vehicle_type})` : ""}</option>
            ))}
          </select>
          {activeVehicles.length === 0 && (
            <p className="text-xs text-orange-500 mt-1">No active vehicles.{" "}<button onClick={onGoToVehicles} className="underline">Add vehicle first</button></p>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-2">Or enter manually:</p>
        <div className="space-y-2">
          {[{ k: "lorry_plate", l: "Lorry Plate No" }, { k: "driver_name", l: "Driver Name" }, { k: "area", l: "Area / Zone" }, { k: "notes", l: "Notes" }].map(({ k, l }) => (
            <div key={k}>
              <label className="text-xs text-gray-500 block mb-0.5">{l}</label>
              <input value={newRoute[k]} onChange={e => setNewRoute(p => ({ ...p, [k]: e.target.value }))} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
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
export default function DeliverySchedule() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [routes, setRoutes] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editRouteId, setEditRouteId] = useState(null);
  const [editRoute, setEditRoute] = useState({});
  const [dragOrder, setDragOrder] = useState(null); // for unassigned drag
  const [draggingAssigned, setDraggingAssigned] = useState(null); // { routeId, fromIndex }

  const loadRoutes = useCallback(async () => {
    setLoading(true);
    try {
      const [routeRes, unassignedRes] = await Promise.all([
        fetch(`${API}/delivery/routes?date=${date}`),
        fetch(`${API}/delivery/unassigned?date=${date}`)
      ]);
      const [routeData, unassignedData] = await Promise.all([routeRes.json(), unassignedRes.json()]);
      setRoutes(Array.isArray(routeData) ? routeData : []);
      setUnassigned(Array.isArray(unassignedData) ? unassignedData : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [date]);

  const loadVehicles = useCallback(async () => {
    try {
      const res = await fetch(`${API}/delivery/vehicles`);
      const data = await res.json();
      setVehicles(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);
  useEffect(() => { loadVehicles(); }, [loadVehicles]);

  const activeVehicles = vehicles.filter(v => v.status === "Active");

  const createRoute = async (newRoute) => {
    const res = await fetch(`${API}/delivery/routes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newRoute, delivery_date: date })
    });
    const data = await res.json();
    if (res.status === 409 || data.error) return { error: data.error };
    setShowAddRoute(false); loadRoutes();
  };

  const updateRoute = async (id) => {
    await fetch(`${API}/delivery/routes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editRoute) });
    setEditRouteId(null); loadRoutes();
  };

  const deleteRoute = async (id) => {
    if (!window.confirm("Delete this route?")) return;
    const res = await fetch(`${API}/delivery/routes/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadRoutes();
  };

  const assignOrder = async (routeId, orderId) => {
    const route = routes.find(r => r.id === routeId);
    const seqNo = (route?.orders?.length || 0) + 1;
    const res = await fetch(`${API}/delivery/routes/${routeId}/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId, sequence_no: seqNo })
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadRoutes();
  };

  const unassignOrder = async (routeId, orderId) => {
    const res = await fetch(`${API}/delivery/routes/${routeId}/orders/${orderId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadRoutes();
  };

  const updateStatus = async (routeId, status) => {
    await fetch(`${API}/delivery/routes/${routeId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status })
    });
    await loadRoutes();
  };

  const updateSeq = async (routeId, orderId, seq) => {
    await fetch(`${API}/delivery/routes/${routeId}/orders/${orderId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence_no: parseInt(seq) })
    });
  };

  // ── Assigned order drag-to-sort ───────────────────────────────
  const handleAssignedDragStart = (routeId, fromIndex) => {
    setDraggingAssigned({ routeId, fromIndex });
  };

  const handleAssignedDragOver = (_index) => {};

  const handleAssignedDrop = async (routeId, toIndex) => {
    if (!draggingAssigned || draggingAssigned.routeId !== routeId) return;
    const { fromIndex } = draggingAssigned;
    if (fromIndex === toIndex) { setDraggingAssigned(null); return; }

    // Reorder locally
    const route = routes.find(r => r.id === routeId);
    if (!route) return;
    const newOrders = [...route.orders];
    const [moved] = newOrders.splice(fromIndex, 1);
    newOrders.splice(toIndex, 0, moved);

    // Optimistic update
    setRoutes(prev => prev.map(r => r.id === routeId ? { ...r, orders: newOrders } : r));
    setDraggingAssigned(null);

    // Persist sequence to backend
    await Promise.all(newOrders.map((ro, i) => updateSeq(routeId, ro.orders?.id || ro.order_id, i + 1)));
    loadRoutes();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-base font-bold text-gray-700">🚚 Delivery Schedule</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-medium text-blue-700" />
          <button onClick={loadRoutes} className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-50">🔄 Refresh</button>
          <button onClick={() => setShowVehicleModal(true)} className="bg-gray-700 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-gray-800">🚛 Manage Vehicles</button>
          <button onClick={() => setShowAddRoute(true)} className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-blue-700">+ Add Route</button>
        </div>
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>}

      {showVehicleModal && <VehicleModal vehicles={vehicles} onClose={() => setShowVehicleModal(false)} onRefresh={loadVehicles} />}
      {showAddRoute && <AddRouteModal activeVehicles={activeVehicles} onClose={() => setShowAddRoute(false)} onCreate={createRoute} onGoToVehicles={() => { setShowAddRoute(false); setShowVehicleModal(true); }} />}

      <div className="flex flex-col xl:flex-row gap-4">

        {/* Unassigned Orders */}
        <div className="xl:w-72 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b bg-orange-50 rounded-t-xl">
              <h3 className="text-sm font-bold text-orange-700">
                📦 Unassigned <span className="ml-1 bg-orange-200 text-orange-800 text-xs px-2 py-0.5 rounded-full">{unassigned.length}</span>
              </h3>
            </div>
            <div className="p-3 space-y-2 max-h-screen overflow-y-auto">
              {unassigned.length === 0
                ? <p className="text-xs text-gray-400 text-center py-4">All orders assigned!</p>
                : unassigned.map(o => {
                  const items = parseItems(o.items);
                  return (
                    <div key={o.id} className="bg-orange-50 border border-orange-200 rounded-lg p-2 cursor-grab"
                      draggable onDragStart={() => setDragOrder(o)}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-blue-700 text-xs">{o.so_number}</span>
                        {parseFloat(o.balance) > 0 && <span className="text-red-500 text-xs font-medium">RM {o.balance}</span>}
                      </div>
                      <p className="text-xs font-medium text-gray-700">{o.customer_name}</p>
                      <p className="text-xs text-gray-400 leading-tight">{o.address}</p>
                      {o.time_slot && <p className="text-xs text-indigo-600 font-medium">{o.time_slot}</p>}
                      <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
                      {routes.length > 0 && (
                        <select onChange={e => { if (e.target.value) assignOrder(e.target.value, o.id); }}
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
              return (
                <div key={route.id} className={`bg-white rounded-xl border shadow-sm ${isLocked ? "border-gray-300" : "border-gray-200"}`}
                  onDragOver={e => { e.preventDefault(); if (dragOrder && !isLocked) {} }}
                  onDrop={() => { if (dragOrder && !isLocked) { assignOrder(route.id, dragOrder.id); setDragOrder(null); } }}>

                  {/* Route Header */}
                  {editRouteId === route.id ? (
                    <div className="px-4 py-3 border-b space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        {[{k:"lorry_plate",l:"Lorry Plate"},{k:"driver_name",l:"Driver"},{k:"area",l:"Area"},{k:"notes",l:"Notes"}].map(({k,l}) => (
                          <div key={k}>
                            <label className="text-xs text-gray-400">{l}</label>
                            <input value={editRoute[k] || ""} onChange={e => setEditRoute(p => ({...p,[k]:e.target.value}))}
                              className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditRouteId(null)} className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
                        <button onClick={() => updateRoute(route.id)} className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                      </div>
                    </div>
                  ) : (
                    <div className={`px-4 py-3 border-b rounded-t-xl ${isLocked ? "bg-gray-50" : "bg-blue-50"}`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-blue-800 text-sm">🚛 {route.lorry_plate || "No Plate"}</span>
                            {route.driver_name && <span className="text-xs text-gray-600">👤 {route.driver_name}</span>}
                            {route.area && <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">📍 {route.area}</span>}
                            {isLocked && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">🔒 Locked</span>}
                          </div>
                          {route.notes && <p className="text-xs text-gray-500 mt-1">{route.notes}</p>}
                          <p className="text-xs text-gray-400 mt-0.5">{route.orders?.length || 0} orders</p>
                          {isLocked && <p className="text-xs text-orange-500 mt-0.5">Route is locked because it is already out for delivery.</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <select value={route.status} onChange={e => updateStatus(route.id, e.target.value)}
                            className={`text-xs rounded px-2 py-0.5 border-0 font-medium cursor-pointer ${statusColor(route.status)}`}>
                            {isLocked
                              ? ["Out for Delivery", "Delivered"].map(s => <option key={s}>{s}</option>)
                              : ["Pending", "Out for Delivery", "Delivered"].map(s => <option key={s}>{s}</option>)}
                          </select>
                          {!isLocked && <>
                            <button onClick={() => { setEditRouteId(route.id); setEditRoute({ ...route }); }} className="text-gray-400 hover:text-blue-600 text-xs">✏️</button>
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
                        {isLocked ? "No orders in this route." : "Drop orders here or use assign dropdown"}
                      </p>
                    )}
                    {route.orders?.map((ro, index) => (
                      <AssignedOrderCard
                        key={ro.id}
                        ro={ro}
                        routeId={route.id}
                        index={index}
                        isLocked={isLocked}
                        onUnassign={unassignOrder}
                        onDragStart={(fromIndex) => handleAssignedDragStart(route.id, fromIndex)}
                        onDragOver={handleAssignedDragOver}
                        onDrop={(toIndex) => handleAssignedDrop(route.id, toIndex)}
                        onSaved={loadRoutes}
                      />
                    ))}
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