// Delivery Schedule → Download PDF: same scope, rows and cell content as the
// Print Schedule sheet; a real text PDF that paginates without losing stops.
// jsdom lacks TextEncoder/TextDecoder, which jsPDF needs — set them before
// the modules load (require, not import, so the order is guaranteed).
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
const fs = require("fs");
const path = require("path");
const { renderToStaticMarkup } = require("react-dom/server");
const { jsPDF } = require("jspdf");
const { __createTable, __drawTable } = require("jspdf-autotable");
const { TeamPrintView, buildTeamScheduleRows, teamScheduleStopCells } = require("./DeliverySchedule");
const { buildTeamSchedulePdf, teamSchedulePdfFileName, SCHEDULE_FONT_FILES } = require("./teamSchedulePdf");

const fontB64 = f => fs.readFileSync(path.join(__dirname, "..", "public", "fonts", f)).toString("base64");
const fonts = { regular: fontB64(SCHEDULE_FONT_FILES.regular), bold: fontB64(SCHEDULE_FONT_FILES.bold) };
const OUT = process.env.SCHED_PDF_OUT; // set to a directory to write the fixture PDFs for visual checks

const items = (...names) => JSON.stringify(names.map((n, i) => ({ itemCode: `CODE-${i + 1}`, itemName: n, unit: String(i + 1), supplier: "Supplier A", arrivalDate: i % 2 ? null : "2026-09-30" })));
const stop = (id, orders, extra = {}) => ({ id, sort_order: id, slot: null, trip_no: 1, total_trips: 1, orders: { id: 1000 + id, balance: 0, contact: "012-345 6789", salesman: "Austin", ...orders }, ...extra });
const LONG_DESC = "Bespoke Chesterfield 3-Seater Sofa in Cognac aniline leather, hand-finished solid oak frame with dovetail joints, feather-wrapped HR foam cushions, removable back cushions — deliver fully assembled";
const SVC_NOTE_LONG = Array.from({ length: 6 }, (_, k) => `Line ${k + 1}: 客户要求下午三点后送货，service lift only, level 23, guard house needs 24h notice.`).join("\n");

const serviceTeam = {
  vehicle_plate: "PKM 1234", driver_name: "Ali", area: "Kulai", team_date: "2026-10-02",
  schedules: [
    stop(1, { so_number: "SO-30001", customer_name: "Tan Mei Ling", address: "No. 12, Jalan Bukit Indah 3/5, 81200 Johor Bahru", type: "Delivery", remark: "Call before delivery.\nUse back gate.", items: items("ALESSIO 12.5\" Pocket Spring Mattress Queen", "Bedframe Divan King") }, { slot: "10:00-12:00" }),          // A. normal SO
    stop(2, { so_number: "SV-1001", customer_name: "Lim Ah Kow", type: "Service", linked_so: "56190", service_note: "Linked to SO: 56190 | Replace sofa leg (front left)", remark: "Linked to SO: 56190 | Replace sofa leg (front left)", items: JSON.stringify([{ itemName: "Sofa leg — replace", unit: "1", service_item: true, action_type: 2, action_label: "Service", item_status: "done" }, { itemName: "Leg screws", unit: "4", service_item: true, action_type: 3, action_label: "Claim" }]) }),                                     // B. service WITH items
    stop(3, { so_number: "SV-1002", customer_name: "Wong Siew Lan", type: "Service", linked_so: "56001", service_note: "Linked to SO: 56001 | Adjust wardrobe door alignment", items: "[]" }),                                                                  // C. service WITHOUT items
    stop(4, { so_number: "SV-1003", customer_name: "Ng Kok Wah", type: "Service", linked_so: "55732 55733", service_note: "Linked to SO: 55732 55733 | Call 30 min before.\nBring replacement leg.\nQC before leaving.", items: items("Cushion zip repair") }), // D+E. multi-line note, multi SO
    stop(5, { so_number: "SV-1004", customer_name: "Chong Wei", type: "Service", linked_so: "55908 55909", service_note: "Linked to SO: 55908 55909", items: items("Drawer runner") }),                                                                          // F. no note
    stop(6, { so_number: "SV-1005", customer_name: "Siti Aminah binti Abdullah", type: "Service", linked_so: "55801", service_note: `Linked to SO: 55801 | ${SVC_NOTE_LONG}`, items: items("P-11 抽屉要调一下", "Island chair tighten") }),                       // G. long note (CJK)
  ],
};
const longTeam = {
  vehicle_plate: "JQX 8899", driver_name: "Muthu", area: "Johor Bahru", team_date: "2026-10-03",
  schedules: Array.from({ length: 36 }, (_, i) => stop(i + 1, {
    so_number: `SO-${40000 + i}`,
    customer_name: i % 5 === 0 ? "Muhammad Hafiz bin Abdul Rahman Shah Al-Haj (Mr & Mrs) c/o Lakeshore Condominium Management Office" : `Customer ${i + 1}`,
    address: i % 4 === 0 ? "Lot 1234, Block C, Lakeshore Condominium, 31 Jurong West Street 41 #14-37, Taman Perindustrian Senai, 81400 Senai, Johor Darul Takzim" : "Kulai",
    balance: i % 3 === 0 ? 1234.5 : 0, type: "Delivery",
    remark: i % 6 === 0 ? "1. st06 coffee table x 1 unit -walnut\n2. 锁island chair给他紧\n3. 顾客讲第一层关不紧 第二层特别出" : "",
    items: items(...Array.from({ length: 1 + (i % 4) }, (_, k) => (k === 0 && i % 7 === 0 ? LONG_DESC : `Item ${k + 1} for stop ${i + 1}`))),
  }, i % 9 === 0 ? { notes: "Dispatcher: deliver after 3pm" } : {})),
};
const shortTeam = { vehicle_plate: "WXY 1", driver_name: "Kumar", area: "Kulai", team_date: "2026-10-01", schedules: serviceTeam.schedules.slice(0, 2) };

function build(team, onStopDrawn) {
  return buildTeamSchedulePdf({ jsPDF, createTable: __createTable, drawTable: __drawTable, team, company: { name: "V-HAUS LIVING SDN BHD" }, fonts, printedAt: new Date("2026-10-01T08:00:00Z"), onStopDrawn });
}
const groupsOf = (team) => { const g = []; let cur = null; for (const r of buildTeamScheduleRows(team)) { if (r.isFirst) { cur = { o: r.o, sc: r.sc, rows: [] }; g.push(cur); } if (cur) cur.rows.push(r); } return g; };

// Text lines of a print-sheet cell: its top-level <div>s, entity-decoded.
const decode = s => s.replace(/<!-- -->/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'");
const divTexts = html => [...html.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g)].map(m => decode(m[1]));
function printStopCells(team) {
  const html = renderToStaticMarkup(<TeamPrintView team={team} onClose={() => {}} company={{}} />);
  return html.split('class="order-block"').slice(1).map(block => {
    const firstRow = block.slice(block.indexOf("<tr"), block.indexOf("</tr>"));
    const spanned = [...firstRow.matchAll(/<td rowSpan="\d+"[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    return { info: divTexts(spanned[0]), remark: divTexts(spanned[spanned.length - 1]) };
  });
}

describe("Delivery Schedule PDF — same content as Print", () => {
  test.each([["service cases A–G", serviceTeam], ["long schedule", longTeam]])("%s: stop cells match the printed sheet exactly", (_, team) => {
    const print = printStopCells(team);
    const groups = groupsOf(team);
    expect(print).toHaveLength(groups.length);
    groups.forEach((g, i) => {
      const cells = teamScheduleStopCells(g.o, g.sc, g.rows, team);
      expect(cells.info.map(p => p.text)).toEqual(print[i].info);
      expect(cells.remark.map(p => p.text)).toEqual(print[i].remark);
    });
  });

  test("Service rules: Remark = Linked SO + note when items exist; note as Item (not repeated) when none", () => {
    const g = groupsOf(serviceTeam);
    const remark = i => teamScheduleStopCells(g[i].o, g[i].sc, g[i].rows, serviceTeam).remark.map(p => p.text);
    expect(remark(0)).toEqual(["Call before delivery.\nUse back gate."]);                                            // A
    expect(remark(1)).toEqual(["Linked SO: 56190", "Replace sofa leg (front left)"]);                               // B
    expect(remark(2)).toEqual(["Linked SO: 56001"]);                                                                // C
    expect(g[2].rows.map(r => r.item.itemName)).toEqual(["Adjust wardrobe door alignment"]);                        // C — note is the Item
    expect(remark(3)).toEqual(["Linked SO: 55732 55733", "Call 30 min before.\nBring replacement leg.\nQC before leaving."]); // D + E
    expect(remark(4)).toEqual(["Linked SO: 55908 55909"]);                                                          // F
    expect(remark(5)[1]).toBe(SVC_NOTE_LONG);                                                                      // G
  });
});

describe("Delivery Schedule PDF — document", () => {
  const run = (name, team) => {
    const drawn = [];
    const doc = build(team, (g, info) => drawn.push({ so: g.o.so_number, ...info }));
    const bytes = Buffer.from(doc.output("arraybuffer"));
    if (OUT) fs.writeFileSync(path.join(OUT, `${name}.pdf`), bytes);
    return { doc, drawn, bytes };
  };

  test("real PDF, A4 landscape, every stop drawn once in schedule order", () => {
    for (const [name, team] of [["short", shortTeam], ["service", serviceTeam], ["long", longTeam]]) {
      const { doc, drawn, bytes } = run(name, team);
      expect(bytes.slice(0, 5).toString()).toBe("%PDF-");
      expect(bytes.includes(Buffer.from("/FontFile2"))).toBe(true);       // embedded TrueType text, not an image
      expect(bytes.includes(Buffer.from("/Subtype /Image"))).toBe(false);
      const { width, height } = doc.internal.pageSize;
      expect([Math.round(width), Math.round(height)]).toEqual([297, 210]);
      expect(drawn.map(d => d.so)).toEqual(groupsOf(team).map(g => g.o.so_number));
    }
  });

  test("short schedule fits one page; long schedule paginates and keeps every stop whole", () => {
    expect(run("short", shortTeam).doc.getNumberOfPages()).toBe(1);
    const { doc, drawn } = run("long", longTeam);
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    for (const d of drawn) expect(d.lastPage).toBe(d.firstPage); // no stop split across a page boundary
    expect(drawn[drawn.length - 1].lastPage).toBe(doc.getNumberOfPages());
  });

  test("exports exactly the team + date it was given (the Print scope)", () => {
    const { drawn } = run("short", shortTeam);
    expect(drawn.map(d => d.so)).toEqual(["SO-30001", "SV-1001"]);
  });

  test("deterministic, filename-safe name: Delivery-Schedule-<date>-<plate>-<driver>.pdf", () => {
    expect(teamSchedulePdfFileName(serviceTeam)).toBe("Delivery-Schedule-2026-10-02-PKM-1234-Ali.pdf");
    expect(teamSchedulePdfFileName({ team_date: "2026-10-02", vehicle_plate: "A/B:C*?" })).toBe("Delivery-Schedule-2026-10-02-A-B-C.pdf");
    expect(teamSchedulePdfFileName({})).toBe("Delivery-Schedule-undated-Team.pdf");
  });
});
