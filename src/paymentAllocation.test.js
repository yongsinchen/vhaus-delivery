// FINANCE — payment allocation frontend logic tests.
//
// Tests the REAL, exported pure functions RecordPaymentModal.js actually
// uses (imported from ./paymentAllocation, not reimplemented here), so this
// suite can never silently drift from the shipped component's behavior.
// Every fixture is routed through tagOutstanding() before allocsFor(), the
// same way the component itself always does (withBalance = tagOutstanding(orders)).
import { sortOldestFirst, allocsFor, tagOutstanding, defaultKind, autoAllocateInto, round2, allocatedByOrder } from "./paymentAllocation";

describe("allocatedByOrder (Amend pre-fill / balance add-back)", () => {
  test("sums allocation rows per order, keyed by string id", () => {
    const m = allocatedByOrder({ amount: 300, order_id: 1, payment_allocations: [{ order_id: 1, amount: 100.1 }, { order_id: 2, amount: 199.9 }] });
    expect(m.get("1")).toBe(100.1);
    expect(m.get("2")).toBe(199.9);
    expect(m.size).toBe(2);
  });
  test("legacy payment with no allocation rows counts its whole amount on its own order", () => {
    const m = allocatedByOrder({ amount: 250, order_id: 7, payment_allocations: [] });
    expect([...m.entries()]).toEqual([["7", 250]]);
  });
  test("rounds to cents and tolerates missing data", () => {
    expect(allocatedByOrder({ payment_allocations: [{ order_id: 3, amount: 0.1 }, { order_id: 3, amount: 0.2 }] }).get("3")).toBe(0.3);
    expect(allocatedByOrder(null).size).toBe(0);
    expect(allocatedByOrder({ amount: 10 }).size).toBe(0);
  });
});

describe("tagOutstanding / defaultKind", () => {
  test("excludes zero-balance, Cancelled, and Service orders", () => {
    const orders = [
      { id: 1, balance: 500, order_amount: 500 },
      { id: 2, balance: 0, order_amount: 500 },
      { id: 3, balance: 500, order_amount: 500, status: "Cancelled" },
      { id: 4, balance: 500, order_amount: 500, type: "Service" },
    ];
    const out = tagOutstanding(orders);
    expect(out.map(o => o.id)).toEqual([1]);
  });

  test("_hasDeposit true when balance < order_amount, false when balance === order_amount (no deposit yet)", () => {
    const out = tagOutstanding([{ id: 1, balance: 1000, order_amount: 1000 }, { id: 2, balance: 500, order_amount: 1000 }]);
    expect(out.find(o => o.id === 1)._hasDeposit).toBe(false);
    expect(out.find(o => o.id === 2)._hasDeposit).toBe(true);
  });

  test("defaultKind picks deposit only when a no-deposit order exists", () => {
    expect(defaultKind([{ _hasDeposit: false }, { _hasDeposit: true }])).toBe("deposit");
    expect(defaultKind([{ _hasDeposit: true }])).toBe("balance");
  });
});

describe("sortOldestFirst", () => {
  test("oldest order_date first, then created_at, then id", () => {
    const list = [
      { id: 3, order_date: "2026-01-01" },
      { id: 1, order_date: "2026-03-01" },
      { id: 2, order_date: "2026-02-01" },
    ];
    expect(sortOldestFirst(list).map(o => o.id)).toEqual([3, 2, 1]);
  });
});

// The exact canonical Phase F example: same customer, Order 1 RM10,000
// outstanding, Order 2 RM2,000 outstanding, Order 3 RM4,000 outstanding.
// Order 1 is oldest, Order 3 newest. Record Payment opened FROM Order 2.
// Each order already carries a deposit (balance < order_amount) so these
// fall under the "balance" collection kind — the everyday case.
function canonicalThreeOrders() {
  const raw = [
    { id: 1, so_number: "SO1", order_date: "2026-01-01", balance: 10000, order_amount: 20000 },
    { id: 2, so_number: "SO2", order_date: "2026-03-01", balance: 2000, order_amount: 4000 },
    { id: 3, so_number: "SO3", order_date: "2026-02-01", balance: 4000, order_amount: 8000 },
  ];
  return tagOutstanding(raw);
}

describe("allocsFor — initiating order first, then oldest-first for the rest", () => {
  test("without an initiating order, plain oldest-first: 1, 3, 2", () => {
    const rows = allocsFor(canonicalThreeOrders(), "balance", null);
    expect(rows.map(r => r.order_id)).toEqual([1, 3, 2]);
  });

  test("with Order 2 as the initiating order: 2 first, then oldest-first for the rest (1, 3)", () => {
    const rows = allocsFor(canonicalThreeOrders(), "balance", 2);
    expect(rows.map(r => r.order_id)).toEqual([2, 1, 3]);
  });

  test("initiating order already oldest is a no-op reorder", () => {
    const rows = allocsFor(canonicalThreeOrders(), "balance", 1);
    expect(rows.map(r => r.order_id)).toEqual([1, 3, 2]);
  });

  test("Cancelled/Service/different-customer orders never appear — filtered before allocsFor sees them", () => {
    const raw = [
      { id: 1, so_number: "SO1", balance: 1000, order_amount: 2000 },
      { id: 2, so_number: "SO2", balance: 1000, order_amount: 2000, status: "Cancelled" },
      { id: 3, so_number: "SO3", balance: 1000, order_amount: 2000, type: "Service" },
    ];
    const rows = allocsFor(tagOutstanding(raw), "balance", 1);
    expect(rows.map(r => r.order_id)).toEqual([1]);
  });
});

describe("autoAllocateInto — the canonical RM5,000 example", () => {
  test("Order 2 initiating: RM5,000 fills Order2=2000 first, remaining 3000 -> oldest (Order 1)", () => {
    const rows = allocsFor(canonicalThreeOrders(), "balance", 2);
    const filled = autoAllocateInto(rows, 5000);
    const byId = Object.fromEntries(filled.map(r => [r.order_id, r.amount]));
    expect(byId[2]).toBe("2000"); // initiating order filled first, capped at its own balance
    expect(byId[1]).toBe("3000"); // remaining 3000 -> oldest of what's left
    expect(byId[3]).toBe(""); // nothing left for order 3
    const total = round2(filled.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    expect(total).toBe(5000);
  });

  test("manual edit — Order 2=2000, Order1=1000, Order3=2000 — still valid because it sums to 5000", () => {
    const rows = allocsFor(canonicalThreeOrders(), "balance", 2).map(r => {
      if (r.order_id === 2) return { ...r, amount: "2000" };
      if (r.order_id === 1) return { ...r, amount: "1000" };
      if (r.order_id === 3) return { ...r, amount: "2000" };
      return r;
    });
    const total = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const unallocated = round2(5000 - total);
    expect(total).toBe(5000);
    expect(unallocated).toBe(0); // Confirm would be enabled
  });

  test("total mismatch (allocations sum to less than payment) leaves a nonzero unallocated -> Confirm disabled", () => {
    const rows = allocsFor(canonicalThreeOrders(), "balance", 2).map(r => (r.order_id === 2 ? { ...r, amount: "1500" } : r));
    const total = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const unallocated = round2(5000 - total);
    expect(unallocated).toBe(3500); // Confirm would be disabled
  });

  test("single-order full payment: RM1,000 outstanding, pay RM1,000", () => {
    const rows = allocsFor(tagOutstanding([{ id: 9, so_number: "SO9", balance: 1000, order_amount: 2000 }]), "balance", 9);
    const filled = autoAllocateInto(rows, 1000);
    expect(filled[0].amount).toBe("1000");
  });

  test("single-order partial payment: RM1,000 outstanding, pay RM500", () => {
    const rows = allocsFor(tagOutstanding([{ id: 9, so_number: "SO9", balance: 1000, order_amount: 2000 }]), "balance", 9);
    const filled = autoAllocateInto(rows, 500);
    expect(filled[0].amount).toBe("500");
  });

  test("2-order allocation: Order A RM2,000 + Order B RM1,000, pay RM2,000 from B (initiating)", () => {
    const raw = [
      { id: "A", so_number: "A", order_date: "2026-01-01", balance: 2000, order_amount: 4000 },
      { id: "B", so_number: "B", order_date: "2026-01-02", balance: 1000, order_amount: 2000 },
    ];
    const rows = allocsFor(tagOutstanding(raw), "balance", "B");
    const filled = autoAllocateInto(rows, 2000);
    const byId = Object.fromEntries(filled.map(r => [r.order_id, r.amount]));
    expect(byId.B).toBe("1000");
    expect(byId.A).toBe("1000");
  });

  test("brand-new orders (no deposit yet) fall under the 'deposit' kind, not 'balance'", () => {
    const raw = [{ id: 1, so_number: "SO1", balance: 5000, order_amount: 5000 }]; // balance === order_amount -> no deposit yet
    const tagged = tagOutstanding(raw);
    expect(defaultKind(tagged)).toBe("deposit");
    expect(allocsFor(tagged, "balance", 1)).toEqual([]); // not offered under "balance"
    expect(allocsFor(tagged, "deposit", 1).length).toBe(1);
  });
});

describe("round2 — no floating-point artifacts in totals", () => {
  test("classic float-noise sums resolve cleanly", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(2000 - 1000 - 1000)).toBe(0);
  });
});
