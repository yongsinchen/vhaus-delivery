import { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";


const statusColor = s => ({
  "Pending": "bg-yellow-100 text-yellow-800",
  "Out for Delivery": "bg-blue-100 text-blue-800",
  "Delivered": "bg-green-100 text-green-800",
}[s] || "bg-gray-100 text-gray-700");

export default function DeliverySchedule() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [routes, setRoutes] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ lorry_plate: "", driver_name: "", area: "", notes: "" });
  const [editRouteId, setEditRouteId] = useState(null);
  const [editRoute, setEditRoute] = useState({});
  const [dragOrder, setDragOrder] = useState(null);

  const load = useCallback(async () => {
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

  useEffect(() => { load(); }, [load]);

  const createRoute = async () => {
    if (!newRoute.lorry_plate && !newRoute.driver_name) return alert("Please enter lorry plate or driver name.");
    await fetch(`${API}/delivery/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newRoute, delivery_date: date })
    });
    setNewRoute({ lorry_plate: "", driver_name: "", area: "", notes: "" });
    setShowAddRoute(false);
    load();
  };

  const updateRoute = async (id) => {
    await fetch(`${API}/delivery/routes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editRoute)
    });
    setEditRouteId(null);
    load();
  };

  const deleteRoute = async (id) => {
    if (!window.confirm("Delete this route? Assigned orders will be unassigned.")) return;
    await fetch(`${API}/delivery/routes/${id}`, { method: "DELETE" });
    load();
  };

  const assignOrder = async (routeId, orderId) => {
    const route = routes.find(r => r.id === routeId);
    const seqNo = (route?.orders?.length || 0) + 1;
    await fetch(`${API}/delivery/routes/${routeId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId, sequence_no: seqNo })
    });
    load();
  };

  const unassignOrder = async (routeId, orderId) => {
    await fetch(`${API}/delivery/routes/${routeId}/orders/${orderId}`, { method: "DELETE" });
    load();
  };

  const updateStatus = async (routeId, status) => {
    await fetch(`${API}/delivery/routes/${routeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    load();
  };

  const updateSeq = async (routeId, orderId, seq) => {
    await fetch(`${API}/delivery/routes/${routeId}/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence_no: parseInt(seq) })
    });
    load();
  };

  const parseItems = items => {
    try { return typeof items === "string" ? JSON.parse(items || "[]") : (items || []); }
    catch { return []; }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-base font-bold text-gray-700">🚚 Delivery Schedule</h2>
        <div className="flex items-center gap-3">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-medium text-blue-700" />
          <button onClick={load} className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-50">🔄 Refresh</button>
          <button onClick={() => setShowAddRoute(true)} className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-blue-700">+ Add Route</button>
        </div>
      </div>

      {loading && <div className="text-center py-8 text-gray-400">Loading...</div>}

      {/* Add Route Modal */}
      {showAddRoute && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold text-gray-800 mb-4">Add New Route</h3>
            <div className="space-y-3">
              {[{k:"lorry_plate",l:"Lorry Plate No"},{k:"driver_name",l:"Driver Name"},{k:"area",l:"Area / Zone"},{k:"notes",l:"Notes"}].map(({k,l}) => (
                <div key={k}>
                  <label className="text-xs text-gray-500 block mb-0.5">{l}</label>
                  <input value={newRoute[k]} onChange={e => setNewRoute(p => ({...p,[k]:e.target.value}))}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end mt-4">
              <button onClick={() => setShowAddRoute(false)} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={createRoute} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create Route</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-4">

        {/* Unassigned Orders */}
        <div className="xl:w-72 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b bg-orange-50 rounded-t-xl">
              <h3 className="text-sm font-bold text-orange-700">📦 Unassigned Orders <span className="ml-1 bg-orange-200 text-orange-800 text-xs px-2 py-0.5 rounded-full">{unassigned.length}</span></h3>
            </div>
            <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
              {unassigned.length === 0
                ? <p className="text-xs text-gray-400 text-center py-4">All orders assigned!</p>
                : unassigned.map(o => {
                  const items = parseItems(o.items);
                  return (
                    <div key={o.id} className="bg-orange-50 border border-orange-200 rounded-lg p-2"
                      draggable onDragStart={() => setDragOrder(o)}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-blue-700 text-xs">{o.so_number}</span>
                        {parseFloat(o.balance) > 0 && <span className="text-red-500 text-xs font-medium">RM {o.balance}</span>}
                      </div>
                      <p className="text-xs font-medium text-gray-700">{o.customer_name}</p>
                      <p className="text-xs text-gray-400 leading-tight truncate">{o.address}</p>
                      {o.time_slot && <p className="text-xs text-indigo-600 font-medium">{o.time_slot}</p>}
                      <p className="text-xs text-gray-400 mt-1">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
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
                  <div className="px-4 py-3 border-b bg-blue-50 rounded-t-xl">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-blue-800 text-sm">🚛 {route.lorry_plate || "No Plate"}</span>
                          {route.driver_name && <span className="text-xs text-gray-600">👤 {route.driver_name}</span>}
                          {route.area && <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">📍 {route.area}</span>}
                        </div>
                        {route.notes && <p className="text-xs text-gray-500 mt-1">{route.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <select value={route.status} onChange={e => updateStatus(route.id, e.target.value)}
                          className={`text-xs rounded px-2 py-0.5 border-0 font-medium cursor-pointer ${statusColor(route.status)}`}>
                          {["Pending","Out for Delivery","Delivered"].map(s => <option key={s}>{s}</option>)}
                        </select>
                        <button onClick={() => { setEditRouteId(route.id); setEditRoute(route); }} className="text-gray-400 hover:text-blue-600 text-xs">✏️</button>
                        <button onClick={() => deleteRoute(route.id)} className="text-gray-400 hover:text-red-500 text-xs">🗑️</button>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{route.orders?.length || 0} orders assigned</div>
                  </div>
                )}

                {/* Assigned Orders */}
                <div className="p-3 space-y-2 min-h-16">
                  {(!route.orders || route.orders.length === 0) && (
                    <p className="text-xs text-gray-300 text-center py-3">Drop orders here or use assign dropdown</p>
                  )}
                  {route.orders?.map((ro, idx) => {
                    const o = ro.orders;
                    if (!o) return null;
                    const items = parseItems(o.items);
                    return (
                      <div key={ro.id} className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                        <div className="flex items-center gap-2">
                          <input type="number" value={ro.sequence_no} min={1}
                            onChange={e => updateSeq(route.id, o.id, e.target.value)}
                            className="w-8 text-center border rounded text-xs py-0.5 font-bold text-blue-700" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-blue-700 text-xs">{o.so_number}</span>
                              <div className="flex items-center gap-1">
                                {parseFloat(o.balance) > 0 && <span className="text-red-500 text-xs">RM {o.balance}</span>}
                                <button onClick={() => unassignOrder(route.id, o.id)} className="text-gray-300 hover:text-red-500 text-xs ml-1">✕</button>
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
