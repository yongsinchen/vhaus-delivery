// BALANCE FLOATING-POINT PRECISION — regression guard for the canonical
// formatMoney() helper (UIComponents.js). SO56316's Balance card showed the
// raw IEEE-754 result of 5640 + 507.6 - 2500 ("3647.6000000000004") instead
// of RM3,647.60 — every screen's own `money` helper now delegates here.
import { formatMoney } from "./UIComponents";

describe("formatMoney — canonical 2-decimal MYR amount formatting", () => {
  test.each([
    [0, "0.00"],
    [1, "1.00"],
    [1.5, "1.50"],
    [3647.6, "3,647.60"],
    [3647.6000000000004, "3,647.60"], // the exact SO56316 artifact: 5640 + 507.6 - 2500
    [1000.1, "1,000.10"],
    [1000.105, "1,000.11"],
    [1000.115, "1,000.12"],
    [999999.99, "999,999.99"],
    [-0.004, "0.00"], // rounds to zero — must never render as "-0.00"
    [-10.5, "-10.50"],
    [1234567.89, "1,234,567.89"],
  ])("formatMoney(%p) === %p", (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  test("never renders more than 2 decimal digits for any of the known artifact shapes", () => {
    const artifacts = [5640 + 507.6 - 2500, 0.1 + 0.2, 6147.6 - 2500, 5404 * 0.09, 1000.105];
    for (const a of artifacts) expect(formatMoney(a)).not.toMatch(/\.\d{3,}/);
  });

  test("never renders negative zero", () => {
    expect(formatMoney(-0)).not.toMatch(/^-/);
    expect(formatMoney(-0.001)).not.toMatch(/^-/);
  });

  test("non-numeric / null input falls back to 0.00 rather than NaN", () => {
    expect(formatMoney(null)).toBe("0.00");
    expect(formatMoney(undefined)).toBe("0.00");
    expect(formatMoney("")).toBe("0.00");
    expect(formatMoney("not a number")).toBe("0.00");
  });
});
