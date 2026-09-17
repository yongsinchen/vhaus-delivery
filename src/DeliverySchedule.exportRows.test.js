// buildTeamScheduleRows is the ONE row source shared by the printed team sheet
// (TeamPrintView) and the Excel export (exportTeamScheduleExcel). It was
// extracted out of TeamPrintView precisely so the two surfaces cannot drift, so
// this suite pins the business rules at the builder level — where both surfaces
// inherit them — rather than only through rendered DOM.
//
// DeliverySchedule.printOrder.test.js and .printExclusion.test.js continue to
// assert the same rules through the rendered print DOM; together they prove the
// extraction preserved behaviour on both sides.
import { buildTeamScheduleRows } from "./DeliverySchedule";

const stop = (id, sort_order, so_number, extra = {}) => ({
  id, sort_order, slot: null,
  orders: { id: 1000 + id, so_number, customer_name: "Cust-" + so_number, items: "[]", balance: 0 },
  ...extra,
});

describe("buildTeamScheduleRows — canonical ordering", () => {
  test("stops come back in canonical order regardless of incoming array order", () => {
    const team = { schedules: [stop(3, 3, "SO-3"), stop(1, 1, "SO-1"), stop(2, 2, "SO-2")] };
    expect(buildTeamScheduleRows(team).map(r => r.o.so_number)).toEqual(["SO-1", "SO-2", "SO-3"]);
  });

  test("chronological slot beats sort_order (the lexicographic-slot bug case)", () => {
    const team = { schedules: [
      { ...stop(1, 1, "SO-late"), slot: "1000-1200" },
      { ...stop(2, 9, "SO-early"), slot: "800-1000" },
    ] };
    expect(buildTeamScheduleRows(team).map(r => r.o.so_number)).toEqual(["SO-early", "SO-late"]);
  });

  test("a team with no schedules yields no rows, and null/undefined never throws", () => {
    expect(buildTeamScheduleRows({ schedules: [] })).toEqual([]);
    expect(buildTeamScheduleRows({})).toEqual([]);
    expect(buildTeamScheduleRows(null)).toEqual([]);
  });

  test("a schedule row with no joined order is skipped, not rendered blank", () => {
    const team = { schedules: [{ id: 9, sort_order: 1, orders: null }, stop(2, 2, "SO-2")] };
    expect(buildTeamScheduleRows(team).map(r => r.o.so_number)).toEqual(["SO-2"]);
  });
});

describe("buildTeamScheduleRows — superseded DO exclusion (P1-3)", () => {
  test("a superseded DO is excluded entirely, even with the earliest slot", () => {
    const team = { schedules: [
      { ...stop(1, 1, "SO-live"), slot: "1200-1400" },
      { ...stop(2, 2, "SO-dead"), slot: "800-1000",
        delivery_orders: { do_number: "DO-1", superseded_at: "2026-09-11T07:50:09Z", status: "scheduled", delivery_order_items: [] } },
    ] };
    expect(buildTeamScheduleRows(team).map(r => r.o.so_number)).toEqual(["SO-live"]);
  });

  test("superseded_at is authoritative even when the DO's own status still reads draft", () => {
    const team = { schedules: [
      { ...stop(1, 1, "SO-dead"),
        delivery_orders: { do_number: "DO-1", superseded_at: "2026-09-11T07:50:09Z", status: "draft", delivery_order_items: [] } },
    ] };
    expect(buildTeamScheduleRows(team)).toEqual([]);
  });
});

describe("buildTeamScheduleRows — DO-scoped items", () => {
  const doStop = (items) => ({
    ...stop(1, 1, "SO-1"),
    delivery_orders: { do_number: "DO-9", superseded_at: null, delivery_order_items: items },
  });

  test("a DO stop contributes only its own lines and is tagged with the DO number", () => {
    const rows = buildTeamScheduleRows({ schedules: [doStop([
      { product_code: "A1", product_name: "Sofa", size: "3S", color: "Grey", quantity: 2, status: "active" },
    ]) ] });
    expect(rows).toHaveLength(1);
    expect(rows[0].o.so_number).toBe("SO-1 · DO-9");
    expect(rows[0].item.itemName).toBe("Sofa 3S Grey");
    expect(rows[0].item.unit).toBe("2");
  });

  test("cancelled DO lines are dropped", () => {
    const rows = buildTeamScheduleRows({ schedules: [doStop([
      { product_code: "A1", product_name: "Keep", quantity: 1, status: "active" },
      { product_code: "A2", product_name: "Gone", quantity: 1, status: "cancelled" },
    ]) ] });
    expect(rows.map(r => r.item.itemName)).toEqual(["Keep"]);
  });

  test("one legacy arrival cannot bleed onto every DO line sharing a product code", () => {
    // Two identical-code lines, but the legacy items JSON records ONE arrival.
    // Exactly one line may claim it — the 1:1 pairing the backend also enforces.
    const sc = {
      ...stop(1, 1, "SO-1"),
      orders: { id: 1, so_number: "SO-1", customer_name: "C", balance: 0,
        items: JSON.stringify([{ itemCode: "A1", itemName: "Sofa", arrivalDate: "2026-09-10" }]) },
      delivery_orders: { do_number: "DO-9", superseded_at: null, delivery_order_items: [
        { product_code: "A1", product_name: "Sofa", quantity: 1, status: "active" },
        { product_code: "A1", product_name: "Sofa", quantity: 1, status: "active" },
      ] },
    };
    const arrivals = buildTeamScheduleRows({ schedules: [sc] }).map(r => r.item.arrivalDate);
    expect(arrivals).toEqual(["2026-09-10", null]);
  });

  test("a DO with no remaining lines still produces one placeholder row for the stop", () => {
    const rows = buildTeamScheduleRows({ schedules: [doStop([])] });
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toEqual({});
    expect(rows[0].rowspan).toBe(1);
  });
});

describe("buildTeamScheduleRows — legacy and service stops", () => {
  test("malformed legacy items JSON degrades to a placeholder row instead of throwing", () => {
    const sc = { ...stop(1, 1, "SO-1"), orders: { id: 1, so_number: "SO-1", customer_name: "C", items: "{not json", balance: 0 } };
    expect(() => buildTeamScheduleRows({ schedules: [sc] })).not.toThrow();
    expect(buildTeamScheduleRows({ schedules: [sc] })).toHaveLength(1);
  });

  test("a Service order with no line items surfaces its detail, stripped of the RPC prefix", () => {
    const sc = { ...stop(1, 1, "SV-1"), orders: {
      id: 1, so_number: "SV-1", customer_name: "C", items: "[]", balance: 0,
      type: "Service", service_note: "Linked to SO: 56190 | Replace sofa leg",
    } };
    const rows = buildTeamScheduleRows({ schedules: [sc] });
    expect(rows).toHaveLength(1);
    expect(rows[0].item.itemName).toBe("Replace sofa leg");
  });

  test("a Service order with no detail at all still labels the row 'Service'", () => {
    const sc = { ...stop(1, 1, "SV-2"), orders: { id: 1, so_number: "SV-2", customer_name: "C", items: "[]", balance: 0, type: "Service" } };
    expect(buildTeamScheduleRows({ schedules: [sc] })[0].item.itemName).toBe("Service");
  });
});

describe("buildTeamScheduleRows — row spanning metadata the renderers rely on", () => {
  test("a multi-item stop marks only its first row and reports a matching rowspan", () => {
    const sc = { ...stop(1, 1, "SO-1"), orders: {
      id: 1, so_number: "SO-1", customer_name: "C", balance: 0,
      items: JSON.stringify([{ itemName: "One" }, { itemName: "Two" }, { itemName: "Three" }]),
    } };
    const rows = buildTeamScheduleRows({ schedules: [sc] });
    expect(rows.map(r => r.isFirst)).toEqual([true, false, false]);
    expect(rows.map(r => r.rowspan)).toEqual([3, 3, 3]);
    expect(rows.map(r => r.idx)).toEqual([0, 1, 2]);
  });

  test("every row of one stop shares the same order and schedule objects", () => {
    const sc = { ...stop(1, 1, "SO-1"), orders: {
      id: 1, so_number: "SO-1", customer_name: "C", balance: 0,
      items: JSON.stringify([{ itemName: "One" }, { itemName: "Two" }]),
    } };
    const rows = buildTeamScheduleRows({ schedules: [sc] });
    expect(rows[0].sc).toBe(rows[1].sc);
    expect(rows[0].o).toBe(rows[1].o);
  });
});
