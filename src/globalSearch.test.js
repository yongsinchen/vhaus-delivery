/**
 * URGENT — Global Search "21892" regression.
 *
 * Bug: an order absent from the dashboard's preloaded/windowed orders[] was
 * unfindable in Global Search, even though the Orders page finds it via the
 * live backend search. Fix: supplement the local pass with the authorized
 * live Sales Order backend search, merged + de-duped by canonical SO identity.
 *
 * These tests exercise the pure helpers that back that behavior. The 21892
 * fixture (below) is a backend hit whose order_number is NOT in the local
 * working set — the exact production shape.
 */
import { globalMatchRow, mapSalesOrderHit, mergeGlobalResults } from "./globalSearch";

// Backend /sales-orders?search= row shape (company-scoped server-side).
const so21892 = { id: "d6432691-707c-4748-a538-80a87db6a95b", order_number: "21892", customer_name: "Ada Wong", customer_contact: "0129990000", status: "confirmed" };
// A local (preloaded, fromDb) legacy order that is NOT 21892.
const localOther = { id: 4000, soNumber: "60477", customerName: "Someone Else", contact: "0111111111", items: [] };

const backendHits = (rows) => rows.map(mapSalesOrderHit);

describe("Global Search — backend Sales Order supplement", () => {
  test("1. backend-only SO hit appears (21892 not in local set)", () => {
    const local = [localOther].filter(o => globalMatchRow(o, "21892")); // → [] (21892 not local)
    const merged = mergeGlobalResults(local, backendHits([so21892]));
    expect(merged.some(r => r.soNumber === "21892")).toBe(true);
  });

  test("2. exact SO number maps to a navigable backend result with stable id", () => {
    const [hit] = backendHits([so21892]);
    expect(hit._backendOrder).toBe(true);
    expect(hit.id).toBe("d6432691-707c-4748-a538-80a87db6a95b"); // sales_orders UUID, not SO number
    expect(hit.soNumber).toBe("21892");
  });

  test("3. search by customer name matches locally when the order IS preloaded", () => {
    const localAda = { id: 5, soNumber: "21892", customerName: "Ada Wong", contact: "0129990000", items: [] };
    expect(globalMatchRow(localAda, "ada")).toBe(true);
  });

  test("4. same order found locally AND by backend → ONE result (dedupe by SO number)", () => {
    const localMatch = { id: 5, soNumber: "21892", customerName: "Ada Wong", contact: "0129990000", items: [] };
    const merged = mergeGlobalResults([localMatch], backendHits([so21892]));
    expect(merged.filter(r => String(r.soNumber) === "21892")).toHaveLength(1);
    expect(merged[0]).toBe(localMatch); // local kept (opens cleanly via dashboard modal)
    expect(merged.some(r => r._backendOrder && r.soNumber === "21892")).toBe(false);
  });

  test("5/6. company isolation is server-side — merge only surfaces what the backend returned", () => {
    // A wrong-company / no-access search returns no rows from the backend, so
    // nothing about 21892 can appear (the client never supplies a company_id).
    const merged = mergeGlobalResults([], backendHits([]));
    expect(merged).toHaveLength(0);
    // Same SO number in another company would arrive ONLY if the backend (which
    // scopes to the authorized company) returned it — dedupe/merge never invent
    // a hit, so there is no cross-company leak path in this layer.
  });

  test("9. empty/no-result merge yields no rows (drives the 'No results' state)", () => {
    expect(mergeGlobalResults([], [])).toHaveLength(0);
  });

  test("10. malformed backend payload does not throw (defensive mapping)", () => {
    expect(() => mergeGlobalResults([], backendHits([{ id: "x" }]))).not.toThrow();
    // a row with no order_number produces soNumber undefined → dropped by merge
    expect(mergeGlobalResults([], backendHits([{ id: "x" }]))).toHaveLength(0);
  });

  test("11/12. existing local matching preserved (SV, service note, item, contact)", () => {
    expect(globalMatchRow({ svNumber: "SV-406" }, "sv-406")).toBe(true);
    expect(globalMatchRow({ serviceNote: "fix hinge" }, "hinge")).toBe(true);
    expect(globalMatchRow({ items: [{ itemName: "SOYO Table" }] }, "soyo")).toBe(true);
    expect(globalMatchRow({ contact: "0129990000" }, "999")).toBe(true);
  });

  test("13. a non-matching query surfaces nothing", () => {
    const local = [localOther].filter(o => globalMatchRow(o, "99999"));
    expect(mergeGlobalResults(local, backendHits([]))).toHaveLength(0);
  });

  test("local order hits are ordered before backend-only hits", () => {
    const localMatch = { id: 5, soNumber: "60477", customerName: "X", items: [] };
    const merged = mergeGlobalResults([localMatch], backendHits([so21892]));
    expect(merged[0]).toBe(localMatch);
    expect(merged[merged.length - 1].soNumber).toBe("21892");
  });
});
