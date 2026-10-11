/**
 * Customer Payment History → single Sales Order filtering.
 * Verifies split/2C2P allocations show only the SO's share, deposit + payments
 * are not double-counted, and unrelated rows are excluded. Uses the same row
 * shapes GET /customers/:id returns.
 */
import { filterPaymentsForSo } from "./soPaymentFilter";

// Legacy order ids (orders.id). SO 30228 => legacy 4481; another SO => 4504.
const SO = { orderId: 4481, soNumber: "30228" };

const deposit = (so_number, order_id, amount) => ({ _deposit: true, id: null, so_number, order_id, amount, payment_method: "Cash", approval_status: "approved" });
const payment = (id, order_id, amount, allocations) => ({ id, order_id, amount, payment_method: "Bank Transfer", approval_status: "approved", payment_allocations: allocations || null });

describe("filterPaymentsForSo", () => {
  test("SO with one direct payment", () => {
    const p = [payment("p1", 4481, 1000)];
    const { rows, total } = filterPaymentsForSo(p, SO);
    expect(rows.map(r => r.id)).toEqual(["p1"]);
    expect(total).toBe(1000);
  });

  test("SO with multiple payments", () => {
    const p = [payment("p1", 4481, 1000), payment("p2", 4481, 500), payment("p3", 9999, 700)];
    const { rows, total } = filterPaymentsForSo(p, SO);
    expect(rows.map(r => r.id)).toEqual(["p1", "p2"]);
    expect(total).toBe(1500);
  });

  test("original deposit only (deposit line, no payments)", () => {
    const p = [deposit("30228", 4481, 6441.9)];
    const { rows, total } = filterPaymentsForSo(p, SO);
    expect(rows).toHaveLength(1);
    expect(rows[0]._deposit).toBe(true);
    expect(total).toBe(6441.9);
  });

  test("deposit + payment are both counted, not duplicated", () => {
    const p = [deposit("30228", 4481, 2000), payment("p1", 4481, 3000)];
    const { rows, total } = filterPaymentsForSo(p, SO);
    expect(rows).toHaveLength(2);
    expect(total).toBe(5000);
  });

  test("split / 2C2P: only the allocation to THIS SO, not the whole payment", () => {
    const p = [payment("split1", null, 5000, [{ order_id: 4481, amount: 1800 }, { order_id: 4504, amount: 3200 }])];
    const { rows, total } = filterPaymentsForSo(p, SO);
    expect(rows).toHaveLength(1);
    expect(rows[0].so_amount).toBe(1800);   // not 5000
    expect(total).toBe(1800);
  });

  test("split payment allocated only to OTHER SOs is excluded", () => {
    const p = [payment("split2", null, 5000, [{ order_id: 4504, amount: 5000 }])];
    expect(filterPaymentsForSo(p, SO).rows).toHaveLength(0);
  });

  test("multiple allocations to the same SO on one payment sum", () => {
    const p = [payment("split3", null, 900, [{ order_id: 4481, amount: 400 }, { order_id: 4481, amount: 500 }])];
    const { rows, total } = filterPaymentsForSo(p, SO);
    expect(rows).toHaveLength(1);
    expect(total).toBe(900);
  });

  test("unrelated deposit line (different SO) excluded", () => {
    const p = [deposit("99999", 4504, 1000)];
    expect(filterPaymentsForSo(p, SO).rows).toHaveLength(0);
  });

  test("deposit matched by so_number even when its order_id is null (legacy)", () => {
    const p = [deposit("30228", null, 1500)];
    const { rows } = filterPaymentsForSo(p, SO);
    expect(rows).toHaveLength(1);
  });

  test("id type tolerance (string vs number order_id)", () => {
    const p = [payment("p1", "4481", 1000)];
    expect(filterPaymentsForSo(p, { orderId: 4481, soNumber: "30228" }).total).toBe(1000);
  });

  test("empty / missing inputs are safe", () => {
    expect(filterPaymentsForSo(null, SO)).toEqual({ rows: [], total: 0 });
    expect(filterPaymentsForSo([], SO)).toEqual({ rows: [], total: 0 });
    expect(filterPaymentsForSo([payment("p1", 4481, 1000)], {}).rows).toHaveLength(0); // no identifiers → nothing
  });
});
