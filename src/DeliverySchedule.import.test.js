// Schedule import: reading a workbook back, and working out where each Delivery
// Order it names currently sits and whether it can be moved to a target date.
//
// The strongest test here is the round trip — a file produced by the real
// exporter is fed to the real parser, so the two halves of the feature are
// proven to agree rather than merely written to the same spec.
import { exportTeamScheduleExcel, parseTeamScheduleWorkbook, buildImportRows } from "./DeliverySchedule";

// Runs the real exporter and hands back the bytes it would have downloaded.
async function exportBytes(team, company = {}) {
  const OriginalBlob = global.Blob;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let bytes = null;
  global.Blob = function (parts, opts) { bytes = parts[0]; return new OriginalBlob(parts, opts); };
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    await exportTeamScheduleExcel(team, company);
  } finally {
    global.Blob = OriginalBlob;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    clickSpy.mockRestore();
  }
  return bytes;
}

// parseTeamScheduleWorkbook only needs arrayBuffer() off the file handle.
const asFile = (bytes) => ({ arrayBuffer: async () => bytes });

const legacyStop = (id, so, extra = {}) => ({
  id, sort_order: id, slot: null, status: "scheduled",
  orders: { id: 100 + id, so_number: so, customer_name: "Cust " + so, balance: 0,
    items: JSON.stringify([{ itemCode: "X", itemName: "Item " + so, unit: "1" }]) },
  ...extra,
});

const doStop = (id, so, doNumber, extra = {}) => ({
  ...legacyStop(id, so),
  delivery_orders: { do_number: doNumber, superseded_at: null,
    delivery_order_items: [{ product_code: "X", product_name: "Item " + doNumber, quantity: 1, status: "active" }] },
  ...extra,
});

describe("parseTeamScheduleWorkbook — round trip with the real exporter", () => {
  jest.setTimeout(30000);

  test("every exported stop comes back, once, in order", async () => {
    const team = { vehicle_plate: "WVX7723", driver_name: "Sham", team_date: "2026-09-18",
      schedules: [legacyStop(1, "SO-366"), legacyStop(2, "SO-345"), doStop(3, "SO-400", "DO-9")] };
    const { refs } = await parseTeamScheduleWorkbook(asFile(await exportBytes(team)));
    expect(refs.map(r => r.label)).toEqual(["SO-366", "SO-345", "SO-400 · DO-9"]);
  });

  test("a DO stop round-trips with its DO number, a legacy stop without one", async () => {
    const team = { vehicle_plate: "A", team_date: "2026-09-18", schedules: [legacyStop(1, "SO-1"), doStop(2, "SO-2", "DO-7")] };
    const { refs } = await parseTeamScheduleWorkbook(asFile(await exportBytes(team)));
    expect(refs[0]).toMatchObject({ soNumber: "SO-1", doNumber: null });
    expect(refs[1]).toMatchObject({ soNumber: "SO-2", doNumber: "DO-7" });
  });

  test("a multi-item stop is counted once, not once per item line", async () => {
    const team = { vehicle_plate: "A", team_date: "2026-09-18", schedules: [
      { ...legacyStop(1, "SO-1"), orders: { id: 1, so_number: "SO-1", customer_name: "C", balance: 0,
        items: JSON.stringify([{ itemName: "One" }, { itemName: "Two" }, { itemName: "Three" }]) } },
    ] };
    const { refs } = await parseTeamScheduleWorkbook(asFile(await exportBytes(team)));
    expect(refs).toHaveLength(1);
    expect(refs[0].soNumber).toBe("SO-1");
  });

  test("the 'Printed:' stamp and the empty-team placeholder are not read as stops", async () => {
    const { refs } = await parseTeamScheduleWorkbook(asFile(await exportBytes({ vehicle_plate: "A", team_date: "2026-09-18", schedules: [] })));
    expect(refs).toEqual([]);
  });

  test("the file's own date and vehicle are read back for display", async () => {
    // Display only — never used to decide what changes — but the preview needs
    // them to warn when a file was exported for a different day than the board.
    const team = { vehicle_plate: "WVX7723", driver_name: "Sham", area: "PG", team_date: "2026-09-18",
      schedules: [legacyStop(1, "SO-1")] };
    const { fileDate, fileVehicle } = await parseTeamScheduleWorkbook(asFile(await exportBytes(team)));
    expect(fileDate).toBe("2026-09-18");
    expect(fileVehicle).toBe("WVX7723 / Sham / PG");
  });

  test("a workbook that is not a schedule export is rejected with a plain message", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1").getCell("A1").value = "Something else";
    const buf = await wb.xlsx.writeBuffer();
    await expect(parseTeamScheduleWorkbook(asFile(buf))).rejects.toThrow(/does not look like a Delivery Schedule export/i);
  });
});


// ── buildImportRows ────────────────────────────────────────────────────
// Resolves each reference against ALL active Delivery Orders (not just the
// board's date), reports where it sits today, and decides whether it can move.
const ref = (doNumber, soNumber = "SO-1") => ({ soNumber, doNumber, label: doNumber ? `${soNumber} · ${doNumber}` : soNumber });

const TARGET = "2026-09-20";
const doRow = (id, do_number, delivery_date, status = "scheduled", extra = {}) =>
  ({ id, do_number, delivery_date, status, superseded_at: null, ...extra });

describe("buildImportRows — where each DO sits now", () => {
  test("reports the DO's current date and vehicle, and plans a move", () => {
    const rows = buildImportRows([ref("DO-7")], {
      dos: [doRow(1, "DO-7", "2026-09-18")],
      schedules: [{ id: 91, delivery_order_id: 1, team_id: "t1", status: "scheduled" }],
      teams: [{ id: "t1", vehicle_plate: "WVX7723" }],
      targetDate: TARGET,
    });
    expect(rows[0]).toMatchObject({
      doNumber: "DO-7", currentDate: "2026-09-18", vehicle: "WVX7723",
      selectable: true, action: "move",
    });
  });

  test("a DO on another date with no vehicle reports no vehicle, still movable", () => {
    const rows = buildImportRows([ref("DO-7")], {
      dos: [doRow(1, "DO-7", "2026-09-18", "draft")], schedules: [], teams: [], targetDate: TARGET,
    });
    expect(rows[0]).toMatchObject({ currentDate: "2026-09-18", vehicle: null, selectable: true, action: "move" });
  });

  test("the vehicle plate is read from the joined vehicle record when present", () => {
    const rows = buildImportRows([ref("DO-7")], {
      dos: [doRow(1, "DO-7", "2026-09-18")],
      schedules: [{ id: 91, delivery_order_id: 1, team_id: "t1", status: "scheduled" }],
      teams: [{ id: "t1", delivery_vehicles: { vehicle_plate: "PPP1234" }, driver_name: "Sham" }],
      targetDate: TARGET,
    });
    expect(rows[0].vehicle).toBe("PPP1234");
  });

  test("a DO already on the target date but on a vehicle is unassigned in place", () => {
    const rows = buildImportRows([ref("DO-7")], {
      dos: [doRow(1, "DO-7", TARGET)],
      schedules: [{ id: 91, delivery_order_id: 1, team_id: "t1", status: "scheduled" }],
      teams: [{ id: "t1", vehicle_plate: "WVX7723" }],
      targetDate: TARGET,
    });
    expect(rows[0]).toMatchObject({ selectable: true, action: "unassign" });
  });

  test("a DO already unassigned on the target date has nothing to do", () => {
    const rows = buildImportRows([ref("DO-7")], {
      dos: [doRow(1, "DO-7", TARGET, "draft")], schedules: [], teams: [], targetDate: TARGET,
    });
    expect(rows[0]).toMatchObject({ selectable: false, reason: "Already unassigned on this date" });
  });

  test("terminal schedule attempts are ignored when finding the live one", () => {
    // A failed earlier attempt must not be mistaken for the DO's current stop.
    const rows = buildImportRows([ref("DO-7")], {
      dos: [doRow(1, "DO-7", "2026-09-18")],
      schedules: [
        { id: 90, delivery_order_id: 1, team_id: "tOld", status: "failed" },
        { id: 91, delivery_order_id: 1, team_id: "t1", status: "scheduled" },
      ],
      teams: [{ id: "tOld", vehicle_plate: "OLD" }, { id: "t1", vehicle_plate: "WVX7723" }],
      targetDate: TARGET,
    });
    expect(rows[0].vehicle).toBe("WVX7723");
  });
});

describe("buildImportRows — what cannot be moved, and why", () => {
  const cases = [
    ["a legacy stop with no DO", [ref(null, "SO-9")], { dos: [] }, /only DOs can be moved/i],
    ["an unknown DO", [ref("DO-X")], { dos: [] }, /not found/i],
    ["a superseded DO", [ref("DO-7")], { dos: [doRow(1, "DO-7", "2026-09-18", "scheduled", { superseded_at: "2026-09-11T00:00:00Z" })] }, /superseded/i],
    ["a completed DO", [ref("DO-7")], { dos: [doRow(1, "DO-7", "2026-09-18", "completed")] }, /cannot move a completed/i],
    ["a cancelled DO", [ref("DO-7")], { dos: [doRow(1, "DO-7", "2026-09-18", "cancelled")] }, /cannot move a cancelled/i],
  ];
  test.each(cases)("%s is blocked with a reason", (_name, refs, ctx, expected) => {
    const rows = buildImportRows(refs, { schedules: [], teams: [], targetDate: TARGET, ...ctx });
    expect(rows[0].selectable).toBe(false);
    expect(rows[0].action).toBeNull();
    expect(rows[0].reason).toMatch(expected);
  });

  test("a DO already out for delivery is blocked — the backend would refuse it", () => {
    const rows = buildImportRows([ref("DO-7")], {
      dos: [doRow(1, "DO-7", "2026-09-18", "out_for_delivery")],
      schedules: [{ id: 91, delivery_order_id: 1, team_id: "t1", status: "out_for_delivery" }],
      teams: [{ id: "t1", vehicle_plate: "WVX7723" }],
      targetDate: TARGET,
    });
    expect(rows[0]).toMatchObject({ selectable: false, reason: "Already out for delivery" });
  });

  test("empty and missing inputs are handled without throwing", () => {
    expect(buildImportRows([], {})).toEqual([]);
    expect(buildImportRows(null, undefined)).toEqual([]);
    expect(buildImportRows([ref("DO-7")], {})[0].selectable).toBe(false);
  });
});

describe("export -> import onto a different date", () => {
  jest.setTimeout(30000);

  test("a file exported for one day plans every DO onto the target day, leaving its old date", async () => {
    const team = { vehicle_plate: "WVX7723", team_date: "2026-09-18",
      schedules: [doStop(1, "SO-1", "DO-7"), doStop(2, "SO-2", "DO-8")] };
    const { refs, fileDate } = await parseTeamScheduleWorkbook(asFile(await exportBytes(team)));
    expect(fileDate).toBe("2026-09-18");

    const rows = buildImportRows(refs, {
      dos: [doRow(1, "DO-7", "2026-09-18"), doRow(2, "DO-8", "2026-09-18")],
      schedules: [
        { id: 91, delivery_order_id: 1, team_id: "t1", status: "scheduled" },
        { id: 92, delivery_order_id: 2, team_id: "t1", status: "scheduled" },
      ],
      teams: [{ id: "t1", vehicle_plate: "WVX7723" }],
      targetDate: TARGET,
    });
    expect(rows.map(r => r.doNumber)).toEqual(["DO-7", "DO-8"]);
    expect(rows.every(r => r.selectable && r.action === "move")).toBe(true);
    expect(rows.every(r => r.currentDate === "2026-09-18" && r.vehicle === "WVX7723")).toBe(true);
  });

  test("a superseded stop never reaches the file, so it can never be imported", async () => {
    const team = { vehicle_plate: "A", team_date: "2026-09-18", schedules: [
      doStop(1, "SO-1", "DO-7"),
      { ...doStop(2, "SO-DEAD", "DO-X"), delivery_orders: { do_number: "DO-X", superseded_at: "2026-09-11T00:00:00Z", delivery_order_items: [] } },
    ] };
    const { refs } = await parseTeamScheduleWorkbook(asFile(await exportBytes(team)));
    expect(refs.map(r => r.doNumber)).toEqual(["DO-7"]);
  });
});
