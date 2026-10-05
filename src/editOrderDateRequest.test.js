// Edit Order date change with an active DO → that DO's Delivery Date Request.
import fs from "fs";
import path from "path";
import { effectiveAfterEdit } from "./effectiveDelivery";

const prevDo = { source: "delivery_order", date: "2026-11-20", tbc: false, do_number: "DO-1", deliveries: [] };

test("pending request: the effective date stays the DO's current date (not shown as applied)", () => {
  expect(effectiveAfterEdit(prevDo, { delivery_date: "2026-11-20" }, null, { id: "r", status: "pending", requested_date: "2026-11-25", do_number: "DO-1" })).toBe(prevDo);
});
test("auto-approved request: the effective date becomes the new DO date", () => {
  expect(effectiveAfterEdit(prevDo, { delivery_date: "2026-11-25" }, null, { id: "r", status: "approved", requested_date: "2026-11-25", do_number: "DO-1" }))
    .toMatchObject({ source: "delivery_order", date: "2026-11-25", tbc: false, do_number: "DO-1" });
});
test("failed request leaves the row as it was; TBC + no-DO behaviour unchanged", () => {
  expect(effectiveAfterEdit(prevDo, { delivery_date: "2026-11-20" }, null, { error: "x", do_number: "DO-1" })).toBe(prevDo);
  expect(effectiveAfterEdit(prevDo, { delivery_date: "TBC" }, { id: "d", do_number: "DO-1", delivery_date: null })).toMatchObject({ tbc: true });
  expect(effectiveAfterEdit({ source: "sales_order", date: "2026-11-20" }, { delivery_date: "2026-11-25" }, null, null)).toMatchObject({ source: "sales_order", date: "2026-11-25" });
});
test("OrdersPage tells Sales what happened — submitted for approval / moved / not changed", () => {
  const src = fs.readFileSync(path.join(__dirname, "OrdersPage.js"), "utf8");
  expect(src).toMatch(/Delivery date change submitted for approval/);
  expect(src).toMatch(/delivery date moved to/);
  expect(src).toMatch(/the delivery date was not changed/);
  expect(src).toMatch(/effectiveAfterEdit\(o\._effective_delivery, d\.order, d\.delivery_order_updated, d\.delivery_date_request\)/);
  expect(src).toMatch(/multiple active Delivery Orders — change the delivery date from Deliveries → Delivery Orders/);
});
