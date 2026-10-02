// False "TBC": the SO view must show the active DO's date (backend
// _effective_delivery), never the stale SO-side "TBC".
import fs from "fs";
import path from "path";
import { effectiveDeliveryDisplay } from "./effectiveDelivery";

const eff = (e, delivery_date = "TBC") => ({ delivery_date, _effective_delivery: e });

describe("effectiveDeliveryDisplay", () => {
  test("1. SO TBC + one active DO dated → the DO date (SO55670 / SO56021 shape)", () => {
    expect(effectiveDeliveryDisplay(eff({ source: "delivery_order", date: "2026-09-25", do_number: "DO2608-0016" })))
      .toEqual({ kind: "date", text: "2026-09-25", doNumber: "DO2608-0016", deliveries: [] });
  });
  test("2. SO old date + active DO new date → DO date", () => {
    expect(effectiveDeliveryDisplay(eff({ source: "delivery_order", date: "2026-11-11", do_number: "DO-1" }, "2026-09-01")).text).toBe("2026-11-11");
  });
  test("3/14. no active DO → the SO's own date, exactly as before", () => {
    expect(effectiveDeliveryDisplay(eff({ source: "sales_order", date: "2026-10-01" }, "2026-10-01"))).toMatchObject({ kind: "date", text: "2026-10-01" });
    expect(effectiveDeliveryDisplay(eff({ source: "sales_order", date: null, tbc: true }, "TBC"))).toMatchObject({ kind: "tbc", text: "TBC" });
    expect(effectiveDeliveryDisplay(eff({ source: "sales_order", date: null }, null))).toMatchObject({ kind: "none", text: null });
  });
  test("older backend without the field → SO's own value (no crash, no change)", () => {
    expect(effectiveDeliveryDisplay({ delivery_date: "2026-10-01" })).toMatchObject({ kind: "date", text: "2026-10-01" });
    expect(effectiveDeliveryDisplay({ delivery_date: "TBC" })).toMatchObject({ kind: "tbc", text: "TBC" });
    expect(effectiveDeliveryDisplay(null)).toMatchObject({ kind: "none" });
  });
  test("4/5. active DO with no date → legitimate TBC, even if the SO has a date", () => {
    expect(effectiveDeliveryDisplay(eff({ source: "delivery_order", date: null, tbc: true, do_number: "DO-2" }, "2026-09-25")))
      .toEqual({ kind: "tbc", text: "TBC", doNumber: "DO-2", deliveries: [] });
  });
  test("11. 2+ active DOs → multiple, each listed, no single date", () => {
    const d = effectiveDeliveryDisplay(eff({ source: "multiple_delivery_orders", date: null, deliveries: [
      { delivery_order_id: "a", do_number: "DO-1", date: "2026-09-25" }, { delivery_order_id: "b", do_number: "DO-2", date: null }] }, "2026-09-01"));
    expect(d.kind).toBe("multiple");
    expect(d.text).toBe("2 deliveries");
    expect(d.deliveries.map(x => x.do_number)).toEqual(["DO-1", "DO-2"]);
  });
});

test("Orders page list and SO detail both read effectiveDeliveryDisplay (not the raw SO field)", () => {
  const src = fs.readFileSync(path.join(__dirname, "OrdersPage.js"), "utf8");
  expect(src).toMatch(/const ed = effectiveDeliveryDisplay\(o\); return ed\.text \? ` · 📅 \$\{ed\.text\}` : ""/);
  expect(src).toMatch(/showingProposed \? effectiveDeliveryDisplay\(\{ delivery_date: view\.delivery_date \}\) : effectiveDeliveryDisplay\(o\)/);
  expect(src).not.toMatch(/o\.delivery_date === "TBC" \? "TBC" : o\.delivery_date/);
  // the edit form still edits the SO's own field
  expect(src).toMatch(/value=\{form\.delivery_date === "TBC" \? "" : form\.delivery_date\}/);
});
