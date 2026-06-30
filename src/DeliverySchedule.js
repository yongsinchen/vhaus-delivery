import { useState, useEffect, useCallback } from "react";
import { supabase } from "./AuthContext";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };

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

/** Derive a team-level status from its schedules */
const deriveTeamStatus = (schedules) => {
  if (!schedules || schedules.length === 0) return "Pending";
  const statuses = schedules.map(s => s.status);
  if (statuses.every(s => s === "Delivered")) return "Delivered";
  if (statuses.some(s => s === "Out for Delivery")) return "Out for Delivery";
  if (statuses.every(s => s === "Confirmed" || s === "Delivered")) return "Confirmed";
  return "Pending";
};

// -- Trip Card (for multi-trip orders in unassigned) -------------------
function TripCard({ trip, teams, isLocked, onAssign, onDragStart }) {
  const order = trip.orders || {};
  const items = parseItems(order.items);
  const [showItems, setShowItems] = useState(false);

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 cursor-grab"
      draggable={!isLocked} onDragStart={() => !isLocked && onDragStart()}>
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
      {trip.trip_no === 1 && <p className="text-xs text-green-600 font-medium mt-0.5">Commission trip</p>}
      {trip.trip_no > 1 && <p className="text-xs text-gray-400 mt-0.5">No commission (trip {trip.trip_no})</p>}
      <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
      <button onClick={() => setShowItems(p => !p)} className="text-xs text-gray-400 hover:text-purple-600 mt-1">
        {showItems ? "Hide Items" : "View Items"}
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
      {teams && teams.length > 0 && !isLocked && (
        <select
          onChange={e => { if (e.target.value) onAssign(e.target.value, trip.id, "trip"); }}
          className="mt-2 w-full text-xs border rounded px-1 py-1 text-gray-600">
          <option value="">Assign to team...</option>
          {teams.filter(t => deriveTeamStatus(t.schedules) === "Pending").map(t => (
            <option key={t.id} value={t.id}>{t.vehicle_plate || t.driver_name} {t.area ? `(${t.area})` : ""}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// -- Assigned Order Card -----------------------------------------------
function AssignedOrderCard({ schedule, teamId, index, isLocked, onUnassign, onDragStart, onDragOver, onDrop, onSaved, isTrip }) {
  const o = schedule.orders || {};
  const [notes, setNotes] = useState(schedule.notes || "");
  const [slotVal, setSlotVal] = useState(schedule.slot || "");
  const [showItems, setShowItems] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!o || !o.so_number) return null;

  const items = parseItems(o.items);
  const preferredTime = o.time_slot || "";
  const tripInfo = isTrip ? schedule : null;
  const isLegacy = String(schedule.id).startsWith("legacy-");

  const saveNotes = async (val) => {
    setNotes(val);
    if (isLegacy) return;
    await af(`${API}/delivery-schedules/${schedule.id}`, {
      method: "PATCH", body: JSON.stringify({ notes: val })
    });
  };

  const saveSlot = async (val) => {
    if (isLegacy) return;
    setSaving(true);
    await af(`${API}/delivery-schedules/${schedule.id}`, {
      method: "PATCH", body: JSON.stringify({ slot: val })
    });
    setSaving(false);
    if (onSaved) onSaved(); // trigger re-sort
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
        {!isLocked && <span className="text-gray-300 text-xs select-none cursor-grab">&#8942;&#8942;</span>}
        <span className="text-xs text-gray-400 font-medium flex-shrink-0">#{index + 1}</span>
        <span className={`font-bold text-xs flex-shrink-0 ${isTrip ? "text-purple-700" : "text-blue-700"}`}>{o.so_number}</span>
        {isTrip && tripInfo && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${tripStatusColor(tripInfo.trip_status)}`}>
            Trip {tripInfo.trip_no}/{tripInfo.total_trips}
          </span>
        )}
        <span className="text-xs font-medium text-gray-700 truncate flex-1">{o.customer_name}</span>
        {parseFloat(o.balance) > 0 && <span className="text-red-500 text-xs font-medium flex-shrink-0">RM {o.balance}</span>}
        {!isLocked && (
          <button onClick={() => onUnassign(schedule.id)} className="text-gray-300 hover:text-red-500 text-xs flex-shrink-0" title="Unassign">x</button>
        )}
      </div>

      {/* Commission badge */}
      {isTrip && tripInfo && (
        <p className={`text-xs font-medium mb-1 ${tripInfo.trip_no === 1 ? "text-green-600" : "text-gray-400"}`}>
          {tripInfo.trip_no === 1 ? "Commission trip" : `No commission (trip ${tripInfo.trip_no})`}
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
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 flex-shrink-0">Slot:</span>
            <input value={slotVal} onChange={e => setSlotVal(e.target.value)} onBlur={() => saveSlot(slotVal)} placeholder="e.g. 10am-12pm"
              onKeyDown={e => e.key === "Enter" && saveSlot(slotVal)}
              className={`text-xs border rounded px-1.5 py-0.5 w-28 ${saving ? "opacity-50" : ""}`} />
            {preferredTime && !slotVal && <button onClick={() => { setSlotVal(preferredTime); saveSlot(preferredTime); }} className="text-xs text-purple-600 hover:underline">Use preferred</button>}
          </div>
        )}
        {isLocked && schedule.slot && <span className="text-xs text-blue-700 font-medium bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 inline-block">Slot: {schedule.slot}</span>}
        {schedule.is_ready && <span className="text-xs text-green-700 font-medium bg-green-50 border border-green-200 rounded px-1.5 py-0.5 inline-block ml-1">Ready</span>}
        {o.remark && <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded p-2 text-xs"><span className="font-semibold">Remark: </span>{o.remark}</div>}
      </div>

      <div className="space-y-1">
        <button onClick={() => setShowItems(p => !p)} className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1">
          <span>{showItems ? "Hide Items" : "View Items"}</span>
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
          <input value={notes} onChange={e => setNotes(e.target.value)}
            onBlur={e => saveNotes(e.target.value)}
            placeholder="Note (optional)"
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 text-gray-500"
          />
        )}
        {isLocked && notes && <p className="text-xs text-gray-400 italic">{notes}</p>}
      </div>
    </div>
  );
}

// -- Print CSS ---------------------------------------------------------
const PRINT_STYLE = `@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; } .print-area { position: absolute; left: 0; top: 0; width: 100%; } @page { size: A4 landscape; margin: 8mm; } .order-block { page-break-inside: avoid; } .no-print { display: none !important; } }`;

// -- Team Print View ---------------------------------------------------
function TeamPrintView({ team, onClose }) {
  const parseItemsSafe = items => { try { return typeof items === "string" ? JSON.parse(items || "[]") : (items || []); } catch { return []; } };
  const handlePrint = () => {
    const printArea = document.querySelector(".print-area");
    if (!printArea) return;
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups to print"); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Delivery Schedule</title>
    <style>@page{size:A4 landscape;margin:8mm}body{font-family:Arial,sans-serif;margin:0;padding:8px}
    .order-block{page-break-inside:avoid}table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:10px}</style>
    </head><body>${printArea.innerHTML}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => { w.print(); w.onafterprint = () => w.close(); }, 500);
    onClose();
  };
  const dateStr = team.team_date || "-";
  const vehicleStr = [team.vehicle_plate, team.driver_name, team.area].filter(Boolean).join(" / ");
  const allRows = [];
  (team.schedules || []).forEach(sc => {
    const o = sc.orders;
    if (!o) return;
    const items = parseItemsSafe(o.items);
    const displayItems = items.length > 0 ? items : [{}];
    displayItems.forEach((item, idx) => { allRows.push({ o, sc, item, idx, rowspan: displayItems.length, isFirst: idx === 0 }); });
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-start justify-center pt-6 px-4 pb-6 overflow-y-auto">
      <style>{PRINT_STYLE}</style>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl">
        <div className="flex items-center justify-between px-6 py-3 border-b no-print">
          <h3 className="font-bold text-gray-800">Print Preview — {team.vehicle_plate || "Team"}</h3>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
            <button onClick={handlePrint} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Print</button>
          </div>
        </div>
        <div className="print-area p-4">
          <div className="text-center mb-3">
            <h1 style={{ fontSize:"14px", fontWeight:"bold", margin:0 }}>V Haus Living (Pg) Delivery Schedule</h1>
            <p style={{ fontSize:"11px", margin:"2px 0 0 0", color:"#444" }}>Date: {dateStr} &nbsp;|&nbsp; Vehicle: {vehicleStr || "-"}</p>
          </div>
          {(() => {
            const COL = <colgroup><col style={{width:"13%"}}/><col style={{width:"5%"}}/><col style={{width:"3.5%"}}/><col style={{width:"3%"}}/><col style={{width:"3%"}}/><col style={{width:"5.5%"}}/><col style={{width:"2.5%"}}/><col style={{width:"7%"}}/><col style={{width:"17%"}}/><col style={{width:"3%"}}/><col style={{width:"5.5%"}}/><col style={{width:"5.5%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/><col style={{width:"6%"}}/><col style={{width:"6%"}}/></colgroup>;
            const TS = { width:"100%", borderCollapse:"collapse", fontSize:"10px", tableLayout:"fixed" };
            const BD = { border:"1px solid #000", padding:"3px 4px" };
            // Group allRows by schedule (order)
            const groups = [];
            let cur = null;
            allRows.forEach(row => {
              if (row.isFirst) { cur = { sc: row.sc, o: row.o, rows: [] }; groups.push(cur); }
              if (cur) cur.rows.push(row);
            });
            return (<>
              {/* Header table */}
              <table style={TS}>{COL}<thead><tr style={{backgroundColor:"#c6efce",textAlign:"center"}}>
                {["SO / Customer","Salesman","Trip","Check","Naik","Plate NO","No.","Code","Item","Unit","Supplier","Order Date","Sent","JB Sent","Arrival PG","Remark"].map(h=>(
                  <th key={h} style={{...BD,whiteSpace:"nowrap",fontWeight:"bold"}}>{h}</th>
                ))}
              </tr></thead></table>
              {/* One table per order group — allows page break between orders */}
              {groups.length === 0 && <table style={TS}>{COL}<tbody><tr><td colSpan={15} style={{...BD,textAlign:"center",color:"#888"}}>No orders assigned.</td></tr></tbody></table>}
              {groups.map((g, gi) => {
                const { o, sc, rows } = g;
                const hasBalance = parseFloat(o.balance) > 0;
                const tripLabel = sc.trip_no ? `Trip ${sc.trip_no}/${sc.total_trips}` : "-";
                return (
                  <table key={gi} className="order-block" style={TS}>{COL}<tbody>
                    {rows.map(({ item, idx, rowspan, isFirst }) => (
                      <tr key={idx} style={{verticalAlign:"top"}}>
                        {isFirst && <td rowSpan={rowspan} style={{...BD,verticalAlign:"top",overflow:"hidden"}}>
                          <div style={{fontWeight:"bold"}}>{o.so_number}</div><div>{o.customer_name}</div>
                          {o.contact&&<div style={{color:"#555"}}>{o.contact}</div>}
                          {o.address&&<div style={{color:"#555",fontSize:"9px",wordBreak:"break-word"}}>{o.address}</div>}
                          {hasBalance&&<div style={{color:"red",fontWeight:"bold"}}>Bal: RM {o.balance}</div>}
                          {sc.slot&&<div style={{color:"#1e40af",fontWeight:"bold"}}>Slot: {sc.slot}</div>}
                        </td>}
                        {isFirst&&<td rowSpan={rowspan} style={{...BD,verticalAlign:"top",fontSize:"9px"}}>{o.salesman||"-"}</td>}
                        {isFirst&&<td rowSpan={rowspan} style={{...BD,textAlign:"center",verticalAlign:"top",fontSize:"9px",color:sc.trip_no>1?"#6b7280":"#059669"}}>{tripLabel}</td>}
                        <td style={{...BD,textAlign:"center"}}></td>
                        <td style={{...BD,textAlign:"center"}}></td>
                        {isFirst&&<td rowSpan={rowspan} style={{...BD,textAlign:"center",verticalAlign:"top"}}>{team.vehicle_plate||"-"}</td>}
                        <td style={{...BD,textAlign:"center"}}>{idx+1}</td>
                        <td style={{...BD,overflow:"hidden"}}>{item.itemCode||""}</td>
                        <td style={{...BD,overflow:"hidden",wordBreak:"break-word"}}>{item.itemName||""}</td>
                        <td style={{...BD,textAlign:"center"}}>{item.unit||""}</td>
                        <td style={{...BD}}>{item.supplier||""}</td>
                        <td style={{...BD,textAlign:"center"}}>{item.itemOrderDate||""}</td>
                        <td style={{...BD,textAlign:"center"}}>{item.supplierSentDate||""}</td>
                        <td style={{...BD,textAlign:"center"}}></td>
                        <td style={{...BD,textAlign:"center"}}>{item.arrivalDate?item.arrivalDate:<span style={{color:"red",fontWeight:"bold"}}>No arrival</span>}</td>
                        {isFirst&&<td rowSpan={rowspan} style={{...BD,verticalAlign:"top",overflow:"hidden",wordBreak:"break-word"}}>{o.remark&&<div>{o.remark}</div>}{sc.notes&&<div style={{color:"#555",fontStyle:"italic"}}>{sc.notes}</div>}</td>}
                      </tr>
                    ))}
                  </tbody></table>
                );
              })}
            </>);
          })()}
          <div style={{ marginTop:"8px", fontSize:"9px", color:"#888", textAlign:"right" }}>Printed: {new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</div>
        </div>
      </div>
    </div>
  );
}

// -- Vehicle Modal (unchanged) -----------------------------------------
function VehicleModal({ vehicles, onClose, onRefresh }) {
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ ...EMPTY_VEHICLE });
  const [editVehicleId, setEditVehicleId] = useState(null);
  const [editVehicle, setEditVehicle] = useState({});
  const createVehicle = async () => {
    if (!newVehicle.driver_name && !newVehicle.vehicle_plate) return alert("Please enter driver name or vehicle plate.");
    await af(`${API}/delivery/vehicles`, { method: "POST", body: JSON.stringify(newVehicle) });
    setNewVehicle({ ...EMPTY_VEHICLE }); setShowAddVehicle(false); onRefresh();
  };
  const saveVehicle = async (id) => {
    await af(`${API}/delivery/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(editVehicle) });
    setEditVehicleId(null); onRefresh();
  };
  const deleteVehicle = async (id) => {
    if (!window.confirm("Delete this vehicle?")) return;
    await af(`${API}/delivery/vehicles/${id}`, { method: "DELETE" }); onRefresh();
  };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-10 px-4 pb-10 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-bold text-gray-800 text-base">Manage Vehicles</h3>
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
                      <span className="font-semibold text-sm text-gray-800">{v.vehicle_plate || "No Plate"}</span>
                      {v.driver_name && <span className="text-xs text-gray-500">{v.driver_name}</span>}
                      {v.vehicle_type && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{v.vehicle_type}</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v.status === "Active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{v.status}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditVehicleId(v.id); setEditVehicle({...v}); }} className="text-gray-400 hover:text-blue-600 text-xs">Edit</button>
                      <button onClick={() => deleteVehicle(v.id)} className="text-gray-400 hover:text-red-500 text-xs">Delete</button>
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

// -- Add Team Modal (replaces AddRouteModal) ---------------------------
function AddTeamModal({ activeVehicles, onClose, onCreate, onGoToVehicles }) {
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [drivers, setDrivers] = useState([]);

  useEffect(() => {
    af(`${API}/drivers`).then(res => res.json()).then(d => setDrivers(Array.isArray(d.drivers) ? d.drivers : []));
  }, []);

  const handleCreate = async () => {
    if (!vehicleId) return alert("Please select a vehicle.");
    if (!driverId) return alert("Please select a driver.");
    const res = await onCreate({ vehicle_id: parseInt(vehicleId), driver_id: driverId, helper_id: null });
    if (res && res.error) alert(res.error);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 className="font-bold text-gray-800 mb-4">Add New Team</h3>
        <div className="mb-3">
          <label className="text-xs text-gray-500 block mb-0.5">Select Vehicle (Active only)</label>
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">-- Select Vehicle --</option>
            {activeVehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_plate ? `${v.vehicle_plate} — ` : ""}{v.driver_name || "Unknown driver"}{v.vehicle_type ? ` (${v.vehicle_type})` : ""}</option>)}
          </select>
          {activeVehicles.length === 0 && <p className="text-xs text-orange-500 mt-1">No active vehicles. <button onClick={onGoToVehicles} className="underline">Add vehicle first</button></p>}
        </div>
        <div className="mb-3">
          <label className="text-xs text-gray-500 block mb-0.5">Select Driver</label>
          <select value={driverId} onChange={e => setDriverId(e.target.value)} className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">-- Select Driver --</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {drivers.length === 0 && <p className="text-xs text-orange-500 mt-1">No active driver accounts found. Create a user with the "driver" role first.</p>}
        </div>
        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleCreate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create Team</button>
        </div>
      </div>
    </div>
  );
}

// -- Auto Scheduler Modal (kept as-is, uses old endpoints - TODO: migrate) --
function AutoSchedulerModal({ date, companyId, onClose, onApproved }) {
  const API_URL = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
  const [step, setStep] = useState("loading");
  const [orders, setOrders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [settings, setSettings] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => { loadOrders(); }, []); // eslint-disable-line

  const loadOrders = async () => {
    setStep("loading");
    try {
      // TODO: migrate auto-schedule endpoints to use delivery_teams/delivery_schedules
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
    setGenerating(true); setError("");
    try {
      // TODO: migrate to new delivery tables
      const res = await fetch(`${API_URL}/auto-schedule/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, company_id: companyId, orders, vehicles, settings }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || "Failed to generate schedule"); setGenerating(false); return; }
      setSchedule(data.schedule); setStep("preview");
    } catch (e) { setError(e.message); }
    setGenerating(false);
  };

  const approveSchedule = async () => {
    setStep("approving");
    try {
      const durations = orders.map(o => ({
        itemType: o.itemType, itemKeywords: o.itemKeywords,
        area: schedule?.vehicles?.flatMap(v => v.stops).find(s => s.so_number === o.so_number)?.area || "",
        duration_minutes: o.estimatedDuration,
      }));
      // TODO: migrate to new delivery tables
      const res = await fetch(`${API_URL}/auto-schedule/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, company_id: companyId, schedule, durations }),
      });
      const data = await res.json();
      if (data.success) { onApproved(); onClose(); }
      else { setError(data.error || "Failed to approve"); setStep("preview"); }
    } catch (e) { setError(e.message); setStep("preview"); }
  };

  const typeBadge = (type) => type === "Wardrobe" ? "bg-orange-100 text-orange-700" : type === "Service" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700";
  const timeColor = (type) => type === "Wardrobe" ? "text-orange-600" : type === "Service" ? "text-purple-600" : "text-blue-600";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-start justify-center z-50 pt-6 px-4 pb-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-600 to-blue-500 rounded-t-2xl">
          <div>
            <h2 className="text-white font-bold text-base">Auto-Schedule</h2>
            <p className="text-blue-100 text-xs mt-0.5">{date} · {vehicles.length} vehicle(s) available</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-blue-200 text-2xl font-bold leading-none">&times;</button>
        </div>
        <div className="px-6 py-5">
          {step === "loading" && <div className="text-center py-12 text-gray-400">Loading orders...</div>}
          {step === "error" && <div className="text-center py-8"><p className="text-red-600 mb-4">{error}</p><button onClick={loadOrders} className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg">Retry</button></div>}
          {step === "empty" && <div className="text-center py-12 text-gray-400"><p>No unassigned orders for {date}.</p></div>}
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
                        {o.time_slot && <span className="text-xs text-indigo-600 font-medium">{o.time_slot}</span>}
                      </div>
                      <p className="text-xs text-gray-400 mb-1 truncate">{o.address}</p>
                      <p className="text-xs text-gray-400 mb-2 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ") || "-"}</p>
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Duration (min):</label>
                        <input type="number" value={o.estimatedDuration} onChange={e => updateDuration(o.so_number, e.target.value)}
                          min="15" max="480" step="15" className="w-24 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        <span className={`text-xs font-medium ${timeColor(o.itemType)}`}>
                          {Math.floor(o.estimatedDuration / 60)}h {o.estimatedDuration % 60 > 0 ? `${o.estimatedDuration % 60}m` : ""}
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
                  {generating ? "Generating..." : "Generate Schedule"}
                </button>
              </div>
            </div>
          )}
          {step === "preview" && schedule && (
            <div>
              <p className="text-sm text-gray-500 mb-1">{schedule.summary}</p>
              {schedule.overflow?.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                  <p className="text-xs font-bold text-orange-700 mb-1">{schedule.overflow.length} order(s) cannot fit today:</p>
                  {schedule.overflow.map(o => <p key={o.so_number} className="text-xs text-orange-600">SO {o.so_number} — {o.reason}</p>)}
                </div>
              )}
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {schedule.vehicles?.map((v, vi) => (
                  <div key={vi} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-blue-50 px-4 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-blue-800">{v.vehicle_plate || "Vehicle " + (vi+1)}</span>
                        {v.driver_name && <span className="text-xs text-gray-500">{v.driver_name}</span>}
                      </div>
                      <div className="text-xs text-gray-500">{v.stops?.length} stops · Return: {v.return_time}</div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {v.stops?.map((stop, si) => (
                        <div key={si} className="px-4 py-2.5 flex items-start gap-3">
                          <div className="text-xs text-blue-600 font-bold w-24 flex-shrink-0 pt-0.5">{stop.start_time} - {stop.end_time}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-gray-800">{stop.so_number}</span>
                              <span className="text-xs text-gray-600">{stop.customer_name}</span>
                              {stop.area && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{stop.area}</span>}
                            </div>
                            <p className="text-xs text-gray-400 truncate mt-0.5">{stop.address}</p>
                            {stop.notes && <p className="text-xs text-orange-600 mt-0.5">{stop.notes}</p>}
                          </div>
                          <div className="text-xs text-gray-400 flex-shrink-0">{stop.duration_minutes}min</div>
                        </div>
                      ))}
                    </div>
                    {v.warnings?.length > 0 && (
                      <div className="px-4 py-2 bg-yellow-50 border-t border-yellow-100">
                        {v.warnings.map((w, wi) => <p key={wi} className="text-xs text-yellow-700">{w}</p>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
              <div className="flex gap-3 justify-between mt-4">
                <button onClick={() => setStep("duration")} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Adjust Durations</button>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                  <button onClick={approveSchedule} className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">Approve & Create Routes</button>
                </div>
              </div>
            </div>
          )}
          {step === "approving" && (
            <div className="text-center py-12">
              <p className="text-gray-600 font-medium">Creating routes...</p>
              <p className="text-xs text-gray-400 mt-1">Setting up delivery schedule and confirming routes.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -- Main Component ----------------------------------------------------
export default function DeliverySchedule({ readOnly = false, companyId = null, currentUser = null }) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [teams, setTeams] = useState([]);         // delivery_teams with schedules grouped in
  const [unassigned, setUnassigned] = useState([]);
  const [trips, setTrips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [dragOrder, setDragOrder] = useState(null);
  const [draggingAssigned, setDraggingAssigned] = useState(null);
  const [printTeam, setPrintTeam] = useState(null);
  const [showAutoScheduler, setShowAutoScheduler] = useState(false);

  const [serviceOrders, setServiceOrders] = useState([]);
  const [unscheduledServices, setUnscheduledServices] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [showReadiness, setShowReadiness] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);

  /** Load teams + schedules, group schedules into teams */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = companyId ? `&company_id=${companyId}` : "";
      const [teamsRes, schedulesRes, unassignedRes, tripsRes] = await Promise.all([
        af(`${API}/delivery-teams?date=${date}${qs}`),
        af(`${API}/delivery-schedules?date=${date}${qs}`),
        af(`${API}/delivery/unassigned?date=${date}${qs}`),
        af(`${API}/order-trips?date=${date}`),
      ]);
      const [teamsData, schedulesData, unassignedData, tripsData] = await Promise.all([
        teamsRes.json(), schedulesRes.json(), unassignedRes.json(), tripsRes.json(),
      ]);

      const teamsList = teamsData.teams || (Array.isArray(teamsData) ? teamsData : []);
      const schedulesList = schedulesData.schedules || (Array.isArray(schedulesData) ? schedulesData : []);

      const enriched = teamsList.map(team => {
        const teamSchedules = schedulesList
          .filter(s => s.team_id === team.id)
          .sort((a, b) => {
            // Sort by time slot first (e.g. "9am" < "10am" < "2pm"), then sort_order
            const slotA = (a.slot || a.orders?.time_slot || "zzz").toLowerCase().replace(/[^0-9.:apm]/g, "");
            const slotB = (b.slot || b.orders?.time_slot || "zzz").toLowerCase().replace(/[^0-9.:apm]/g, "");
            if (slotA !== slotB) return slotA.localeCompare(slotB);
            return (a.sort_order || 0) - (b.sort_order || 0);
          });
        const v = vehicles.find(v => v.id === team.vehicle_id);
        return {
          ...team,
          vehicle_plate: v?.vehicle_plate || team.vehicle_plate || "",
          driver_name: v?.driver_name || team.driver_name || "",
          vehicle_type: v?.vehicle_type || "",
          schedules: teamSchedules,
          area: teamSchedules[0]?.area || "",
        };
      });

      setTeams(enriched);
      setUnassigned(Array.isArray(unassignedData) ? unassignedData : []);
      setTrips(Array.isArray(tripsData) ? tripsData : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [date, companyId, vehicles]);

  const loadVehicles = useCallback(async () => {
    try { const res = await af(`${API}/delivery/vehicles`); const data = await res.json(); setVehicles(Array.isArray(data) ? data : []); }
    catch (e) { console.error(e); }
  }, []);

  const loadServiceOrders = useCallback(async () => {
    try {
      const res = await af(`${API}/delivery/unassigned?date=${date}${companyId ? `&company_id=${companyId}` : ""}`);
      const data = await res.json();
      setServiceOrders(Array.isArray(data) ? data.filter(o => o.type === "Service") : []);

      const res2 = await af(`${API}/services/unscheduled${companyId ? `?company_id=${companyId}` : ""}`);
      const data2 = await res2.json();
      setUnscheduledServices(Array.isArray(data2) ? data2 : []);
    } catch (e) { console.error("loadServiceOrders error:", e); }
  }, [date, companyId]);

  useEffect(() => { loadVehicles(); }, [loadVehicles]);

  const loadReadiness = async () => {
    if (!companyId) return;
    const res = await af(`${API}/delivery-readiness?company_id=${companyId}&date=${date}&days=3`);
    const d = await res.json();
    setReadiness(d);
    setShowReadiness(true);
  };

  const loadSuggestions = async () => {
    if (!companyId) return;
    const res = await af(`${API}/scheduling-suggest?company_id=${companyId}&date=${date}`);
    const d = await res.json();
    setSuggestions(d);
    setShowSuggest(true);
  };
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadServiceOrders(); }, [loadServiceOrders]);

  const activeVehicles = vehicles.filter(v => v.status === "Active");

  // Combined unassigned list: regular orders + service orders + trips
  const combinedUnassigned = [
    ...unassigned.filter(o => !o.is_multi_trip && o.type !== "Service").map(o => ({ ...o, _type: "order" })),
    ...serviceOrders.map(o => ({ ...o, _type: "service" })),
    ...trips.map(t => ({ ...t, _type: "trip" })),
  ].sort((a, b) => {
    const aTime = (a._type === "order" || a._type === "service") ? (a.time_slot || "") : (a.orders?.time_slot || "");
    const bTime = (b._type === "order" || b._type === "service") ? (b.time_slot || "") : (b.orders?.time_slot || "");
    return aTime.localeCompare(bTime);
  });

  // -- CRUD: Teams ------------------------------------------------------
  const createTeam = async (payload) => {
    const res = await af(`${API}/delivery-teams`, { method: "POST", body: JSON.stringify({ ...payload, team_date: date }) });
    const data = await res.json();
    if (res.status === 409 || data.error) return { error: data.error };
    setShowAddTeam(false); loadData();
  };

  const deleteTeam = async (id) => {
    if (!window.confirm("Delete this team and all its schedules?")) return;
    const res = await af(`${API}/delivery-teams/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadData();
  };

  // -- CRUD: Schedules (assign / unassign / reorder) --------------------
  const assignItem = async (teamId, id, type, setDateOnAssign = false) => {
    const team = teams.find(t => String(t.id) === String(teamId));
    const sortOrder = (team?.schedules?.length || 0) + 1;

    if (setDateOnAssign && type === "order") {
      await af(`${API}/orders/${id}/set-date`, {
        method: "PATCH", body: JSON.stringify({ delivery_date: date }),
      }).catch(() => {});
    }

    if (type === "trip") {
      await af(`${API}/order-trips/${id}`, { method: "PATCH", body: JSON.stringify({ status: "Assigned", scheduled_date: date }) });
      const trip = trips.find(t => t.id === id);
      if (trip) {
        const tripOrder = unassigned.find(o => o.so_number === trip.so_number);
        if (tripOrder) {
          await af(`${API}/delivery-schedules`, { method: "POST", body: JSON.stringify({ order_id: tripOrder.id, team_id: teamId, scheduled_date: date, sort_order: sortOrder }) });
        }
      }
    } else {
      const res = await af(`${API}/delivery-schedules`, { method: "POST", body: JSON.stringify({ order_id: id, team_id: teamId, scheduled_date: date, sort_order: sortOrder }) });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
    }
    loadData();
  };

  const unassignOrder = async (scheduleId) => {
    const res = await af(`${API}/delivery-schedules/${scheduleId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadData();
  };

  const updateScheduleStatus = async (scheduleId, status) => {
    await af(`${API}/delivery-schedules/${scheduleId}`, { method: "PATCH", body: JSON.stringify({ status }) });
  };

  const updateAllSchedulesStatus = async (teamId, status) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    await Promise.all((team.schedules || []).map(s => updateScheduleStatus(s.id, status)));
    await loadData();
  };

  // Drag-drop reorder within a team
  const handleAssignedDragStart = (teamId, fromIndex) => setDraggingAssigned({ teamId, fromIndex });
  const handleAssignedDrop = async (teamId, toIndex) => {
    if (!draggingAssigned || draggingAssigned.teamId !== teamId) return;
    const { fromIndex } = draggingAssigned;
    if (fromIndex === toIndex) { setDraggingAssigned(null); return; }
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const newSchedules = [...team.schedules];
    const [moved] = newSchedules.splice(fromIndex, 1);
    newSchedules.splice(toIndex, 0, moved);
    // Optimistic update
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, schedules: newSchedules } : t));
    setDraggingAssigned(null);
    // Persist sort_order
    await Promise.all(newSchedules.map((s, i) =>
      af(`${API}/delivery-schedules/${s.id}`, { method: "PATCH", body: JSON.stringify({ sort_order: i + 1 }) })
    ));
    loadData();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-base font-bold text-gray-700">Delivery Schedule</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-medium text-blue-700" />
          <button onClick={loadData} className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-50">Refresh</button>
          <button onClick={loadReadiness} className="bg-amber-500 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-amber-600">⚠️ Readiness</button>
          {!readOnly && <button onClick={loadSuggestions} className="bg-emerald-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-emerald-700">🧠 Smart Assign</button>}
          {!readOnly && <button onClick={() => setShowVehicleModal(true)} className="bg-gray-700 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-gray-800">Manage Vehicles</button>}
          {!readOnly && <button onClick={() => setShowAddTeam(true)} className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-blue-700">+ Add Team</button>}
        </div>
      </div>

      {loading && <div className="flex flex-col xl:flex-row gap-4"><div className="xl:w-72 space-y-2">{[1,2,3].map(i=><div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div><div className="flex-1 space-y-3">{[1,2].map(i=><div key={i} className="h-40 bg-white rounded-xl border border-gray-200 animate-pulse" />)}</div></div>}
      {showVehicleModal && <VehicleModal vehicles={vehicles} onClose={() => setShowVehicleModal(false)} onRefresh={loadVehicles} />}
      {showAddTeam && <AddTeamModal activeVehicles={activeVehicles} onClose={() => setShowAddTeam(false)} onCreate={createTeam} onGoToVehicles={() => { setShowAddTeam(false); setShowVehicleModal(true); }} />}
      {printTeam && <TeamPrintView team={printTeam} onClose={() => setPrintTeam(null)} />}
      {showAutoScheduler && (
        <AutoSchedulerModal date={date} companyId={companyId}
          onClose={() => setShowAutoScheduler(false)}
          onApproved={() => { loadData(); loadServiceOrders(); }} />
      )}

      {/* Readiness Modal */}
      {showReadiness && readiness && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-8 px-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h3 className="font-bold text-gray-900">Delivery Readiness Check</h3>
                <p className="text-xs text-gray-500">{readiness.ready}/{readiness.total} orders ready · Next 3 days</p>
              </div>
              <button onClick={() => setShowReadiness(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
            </div>
            <div className="p-4 space-y-2 max-h-[70vh] overflow-y-auto">
              {(readiness.orders || []).map(o => (
                <div key={o.order_id} className={`rounded-xl border p-3 ${o.is_ready ? "border-emerald-200 bg-emerald-50" : o.alerts.some(a => a.severity === "high") ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-violet-700">{o.so_number}</span>
                      <span className="text-sm text-gray-700">{o.customer_name}</span>
                      <span className="text-xs text-gray-400">{o.delivery_date}</span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.is_ready ? "bg-emerald-200 text-emerald-800" : "bg-red-200 text-red-800"}`}>{o.is_ready ? "Ready" : "Not Ready"}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span>Items: {o.arrived_items}/{o.total_items} arrived</span>
                    <span>Packed: {o.packed} Stored: {o.stored} Picked: {o.picked}</span>
                  </div>
                  {o.alerts.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {o.alerts.map((a, i) => (
                        <div key={i} className={`text-xs flex items-center gap-1 ${a.severity === "high" ? "text-red-700 font-medium" : a.severity === "medium" ? "text-amber-700" : "text-gray-500"}`}>
                          <span>{a.severity === "high" ? "🔴" : a.severity === "medium" ? "🟡" : "🔵"}</span>
                          <span>{a.message}</span>
                        </div>
                      ))}
                      {o.missing_items.length > 0 && <p className="text-xs text-red-600 ml-4">{o.missing_items.join(", ")}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Smart Assign Modal */}
      {showSuggest && suggestions && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-8 px-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h3 className="font-bold text-gray-900">🧠 Smart Assign — {date}</h3>
                <p className="text-xs text-gray-500">{suggestions.unassigned_count} unassigned orders grouped by area</p>
              </div>
              <button onClick={() => setShowSuggest(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {suggestions.unassigned_count === 0 && <p className="text-center text-gray-400 py-8">All orders already assigned!</p>}
              {(suggestions.suggestions || []).map(sg => (
                <div key={sg.area} className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="bg-violet-50 px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-violet-700">📍 {sg.area}</span>
                      <span className="text-xs text-gray-500">{sg.order_count} orders · {sg.item_count} items</span>
                    </div>
                    <button onClick={async () => {
                      if (teams.length === 0) { alert("Create a team first"); return; }
                      const teamId = teams[0]?.id;
                      if (!teamId) return;
                      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` };
                      for (const o of sg.orders) {
                        await fetch(`${API}/delivery-schedules`, { method: "POST", headers, body: JSON.stringify({ order_id: o.id, team_id: teamId, scheduled_date: date, area: sg.area, sort_order: 0 }) });
                      }
                      loadData();
                      loadSuggestions();
                    }} className="text-xs px-3 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700">Assign All to First Team</button>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {sg.orders.map(o => (
                      <div key={o.id} className="px-4 py-2 flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-gray-800">{o.so_number}</span>
                          <span className="text-xs text-gray-600 ml-2">{o.customer_name}</span>
                          {o.time_slot && <span className="text-xs text-violet-600 ml-2">{o.time_slot}</span>}
                          {o._has_balance && <span className="text-xs text-red-500 ml-2">RM {o.balance}</span>}
                        </div>
                        <span className="text-xs text-gray-400">{o._item_count} items</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-4">
        {/* Unassigned Panel */}
        <div className="xl:w-72 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b bg-orange-50 rounded-t-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-orange-700">
                  Unassigned <span className="ml-1 bg-orange-200 text-orange-800 text-xs px-2 py-0.5 rounded-full">{combinedUnassigned.length}</span>
                </h3>
              </div>
              <div className="flex gap-2 mt-1 flex-wrap">
                <span className="text-xs text-gray-500">Delivery</span>
                <span className="text-xs text-purple-600">Service</span>
                <span className="text-xs text-purple-400">Trips</span>
              </div>
            </div>
            <div className="p-3 space-y-2 max-h-screen overflow-y-auto">
              {combinedUnassigned.length === 0
                ? <p className="text-xs text-gray-400 text-center py-4">All assigned!</p>
                : combinedUnassigned.map(item => {
                    if (item._type === "trip") {
                      return (
                        <TripCard key={`trip-${item.id}`} trip={item} teams={teams} isLocked={readOnly}
                          onAssign={assignItem} onDragStart={() => setDragOrder({ ...item, _type: "trip" })} />
                      );
                    }
                    if (item._type === "service") {
                      const items = parseItems(item.items);
                      return (
                        <div key={`service-${item.id}`} className="bg-purple-50 border border-purple-200 rounded-lg p-2 cursor-grab"
                          draggable={!readOnly} onDragStart={() => !readOnly && setDragOrder({ ...item, _type: "order" })}>
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
                          {item.service_note && <p className="text-xs text-purple-600 mt-0.5 truncate">{item.service_note}</p>}
                          <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
                          {!readOnly && teams.length > 0 && (
                            <select onChange={e => { if (e.target.value) assignItem(e.target.value, item.id, "order"); }}
                              className="mt-2 w-full text-xs border rounded px-1 py-1 text-gray-600">
                              <option value="">Assign to team...</option>
                              {teams.filter(t => { const st = deriveTeamStatus(t.schedules); return st === "Pending" || st === "Confirmed"; }).map(t => (
                                <option key={t.id} value={t.id}>{t.vehicle_plate || t.driver_name} {t.area ? `(${t.area})` : ""}{deriveTeamStatus(t.schedules) === "Confirmed" ? " (confirmed)" : ""}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    }
                    // Regular delivery order
                    const items = parseItems(item.items);
                    return (
                      <div key={`order-${item.id}`} className="bg-orange-50 border border-orange-200 rounded-lg p-2 cursor-grab"
                        draggable={!readOnly} onDragStart={() => !readOnly && setDragOrder({ ...item, _type: "order" })}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-blue-700 text-xs">{item.so_number}</span>
                          {parseFloat(item.balance) > 0 && <span className="text-red-500 text-xs font-medium">RM {item.balance}</span>}
                        </div>
                        <p className="text-xs font-medium text-gray-700">{item.customer_name}</p>
                        <p className="text-xs text-gray-400 leading-tight">{item.address}</p>
                        {item.time_slot && <p className="text-xs text-indigo-600 font-medium">{item.time_slot}</p>}
                        <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
                        {!readOnly && teams.length > 0 && (
                          <select onChange={e => { if (e.target.value) assignItem(e.target.value, item.id, "order"); }}
                            className="mt-2 w-full text-xs border rounded px-1 py-1 text-gray-600">
                            <option value="">Assign to team...</option>
                            {teams.filter(t => deriveTeamStatus(t.schedules) === "Pending").map(t => (
                              <option key={t.id} value={t.id}>{t.vehicle_plate || t.driver_name} {t.area ? `(${t.area})` : ""}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
            </div>
          </div>
        </div>

        {/* Unscheduled Services Panel */}
        {unscheduledServices.length > 0 && (
          <div className="xl:w-72 flex-shrink-0">
            <div className="bg-white rounded-xl border border-violet-200 shadow-sm">
              <div className="px-4 py-3 border-b bg-violet-50 rounded-t-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-violet-700">
                    Unscheduled Services <span className="ml-1 bg-violet-200 text-violet-800 text-xs px-2 py-0.5 rounded-full">{unscheduledServices.length}</span>
                  </h3>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Drag to team — date auto-set to {date}</p>
              </div>
              <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
                {unscheduledServices.map(item => {
                  const items = parseItems(item.items);
                  return (
                    <div key={`usvc-${item.id}`}
                      className="bg-violet-50 border border-violet-200 rounded-lg p-2 cursor-grab"
                      draggable={!readOnly} onDragStart={() => !readOnly && setDragOrder({ ...item, _type: "order", _setDate: true })}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs bg-violet-200 text-violet-800 font-bold px-1.5 py-0.5 rounded">SVC</span>
                          <span className="font-bold text-violet-700 text-xs">{item.so_number}</span>
                          {item.sv_number && <span className="text-xs text-violet-400">{item.sv_number}</span>}
                        </div>
                        {parseFloat(item.balance) > 0 && <span className="text-red-500 text-xs font-medium">RM {item.balance}</span>}
                      </div>
                      <p className="text-xs font-medium text-gray-700">{item.customer_name}</p>
                      <p className="text-xs text-gray-400 leading-tight truncate">{item.address}</p>
                      {item.service_note && <p className="text-xs text-violet-600 mt-0.5 truncate">{item.service_note}</p>}
                      <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
                      {!readOnly && teams.length > 0 && (
                        <select onChange={e => { if (e.target.value) assignItem(e.target.value, item.id, "order", true); }}
                          className="mt-2 w-full text-xs border rounded px-1 py-1 text-gray-600">
                          <option value="">Schedule to team...</option>
                          {teams.filter(t => { const st = deriveTeamStatus(t.schedules); return st === "Pending" || st === "Confirmed"; }).map(t => (
                            <option key={t.id} value={t.id}>{t.vehicle_plate || t.driver_name} {t.area ? `(${t.area})` : ""}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Team Cards (replaces Route Cards) */}
        <div className="flex-1 min-w-0">
          {teams.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm">No teams created for this date.</p>
              <p className="text-xs mt-1">Click "+ Add Team" to get started.</p>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {teams.map(team => {
              const teamStatus = deriveTeamStatus(team.schedules);
              const isLocked = readOnly || teamStatus === "Out for Delivery" || teamStatus === "Delivered";
              const isConfirmed = teamStatus === "Confirmed";
              return (
                <div key={team.id} className={`bg-white rounded-xl border shadow-sm ${isLocked ? "border-gray-300" : isConfirmed ? "border-green-300" : "border-gray-200"}`}
                  onDragOver={e => { if (!readOnly) e.preventDefault(); }}
                  onDrop={() => {
                    if (readOnly || !dragOrder || isLocked) return;
                    assignItem(team.id, dragOrder.id, dragOrder._type, dragOrder._setDate || false);
                    setDragOrder(null);
                  }}>
                  {/* Team Header */}
                  <div className={`px-4 py-3 border-b rounded-t-xl ${isLocked ? "bg-gray-50" : isConfirmed ? "bg-green-50" : "bg-blue-50"}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-blue-800 text-sm">{team.vehicle_plate || "No Plate"}</span>
                          {team.driver_name && <span className="text-xs text-gray-600">{team.driver_name}</span>}
                          {team.area && <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">{team.area}</span>}
                          {isLocked && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">Locked</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{team.schedules?.length || 0} stops</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <div className="flex flex-col items-end gap-1">
                          {readOnly ? (
                            <span className={`text-xs rounded px-2 py-0.5 font-medium ${statusColor(teamStatus)}`}>{teamStatus}</span>
                          ) : (
                            <select value={teamStatus}
                              onChange={e => updateAllSchedulesStatus(team.id, e.target.value)}
                              className={`text-xs rounded px-2 py-0.5 border-0 font-medium cursor-pointer ${statusColor(teamStatus)}`}>
                              {isLocked
                                ? ["Out for Delivery","Delivered"].map(s => <option key={s}>{s}</option>)
                                : isConfirmed
                                ? ["Confirmed","Pending"].concat(team.team_date === todayMY ? ["Out for Delivery"] : []).map(s => <option key={s}>{s}</option>)
                                : ["Pending","Confirmed"].concat(team.team_date === todayMY ? ["Out for Delivery"] : [], ["Delivered"]).map(s => <option key={s}>{s}</option>)
                              }
                            </select>
                          )}
                          {!readOnly && !isLocked && !isConfirmed && team.team_date !== todayMY && (
                            <p className="text-xs text-orange-400 text-right">Out for Delivery only on delivery date.</p>
                          )}
                          {!readOnly && isConfirmed && (
                            <p className="text-xs text-green-600 text-right font-medium">Confirmed — set to Pending to edit</p>
                          )}
                        </div>
                        <button onClick={() => setPrintTeam({ ...team, team_date: team.team_date || date })} className="text-gray-400 hover:text-gray-700 text-xs" title="Print">Print</button>
                        {!readOnly && !isLocked && !isConfirmed && (
                          <button onClick={() => deleteTeam(team.id)} className="text-gray-400 hover:text-red-500 text-xs">Delete</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Assigned Schedules */}
                  <div className="p-3 space-y-2 min-h-16">
                    {(!team.schedules || team.schedules.length === 0) && (
                      <p className="text-xs text-gray-300 text-center py-3">
                        {isLocked ? "No orders in this team." : isConfirmed ? "Team confirmed — unlock to Pending to edit." : "Drop orders or trips here"}
                      </p>
                    )}
                    {team.schedules?.map((sc, index) => {
                      const linkedTrip = trips.find(t => t.so_number === sc.orders?.so_number);
                      return (
                        <AssignedOrderCard
                          key={sc.id}
                          schedule={linkedTrip ? { ...sc, trip_no: linkedTrip.trip_no, total_trips: linkedTrip.total_trips, trip_status: linkedTrip.status } : sc}
                          teamId={team.id}
                          index={index}
                          isLocked={isLocked}
                          isTrip={!!linkedTrip}
                          onUnassign={unassignOrder}
                          onDragStart={(fromIndex) => handleAssignedDragStart(team.id, fromIndex)}
                          onDragOver={() => {}}
                          onDrop={(toIndex) => handleAssignedDrop(team.id, toIndex)}
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
