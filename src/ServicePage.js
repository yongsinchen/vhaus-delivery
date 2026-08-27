import React, { useState, useEffect, useCallback , memo } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast, useLoading } from "./UIComponents";
import { printHtml } from "./printDocument";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };

const SERVICE_TYPES = { 1: "Warranty Repair", 2: "Assembly / Installation", 3: "Exchange / Replacement", 4: "Delivery (Missing Item)", 5: "Delivery" };
// Short date for leg/arrival chips; blank-safe for null/empty values.
const dmy = v => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T00:00:00" : v); return isNaN(d) ? "" : d.toLocaleDateString("en-MY"); };
const TYPE_ICON = { 1: "🔧", 2: "🪛", 3: "🔄", 4: "🚚", 5: "📦" };
const STATUS_STYLE = {
  open: "bg-gray-100 text-gray-700", scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700", claiming: "bg-violet-100 text-violet-700",
  resolved: "bg-emerald-100 text-emerald-700", closed: "bg-gray-100 text-gray-400",
};
// Status-group tabs for the case list. Open = raised, no action yet (default
// view); Scheduled = a date is set / work underway; Resolved = done.
const STATUS_GROUPS = {
  open: ["open"],
  scheduled: ["scheduled", "in_progress", "claiming"],
  resolved: ["resolved", "closed"],
};
const STATUS_TABS = [["open", "Open"], ["scheduled", "Scheduled"], ["resolved", "Resolved"]];
const groupOf = status => Object.keys(STATUS_GROUPS).find(g => STATUS_GROUPS[g].includes(status)) || "open";
const LEG_STATUS = { pending: "bg-gray-100 text-gray-600", scheduled: "bg-blue-100 text-blue-700", in_progress: "bg-amber-100 text-amber-700", completed: "bg-emerald-100 text-emerald-700" };
const CLAIM_STATUS = { pending: "bg-gray-100 text-gray-600", submitted: "bg-blue-100 text-blue-700", approved: "bg-violet-100 text-violet-700", received: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-600" };
// Per-item action on a service case (matches backend service_items.action_type).
const ITEM_ACTIONS = { 1: "Assemble", 2: "Service", 3: "Claim" };
const ITEM_ACTION_ICON = { 1: "🪛", 2: "🔧", 3: "🔄" };

async function toDataUrl(url) {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise(resolve => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
  } catch { return null; }
}

// Print the Service Note (→ Save as PDF from the browser dialog). Rendered as
// HTML with system fonts so Chinese / mixed-language text renders correctly —
// jsPDF's built-in fonts have no CJK glyphs. Same layout as before: company
// header, the case details, a description box, and an items table.
function printServiceNote(detail, company = {}) {
  const svc = detail.service || {}, order = detail.order || {};
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const items = Array.isArray(detail.items) ? detail.items : [];

  const infoRow = (l1, v1, l2, v2) =>
    `<tr><td class="lbl">${esc(l1)}</td><td class="val">${esc(v1 || "—")}</td>` +
    `<td class="lbl">${l2 ? esc(l2) : ""}</td><td class="val">${l2 ? esc(v2 || "—") : ""}</td></tr>`;

  const hasAmount = svc.amount != null && svc.amount !== "";
  const amountStr = hasAmount ? `RM ${Number(svc.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : "";
  const infoRows = [
    infoRow("Type", SERVICE_TYPES[svc.service_type] || `Type ${svc.service_type}`, "Service date", svc.service_date ? dmy(svc.service_date) : ""),
    infoRow("Status", svc.status, "Due date", svc.due_date ? dmy(svc.due_date) : ""),
    infoRow("Customer", svc.customer_name || order.customer_name, "Salesman", order.salesman),
    infoRow("Contact", svc.customer_phone || order.contact, "Created", svc.created_at ? dmy(svc.created_at) : ""),
    infoRow("Address", svc.customer_address || order.address, hasAmount ? "Amount" : "", amountStr),
  ].join("");

  const itemsBlock = items.length > 0 ? `
    <div class="section">ITEMS</div>
    <table class="items">
      <thead><tr><th class="name">Item</th><th class="qty">Qty</th></tr></thead>
      <tbody>${items.map(it => `<tr><td class="name">${esc(it.description || "—")}</td><td class="qty">${esc(Number(it.quantity) || 1)}</td></tr>`).join("")}</tbody>
    </table>` : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Service Note ${esc(order.so_number || svc.id || "")}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif; color: #111; margin: 32px; font-size: 12px; }
      .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; }
      .hdr .co { display: flex; gap: 12px; align-items: flex-start; }
      .hdr img { height: 40px; object-fit: contain; }
      .co-name { font-weight: 700; font-size: 15px; }
      .co-sub { color: #555; font-size: 10px; line-height: 1.4; margin-top: 2px; white-space: pre-line; max-width: 320px; }
      .title { text-align: right; }
      .title .t { font-weight: 700; font-size: 18px; }
      .title .so { font-size: 11px; margin-top: 2px; }
      table.info { width: 100%; border-collapse: collapse; margin-top: 14px; }
      table.info td { padding: 2px 4px; vertical-align: top; }
      table.info .lbl { font-weight: 700; width: 90px; white-space: nowrap; }
      table.info .val { width: auto; padding-right: 24px; }
      .section { font-weight: 700; font-size: 11px; margin: 16px 0 4px; }
      .desc { border: 1px solid #999; min-height: 60px; padding: 8px 10px; white-space: pre-line; font-size: 13px; }
      table.items { width: 100%; border-collapse: collapse; }
      table.items th, table.items td { border: 1px solid #999; padding: 5px 8px; font-size: 12px; text-align: left; }
      table.items .qty { width: 60px; text-align: left; }
      table.items thead th { font-weight: 700; }
      .sign { display: flex; justify-content: space-between; margin-top: 56px; }
      .sign div { width: 200px; border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 11px; }
      @media print { body { margin: 0; padding: 20px; } }
    </style></head><body>
    <div class="hdr">
      <div class="co">
        ${company.logo ? `<img src="${esc(company.logo)}" alt="">` : ""}
        <div>
          <div class="co-name">${esc(company.name || "")}</div>
          <div class="co-sub">${[company.reg, company.address, company.hotline ? "Tel: " + company.hotline : ""].filter(Boolean).map(esc).join("\n")}</div>
        </div>
      </div>
      <div class="title"><div class="t">SERVICE NOTE</div><div class="so">${order.so_number ? "SO " + esc(order.so_number) : ""}</div></div>
    </div>
    <table class="info">${infoRows}</table>
    <div class="section">DESCRIPTION</div>
    <div class="desc">${esc(svc.description || "")}</div>
    ${itemsBlock}
    <div class="sign"><div>Prepared by</div><div>Customer sign</div></div>
  </body></html>`;

  printHtml(html);
}

// Export the Service Note as a real .xlsx (ExcelJS, lazily imported).
async function exportServiceNoteExcel(detail, company = {}) {
  const ExcelJS = (await import("exceljs")).default;
  const svc = detail.service || {}, order = detail.order || {};
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Service Note", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 6 }, { width: 26 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 20 }];
  const thin = { style: "thin", color: { argb: "FF000000" } };
  const boxAll = { top: thin, left: thin, bottom: thin, right: thin };

  ws.mergeCells("A1:B3");
  const logoUrl = company.logo ? await toDataUrl(company.logo) : null;
  if (logoUrl) {
    const m = /^data:image\/(png|jpe?g|gif)/i.exec(logoUrl);
    const ext = m ? (m[1].toLowerCase() === "jpg" ? "jpeg" : m[1].toLowerCase()) : "png";
    ws.addImage(wb.addImage({ base64: logoUrl, extension: ext }), { tl: { col: 0, row: 0 }, ext: { width: 150, height: 54 } });
  }
  ws.mergeCells("C1:D1"); ws.getCell("C1").value = company.name || ""; ws.getCell("C1").font = { bold: true, size: 13 };
  ws.mergeCells("C2:F2"); ws.getCell("C2").value = company.address || ""; ws.getCell("C2").font = { size: 9 }; ws.getCell("C2").alignment = { wrapText: true };
  ws.getCell("C3").value = company.hotline ? `Tel: ${company.hotline}` : ""; ws.getCell("C3").font = { size: 9 };
  ws.getCell("E1").value = "SERVICE NOTE"; ws.getCell("E1").font = { bold: true, size: 14 }; ws.getCell("E1").alignment = { horizontal: "right" };
  ws.getCell("E3").value = order.so_number ? `SO ${order.so_number}` : ""; ws.getCell("E3").alignment = { horizontal: "right" };

  let r = 5;
  const info = (l1, v1, l2, v2) => {
    ws.getCell(`A${r}`).value = l1; ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:C${r}`); ws.getCell(`B${r}`).value = v1 ?? "";
    ws.getCell(`D${r}`).value = l2; ws.getCell(`D${r}`).font = { bold: true };
    ws.mergeCells(`E${r}:F${r}`); ws.getCell(`E${r}`).value = v2 ?? ""; r++;
  };
  info("Type", SERVICE_TYPES[svc.service_type] || `Type ${svc.service_type}`, "Status", svc.status);
  info("Customer", svc.customer_name || order.customer_name, "Service date", svc.service_date ? dmy(svc.service_date) : "");
  info("Contact", svc.customer_phone || order.contact, "Due date", svc.due_date ? dmy(svc.due_date) : "");
  info("Address", svc.customer_address || order.address, "Salesman", order.salesman);
  if (svc.amount != null && svc.amount !== "") {
    info("Amount", `RM ${Number(svc.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`, "", "");
  }
  // Description in its own bordered box spanning the sheet width.
  r++;
  ws.getCell(`A${r}`).value = "DESCRIPTION"; ws.getCell(`A${r}`).font = { bold: true }; r++;
  ws.mergeCells(`A${r}:F${r}`);
  const dcell = ws.getCell(`A${r}`);
  dcell.value = svc.description || "";
  dcell.alignment = { wrapText: true, vertical: "top" };
  dcell.border = boxAll;
  ws.getRow(r).height = 60;
  r++;

  // Items table — name + quantity only (no arrival date).
  const items = Array.isArray(detail.items) ? detail.items : [];
  if (items.length > 0) {
    r++;
    ws.getCell(`A${r}`).value = "ITEMS"; ws.getCell(`A${r}`).font = { bold: true }; r++;
    const cols = ["A", "B", "C", "D", "E", "F"];
    const writeRow = (name, qty, bold) => {
      ws.mergeCells(`A${r}:E${r}`);
      ws.getCell(`A${r}`).value = name; ws.getCell(`A${r}`).font = { bold: !!bold };
      ws.getCell(`F${r}`).value = qty; ws.getCell(`F${r}`).font = { bold: !!bold }; ws.getCell(`F${r}`).alignment = { horizontal: "right" };
      cols.forEach(c => ws.getCell(`${c}${r}`).border = boxAll);
      r++;
    };
    writeRow("Item", "Qty", true);
    for (const it of items) writeRow(it.description || "—", Number(it.quantity) || 1, false);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `ServiceNote_${(order.so_number || svc.id || "case")}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Full-detail view of a service approval request, with the approver's
// propose-a-date + approve / reject actions.
function RequestDetailModal({ req, isApprover, onApprove, onReject, onClose }) {
  const [date, setDate] = useState(req.schedule_tbc ? "" : (req.delivery_date || ""));
  const [tbc, setTbc] = useState(!!req.schedule_tbc);
  const items = Array.isArray(req.items) ? req.items : [];
  const Row = ({ label, value }) => value ? (
    <div className="flex gap-2 text-sm"><span className="text-gray-400 w-28 shrink-0">{label}</span><span className="text-gray-800">{value}</span></div>
  ) : null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">{TYPE_ICON[req.service_type] || "🔧"}</span>
            <h3 className="font-bold text-gray-900">{SERVICE_TYPES[req.service_type] || `Type ${req.service_type}`}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${req.status === "pending" ? "bg-amber-100 text-amber-700" : req.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{req.status}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="space-y-1.5">
            <Row label="SO number" value={req.so_number} />
            <Row label="Customer" value={req.customer_name} />
            <Row label="Contact" value={req.customer_phone} />
            <Row label="Address" value={req.customer_address} />
            <Row label="Requested by" value={req.requested_by_name} />
            <Row label="Amount" value={req.amount != null && req.amount !== "" ? `RM ${Number(req.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : ""} />
            <Row label="Requested date" value={req.service_date ? dmy(req.service_date) : ""} />
            <Row label="Wanted schedule" value={req.schedule_tbc ? "TBC" : (req.delivery_date ? dmy(req.delivery_date) : "")} />
            <Row label="Submitted" value={req.created_at ? new Date(req.created_at).toLocaleString("en-MY") : ""} />
          </div>
          {req.description && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Description</p>
              <p className="text-sm text-gray-800 whitespace-pre-line border border-gray-200 rounded-xl px-3 py-2">{req.description}</p>
            </div>
          )}
          {items.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Items ({items.length})</p>
              <div className="space-y-1">
                {items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-1.5">
                    <span className="text-gray-800">{it.description || "—"} <span className="text-gray-400">×{Number(it.quantity) || 1}</span></span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${it.arrival_date ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{it.arrival_date ? `arrives ${dmy(it.arrival_date)}` : "no arrival date"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {req.status === "rejected" && req.decision_note && <p className="text-xs text-red-500">Rejected: {req.decision_note}</p>}
          {isApprover && req.status === "pending" && (
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Schedule date <span className="text-gray-400">(propose another date if needed)</span></p>
              <div className="flex items-center gap-2">
                <input type="date" value={tbc ? "" : date} disabled={tbc}
                  onChange={e => setDate(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400 disabled:bg-gray-100 disabled:text-gray-400" />
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={tbc} onChange={e => setTbc(e.target.checked)} /> TBC
                </label>
              </div>
            </div>
          )}
        </div>
        {isApprover && req.status === "pending" && (
          <div className="px-6 py-4 border-t flex gap-3 justify-end shrink-0">
            <button onClick={() => onReject(req.id)} className="px-4 py-2 text-sm rounded-xl border border-red-200 text-red-600 hover:bg-red-50">Reject</button>
            <button onClick={() => onApprove(req.id, { deliveryDate: tbc ? "" : date })} className="px-5 py-2 text-sm rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700">Approve{!tbc && date && date !== (req.delivery_date || "") ? " with new date" : ""}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ServicePage() {
  const { user, activeCompanyId } = useAuth();
  const toast = useToast();
  const { withLoading } = useLoading();
  const companyId = activeCompanyId || user?.company_id;

  // Approvers (same set as delivery-date approvers) can create service cases
  // directly; everyone else (salesmen) submits a request for approval.
  const role = (user?.base_role || user?.role || "").toLowerCase();
  const isApprover = ["master", "manager", "operation_manager", "company_admin"].includes(role);

  const [services, setServices] = useState([]);
  const [pending, setPending] = useState([]);
  const [requests, setRequests] = useState([]); // service approval requests
  const [reqDetail, setReqDetail] = useState(null); // service request open in the detail modal
  const [tab, setTab] = useState("cases"); // "cases" | "delivery" | "pending" | "requests"
  const [loading, setLoading] = useState(true);
  const [statusGroup, setStatusGroup] = useState("open"); // open (default) | scheduled | resolved
  const [filterArrival, setFilterArrival] = useState(""); // "" | "with" | "without"
  const [dateFrom, setDateFrom] = useState(""); // scheduled-date range (svc.due_date)
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const [company, setCompany] = useState({}); // header/logo for the printed/exported Service Note
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [convertModal, setConvertModal] = useState(null);
  const [convertRemark, setConvertRemark] = useState("");

  // Edit form for an existing case's header (null = not editing).
  const [editForm, setEditForm] = useState(null);
  const saveEdit = async () => {
    if (!editForm) return;
    await updateService(editForm.id, {
      service_type: Number(editForm.service_type),
      customer_name: editForm.customer_name || null,
      customer_phone: editForm.customer_phone || null,
      customer_address: editForm.customer_address || null,
      description: editForm.description || null,
      amount: editForm.amount === "" || editForm.amount == null ? "" : editForm.amount,
    });
    setEditForm(null);
  };

  // Create form
  const [createForm, setCreateForm] = useState({ order_id: "", service_type: 1, description: "", service_date: new Date().toISOString().slice(0, 10), delivery_date: "", schedule_tbc: false, amount: "", customer_name: "", customer_phone: "", customer_address: "" });
  const [orderSearch, setOrderSearch] = useState("");
  const [orderResults, setOrderResults] = useState([]);
  // Line items entered while creating a case (added later via the detail drawer).
  const [createItems, setCreateItems] = useState([]);

  const [suppliers, setSuppliers] = useState([]); // eslint-disable-line

  const loadServices = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    // Load all cases and group client-side, so switching status tabs is instant.
    const res = await af(`${API}/service-cases?company_id=${companyId}`);
    const d = await res.json();
    setServices(d.services || []);
    setLoading(false);
  }, [companyId]);

  const loadPending = useCallback(async () => {
    if (!companyId) return;
    const res = await af(`${API}/service-pending?company_id=${companyId}`);
    const d = await res.json();
    setPending(Array.isArray(d) ? d : []);
  }, [companyId]);

  const loadRequests = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await af(`${API}/service-requests?company_id=${companyId}`);
      const d = await res.json();
      setRequests(Array.isArray(d.requests) ? d.requests : []);
    } catch { /* non-fatal */ }
  }, [companyId]);

  useEffect(() => { loadServices(); loadPending(); loadRequests(); }, [loadServices, loadPending, loadRequests]);
  useEffect(() => {
    if (!companyId) return;
    af(`${API}/company-settings?company_id=${companyId}`).then(r => r.json()).then(d => {
      if (d.settings) setCompany({ name: d.settings.company_name || "", address: d.settings.address || "", hotline: d.settings.hotline || "", logo: d.settings.logo_url || "" });
    }).catch(() => {});
  }, [companyId]);
  useEffect(() => {
    if (companyId) af(`${API}/suppliers?company_id=${companyId}`).then(r => r.json()).then(d => setSuppliers(d.suppliers || []));
  }, [companyId]);

  const openDetail = async (svc) => {
    setDetailLoading(true);
    const res = await af(`${API}/service-cases/${svc.id}`);
    const d = await res.json();
    setDetail(d);
    setDetailLoading(false);
  };

  const searchOrders = async (q) => {
    setOrderSearch(q);
    if (q.length < 2) { setOrderResults([]); return; }
    // Search real (non-Service) orders to link to, server-side.
    const res = await af(`${API}/orders?search=${encodeURIComponent(q)}${companyId ? `&company_id=${companyId}` : ""}`);
    const all = await res.json();
    setOrderResults((Array.isArray(all) ? all : []).slice(0, 10));
  };

  const resetCreate = () => { setShowCreate(false); setOrderSearch(""); setCreateItems([]); setCreateForm({ order_id: "", service_type: 1, description: "", service_date: new Date().toISOString().slice(0, 10), delivery_date: "", schedule_tbc: false, amount: "", customer_name: "", customer_phone: "", customer_address: "" }); };
  const createService = async () => {
    try {
      await withLoading(isApprover ? "Creating service case…" : "Submitting request…", async () => {
        const items = createItems
          .filter(i => String(i.description || "").trim())
          .map(i => ({ description: i.description.trim(), action_type: Number(i.action_type) || 2, quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1, arrival_date: i.arrival_date || null }));
        // Approvers create the case directly; salesmen submit a request that a
        // PIC must approve before the case (and its delivery legs) exist.
        const endpoint = isApprover ? "service-cases" : "service-requests";
        const res = await af(`${API}/${endpoint}`, { method: "POST", body: JSON.stringify({ ...createForm, items }) });
        const d = await res.json();
        if (isApprover ? !d.service : !d.request) throw new Error(d.error || "Failed");
        toast.success(isApprover ? "Service case created" : "Service request submitted for approval");
        resetCreate();
        if (isApprover) loadServices(); else { loadRequests(); setTab("requests"); }
      });
    } catch (e) { toast.error(e.message); }
  };

  const decideRequest = async (id, action, opts = {}) => {
    let note = opts.note ?? null;
    if (action === "reject" && note == null) { note = window.prompt("Reason for rejecting (optional):") ?? null; }
    try {
      await withLoading(action === "approve" ? "Approving…" : "Rejecting…", async () => {
        const payload = { note };
        // Approver may propose another schedule date at approval. delivery_date
        // present (even "") tells the backend to override; "" => schedule TBC.
        if (action === "approve" && opts.deliveryDate !== undefined) payload.delivery_date = opts.deliveryDate;
        const res = await af(`${API}/service-requests/${id}/${action}`, { method: "PATCH", body: JSON.stringify(payload) });
        const d = await res.json();
        if (!d.request) throw new Error(d.error || "Failed");
        toast.success(action === "approve" ? "Approved — service case created" : "Request rejected");
        setReqDetail(null);
        loadRequests(); if (action === "approve") loadServices();
      });
    } catch (e) { toast.error(e.message); }
  };

  // ── Service items (per-case line items with their own action + status) ──
  const addServiceItem = async (serviceId) => {
    const description = window.prompt("Item description (e.g. Dining chair):");
    if (!description || !description.trim()) return;
    try {
      await withLoading("Adding item…", async () => {
        await af(`${API}/service-cases/${serviceId}/items`, { method: "POST", body: JSON.stringify({ description: description.trim(), action_type: 2, quantity: 1 }) });
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to add item: " + e.message); }
  };

  const updateServiceItem = async (itemId, updates) => {
    try {
      await withLoading("Updating item…", async () => {
        await af(`${API}/service-items/${itemId}`, { method: "PATCH", body: JSON.stringify(updates) });
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to update item: " + e.message); }
  };

  const deleteServiceItem = async (itemId) => {
    if (!window.confirm("Remove this item?")) return;
    try {
      await withLoading("Removing item…", async () => {
        await af(`${API}/service-items/${itemId}`, { method: "DELETE" });
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to remove item: " + e.message); }
  };

  const updateServiceStatus = async (id, status) => {
    try {
      await withLoading("Updating status…", async () => {
        await af(`${API}/service-cases/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
        loadServices();
        if (detail?.service?.id === id) openDetail(detail.service);
      });
    } catch (e) { toast.error("Failed to update: " + e.message); }
  };

  const updateLeg = async (legId, updates) => {
    try {
      await withLoading("Updating…", async () => {
        await af(`${API}/service-legs/${legId}`, { method: "PATCH", body: JSON.stringify(updates) });
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to update: " + e.message); }
  };

  // Patch arbitrary service-case fields (creation date, schedule date, TBC, …)
  const updateService = async (id, fields) => {
    try {
      await withLoading("Updating…", async () => {
        const res = await af(`${API}/service-cases/${id}`, { method: "PATCH", body: JSON.stringify(fields) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Update failed"); }
        if (detail?.service) openDetail(detail.service);
        loadServices();
      });
    } catch (e) { toast.error("Failed to update: " + e.message); }
  };

  const addClaim = async (serviceId) => {
    const partName = window.prompt("Part name / description:");
    if (!partName) return;
    try {
      await withLoading("Adding claim…", async () => {
        await af(`${API}/service-part-claims`, { method: "POST", body: JSON.stringify({ service_id: serviceId, part_name: partName }) });
      });
      toast.success("Claim added");
      openDetail(detail.service);
    } catch (e) { toast.error("Failed to add claim: " + e.message); }
  };

  const updateClaim = async (claimId, updates) => {
    try {
      await withLoading("Updating claim…", async () => {
        await af(`${API}/service-part-claims/${claimId}`, { method: "PATCH", body: JSON.stringify(updates) });
        if (detail?.service) openDetail(detail.service);
      });
    } catch (e) { toast.error("Failed to update claim: " + e.message); }
  };

  const deleteService = async (id) => {
    if (!window.confirm("Delete this service case? This will also remove all legs and part claims.")) return;
    try {
      await withLoading("Deleting service case…", async () => {
        const res = await af(`${API}/service-cases/${id}`, { method: "DELETE" });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to delete"); }
        toast.success("Service case deleted"); setDetail(null); loadServices();
      });
    } catch (e) { toast.error(e.message); }
  };

  const convertPending = async (sp) => {
    try {
      await withLoading("Creating service case…", async () => {
        const res = await af(`${API}/service-pending/${sp.id}/convert`, {
          method: "POST", body: JSON.stringify({ remark: convertRemark, service_type: 1 }),
        });
        const d = await res.json();
        if (!d.service) throw new Error(d.error || "Failed to convert");
        toast.success("Service case created"); setConvertModal(null); setConvertRemark(""); loadServices(); loadPending();
      });
    } catch (e) { toast.error(e.message); }
  };

  const removePending = async (id) => {
    if (!window.confirm("Remove this pending service?")) return;
    try {
      await withLoading("Removing…", async () => {
        const res = await af(`${API}/service-pending/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to remove");
        toast.success("Removed"); loadPending();
      });
    } catch (e) { toast.error(e.message); }
  };

  const q = search.trim().toLowerCase();
  const matchesArrival = (svc) => {
    if (!filterArrival) return true;
    const items = svc._items || [];
    if (items.length === 0) return false; // no items → neither "with" nor "without"
    // "with"  = the case has at least one item WITH an arrival date
    // "without" = the case has at least one item WITHOUT an arrival date
    // (a mixed case matches both.)
    return filterArrival === "with"
      ? items.some(it => !!it.arrival_date)
      : items.some(it => !it.arrival_date);
  };
  // Scheduled-date range filter — on the case's due_date (the date the work is
  // scheduled for). A case with no due_date is excluded once a range is set.
  const matchesDate = (svc) => {
    if (!dateFrom && !dateTo) return true;
    const d = (svc.due_date || "").slice(0, 10);
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };
  const matchesSearch = (svc) => !q || [
    svc._order?.so_number, svc.orders?.so_number,
    svc._order?.customer_name, svc.orders?.customer_name, svc.customer_name,
    svc.description, svc.customer_phone, svc._order?.contact,
    svc._assigned?.name, svc.assigned?.name, SERVICE_TYPES[svc.service_type], svc._sv_number,
  ].filter(Boolean).join(" ").toLowerCase().includes(q);
  // Plain "Delivery" (service_type 5) is split into its own Delivery tab —
  // distinct from "Delivery (Missing Item)" (type 4), which stays a service
  // case. The Service Cases tab excludes type 5; the Delivery tab shows only
  // type 5. Both share the same status sub-tabs, search and arrival filter.
  const isPlainDelivery = (svc) => Number(svc.service_type) === 5;
  const typeScope = (svc) => (tab === "delivery" ? isPlainDelivery(svc) : !isPlainDelivery(svc));
  // Count per status group (type scope + search + arrival applied, group not)
  // so the sub-tab badges reflect what the active tab would show.
  const groupCounts = services.reduce((acc, svc) => {
    if (typeScope(svc) && matchesArrival(svc) && matchesDate(svc) && matchesSearch(svc)) acc[groupOf(svc.status)] = (acc[groupOf(svc.status)] || 0) + 1;
    return acc;
  }, {});
  const filteredServices = services.filter(svc =>
    typeScope(svc) && groupOf(svc.status) === statusGroup && matchesArrival(svc) && matchesDate(svc) && matchesSearch(svc));
  // Top-tab badges — current status group, per type scope (independent of which
  // tab is active so both badges are always right).
  const casesBadge = services.filter(svc => !isPlainDelivery(svc) && groupOf(svc.status) === statusGroup && matchesArrival(svc) && matchesDate(svc) && matchesSearch(svc)).length;
  const deliveryBadge = services.filter(svc => isPlainDelivery(svc) && groupOf(svc.status) === statusGroup && matchesArrival(svc) && matchesDate(svc) && matchesSearch(svc)).length;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">Services</h1>
        <div className="flex gap-2 flex-wrap">
          {(tab === "cases" || tab === "delivery") && (
            <>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SO, customer, description..."
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-56 focus:outline-none focus:border-violet-400" />
              <select value={filterArrival} onChange={e => setFilterArrival(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                <option value="">All Arrival</option>
                <option value="with">With arrival date</option>
                <option value="without">Without arrival date</option>
              </select>
              <div className="flex items-center gap-1">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Scheduled from"
                  className="px-2 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400" />
                <span className="text-xs text-gray-400">–</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Scheduled to"
                  className="px-2 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400" />
                {(dateFrom || dateTo) && (
                  <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-gray-400 hover:text-gray-600 px-1" title="Clear dates">✕</button>
                )}
              </div>
            </>
          )}
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">+ New Service Case</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab("cases")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === "cases" ? "bg-violet-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-violet-300"}`}>
          Service Cases {casesBadge > 0 && <span className="ml-1 text-xs opacity-75">({casesBadge})</span>}
        </button>
        <button onClick={() => setTab("delivery")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === "delivery" ? "bg-violet-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-violet-300"}`}>
          🚚 Delivery {deliveryBadge > 0 && <span className="ml-1 text-xs opacity-75">({deliveryBadge})</span>}
        </button>
        <button onClick={() => setTab("pending")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === "pending" ? "bg-amber-500 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-amber-300"}`}>
          Pending {pending.length > 0 && <span className="ml-1 bg-red-100 text-red-700 text-xs font-bold px-1.5 rounded-full">{pending.length}</span>}
        </button>
        {(() => {
          const pendingReqs = requests.filter(r => r.status === "pending").length;
          return (
            <button onClick={() => setTab("requests")} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === "requests" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-blue-300"}`}>
              {isApprover ? "Approvals" : "My Requests"}
              {pendingReqs > 0 && <span className="ml-1 bg-red-100 text-red-700 text-xs font-bold px-1.5 rounded-full">{pendingReqs}</span>}
            </button>
          );
        })()}
      </div>

      {/* Status-group sub-tabs — Open (default) / Scheduled / Resolved. */}
      {(tab === "cases" || tab === "delivery") && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {STATUS_TABS.map(([key, label]) => (
            <button key={key} onClick={() => setStatusGroup(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusGroup === key ? "bg-white text-violet-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {label}<span className="ml-1.5 text-xs opacity-70">{groupCounts[key] || 0}</span>
            </button>
          ))}
        </div>
      )}

      {/* Pending tab */}
      {tab === "pending" && (
        <div className="space-y-2">
          {pending.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-medium">No pending services</p>
              <p className="text-xs mt-1">Service complaints from orders will appear here</p>
            </div>
          )}
          {pending.map(sp => (
            <div key={sp.id} className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-violet-700 text-sm">SO {sp.so_number}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Pending</span>
                  </div>
                  <p className="text-sm text-gray-800 mt-1">{sp.customer_name}</p>
                  {sp.remark && <p className="text-xs text-gray-500 mt-0.5">{sp.remark}</p>}
                  <p className="text-xs text-gray-400 mt-1">{sp.created_at ? new Date(sp.created_at).toLocaleDateString("en-MY") : ""}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => removePending(sp.id)} className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-xl hover:bg-red-50">Remove</button>
                  <button onClick={() => { setConvertModal(sp); setConvertRemark(""); }} className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-xl hover:bg-amber-600">Create Case</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Requests tab — approvers see the queue with Approve/Reject; salesmen
          see their own submissions with status. */}
      {tab === "requests" && (
        <div className="space-y-2">
          {requests.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">📝</div>
              <p className="font-medium">{isApprover ? "No service requests" : "You haven't submitted any requests"}</p>
              <p className="text-xs mt-1">{isApprover ? "Salesman-submitted service requests will appear here for approval" : 'Click "+ New Service Case" to submit one for approval'}</p>
            </div>
          )}
          {requests.map(r => {
            const stBadge = r.status === "pending" ? "bg-amber-100 text-amber-700" : r.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500";
            return (
              <div key={r.id} onClick={() => setReqDetail(r)} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:border-violet-200 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg">{TYPE_ICON[r.service_type] || "🔧"}</span>
                      <span className="font-bold text-gray-900 text-sm">{SERVICE_TYPES[r.service_type] || `Type ${r.service_type}`}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stBadge}`}>{r.status}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.so_number && <span className="text-violet-600 font-medium">{r.so_number} · </span>}
                      {r.customer_name || "No customer"}
                      {r.requested_by_name && <span className="ml-2 text-gray-400">· by {r.requested_by_name}</span>}
                    </p>
                    {r.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-md">{r.description}</p>}
                    {(r.items || []).length > 0 && <p className="text-[11px] text-gray-400 mt-0.5">{r.items.length} item(s){r.delivery_date ? ` · date ${r.delivery_date}` : r.schedule_tbc ? " · TBC" : ""}</p>}
                    {r.status === "rejected" && r.decision_note && <p className="text-xs text-red-500 mt-1">Rejected: {r.decision_note}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-xs text-gray-400">{r.created_at ? new Date(r.created_at).toLocaleDateString("en-MY") : ""}</span>
                    {isApprover && r.status === "pending" && (
                      <div className="flex gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setReqDetail(r); }} className="text-xs px-3 py-1.5 rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-50 font-medium">Review</button>
                        <button onClick={(e) => { e.stopPropagation(); decideRequest(r.id, "reject"); }} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Reject</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Service list (Service Cases + Delivery tabs share this list) */}
      {(tab === "cases" || tab === "delivery") && loading && <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}
      {(tab === "cases" || tab === "delivery") && !loading && filteredServices.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">{tab === "delivery" ? "🚚" : "🔧"}</div>
          <p className="font-medium">No {statusGroup} {tab === "delivery" ? "deliveries" : "service cases"}{q || filterArrival || dateFrom || dateTo ? " match" : ""}</p>
          <p className="text-xs mt-1">{q || filterArrival || dateFrom || dateTo ? "Try a different search, date, or arrival filter, or switch tab" : `${tab === "delivery" ? "Deliveries" : "Cases"} in the ${statusGroup} stage will appear here`}</p>
        </div>
      )}
      {(tab === "cases" || tab === "delivery") && <div className="space-y-2">
        {filteredServices.map(svc => (
          <div key={svc.id} onClick={() => openDetail(svc)}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-violet-200 cursor-pointer transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{TYPE_ICON[svc.service_type] || "🔧"}</span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {svc._sv_number && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700">{svc._sv_number}</span>}
                    <span className="font-bold text-gray-900 text-sm">{SERVICE_TYPES[svc.service_type] || `Type ${svc.service_type}`}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[svc.status] || "bg-gray-100"}`}>{svc.status}</span>
                    {svc.source === "legacy_order" && <span className="px-1.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">Legacy</span>}
                    {svc.source === "service_pending" && <span className="px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-600">From pending</span>}
                    {svc.priority === "urgent" && <span className="px-1.5 py-0.5 rounded-full text-xs bg-red-100 text-red-600">Urgent</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {(svc._order?.so_number || svc.orders?.so_number) && <span className="text-violet-600 font-medium">{svc._order?.so_number || svc.orders?.so_number} · </span>}
                    {svc._order?.customer_name || svc.orders?.customer_name || svc.customer_name || "No order linked"}
                    {(svc._order?.salesman || svc.orders?.salesman) && <span className="ml-2 text-gray-400">· {svc._order?.salesman || svc.orders?.salesman}</span>}
                    {(svc._assigned?.name || svc.assigned?.name) && <span className="ml-2 text-gray-400">→ {svc._assigned?.name || svc.assigned?.name}</span>}
                  </p>
                  {svc.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{svc.description}</p>}
                  {/* Legs — one chip per leg, coloured by status, with its
                      scheduled date where set. */}
                  {(svc._legs || []).length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1.5">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Legs</span>
                      {svc._legs.map(leg => (
                        <span key={leg.id} className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${LEG_STATUS[leg.status] || "bg-gray-100 text-gray-600"}`}>
                          Leg {leg.leg_order} · {String(leg.status || "").replace("_", " ")}{(leg.scheduled_at || leg.scheduled_date) ? ` · ${dmy(leg.scheduled_at || leg.scheduled_date)}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Arrival dates — one chip per item (green when the item has an
                      arrival date, grey when still awaiting arrival). */}
                  {(svc._items || []).length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Arrival</span>
                      {svc._items.map(it => (
                        <span key={it.id} className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${it.arrival_date ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                          {it.description}{it.arrival_date ? ` · ${dmy(it.arrival_date)}` : " · no date"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {svc.amount != null && svc.amount !== "" && (
                  <span className="text-sm font-bold text-gray-800">RM {Number(svc.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                )}
                <span className="text-xs text-gray-400">{svc.created_at ? new Date(svc.created_at).toLocaleDateString("en-MY") : ""}</span>
              </div>
            </div>
          </div>
        ))}
      </div>}

      {/* Convert Pending Modal */}
      {convertModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-bold text-gray-900">Create Service Case</h3>
              <p className="text-xs text-gray-500 mt-0.5">From <b>SO {convertModal.so_number}</b> — {convertModal.customer_name}</p>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Remark / Issue</label>
                <textarea value={convertRemark} onChange={e => setConvertRemark(e.target.value)} rows={3}
                  placeholder="Describe the issue..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setConvertModal(null)} className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={() => convertPending(convertModal)} className="px-5 py-2 text-sm rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600">Create Case</button>
            </div>
          </div>
        </div>
      )}

      {/* Service request detail / approval modal */}
      {reqDetail && (
        <RequestDetailModal
          req={reqDetail}
          isApprover={isApprover}
          onApprove={(id, opts) => decideRequest(id, "approve", opts)}
          onReject={(id) => decideRequest(id, "reject")}
          onClose={() => setReqDetail(null)}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
              <h3 className="font-bold text-gray-900">New Service Case</h3>
              <button onClick={() => setShowCreate(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Service Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(SERVICE_TYPES).map(([k, v]) => (
                    <button key={k} onClick={() => setCreateForm(f => ({ ...f, service_type: Number(k) }))}
                      className={`py-2.5 rounded-xl text-xs font-medium border transition-colors ${createForm.service_type === Number(k) ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200"}`}>
                      {TYPE_ICON[k]} {v.split("/")[0]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Link to Order (optional)</label>
                {createForm.order_id ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-sm">
                    <span className="text-violet-700 font-medium truncate">{orderSearch || "Order linked"}</span>
                    <button onClick={() => { setCreateForm(f => ({ ...f, order_id: "" })); setOrderSearch(""); }}
                      className="ml-2 text-xs text-gray-500 hover:text-gray-700 shrink-0">Clear</button>
                  </div>
                ) : (
                  <input value={orderSearch} onChange={e => searchOrders(e.target.value)} placeholder="Search SO number or customer..."
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                )}
                {!createForm.order_id && orderResults.length > 0 && (
                  <div className="border border-gray-200 rounded-xl mt-1 max-h-32 overflow-y-auto">
                    {orderResults.map(o => (
                      <button key={o.id} onClick={() => { setCreateForm(f => ({ ...f, order_id: o.id, customer_name: "", customer_phone: "", customer_address: "" })); setOrderSearch(`${o.so_number} — ${o.customer_name}`); setOrderResults([]); }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-violet-50">
                        <span className="font-bold text-violet-700">{o.so_number}</span> {o.customer_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* No linked order → capture customer details directly (backend stores
                  them on the service + its inert delivery order). */}
              {!createForm.order_id && (
                <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">Customer details</p>
                  <input value={createForm.customer_name} onChange={e => setCreateForm(f => ({ ...f, customer_name: e.target.value }))}
                    placeholder="Customer name"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  <input value={createForm.customer_phone} onChange={e => setCreateForm(f => ({ ...f, customer_phone: e.target.value }))}
                    placeholder="Contact number"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  <textarea value={createForm.customer_address} onChange={e => setCreateForm(f => ({ ...f, customer_address: e.target.value }))}
                    placeholder="Address" rows={2}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                <textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What's the issue? What needs to be done?" rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              </div>
              {/* Line items — one row per thing to do, each with its own action.
                  Optional at creation; can also be added from the detail drawer. */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-500">Items (optional)</label>
                  <button type="button" onClick={() => setCreateItems(a => [...a, { description: "", action_type: 2, quantity: 1 }])}
                    className="text-xs px-2 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Item</button>
                </div>
                {createItems.length === 0 ? (
                  <p className="text-xs text-gray-400">No items — you can also add them after creating the case.</p>
                ) : (
                  <div className="space-y-2">
                    {createItems.map((it, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-4 text-right">{i + 1}.</span>
                          <input value={it.description} onChange={e => setCreateItems(a => a.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
                            placeholder="e.g. Dining chair"
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                          <select value={it.action_type} onChange={e => setCreateItems(a => a.map((x, idx) => idx === i ? { ...x, action_type: Number(e.target.value) } : x))}
                            className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white shrink-0">
                            {Object.entries(ITEM_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          <input type="number" min="1" value={it.quantity} onChange={e => setCreateItems(a => a.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))}
                            className="w-12 px-1.5 py-1.5 rounded-lg border border-gray-200 text-xs text-center shrink-0" />
                          <button type="button" onClick={() => setCreateItems(a => a.filter((_, idx) => idx !== i))}
                            className="text-gray-300 hover:text-red-500 text-base px-1 shrink-0">×</button>
                        </div>
                        {/* Arrival date for any item whose part/stock must arrive
                            before it can be delivered (not just Claim items). */}
                        <div className="flex items-center gap-2 pl-6">
                          <span className="text-xs text-gray-400">Arrival date</span>
                          <input type="date" value={it.arrival_date || ""} onChange={e => setCreateItems(a => a.map((x, idx) => idx === i ? { ...x, arrival_date: e.target.value } : x))}
                            className="px-2 py-1 rounded-lg border border-gray-200 text-xs" />
                          <span className="text-xs text-gray-400">optional — leave blank until the item arrives</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Service Creation Date</label>
                  <input type="date" value={createForm.service_date} onChange={e => setCreateForm(f => ({ ...f, service_date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Schedule Date</label>
                  <input type="date" value={createForm.schedule_tbc ? "" : createForm.delivery_date} disabled={createForm.schedule_tbc}
                    onChange={e => setCreateForm(f => ({ ...f, delivery_date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400 disabled:bg-gray-100 disabled:text-gray-400" />
                  <label className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" checked={createForm.schedule_tbc} onChange={e => setCreateForm(f => ({ ...f, schedule_tbc: e.target.checked }))} />
                    TBC — hidden from delivery route
                  </label>
                </div>
              </div>
              {Number(createForm.service_type) === 5 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount <span className="text-gray-400">(RM)</span></label>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={createForm.amount}
                    onChange={e => setCreateForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end shrink-0">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={createService} className="px-5 py-2 text-sm rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700">{isApprover ? "Create" : "Submit for approval"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">
            {detailLoading ? (
              <div className="px-6 py-4 space-y-4 animate-pulse"><div className="flex gap-3"><div className="w-12 h-12 bg-gray-200 rounded-full" /><div className="flex-1 space-y-2"><div className="h-4 bg-gray-200 rounded w-1/3" /><div className="h-3 bg-gray-100 rounded w-1/2" /></div></div>{[1,2,3].map(i=><div key={i} className="h-16 bg-gray-50 rounded-xl" />)}</div>
            ) : (
              <>
                <div className="sticky top-0 bg-white border-b px-6 py-4 z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{TYPE_ICON[detail.service?.service_type]}</span>
                      <div>
                        <h2 className="font-bold text-gray-900">{SERVICE_TYPES[detail.service?.service_type]}</h2>
                        <p className="text-xs text-gray-500">{[detail.order?.so_number, detail.order?.customer_name].filter(Boolean).join(" · ")}</p>
                        {detail.service?.amount != null && detail.service?.amount !== "" && (
                          <p className="text-sm font-bold text-gray-800 mt-0.5">RM {Number(detail.service.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => printServiceNote(detail, company)} title="Print / Save as PDF (supports Chinese)"
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">📄 PDF</button>
                      <button onClick={() => exportServiceNoteExcel(detail, company)} title="Download as Excel"
                        className="text-xs px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50">⬇ Excel</button>
                      <button onClick={() => setDetail(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 space-y-5">
                  {/* Status + actions */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLE[detail.service?.status]}`}>{detail.service?.status}</span>
                    <select value={detail.service?.status} onChange={e => updateServiceStatus(detail.service.id, e.target.value)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white">
                      {Object.keys(STATUS_STYLE).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => setEditForm({ id: detail.service.id, service_type: detail.service.service_type || 1, customer_name: detail.service.customer_name || detail.order?.customer_name || "", customer_phone: detail.service.customer_phone || "", customer_address: detail.service.customer_address || "", description: detail.service.description || "", amount: detail.service.amount != null ? String(detail.service.amount) : "" })}
                      className="ml-auto text-xs px-3 py-1 rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-50">✏️ Edit</button>
                    <button onClick={() => deleteService(detail.service.id)}
                      className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">Delete</button>
                  </div>

                  {/* Edit header form */}
                  {editForm && editForm.id === detail.service?.id && (
                    <div className="border border-violet-200 bg-violet-50/40 rounded-xl p-3 space-y-2.5">
                      <p className="text-xs font-bold text-violet-700">EDIT SERVICE</p>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Type</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {Object.entries(SERVICE_TYPES).map(([k, v]) => (
                            <button key={k} type="button" onClick={() => setEditForm(f => ({ ...f, service_type: Number(k) }))}
                              className={`py-1.5 rounded-lg text-[11px] font-medium border ${Number(editForm.service_type) === Number(k) ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200"}`}>{v}</button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="block text-[11px] font-medium text-gray-500 mb-1">Customer name</label>
                          <input value={editForm.customer_name} onChange={e => setEditForm(f => ({ ...f, customer_name: e.target.value }))} className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200" /></div>
                        <div><label className="block text-[11px] font-medium text-gray-500 mb-1">Phone</label>
                          <input value={editForm.customer_phone} onChange={e => setEditForm(f => ({ ...f, customer_phone: e.target.value }))} className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200" /></div>
                      </div>
                      <div><label className="block text-[11px] font-medium text-gray-500 mb-1">Address</label>
                        <input value={editForm.customer_address} onChange={e => setEditForm(f => ({ ...f, customer_address: e.target.value }))} className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200" /></div>
                      <div><label className="block text-[11px] font-medium text-gray-500 mb-1">Description</label>
                        <textarea rows={2} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200" /></div>
                      {Number(editForm.service_type) === 5 && (
                        <div><label className="block text-[11px] font-medium text-gray-500 mb-1">Amount (RM)</label>
                          <input type="number" min="0" step="0.01" inputMode="decimal" value={editForm.amount} placeholder="0.00"
                            onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200" /></div>
                      )}
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setEditForm(null)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
                        <button onClick={saveEdit} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 font-medium">Save</button>
                      </div>
                    </div>
                  )}

                  {/* Dates: creation + schedule */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">CREATION DATE</label>
                      <input type="date" value={(detail.service?.service_date || "").slice(0, 10)}
                        onChange={e => updateService(detail.service.id, { service_date: e.target.value || null })}
                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">SCHEDULE DATE</label>
                      <input type="date" value={(detail.service?.due_date || "").slice(0, 10)}
                        disabled={detail.service?.schedule_tbc}
                        onChange={e => updateService(detail.service.id, { delivery_date: e.target.value || null, schedule_tbc: false })}
                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 disabled:bg-gray-100" />
                      <label className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
                        <input type="checkbox" checked={!!detail.service?.schedule_tbc}
                          onChange={e => updateService(detail.service.id, { schedule_tbc: e.target.checked })} />
                        To be confirmed (TBC)
                      </label>
                    </div>
                  </div>

                  {/* Description */}
                  {detail.service?.description && (
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-xs font-bold text-gray-500 mb-1">DESCRIPTION</p>
                      <p className="text-sm text-gray-700">{detail.service.description}</p>
                    </div>
                  )}

                  {/* Items — the work list for this visit, each with its own
                      action + done/pending status. Mirrored to the delivery
                      schedule print server-side. */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-gray-500">ITEMS ({(detail.items || []).length})</p>
                      <button onClick={() => addServiceItem(detail.service.id)} className="text-xs px-3 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Item</button>
                    </div>
                    {(detail.items || []).length === 0 && <p className="text-xs text-gray-400">No items yet</p>}
                    <div className="space-y-2">
                      {(detail.items || []).map((it, idx) => (
                        <div key={it.id} className="bg-white border border-gray-200 rounded-xl p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-gray-400 mr-1">{idx + 1}.</span>
                              <span className="text-sm font-medium text-gray-900">{it.description}</span>
                              {Number(it.quantity) > 1 && <span className="text-xs text-gray-400 ml-1">× {Number(it.quantity)}</span>}
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${it.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                              {it.status === "done" ? "✓ Done" : "Pending"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <select value={it.action_type} onChange={e => updateServiceItem(it.id, { action_type: Number(e.target.value) })}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white">
                              {Object.entries(ITEM_ACTIONS).map(([k, v]) => <option key={k} value={k}>{ITEM_ACTION_ICON[k]} {v}</option>)}
                            </select>
                            <button onClick={() => updateServiceItem(it.id, { status: it.status === "done" ? "pending" : "done" })}
                              className={`text-xs px-3 py-1 rounded-lg ${it.status === "done" ? "bg-gray-100 text-gray-600" : "bg-emerald-600 text-white"}`}>
                              {it.status === "done" ? "Mark pending" : "Mark done"}
                            </button>
                            <button onClick={() => deleteServiceItem(it.id)} className="text-xs px-2 py-1 rounded-lg text-red-500 hover:bg-red-50 ml-auto">Remove</button>
                          </div>
                          {/* Arrival date for any item whose part/stock must
                              arrive before delivery — record it here. */}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className="text-xs font-medium text-gray-500">Arrival</span>
                            <input type="date" value={(it.arrival_date || "").slice(0, 10)}
                              onChange={e => updateServiceItem(it.id, { arrival_date: e.target.value || null })}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200" />
                            {it.arrival_date
                              ? <span className="text-xs text-emerald-600 font-medium">✓ Arrived</span>
                              : <span className="text-xs text-gray-400">No arrival date set</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Customer info */}
                  {detail.order && (
                    <div className="bg-violet-50 rounded-xl p-3 space-y-1">
                      <p className="text-xs font-bold text-violet-600">CUSTOMER</p>
                      <p className="text-sm font-medium text-gray-900">{detail.order.customer_name}</p>
                      {detail.order.contact && <p className="text-xs text-gray-600">{detail.order.contact}</p>}
                      {detail.order.address && <p className="text-xs text-gray-500">{detail.order.address}</p>}
                      {detail.order.salesman && <p className="text-xs text-gray-500 pt-1">Salesman: <span className="font-medium text-gray-700">{detail.order.salesman}</span></p>}
                    </div>
                  )}

                  {/* Service Legs */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 mb-2">SERVICE LEGS ({(detail.legs || []).length})</p>
                    <div className="space-y-2">
                      {(detail.legs || []).map(leg => (
                        <div key={leg.id} className="bg-white border border-gray-200 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500">Leg {leg.leg_order}</span>
                              <span className="text-xs text-gray-700">{leg.from_location} → {leg.to_location}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEG_STATUS[leg.status] || "bg-gray-100"}`}>{leg.status}</span>
                          </div>
                          {leg.notes && <p className="text-xs text-gray-400 mb-1">{leg.notes}</p>}
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <select value={leg.status} onChange={e => updateLeg(leg.id, { status: e.target.value })}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white">
                              {Object.keys(LEG_STATUS).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <input type="date" value={(leg.scheduled_at || "").slice(0, 10)}
                              onChange={e => updateLeg(leg.id, { scheduled_at: e.target.value || null })}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Part Claims */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-gray-500">PART CLAIMS ({(detail.claims || []).length})</p>
                      <button onClick={() => addClaim(detail.service.id)} className="text-xs px-3 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Claim</button>
                    </div>
                    {(detail.claims || []).length === 0 && <p className="text-xs text-gray-400">No part claims yet</p>}
                    <div className="space-y-2">
                      {(detail.claims || []).map(claim => (
                        <div key={claim.id} className="bg-white border border-gray-200 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-1">
                            <div>
                              <span className="text-sm font-medium text-gray-900">{claim.part_name || claim.part_code || "Part"}</span>
                              {claim.claim_ref && <span className="text-xs text-gray-400 ml-2">Ref: {claim.claim_ref}</span>}
                            </div>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CLAIM_STATUS[claim.claim_status] || "bg-gray-100"}`}>{claim.claim_status}</span>
                          </div>
                          {claim.notes && <p className="text-xs text-gray-400">{claim.notes}</p>}
                          <div className="flex gap-2 mt-2">
                            {claim.claim_status === "pending" && (
                              <button onClick={() => { const ref = window.prompt("Claim reference:"); if (ref) updateClaim(claim.id, { claim_status: "submitted", claim_ref: ref }); }}
                                className="text-xs px-3 py-1 rounded-lg bg-blue-600 text-white">Submit Claim</button>
                            )}
                            {claim.claim_status === "submitted" && (
                              <button onClick={() => updateClaim(claim.id, { claim_status: "approved" })}
                                className="text-xs px-3 py-1 rounded-lg bg-violet-600 text-white">Approved</button>
                            )}
                            {(claim.claim_status === "approved" || claim.claim_status === "submitted") && (
                              <button onClick={() => updateClaim(claim.id, { claim_status: "received" })}
                                className="text-xs px-3 py-1 rounded-lg bg-emerald-600 text-white">Part Received</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ServicePage);
