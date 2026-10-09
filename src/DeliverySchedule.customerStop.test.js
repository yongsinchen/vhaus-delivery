// Deliver Together → ONE Customer Stop on the Delivery Schedule (screen rows,
// Print, PDF, Excel). Delivery-layer grouping only: every SO / DO stays its
// own child with its own items, quantities, remarks and arrival.
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { renderToStaticMarkup } = require("react-dom/server");
const { jsPDF } = require("jspdf");
const { __createTable, __drawTable } = require("jspdf-autotable");
const {
  annotateLinkGroups, groupLinkedStops, buildTeamScheduleRows, teamScheduleStopUnits, teamScheduleStopCells,
  TeamPrintView, exportTeamScheduleExcel, parseTeamScheduleWorkbook,
} = require("./DeliverySchedule");
const { buildTeamSchedulePdf, SCHEDULE_FONT_FILES } = require("./teamSchedulePdf");

const OUT = process.env.STOP_OUT; // directory → write fixture HTML / PDF / XLSX for visual checks
const fontB64 = f => fs.readFileSync(path.join(__dirname, "..", "public", "fonts", f)).toString("base64");
const fonts = { regular: fontB64(SCHEDULE_FONT_FILES.regular), bold: fontB64(SCHEDULE_FONT_FILES.bold) };

const items = (...xs) => JSON.stringify(xs.map(([n, q], i) => ({ itemCode: `C-${i + 1}`, itemName: n, unit: String(q), supplier: "Sup", arrivalDate: i % 2 ? null : "2026-09-30" })));
const ABC = { customer_name: "ABC Furniture Lover", contact: "012-111 2222", address: "No. 1, Jalan Indah, 81200 Johor Bahru", balance: 0, salesman: "Austin", type: "Delivery" };
let nextId = 1;
const legacy = (so, extra = {}) => ({ id: 5000 + nextId++, so_number: so, ...ABC, ...extra });
// A DO stop: sc.orders = the SO's legacy order row, sc.delivery_orders = the DO.
const doStop = (sort, o, doNo, doItems, extra = {}) => ({
  id: 9000 + nextId++, sort_order: sort, slot: null, orders: o,
  delivery_orders: { id: `do-${doNo}`, do_number: doNo, sales_order_id: `so-${o.so_number}`, remark: extra.doRemark || "", delivery_order_items: doItems.map(([n, q], i) => ({ product_code: `P-${i + 1}`, product_name: n, quantity: q, status: "pending" })), superseded_at: extra.superseded ? "2026-09-30T00:00:00Z" : null },
});
const legacyStop = (sort, o, extra = {}) => ({ id: 9000 + nextId++, sort_order: sort, slot: null, orders: o, ...extra });

const LONG = "Bespoke Chesterfield 3-Seater Sofa in Cognac aniline leather, hand-finished solid oak frame with dovetail joints, feather-wrapped HR foam cushions — deliver fully assembled";
const so1 = legacy("SO1001"), so2 = legacy("SO1002"), so3 = legacy("SO1003");
const svcSo = legacy("SV-2001", { type: "Service", linked_so: "SO1001", service_note: "Linked to SO: SO1001 | 客户要求下午三点后送货\nReplace sofa leg.", items: items(["Sofa leg", 2]) });
const other = legacy("SO2001", { customer_name: "Other Customer", contact: "019-999", address: "Kulai" });
const sameCustUnlinked = legacy("SO3001"); // same customer details, NOT linked

const team = {
  id: "T1", team_date: "2026-10-05", vehicle_plate: "JQX 8899", driver_name: "Muthu", area: "JB",
  schedules: [
    legacyStop(1, other, { orders: { ...other, items: items(["Bedframe", 1]) } }),
    doStop(2, so1, "DO2609-0001", [["Item A", 1], ["Item B", 2]], { doRemark: "Call before arrival" }),
    legacyStop(3, sameCustUnlinked, { orders: { ...sameCustUnlinked, items: items(["Side table", 1]) } }),
    doStop(4, so2, "DO2609-0002", [["Item C", 1]], { doRemark: "Use back gate\nLift at block B" }),
    doStop(5, so3, "DO2609-0003", [[LONG, 1], ["Cushion", 4]]),
    legacyStop(6, svcSo),
  ],
};
// One live Deliver Together group with SO1001 / SO1002 / SO1003 (+ a member
// scheduled elsewhere, which must never be pulled in) and a second group whose
// only scheduled member is the Service order.
const groups = [
  { link_group_id: "G-ABC", requested_date: "2026-10-05", members: [
    { so_number: "SO1001", order_id: so1.id, sales_order_id: "so-SO1001" },
    { so_number: "SO1002", order_id: so2.id, sales_order_id: "so-SO1002" },
    { so_number: "SO1003", order_id: so3.id, sales_order_id: "so-SO1003" },
    { so_number: "SO9999", order_id: 424242, sales_order_id: "so-elsewhere" },
  ] },
  { link_group_id: "G-SVC", requested_date: "2026-10-05", members: [{ so_number: "SV-2001", order_id: svcSo.id }, { so_number: "SO7777", order_id: 777777 }] },
];
const [linkedTeam] = annotateLinkGroups([team], groups);
const unitsOf = t => teamScheduleStopUnits(buildTeamScheduleRows(t));
const soList = u => u.children.map(c => c.o.so_number);

describe("grouping core", () => {
  test("1/2/15. three linked DOs → ONE customer stop with three children; others unchanged, order kept", () => {
    const units = unitsOf(linkedTeam);
    expect(units.map(u => u.grouped)).toEqual([false, true, false, false]);
    expect(units.map(soList)).toEqual([
      ["SO2001"],
      ["SO1001 · DO2609-0001", "SO1002 · DO2609-0002", "SO1003 · DO2609-0003"],
      ["SO3001"],
      ["SV-2001"],
    ]);
    expect(units.map(u => u.stopNo)).toEqual([1, 2, 3, 4]); // one route position for the group; next customer is Stop 3
  });

  test("3. same customer, NOT linked → its own stop", () => {
    expect(unitsOf(linkedTeam)[2].children[0].o.so_number).toBe("SO3001");
  });

  test("4/5. linked members on another team / date are separate (grouping is per team list)", () => {
    const teamB = { ...team, id: "T2", schedules: [team.schedules[3]] };
    const [, b] = annotateLinkGroups([team, teamB], groups);
    expect(unitsOf(b).map(u => u.grouped)).toEqual([false]);
    const otherDate = { ...team, team_date: "2026-10-06", schedules: [team.schedules[1]] };
    expect(unitsOf(annotateLinkGroups([otherDate], groups)[0]).map(u => u.grouped)).toEqual([false]);
  });

  test("6/D. only one member on this schedule → a normal stop; a member scheduled elsewhere is never pulled in", () => {
    const solo = { ...team, schedules: [team.schedules[1], team.schedules[0]] };
    const units = unitsOf(annotateLinkGroups([solo], groups)[0]);
    expect(units.map(u => u.grouped)).toEqual([false, false]);
    expect(units.flatMap(soList)).not.toContain("SO9999");
    expect(unitsOf(linkedTeam).flatMap(soList)).not.toContain("SO9999");
    // G-SVC's other member isn't here → the Service order is an ordinary stop
    expect(unitsOf(linkedTeam)[3].grouped).toBe(false);
  });

  test("7/E. superseded DO never joins; the regenerated active DO is the group member", () => {
    const regen = { ...team, schedules: [
      doStop(1, so1, "DO-OLD", [["Item A", 1]], { superseded: true }),
      doStop(2, so1, "DO-NEW", [["Item A", 1]]),
      doStop(3, so2, "DO2609-0002", [["Item C", 1]]),
    ] };
    const t = annotateLinkGroups([regen], groups)[0];
    const units = unitsOf(t);
    expect(units).toHaveLength(1); // superseded row excluded from the sheet entirely
    expect(units[0].grouped).toBe(true);
    expect(soList(units[0])).toEqual(["SO1001 · DO-NEW", "SO1002 · DO2609-0002"]);
    // screen-level grouping keeps the superseded row as its own (labelled) stop
    const screen = groupLinkedStops(t.schedules);
    expect(screen.map(u => u.length)).toEqual([1, 2]);
  });

  test("16. company isolation: grouping only matches this company's own ids from /delivery-links", () => {
    const foreign = [{ link_group_id: "G-X", requested_date: "2026-10-05", members: [{ so_number: "SO1001", order_id: 1, sales_order_id: "other-co-so" }, { so_number: "SO1002", order_id: 2 }] }];
    expect(unitsOf(annotateLinkGroups([team], foreign)[0]).every(u => !u.grouped)).toBe(true); // same SO numbers, different ids → no grouping
  });

  test("SO/DO independence: items, quantities and remarks stay with their own child", () => {
    const g = unitsOf(linkedTeam)[1];
    expect(g.children.map(c => c.rows.map(r => `${r.item.itemName}×${r.item.unit}`))).toEqual([
      ["Item A×1", "Item B×2"], ["Item C×1"], [`${LONG}×1`, "Cushion×4"],
    ]);
    const remarks = g.children.map(c => teamScheduleStopCells(c.o, c.sc, c.rows, linkedTeam).remark.map(p => p.text));
    expect(remarks).toEqual([["Call before arrival"], ["Use back gate\nLift at block B"], []]);
    // customer shown once (banner), not per child
    const info = teamScheduleStopCells(g.children[0].o, g.children[0].sc, g.children[0].rows, linkedTeam, { bannerAddress: ABC.address }).info.map(p => p.text);
    expect(info).toEqual(["SO1001 · DO2609-0001"]);
  });
});

describe("Service per child", () => {
  test("8/9. Service stays on its own child; a non-Service child gets none (no duplication)", () => {
    const svcA = legacy("SV-A", { type: "Service", linked_so: "SO5001", service_note: "Linked to SO: SO5001 | Service A — fix drawer\n第二行", items: items(["Drawer runner", 1]) });
    const svcB = legacy("SV-B", { type: "Service", linked_so: "SO5002", service_note: "Linked to SO: SO5002 | Service B — tighten bed", items: "[]" });
    const plain = legacy("SO5003");
    const t = annotateLinkGroups([{ ...team, schedules: [legacyStop(1, svcA), legacyStop(2, svcB), doStop(3, plain, "DO-5003", [["Wardrobe", 1]])] }],
      [{ link_group_id: "G-S", requested_date: "2026-10-05", members: [{ order_id: svcA.id }, { order_id: svcB.id }, { order_id: plain.id }] }])[0];
    const [unit] = unitsOf(t);
    expect(unit.grouped).toBe(true);
    const remark = c => teamScheduleStopCells(c.o, c.sc, c.rows, t).remark.map(p => p.text);
    expect(remark(unit.children[0])).toEqual(["Service A — fix drawer\n第二行"]);          // linked SO is under the Service number now
    expect(remark(unit.children[1])).toEqual([]);                                         // note is its Item, not repeated
    expect(teamScheduleStopCells(unit.children[0].o, unit.children[0].sc, unit.children[0].rows, t).info.map(p => p.text).slice(0, 2)).toEqual(["SV-A", "Linked SO: SO5001"]);
    expect(unit.children[1].rows.map(r => r.item.itemName)).toEqual(["Service B — tighten bed"]);
    expect(remark(unit.children[2])).toEqual([]);                                         // no Service on the plain DO
    const all = JSON.stringify(unit.children.map(remark));
    expect(all.split("Service A").length - 1).toBe(1);
    expect(all.split("Service B").length - 1).toBe(0);
  });
});

describe("outputs", () => {
  test("12. Print: one order-block for the group with a banner; ungrouped stops unchanged", () => {
    const html = renderToStaticMarkup(<TeamPrintView team={linkedTeam} onClose={() => {}} company={{}} />);
    if (OUT) fs.writeFileSync(path.join(OUT, "print.html"), `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;width:281mm}table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:10px}</style></head><body>${html}</body></html>`);
    const blocks = html.split('class="order-block"').slice(1);
    expect(blocks).toHaveLength(4);
    expect((blocks[1].match(/customer-stop-banner/g) || [])).toHaveLength(1);
    expect(blocks[1]).toContain("Customer stop — deliver together · 3 orders");
    for (const so of ["SO1001 · DO2609-0001", "SO1002 · DO2609-0002", "SO1003 · DO2609-0003"]) expect(blocks[1]).toContain(so);
    expect(blocks[1].split("ABC Furniture Lover").length - 1).toBe(1); // customer once
    for (const i of [0, 2, 3]) expect(blocks[i]).not.toContain("customer-stop-banner");
    expect(blocks[2]).toContain("ABC Furniture Lover"); // unlinked same-customer stop keeps its own customer line
  });

  test("13. PDF: one drawn stop for the group, kept on one page", () => {
    const drawn = [];
    const doc = buildTeamSchedulePdf({ jsPDF, createTable: __createTable, drawTable: __drawTable, team: linkedTeam, company: { name: "V-HAUS" }, fonts, printedAt: new Date("2026-10-01T08:00:00Z"), onStopDrawn: (g, info) => drawn.push({ grouped: g.grouped, n: g.children.length, ...info }) });
    if (OUT) fs.writeFileSync(path.join(OUT, "stop.pdf"), Buffer.from(doc.output("arraybuffer")));
    expect(drawn.map(d => d.n)).toEqual([1, 3, 1, 1]);
    expect(drawn[1].firstPage).toBe(drawn[1].lastPage);
  });

  test("PDF: a grouped stop near the page boundary moves whole to the next page", () => {
    const filler = Array.from({ length: 9 }, (_, i) => legacyStop(i + 1, { ...other, so_number: `F-${i}`, items: items([LONG, 1], ["Two", 1]) }));
    const t = annotateLinkGroups([{ ...team, schedules: [...filler, ...team.schedules.slice(1, 5).map((s, i) => ({ ...s, sort_order: 20 + i }))] }], groups)[0];
    const drawn = [];
    const doc = buildTeamSchedulePdf({ jsPDF, createTable: __createTable, drawTable: __drawTable, team: t, company: {}, fonts, printedAt: new Date("2026-10-01T08:00:00Z"), onStopDrawn: (g, info) => drawn.push({ grouped: g.grouped, ...info }) });
    if (OUT) fs.writeFileSync(path.join(OUT, "boundary.pdf"), Buffer.from(doc.output("arraybuffer")));
    const g = drawn.find(d => d.grouped);
    expect(g.firstPage).toBe(g.lastPage);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  test("14. Excel: banner row + each child SO/DO on its own rows; re-import ignores the banner", async () => {
    const OriginalBlob = global.Blob; let bytes = null;
    global.Blob = function (parts, opts) { bytes = parts[0]; return new OriginalBlob(parts, opts); };
    const oc = URL.createObjectURL, orv = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:mock"; URL.revokeObjectURL = () => {};
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try { await exportTeamScheduleExcel(linkedTeam, {}); } finally { global.Blob = OriginalBlob; URL.createObjectURL = oc; URL.revokeObjectURL = orv; click.mockRestore(); }
    if (OUT) fs.writeFileSync(path.join(OUT, "stop.xlsx"), Buffer.from(bytes));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
    const ws = wb.getWorksheet("Schedule");
    const text = c => { const v = c.value; return v && v.richText ? v.richText.map(p => p.text).join("") : String(v ?? ""); };
    const col1 = []; for (let r = 5; r <= ws.rowCount; r++) col1.push(text(ws.getCell(r, 1)).split("\n")[0]);
    const bannerIdx = col1.findIndex(t => t.startsWith("🔗 Customer stop — deliver together · 3 orders"));
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(col1.slice(bannerIdx + 1)).toEqual(expect.arrayContaining(["SO1001 · DO2609-0001", "SO1002 · DO2609-0002", "SO1003 · DO2609-0003"]));
    const asFile = b => ({ arrayBuffer: async () => b });
    const { refs } = await parseTeamScheduleWorkbook(asFile(bytes));
    expect(refs.map(r => r.label)).toEqual(["SO2001", "SO1001 · DO2609-0001", "SO1002 · DO2609-0002", "SO1003 · DO2609-0003", "SO3001", "SV-2001"]);
  });
});
