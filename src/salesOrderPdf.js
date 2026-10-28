// My Orders → Download PDF.
//
// A real, text-based A4 PDF of the sales order's Customer Copy — the same
// content as the printed sales order (printSalesOrder in OrdersPage.js):
//   order → salesOrderFigures (salesOrderDoc.js, shared with Print)
//         → this renderer (jsPDF + jspdf-autotable, both already dependencies).
// Nothing here re-derives totals, balance or item lines, so Print and PDF
// can't drift.
//
// Layout mirrors the print: branch bar, letterhead, SALES ORDER title with the
// document number, customer details, the item table (header repeated on every
// page, rows never split), then the closing section — Remarks + totals,
// Payment Method, Important Notes, Terms and signatures — kept together on the
// last page, like the print's `.closing { break-inside: avoid }`. One copy
// only: the PDF is what gets sent to the customer. Chinese text renders via
// the self-hosted Noto Sans SC subset (pdfFonts.js), fetched only on download.
import { PAYMENT_METHODS, SALES_ORDER_TERMS, salesOrderFigures, soMoney } from "./salesOrderDoc";
import { clean, boldSafe, registerPdfFonts, loadPdfFonts } from "./pdfFonts";

const PAGE_W = 210, PAGE_H = 297, MARGIN = 8;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const X0 = MARGIN, X1 = PAGE_W - MARGIN;
const FOOTER_H = 6;
const BOTTOM = PAGE_H - MARGIN - FOOTER_H;
const PADX = 3.5;
const FONT = "NotoSC";
const PT_TO_MM = 0.352778;
const lh = (pt, f = 1.3) => pt * PT_TO_MM * f;

const INK = [31, 41, 55], MUTED = [107, 114, 128], SOFT = [55, 65, 81], GREY_BG = [243, 244, 246], HAIR = [229, 231, 235], RED = [180, 35, 24];

function font(doc, size, { bold = false, color = INK, text = "" } = {}) {
  doc.setFont(FONT, bold && boldSafe(text) ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(...color);
}
function txt(doc, s, x, y, size, opts = {}) {
  const t = clean(s);
  font(doc, size, { ...opts, text: t });
  doc.text(t, x, y, { baseline: "top", align: opts.align || "left" });
}
// Wrapped text; returns the height used. `dry` measures without drawing.
function para(doc, s, x, y, w, size, opts = {}, dry = false) {
  const t = clean(s);
  font(doc, size, { ...opts, text: t });
  const lines = t ? doc.splitTextToSize(t, w) : [];
  if (!dry) lines.forEach((l, i) => doc.text(l, x, y + i * lh(size), { baseline: "top", align: opts.align || "left" }));
  return lines.length * lh(size);
}
const rule = (doc, y, x0 = X0, x1 = X1, color = INK, w = 0.15) => { doc.setDrawColor(...color); doc.setLineWidth(w); doc.line(x0, y, x1, y); };
const fill = (doc, x, y, w, h, color) => { doc.setFillColor(...color); doc.rect(x, y, w, h, "F"); };

export function salesOrderPdfFileName(order) {
  const safe = s => String(s || "").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  const no = safe(order?.order_number) || "draft";
  const cust = safe(order?.customer_name);
  return `Sales-Order-${no}${cust ? `-${cust}` : ""}.pdf`;
}

function drawHeader(doc, y, order, co, fig, logo) {
  // Branch bar
  fill(doc, X0, y, CONTENT_W, 6, INK);
  txt(doc, `BRANCH : ${fig.branchLine}`, X0 + PADX, y + 1.5, 7.5, { bold: true, color: [255, 255, 255] });
  txt(doc, `DATE : ${fig.dateStr}`, X1 - PADX, y + 1.5, 7.5, { color: [229, 231, 235], align: "right" });
  y += 6;

  // Letterhead: logo (or company name) left, company block right.
  const top = y + 2;
  let leftH = 0;
  if (logo) {
    const h = Math.min(12, (58 * logo.height) / logo.width);
    const w = (h * logo.width) / logo.height;
    try { doc.addImage(logo.dataUrl, "PNG", X0 + PADX, top, w, h); leftH = h; } catch (e) { leftH = 0; }
  }
  if (!leftH && co.name) leftH = para(doc, co.name, X0 + PADX, top + 1, 80, 13, { bold: true });
  const coW = 105, coX = X1 - PADX;
  let ry = top;
  if (co.name || co.reg) {
    const head = `${co.name || ""}${co.reg ? ` (${co.reg})` : ""}`;
    ry += para(doc, head, coX, ry, coW, 8, { bold: true, align: "right" });
  }
  if (co.address) ry += para(doc, co.address, coX, ry, coW, 6.75, { color: SOFT, align: "right" });
  if (co.hotline) ry += para(doc, `Hotline: ${co.hotline}`, coX, ry, coW, 6.75, { color: SOFT, align: "right" });
  if (co.branches_display) ry += para(doc, co.branches_display, coX, ry + 0.5, coW, 6, { color: MUTED, align: "right" }) + 0.5;
  y = Math.max(top + leftH, ry) + 2;
  rule(doc, y);

  // Title bar
  fill(doc, X0, y, CONTENT_W, 11, GREY_BG);
  txt(doc, "SALES ORDER", X0 + PADX, y + 2.8, 17, { bold: true });
  txt(doc, "DOCUMENT NO", X1 - PADX, y + 1.6, 6, { color: MUTED, align: "right" });
  txt(doc, order.order_number || "", X1 - PADX, y + 4.4, 10.5, { bold: true, color: RED, align: "right" });
  y += 11;
  rule(doc, y);
  return y;
}

function sectionTitle(doc, y, label) {
  fill(doc, X0, y, CONTENT_W, 5, GREY_BG);
  txt(doc, label.toUpperCase(), X0 + PADX, y + 1.2, 7.5, { bold: true, color: SOFT });
  rule(doc, y + 5);
  return y + 5;
}

function drawCustomer(doc, y, order, fig) {
  y = sectionTitle(doc, y, "Customer Details");
  const colW = CONTENT_W / 2, lblW = 26, valW = colW - lblW - 2 * PADX;
  const left = [
    ["Customer Name", order.customer_name],
    [order.delivery_address ? "Billing Address" : "Address", order.customer_address],
    ...(order.delivery_address ? [["Delivery Address", order.delivery_address]] : []),
    ["Sales Assistant", order.salesman_name],
    ["Phone", order.customer_contact],
    [fig.idLabel, order.customer_id_no],
  ];
  const right = [
    ["Order Date", fig.dateStr],
    ["Delivery Date", `${order.delivery_date || ""}${order.delivery_time_slot ? ` (${order.delivery_time_slot})` : ""}`],
    ["Order Type", order.delivery_type],
    ["Email", order.customer_email],
  ];
  const col = (rows, x) => {
    let cy = y + 1.5;
    for (const [l, v] of rows) {
      txt(doc, l, x + PADX, cy, 8, { color: MUTED });
      const h = para(doc, v || "", x + PADX + lblW, cy, valW, 8, { bold: true });
      cy += Math.max(lh(8), h) + 0.8;
    }
    return cy + 0.7;
  };
  const bottom = Math.max(col(left, X0), col(right, X0 + colW));
  doc.setDrawColor(...INK); doc.setLineWidth(0.15); doc.line(X0 + colW, y, X0 + colW, bottom);
  rule(doc, bottom);
  return bottom;
}

// Item rows: name (bold) + spec / notes (small grey) drawn by hand inside the
// Description cell; the cell's height is reserved via minCellHeight.
function itemBody(doc, fig, descW) {
  const MIN_ROWS = 3;
  const rows = fig.lines.map(l => {
    const parts = [{ t: l.name, size: 9, bold: true, color: INK }];
    if (l.sub) parts.push({ t: l.sub, size: 6.5, color: MUTED });
    if (l.notes) parts.push({ t: l.notes, size: 6.5, color: MUTED });
    const lines = [];
    for (const p of parts) {
      const t = clean(p.t);
      font(doc, p.size, { bold: p.bold, text: t });
      for (const s of doc.splitTextToSize(t, descW - 2 * 2)) lines.push({ ...p, t: s, bold: p.bold && boldSafe(t) });
    }
    const height = lines.reduce((h, x) => h + lh(x.size, 1.25), 0) + 2.4;
    return [String(l.no), { content: "", _rich: lines, styles: { minCellHeight: Math.max(6, height) } }, String(l.qty), l.unitPrice, l.amount];
  });
  for (let i = fig.lines.length; i < MIN_ROWS; i++) rows.push([String(i + 1), { content: "", styles: { minCellHeight: 6 } }, "", "", ""]);
  return rows;
}

function drawItems(doc, autoTable, y, order, fig) {
  const W = [9, 0, 13, 23, 27];
  W[1] = CONTENT_W - W.reduce((a, b) => a + b, 0);
  autoTable(doc, {
    startY: y,
    margin: { left: X0, right: MARGIN, top: MARGIN, bottom: PAGE_H - BOTTOM },
    tableWidth: CONTENT_W,
    theme: "plain",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    head: [["NO", "DESCRIPTION", "QTY", "UNIT PRICE", "AMOUNT (MYR)"]],
    body: itemBody(doc, fig, W[1]),
    styles: { font: FONT, fontSize: 9, textColor: INK, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 }, valign: "top", lineColor: HAIR, lineWidth: { bottom: 0.15, right: 0.15 } },
    headStyles: { font: FONT, fontStyle: "bold", fontSize: 7.5, textColor: SOFT, fillColor: GREY_BG, lineColor: INK, lineWidth: { top: 0.15, bottom: 0.15 } },
    columnStyles: {
      0: { cellWidth: W[0], halign: "center" }, 1: { cellWidth: W[1] }, 2: { cellWidth: W[2], halign: "center" },
      3: { cellWidth: W[3], halign: "right" }, 4: { cellWidth: W[4], halign: "right", lineWidth: { bottom: 0.15 } },
    },
    didParseCell: (d) => { if (d.section === "head") d.cell.styles.halign = d.column.index === 1 ? "left" : (d.column.index >= 3 ? "right" : "center"); },
    didDrawCell: (d) => {
      const rich = d.section === "body" && d.cell.raw && d.cell.raw._rich;
      if (!rich) return;
      let cy = d.cell.y + 1.2;
      for (const l of rich) {
        font(doc, l.size, { bold: l.bold, color: l.color, text: l.bold ? l.t : "" });
        doc.text(l.t, d.cell.x + 2, cy, { baseline: "top" });
        cy += lh(l.size, 1.25);
      }
    },
  });
  return doc.lastAutoTable.finalY;
}

// The closing section. Every block takes `dry` so the whole section can be
// measured first and moved to a fresh page as one unit.
function closing(doc, y0, order, co, fig, dry) {
  let y = y0;
  if (!dry) rule(doc, y);

  // Remarks + totals
  const remW = CONTENT_W * 0.6, sumX = X0 + remW, sumW = CONTENT_W - remW;
  let ry = y + 1.5;
  if (!dry) txt(doc, "REMARKS", X0 + PADX, ry, 7.5, { bold: true, color: SOFT });
  ry += lh(7.5) + 0.8;
  ry += Math.max(10, para(doc, order.remark || order.notes || "", X0 + PADX, ry, remW - 2 * PADX, 7.5, {}, dry)) + 1.5;
  const sum = [
    ["Subtotal", soMoney(fig.subtotal)],
    ...(fig.gst ? [[`GST (${fig.gstRate}%)`, soMoney(fig.gst)]] : []),
    ...(fig.discount ? [["Discount", `-${soMoney(fig.discount)}`]] : []),
    [`TOTAL${fig.gst ? " (incl. GST)" : ""}`, soMoney(fig.total), true],
    ["Deposit Paid", soMoney(fig.deposit)],
    ["BALANCE DUE", soMoney(fig.balance), true],
  ];
  let sy = y;
  for (const [lab, num, grand] of sum) {
    const h = grand ? 6 : 5;
    if (!dry) {
      if (grand) fill(doc, sumX, sy, sumW, h, GREY_BG);
      const size = grand ? 9 : 7.5;
      const ty = sy + (h - lh(size, 1)) / 2;
      txt(doc, lab, sumX + PADX, ty, size, { bold: true, color: grand ? INK : MUTED });
      txt(doc, num, X1 - PADX, ty, size, { bold: true, align: "right" });
      rule(doc, sy + h, sumX, X1, HAIR);
    }
    sy += h;
  }
  y = Math.max(ry, sy);
  if (!dry) { doc.setDrawColor(...INK); doc.setLineWidth(0.15); doc.line(sumX, y0, sumX, y); rule(doc, y); }

  // Payment Method
  if (!dry) sectionTitle(doc, y, "Payment Method");
  y += 5 + 1.5;
  const optW = (CONTENT_W - 2 * PADX) / 3;
  PAYMENT_METHODS.forEach((m, i) => {
    const x = X0 + PADX + (i % 3) * optW, oy = y + Math.floor(i / 3) * 5;
    if (dry) return;
    doc.setDrawColor(...INK); doc.setLineWidth(0.25); doc.rect(x, oy + 0.3, 3, 3);
    if (fig.checkedPay === m) { doc.setLineWidth(0.5); doc.lines([[0.8, 0.9], [1.5, -2]], x + 0.6, oy + 1.9); }
    txt(doc, m, x + 4.5, oy + 0.3, 7.5);
  });
  y += Math.ceil(PAYMENT_METHODS.length / 3) * 5 + 1;
  const fields = [
    ...(co.bank ? [["Bank Account :", co.bank]] : []),
    ["Reference :", ""],
    ["Paid Amount :", `RM ${soMoney(fig.deposit)}`],
  ];
  let fx = X0 + PADX;
  for (const [lab, val] of fields) {
    font(doc, 7.5, { text: lab });
    const lw = doc.getTextWidth(lab) + 1.5;
    font(doc, 7.5, { bold: true, text: val });
    const vw = Math.max(38, doc.getTextWidth(clean(val)) + 3);
    if (fx + lw + vw > X1 - PADX) { fx = X0 + PADX; y += 5.5; }
    if (!dry) {
      txt(doc, lab, fx, y, 7.5, { bold: true, color: MUTED });
      txt(doc, val, fx + lw + 1, y, 7.5, { bold: true });
      rule(doc, y + lh(7.5, 1.1) + 0.3, fx + lw, fx + lw + vw, [156, 163, 175]);
    }
    fx += lw + vw + 7;
  }
  y += 6;
  if (!dry) rule(doc, y);

  // Important Notes
  y += 1.5;
  if (!dry) txt(doc, "IMPORTANT NOTES", X0 + PADX, y, 7.5, { bold: true, color: SOFT });
  y += lh(7.5) + 0.6;
  const notes = [
    "Full payment shall be made prior to delivery.",
    `Cheque to be crossed "A/C Payee Only", payable to ${co.name || ""}.${co.bank ? ` Bank: ${co.bank}` : ""}`,
  ];
  for (const n of notes) {
    if (!dry) txt(doc, "•", X0 + PADX + 0.5, y, 6.75, { color: [156, 163, 175] });
    y += para(doc, n, X0 + PADX + 3, y, CONTENT_W - 2 * PADX - 3, 6.75, { color: SOFT }, dry);
  }
  y += 1.5;
  if (!dry) rule(doc, y);

  // Terms & Conditions
  y += 1.5;
  if (!dry) txt(doc, "TERMS & CONDITIONS", X0 + PADX, y, 7.5, { bold: true, color: SOFT });
  y += lh(7.5) + 0.6;
  SALES_ORDER_TERMS.forEach((t, i) => {
    if (!dry) txt(doc, `${i + 1}.`, X0 + PADX, y, 6, { color: SOFT });
    y += para(doc, t, X0 + PADX + 4, y, CONTENT_W - 2 * PADX - 4, 6, { color: SOFT }, dry) + 0.2;
  });
  y += 0.6;
  y += para(doc, "I acknowledge and agree to abide by the conditions of sale stated above.", X0 + PADX, y, CONTENT_W - 2 * PADX, 6.4, { color: [71, 84, 103] }, dry);
  y += 1.5;
  if (!dry) rule(doc, y);

  // Signatures
  const colW = CONTENT_W / 2, sTop = y;
  const sig = (x, title, name, caption) => {
    const cx = x + colW / 2;
    txt(doc, title, cx, sTop + 1.5, 6.75, { bold: true, color: MUTED, align: "center" });
    if (name) txt(doc, name, cx, sTop + 10, 8, { bold: true, align: "center" });
    rule(doc, sTop + 14, cx - colW * 0.39, cx + colW * 0.39, INK, 0.2);
    txt(doc, caption, cx, sTop + 15, 6.75, { color: SOFT, align: "center" });
  };
  if (!dry) {
    sig(X0, "CUSTOMER SIGNATURE", "", "Signature & Date");
    sig(X0 + colW, "SALES ASSISTANT", order.salesman_name || "", "Authorised Signature");
    doc.setDrawColor(...INK); doc.setLineWidth(0.15); doc.line(X0 + colW, sTop, X0 + colW, sTop + 19);
  }
  y += 19;
  if (!dry) rule(doc, y);
  return y;
}

// Build the document (pure — fonts as base64 TTF, logo pre-loaded). Exposed
// for tests; the UI calls exportSalesOrderPdf.
export function buildSalesOrderPdf({ jsPDF, autoTable, order, company = {}, branchName, fonts, logo = null }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  registerPdfFonts(doc, fonts, FONT);
  doc.setProperties({ title: `Sales Order ${order.order_number || ""}`.trim() });
  const fig = salesOrderFigures(order, branchName);

  let y = drawHeader(doc, MARGIN, order, company, fig, logo);
  y = drawCustomer(doc, y, order, fig);
  y = drawItems(doc, autoTable, y, order, fig);

  const need = closing(doc, y, order, company, fig, true) - y;
  if (y + need > BOTTOM + 0.01 && y > MARGIN + 0.01) { doc.addPage(); y = MARGIN; }
  closing(doc, y, order, company, fig, false);

  // Footer on every page: which SO it is and where in it.
  const pages = doc.getNumberOfPages();
  const label = clean(`Sales Order ${order.order_number || ""} · ${order.customer_name || ""}`);
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    font(doc, 6.5, { color: [136, 136, 136] });
    doc.text(label, X0, PAGE_H - MARGIN, { baseline: "bottom" });
    doc.text(`Page ${p} of ${pages}`, X1, PAGE_H - MARGIN, { align: "right", baseline: "bottom" });
  }
  return doc;
}

// The company logo as a PNG data URL (re-encoded through a canvas so any
// uploaded image type works). A missing or unreachable logo is not an error —
// the PDF falls back to the company name.
function loadLogo(url) {
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c.width && c.height ? { dataUrl: c.toDataURL("image/png"), width: c.width, height: c.height } : null);
      } catch (e) { resolve(null); }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

export async function exportSalesOrderPdf(order, company = {}, branchName) {
  const [{ jsPDF }, { autoTable }, fonts, logo] = await Promise.all([
    import("jspdf"), import("jspdf-autotable"), loadPdfFonts(), loadLogo(company?.logo),
  ]);
  const doc = buildSalesOrderPdf({ jsPDF, autoTable, order, company, branchName, fonts, logo });
  doc.save(salesOrderPdfFileName(order));
}
