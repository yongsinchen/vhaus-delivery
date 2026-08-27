import { useState, useEffect, useCallback , memo } from "react";
import { supabase } from "./AuthContext";
import { useLoading, useToast } from "./UIComponents";
import CreateDeliveryOrderModal from "./CreateDeliveryOrderModal";
import { printHtml } from "./printDocument";

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

// Short local date for an item's arrival date (date-only strings are anchored
// to local midnight so they don't slip a day across time zones).
const fmtItemDate = v => {
  if (!v) return "";
  const d = new Date(String(v).length <= 10 ? v + "T00:00:00" : v);
  return isNaN(d) ? String(v) : d.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
};

// Normalize a phone to wa.me international digits. Numbers already in
// international form (60…/65…) are kept. A leading 0 is a Malaysian local
// number → 60XXXXXXXXX. A bare 8-digit number is Singapore local when the
// order is flagged SG (country === "SG", or "singapore" in the address) →
// 65XXXXXXXX; otherwise the digits are kept as-is.
const waNumber = (phone, country, address) => {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("60") || d.startsWith("65")) return d;
  if (d.startsWith("0")) return "60" + d.slice(1);
  const isSG = String(country || "").toUpperCase() === "SG" || /\bsingapore\b/i.test(address || "");
  if (isSG && d.length === 8) return "65" + d;
  return d;
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

// Print one Delivery Order — its OWN shipment lines (delivery_order_items), not
// the whole sales order. `company` supplies the printed header/logo.
function printDeliveryOrder(o, company = {}) {
  const so = o.sales_orders || {};
  const items = (o.delivery_order_items || []).filter(i => i.status !== "cancelled");
  const itemRows = items.map((it, i) => {
    const spec = [it.size, it.color].filter(Boolean).join(" · ");
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.product_code || "")}</td>
      <td>${esc(it.product_name || "")}${spec ? `<div style="font-size:9px;color:#555">${esc(spec)}</div>` : ""}</td>
      <td class="c">${Number(it.quantity) || 1}</td>
    </tr>`;
  }).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DO ${esc(o.do_number || "")}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 10mm; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
    .sheet { border: 1px solid #111; }
    .pad { padding: 8px 12px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 1px solid #111; }
    .logo { height: 42px; max-width: 180px; object-fit: contain; }
    .title { font-size: 18px; font-weight: 900; text-align: center; border-bottom: 1px solid #111; padding: 6px; background: #f5f5f5; letter-spacing: 2px; }
    .info td { padding: 3px 12px; font-size: 11px; vertical-align: top; }
    .info .lbl { font-weight: 700; width: 80px; }
    table.items { width: 100%; border-collapse: collapse; }
    table.items th { border: 1px solid #111; background: #f5f5f5; padding: 5px; font-size: 10px; }
    table.items td { border: 1px solid #ddd; padding: 5px 8px; }
    .c { text-align: center; }
    .foot { display: flex; border-top: 1px solid #111; }
    .foot .col { flex: 1; padding: 8px 12px; min-height: 80px; }
    .foot .col + .col { border-left: 1px solid #111; }
    .sigline { margin-top: 40px; border-top: 1px solid #111; padding-top: 2px; text-align: center; font-size: 9px; }
  </style></head><body>
  <div class="sheet">
    <div class="head pad">
      <div style="display:flex;gap:10px;align-items:flex-start">
        ${company.logo ? `<img src="${esc(company.logo)}" class="logo" alt="logo">` : ""}
        <div><b>${esc(company.name || "")}</b>${company.reg ? ` (${esc(company.reg)})` : ""}<br>${esc(company.address || "")}<br>${company.hotline ? "Tel: " + esc(company.hotline) : ""}</div>
      </div>
      <div style="text-align:right"><b>DO#: ${esc(o.do_number || "")}</b></div>
    </div>
    <div class="title">DELIVERY ORDER</div>
    <table class="info" style="width:100%;border-bottom:1px solid #111;border-collapse:collapse;">
      <tr><td class="lbl">Customer</td><td>${esc(so.customer_name || "")}</td><td class="lbl">SO#</td><td>${esc(so.order_number || "")}</td></tr>
      <tr><td class="lbl">Address</td><td>${esc(o.delivery_address || so.delivery_address || so.customer_address || "")}</td><td class="lbl">Date</td><td>${esc(o.delivery_date || "")}</td></tr>
      <tr><td class="lbl">Contact</td><td>${esc(so.customer_contact || "")}</td><td class="lbl">Salesman</td><td>${esc(so.salesman_name || "")}</td></tr>
    </table>
    <table class="items">
      <thead><tr><th style="width:30px">NO</th><th style="width:80px">CODE</th><th>DESCRIPTION</th><th style="width:50px">QTY</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="foot">
      <div class="col"><b>Remarks:</b><br>${esc(o.remark || "")}</div>
      <div class="col"><div class="sigline">Received By (Customer)</div></div>
      <div class="col"><div class="sigline">Delivered By</div></div>
    </div>
  </div>
  </body></html>`;
  printHtml(html);
}

// Fetch an image URL as a base64 data URI so it embeds in the Excel/HTML file
// (external URLs are not reliably loaded by Excel). Best-effort — null on fail.
async function toDataUrl(url) {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

// Export one Delivery Order as a real .xlsx (ExcelJS) that mirrors the printed
// PDF — embedded company logo + info header, DO/customer details, bordered item
// table, and signature footer. ExcelJS is imported lazily so it only loads when
// someone actually exports.
async function exportDeliveryOrderExcel(o, company = {}) {
  const ExcelJS = (await import("exceljs")).default;
  const so = o.sales_orders || {};
  const items = (o.delivery_order_items || []).filter(i => i.status !== "cancelled");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Delivery Order", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  ws.columns = [{ width: 6 }, { width: 20 }, { width: 46 }, { width: 12 }];

  const thin = { style: "thin", color: { argb: "FF000000" } };
  const boxAll = { top: thin, left: thin, bottom: thin, right: thin };
  const grayFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };

  // Header — logo (left) + company info, DO# on the right.
  ws.mergeCells("A1:B3");
  const logoUrl = company.logo ? await toDataUrl(company.logo) : null;
  if (logoUrl) {
    const m = /^data:image\/(png|jpe?g|gif)/i.exec(logoUrl);
    const ext = m ? (m[1].toLowerCase() === "jpg" ? "jpeg" : m[1].toLowerCase()) : "png";
    const imageId = wb.addImage({ base64: logoUrl, extension: ext });
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 54 } });
  }
  ws.mergeCells("C1:D1"); ws.getCell("C1").value = company.reg ? `${company.name || ""} (${company.reg})` : (company.name || "");
  ws.getCell("C1").font = { bold: true, size: 13 };
  ws.mergeCells("C2:D2"); ws.getCell("C2").value = company.address || "";
  ws.getCell("C2").font = { size: 9 }; ws.getCell("C2").alignment = { wrapText: true };
  ws.getCell("C3").value = company.hotline ? `Tel: ${company.hotline}` : "";
  ws.getCell("C3").font = { size: 9 };
  ws.getCell("D3").value = `DO#: ${o.do_number || ""}`;
  ws.getCell("D3").font = { bold: true }; ws.getCell("D3").alignment = { horizontal: "right" };

  // Title
  ws.mergeCells("A4:D4");
  const title = ws.getCell("A4");
  title.value = "DELIVERY ORDER"; title.font = { bold: true, size: 15 };
  title.alignment = { horizontal: "center" }; title.fill = grayFill;

  // Info block
  const info = (row, l1, v1, l2, v2) => {
    ws.getCell(`A${row}`).value = l1; ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`B${row}`).value = v1;
    ws.getCell(`C${row}`).value = l2; ws.getCell(`C${row}`).font = { bold: true };
    ws.getCell(`D${row}`).value = v2;
  };
  info(5, "Customer", so.customer_name || "", "SO#", so.order_number || "");
  info(6, "Address", o.delivery_address || so.customer_address || "", "Date", o.delivery_date || "");
  info(7, "Contact", so.customer_contact || "", "Salesman", so.salesman_name || "");
  ws.getCell("B6").alignment = { wrapText: true };

  // Item table header
  const headRow = 9;
  const heads = ["NO", "CODE", "DESCRIPTION", "QTY"];
  heads.forEach((h, i) => {
    const c = ws.getCell(headRow, i + 1);
    c.value = h; c.font = { bold: true }; c.fill = grayFill; c.border = boxAll;
    c.alignment = { horizontal: i === 0 || i === 3 ? "center" : "left" };
  });
  const descTexts = [];
  const codeTexts = [];
  items.forEach((it, i) => {
    const r = headRow + 1 + i;
    const spec = [it.size, it.color].filter(Boolean).join(" · ");
    const desc = (it.product_name || "") + (spec ? ` — ${spec}` : "");
    descTexts.push(desc); codeTexts.push(it.product_code || "");
    const vals = [i + 1, it.product_code || "", desc, Number(it.quantity) || 1];
    vals.forEach((v, ci) => {
      const c = ws.getCell(r, ci + 1);
      c.value = v; c.border = boxAll;
      if (ci === 0 || ci === 3) c.alignment = { horizontal: "center" };
      if (ci === 2) c.alignment = { wrapText: true };
    });
  });
  // Extra fixed line at the end of the item table.
  const totalRow = headRow + 1 + items.length;
  ["", "", "Total Amount", ""].forEach((v, ci) => {
    const c = ws.getCell(totalRow, ci + 1);
    c.value = v; c.border = boxAll;
    if (ci === 2) c.font = { bold: true };
    if (ci === 0 || ci === 3) c.alignment = { horizontal: "center" };
  });
  descTexts.push("Total Amount");

  // Footer — remarks + signatures (below the Total Amount line).
  let fr = totalRow + 2;
  ws.getCell(`A${fr}`).value = "Remarks:"; ws.getCell(`A${fr}`).font = { bold: true };
  ws.mergeCells(`B${fr}:D${fr}`); ws.getCell(`B${fr}`).value = o.remark || "";
  fr += 2;
  ws.mergeCells(`A${fr}:B${fr}`); ws.getCell(`A${fr}`).value = "Received By (Customer)";
  ws.mergeCells(`C${fr}:D${fr}`); ws.getCell(`C${fr}`).value = "Delivered By";
  ws.getCell(`A${fr}`).alignment = ws.getCell(`C${fr}`).alignment = { vertical: "bottom" };
  ws.getRow(fr).height = 44;

  // Fit columns to their content so nothing is clipped when opened in Excel.
  const longest = arr => arr.reduce((m, s) => Math.max(m, String(s ?? "").length), 0);
  const clamp = (min, val, max) => Math.max(min, Math.min(max, val));
  ws.getColumn(1).width = clamp(9, longest(["Customer", "Address", "Contact", "Remarks:"]) + 2, 16); // NO / info labels
  ws.getColumn(2).width = clamp(14, longest([so.customer_name, o.delivery_address || so.customer_address, so.customer_contact, ...codeTexts]) + 2, 40); // CODE / values
  ws.getColumn(3).width = clamp(30, longest([company.name, company.address, ...descTexts]) + 2, 60);                                                    // DESCRIPTION
  ws.getColumn(4).width = clamp(12, longest([so.order_number, o.delivery_date, so.salesman_name, "Salesman"]) + 2, 22);                                 // QTY / values

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `DO-${(o.do_number || "export").replace(/[^\w.-]/g, "_")}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Item arrival status (drives the per-row chip and per-stop readiness) ──
// Derived from the three legacy date fields the warehouse Excel sheet used:
// arrival > supplier sent > ordered > nothing.
const itemStatus = (item) => {
  // Service line items: Claim items (action 3) gate on the claimed part
  // arriving — not arrived until arrival_date is set, so the stop stays
  // Partial/Waiting. Assemble/Service items gate on their done/pending status.
  if (item.service_item) {
    if (Number(item.action_type) === 3) {
      return item.arrivalDate
        ? { label: "✓ Arrived", cls: "bg-emerald-100 text-emerald-700", arrived: true }
        : { label: "No arrival", cls: "bg-red-100 text-red-600", arrived: false };
    }
    return item.item_status === "done"
      ? { label: "✓ Done", cls: "bg-emerald-100 text-emerald-700", arrived: true }
      : { label: "Pending", cls: "bg-gray-100 text-gray-600", arrived: false };
  }
  if (item._do) return { label: "✓ Allocated", cls: "bg-emerald-100 text-emerald-700", arrived: true };
  if (item.arrivalDate) return { label: "✓ Arrived", cls: "bg-emerald-100 text-emerald-700", arrived: true };
  if (item.supplierSentDate) return { label: "Sent", cls: "bg-orange-100 text-orange-700", arrived: false };
  if (item.itemOrderDate) return { label: "Ordered", cls: "bg-gray-200 text-gray-600", arrived: false };
  return { label: "Not Ordered", cls: "bg-red-100 text-red-600", arrived: false };
};

// Stop-level readiness from its items: all arrived → Ready, some → Partial,
// none → Waiting. Stops without item data stay neutral.
const stopReadiness = (items) => {
  if (!items || items.length === 0) return { label: "No items", dot: "bg-gray-300", cls: "bg-gray-100 text-gray-500" };
  const arrived = items.filter(i => itemStatus(i).arrived).length;
  if (arrived === items.length) return { label: "Ready", dot: "bg-emerald-500", cls: "bg-emerald-100 text-emerald-700" };
  if (arrived > 0) return { label: `Partial ${arrived}/${items.length}`, dot: "bg-amber-400", cls: "bg-amber-100 text-amber-700" };
  return { label: "Waiting", dot: "bg-red-500", cls: "bg-red-100 text-red-600" };
};

const EMPTY_VEHICLE = { driver_name: "", vehicle_plate: "", vehicle_type: "", status: "Active" };

// Fix #6: a blank item name must never render as a bare "-". Fall through
// whatever descriptive text is available; when nothing is, flag it plainly
// instead of hiding the gap.
const NO_DESC = "(no description)";
const itemDisplayName = (item) => {
  // Service items prefix their action (Assemble / Service / Claim) so the work
  // to do is obvious on the board and the printed schedule.
  const prefix = item.service_item && item.action_label ? `[${item.action_label}] ` : "";
  const name = (item.itemName || item.product_name || "").trim();
  if (name) return { text: prefix + name, isFallback: false };
  const dim = (item.custom_dimensions || "").trim();
  if (dim) return { text: prefix + dim, isFallback: false };
  const note = (item.notes || "").trim();
  if (note) return { text: prefix + note, isFallback: false };
  const code = (item.itemCode || item.product_code || "").trim();
  if (code) return { text: prefix + code, isFallback: false };
  return { text: NO_DESC, isFallback: true };
};

// Fix #3: schedule status casing is inconsistent — the admin dropdown writes
// Title Case ("Confirmed", "Out for Delivery", "Delivered") while the driver
// app and DO lifecycle write lowercase ("scheduled", "arrived",
// "out_for_delivery", "delivered", "draft"). Normalize before comparing so a
// driver-completed DO-linked stop is reflected on the admin team-status pill
// instead of always showing "Pending".
const normalizeScheduleStatus = (s) => {
  const low = String(s || "").toLowerCase().replace(/_/g, " ").trim();
  if (low === "delivered") return "Delivered";
  if (low === "out for delivery" || low === "arrived") return "Out for Delivery";
  if (low === "confirmed") return "Confirmed";
  if (low === "scheduled" || low === "draft" || low === "pending" || low === "failed") return "Pending";
  return "Pending";
};

/** Derive a team-level status from its schedules */
const deriveTeamStatus = (schedules) => {
  if (!schedules || schedules.length === 0) return "Pending";
  const statuses = schedules.map(s => normalizeScheduleStatus(s.status));
  if (statuses.every(s => s === "Delivered")) return "Delivered";
  if (statuses.some(s => s === "Out for Delivery")) return "Out for Delivery";
  if (statuses.every(s => s === "Confirmed" || s === "Delivered")) return "Confirmed";
  return "Pending";
};

// Fix #7 (soft block): retry once with an operator-entered override reason
// when the backend rejects a scheduling POST for landing on a blocked date.
// Shared by every POST /delivery-schedules call site in this file.
const postWithBlockRetry = async (url, payload) => {
  let res = await af(url, { method: "POST", body: JSON.stringify(payload) });
  let data = await res.json();
  if (res.status === 400 && data.blocked_date) {
    const reason = window.prompt(`${data.error}\n\nEnter a reason to schedule anyway, or leave blank to cancel:`, "");
    if (!reason || !reason.trim()) return { error: data.error, cancelled: true };
    res = await af(url, { method: "POST", body: JSON.stringify({ ...payload, override_reason: reason.trim() }) });
    data = await res.json();
  }
  return data;
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

// -- Stop Row (assigned order inside a vehicle card) --------------------
// Logistics-sheet layout: compact customer block (~30%) on the left, dense
// per-item table (~70%) on the right, remark strip below. Items are always
// visible — no "View Items" toggle. Memoized: parent drag state changes must
// not re-render every stop on the page.
const ITEM_COLS = ["#", "Code", "Item", "Qty", "Supplier", "Ordered", "Sent", "Arrival"];

const DO_TERMINAL_STATUSES = ["delivered", "completed", "cancelled"];

const StopRow = memo(function StopRow({ schedule, teamId, index, isLocked, onUnassign, onDragStart, onDrop, onSaved, tripInfo, teams, onReassign }) {
  const o = schedule.orders || {};
  const [notes, setNotes] = useState(schedule.notes || "");
  const [slotVal, setSlotVal] = useState(schedule.slot || "");
  const [saving, setSaving] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const isTrip = !!tripInfo;

  // Phase 2B: a DO schedule shows ONLY that shipment's items. DO items were
  // arrival-checked at DO creation, so they count as allocated/ready.
  // Fix #1: carry product_code + supplier_name through so DO lines render the
  // same Code/Supplier columns as legacy items. Fix #6: also carry
  // custom_dimensions/notes (when the backend provides them) so blank
  // product_name still has somewhere to fall back to.
  const dord = schedule.delivery_orders || null;
  // Resolve each DO line's supplier arrival date from the legacy order's items
  // JSON (where the supplier-DO OCR records arrivalDate), matched on code/name,
  // so the DO board shows when each line arrived — not just supplier/code.
  const arrivalByKey = {};
  for (const li of parseItems(o.items)) {
    const k = String(li.itemCode || li.itemName || "").toLowerCase().trim();
    if (k && li.arrivalDate) arrivalByKey[k] = li.arrivalDate;
  }
  const items = dord
    ? (dord.delivery_order_items || []).filter(i => i.status !== "cancelled").map(i => ({
        itemCode: i.product_code, itemName: i.product_name, unit: String(Number(i.quantity)),
        supplier: i.supplier_name, custom_dimensions: i.custom_dimensions, notes: i.notes,
        arrivalDate: arrivalByKey[String(i.product_code || i.product_name || "").toLowerCase().trim()] || null,
        _do: true,
      }))
    : parseItems(o.items);
  const readiness = stopReadiness(items);
  const preferredTime = o.time_slot || "";
  const isLegacy = String(schedule.id).startsWith("legacy-");
  // Fix #8: a DO can be rescheduled until it's completed/cancelled — no more
  // cancel+recreate to move a shipment's date.
  const canReschedule = dord && !DO_TERMINAL_STATUSES.includes(String(dord.status || "").toLowerCase());
  // Fix #4: reassigning a stop to another team on the same date — only other
  // teams still open for assignment are offered.
  const reassignTargets = (teams || []).filter(t => t.id !== teamId && ["Pending", "Confirmed"].includes(deriveTeamStatus(t.schedules)));

  if (!o || !o.so_number) return null;

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

  // tbc=true reschedules to "To Be Confirmed" (clears the date); otherwise uses
  // the picked date. Either way the backend unassigns the DO from its team, so
  // it returns to the unassigned pool for the new date (or every date, if TBC).
  const saveReschedule = async (tbc = false) => {
    if (!dord || (!tbc && !rescheduleDate)) return;
    setRescheduling(true);
    try {
      const res = await af(`${API}/delivery-orders/${dord.id}`, {
        method: "PATCH", body: JSON.stringify({ delivery_date: tbc ? null : rescheduleDate })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      setShowReschedule(false);
      if (onSaved) onSaved();
    } finally { setRescheduling(false); }
  };

  return (
    <div
      className={`border-b border-gray-100 last:border-b-0 py-1.5 px-1 ${isTrip ? "bg-purple-50/40" : ""} ${isLocked ? "opacity-80" : "cursor-grab hover:bg-blue-50/30"}`}
      draggable={!isLocked}
      onDragStart={() => !isLocked && onDragStart(teamId, index, schedule.id)}
      onDragOver={e => { if (!isLocked) e.preventDefault(); }}
      onDrop={e => { if (!isLocked) { e.stopPropagation(); onDrop(teamId, index); } }}
    >
      <div className="flex gap-2">
        {/* Customer block (~30%) */}
        <div className="w-48 sm:w-56 flex-shrink-0 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            {!isLocked && <span className="text-gray-300 text-xs select-none cursor-grab leading-none">&#8942;&#8942;</span>}
            <span className="text-[11px] text-gray-400 font-medium">#{index + 1}</span>
            <span className={`font-bold text-xs ${isTrip ? "text-purple-700" : "text-blue-700"}`}>{o.so_number}</span>
            {dord && <span className="text-[10px] bg-violet-200 text-violet-800 font-bold px-1 py-0.5 rounded" title={`Delivery Order ${dord.do_number}`}>{dord.do_number}</span>}
            {!isLocked && (
              <button onClick={() => onUnassign(schedule.id)} className="text-gray-300 hover:text-red-500 text-xs ml-auto" title="Unassign">×</button>
            )}
          </div>
          {/* Fix #4 / #8: reassign to another team, or reschedule a DO's date,
              without unassign+recreate. Both hidden once the stop is locked. */}
          {!isLocked && !isLegacy && (onReassign || canReschedule) && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {onReassign && (
                showReassign ? (
                  <select autoFocus defaultValue="" onChange={e => { const tid = e.target.value; setShowReassign(false); if (tid) onReassign(schedule.id, tid); }}
                    onBlur={() => setShowReassign(false)}
                    className="text-[10px] border rounded px-1 py-0.5 text-gray-600 max-w-[110px]">
                    <option value="">Move to…</option>
                    {reassignTargets.map(t => <option key={t.id} value={t.id}>{t.vehicle_plate || t.driver_name}</option>)}
                  </select>
                ) : (
                  <button onClick={() => setShowReassign(true)} disabled={reassignTargets.length === 0} className="text-[10px] text-blue-500 hover:underline disabled:text-gray-300 disabled:no-underline" title={reassignTargets.length === 0 ? "No other open teams" : "Reassign to another team"}>Reassign</button>
                )
              )}
              {canReschedule && (
                showReschedule ? (
                  <span className="flex items-center gap-1">
                    <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} className="text-[10px] border rounded px-1 py-0.5 w-[102px]" />
                    <button onClick={() => saveReschedule(false)} disabled={rescheduling || !rescheduleDate} className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded disabled:opacity-50">{rescheduling ? "…" : "Save"}</button>
                    <button onClick={() => saveReschedule(true)} disabled={rescheduling} className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded disabled:opacity-50" title="Reschedule to To-Be-Confirmed (no date) — order goes to the unassigned pool">TBC</button>
                    <button onClick={() => setShowReschedule(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => { setRescheduleDate(dord.delivery_date || schedule.scheduled_date || ""); setShowReschedule(true); }} className="text-[10px] text-purple-500 hover:underline">Reschedule</button>
                )
              )}
            </div>
          )}
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${readiness.cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${readiness.dot}`} />{readiness.label}
            </span>
            {isTrip && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${tripStatusColor(tripInfo.trip_status)}`} title={tripInfo.trip_no === 1 ? "Commission trip" : "No commission"}>
                Trip {tripInfo.trip_no}/{tripInfo.total_trips}{tripInfo.trip_no === 1 ? " · comm" : ""}
              </span>
            )}
            {o.order_amount != null && <span className="text-gray-600 text-[10px] font-bold">RM {Number(o.order_amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>}
            {parseFloat(o.balance) > 0 && <span className="text-red-500 text-[10px] font-bold">Bal RM {o.balance}</span>}
          </div>
          <p className="text-xs font-medium text-gray-800 mt-0.5 truncate">{o.customer_name}</p>
          {o.contact && (
            waNumber(o.contact, o.country, o.address)
              ? <a href={`https://wa.me/${waNumber(o.contact, o.country, o.address)}`} target="_blank" rel="noopener noreferrer" draggable={false} onClick={e => e.stopPropagation()}
                  className="text-[11px] text-emerald-600 hover:text-emerald-700 hover:underline leading-tight inline-flex items-center gap-1" title="Message on WhatsApp">
                  <span aria-hidden="true">💬</span>{o.contact}
                </a>
              : <p className="text-[11px] text-gray-500 leading-tight">{o.contact}</p>
          )}
          <p className="text-[11px] text-gray-400 leading-tight break-words">{o.address}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px]">
            <span className="text-gray-400">Ord: {o.order_date || "-"}</span>
            {preferredTime && <span className="font-medium text-purple-600 bg-purple-50 rounded px-1">{preferredTime}</span>}
          </div>
          {!isLocked ? (
            <div className="flex items-center gap-1 mt-0.5">
              <input value={slotVal} onChange={e => setSlotVal(e.target.value)} onBlur={() => saveSlot(slotVal)} placeholder="Slot e.g. 10-12"
                onKeyDown={e => e.key === "Enter" && saveSlot(slotVal)}
                className={`text-[11px] border rounded px-1 py-0.5 w-24 ${saving ? "opacity-50" : ""}`} />
              {preferredTime && !slotVal && <button onClick={() => { setSlotVal(preferredTime); saveSlot(preferredTime); }} className="text-[10px] text-purple-600 hover:underline whitespace-nowrap">use pref.</button>}
            </div>
          ) : (
            schedule.slot && <span className="text-[11px] text-blue-700 font-medium bg-blue-50 border border-blue-200 rounded px-1 py-0.5 inline-block mt-0.5">Slot: {schedule.slot}</span>
          )}
        </div>

        {/* Item table (~70%) — one product per row, Excel-sheet columns */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          {items.length === 0 ? (
            <p className="text-[11px] text-gray-400 pt-1">No item data.</p>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-emerald-50 text-gray-600 text-left">
                  {ITEM_COLS.map(h => (
                    <th key={h} className={`font-semibold px-1.5 py-0.5 border border-emerald-100 whitespace-nowrap ${h === "#" || h === "Qty" ? "text-center w-7" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const st = itemStatus(item);
                  const dn = itemDisplayName(item);
                  return (
                    <tr key={i} className="align-top">
                      <td className="px-1.5 py-0.5 border border-gray-100 text-center text-gray-400">{i + 1}</td>
                      <td className="px-1.5 py-0.5 border border-gray-100 font-mono text-gray-500 whitespace-nowrap">{item.itemCode || ""}</td>
                      <td className={`px-1.5 py-0.5 border border-gray-100 break-words ${dn.isFallback ? "italic text-red-500 font-medium" : "text-gray-800 font-medium"}`}>{dn.text}</td>
                      <td className="px-1.5 py-0.5 border border-gray-100 text-center text-gray-700">{item.unit || 1}</td>
                      <td className="px-1.5 py-0.5 border border-gray-100 text-gray-600 whitespace-nowrap">{item.supplier || ""}</td>
                      <td className="px-1.5 py-0.5 border border-gray-100 text-gray-500 whitespace-nowrap">{item.itemOrderDate || ""}</td>
                      <td className="px-1.5 py-0.5 border border-gray-100 text-gray-500 whitespace-nowrap">{item.supplierSentDate || ""}</td>
                      <td className="px-1.5 py-0.5 border border-gray-100 whitespace-nowrap">
                        <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                        {item.arrivalDate && <span className="text-gray-500 ml-1">{item.arrivalDate}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Remark strip + dispatcher note — full width, below the table.
          Service stops show the linked SO and service detail in their own
          labelled fields instead of the combined "Linked to SO: <n> | …" blob
          the service RPC writes into remark/service_note. */}
      {o.type === "Service" ? (() => {
        const detail = String(o.service_note || o.remark || "").replace(/^Linked to SO:\s*\S+\s*(\|\s*)?/i, "").trim();
        if (!o.linked_so && !detail) return null;
        return (
          <div className="bg-violet-50 border border-violet-200 text-violet-800 rounded px-2 py-1 text-[11px] mt-1 space-y-0.5">
            {o.linked_so && <div><span className="font-semibold">Linked SO: </span>{o.linked_so}</div>}
            {detail && <div><span className="font-semibold">Service: </span>{detail}</div>}
          </div>
        );
      })() : (
        o.remark && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded px-2 py-1 text-[11px] mt-1">
            <span className="font-semibold">Remark: </span>{o.remark}
          </div>
        )
      )}
      {!isLocked ? (
        <input value={notes} onChange={e => setNotes(e.target.value)}
          onBlur={e => saveNotes(e.target.value)}
          placeholder="Dispatcher note (optional)"
          className="w-full text-[11px] border border-gray-200 rounded px-2 py-0.5 mt-1 focus:outline-none focus:ring-1 focus:ring-blue-300 text-gray-500"
        />
      ) : (
        notes && <p className="text-[11px] text-gray-400 italic mt-1">{notes}</p>
      )}
    </div>
  );
});

// -- Print CSS ---------------------------------------------------------
const PRINT_STYLE = `@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; } .print-area { position: absolute; left: 0; top: 0; width: 100%; } @page { size: A4 landscape; margin: 8mm; } .order-block { page-break-inside: avoid; } .no-print { display: none !important; } }`;

// -- Team Print View ---------------------------------------------------
function TeamPrintView({ team, onClose }) {
  const parseItemsSafe = items => { try { return typeof items === "string" ? JSON.parse(items || "[]") : (items || []); } catch { return []; } };
  const handlePrint = () => {
    const printArea = document.querySelector(".print-area");
    if (!printArea) return;
    printHtml(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Delivery Schedule</title>
    <style>@page{size:A4 landscape;margin:8mm}body{font-family:Arial,sans-serif;margin:0;padding:8px}
    .order-block{page-break-inside:avoid}table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:10px}</style>
    </head><body>${printArea.innerHTML}</body></html>`);
    onClose();
  };
  const dateStr = team.team_date || "-";
  const vehicleStr = [team.vehicle_plate, team.driver_name, team.area].filter(Boolean).join(" / ");
  const allRows = [];
  (team.schedules || []).forEach(sc => {
    const o = sc.orders;
    if (!o) return;
    // Phase 2B: DO schedules print ONLY that shipment's items, tagged with the DO
    // number. Fix #1: carry product_code + supplier_name so the printed sheet
    // matches the on-screen Code/Supplier columns for DO lines too.
    // Resolve each DO line's supplier arrival date from the legacy order's items
    // JSON (where the supplier-DO OCR records arrivalDate), matched on code/name,
    // so the printed "Arrival PG" column shows when each line arrived instead of
    // always printing "No arrival" — mirrors the on-screen StopRow resolution.
    const arrivalByKey = {};
    for (const li of parseItemsSafe(o.items)) {
      const k = String(li.itemCode || li.itemName || "").toLowerCase().trim();
      if (k && li.arrivalDate) arrivalByKey[k] = li.arrivalDate;
    }
    let items = sc.delivery_orders
      ? (sc.delivery_orders.delivery_order_items || []).filter(i => i.status !== "cancelled").map(i => ({
          itemCode: i.product_code, itemName: i.product_name, unit: String(Number(i.quantity)),
          supplier: i.supplier_name, custom_dimensions: i.custom_dimensions, notes: i.notes,
          arrivalDate: arrivalByKey[String(i.product_code || i.product_name || "").toLowerCase().trim()] || null,
        }))
      : parseItemsSafe(o.items);
    // Service orders have no line items (inert order, items='[]'); surface the
    // service detail as the Item so it prints in the Item column instead of
    // only landing in Remark. Strip the "Linked to SO: <n> |" prefix the RPC
    // writes into service_note/remark.
    if (o.type === "Service" && items.length === 0) {
      const detail = String(o.service_note || o.remark || "").replace(/^Linked to SO:\s*\S+\s*(\|\s*)?/i, "").trim();
      items = [{ itemName: detail || "Service" }];
    }
    const displayItems = items.length > 0 ? items : [{}];
    displayItems.forEach((item, idx) => { allRows.push({ o: sc.delivery_orders ? { ...o, so_number: `${o.so_number} · ${sc.delivery_orders.do_number}` } : o, sc, item, idx, rowspan: displayItems.length, isFirst: idx === 0 }); });
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
                        <td style={{...BD,overflow:"hidden",wordBreak:"break-word",...(itemDisplayName(item).isFallback?{color:"red",fontStyle:"italic"}:{})}}>{Object.keys(item).length ? itemDisplayName(item).text : ""}</td>
                        <td style={{...BD,textAlign:"center"}}>{item.unit||""}</td>
                        <td style={{...BD}}>{item.supplier||""}</td>
                        <td style={{...BD,textAlign:"center"}}>{item.itemOrderDate||""}</td>
                        <td style={{...BD,textAlign:"center"}}>{item.supplierSentDate||""}</td>
                        <td style={{...BD,textAlign:"center"}}></td>
                        <td style={{...BD,textAlign:"center"}}>{item.service_item
                          ? (Number(item.action_type)===3
                              ? (item.arrivalDate?item.arrivalDate:<span style={{color:"red",fontWeight:"bold"}}>No arrival</span>)
                              : (item.item_status==="done"?<span style={{color:"#059669",fontWeight:"bold"}}>✓ Done</span>:<span style={{color:"#6b7280"}}>Pending</span>))
                          : (item.arrivalDate?item.arrivalDate:<span style={{color:"red",fontWeight:"bold"}}>No arrival</span>)}</td>
                        {isFirst&&<td rowSpan={rowspan} style={{...BD,verticalAlign:"top",overflow:"hidden",wordBreak:"break-word"}}>{o.type==="Service" ? (o.linked_so&&<div>Linked SO: {o.linked_so}</div>) : (o.remark&&<div>{o.remark}</div>)}{sc.notes&&<div style={{color:"#555",fontStyle:"italic"}}>{sc.notes}</div>}</td>}
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
  const { withLoading } = useLoading();
  const toast = useToast();
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ ...EMPTY_VEHICLE });
  const [editVehicleId, setEditVehicleId] = useState(null);
  const [editVehicle, setEditVehicle] = useState({});
  const createVehicle = async () => {
    if (!newVehicle.driver_name && !newVehicle.vehicle_plate) return alert("Please enter driver name or vehicle plate.");
    try {
      await withLoading("Saving vehicle…", async () => {
        await af(`${API}/delivery/vehicles`, { method: "POST", body: JSON.stringify(newVehicle) });
        setNewVehicle({ ...EMPTY_VEHICLE }); setShowAddVehicle(false); onRefresh();
      });
    } catch (e) { toast.error("Failed to save vehicle: " + e.message); }
  };
  const saveVehicle = async (id) => {
    try {
      await withLoading("Updating vehicle…", async () => {
        await af(`${API}/delivery/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(editVehicle) });
        setEditVehicleId(null); onRefresh();
      });
    } catch (e) { toast.error("Failed to update vehicle: " + e.message); }
  };
  const deleteVehicle = async (id) => {
    if (!window.confirm("Delete this vehicle?")) return;
    try {
      await withLoading("Deleting vehicle…", async () => {
        await af(`${API}/delivery/vehicles/${id}`, { method: "DELETE" }); onRefresh();
      });
    } catch (e) { toast.error("Failed to delete vehicle: " + e.message); }
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

// -- Unassigned card quick-view: order/DO/service details + items without
//    having to assign it to a team first.
function UnassignedPreviewModal({ data, onClose }) {
  const { type, item } = data;
  const so = item.sales_orders || {};
  const isDo = type === "do";
  const number = isDo ? item.do_number : item.so_number;
  const typeLabel = isDo ? "Delivery Order" : type === "service" ? "Service" : "Order";
  const customer = isDo ? so.customer_name : item.customer_name;
  const contact = isDo ? (so.customer_contact || so.contact) : item.contact;
  const address = isDo ? (item.delivery_address || so.customer_address) : item.address;
  const dateStr = isDo ? item.delivery_date : item.delivery_date;
  const amount = item.order_amount;
  const balance = item.balance;
  // Arrival dates for a DO's lines come from the sales order's items
  // (arrived_at, dual-written from the supplier-DO OCR) — plus the legacy
  // items JSON for non-DO cards. Build a lookup keyed by product code/name.
  const arrivalByKey = {};
  const addArrival = (k, a) => { if (k && a) arrivalByKey[String(k).toLowerCase().trim()] = a; };
  for (const li of parseItems(item.items)) {
    addArrival(li.itemCode || li.product_code, li.arrivalDate || li.arrival_date);
    addArrival(li.itemName || li.product_name, li.arrivalDate || li.arrival_date);
  }
  for (const soi of (so.sales_order_items || [])) {
    addArrival(soi.product_code, soi.arrived_at);
    addArrival(soi.product_name, soi.arrived_at);
  }
  const rows = isDo
    ? (item.delivery_order_items || []).filter(i => i.status !== "cancelled").map(i => ({
        name: i.product_name || i.product_code || "—", qty: Number(i.quantity) || 0,
        arrival: i.arrival_date || i.arrivalDate || arrivalByKey[String(i.product_code || i.product_name || "").toLowerCase().trim()] || null,
      }))
    : parseItems(item.items).map(i => ({
        name: i.itemName || i.product_name || "—", qty: Number(i.qty ?? i.quantity) || 0,
        arrival: i.arrivalDate || i.arrival_date || null,
      }));
  const Row = ({ label, value }) => value ? (
    <div className="flex gap-2 text-sm"><span className="text-gray-400 w-24 shrink-0">{label}</span><span className="text-gray-800 break-words">{value}</span></div>
  ) : null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{typeLabel}</span>
            <span className="font-bold text-gray-900 text-sm">{number}</span>
            {item.sv_number && <span className="text-xs text-purple-500">{item.sv_number}</span>}
            {!isDo && so.order_number && <span className="text-xs text-gray-400">{so.order_number}</span>}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          <div className="space-y-1.5">
            <Row label="Customer" value={customer} />
            <Row label="Contact" value={contact} />
            <Row label="Address" value={address} />
            <Row label="Delivery date" value={dateStr} />
            <Row label="Time slot" value={item.time_slot} />
            <Row label="Amount" value={amount != null && Number(amount) > 0 ? `RM ${Number(amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : null} />
            <Row label="Balance" value={parseFloat(balance) > 0 ? `RM ${balance}` : null} />
          </div>
          {item.service_note && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Service note</p>
              <p className="text-sm text-gray-800 whitespace-pre-line border border-gray-200 rounded-xl px-3 py-2">{item.service_note}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Items ({rows.length})</p>
            {rows.length === 0
              ? <p className="text-sm text-gray-400">No items listed.</p>
              : (
                <div className="space-y-1">
                  {rows.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-sm border border-gray-100 rounded-lg px-3 py-1.5">
                      <span className="text-gray-800 min-w-0 break-words">{r.name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${r.arrival ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                          {r.arrival ? `arrived ${fmtItemDate(r.arrival)}` : "no arrival date"}
                        </span>
                        <span className="text-gray-500">×{r.qty}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Add Team Modal (replaces AddRouteModal) ---------------------------
function AddTeamModal({ activeVehicles, onClose, onCreate, onGoToVehicles }) {
  const [vehicleId, setVehicleId] = useState("");

  const handleCreate = async () => {
    if (!vehicleId) return alert("Please select a vehicle.");
    // Vehicle-only team — no driver at creation.
    const res = await onCreate({ vehicle_id: parseInt(vehicleId), driver_id: null, helper_id: null });
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

// -- Blocked Dates Modal (fix #7) ---------------------------------------
// Settings CRUD for the soft-block list: dates dispatchers can still schedule
// onto, but only after typing an override reason (enforced server-side).
function BlockedDatesModal({ blockedDates, onClose, onRefresh }) {
  const { withLoading } = useLoading();
  const toast = useToast();
  const [newDate, setNewDate] = useState("");
  const [newReason, setNewReason] = useState("");
  const [saving, setSaving] = useState(false);

  const addBlockedDate = async () => {
    if (!newDate) { alert("Pick a date first."); return; }
    setSaving(true);
    try {
      await withLoading("Blocking date…", async () => {
        const res = await af(`${API}/delivery-blocked-dates`, { method: "POST", body: JSON.stringify({ blocked_date: newDate, reason: newReason.trim() || null }) });
        const data = await res.json();
        if (!res.ok || data.error) { alert(data.error || "Failed to block date"); return; }
        setNewDate(""); setNewReason(""); onRefresh();
      });
    } catch (e) { toast.error("Failed to block date: " + e.message); }
    setSaving(false);
  };

  const removeBlockedDate = async (id) => {
    if (!window.confirm("Remove this block? Dates will schedule normally again.")) return;
    try {
      await withLoading("Removing block…", async () => {
        await af(`${API}/delivery-blocked-dates/${id}`, { method: "DELETE" });
        onRefresh();
      });
    } catch (e) { toast.error("Failed to remove block: " + e.message); }
  };

  const sorted = [...(blockedDates || [])].sort((a, b) => String(a.blocked_date).localeCompare(String(b.blocked_date)));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-10 px-4 pb-10 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-bold text-gray-800 text-base">Blocked Delivery Dates</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">×</button>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-gray-500 mb-3">A blocked date does not stop scheduling outright — a dispatcher must enter an override reason to schedule on it. Existing schedules already on the date are unaffected.</p>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-end gap-2 flex-wrap">
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Date</label>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-gray-500 block mb-0.5">Reason (optional)</label>
              <input value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="e.g. Public holiday, warehouse stock-take"
                className="w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <button onClick={addBlockedDate} disabled={saving} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">+ Block Date</button>
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {sorted.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No blocked dates in range.</p>}
            {sorted.map(b => (
              <div key={b.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-semibold text-gray-800">{b.blocked_date}</span>
                  {b.reason && <span className="text-xs text-gray-500 ml-2">{b.reason}</span>}
                </div>
                <button onClick={() => removeBlockedDate(b.id)} className="text-xs text-gray-400 hover:text-red-500">Remove</button>
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

// -- Main Component ----------------------------------------------------
// Delivery Orders tab — a flat list of every Delivery Order created for the
// company, so undated (TBC) DOs have a home (they no longer clutter each date's
// unassigned pool) and their delivery date can be set/changed from one place.
function DeliveryOrdersTab({ onChanged }) {
  const toast = useToast();
  const [dos, setDos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [edit, setEdit] = useState({});      // do id -> date string being edited
  const [savingId, setSavingId] = useState(null);
  const [dateFilter, setDateFilter] = useState(""); // filter list by delivery date
  const [company, setCompany] = useState({});       // header/logo for the printed DO
  const TERMINAL = ["completed", "cancelled"];

  useEffect(() => {
    af(`${API}/company-settings`).then(r => r.json()).then(d => {
      if (d.settings) setCompany({
        name: d.settings.company_name || "", reg: d.settings.registration_no || "", address: d.settings.address || "",
        hotline: d.settings.hotline || "", logo: d.settings.logo_url || "",
      });
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await af(`${API}/delivery-orders`);
      const d = await res.json();
      const list = d.delivery_orders || [];
      setDos(list);
      const e = {}; list.forEach(o => { e[o.id] = o.delivery_date || ""; });
      setEdit(e);
    } catch { toast.error("Failed to load delivery orders"); }
    setLoading(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const applyDate = async (id, dateVal) => {
    setSavingId(id);
    try {
      const res = await af(`${API}/delivery-orders/${id}`, { method: "PATCH", body: JSON.stringify({ delivery_date: dateVal || null }) });
      const d = await res.json();
      if (d.error) { toast.error(d.error); return; }
      toast.success(dateVal ? `Scheduled to ${dateVal}` : "Set to TBC");
      await load();
      if (onChanged) onChanged();
    } finally { setSavingId(null); }
  };

  const statusCls = s => ({ draft: "bg-gray-100 text-gray-600", scheduled: "bg-blue-100 text-blue-700", out_for_delivery: "bg-amber-100 text-amber-700", arrived: "bg-indigo-100 text-indigo-700", delivered: "bg-green-100 text-green-700", completed: "bg-green-100 text-green-700", failed: "bg-red-100 text-red-700", cancelled: "bg-gray-200 text-gray-500" }[String(s || "").toLowerCase()] || "bg-gray-100 text-gray-600");

  const rows = dos
    .filter(o => showDone || !TERMINAL.includes(String(o.status || "").toLowerCase()))
    .filter(o => !dateFilter || o.delivery_date === dateFilter)
    .sort((a, b) => {
      const ad = a.delivery_date || "", bd = b.delivery_date || "";  // TBC (no date) first
      if (!ad && bd) return -1;
      if (ad && !bd) return 1;
      return ad.localeCompare(bd);
    });

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold text-gray-700">All Delivery Orders <span className="text-gray-400 font-normal">({rows.length})</span></h3>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-gray-500 flex items-center gap-1">Date
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="border rounded px-2 py-1 text-xs" />
          </label>
          {dateFilter && <button onClick={() => setDateFilter("")} className="text-xs text-gray-400 hover:text-red-500">clear</button>}
          <label className="text-xs text-gray-500 flex items-center gap-1"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show completed/cancelled</label>
          <button onClick={load} className="bg-white border border-gray-300 rounded-lg px-3 py-1 text-xs hover:bg-gray-50">Refresh</button>
        </div>
      </div>
      {loading ? <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
        : rows.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">No delivery orders.</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-3 py-2">DO #</th><th className="px-3 py-2">SO #</th><th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Items</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Delivery date</th><th className="px-3 py-2"></th>
              </tr></thead>
              <tbody>
                {rows.map(o => {
                  const so = o.sales_orders || {};
                  const items = (o.delivery_order_items || []).filter(i => i.status !== "cancelled");
                  const terminal = TERMINAL.includes(String(o.status || "").toLowerCase());
                  return (
                    <tr key={o.id} className="border-t">
                      <td className="px-3 py-2 font-bold text-violet-700 whitespace-nowrap">{o.do_number}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{so.order_number}</td>
                      <td className="px-3 py-2">{so.customer_name}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[240px] truncate">{items.map(i => `${i.product_name} ×${Number(i.quantity)}`).join(", ")}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full font-medium ${statusCls(o.status)}`}>{o.status}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {terminal ? <span className="text-gray-500">{o.delivery_date || "—"}</span>
                          : <><input type="date" value={edit[o.id] || ""} onChange={e => setEdit(p => ({ ...p, [o.id]: e.target.value }))} className="border rounded px-2 py-1 text-xs" />
                              {!o.delivery_date && <span className="ml-1 text-amber-600 font-semibold">TBC</span>}</>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {!terminal && (
                            <>
                              <button disabled={savingId === o.id || !edit[o.id] || edit[o.id] === (o.delivery_date || "")} onClick={() => applyDate(o.id, edit[o.id])} className="bg-blue-600 text-white px-2 py-1 rounded disabled:opacity-40">{savingId === o.id ? "…" : "Save"}</button>
                              {o.delivery_date && <button disabled={savingId === o.id} onClick={() => applyDate(o.id, null)} className="bg-amber-500 text-white px-2 py-1 rounded disabled:opacity-40" title="Set to TBC (clear date)">TBC</button>}
                            </>
                          )}
                          <button onClick={() => printDeliveryOrder(o, company)} className="border border-gray-300 px-2 py-1 rounded hover:bg-gray-50" title="Print / Save as PDF">📄 PDF</button>
                          <button onClick={() => exportDeliveryOrderExcel(o, company)} className="border border-gray-300 px-2 py-1 rounded hover:bg-gray-50" title="Download as Excel">📊 Excel</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function DeliverySchedule({ readOnly = false, companyId = null, currentUser = null, initialDate = null }) {
  const { withLoading } = useLoading();
  const toast = useToast();
  const [date, setDate] = useState(initialDate || new Date().toISOString().split("T")[0]);
  // Open on the date passed in (e.g. clicked from the overview calendar).
  useEffect(() => { if (initialDate) setDate(initialDate); }, [initialDate]);
  // Company header/logo for printing a Delivery Order from the board.
  useEffect(() => {
    af(`${API}/company-settings`).then(r => r.json()).then(d => {
      if (d.settings) setCompany({ name: d.settings.company_name || "", reg: d.settings.registration_no || "", address: d.settings.address || "", hotline: d.settings.hotline || "", logo: d.settings.logo_url || "" });
    }).catch(() => {});
  }, []);
  const [viewMode, setViewMode] = useState("schedule"); // "schedule" board | "orders" Delivery Orders tab
  const [teams, setTeams] = useState([]);         // delivery_teams with schedules grouped in
  const [unassigned, setUnassigned] = useState([]);
  const [trips, setTrips] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [dragOrder, setDragOrder] = useState(null);
  const [draggingAssigned, setDraggingAssigned] = useState(null);
  // Only admin-tier roles may drag an already-assigned stop onto a DIFFERENT
  // team. Everyone who can edit the schedule keeps within-team reorder and the
  // per-stop Reassign dropdown; this gate is specifically for cross-team drag.
  const canMoveAcrossTeams = ["master", "manager", "operation_manager", "company_admin"]
    .includes(String(currentUser?.role || "").toLowerCase());
  const [printTeam, setPrintTeam] = useState(null);
  const [showAutoScheduler, setShowAutoScheduler] = useState(false);

  const [serviceOrders, setServiceOrders] = useState([]);
  const [doModal, setDoModal] = useState(null);   // { salesOrderId, orderNumber, date } — Generate DO from the board
  const [previewItem, setPreviewItem] = useState(null); // { type, item } — quick view of an unassigned card's details
  const [company, setCompany] = useState({});     // header/logo for printed DOs
  const [unassignedDos, setUnassignedDos] = useState([]); // Phase 2B: draft Delivery Orders awaiting scheduling
  const [activeDoSoNumbers, setActiveDoSoNumbers] = useState(new Set()); // SOs with active DOs — excluded from whole-order pool
  const [readiness, setReadiness] = useState(null);
  const [smartPlan, setSmartPlan] = useState(null); // Smart Assign proposal: area clusters of unassigned DOs
  const [assignTeam, setAssignTeam] = useState({}); // Smart Assign: area -> chosen team id (override)
  const [showReadiness, setShowReadiness] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);

  // Fix #7: soft-blocked delivery dates — loaded for a window around the
  // selected date so the picker can flag it and the settings modal has data.
  const [blockedDates, setBlockedDates] = useState([]);
  const [showBlockedDates, setShowBlockedDates] = useState(false);

  /** Load teams + schedules, group schedules into teams */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = companyId ? `&company_id=${companyId}` : "";
      const [teamsRes, schedulesRes, unassignedRes, tripsRes, dosRes] = await Promise.all([
        af(`${API}/delivery-teams?date=${date}${qs}`),
        af(`${API}/delivery-schedules?date=${date}${qs}`),
        af(`${API}/delivery/unassigned?date=${date}${qs}`),
        af(`${API}/order-trips?date=${date}`),
        // Phase 2B/5: draft + failed DOs feed the pool; any active DO excludes
        // its SO from whole-order scheduling (an order ships as DOs OR whole)
        af(`${API}/delivery-orders?status=draft,scheduled,out_for_delivery,arrived,failed`),
      ]);
      const [teamsData, schedulesData, unassignedData, tripsData, dosData] = await Promise.all([
        teamsRes.json(), schedulesRes.json(), unassignedRes.json(), tripsRes.json(),
        dosRes.ok ? dosRes.json() : Promise.resolve({ delivery_orders: [] }),
      ]);
      const allActiveDos = dosData.delivery_orders || [];
      // Pool: drafts + failed attempts awaiting reschedule (Phase 5)
      setUnassignedDos(allActiveDos.filter(d => d.status === "draft" || d.status === "failed"));
      setActiveDoSoNumbers(new Set(allActiveDos.map(d => d.sales_orders?.order_number).filter(Boolean)));

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

  // Fix #7: fetch a window around the currently selected date (2 weeks back,
  // ~2 months forward) so the date picker's block badge and the settings
  // modal both have data without a full-table fetch.
  const loadBlockedDates = useCallback(async () => {
    try {
      const base = new Date(date);
      const from = new Date(base); from.setDate(from.getDate() - 14);
      const to = new Date(base); to.setDate(to.getDate() + 60);
      const iso = d => d.toISOString().split("T")[0];
      const res = await af(`${API}/delivery-blocked-dates?from=${iso(from)}&to=${iso(to)}`);
      const data = await res.json();
      setBlockedDates(Array.isArray(data.blocked_dates) ? data.blocked_dates : []);
    } catch (e) { console.error(e); }
  }, [date]);
  useEffect(() => { loadBlockedDates(); }, [loadBlockedDates]);

  const loadServiceOrders = useCallback(async () => {
    try {
      const res = await af(`${API}/delivery/unassigned?date=${date}${companyId ? `&company_id=${companyId}` : ""}`);
      const data = await res.json();
      setServiceOrders(Array.isArray(data) ? data.filter(o => o.type === "Service") : []);
    } catch (e) { console.error("loadServiceOrders error:", e); }
  }, [date, companyId]);

  useEffect(() => { loadVehicles(); }, [loadVehicles]);

  const loadReadiness = async () => {
    if (!companyId) return;
    try {
      await withLoading("Checking delivery readiness…", async () => {
        const res = await af(`${API}/delivery-readiness?company_id=${companyId}&date=${date}&days=3`);
        const d = await res.json();
        setReadiness(d);
        setShowReadiness(true);
      });
    } catch (e) { toast.error("Failed to load readiness: " + e.message); }
  };

  // Address → coarse area. Postcode first (Malaysian 5-digit), then keyword.
  const extractArea = (address) => {
    const lower = (address || "").toLowerCase();
    const pc = lower.match(/\b(\d{5})\b/);
    if (pc) {
      const c = pc[1];
      if (c.startsWith("14")) return "BM/SA";
      if (c.startsWith("13")) return "BW/PR/SJ";
      if (c.startsWith("11")) return "PG Island";
      if (c.startsWith("10")) return "GT/PG";
      if (c.startsWith("08") || c.startsWith("09")) return "SP/KL";
    }
    for (const [code, kws] of Object.entries(AREA_SYNONYMS)) {
      if (kws.some(kw => lower.includes(kw))) return code;
    }
    return "Other";
  };

  // Smart Assign (DO-based): cluster the board's unassigned Delivery Orders by
  // area, sequence each cluster by postcode (rough proximity), match a best-fit
  // team — a PROPOSAL only, applied per group when the user confirms.
  const buildSmartPlan = () => {
    const dos = unassignedDos.filter(d => d.status === "failed" || d.delivery_date === date);
    if (dos.length === 0) { toast.warning("No unassigned delivery orders to route for this date."); return; }
    const groups = {};
    for (const d of dos) {
      const addr = d.delivery_address || d.sales_orders?.customer_address || "";
      const area = extractArea(addr);
      const seq = (addr.match(/\b(\d{5})\b/)?.[1]) || "99999";
      (groups[area] = groups[area] || []).push({ ...d, _addr: addr, _seq: seq });
    }
    const plan = Object.entries(groups).map(([area, list]) => ({
      area,
      do_count: list.length,
      item_count: list.reduce((s, d) => s + (d.delivery_order_items || []).filter(i => i.status !== "cancelled").length, 0),
      dos: list.sort((a, b) => a._seq.localeCompare(b._seq)),
    })).sort((a, b) => b.do_count - a.do_count);
    setSmartPlan(plan);
    setShowSuggest(true);
  };

  // Assign one proposed cluster's DOs to a team, in the proposed sequence.
  const assignDoGroup = async (group, teamId) => {
    if (!teamId) { alert("Create or pick a team first"); return; }
    try {
      await withLoading(`Assigning ${group.dos.length} delivery order(s)…`, async () => {
        const team = teams.find(t => String(t.id) === String(teamId));
        let sort = (team?.schedules?.length || 0) + 1;
        for (const d of group.dos) {
          const data = await postWithBlockRetry(`${API}/delivery-schedules`, { delivery_order_id: d.id, team_id: teamId, scheduled_date: date, sort_order: sort++ });
          if (data.error && !data.cancelled) { toast.error(data.error); break; }
        }
        loadData();
      });
      setSmartPlan(prev => (prev || []).filter(g => g.area !== group.area));
    } catch (e) { toast.error("Failed to assign: " + e.message); }
  };
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadServiceOrders(); }, [loadServiceOrders]);

  const activeVehicles = vehicles.filter(v => v.status === "Active");

  // ── Smart Assign: match an area group to the best-fit team ──────────────
  // Teams a group can be assigned to (not locked/out for delivery).
  const assignableTeams = teams.filter(t => { const st = deriveTeamStatus(t.schedules); return st === "Pending" || st === "Confirmed"; });
  // Area code → its address keywords, so a group tagged "BM" matches a team
  // whose area is "Bukit Mertajam". Mirrors the backend's area extraction.
  const AREA_SYNONYMS = {
    BM: ["bukit mertajam", "alma", "bm"], SA: ["simpang ampat", "eco meadows", "sa"], SJ: ["seberang jaya", "sj"],
    BW: ["butterworth", "bw"], PR: ["perai", "pr"], PG: ["penang", "pg"], GT: ["georgetown", "gurney", "gt"],
    BK: ["batu kawan", "bandar cassia", "ideal venice", "bk"], NT: ["nibong tebal", "nt"], JW: ["jawi", "jw"],
    SP: ["sungai petani", "sp"], KL: ["kulim", "kl"], BL: ["bayan lepas", "bl"], JL: ["jelutong", "jl"],
    AI: ["air itam", "ai"], TB: ["tanjung bungah", "tb"], PT: ["pulau tikus", "pt"],
  };
  const areaTokens = (a) => {
    const low = (a || "").toLowerCase().trim();
    const set = new Set(low.split(/[^a-z0-9]+/).filter(Boolean));
    if (low) set.add(low);
    for (const tok of [...set]) { const syn = AREA_SYNONYMS[tok.toUpperCase()]; if (syn) syn.forEach(k => set.add(k)); }
    return set;
  };
  const bestTeamFor = (groupArea) => {
    const gset = areaTokens(groupArea);
    let best = null, score = 0;
    for (const t of assignableTeams) {
      const tset = areaTokens(t.area);
      let s = 0;
      for (const g of gset) for (const tt of tset) { if (g === tt) s += 3; else if (tt.includes(g) || g.includes(tt)) s += 1; }
      if (s > score) { score = s; best = t; }
    }
    return best; // null when nothing matches → caller falls back to the first team
  };
  const chosenTeamFor = (groupArea) => assignTeam[groupArea] || bestTeamFor(groupArea)?.id || assignableTeams[0]?.id || "";

  // Combined unassigned list: regular orders + service orders + trips + DOs.
  // Orders whose SO has active Delivery Orders are removed from the
  // whole-order pool — they are scheduled per-DO instead.
  const combinedUnassigned = [
    ...unassigned.filter(o => !o.is_multi_trip && o.type !== "Service" && !activeDoSoNumbers.has(o.so_number)).map(o => ({ ...o, _type: "order" })),
    ...serviceOrders.map(o => ({ ...o, _type: "service" })),
    // Undated (unscheduled) services are intentionally NOT mixed into the
    // unassigned column — they have no delivery date, so they belong only in
    // the dedicated "Unscheduled Services" section below (they were previously
    // shown in both, cluttering the day's unassigned pool).
    ...trips.map(t => ({ ...t, _type: "trip" })),
    // A DO with a target delivery_date only appears in the pool on that date's
    // tab; undated drafts appear on every date (they still need a slot).
    // Failed attempts (Phase 5) always show — they need rescheduling urgently.
    // Undated (TBC) DOs no longer appear on every date — they live in the
    // "Delivery Orders" tab until a date is set. Failed attempts still surface
    // for urgent rescheduling; dated DOs show on their own date.
    ...unassignedDos.filter(d => d.status === "failed" || d.delivery_date === date).map(d => ({ ...d, _type: "do" })),
  ].sort((a, b) => {
    const aTime = (a._type === "order" || a._type === "service") ? (a.time_slot || "") : (a.orders?.time_slot || "");
    const bTime = (b._type === "order" || b._type === "service") ? (b.time_slot || "") : (b.orders?.time_slot || "");
    return aTime.localeCompare(bTime);
  });

  // -- CRUD: Teams ------------------------------------------------------
  const createTeam = async (payload) => {
    return await withLoading("Creating team…", async () => {
      const res = await af(`${API}/delivery-teams`, { method: "POST", body: JSON.stringify({ ...payload, team_date: date }) });
      const data = await res.json();
      if (res.status === 409 || data.error) return { error: data.error };
      setShowAddTeam(false); loadData();
    });
  };

  const deleteTeam = async (id) => {
    if (!window.confirm("Delete this team and all its schedules?")) return;
    try {
      await withLoading("Deleting team…", async () => {
        const res = await af(`${API}/delivery-teams/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        loadData();
      });
    } catch (e) { toast.error(e.message); }
  };

  // -- CRUD: Schedules (assign / unassign / reorder) --------------------
  const assignItem = async (teamId, id, type, setDateOnAssign = false) => await withLoading("Assigning to route…", async () => {
    const team = teams.find(t => String(t.id) === String(teamId));
    const sortOrder = (team?.schedules?.length || 0) + 1;

    if (setDateOnAssign && type === "order") {
      await af(`${API}/orders/${id}/set-date`, {
        method: "PATCH", body: JSON.stringify({ delivery_date: date }),
      }).catch(() => {});
    }

    if (type === "do") {
      // Phase 2B: schedule a Delivery Order — backend flips the DO to
      // "scheduled" and logs the event. Fix #7: soft-blocked dates retry once
      // with a dispatcher-entered override reason.
      const data = await postWithBlockRetry(`${API}/delivery-schedules`, { delivery_order_id: id, team_id: teamId, scheduled_date: date, sort_order: sortOrder });
      if (data.error) { if (!data.cancelled) alert(data.error); return; }
      loadData();
      return;
    }

    if (type === "trip") {
      await af(`${API}/order-trips/${id}`, { method: "PATCH", body: JSON.stringify({ status: "Assigned", scheduled_date: date }) });
      const trip = trips.find(t => t.id === id);
      if (trip) {
        const tripOrder = unassigned.find(o => o.so_number === trip.so_number);
        if (tripOrder) {
          const data = await postWithBlockRetry(`${API}/delivery-schedules`, { order_id: tripOrder.id, team_id: teamId, scheduled_date: date, sort_order: sortOrder });
          if (data.error && !data.cancelled) alert(data.error);
        }
      }
    } else {
      const data = await postWithBlockRetry(`${API}/delivery-schedules`, { order_id: id, team_id: teamId, scheduled_date: date, sort_order: sortOrder });
      if (data.error) { if (!data.cancelled) alert(data.error); return; }
    }
    loadData();
  });

  const unassignOrder = useCallback(async (scheduleId) => {
    try {
      await withLoading("Removing from route…", async () => {
        const res = await af(`${API}/delivery-schedules/${scheduleId}`, { method: "DELETE" });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        loadData();
      });
    } catch (e) { toast.error(e.message); }
  }, [withLoading, toast, loadData]);

  // Fix #4: reassign a stop to another team without unassign+recreate.
  const reassignSchedule = useCallback(async (scheduleId, newTeamId) => {
    try {
      await withLoading("Reassigning…", async () => {
        const res = await af(`${API}/delivery-schedules/${scheduleId}`, { method: "PATCH", body: JSON.stringify({ team_id: newTeamId }) });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        loadData();
      });
    } catch (e) { toast.error("Failed to reassign: " + e.message); }
  }, [withLoading, toast, loadData]);

  const updateScheduleStatus = async (scheduleId, status) => {
    await af(`${API}/delivery-schedules/${scheduleId}`, { method: "PATCH", body: JSON.stringify({ status }) });
  };

  const updateAllSchedulesStatus = async (teamId, status) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    // Reverting a route to Pending/Confirmed (e.g. undoing an accidental
    // "Out for Delivery") must never un-deliver a stop that is already
    // Delivered — that would bypass the completion ledger. Downgrades touch
    // only the still-open stops; forward moves touch every stop.
    const isDowngrade = status === "Pending" || status === "Confirmed";
    const targets = isDowngrade
      ? (team.schedules || []).filter(s => normalizeScheduleStatus(s.status) !== "Delivered")
      : (team.schedules || []);
    if (targets.length === 0) return;
    try {
      await withLoading("Updating route status…", async () => {
        await Promise.all(targets.map(s => updateScheduleStatus(s.id, status)));
        await loadData();
      });
    } catch (e) { toast.error("Failed to update route: " + e.message); }
  };

  // Drag-drop reorder within a team — useCallback so memoized StopRows only
  // re-render when the drag state or data actually changes.
  const handleAssignedDragStart = useCallback((teamId, fromIndex, scheduleId) => setDraggingAssigned({ teamId, fromIndex, scheduleId }), []);
  const handleAssignedDrop = useCallback(async (teamId, toIndex) => {
    if (!draggingAssigned) return;
    // Cross-team move: reassign the dragged stop to the team it was dropped on.
    // Admin-tier only; other editors fall back to no-op (they use Reassign).
    if (draggingAssigned.teamId !== teamId) {
      const sid = draggingAssigned.scheduleId;
      setDraggingAssigned(null);
      if (canMoveAcrossTeams && sid) await reassignSchedule(sid, teamId);
      return;
    }
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
  }, [draggingAssigned, teams, loadData, canMoveAcrossTeams, reassignSchedule]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 relative">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-gray-700">Delivery Schedule</h2>
          <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs font-medium">
            <button onClick={() => setViewMode("schedule")} className={`px-3 py-1 rounded-md ${viewMode === "schedule" ? "bg-white shadow text-blue-700" : "text-gray-500"}`}>📅 Schedule</button>
            <button onClick={() => setViewMode("orders")} className={`px-3 py-1 rounded-md ${viewMode === "orders" ? "bg-white shadow text-blue-700" : "text-gray-500"}`}>📦 Delivery Orders</button>
          </div>
        </div>
        {viewMode === "schedule" && (
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-medium text-blue-700" />
          {/* Fix #7: native <input type="date"> can't paint per-day markers,
              so we flag the currently selected date inline when it's blocked. */}
          {blockedDates.some(b => b.blocked_date === date) && (
            <span className="text-xs bg-red-100 text-red-700 font-semibold px-2 py-1.5 rounded-lg border border-red-200" title={blockedDates.find(b => b.blocked_date === date)?.reason || "Blocked date — override reason required to schedule"}>
              ⛔ Blocked{blockedDates.find(b => b.blocked_date === date)?.reason ? `: ${blockedDates.find(b => b.blocked_date === date).reason}` : ""}
            </span>
          )}
          <button onClick={loadData} className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs hover:bg-gray-50">Refresh</button>
          <button onClick={loadReadiness} className="bg-amber-500 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-amber-600">⚠️ Readiness</button>
          {!readOnly && <button onClick={buildSmartPlan} className="bg-emerald-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-emerald-700">🧠 Smart Assign</button>}
          {!readOnly && <button onClick={() => setShowVehicleModal(true)} className="bg-gray-700 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-gray-800">Manage Vehicles</button>}
          {!readOnly && <button onClick={() => setShowBlockedDates(true)} className="bg-white border border-red-200 text-red-600 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-50">Blocked Dates</button>}
          {!readOnly && <button onClick={() => setShowAddTeam(true)} className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-blue-700">+ Add Team</button>}
        </div>
        )}
      </div>

      {loading && <div className="absolute inset-0 z-40 flex items-start justify-center pt-24 bg-white/40 pointer-events-none"><div className="flex items-center gap-2 bg-white shadow-lg rounded-full px-4 py-2 text-sm text-gray-600 border"><span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />Updating…</div></div>}
      {showVehicleModal && <VehicleModal vehicles={vehicles} onClose={() => setShowVehicleModal(false)} onRefresh={loadVehicles} />}
      {showBlockedDates && <BlockedDatesModal blockedDates={blockedDates} onClose={() => setShowBlockedDates(false)} onRefresh={loadBlockedDates} />}
      {showAddTeam && <AddTeamModal activeVehicles={activeVehicles} onClose={() => setShowAddTeam(false)} onCreate={createTeam} onGoToVehicles={() => { setShowAddTeam(false); setShowVehicleModal(true); }} />}
      {printTeam && <TeamPrintView team={printTeam} onClose={() => setPrintTeam(null)} />}
      {previewItem && <UnassignedPreviewModal data={previewItem} onClose={() => setPreviewItem(null)} />}
      {doModal && (
        <CreateDeliveryOrderModal
          salesOrderId={doModal.salesOrderId}
          orderNumber={doModal.orderNumber}
          defaultDate={doModal.date}
          onClose={() => setDoModal(null)}
          onCreated={() => { setDoModal(null); loadData(); }}
        />
      )}
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

      {/* Smart Assign Modal — proposed routing of unassigned Delivery Orders */}
      {showSuggest && smartPlan && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-8 px-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h3 className="font-bold text-gray-900">🧠 Smart Assign — {date}</h3>
                <p className="text-xs text-gray-500">{smartPlan.reduce((s, g) => s + g.do_count, 0)} unassigned delivery orders, clustered by area and routed by postcode. Review, then confirm each cluster.</p>
              </div>
              <button onClick={() => setShowSuggest(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {smartPlan.length === 0 && <p className="text-center text-gray-400 py-8">All delivery orders are assigned. 🎉</p>}
              {smartPlan.map(g => (
                <div key={g.area} className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="bg-violet-50 px-4 py-2 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-violet-700">📍 {g.area}</span>
                      <span className="text-xs text-gray-500">{g.do_count} DO{g.do_count !== 1 ? "s" : ""} · {g.item_count} items</span>
                      {bestTeamFor(g.area) && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">auto-matched</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select value={chosenTeamFor(g.area)} onChange={e => setAssignTeam(p => ({ ...p, [g.area]: e.target.value }))}
                        className="text-xs border rounded px-1.5 py-1 text-gray-700 bg-white max-w-[180px]">
                        {assignableTeams.length === 0 && <option value="">No team available</option>}
                        {assignableTeams.map(t => <option key={t.id} value={t.id}>{t.vehicle_plate || t.driver_name}{t.area ? ` · ${t.area}` : ""}</option>)}
                      </select>
                      <button onClick={() => assignDoGroup(g, chosenTeamFor(g.area))}
                        className="text-xs px-3 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 whitespace-nowrap">Confirm &amp; assign</button>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {g.dos.map((d, i) => {
                      const so = d.sales_orders || {};
                      const n = (d.delivery_order_items || []).filter(it => it.status !== "cancelled").length;
                      return (
                        <div key={d.id} className="px-4 py-2 flex items-center justify-between">
                          <div className="min-w-0">
                            <span className="text-xs text-gray-400 mr-1">{i + 1}.</span>
                            <span className="text-xs font-bold text-violet-700">{d.do_number}</span>
                            <span className="text-xs text-gray-400 ml-1">{so.order_number}</span>
                            <span className="text-xs text-gray-600 ml-2">{so.customer_name}</span>
                            <div className="text-[11px] text-gray-400 truncate">{d._addr}</div>
                          </div>
                          <span className="text-xs text-gray-400 whitespace-nowrap ml-2">{n} item{n !== 1 ? "s" : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {viewMode === "orders" && <DeliveryOrdersTab onChanged={loadData} />}

      <div className={`flex flex-col xl:flex-row gap-4 ${viewMode === "orders" ? "hidden" : ""}`}>
        {/* Unassigned Panel — also a drop zone: dragging an assigned stop here
            removes it from its route and returns it to the pool. */}
        <div className="xl:w-72 flex-shrink-0">
          <div className={`bg-white rounded-xl border shadow-sm ${!readOnly && draggingAssigned ? "border-orange-400 ring-2 ring-orange-200" : "border-gray-200"}`}
            onDragOver={e => { if (!readOnly && draggingAssigned) e.preventDefault(); }}
            onDrop={() => {
              if (readOnly || !draggingAssigned) return;
              const sid = draggingAssigned.scheduleId;
              setDraggingAssigned(null);
              if (sid) unassignOrder(sid);
            }}>
            <div className="px-4 py-3 border-b bg-orange-50 rounded-t-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-orange-700">
                  Unassigned <span className="ml-1 bg-orange-200 text-orange-800 text-xs px-2 py-0.5 rounded-full">{combinedUnassigned.length}</span>
                </h3>
              </div>
              {!readOnly && draggingAssigned && (
                <p className="text-xs text-orange-500 mt-1 font-medium">Drop here to unassign</p>
              )}
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
                    if (item._type === "do") {
                      // Delivery Order card (Phase 2B) — one shipment of a sales order
                      const so = item.sales_orders || {};
                      const doItems = (item.delivery_order_items || []).filter(i => i.status !== "cancelled");
                      return (
                        <div key={`do-${item.id}`} className="bg-violet-50 border border-violet-200 rounded-lg p-2 cursor-grab"
                          draggable={!readOnly} onDragStart={() => !readOnly && setDragOrder({ ...item, _type: "do" })}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1">
                              <span className="text-xs bg-violet-200 text-violet-800 font-bold px-1.5 py-0.5 rounded">DO</span>
                              <span className="font-bold text-violet-700 text-xs">{item.do_number}</span>
                              <span className="text-xs text-gray-400">{so.order_number}</span>
                              {item.status === "failed" && <span className="text-xs bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded">FAILED — retry</span>}
                            </div>
                            <span className="flex items-center gap-1.5">
                              <span className="text-xs text-violet-500 font-medium">{doItems.length} item{doItems.length !== 1 ? "s" : ""}</span>
                              <button onClick={(e) => { e.stopPropagation(); setPreviewItem({ type: "do", item }); }} title="View details" className="text-gray-400 hover:text-violet-600 leading-none">👁</button>
                            </span>
                          </div>
                          <p className="text-xs font-medium text-gray-700">{so.customer_name}</p>
                          <p className="text-xs text-gray-400 leading-tight">{item.delivery_address || so.customer_address || ""}</p>
                          {item.delivery_date && <p className="text-xs text-indigo-600 font-medium">target {item.delivery_date}</p>}
                          <p className="text-xs text-gray-400 mt-1 truncate">{doItems.map(i => `${i.product_name} ×${Number(i.quantity)}`).join(", ")}</p>
                          <div className="flex items-center gap-1 mt-1.5">
                            <button onClick={() => printDeliveryOrder(item, company)} className="flex-1 text-xs border border-gray-300 rounded px-1 py-1 hover:bg-white" title="Print / Save as PDF">📄 PDF</button>
                            <button onClick={() => exportDeliveryOrderExcel(item, company)} className="flex-1 text-xs border border-gray-300 rounded px-1 py-1 hover:bg-white" title="Download as Excel">📊 Excel</button>
                          </div>
                          {!readOnly && teams.length > 0 && (
                            <select onChange={e => { if (e.target.value) assignItem(e.target.value, item.id, "do"); }}
                              className="mt-2 w-full text-xs border rounded px-1 py-1 text-gray-600">
                              <option value="">Assign to team...</option>
                              {teams.filter(t => deriveTeamStatus(t.schedules) === "Pending" || deriveTeamStatus(t.schedules) === "Confirmed").map(t => (
                                <option key={t.id} value={t.id}>{t.vehicle_plate || t.driver_name} {t.area ? `(${t.area})` : ""}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    }
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
                            <span className="flex items-center gap-1.5">
                              {item.order_amount != null && Number(item.order_amount) > 0 && <span className="text-gray-600 text-xs font-semibold">RM {Number(item.order_amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>}
                              {parseFloat(item.balance) > 0 && <span className="text-red-500 text-xs font-medium">Bal RM {item.balance}</span>}
                              <button onClick={(e) => { e.stopPropagation(); setPreviewItem({ type: "service", item }); }} title="View details" className="text-gray-400 hover:text-purple-600 leading-none">👁</button>
                            </span>
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
                          <span className="flex items-center gap-1.5">
                            {item.order_amount != null && <span className="text-gray-600 text-xs font-semibold">RM {Number(item.order_amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>}
                            {parseFloat(item.balance) > 0 && <span className="text-red-500 text-xs font-medium">Bal RM {item.balance}</span>}
                            <button onClick={(e) => { e.stopPropagation(); setPreviewItem({ type: "order", item }); }} title="View details" className="text-gray-400 hover:text-blue-600 leading-none">👁</button>
                          </span>
                        </div>
                        <p className="text-xs font-medium text-gray-700">{item.customer_name}</p>
                        <p className="text-xs text-gray-400 leading-tight">{item.address}</p>
                        {item.time_slot && <p className="text-xs text-indigo-600 font-medium">{item.time_slot}</p>}
                        <p className="text-xs text-gray-400 mt-1 truncate">{items.map(i => i.itemName).filter(Boolean).join(", ")}</p>
                        {/* Generate a Delivery Order for this sales order. Once
                            created, the SO drops from the pool (it schedules per
                            DO) and appears as a DO card that can be printed. */}
                        {!readOnly && item.sales_order_id && (
                          <button onClick={() => setDoModal({ salesOrderId: item.sales_order_id, orderNumber: item.so_number, date })}
                            className="mt-2 w-full text-xs bg-violet-600 text-white rounded px-1 py-1 hover:bg-violet-700 font-medium">🚚 Generate DO</button>
                        )}
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

        {/* Unscheduled Services panel removed — services without a delivery
            date are no longer shown on the delivery board; give them a date on
            the Service page and they appear as dated services. */}

        {/* Team Cards (replaces Route Cards) */}
        <div className="flex-1 min-w-0">
          {teams.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm">No teams created for this date.</p>
              <p className="text-xs mt-1">Click "+ Add Team" to get started.</p>
            </div>
          )}
          {/* Full-width stacked vehicle cards — each stop hosts a logistics
              item table, which needs the horizontal room a 2-col grid denies */}
          <div className="space-y-3">
            {teams.map(team => {
              const teamStatus = deriveTeamStatus(team.schedules);
              const isLocked = readOnly || teamStatus === "Out for Delivery" || teamStatus === "Delivered";
              const isConfirmed = teamStatus === "Confirmed";
              return (
                <div key={team.id} className={`bg-white rounded-xl border shadow-sm ${isLocked ? "border-gray-300" : isConfirmed ? "border-green-300" : "border-gray-200"}`}
                  onDragOver={e => { if (!readOnly) e.preventDefault(); }}
                  onDrop={() => {
                    if (readOnly || isLocked) return;
                    if (dragOrder) {
                      assignItem(team.id, dragOrder.id, dragOrder._type, dragOrder._setDate || false);
                      setDragOrder(null);
                      return;
                    }
                    // Assigned stop dropped on the team body (not on a row) —
                    // cross-team move for admin-tier roles.
                    if (draggingAssigned && draggingAssigned.teamId !== team.id) {
                      const sid = draggingAssigned.scheduleId;
                      setDraggingAssigned(null);
                      if (canMoveAcrossTeams && sid) reassignSchedule(sid, team.id);
                    }
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
                                ? (teamStatus === "Out for Delivery"
                                    // Allow undoing an accidental Out for Delivery back to a
                                    // normal status. Delivered stops are protected in
                                    // updateAllSchedulesStatus so a revert never un-delivers.
                                    ? ["Out for Delivery","Confirmed","Pending","Delivered"]
                                    : ["Out for Delivery","Delivered"]
                                  ).map(s => <option key={s}>{s}</option>)
                                : isConfirmed
                                ? ["Confirmed","Pending"].concat(team.team_date === todayMY ? ["Out for Delivery"] : []).concat(team.team_date < todayMY ? ["Delivered"] : []).map(s => <option key={s}>{s}</option>)
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
                          {!readOnly && isLocked && teamStatus === "Out for Delivery" && (
                            <p className="text-xs text-gray-400 text-right">Set to Confirmed/Pending to undo &amp; edit</p>
                          )}
                        </div>
                        <button onClick={() => setPrintTeam({ ...team, team_date: team.team_date || date })} className="text-gray-400 hover:text-gray-700 text-xs" title="Print">Print</button>
                        {!readOnly && !isLocked && !isConfirmed && (
                          <button onClick={() => deleteTeam(team.id)} className="text-gray-400 hover:text-red-500 text-xs">Delete</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Assigned Schedules — one dense StopRow per stop, thin dividers */}
                  <div className="px-2 py-1 min-h-12">
                    {(!team.schedules || team.schedules.length === 0) && (
                      <p className="text-xs text-gray-300 text-center py-3">
                        {isLocked ? "No orders in this team." : isConfirmed ? "Team confirmed — unlock to Pending to edit." : "Drop orders or trips here"}
                      </p>
                    )}
                    {team.schedules?.map((sc, index) => {
                      const linkedTrip = trips.find(t => t.so_number === sc.orders?.so_number);
                      return (
                        <StopRow
                          key={sc.id}
                          schedule={sc}
                          teamId={team.id}
                          index={index}
                          isLocked={isLocked}
                          tripInfo={linkedTrip ? { trip_no: linkedTrip.trip_no, total_trips: linkedTrip.total_trips, trip_status: linkedTrip.status } : null}
                          teams={teams}
                          onReassign={readOnly ? null : reassignSchedule}
                          onUnassign={unassignOrder}
                          onDragStart={handleAssignedDragStart}
                          onDrop={handleAssignedDrop}
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

export default memo(DeliverySchedule);
