// End-to-end check of the team schedule .xlsx export: runs the real exporter,
// captures the bytes it would hand the browser, and reads them back with
// ExcelJS. This proves the produced file is a well-formed workbook whose cells
// actually carry the operational data — not merely that the function ran.
import ExcelJS from "exceljs";
import { exportTeamScheduleExcel } from "./DeliverySchedule";

// Capture the workbook bytes the exporter wraps in a Blob, plus the download
// filename it puts on the anchor, without touching the real download path.
// jsdom's Blob exposes no arrayBuffer(), so the bytes are taken at the point
// the exporter constructs it.
async function runExport(team, company = {}) {
  const OriginalBlob = global.Blob;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let bytes = null;
  let filename = null;

  global.Blob = function (parts, opts) { bytes = parts[0]; return new OriginalBlob(parts, opts); };
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    filename = this.download;
  });

  try {
    await exportTeamScheduleExcel(team, company);
  } finally {
    global.Blob = OriginalBlob;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    clickSpy.mockRestore();
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  return { ws: wb.getWorksheet("Schedule"), filename, wb };
}

// Reads a cell's plain text whether it was written as a string or rich text.
const text = (cell) => {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object" && Array.isArray(v.richText)) return v.richText.map(p => p.text).join("");
  return String(v);
};

const HEAD = 4; // header row index used by the exporter

const team = {
  vehicle_plate: "WVX7723",
  driver_name: "Sham",
  area: "PG",
  team_date: "2026-09-18",
  schedules: [
    { id: 2, sort_order: 2, slot: "1000-1200", trip_no: 1, total_trips: 2, notes: "Call before arrival",
      orders: { id: 20, so_number: "SO-345", customer_name: "Lim", contact: "012-3456789",
        address: "12 Jalan Bakti", balance: "250.00", salesman: "Ali", remark: "Fragile",
        items: JSON.stringify([{ itemCode: "A1", itemName: "Sofa", unit: "1", supplier: "Acme", arrivalDate: "2026-09-10" }]) } },
    { id: 1, sort_order: 9, slot: "800-1000",
      orders: { id: 10, so_number: "SO-366", customer_name: "Tan", balance: 0,
        items: JSON.stringify([{ itemCode: "B1", itemName: "Bed", unit: "2", supplier: "Beta" }]) } },
  ],
};

describe("exportTeamScheduleExcel — produces a real, correct workbook", () => {
  jest.setTimeout(30000);

  test("file is named for the vehicle and the date, on a 'Schedule' sheet", async () => {
    const { ws, filename } = await runExport(team, { name: "Vhaus Living Sdn Bhd" });
    expect(filename).toBe("Schedule-WVX7723-2026-09-18.xlsx");
    expect(ws).toBeDefined();
  });

  test("title block carries the company, the date and the vehicle", async () => {
    const { ws } = await runExport(team, { name: "Vhaus Living Sdn Bhd" });
    expect(text(ws.getCell(1, 1))).toBe("Vhaus Living Sdn Bhd Delivery Schedule");
    expect(text(ws.getCell(2, 1))).toContain("Date: 2026-09-18");
    expect(text(ws.getCell(2, 1))).toContain("Vehicle: WVX7723 / Sham / PG");
  });

  test("falls back to a plain title when no company name is configured", async () => {
    const { ws } = await runExport(team, {});
    expect(text(ws.getCell(1, 1))).toBe("Delivery Schedule");
  });

  test("header row is the 16 operational columns", async () => {
    const { ws } = await runExport(team);
    const headers = [];
    for (let c = 1; c <= 16; c++) headers.push(text(ws.getCell(HEAD, c)));
    expect(headers).toEqual(["SO / Customer","Salesman","Trip","Check","Naik","Plate NO","No.","Code","Item","Unit","Supplier","Order Date","Sent","JB Sent","Arrival PG","Remark"]);
  });

  test("stops are written in canonical chronological order, not array order", async () => {
    const { ws } = await runExport(team);
    // SO-366 has the 800-1000 slot despite sort_order 9 and second position.
    expect(text(ws.getCell(HEAD + 1, 1))).toContain("SO-366");
    expect(text(ws.getCell(HEAD + 2, 1))).toContain("SO-345");
  });

  test("a stop's operational data lands in the right columns", async () => {
    const { ws } = await runExport(team);
    const r = HEAD + 2; // SO-345
    expect(text(ws.getCell(r, 1))).toContain("Lim");
    expect(text(ws.getCell(r, 1))).toContain("012-3456789");
    expect(text(ws.getCell(r, 1))).toContain("Bal: RM 250.00");
    expect(text(ws.getCell(r, 1))).toContain("Slot: 1000-1200");
    expect(text(ws.getCell(r, 2))).toBe("Ali");            // Salesman
    expect(text(ws.getCell(r, 3))).toBe("Trip 1/2");       // Trip
    expect(text(ws.getCell(r, 6))).toBe("WVX7723");        // Plate
    expect(text(ws.getCell(r, 7))).toBe("1");              // No.
    expect(text(ws.getCell(r, 8))).toBe("A1");             // Code
    expect(text(ws.getCell(r, 9))).toBe("Sofa");           // Item
    expect(text(ws.getCell(r, 10))).toBe("1");             // Unit
    expect(text(ws.getCell(r, 11))).toBe("Acme");          // Supplier
    expect(text(ws.getCell(r, 15))).toBe("2026-09-10");    // Arrival PG
    expect(text(ws.getCell(r, 16))).toContain("Fragile");  // Remark
    expect(text(ws.getCell(r, 16))).toContain("Call before arrival");
  });

  test("Check / Naik / JB Sent are left blank to be filled in", async () => {
    const { ws } = await runExport(team);
    const r = HEAD + 1;
    expect(text(ws.getCell(r, 4))).toBe("");
    expect(text(ws.getCell(r, 5))).toBe("");
    expect(text(ws.getCell(r, 14))).toBe("");
  });

  test("a line with no supplier arrival is flagged 'No arrival', not left empty", async () => {
    const { ws } = await runExport(team);
    expect(text(ws.getCell(HEAD + 1, 15))).toBe("No arrival"); // SO-366's Bed
  });

  test("a superseded DO is excluded from the workbook, as it is from print", async () => {
    const withDead = { ...team, schedules: [
      ...team.schedules,
      { id: 3, sort_order: 1, slot: "0700-0800",
        orders: { id: 30, so_number: "SO-DEAD", customer_name: "Ghost", items: "[]", balance: 0 },
        delivery_orders: { do_number: "DO-X", superseded_at: "2026-09-11T07:50:09Z", delivery_order_items: [] } },
    ] };
    const { ws } = await runExport(withDead);
    const all = [];
    ws.eachRow(row => row.eachCell(cell => all.push(text(cell))));
    expect(all.join("|")).not.toContain("SO-DEAD");
    expect(all.join("|")).not.toContain("Ghost");
  });

  test("a team with no stops still exports a valid sheet saying so", async () => {
    const { ws } = await runExport({ ...team, schedules: [] });
    expect(text(ws.getCell(HEAD + 1, 1))).toBe("No orders assigned.");
  });

  test("a multi-item stop merges its stop-level columns across the item rows", async () => {
    const multi = { ...team, schedules: [
      { id: 1, sort_order: 1, orders: { id: 10, so_number: "SO-1", customer_name: "Tan", balance: 0,
        items: JSON.stringify([{ itemName: "One" }, { itemName: "Two" }, { itemName: "Three" }]) } },
    ] };
    const { ws } = await runExport(multi);
    expect(text(ws.getCell(HEAD + 1, 9))).toBe("One");
    expect(text(ws.getCell(HEAD + 2, 9))).toBe("Two");
    expect(text(ws.getCell(HEAD + 3, 9))).toBe("Three");
    // SO / Customer is merged down the three item rows.
    expect(ws.getCell(HEAD + 1, 1).isMerged).toBe(true);
    expect(ws.getCell(HEAD + 3, 1).master.address).toBe(ws.getCell(HEAD + 1, 1).address);
  });
});
