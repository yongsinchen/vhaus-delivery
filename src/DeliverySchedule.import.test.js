// Schedule import: reading a workbook back, and working out what importing it
// would do to the board.
//
// The strongest test here is the round trip — a file produced by the real
// exporter is fed to the real parser, so the two halves of the feature are
// proven to agree rather than merely written to the same spec.
import { exportTeamScheduleExcel, parseTeamScheduleWorkbook, planScheduleImport } from "./DeliverySchedule";

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

  test("a workbook that is not a schedule export is rejected with a plain message", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1").getCell("A1").value = "Something else";
    const buf = await wb.xlsx.writeBuffer();
    await expect(parseTeamScheduleWorkbook(asFile(buf))).rejects.toThrow(/does not look like a Delivery Schedule export/i);
  });
});

describe("planScheduleImport — what the import would do to the board", () => {
  const teams = [
    { id: "t1", vehicle_plate: "WVX7723", schedules: [legacyStop(1, "SO-1"), doStop(2, "SO-2", "DO-7")] },
    { id: "t2", vehicle_plate: "WVX9001", schedules: [legacyStop(3, "SO-3")] },
  ];

  test("matched stops are listed for unassignment, with the team they leave", () => {
    const plan = planScheduleImport([{ soNumber: "SO-1", doNumber: null, label: "SO-1" }], teams);
    expect(plan.toUnassign).toHaveLength(1);
    expect(plan.toUnassign[0].team.vehicle_plate).toBe("WVX7723");
    expect(plan.notFound).toEqual([]);
  });

  test("stops are found across every team on the board, not just the first", () => {
    const plan = planScheduleImport([{ soNumber: "SO-3", doNumber: null, label: "SO-3" }], teams);
    expect(plan.toUnassign[0].team.vehicle_plate).toBe("WVX9001");
  });

  test("a DO reference matches only that DO's stop", () => {
    const plan = planScheduleImport([{ soNumber: "SO-2", doNumber: "DO-7", label: "SO-2 · DO-7" }], teams);
    expect(plan.toUnassign).toHaveLength(1);
    expect(plan.toUnassign[0].schedule.id).toBe(2);
  });

  test("a reference to a DIFFERENT DO of the same SO does not match — it is reported, not guessed", () => {
    const plan = planScheduleImport([{ soNumber: "SO-2", doNumber: "DO-99", label: "SO-2 · DO-99" }], teams);
    expect(plan.toUnassign).toEqual([]);
    expect(plan.notFound.map(r => r.label)).toEqual(["SO-2 · DO-99"]);
  });

  test("a bare SO reference does not grab that SO's DO stop", () => {
    // SO-2 exists on the board only as a DO stop; a whole-order reference must
    // not unassign that shipment.
    const plan = planScheduleImport([{ soNumber: "SO-2", doNumber: null, label: "SO-2" }], teams);
    expect(plan.toUnassign).toEqual([]);
    expect(plan.notFound.map(r => r.label)).toEqual(["SO-2"]);
  });

  test("an SO not on this date's board is reported as not found", () => {
    const plan = planScheduleImport([{ soNumber: "SO-999", doNumber: null, label: "SO-999" }], teams);
    expect(plan.notFound.map(r => r.label)).toEqual(["SO-999"]);
  });

  test("stops already out for delivery or delivered are skipped, not attempted", () => {
    const busy = [{ id: "t1", vehicle_plate: "A", schedules: [
      { ...legacyStop(1, "SO-1"), status: "out_for_delivery" },
      { ...legacyStop(2, "SO-2"), status: "Delivered" },
      { ...legacyStop(3, "SO-3"), status: "arrived" },
      { ...legacyStop(4, "SO-4"), status: "scheduled" },
    ] }];
    const refs = ["SO-1", "SO-2", "SO-3", "SO-4"].map(so => ({ soNumber: so, doNumber: null, label: so }));
    const plan = planScheduleImport(refs, busy);
    expect(plan.locked.map(e => e.ref.label).sort()).toEqual(["SO-1", "SO-2", "SO-3"]);
    expect(plan.toUnassign.map(e => e.ref.label)).toEqual(["SO-4"]);
  });

  test("empty and missing inputs are handled without throwing", () => {
    expect(planScheduleImport([], teams)).toEqual({ toUnassign: [], locked: [], notFound: [] });
    expect(planScheduleImport(null, null)).toEqual({ toUnassign: [], locked: [], notFound: [] });
    expect(planScheduleImport([{ soNumber: "SO-1", doNumber: null, label: "SO-1" }], [])).toMatchObject({ toUnassign: [], notFound: [{ label: "SO-1" }] });
  });

  test("a team with no schedules array does not break matching", () => {
    const plan = planScheduleImport([{ soNumber: "SO-1", doNumber: null, label: "SO-1" }], [{ id: "t0" }, ...teams]);
    expect(plan.toUnassign).toHaveLength(1);
  });
});

describe("export -> import round trip against a live board", () => {
  jest.setTimeout(30000);

  test("exporting a team and importing the file plans to unassign exactly that team's stops", async () => {
    const team = { id: "t1", vehicle_plate: "WVX7723", team_date: "2026-09-18",
      schedules: [legacyStop(1, "SO-1"), doStop(2, "SO-2", "DO-7")] };
    const other = { id: "t2", vehicle_plate: "WVX9001", schedules: [legacyStop(3, "SO-3")] };

    const { refs } = await parseTeamScheduleWorkbook(asFile(await exportBytes(team)));
    const plan = planScheduleImport(refs, [team, other]);

    expect(plan.toUnassign.map(e => e.ref.label)).toEqual(["SO-1", "SO-2 · DO-7"]);
    expect(plan.toUnassign.every(e => e.team.id === "t1")).toBe(true); // the other team is untouched
    expect(plan.notFound).toEqual([]);
    expect(plan.locked).toEqual([]);
  });

  test("a superseded stop is absent from the export, so importing never touches it", async () => {
    const team = { id: "t1", vehicle_plate: "A", team_date: "2026-09-18", schedules: [
      legacyStop(1, "SO-1"),
      { ...doStop(2, "SO-DEAD", "DO-X"), delivery_orders: { do_number: "DO-X", superseded_at: "2026-09-11T00:00:00Z", delivery_order_items: [] } },
    ] };
    const { refs } = await parseTeamScheduleWorkbook(asFile(await exportBytes(team)));
    expect(refs.map(r => r.soNumber)).toEqual(["SO-1"]);
    const plan = planScheduleImport(refs, [team]);
    expect(plan.toUnassign.map(e => e.ref.label)).toEqual(["SO-1"]);
  });
});
