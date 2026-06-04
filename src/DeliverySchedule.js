import { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";

const fmt = d => {
  if (!d) return "-";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-MY");
};
const statusColor = s => ({
  "Pending": "bg-yellow-100 text-yellow-800",
  "Out for Delivery": "bg-blue-100 text-blue-800",
  "Delivered": "bg-green-100 text-green-800",
}[s] || "bg-gray-100 text-gray-700");

const EMPTY_VEHICLE = { driver_name: "", vehicle_plate: "", vehicle_type: "", status: "Active" };
const EMPTY_ROUTE = { vehicle_id: "", lorry_plate: "", driver_name: "", area: "", notes: "" };

// ── Vehicle Modal — defined OUTSIDE main component ────────────────
function VehicleModal({ vehicles, onClose, onRefresh }) {
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ ...EMPTY_VEHICLE });
  const [editVehicleId, setEditVehicleId] = useState(null);
  const [editVehicle, setEditVehicle] = useState({});

  const createVehicle = async () => {
    if (!newVehicle.driver_name && !newVehicle.vehicle_plate) return alert("Please enter driver name or vehicle plate.");
    await fetch(`${API}/delivery/vehicles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newVehicle)
    });
    setNewVehicle({ ...EMPTY_VEHICLE });
    setShowAddVehicle(false);
    onRefresh();
  };

  const saveVehicle = async (id) => {
    await fetch(`${API}/delivery/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editVehicle)
    });
    setEditVehicleId(null);
    onRefresh();
  };

  const deleteVehicle = async (id) => {
    if (!window.confirm("Delete this vehicle?")) return;
    await fetch(`${API}/delivery/vehicles/${id}`, { method: "DELETE" });
    onRefresh();
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
                {[
                  { k: "driver_name", l: "Driver Name" },
                  { k: "vehicle_plate", l: "Vehicle Plate" },
                  { k: "vehicle_type", l: "Vehicle Type (e.g. Lorry, Van)", span: true }
                ].map(({ k, l, span }) => (
                  <div key={k} className={span ? "col-span-2" : ""}>
                    <label className="text-xs text-gray-500 block mb-0.5">{l}</label>
                    <input
                      value={newVehicle[k]}
                      onChange={e => setNewVehicle(p => ({ ...p, [k]: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Status</label>
                  <select
                    value={newVehicle.status}
                    onChange={e => setNewVehicle(p => ({ ...p, status: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
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
                      {[
                        { k: "driver_name", l: "Driver Name" },
                        { k: "vehicle_plate", l: "Vehicle Plate" },
                        { k: "vehicle_type", l: "Vehicle Type" }
                      ].map(({ k, l }) => (
                        <div key={k}>
                          <label className="text-xs text-gray-400 block mb-0.5">{l}</label>
                          <input
                            value={editVehicle[k] || ""}
                            onChange={e => setEditVehicle(p => ({ ...p, [k]: e.target.value }))}
                            className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                        </div>
                      ))}
                      <div>
                        <label className="text-xs text-gray-400 block mb-0.5">Status</label>
                        <select
                          value={editVehicle.status || "Active"}
                          onChange={e => setEditVehicle(p => ({ ...p, status: e.target.value }))}
                          className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300">
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

// ── Add Route Modal — defined OUTSIDE main component ──────────────
function AddRouteModal({ activeVehicles, onClose, onCreate, onGoToVehicles }) {
  const [newRoute, setNewRoute] = useState({ ...EMPTY_ROUTE });

  const onVehicleSelect = (vehicleId) => {
    const v = activeVehicles.find(v => String(v.id) === String(vehicleId));
    if (v) {
      setNewRoute(p => ({ ...p, vehicle_id: v.id, lorry_plate: v.vehicle_plate || "", driver_name: v.driver_name || "" }));
    } else {
      setNewRoute(p => ({ ...p, vehicle_id: "" }));
    }
  };

  const handleCreate = () => {
    if (!newRoute.lorry_plate && !newRoute.driver_name) return alert("Please select a vehicle or enter lorry plate / driver name.");
    onCreate(newRoute);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 className="font-bold text-gray-800 mb-4">Add New Route</h3>

        <div className="mb-3">
          <label className="text-xs text-gray-500 block mb-0.5">Select Vehicle (Active only)</label>
          <select
            value={newRoute.vehicle_id}
            onChange={e => onVehicleSelect(e.target.value)}
            className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">-- Select Vehicle --</option>
            {activeVehicles.map(v => (
              <option key={v.id} value={v.id}>
                {v.vehicle_plate ? `${v.vehicle_plate} — ` : ""}{v.driver_name || "Unknown driver"}{v.vehicle_type ? ` (${v.vehicle_type})` : ""}
              </option>
            ))}
          </select>
          {activeVehicles.length === 0 && (
            <p className="text-xs text-orange-500 mt-1">
              No active vehicles.{" "}
              <button onClick={onGoToVehicles} className="underline">Add vehicle first</button>
            </p>
          )}
        </div>

        <p className="text-xs text-gray-400 mb-2">Or enter manually:</p>
        <div className="space-y-2">
          {[
            { k: "lorry_plate", l: "Lorry Plate No" },
            { k: "driver_name", l: "Driver Name" },
            { k: "area", l: "Area / Zone" },
            { k: "notes", l: "Notes" }
          ].map(({ k, l }) => (
            <div key={k}>
              <label className="text-xs text-gray-500 block mb-0.5">{l}</label>
              <input
                value={newRoute[k]}
                onChange={e => setNewRoute(p => ({ ...p, [k]: e.target.value }))}
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
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
  const [dragOrder, setDragOrder] = useState(null);

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
    await fetch(`${API}/delivery/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newRoute, delivery_date: date })
    });
    setShowAddRoute(false);
    loadRoutes();
  };

  const updateRoute = async (id) => {
    await fetch(`${API}/delivery/routes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editRoute)
    });
    setEditRouteId(null);
    loadRoutes();
  };

  const deleteRoute = async (id) => {
    if (!window.confirm("Delete this route? Assigned orders will be unassigned.")) return;
    await fetch(`${API}/delivery/routes/${id}`, { method: "DELETE" });
    loadRoutes();
  };

  const assignOrder = async (routeId, orderId) => {
    const route = routes.find(r => r.id === routeId);
    const seqNo = (route?.orders?.length || 0) + 1;
    await fetch(`${API}/delivery/routes/${routeId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId, sequence_no: seqNo })
    });
    loadRoutes();
  };

  const unassignOrder = async (routeId, orderId) => {
    await fetch(`${API}/delivery/routes/${routeId}/orders/${orderId}`, { method: "DELETE" });
    loadRoutes();
  };

  const updateStatus = async (routeId, status) => {
    await fetch(`${API}/delivery/routes/${routeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    // Reload everything so order statuses reflect the change
    await loadRoutes();
  };

  const updateSeq = async (routeId, orderId, seq) => {
    await fetch(`${API}/delivery/routes/${routeId}/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence_no: parseInt(seq) })
    });
    loadRoutes();
  };

  const parseItems = items => {
    try { return typeof items === "string" ? JSON.parse(items || "[]") : (items || []); }
    catch { return []; }
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

      {showVehicleModal && (
        <VehicleModal
          vehicles={vehicles}
          onClose={() => setShowVehicleModal(false)}
          onRefresh={loadVehicles}
        />
      )}

      {showAddRoute && (
        <AddRouteModal
          activeVehicles={activeVehicles}
          onClose={() => setShowAddRoute(false)}
          onCreate={createRoute}
          onGoToVehicles={() => { setShowAddRoute(false); setShowVehicleModal(true); }}
        />
      )}

      <div className="flex flex-col xl:flex-row gap-4">

        {/* Unassigned Orders */}
        <div className="xl:w-72 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b bg-orange-50 rounded-t-xl">
              <h3 className="text-sm font-bold text-orange-700">
                📦 Unassigned
                <span className="ml-1 bg-orange-200 text-orange-800 text-xs px-2 py-0.5 rounded-full">{unassigned.length}</span>
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
                          {routes.map(r => <option key={r.id} value={r.id}>{r.lorry_plate || r.driver_name} {r.area ? `(${r.area})` : ""}</option>)}
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
            {routes.map(route => (
              <div key={route.id} className="bg-white rounded-xl border border-gray-200 shadow-sm"
                onDragOver={e => e.preventDefault()}
                onDrop={() => { if (dragOrder) { assignOrder(route.id, dragOrder.id); setDragOrder(null); } }}>

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
                  <div className="px-4 py-3 border-b bg-blue-50 rounded-t-xl">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-blue-800 text-sm">🚛 {route.lorry_plate || "No Plate"}</span>
                          {route.driver_name && <span className="text-xs text-gray-600">👤 {route.driver_name}</span>}
                          {route.area && <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">📍 {route.area}</span>}
                        </div>
                        {route.notes && <p className="text-xs text-gray-500 mt-1">{route.notes}</p>}
                        <p className="text-xs text-gray-400 mt-0.5">{route.orders?.length || 0} orders</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <select value={route.status} onChange={e => updateStatus(route.id, e.target.value)}
                          className={`text-xs rounded px-2 py-0.5 border-0 font-medium cursor-pointer ${statusColor(route.status)}`}>
                          {["Pending","Out for Delivery","Delivered"].map(s => <option key={s}>{s}</option>)}
                        </select>
                        <button onClick={() => { setEditRouteId(route.id); setEditRoute({ ...route }); }} className="text-gray-400 hover:text-blue-600 text-xs">✏️</button>
                        <button onClick={() => deleteRoute(route.id)} className="text-gray-400 hover:text-red-500 text-xs">🗑️</button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-3 space-y-2 min-h-16">
                  {(!route.orders || route.orders.length === 0) && (
                    <p className="text-xs text-gray-300 text-center py-3">Drop orders here or use assign dropdown</p>
                  )}
                  {route.orders?.map((ro) => {
                    const o = ro.orders;
                    if (!o) return null;
                    const items = parseItems(o.items);
                    return (
                      <div key={ro.id} className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                        <div className="flex items-start gap-2">
                          <input type="number" value={ro.sequence_no} min={1}
                            onChange={e => updateSeq(route.id, o.id, e.target.value)}
                            className="w-8 text-center border rounded text-xs py-0.5 font-bold text-blue-700 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-blue-700 text-xs">{o.so_number}</span>
                              <div className="flex items-center gap-1">
                                {parseFloat(o.balance) > 0 && <span className="text-red-500 text-xs">RM {o.balance}</span>}
                                <button onClick={() => unassignOrder(route.id, o.id)} className="text-gray-300 hover:text-red-500 text-xs ml-1">x</button>
                              </div>
                            </div>
                            <p className="text-xs font-medium text-gray-700 truncate">{o.customer_name}</p>
                            <p className="text-xs text-gray-400 truncate">{o.address}</p>
                            {o.time_slot && <p className="text-xs text-indigo-600">{o.time_slot}</p>}
                            <p className="text-xs text-gray-400 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}