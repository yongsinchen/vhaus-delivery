// The payout tab shows each salesperson their SHARE of a split order.
//
// The invariant that matters: commission_amt is ALREADY divided by the number of
// salesmen on the order (calculateCommission divides tier, clearance, product and
// package components by n), and net_amount is ALREADY GST-exclusive for Singapore
// (getCommissionableAmount divides by 1.09 before storing). So the display must
// divide net_amount by the salesman count and nothing else — dividing again by
// 1.09, or dividing commission_amt, would understate real money.
import { salesmenOf, shareCountOf, shareNetOf, totalSalesOf, ownSalesInMonth } from "./CommissionPage";

const comm = (over = {}) => ({
  role_name: "salesman",
  net_amount: 10000,
  commission_amt: 300,
  orders: { salesman: "Alice", order_date: "2026-07-14", ...(over.orders || {}) },
  ...over,
});

describe("salesmenOf / shareCountOf", () => {
  test("single salesman", () => {
    expect(salesmenOf(comm())).toEqual(["Alice"]);
    expect(shareCountOf(comm())).toBe(1);
  });

  test("splits on / and trims", () => {
    const c = comm({ orders: { salesman: "Alice / Bob" } });
    expect(salesmenOf(c)).toEqual(["Alice", "Bob"]);
    expect(shareCountOf(c)).toBe(2);
  });

  test("three-way split, inconsistent spacing", () => {
    expect(shareCountOf(comm({ orders: { salesman: "Alice/Bob /  Carol" } }))).toBe(3);
  });

  test("trailing separator does not inflate the count", () => {
    // Would divide by 3 instead of 2 and understate everyone's sales.
    expect(shareCountOf(comm({ orders: { salesman: "Alice / Bob /" } }))).toBe(2);
  });

  test("missing or empty salesman falls back to 1, never 0", () => {
    expect(shareCountOf(comm({ orders: { salesman: null } }))).toBe(1);
    expect(shareCountOf(comm({ orders: { salesman: "  " } }))).toBe(1);
    expect(shareCountOf({ role_name: "salesman", net_amount: 1 })).toBe(1); // no orders join
  });
});

describe("shareNetOf", () => {
  test("sole salesman keeps the whole net amount", () => {
    expect(shareNetOf(comm())).toBe(10000);
  });

  test("two salesmen each see half", () => {
    expect(shareNetOf(comm({ orders: { salesman: "Alice / Bob" } }))).toBe(5000);
  });

  test("Singapore GST is NOT deducted again", () => {
    // net_amount is already order_amount / 1.09. A RM10,900 SG order stores
    // 10000; the share must be exactly 10000, not 10000/1.09.
    const sg = comm({ net_amount: 10000, orders: { salesman: "Alice" } });
    expect(shareNetOf(sg)).toBe(10000);
    const sgShared = comm({ net_amount: 10000, orders: { salesman: "Alice / Bob" } });
    expect(shareNetOf(sgShared)).toBe(5000); // split only, no second 1.09
  });

  test("override rows are never divided", () => {
    // A branch/director override earns its rate on the whole order however many
    // salesmen split the sale — which is why its commission_amt has no /n either.
    for (const role of ["branch_override", "director_override", "branch_manager"]) {
      const c = comm({ role_name: role, orders: { salesman: "Alice / Bob" } });
      expect(shareNetOf(c)).toBe(10000);
    }
  });

  test("missing net_amount is 0, not NaN", () => {
    expect(shareNetOf(comm({ net_amount: null, orders: { salesman: "Alice / Bob" } }))).toBe(0);
  });
});

describe("totals reconcile with what is actually paid", () => {
  test("a split order counts once across both people, not twice", () => {
    // One RM10,000 order split between Alice and Bob produces two commission
    // rows, each carrying the FULL net_amount. Summing net_amount directly
    // would report RM20,000 of company sales from a RM10,000 order.
    const shared = { salesman: "Alice / Bob", order_date: "2026-07-14" };
    const alice = { commissions: [comm({ orders: shared })] };
    const bob = { commissions: [comm({ orders: shared })] };
    expect(totalSalesOf(alice)).toBe(5000);
    expect(totalSalesOf(bob)).toBe(5000);
    expect(totalSalesOf(alice) + totalSalesOf(bob)).toBe(10000); // the order's real value
  });

  test("share of net x rate reproduces the commission actually stored", () => {
    // The backend computes (net x rate) / n. Displaying (net / n) x rate must
    // land on the same number, or the tab shows a rate that cannot produce the
    // payout next to it.
    const c = comm({ net_amount: 10000, commission_amt: 150, orders: { salesman: "Alice / Bob" } });
    expect(shareNetOf(c) * 0.03).toBeCloseTo(c.commission_amt, 10);
  });

  test("override earnings stay out of a person's own sales", () => {
    const u = { commissions: [
      comm({ orders: { salesman: "Alice / Bob" } }),                              // own, split
      comm({ role_name: "branch_override", net_amount: 50000 }),                  // not their sale
    ] };
    expect(totalSalesOf(u)).toBe(5000);
  });

  test("ownSalesInMonth divides too, and ignores other months", () => {
    const u = { commissions: [
      comm({ orders: { salesman: "Alice / Bob", order_date: "2026-07-14" } }),
      comm({ orders: { salesman: "Alice", order_date: "2026-06-30" } }),          // earlier month
    ] };
    expect(ownSalesInMonth(u, "2026-07")).toBe(5000);
    expect(ownSalesInMonth(u, "2026-06")).toBe(10000);
  });
});
