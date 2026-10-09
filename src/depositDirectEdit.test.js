// Edit Order UX & permission correction (2026-10-09): money is read-only in Edit Order; the original deposit is
// edited directly (no approval, audited); new money is Collect Payment; approved payments keep their approval flow.
import React from "react";
import fs from "fs";
import path from "path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { parseProofs, PaymentSummaryPanel, DepositEditModal, PaymentHistoryModal } from "./depositChange";
import { ledgerActions } from "./paymentLedgerPolicy";
import PaymentLedgerRow from "./PaymentLedgerRow";
import { ToastProvider } from "./UIComponents";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "sam", role: "salesman" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));
const wrap = ui => <ToastProvider>{ui}</ToastProvider>;
afterEach(() => { delete global.fetch; });

describe("Edit Order: read-only money + three actions", () => {
  test("summary shows order total, original deposit, additional payments, total paid, balance", () => {
    const onCollect = jest.fn(), onHistory = jest.fn(), onEditDeposit = jest.fn();
    render(<PaymentSummaryPanel summary={{ order_total: 1000, original_deposit: 300, additional_payments: 200, total_paid: 500, balance: 500 }} onCollect={onCollect} onHistory={onHistory} onEditDeposit={onEditDeposit} />);
    const p = screen.getByTestId("payment-summary");
    expect(p).toHaveTextContent(/Order total\s*RM 1,000\.00/);
    expect(p).toHaveTextContent(/Original deposit\s*RM 300\.00/);
    expect(p).toHaveTextContent(/Additional payments\s*RM 200\.00/);
    expect(p).toHaveTextContent(/Total paid\s*RM 500\.00/);
    expect(screen.getByTestId("summary-balance")).toHaveTextContent("RM 500.00");
    expect(p.querySelector("input")).toBeNull();                       // nothing editable
    fireEvent.click(screen.getByTestId("collect-payment-btn")); fireEvent.click(screen.getByTestId("payment-history-btn")); fireEvent.click(screen.getByTestId("edit-deposit-btn"));
    expect(onCollect).toHaveBeenCalled(); expect(onHistory).toHaveBeenCalled(); expect(onEditDeposit).toHaveBeenCalled();
  });
  test("OrdersPage: the edit save sends NO money fields; Collect Payment reuses Record Payment; clear Saved / Submitted / Not saved", () => {
    const src = fs.readFileSync(path.join(__dirname, "OrdersPage.js"), "utf8");
    expect(src).toMatch(/if \(editId\) \{ delete body\.deposit; delete body\.payment_method; delete body\.payment_proofs; \}/);
    expect(src).not.toMatch(/deposit_change_reason|deposit_loaded|Deposit \/ Payment collected/);
    expect(src).toMatch(/<PaymentSummaryPanel summary=\{paymentSummary\}/);
    expect(src).toMatch(/editPayOpen && editingOrder && editLegacy\?\.id && \(\s*<RecordPaymentModal/);
    expect(src).toMatch(/toast\.success\("Saved successfully"\)/);
    expect(src).toMatch(/Not saved\$\{res\.status === 409 \? " — conflict" : ""\}/);
    expect(src).toMatch(/pending_amendment_kept\?\.conflicts/);
  });
});

describe("Edit Original Deposit — direct, no approval", () => {
  test("saves directly via PATCH with the reason and the stale-form guard; reversal sends RM0", async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => { calls.push({ url: String(url), method: opts.method, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ commission: { status: "done" } }) }; };
    const saved = jest.fn();
    render(wrap(<DepositEditModal salesOrderId="so1" orderNumber="30228" current={{ initial_deposit: 300, payment_method: "Cash", payment_proofs: "https://x/a.jpg,https://x/b.jpg" }} onClose={() => {}} onSaved={saved} />));
    fireEvent.change(screen.getByLabelText("Deposit amount"), { target: { value: "450" } });
    fireEvent.click(screen.getByTestId("save-deposit"));
    expect(screen.getByTestId("deposit-error")).toHaveTextContent("Enter a reason");          // reason required
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Customer slip" } });
    fireEvent.click(screen.getByTestId("save-deposit"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ url: expect.stringMatching(/\/sales-orders\/so1\/deposit$/), method: "PATCH",
      body: { initial_deposit: 450, payment_method: "Cash", reason: "Customer slip", expected: { initial_deposit: 300, payment_method: "Cash", payment_proofs: ["https://x/a.jpg", "https://x/b.jpg"] } } });
    expect(calls[0].body.payment_proofs).toEqual(["https://x/a.jpg", "https://x/b.jpg"]);
    expect(calls.some(c => /approve|deposit-requests|\/payments/.test(c.url))).toBe(false);      // no approval request, no payment
  });
  test("a conflict is shown as Not saved — nothing pretends to have worked", async () => {
    global.fetch = async () => ({ ok: false, status: 409, json: async () => ({ code: "stale", error: "The deposit was changed by someone else since you opened it" }) });
    const saved = jest.fn();
    render(wrap(<DepositEditModal salesOrderId="so1" current={{ initial_deposit: 300 }} mode="reverse" onClose={() => {}} onSaved={saved} />));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Refund" } });
    fireEvent.click(screen.getByTestId("save-deposit"));
    expect(await screen.findByTestId("deposit-error")).toHaveTextContent(/Not saved — The deposit was changed by someone else/);
    expect(saved).not.toHaveBeenCalled();
  });
  test("payment history shows the deposit, the payments and the deposit audit (before → after, who, why, proof taken off)", async () => {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
      lines: [{ source_type: "SO_DEPOSIT", amount: 450, payment_method: "Cash" }, { id: "p1", source_type: "PAYMENT_TRANSACTION", amount: 200, payment_method: "Cash", approval_status: "approved" }],
      deposit_history: [{ id: "e1", event_type: "deposit.edited", created_at: "2026-10-09T03:00:00Z", payload: { before: { initial_deposit: 300 }, after: { initial_deposit: 450 }, reason: "Customer slip", actor_name: "Sam", superseded_proofs: ["https://x/b.jpg"] } }],
    }) });
    render(<PaymentHistoryModal salesOrderId="so1" onClose={() => {}} />);
    expect(await screen.findAllByTestId("history-line")).toHaveLength(2);
    const row = screen.getByTestId("deposit-history-row");
    expect(row).toHaveTextContent(/RM 300\.00.*RM 450\.00/);
    expect(row).toHaveTextContent(/Sam .* “Customer slip”/);
    expect(row).toHaveTextContent("b.jpg");
  });
});

describe("Customer Profile → Payment History", () => {
  const sales = { id: "sam", role: "salesman" };
  const dep = { source_type: "SO_DEPOSIT", _deposit: true, sales_order_id: "so1", so_number: "30228", amount: 300, payment_method: "Cash", paid_at: "2026-09-01T00:00:00Z" };
  test("deposit: Edit / Reverse Deposit are direct (no pending-request gate); History always available", () => {
    expect(ledgerActions(dep, sales).deposit).toMatchObject({ canEdit: true, canReverse: true });
    expect(ledgerActions({ ...dep, deposit_request: { status: "pending" } }, sales).deposit.canEdit).toBe(true); // an old request never blocks
    render(<PaymentLedgerRow p={dep} user={sales} />);
    expect(screen.getByTestId("edit-deposit-btn")).toHaveAttribute("title", expect.stringMatching(/saved immediately/));
    expect(screen.getByTestId("history-btn")).toBeInTheDocument();
  });
  test("older order without a recorded deposit baseline → edited from Edit Order (its true deposit is shown there)", () => {
    expect(ledgerActions({ ...dep, legacy_baseline: true }, sales).deposit).toMatchObject({ canEdit: false, blockedReason: expect.stringMatching(/Edit Order/) });
  });
  test("approved payment transactions keep their request → approval workflow (no direct delete)", () => {
    const appr = { id: "p1", source_type: "PAYMENT_TRANSACTION", amount: 200, approval_status: "approved", recorded_by: "sam" };
    expect(ledgerActions(appr, { id: "boss", role: "manager" })).toMatchObject({ canRemove: false, requestChange: true });
  });
  test("proof parsing keeps legacy comma lists", () => {
    expect(parseProofs("https://x/a.jpg,https://x/b.jpg")).toEqual(["https://x/a.jpg", "https://x/b.jpg"]);
  });
});
