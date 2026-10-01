// Delivery Schedule → Download PDF.
//
// A real, text-based A4 PDF of ONE team's schedule for ONE date — the same
// scope, rows and cell content as the Print Schedule sheet:
//   team (exactly what TeamPrintView received)
//     → buildTeamScheduleRows      (canonical stops: order, exclusions, Service
//                                    note as Item / Remark)
//     → teamScheduleStopCells / teamScheduleItemCells (shared with Excel)
//     → this renderer (jsPDF + jspdf-autotable, both already dependencies).
// Nothing here re-derives schedule data, so Print / Excel / PDF can't drift.
//
// Layout mirrors the printed sheet: A4 landscape, the same 16 columns and
// proportional widths, a green header row (repeated on every page), and one
// block per stop that is kept whole on a page — like the print's
// `.order-block { page-break-inside: avoid }` — unless a single stop is taller
// than a page, in which case it continues naturally. Text wraps; nothing is
// shrunk to fit. Chinese text (remarks, service notes, item names) renders via
// a self-hosted Noto Sans SC subset fetched only when the user downloads.
import {
  buildTeamScheduleRows, teamScheduleStopCells, teamScheduleItemCells, TEAM_SCHEDULE_COLUMNS,
  teamScheduleStopUnits, teamScheduleGroupBanner,
} from "./DeliverySchedule";

const PAGE_W = 297, PAGE_H = 210, MARGIN = 8;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FOOTER_H = 6;
// Same proportions as the printed sheet's <colgroup>. Those percentages sum to
// 95.5 and the browser normalises them across the full table width, so do
// the same here — otherwise the table stops short of the right margin.
const COL_PCT = [13, 5, 3.5, 3, 3, 5.5, 2.5, 7, 17, 3, 5.5, 5.5, 5, 5, 6, 6];
const PCT_SUM = COL_PCT.reduce((a, b) => a + b, 0);
const COL_W = COL_PCT.map(p => (CONTENT_W * p) / PCT_SUM);
const FONT = "NotoSC";
const BASE_PT = 7.5;   // the sheet's 10px
const SMALL_PT = 6.75; // the sheet's 9px
const PAD = { top: 1, right: 1.2, bottom: 1, left: 1.2 };
const LINE_FACTOR = 1.15;
const PT_TO_MM = 0.352778;
const lineHeight = pt => pt * PT_TO_MM * LINE_FACTOR;

export const SCHEDULE_FONT_FILES = { regular: "NotoSansSC-Schedule-Regular.ttf", bold: "NotoSansSC-Schedule-Bold.ttf" };

// Invisible/zero-width characters (seen in pasted remarks) and CR/tab
// normalisation — they'd otherwise print as missing-glyph boxes.
const clean = s => String(s ?? "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\r\n?/g, "\n").replace(/\t/g, " ");
// The bold subset only carries Latin + punctuation; anything else is drawn in
// Regular so it never comes out as missing glyphs.
const BOLD_EXTRA = new Set([0x20ac, 0x2122, 0x2713, 0x2714]); // € ™ ✓ ✔
const boldSafe = s => [...String(s)].every(ch => {
  const cp = ch.codePointAt(0);
  return cp <= 0xff || (cp >= 0x2010 && cp <= 0x203a) || BOLD_EXTRA.has(cp);
});
const rgb = hex => { const h = String(hex || "").replace("#", ""); return h.length === 6 ? [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) : [20, 20, 20]; };

// Lines of a rich (multi-part) cell, each with its own font settings, wrapped
// to the cell's inner width; plus the total height they need.
function layoutParts(doc, parts, innerW) {
  const lines = [];
  for (const part of parts) {
    const text = clean(part.text);
    const size = part.small ? SMALL_PT : BASE_PT;
    const style = part.bold && boldSafe(text) ? "bold" : "normal";
    doc.setFont(FONT, style); doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text, innerW)) lines.push({ text: line, size, style, color: part.color ? rgb(part.color) : (part.italic ? [85, 85, 85] : [20, 20, 20]) });
  }
  const height = lines.reduce((h, l) => h + lineHeight(l.size), 0);
  return { lines, height: height + PAD.top + PAD.bottom };
}

function drawParts(doc, lines, x, y) {
  let cy = y;
  for (const l of lines) {
    doc.setFont(FONT, l.style); doc.setFontSize(l.size); doc.setTextColor(...l.color);
    doc.text(l.text, x, cy, { baseline: "top" });
    cy += lineHeight(l.size);
  }
  doc.setTextColor(20, 20, 20);
}

// The green column-header row, drawn by hand so it can be repeated at the top
// of every page (including pages autotable opens mid-stop).
// Each label wraps only between words; a single word too wide for its narrow
// column ("Salesman", "Check") gets a smaller size instead of being cut.
function headerLayout(doc) {
  doc.setFont(FONT, "bold");
  const cells = TEAM_SCHEDULE_COLUMNS.map((h, i) => {
    const innerW = COL_W[i] - PAD.left - PAD.right;
    let size = BASE_PT;
    doc.setFontSize(size);
    const widest = Math.max(...h.split(" ").map(w => doc.getTextWidth(w)));
    if (widest > innerW) size = Math.max(5.5, (BASE_PT * innerW / widest) * 0.94); // 6% headroom for rounding
    doc.setFontSize(size);
    return { lines: doc.splitTextToSize(h, innerW), size };
  });
  const height = Math.max(...cells.map(c => c.lines.length * lineHeight(c.size)));
  return { cells, height: height + PAD.top + PAD.bottom + 0.6 };
}
function drawHeader(doc, y, hl) {
  let x = MARGIN;
  doc.setLineWidth(0.2); doc.setDrawColor(0, 0, 0);
  doc.setFont(FONT, "bold"); doc.setFontSize(BASE_PT); doc.setTextColor(0, 0, 0);
  hl.cells.forEach(({ lines, size }, i) => {
    doc.setFillColor(198, 239, 206);
    doc.rect(x, y, COL_W[i], hl.height, "FD");
    doc.setFontSize(size);
    const textH = lines.length * lineHeight(size);
    let ty = y + (hl.height - textH) / 2;
    for (const line of lines) { doc.text(line, x + COL_W[i] / 2, ty, { baseline: "top", align: "center" }); ty += lineHeight(size); }
    x += COL_W[i];
  });
  doc.setTextColor(20, 20, 20);
  return y + hl.height;
}

const baseTableOptions = {
  theme: "grid",
  showHead: "never",
  rowPageBreak: "avoid",
  tableWidth: CONTENT_W,
  styles: {
    font: FONT, fontStyle: "normal", fontSize: BASE_PT, textColor: [20, 20, 20],
    lineColor: [0, 0, 0], lineWidth: 0.2, cellPadding: PAD, valign: "top", overflow: "linebreak",
    minCellHeight: 0,
  },
  columnStyles: Object.fromEntries(COL_W.map((w, i) => [i, { cellWidth: w }])),
};

// autotable body rows for one stop — the same cells, in the same column order,
// as the printed sheet (stop-level cells span the stop's item rows).
function stopBody(doc, group, team, banner) {
  const { o, sc, rows } = group;
  const cells = teamScheduleStopCells(o, sc, rows, team, { bannerAddress: banner?.address });
  const n = rows.length;
  const info = layoutParts(doc, cells.info, COL_W[0] - PAD.left - PAD.right);
  const remark = layoutParts(doc, cells.remark, COL_W[15] - PAD.left - PAD.right);
  return rows.map((r, i) => {
    const ic = teamScheduleItemCells(r.item, r.idx);
    const center = { halign: "center" };
    const row = [];
    if (i === 0) {
      row.push({ content: "", rowSpan: n, _rich: info.lines, styles: { minCellHeight: info.height } });
      row.push({ content: clean(cells.salesman), rowSpan: n, styles: { fontSize: SMALL_PT } });
      row.push({ content: cells.trip.text, rowSpan: n, styles: { fontSize: SMALL_PT, halign: "center", textColor: rgb(cells.trip.color) } });
    }
    row.push({ content: "", styles: center }, { content: "", styles: center }); // Check / Naik — filled by hand
    if (i === 0) row.push({ content: clean(cells.plate), rowSpan: n, styles: center });
    row.push(
      { content: String(ic.no), styles: center },
      { content: clean(ic.code) },
      { content: clean(ic.name.text), styles: ic.name.isFallback ? { textColor: [255, 0, 0] } : {} },
      { content: clean(ic.unit), styles: center },
      { content: clean(ic.supplier) },
      { content: clean(ic.orderDate), styles: center },
      { content: clean(ic.sentDate), styles: center },
      { content: "", styles: center }, // JB Sent — filled by hand
      { content: ic.arrival.text, styles: { halign: "center", textColor: ic.arrival.color ? rgb(ic.arrival.color) : [20, 20, 20], fontStyle: ic.arrival.bold && boldSafe(ic.arrival.text) ? "bold" : "normal" } },
    );
    if (i === 0) row.push({ content: "", rowSpan: n, _rich: remark.lines, styles: { minCellHeight: remark.height } });
    return row;
  });
}

// A grouped Customer Stop's banner row (customer once + the orders delivered
// together), spanning all 16 columns above its child orders.
function bannerRow(doc, banner) {
  const parts = [
    { text: banner.label, bold: true, color: "#0f766e" },
    { text: [banner.customer, banner.contact].filter(Boolean).join("    "), bold: true },
    { text: [banner.address, banner.orders.join("  ·  ")].filter(Boolean).join("    ·    "), small: true, color: "#555555" },
  ];
  const laid = layoutParts(doc, parts, CONTENT_W - PAD.left - PAD.right);
  return [{ content: "", colSpan: 16, _rich: laid.lines, styles: { minCellHeight: laid.height, fillColor: [230, 246, 244] } }];
}

const drawRichCell = (data) => {
  const rich = data.section === "body" && data.cell.raw && data.cell.raw._rich;
  if (rich && rich.length) drawParts(data.doc, rich, data.cell.x + PAD.left, data.cell.y + PAD.top);
};

export function teamSchedulePdfFileName(team) {
  const safe = s => String(s || "").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const label = safe([team?.vehicle_plate, team?.driver_name].filter(Boolean).join(" ")) || "Team";
  return `Delivery-Schedule-${safe(team?.team_date) || "undated"}-${label}.pdf`;
}

// Build the document (pure — fonts are passed in as base64 TTF). Exposed for
// tests and visual verification; the UI calls exportTeamSchedulePdf.
// onStopDrawn(group, { firstPage, lastPage, height }) — test hook: lets the
// suite prove every stop is drawn, in order, and kept whole on one page.
export function buildTeamSchedulePdf({ jsPDF, createTable, drawTable, team, company = {}, fonts, printedAt = new Date(), onStopDrawn }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS(SCHEDULE_FONT_FILES.regular, fonts.regular);
  doc.addFont(SCHEDULE_FONT_FILES.regular, FONT, "normal");
  doc.addFileToVFS(SCHEDULE_FONT_FILES.bold, fonts.bold);
  doc.addFont(SCHEDULE_FONT_FILES.bold, FONT, "bold");
  doc.setFont(FONT, "normal");
  doc.setProperties({ title: "Delivery Schedule" });

  const dateStr = team?.team_date || "-";
  const vehicleStr = [team?.vehicle_plate, team?.driver_name, team?.area].filter(Boolean).join(" / ");
  const companyName = (company?.name || "").trim();
  const title = companyName ? `${companyName} Delivery Schedule` : "Delivery Schedule";
  const subtitle = `Date: ${dateStr}   |   Vehicle: ${vehicleStr || "-"}`;
  const bottom = PAGE_H - MARGIN - FOOTER_H;

  // Title block (first page) — same text as the printed sheet.
  let y = MARGIN;
  doc.setFont(FONT, boldSafe(title) ? "bold" : "normal"); doc.setFontSize(11);
  doc.text(clean(title), PAGE_W / 2, y, { align: "center", baseline: "top" });
  y += lineHeight(11);
  doc.setFont(FONT, "normal"); doc.setFontSize(8.5); doc.setTextColor(68, 68, 68);
  doc.text(clean(subtitle), PAGE_W / 2, y, { align: "center", baseline: "top" });
  doc.setTextColor(20, 20, 20);
  y += lineHeight(8.5) + 2;

  const hl = headerLayout(doc);
  const headerPages = new Set([1]);
  y = drawHeader(doc, y, hl);
  const pageTop = MARGIN + hl.height;
  const withHeader = () => {
    const page = doc.getCurrentPageInfo().pageNumber;
    if (!headerPages.has(page)) { headerPages.add(page); drawHeader(doc, MARGIN, hl); }
  };

  // Route units, exactly as the printed sheet: one per stop; a Deliver
  // Together group is ONE customer stop (banner + its child orders), measured
  // and kept together as a whole.
  const units = teamScheduleStopUnits(buildTeamScheduleRows(team));
  const groups = units.flatMap(u => u.children);
  const unitBody = (unit) => {
    const banner = unit.grouped ? teamScheduleGroupBanner(unit.children) : null;
    return [...(banner ? [bannerRow(doc, banner)] : []), ...unit.children.flatMap(g => stopBody(doc, g, team, banner))];
  };

  const tableOptions = (body, startY) => ({
    ...baseTableOptions, body, startY,
    margin: { left: MARGIN, right: MARGIN, top: pageTop, bottom: PAGE_H - bottom },
    didDrawCell: drawRichCell,
    didDrawPage: withHeader,
  });

  if (groups.length === 0) {
    const t = createTable(doc, tableOptions([[{ content: "No orders assigned.", colSpan: 16, styles: { halign: "center", textColor: [136, 136, 136] } }]], y));
    drawTable(doc, t);
    y = doc.lastAutoTable.finalY;
  }

  for (const unit of units) {
    const g = { ...unit.children[0], children: unit.children, stopNo: unit.stopNo, grouped: unit.grouped };
    let t = createTable(doc, tableOptions(unitBody(unit), y));
    const height = t.body.reduce((h, r) => h + r.height, 0);
    // Keep a stop whole: move it to a fresh page when it doesn't fit here but
    // would fit on an empty page. A stop taller than a page continues across
    // pages (rows never split mid-row; the header repeats on each page).
    if (y + height > bottom + 0.01 && y > pageTop + 0.01 && height <= bottom - pageTop) {
      doc.addPage(); withHeader();
      y = pageTop;
      t = createTable(doc, tableOptions(unitBody(unit), y));
    }
    const firstPage = doc.getCurrentPageInfo().pageNumber;
    drawTable(doc, t);
    y = doc.lastAutoTable.finalY;
    if (onStopDrawn) onStopDrawn(g, { firstPage, lastPage: doc.getCurrentPageInfo().pageNumber, height });
  }

  // "Printed:" stamp, as on the sheet.
  const stamp = `Printed: ${printedAt.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}`;
  doc.setFont(FONT, "normal"); doc.setFontSize(SMALL_PT); doc.setTextColor(136, 136, 136);
  if (y + 4 > bottom) { doc.addPage(); withHeader(); y = pageTop; }
  doc.text(stamp, PAGE_W - MARGIN, y + 2, { align: "right", baseline: "top" });

  // Page footer — which schedule and where in it — on every page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont(FONT, "normal"); doc.setFontSize(SMALL_PT); doc.setTextColor(136, 136, 136);
    doc.text(clean(`${title} · ${dateStr} · ${vehicleStr || "-"}`), MARGIN, PAGE_H - MARGIN, { baseline: "bottom" });
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - MARGIN, { align: "right", baseline: "bottom" });
  }
  doc.setTextColor(20, 20, 20);
  return doc;
}

// Fonts are fetched once per session, only when a PDF is actually downloaded.
const fontCache = {};
const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
function loadFont(file) {
  if (!fontCache[file]) {
    fontCache[file] = fetch(`${process.env.PUBLIC_URL || ""}/fonts/${file}`)
      .then(r => { if (!r.ok) throw new Error(`Could not load the PDF font (${r.status})`); return r.arrayBuffer(); })
      .then(toBase64)
      .catch(e => { delete fontCache[file]; throw e; });
  }
  return fontCache[file];
}

export async function exportTeamSchedulePdf(team, company = {}) {
  const [{ jsPDF }, { __createTable, __drawTable }, regular, bold] = await Promise.all([
    import("jspdf"), import("jspdf-autotable"),
    loadFont(SCHEDULE_FONT_FILES.regular), loadFont(SCHEDULE_FONT_FILES.bold),
  ]);
  const doc = buildTeamSchedulePdf({ jsPDF, createTable: __createTable, drawTable: __drawTable, team, company, fonts: { regular, bold } });
  doc.save(teamSchedulePdfFileName(team));
}
