// Commission Payout Report — Excel download and printable page in the layout of the salesman
// commission sheet ("<Name> COMM" · DATE · LOCATION · SO NUMBER · AMOUNT · NETT TOTAL · GST ·
// DEPOSIT · DEPOSIT (%) · BALANCE · SPLIT · NETT SALES · TIER · NETT COMM · INCENTIVE · REMARK).
//
// Every figure comes from the backend (GET /commission-payout?report=1, vhaus-bot
// lib/commission-payout-report.js); nothing here re-derives a business rule. This module only
// arranges those rows: per person, payable rows first (own sales, then overrides), totals, then
// the pending rows (deposit gate not met) listed apart and never totalled.

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, key) => round2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
const byDateThenSo = (a, b) => String(a.order_date || "").localeCompare(String(b.order_date || "")) || String(a.so_number || "").localeCompare(String(b.so_number || ""), undefined, { numeric: true });

// "2026-07-01" → { payout: "JULY 2026", sheetMonth: "JUN 26" } — the payout month pays the
// previous month's orders, which is what the sheet tab is named after.
export function reportMonthLabels(payoutMonth) {
  const [y, m] = String(payoutMonth).slice(0, 7).split("-").map(Number);
  const prevY = m === 1 ? y - 1 : y, prevM = m === 1 ? 12 : m - 1;
  return { payout: `${MONTHS[m - 1]} ${y}`, payoutMonthName: MONTHS[m - 1], year: y, sheetMonth: `${MONTHS[prevM - 1].slice(0, 3)} ${String(prevY).slice(2)}` };
}

/** Arrange the payout users (with commission.report rows) into one report section per person. */
export function buildPayoutReport(users, payoutMonth) {
  const labels = reportMonthLabels(payoutMonth);
  const sheets = (users || []).map(u => {
    const withRow = (u.commissions || []).filter(c => c.report);
    const reportRows = withRow.map(c => c.report);
    const payable = reportRows.filter(r => r.section === "payable");
    const own = payable.filter(r => r.kind !== "override").sort(byDateThenSo);
    const overrides = payable.filter(r => r.kind === "override").sort(byDateThenSo);
    const pending = reportRows.filter(r => r.section === "pending").sort(byDateThenSo);
    // Adjustments and held amounts count only for payable commissions — the same scope as the
    // payout total (GET /commission-payout), so the sheet's TOTAL PAYOUT equals the page's.
    const payableIds = new Set(payable.map(r => r.commission_id));
    const adjustments = round2((u.adjustments || []).filter(a => payableIds.has(a.commission_id)).reduce((s, a) => s + (Number(a.delta_amt) || 0), 0));
    const holds = round2((u.holds || []).filter(h => h.status === "held" && payableIds.has(h.commission_id)).reduce((s, h) => s + (Number(h.held_amt) || 0), 0));
    const totals = {
      amount: sum(own, "amount"), nett_total: sum(own, "nett_total"), gst: sum(own, "gst"), deposit: sum(own, "deposit"),
      balance: sum(own, "balance"), nett_sales: sum(own, "nett_sales"), nett_comm: sum(own, "nett_comm"), incentive: sum(own, "incentive"),
      override_comm: sum(overrides, "nett_comm"),
    };
    const totalPayout = round2(totals.nett_comm + totals.incentive + totals.override_comm + adjustments - holds);
    return { userId: u.user_id, name: u.name || "?", role: u.role, own, overrides, pending, adjustments, holds, totals, totalPayout };
  });
  return { payoutMonth, labels, sheets };
}

// ── Excel ───────────────────────────────────────────────────────────────────

const HEADERS = ["DATE ", "LOCATION", "SO NUMBER", "AMOUNT ", "NETT TOTAL", "GST", "DEPOSIT", "DEPOSIT (%)", "BALANCE", "SPLIT", "NETT SALES", "TIER", "NETT COMM", "INCENTIVE", "REMARK"];
const WIDTHS = [22.21, 13, 25.21, 13.93, 13.5, 12.36, 13.36, 13.5, 12.5, 7.79, 13.21, 10.21, 13.79, 11.5, 73.36];
const RM = "[$RM]#,##0.00";
const PCT = "0.00%";
const solid = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const CENTER = { horizontal: "center", vertical: "middle" };
// Cell styles of the business's own sheet: yellow = typed-in values, plain = calculated.
const INPUT = { fill: solid("FFFFF2CC"), font: { name: "Arial", size: 11 }, alignment: CENTER };
const CALC = { font: { name: "Calibri", size: 10 }, alignment: CENTER };
const COL_STYLE = {
  A: { ...INPUT, numFmt: "mm-dd-yy" }, B: INPUT, C: INPUT, D: { ...INPUT, font: { name: "Arial", size: 11, bold: true }, numFmt: RM },
  E: { ...CALC, font: { name: "Calibri", size: 10, bold: true }, numFmt: RM }, F: { ...CALC, numFmt: RM },
  G: { ...INPUT, numFmt: RM }, H: { ...CALC, numFmt: PCT }, I: { ...CALC, numFmt: RM }, J: INPUT,
  K: { ...CALC, font: { name: "Calibri", size: 10, bold: true, color: { argb: "FFFF0000" } }, numFmt: RM },
  L: { ...CALC, font: { name: "Calibri", size: 10, bold: true }, numFmt: PCT },
  M: { fill: solid("FF6AA84F"), font: { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFF00" } }, alignment: CENTER, numFmt: RM },
  N: { font: { name: "Arial", size: 11 }, alignment: CENTER, numFmt: RM },
  O: { font: { name: "Arial", size: 11 }, alignment: { horizontal: "left", vertical: "middle" } },
};
const COLS = "ABCDEFGHIJKLMNO".split("");

function applyStyle(cell, style) {
  if (style.fill) cell.fill = style.fill;
  if (style.font) cell.font = style.font;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.numFmt) cell.numFmt = style.numFmt;
}

const isoToExcelDate = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};

// One data row, with the sheet's own formulas (and their results, so the file reads correctly
// before Excel recalculates). NETT COMM is the commission actually paid; it is written as the
// K×L formula only when that formula gives the paid amount, otherwise as the value.
function writeDataRow(ws, r, row, { greyed = false } = {}) {
  const f = (formula, result) => ({ formula, result });
  const values = {
    A: isoToExcelDate(row.order_date), B: row.location || "", C: row.so_number || "", D: row.amount,
    E: f(`IF(B${r}="SG",D${r}/1.09,D${r})`, row.nett_total), F: f(`D${r}-E${r}`, row.gst), G: row.deposit,
    H: f(`IF(D${r}=0,0,G${r}/D${r})`, row.deposit_pct), I: f(`D${r}-G${r}`, row.balance), J: row.split,
    K: f(`E${r}/J${r}`, row.nett_sales), L: round2(row.tier_pct) / 100,
    M: Math.abs(round2(row.nett_sales * row.tier_pct / 100) - row.nett_comm) < 0.01 ? f(`K${r}*L${r}`, row.nett_comm) : row.nett_comm,
    N: row.incentive, O: row.remark || "",
  };
  for (const c of COLS) {
    const cell = ws.getCell(`${c}${r}`);
    cell.value = values[c];
    applyStyle(cell, COL_STYLE[c]);
    if (greyed) cell.font = { ...(cell.font || {}), color: { argb: "FF999999" }, italic: true };
  }
}

const sheetNameFor = (name, sheetMonth, used) => {
  const base = `${String(name).toUpperCase()} ${sheetMonth}`.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "SHEET";
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suffix = ` (${i++})`; n = base.slice(0, 31 - suffix.length) + suffix; }
  used.add(n.toLowerCase());
  return n;
};

/** Build the workbook (one sheet per person). `ExcelJS` is passed in so tests and the browser share it. */
export function buildPayoutWorkbook(ExcelJS, report) {
  const wb = new ExcelJS.Workbook();
  // Formulas carry their results, but a 0 result is not stored by ExcelJS — have Excel
  // recalculate everything on open so every cell shows its value.
  wb.calcProperties.fullCalcOnLoad = true;
  const used = new Set();
  for (const s of report.sheets) {
    const ws = wb.addWorksheet(sheetNameFor(s.name, report.labels.sheetMonth, used), {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = WIDTHS.map(width => ({ width }));

    // Row 1 — title band
    for (const c of COLS) { const cell = ws.getCell(`${c}1`); cell.fill = solid("FFD9EAD3"); cell.font = { name: "Calibri", size: 12, bold: true }; cell.alignment = CENTER; }
    ws.getCell("A1").value = `${s.name} COMM`;
    ws.getCell("B1").value = `${report.labels.payout} COMM TOTAL SALES `;
    ws.getCell("B1").alignment = { horizontal: "left", vertical: "middle" };
    ws.getRow(1).height = 15.75;

    // Row 2 — headers
    HEADERS.forEach((h, i) => { const cell = ws.getCell(`${COLS[i]}2`); cell.value = h; cell.fill = solid("FFB6D7A8"); cell.font = { name: "Calibri", size: 10 }; cell.alignment = i === 14 ? { vertical: "middle" } : CENTER; });

    // Own sales
    let r = 3;
    const first = r;
    for (const row of s.own) writeDataRow(ws, r++, row);
    const last = r - 1;
    const has = s.own.length > 0;
    const sumOf = c => (has ? { formula: `SUM(${c}${first}:${c}${last})` } : 0);
    r++;
    const totalRow = r;
    ws.getCell(`C${totalRow}`).value = "TOTAL";
    for (const [c, key] of [["D", "amount"], ["E", "nett_total"], ["F", "gst"], ["G", "deposit"], ["I", "balance"], ["K", "nett_sales"], ["M", "nett_comm"], ["N", "incentive"]]) {
      const cell = ws.getCell(`${c}${totalRow}`);
      cell.value = has ? { ...sumOf(c), result: s.totals[key] } : 0;
      cell.numFmt = RM; cell.font = { name: "Calibri", size: 11, bold: true }; cell.alignment = CENTER;
    }
    ws.getCell(`C${totalRow}`).font = { name: "Calibri", size: 11, bold: true };
    ws.getCell(`C${totalRow}`).alignment = CENTER;
    // Title total = the person's own nett sales.
    ws.getCell("D1").value = { formula: `K${totalRow}`, result: s.totals.nett_sales };
    ws.getCell("D1").numFmt = RM;
    r++;

    // Overrides (commission on other people's branch sales — not this person's own sales)
    let overrideTotalCell = null;
    if (s.overrides.length) {
      r++;
      ws.getCell(`C${r}`).value = "OVERRIDES"; ws.getCell(`C${r}`).font = { name: "Calibri", size: 11, bold: true };
      r++;
      const oFirst = r;
      for (const row of s.overrides) writeDataRow(ws, r++, row);
      ws.getCell(`C${r}`).value = "OVERRIDE TOTAL";
      ws.getCell(`M${r}`).value = { formula: `SUM(M${oFirst}:M${r - 1})`, result: s.totals.override_comm };
      ws.getCell(`M${r}`).numFmt = RM;
      for (const c of ["C", "M"]) { ws.getCell(`${c}${r}`).font = { name: "Calibri", size: 11, bold: true }; ws.getCell(`${c}${r}`).alignment = CENTER; }
      overrideTotalCell = `M${r}`;
      r++;
    }

    // Payout summary
    r++;
    const line = (label, value, formula) => {
      ws.getCell(`L${r}`).value = label; ws.getCell(`L${r}`).font = { name: "Calibri", size: 11, bold: true }; ws.getCell(`L${r}`).alignment = { horizontal: "right", vertical: "middle" };
      const cell = ws.getCell(`M${r}`);
      cell.value = formula ? { formula, result: value } : value;
      cell.numFmt = RM; cell.font = { name: "Calibri", size: 11, bold: true }; cell.alignment = CENTER;
      return `M${r++}`;
    };
    const parts = [`M${totalRow}`, `N${totalRow}`];
    if (overrideTotalCell) parts.push(overrideTotalCell);
    if (s.adjustments) parts.push(line("ADJUSTMENTS", s.adjustments));
    if (s.holds) parts.push(`-${line("WRONG-ITEM HOLDS", s.holds)}`);
    line("TOTAL PAYOUT", s.totalPayout, parts.join("+").replace(/\+-/g, "-"));

    // Pending — listed, never totalled
    if (s.pending.length) {
      r++;
      ws.getCell(`A${r}`).value = "PENDING — deposit below 30%, not payable this month (not in the totals)";
      ws.getCell(`A${r}`).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFB45309" } };
      r++;
      for (const row of s.pending) writeDataRow(ws, r++, row, { greyed: true });
    }
  }
  if (!report.sheets.length) wb.addWorksheet("NO COMMISSIONS");
  return wb;
}

export function reportFileName(report) {
  const { payoutMonthName, year } = report.labels;
  if (report.sheets.length === 1) return `${report.sheets[0].name} ${payoutMonthName} COMM ${year}.xlsx`.replace(/[\\/:*?"<>|]+/g, " ");
  return `Commission Payout ${payoutMonthName} ${year}.xlsx`;
}

/** Build and download the workbook in the browser. */
export async function downloadPayoutExcel(report) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = buildPayoutWorkbook(ExcelJS, report);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = reportFileName(report);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Print ───────────────────────────────────────────────────────────────────

const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const rm = n => `RM${(Number(n) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = n => `${((Number(n) || 0) * 100).toFixed(2)}%`;
const dmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

function htmlRow(row, cls = "") {
  return `<tr class="${cls}"><td>${dmy(row.order_date)}</td><td>${esc(row.location || "")}</td><td>${esc(row.so_number || "")}</td><td class="n b">${rm(row.amount)}</td><td class="n b">${rm(row.nett_total)}</td><td class="n">${rm(row.gst)}</td><td class="n">${rm(row.deposit)}</td><td class="n">${pct(row.deposit_pct)}</td><td class="n">${rm(row.balance)}</td><td class="c">${row.split}</td><td class="n b red">${rm(row.nett_sales)}</td><td class="c b">${pct((Number(row.tier_pct) || 0) / 100)}</td><td class="n b comm">${rm(row.nett_comm)}</td><td class="n">${rm(row.incentive)}</td><td class="l">${esc(row.remark || "")}</td></tr>`;
}

/** The whole report as one printable HTML document (one page section per person). */
export function payoutReportHtml(report, { companyName = "", filterNote = "" } = {}) {
  const head = `<tr>${HEADERS.map(h => `<th>${esc(h.trim())}</th>`).join("")}</tr>`;
  const sections = report.sheets.map(s => {
    const t = s.totals;
    const own = s.own.map(r => htmlRow(r)).join("") || `<tr><td colspan="15" class="c muted">No payable sales this month</td></tr>`;
    const totalRow = `<tr class="tot"><td></td><td></td><td class="c">TOTAL</td><td class="n">${rm(t.amount)}</td><td class="n">${rm(t.nett_total)}</td><td class="n">${rm(t.gst)}</td><td class="n">${rm(t.deposit)}</td><td></td><td class="n">${rm(t.balance)}</td><td></td><td class="n">${rm(t.nett_sales)}</td><td></td><td class="n">${rm(t.nett_comm)}</td><td class="n">${rm(t.incentive)}</td><td></td></tr>`;
    const overrides = s.overrides.length ? `<tr class="sec"><td colspan="15">OVERRIDES</td></tr>${s.overrides.map(r => htmlRow(r)).join("")}<tr class="tot"><td colspan="12" class="r">OVERRIDE TOTAL</td><td class="n">${rm(t.override_comm)}</td><td colspan="2"></td></tr>` : "";
    const summary = [
      s.adjustments ? `<tr><td colspan="12" class="r b">ADJUSTMENTS</td><td class="n b">${rm(s.adjustments)}</td><td colspan="2"></td></tr>` : "",
      s.holds ? `<tr><td colspan="12" class="r b">WRONG-ITEM HOLDS</td><td class="n b">-${rm(s.holds)}</td><td colspan="2"></td></tr>` : "",
      `<tr class="pay"><td colspan="12" class="r">TOTAL PAYOUT</td><td class="n">${rm(s.totalPayout)}</td><td colspan="2"></td></tr>`,
    ].join("");
    const pending = s.pending.length ? `<tr class="sec pend"><td colspan="15">PENDING — deposit below 30%, not payable this month (not in the totals)</td></tr>${s.pending.map(r => htmlRow(r, "pend")).join("")}` : "";
    return `<section><table><thead><tr class="title"><td colspan="2">${esc(s.name)} COMM</td><td colspan="13">${esc(report.labels.payout)} COMM TOTAL SALES ${rm(t.nett_sales)}</td></tr>${head}</thead><tbody>${own}${totalRow}${overrides}${summary}${pending}</tbody></table></section>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Commission Payout ${esc(report.labels.payout)}</title><style>
@page{size:A4 landscape;margin:8mm}body{font-family:Calibri,Arial,sans-serif;font-size:9px;margin:0}
.meta{color:#555;margin:0 0 6px}section{page-break-after:always}section:last-child{page-break-after:auto}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:3px 4px;text-align:center;vertical-align:middle;white-space:nowrap}
th{background:#b6d7a8;font-weight:400}.title td{background:#d9ead3;font-weight:700;font-size:11px;text-align:left}
.n{text-align:right}.c{text-align:center}.l{text-align:left;white-space:normal}.r{text-align:right}.b{font-weight:700}.red{color:#f00}
.comm{background:#6aa84f;color:#ff0}.tot td{font-weight:700;border-top:2px solid #333}.pay td{font-weight:700;font-size:11px;background:#f3f0ff}
.sec td{text-align:left;font-weight:700;background:#fafafa}.pend td{color:#999;font-style:italic}.pend.sec td{color:#b45309;font-style:normal}.muted{color:#999}
</style></head><body><p class="meta">${esc(companyName)} · Commission Payout ${esc(report.labels.payout)} · orders dated ${esc(report.labels.sheetMonth)}${filterNote ? ` · ${esc(filterNote)}` : ""}</p>${sections || "<p>No commissions.</p>"}</body></html>`;
}
