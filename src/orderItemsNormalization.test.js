/**
 * URGENT FIX regression test — production login crash
 * "t.some is not a function" (minified).
 *
 * Root cause: fromDb()'s items normalization only handled the "outer
 * string" case (typeof o.items === "string" -> JSON.parse) but never
 * verified the PARSED result was actually an array. A stray production row
 * had a DOUBLE-JSON-ENCODED items column (raw DB value '"[]"') — parsing it
 * once yields the STRING "[]", not an array. Every .some()/.map()/.filter()
 * call downstream (App.js dashboard rendering) then threw
 * "TypeError: t.some is not a function" the instant that row was included
 * in a company's order fetch — blocking login for any user whose active
 * company (persisted per-device in localStorage) resolved to that company,
 * while a device with no/a different stored company kept working (the
 * observed "works on phone, fails on desktop" split for the SAME account).
 *
 * This test proves the EXACT failing shape no longer crashes, and that a
 * genuine array (including one delivered as a JSON string, the normal case)
 * still passes through unchanged.
 */
import { normalizeOrderItems, fromDb } from "./App";

describe("normalizeOrderItems / fromDb — order.items boundary normalization", () => {
  test("reproduces the exact production crash shape: double-encoded items ('\"[]\"') no longer throws and normalizes to []", () => {
    // This is the literal raw value found in the poisoned production row.
    const raw = "\"[]\"";
    expect(() => normalizeOrderItems(raw, 3047)).not.toThrow();
    const result = normalizeOrderItems(raw, 3047);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
    // The real-world failure mode: calling .some() on the OLD (unfixed)
    // result would throw. Prove the FIXED result never does.
    expect(() => result.some(() => true)).not.toThrow();
  });

  test("a normal JSON-string-encoded array (the common real-world shape) still parses correctly", () => {
    const raw = JSON.stringify([{ itemName: "Sofa", arrivalDate: "2026-09-01" }]);
    const result = normalizeOrderItems(raw);
    expect(result).toEqual([{ itemName: "Sofa", arrivalDate: "2026-09-01" }]);
  });

  test("an already-parsed array (Supabase JSONB-style delivery) passes through unchanged", () => {
    const arr = [{ itemName: "Chair" }];
    expect(normalizeOrderItems(arr)).toBe(arr);
  });

  test("null items -> []", () => {
    expect(normalizeOrderItems(null)).toEqual([]);
  });

  test("undefined items -> []", () => {
    expect(normalizeOrderItems(undefined)).toEqual([]);
  });

  test("a plain (non-JSON) malformed string -> [] (JSON.parse failure handled, never throws)", () => {
    expect(() => normalizeOrderItems("not json at all")).not.toThrow();
    expect(normalizeOrderItems("not json at all")).toEqual([]);
  });

  test("items that parse to a plain object (not an array) -> []", () => {
    expect(normalizeOrderItems('{"foo":"bar"}')).toEqual([]);
    expect(normalizeOrderItems({ foo: "bar" })).toEqual([]);
  });

  test("items that parse to a number or boolean -> []", () => {
    expect(normalizeOrderItems("42")).toEqual([]);
    expect(normalizeOrderItems("true")).toEqual([]);
  });

  test("empty string items -> []", () => {
    expect(normalizeOrderItems("")).toEqual([]);
  });

  test("fromDb() end-to-end: a poisoned DB row never produces a value that crashes .some()", () => {
    const dbRow = {
      id: 3047, so_number: "TEST-P13-AMEND-1789366538807", customer_name: "P1-3 Amendment Guard Test",
      items: "\"[]\"", // the exact poisoned raw value
    };
    const order = fromDb(dbRow);
    expect(Array.isArray(order.items)).toBe(true);
    expect(() => order.items.some(i => !i.arrivalDate)).not.toThrow();
  });

  test("fromDb() with a normal well-formed row still maps items correctly (no regression)", () => {
    const dbRow = {
      id: 1, so_number: "SO123", items: JSON.stringify([{ itemName: "Table", arrivalDate: "2026-09-01" }]),
    };
    const order = fromDb(dbRow);
    expect(order.items).toEqual([{ itemName: "Table", arrivalDate: "2026-09-01" }]);
  });
});
