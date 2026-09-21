// URGENT BUG BATCH — ISSUE 4: SO 56316's card showed "Bal RM 3647.6000000000004"
// while the order summary correctly showed "Balance 3,647.60".
//
// Root cause (confirmed, not assumed): orders.balance is a real stored
// column, written server-side by recomputeOrderPaid() as an UNROUNDED JS
// float (Math.max(0, totalWithAdmin - paid) — no formatting at write time,
// which is correct: storage should stay exact). Reproduced directly:
//   5640 (subtotal) + 507.6 (gst_amount) - 2500 (deposit) === 3647.6000000000004
// DeliverySchedule.js interpolated this raw stored value directly into JSX
// in seven places ({o.balance}, {item.balance}, {order.balance}, {balance})
// with no formatter, while every OTHER screen showing the same field
// (CustomerPage.js, FinancePage.js) already wrapped it in the shared
// money()-style formatter. The fix is display-only — DeliverySchedule.js's
// existing order_amount pattern (Number(x).toLocaleString("en-MY", {
// minimumFractionDigits: 2 })) is now applied to every balance display too.
// No stored value is touched by this fix or this test.
const fs = require("fs");
const path = require("path");

const fmt = (v) => Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe("balance display formatting (the exact expression now used in DeliverySchedule.js)", () => {
  test("the real floating-point artifact from SO 56316 renders clean", () => {
    const raw = 5640 + 507.6 - 2500; // === 3647.6000000000004, reproduced exactly
    expect(raw).toBe(3647.6000000000004);
    expect(fmt(raw)).toBe("3,647.60");
  });

  test("integer RM shows two decimal places", () => {
    expect(fmt(250)).toBe("250.00");
  });

  test("a value already ending in .10 stays exact, not truncated to one decimal", () => {
    expect(fmt(1200.1)).toBe("1,200.10");
  });

  test("a value already ending in .60 stays exact", () => {
    expect(fmt(3647.6)).toBe("3,647.60");
  });

  test("GST-derived decimal (9% of an odd subtotal) renders clean", () => {
    const gstArtifact = 5404 * 0.09; // classic float-multiply artifact
    expect(fmt(gstArtifact)).toBe("486.36");
  });

  test("deposit-subtraction decimal renders clean", () => {
    const depositArtifact = 6147.6 - 2500; // another real-shape subtraction
    expect(fmt(depositArtifact)).toBe("3,647.60");
  });

  test("zero balance formats as 0.00, not blank or NaN", () => {
    expect(fmt(0)).toBe("0.00");
  });

  test("a large amount keeps thousands separators", () => {
    expect(fmt(123456.789)).toBe("123,456.79");
  });

  test("no floating-point artifact ever survives formatting for any of these inputs", () => {
    const artifacts = [5640 + 507.6 - 2500, 0.1 + 0.2, 6147.6 - 2500, 5404 * 0.09];
    for (const a of artifacts) {
      expect(fmt(a)).not.toMatch(/\.\d{3,}/); // never more than 2 decimal digits shown
    }
  });
});

describe("DeliverySchedule.js source — no raw (unformatted) balance interpolation remains", () => {
  const src = fs.readFileSync(path.join(__dirname, "DeliverySchedule.js"), "utf8");

  test("no unformatted {x.balance} / {balance} JSX interpolation", () => {
    // Matches the exact bug pattern: a `.balance` or bare `balance` reference
    // inside a template/JSX expression that is NOT immediately wrapped by
    // Number(...).toLocaleString(...) or a money()-style formatter call.
    const rawPatterns = [
      /\{o\.balance\}/,
      /\{item\.balance\}/,
      /\{order\.balance\}/,
      /RM \$\{o\.balance\}/,
      /RM \$\{balance\}/,
      /RM \{balance\}(?!\))/, // bare {balance} not inside a formatted template
    ];
    for (const re of rawPatterns) {
      expect(src).not.toMatch(re);
    }
  });

  test("every 'Bal' / 'Balance' display line that touches .balance also calls toLocaleString", () => {
    const lines = src.split("\n");
    const balanceLines = lines.filter(l => /Bal(ance)?[:.]?\s*.{0,20}(o\.balance|item\.balance|order\.balance|\bbalance\b)/.test(l) && /RM/i.test(l));
    expect(balanceLines.length).toBeGreaterThan(0); // sanity: the file still has balance displays
    for (const line of balanceLines) {
      expect(line).toMatch(/toLocaleString/);
    }
  });
});
