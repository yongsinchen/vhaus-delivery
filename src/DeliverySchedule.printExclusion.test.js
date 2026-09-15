// P1-3 — TeamPrintView must exclude a schedule row pointing at a superseded
// Delivery Order from the operational print, regardless of the DO's own
// status column (superseded_at is authoritative). Direct unit test of the
// exported predicate rather than a full component render.
import { isSupersededPrintRow } from "./DeliverySchedule";

test("a schedule with no delivery_orders join (legacy stop) is never excluded", () => {
  expect(isSupersededPrintRow({ orders: {} })).toBe(false);
});

test("a live (non-superseded) DO stop is not excluded", () => {
  expect(isSupersededPrintRow({ delivery_orders: { do_number: "DO1", superseded_at: null, status: "scheduled" } })).toBe(false);
});

test("a superseded DO stop IS excluded, even though its own status still reads 'scheduled'", () => {
  expect(isSupersededPrintRow({ delivery_orders: { do_number: "DO1", superseded_at: "2026-09-11T07:50:09Z", status: "scheduled" } })).toBe(true);
});

test("missing/undefined schedule input never throws", () => {
  expect(isSupersededPrintRow(undefined)).toBe(false);
  expect(isSupersededPrintRow({})).toBe(false);
});
