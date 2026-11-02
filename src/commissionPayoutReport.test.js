// Commission Payout Report: the Excel workbook is built, written to bytes and read back with ExcelJS,
// so these checks are on the real file a user downloads — layout, formulas, formats, totals.
import ExcelJS from "exceljs";
import { buildPayoutReport, buildPayoutWorkbook, payoutReportHtml, reportMonthLabels, reportFileName } from "./commissionPayoutReport";

// Report rows exactly as GET /commission-payout?report=1 returns them.
const row = (o) => ({
  commission_id: o.id, order_id: 1, status: "eligible", section: "payable", kind: "own",
  order_date: "2026-06-14", location: "SG", so_number: "10001", amount: 10900, nett_total: 10000, gst: 900,
  deposit: 5450, deposit_pct: 0.5, balance: 5450, split: 2, nett_sales: 5000, tier_pct: 8, nett_comm: 400,
  incentive: 50, commission_amt: 450, remark: "Austin/Aliff; Dunlopillo Cool Luxe King x1", ...o,
});
const austin = {
  user_id: "u-austin", name: "Austin", role: "salesman", total: 0,
  commissions: [
    { id: "c2", report: row({ id: "c2", so_number: "10009", order_date: "2026-06-20", location: "JB", amount: 3000, nett_total: 3000, gst: 0, deposit: 1500, deposit_pct: 0.5, balance: 1500, split: 1, nett_sales: 3000, tier_pct: 5, nett_comm: 150, incentive: 0, commission_amt: 150, remark: "Austin" }) },
    { id: "c1", report: row({ id: "c1" }) },
    { id: "c3", report: row({ id: "c3", status: "pending", section: "pending", so_number: "10010", amount: 2000, nett_total: 2000, gst: 0, deposit: 200, deposit_pct: 0.1, balance: 1800, split: 1, nett_sales: 2000, tier_pct: 5, nett_comm: 100, incentive: 0, commission_amt: 100, remark: "Austin" }) },
    { id: "c4", report: row({ id: "c4", kind: "override", so_number: "20001", split: 1, nett_total: 4000, nett_sales: 4000, tier_pct: 1, nett_comm: 40, incentive: 0, commission_amt: 40, remark: "Bob — branch override" }) },
    // Clearance commission: paid amount differs from NETT SALES × TIER → written as a value, not K×L.
    { id: "c5", report: row({ id: "c5", so_number: "10011", order_date: "2026-06-25", location: "JB", amount: 1000, nett_total: 1000, gst: 0, deposit: 1000, deposit_pct: 1, balance: 0, split: 1, nett_sales: 1000, tier_pct: 5, nett_comm: 62.5, incentive: 0, commission_amt: 62.5, remark: "Austin" }) },
  ],
  adjustments: [{ commission_id: "c1", delta_amt: 20 }, { commission_id: "c3", delta_amt: 999 }],
  holds: [{ commission_id: "c2", status: "held", held_amt: 30 }, { commission_id: "c2", status: "released", held_amt: 500 }],
};
// payout total as the backend computes it: payable commission_amt + adjustments − held, payable only
austin.total = 450 + 150 + 40 + 62.5 + 20 - 30;

async function readBack(report) {
  const wb = buildPayoutWorkbook(ExcelJS, report);
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  return back;
}
const v = (ws, a) => { const x = ws.getCell(a).value; return x && typeof x === "object" && "result" in x ? x.result : x; };
const formula = (ws, a) => ws.getCell(a).value?.formula;
const findRow = (ws, col, text) => { for (let r = 1; r <= ws.rowCount; r++) if (String(v(ws, `${col}${r}`) ?? "") === text) return r; return -1; };

describe("month labels", () => {
  test("payout month names the title; the previous (order) month names the sheet", () => {
    expect(reportMonthLabels("2026-07-01")).toMatchObject({ payout: "JULY 2026", sheetMonth: "JUN 26" });
    expect(reportMonthLabels("2027-01-01")).toMatchObject({ payout: "JANUARY 2027", sheetMonth: "DEC 26" });
  });
});

describe("report data", () => {
  const report = buildPayoutReport([austin], "2026-07-01");
  const s = report.sheets[0];
  test("payable own rows sorted by date then SO; overrides and pending kept apart", () => {
    expect(s.own.map(r => r.so_number)).toEqual(["10001", "10009", "10011"]);
    expect(s.overrides.map(r => r.so_number)).toEqual(["20001"]);
    expect(s.pending.map(r => r.so_number)).toEqual(["10010"]);
  });
  test("totals cover own payable rows only; pending never counted", () => {
    expect(s.totals).toMatchObject({ amount: 14900, nett_total: 14000, gst: 900, nett_sales: 9000, nett_comm: 612.5, incentive: 50, override_comm: 40 });
  });
  test("adjustments / holds only for payable commissions; TOTAL PAYOUT equals the payout page total", () => {
    expect(s.adjustments).toBe(20);
    expect(s.holds).toBe(30);
    expect(s.totalPayout).toBeCloseTo(austin.total, 2);
  });
  test("file name follows the business's own naming for one person", () => {
    expect(reportFileName(report)).toBe("Austin JULY COMM 2026.xlsx");
    expect(reportFileName(buildPayoutReport([austin, { ...austin, user_id: "x", name: "Aliff" }], "2026-07-01"))).toBe("Commission Payout JULY 2026.xlsx");
  });
});

describe("Excel workbook (written and read back)", () => {
  let ws;
  beforeAll(async () => {
    const back = await readBack(buildPayoutReport([austin], "2026-07-01"));
    ws = back.worksheets[0];
  });

  test("sheet named '<NAME> <ORDER MON YY>' like the template", () => {
    expect(ws.name).toBe("AUSTIN JUN 26");
  });
  test("row 1 title band and row 2 headers match the template", () => {
    expect(v(ws, "A1")).toBe("Austin COMM");
    expect(v(ws, "B1")).toBe("JULY 2026 COMM TOTAL SALES ");
    expect(v(ws, "D1")).toBe(9000);
    expect(ws.getCell("A1").fill.fgColor.argb).toBe("FFD9EAD3");
    expect([..."ABCDEFGHIJKLMNO"].map(c => v(ws, `${c}2`))).toEqual(["DATE ", "LOCATION", "SO NUMBER", "AMOUNT ", "NETT TOTAL", "GST", "DEPOSIT", "DEPOSIT (%)", "BALANCE", "SPLIT", "NETT SALES", "TIER", "NETT COMM", "INCENTIVE", "REMARK"]);
    expect(ws.getCell("O2").fill.fgColor.argb).toBe("FFB6D7A8");
  });
  test("first data row: every column, value and format", () => {
    expect(v(ws, "A3")).toEqual(new Date(Date.UTC(2026, 5, 14)));
    expect(v(ws, "B3")).toBe("SG");
    expect(v(ws, "C3")).toBe("10001");
    expect(v(ws, "D3")).toBe(10900);
    expect(v(ws, "E3")).toBe(10000);
    expect(formula(ws, "E3")).toBe('IF(B3="SG",D3/1.09,D3)');
    expect(v(ws, "F3")).toBe(900);
    expect(formula(ws, "F3")).toBe("D3-E3");
    expect(v(ws, "G3")).toBe(5450);
    expect(v(ws, "H3")).toBe(0.5);
    expect(v(ws, "I3")).toBe(5450);
    expect(v(ws, "J3")).toBe(2);
    expect(v(ws, "K3")).toBe(5000);
    expect(formula(ws, "K3")).toBe("E3/J3");
    expect(v(ws, "L3")).toBe(0.08);
    expect(v(ws, "M3")).toBe(400);
    expect(formula(ws, "M3")).toBe("K3*L3");
    expect(v(ws, "N3")).toBe(50);
    expect(v(ws, "O3")).toBe("Austin/Aliff; Dunlopillo Cool Luxe King x1");
    expect(ws.getCell("D3").numFmt).toBe("[$RM]#,##0.00");
    expect(ws.getCell("H3").numFmt).toBe("0.00%");
    expect(ws.getCell("L3").numFmt).toBe("0.00%");
    expect(ws.getCell("M3").fill.fgColor.argb).toBe("FF6AA84F");
    expect(ws.getCell("D3").fill.fgColor.argb).toBe("FFFFF2CC");
  });
  test("NETT COMM that is not NETT SALES × TIER (clearance) is the paid value, not a formula", () => {
    const r = findRow(ws, "C", "10011");
    expect(v(ws, `M${r}`)).toBe(62.5);
    expect(formula(ws, `M${r}`)).toBeUndefined();
  });
  test("TOTAL row sums the own rows; TOTAL PAYOUT = comm + incentive + overrides + adjustments − holds", () => {
    const t = findRow(ws, "C", "TOTAL");
    expect(formula(ws, `K${t}`)).toBe("SUM(K3:K5)");
    expect(v(ws, `K${t}`)).toBe(9000);
    expect(v(ws, `M${t}`)).toBe(612.5);
    expect(v(ws, `N${t}`)).toBe(50);
    const p = findRow(ws, "L", "TOTAL PAYOUT");
    expect(v(ws, `M${p}`)).toBeCloseTo(austin.total, 2);
    expect(formula(ws, `M${p}`)).toMatch(/^M\d+\+N\d+\+M\d+\+M\d+-M\d+$/);
  });
  test("overrides listed in their own block; pending listed after, greyed and not in any SUM", () => {
    const o = findRow(ws, "C", "OVERRIDES");
    expect(o).toBeGreaterThan(findRow(ws, "C", "TOTAL"));
    expect(v(ws, `C${o + 1}`)).toBe("20001");
    const pendLabel = findRow(ws, "A", "PENDING — deposit below 30%, not payable this month (not in the totals)");
    const pr = findRow(ws, "C", "10010");
    expect(pr).toBeGreaterThan(pendLabel);
    expect(ws.getCell(`D${pr}`).font.color.argb).toBe("FF999999");
    expect(pr).toBeGreaterThan(findRow(ws, "L", "TOTAL PAYOUT"));
  });
  test("one sheet per person, unique names", async () => {
    const back = await readBack(buildPayoutReport([austin, { ...austin, user_id: "u2" }, { ...austin, user_id: "u3", name: "Aliff" }], "2026-07-01"));
    expect(back.worksheets.map(w => w.name)).toEqual(["AUSTIN JUN 26", "AUSTIN JUN 26 (2)", "ALIFF JUN 26"]);
  });
  test("a person with no payable rows still gets a valid sheet with zero totals", async () => {
    const back = await readBack(buildPayoutReport([{ user_id: "z", name: "Zed", commissions: [], adjustments: [], holds: [], total: 0 }], "2026-07-01"));
    const z = back.worksheets[0];
    const cell = z.getCell(`M${findRow(z, "L", "TOTAL PAYOUT")}`).value;
    // ExcelJS does not store a 0 formula result; Excel recalculates it on open (fullCalcOnLoad).
    expect(cell.formula).toBe("M4+N4");
    expect(cell.result === undefined || cell.result === 0).toBe(true);
    expect(v(z, "M4")).toBe(0);
  });
  test("the workbook asks Excel to recalculate on open", async () => {
    // ExcelJS does not read calcPr back, so check the file's own workbook.xml (jszip ships with exceljs).
    const JSZip = require("jszip");
    const buf = await buildPayoutWorkbook(ExcelJS, buildPayoutReport([austin], "2026-07-01")).xlsx.writeBuffer();
    const xml = await (await JSZip.loadAsync(buf)).file("xl/workbook.xml").async("string");
    expect(xml).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  });
});

describe("print page", () => {
  test("same columns, totals and sections; text is escaped", () => {
    const evil = { ...austin, name: "<b>Austin</b>", commissions: [{ id: "c1", report: row({ id: "c1", remark: "A & B <script>" }) }], adjustments: [], holds: [] };
    const html = payoutReportHtml(buildPayoutReport([evil], "2026-07-01"));
    expect(html).toContain("&lt;b&gt;Austin&lt;/b&gt; COMM");
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("JULY 2026 COMM TOTAL SALES RM5,000.00");
    for (const h of ["DATE", "LOCATION", "SO NUMBER", "NETT TOTAL", "DEPOSIT (%)", "NETT SALES", "TIER", "NETT COMM", "INCENTIVE", "REMARK"]) expect(html).toContain(`<th>${h}</th>`);
    expect(html).toContain("14/06/2026");
    expect(html).toContain("TOTAL PAYOUT");
  });
});
