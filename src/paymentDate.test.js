// Payment Date (payments.payment_date) — helpers + the Record Payment modal.
// The date is a plain "YYYY-MM-DD" string: it must never shift a day through
// UTC conversion, and "today" is the Malaysia local date.
import { render, screen, fireEvent } from "@testing-library/react";
import { myDateOf, myToday, paymentDateError, paymentDateOf, fmtYmd, fmtMyDateTime } from "./paymentDate";
import RecordPaymentModal from "./RecordPaymentModal";

jest.mock("./AuthContext", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
jest.mock("./UIComponents", () => ({
  useToast: () => ({ success: jest.fn(), warning: jest.fn(), error: jest.fn() }),
  useLoading: () => ({ withLoading: async (_m, fn) => fn() }),
  formatMoney: (v) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    n = Math.round((n + Number.EPSILON) * 100) / 100;
    if (n === 0) n = 0;
    return n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
}));

describe("paymentDate helpers", () => {
  test("Malaysia date flips at MY midnight, not UTC midnight", () => {
    expect(myDateOf(new Date("2026-09-30T15:59:00Z"))).toBe("2026-09-30");
    expect(myDateOf(new Date("2026-09-30T16:00:00Z"))).toBe("2026-10-01");
  });

  test("a stored DATE displays as the same calendar day (no UTC shift)", () => {
    expect(fmtYmd("2026-09-28")).toBe("28 Sep 2026");
    expect(paymentDateOf({ payment_date: "2026-09-28", paid_at: "2026-10-01T03:00:00Z" })).toBe("2026-09-28");
  });

  test("legacy row without payment_date falls back to its MY record date", () => {
    // 2026-09-27T17:30Z is 28 Sep 01:30 in Malaysia — the UTC date would be 27th.
    expect(paymentDateOf({ payment_date: null, paid_at: "2026-09-27T17:30:00Z" })).toBe("2026-09-28");
    expect(paymentDateOf({})).toBe("");
  });

  test("validation: today and earlier OK; future, empty and malformed rejected", () => {
    expect(paymentDateError("2026-10-01", "2026-10-01")).toBeNull();
    expect(paymentDateError("2026-09-28", "2026-10-01")).toBeNull();
    expect(paymentDateError("2026-10-02", "2026-10-01")).toMatch(/later than today/);
    expect(paymentDateError("", "2026-10-01")).toMatch(/Select/);
    expect(paymentDateError("28/09/2026", "2026-10-01")).toMatch(/valid/);
  });

  test("audit timestamp shows Malaysia date + time", () => {
    expect(fmtMyDateTime("2026-10-01T02:05:00Z")).toMatch(/^1 Oct 2026, 10:05/);
  });
});

describe("Record Payment modal — Payment Date field", () => {
  const orders = [{ id: 11, soNumber: "SO-1", so_number: "SO-1", balance: 1000, order_amount: 1000, status: "confirmed" }];
  const renderModal = (props = {}) => render(<RecordPaymentModal customer={{ id: 1, name: "C" }} orders={orders} onClose={() => {}} {...props} />);
  const dateInput = () => screen.getByText("Payment Date").parentElement.querySelector('input[type="date"]');

  test("defaults to today (Malaysia) with max = today", () => {
    renderModal();
    expect(dateInput().value).toBe(myToday());
    expect(dateInput().getAttribute("max")).toBe(myToday());
  });

  test("future date shows a message and disables Confirm", () => {
    renderModal();
    const [y, m, d] = myToday().split("-").map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    fireEvent.change(dateInput(), { target: { value: tomorrow } });
    expect(screen.getByText("Payment Date cannot be later than today")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Confirm/ }).disabled).toBe(true);
  });

  test("amend opens on the payment's own Payment Date", () => {
    renderModal({ amendPayment: { id: "p1", amount: 100, payment_method: "Cash", payment_date: "2026-09-28", paid_at: "2026-10-01T03:00:00Z", payment_allocations: [{ order_id: 11, amount: 100 }] } });
    expect(dateInput().value).toBe("2026-09-28");
  });
});
