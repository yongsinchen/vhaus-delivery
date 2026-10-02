// Desktop login "t.some is not a function" hardening — unit tests for the
// single-boundary, FAIL-CLOSED normalizers in safeData.js.
const fs = require("fs");
const path = require("path");
import {
  normalizeOrderItems, normalizePermissionKeys, normalizePermissionResponse,
  normalizeAvailableCompanies, isValidCompanyId, readStoredCompanyId,
} from "./safeData";

const CID = "11111111-2222-3333-4444-555555555555";
const mkStore = (initial = {}) => {
  const m = { ...initial };
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m };
};

describe("normalizeOrderItems — items always a real array", () => {
  test.each([
    ["array", [{ a: 1 }], [{ a: 1 }]],
    ["JSON string array", '[{"a":1}]', [{ a: 1 }]],
    ["double-encoded '\"[]\"'", '"[]"', []],
    ["empty string", "", []],
    ["null", null, []],
    ["undefined", undefined, []],
    ["object", { a: 1 }, []],
    ["JSON object string", '{"a":1}', []],
    ["number", 7, []],
    ["corrupt JSON", "[{oops", []],
  ])("%s", (_n, raw, expected) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const out = normalizeOrderItems(raw, 1);
    expect(out).toEqual(expected);
    expect(() => out.some(() => true)).not.toThrow();
    warn.mockRestore();
  });
});

describe("normalizePermissionKeys / normalizePermissionResponse — fail closed", () => {
  test("valid array passes through; non-string / blank members are dropped", () => {
    expect(normalizePermissionKeys(["ORDERS_VIEW", "", "  ", 5, null, {}, "FINANCE_VIEW"])).toEqual(["ORDERS_VIEW", "FINANCE_VIEW"]);
  });
  test.each([["string", "ORDERS_VIEW"], ["object", { ORDERS_VIEW: true }], ["null", null], ["undefined", undefined], ["number", 3], ["empty", ""]])(
    "malformed effectivePermissions (%s) grants NOTHING", (_n, raw) => {
      expect(normalizePermissionKeys(raw)).toEqual([]);
    });
  test("a string is never spread into characters", () => {
    expect(normalizePermissionKeys("abc")).toEqual([]);
  });
  test("/permissions/effective: array, or object map where only explicitly-allowed keys count", () => {
    expect(normalizePermissionResponse(["A", "B"])).toEqual(["A", "B"]);
    expect(normalizePermissionResponse({ A: true, B: { allowed: true }, C: { allowed: false }, D: false, E: "yes", F: null })).toEqual(["A", "B"]);
    expect(normalizePermissionResponse("A")).toEqual([]);
    expect(normalizePermissionResponse(null)).toEqual([]);
  });
});

describe("normalizeAvailableCompanies — wrong shape never exposes a company", () => {
  const good = { companyId: CID, companyName: "X", roleName: "salesman" };
  test("valid entries kept", () => { expect(normalizeAvailableCompanies([good])).toEqual([good]); });
  test.each([["wrapper object", { companies: [good] }], ["string", "[]"], ["null", null], ["undefined", undefined], ["number", 2], ["single object", good]])(
    "%s -> []", (_n, raw) => { expect(normalizeAvailableCompanies(raw)).toEqual([]); });
  test("malformed entries inside an array are dropped, not coerced", () => {
    expect(normalizeAvailableCompanies([good, null, "x", {}, { companyId: 5 }, { companyId: "not-a-uuid" }, { companyId: "" }])).toEqual([good]);
  });
});

describe("readStoredCompanyId — stale / corrupt device storage", () => {
  test("a valid UUID is returned unchanged and kept", () => {
    const st = mkStore({ pulseActiveCompanyId: CID });
    expect(readStoredCompanyId(st)).toBe(CID);
    expect(st._m.pulseActiveCompanyId).toBe(CID);
  });
  test.each(["", "null", "undefined", "{}", "[]", "[object Object]", '["x"]', '{"id":"x"}', "not-a-uuid", "  "])(
    "corrupt value %j -> null and the poisoned key is removed (not re-sent on every request)", (bad) => {
      const st = mkStore({ pulseActiveCompanyId: bad });
      expect(readStoredCompanyId(st)).toBeNull();
      expect("pulseActiveCompanyId" in st._m).toBe(false);
    });
  test("no stored value -> null; a throwing storage never throws", () => {
    expect(readStoredCompanyId(mkStore())).toBeNull();
    expect(readStoredCompanyId({ getItem() { throw new Error("blocked"); } })).toBeNull();
    expect(readStoredCompanyId(null)).toBeNull();
  });
  test("isValidCompanyId", () => {
    expect(isValidCompanyId(CID)).toBe(true);
    expect(isValidCompanyId(null)).toBe(false);
    expect(isValidCompanyId({})).toBe(false);
    expect(isValidCompanyId(12345)).toBe(false);
  });
});

describe("no page re-parses order items unsafely", () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");
  test.each(["DeliverySchedule.js", "DriverPage.js", "App.js"])("%s has no raw JSON.parse(items) copy and uses the canonical normalizer", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/JSON\.parse\(items\b/);
    expect(src).toMatch(/normalizeOrderItems/);
  });
});
