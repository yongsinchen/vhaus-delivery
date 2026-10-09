// Migration 117 — every change to an existing deposit / approved payment is an approval request.
import React from "react";
import fs from "fs";
import path from "path";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { parseProofs, depositChangeOf, recordedDepositOf, PendingDepositNotice } from "./depositChange";
import { ledgerActions } from "./paymentLedgerPolicy";
import PaymentLedgerRow from "./PaymentLedgerRow";
import { AmendmentApprovalQueue, DepositRequestModal, changeRows } from "./AmendmentRequests";
import { ToastProvider } from "./UIComponents";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "fin", role: "finance" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

const order = { id: "so1", deposit: 500, initial_deposit: 300, payment_method: "Cash", payment_proofs: "https://x/a.jpg,https://x/b.jpg" };

describe("Edit Order: what counts as a change to an existing deposit", () => {
  test("legacy comma-separated proofs parse as a list (never a phantom change)", () => {
    expect(parseProofs("https://x/a.jpg,https://x/b.jpg")).toEqual(["https://x/a.jpg", "https://x/b.jpg"]);
    expect(parseProofs('["u1"]')).toEqual(["u1"]);
    expect(parseProofs(null)).toEqual([]);
    expect(depositChangeOf(order, { deposit: 500, payment_method: "Cash", payment_proofs: parseProofs(order.payment_proofs) }).changed).toBe(false);
  });
  test("amount (paid-to-date field), method and proof changes are detected", () => {
    const base = { deposit: 500, payment_method: "Cash", payment_proofs: parseProofs(order.payment_proofs) };
    expect(depositChangeOf(order, { ...base, deposit: 550 })).toMatchObject({ changed: true, amount: true });
    expect(depositChangeOf(order, { ...base, payment_method: "Card" })).toMatchObject({ changed: true, method: true });
    expect(depositChangeOf(order, { ...base, payment_proofs: ["https://x/a.jpg"] })).toMatchObject({ changed: true, proofs: true });
  });
  test("an order with no recorded deposit records its first deposit directly (no request)", () => {
    expect(recordedDepositOf({ initial_deposit: 0, deposit: 0 })).toBe(0);
    expect(depositChangeOf({ initial_deposit: 0, deposit: 0 }, { deposit: 200 }).changed).toBe(false);
  });
  test("pending notice: current approved deposit → proposed, inputs locked", () => {
    render(<PendingDepositNotice order={order} request={{ request_type: "edit", requested_by_name: "Sam", reason: "slip", before_snapshot: { initial_deposit: 300, payment_method: "Cash" },
      proposed_snapshot: { initial_deposit: 450, payment_method: "Cash", entered_paid_total: 650 } }} />);
    const n = screen.getByTestId("pending-deposit-notice");
    expect(n).toHaveTextContent("Deposit Change Pending Approval");
    expect(n).toHaveTextContent(/RM 300\.00.*RM 450\.00/);
    expect(n).toHaveTextContent("entered as total paid RM 650.00");
  });
  test("OrdersPage wires it: reason required + sent, notice + locked fields, outcome toasts", () => {
    const src = fs.readFileSync(path.join(__dirname, "OrdersPage.js"), "utf8");
    expect(src).toMatch(/body\.deposit_change_reason = form\.deposit_change_reason\.trim\(\)/);
    expect(src).toMatch(/Enter a reason for the deposit change/);
    expect(src).toMatch(/<PendingDepositNotice request=\{pendingDepositRequest\}/);
    expect(src).toMatch(/disabled=\{!!pendingDepositRequest\}/);
    expect(src).toMatch(/Deposit change submitted for Manager \/ Finance approval/);
    expect(src).toMatch(/the deposit change was NOT submitted/);
    expect(src).toMatch(/payment_proofs: parseProofs\(f\.payment_proofs\)/);
  });
});

describe("Customer Profile → Payment History", () => {
  const sales = { id: "sam", role: "salesman" };
  const dep = { source_type: "SO_DEPOSIT", _deposit: true, sales_order_id: "so1", so_number: "30228", amount: 300, payment_method: "Cash", proof_url: "https://x/a.jpg", paid_at: "2026-09-01T00:00:00Z" };
  const appr = { id: "p1", source_type: "PAYMENT_TRANSACTION", amount: 200, approval_status: "approved", recorded_by: "sam", payment_method: "Cash", paid_at: "2026-09-02T00:00:00Z" };
  test("deposit: Edit / Reverse Deposit offered; hidden while a request is pending (one at a time) — badge + History instead", () => {
    expect(ledgerActions(dep, sales).deposit).toMatchObject({ canEdit: true, canReverse: true, pending: false });
    const pend = { ...dep, deposit_request: { id: "r", status: "pending", reason: "x" } };
    expect(ledgerActions(pend, sales).deposit).toMatchObject({ canEdit: false, canReverse: false, pending: true });
    render(<PaymentLedgerRow p={pend} user={sales} />);
    expect(screen.queryByTestId("edit-deposit-btn")).toBeNull();
    expect(screen.getByTestId("request-badge")).toHaveTextContent(/Deposit change pending approval/i);
    expect(screen.getByTestId("history-btn")).toBeInTheDocument();
  });
  test("legacy deposit without a recorded baseline → no request buttons (server refuses it too)", () => {
    expect(ledgerActions({ ...dep, legacy_baseline: true }, sales).deposit).toMatchObject({ canEdit: false, blockedReason: expect.any(String) });
  });
  test("approved payment: no direct Remove — Request change / reversal instead; a salesman only for payments they recorded", () => {
    const a = ledgerActions(appr, { id: "boss", role: "manager" });
    expect(a.canRemove).toBe(false);
    expect(a.requestChange).toBe(true);
    expect(ledgerActions(appr, sales).requestChange).toBe(true);
    expect(ledgerActions(appr, { id: "zed", role: "salesman" }).requestChange).toBe(false);
    expect(ledgerActions({ ...appr, approval_status: "pending" }, sales).requestChange).toBe(false); // pending keeps Edit Payment
  });
  test("Edit Deposit modal submits an approval REQUEST with the deposit's own fields + reason (no payment row)", async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => { calls.push({ url: String(url), body: opts.body && JSON.parse(opts.body) }); return { ok: true, status: 201, json: async () => ({ request: { id: "r1" } }) }; };
    const done = jest.fn();
    render(<ToastProvider><DepositRequestModal line={dep} mode="edit" onClose={() => {}} onDone={done} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Deposit amount"), { target: { value: "320" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Bank slip shows 320" } });
    fireEvent.click(screen.getByTestId("submit-deposit-request"));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(calls[0].url).toMatch(/\/sales-orders\/so1\/deposit-requests$/);
    expect(calls[0].body).toMatchObject({ request_type: "edit", initial_deposit: 320, payment_method: "Cash", reason: "Bank slip shows 320" });
    expect(JSON.parse(calls[0].body.payment_proofs)).toEqual(["https://x/a.jpg"]);
    expect(calls.some(c => /\/payments/.test(c.url))).toBe(false);
    delete global.fetch;
  });
});

describe("Finance → Amendments (approval review)", () => {
  const rows = [
    { kind: "deposit", id: "d1", status: "pending", request_type: "edit", requested_by: "sam", requested_by_name: "Sam", requested_at: "2026-10-09T01:00:00Z", reason: "slip",
      sales_order: { order_number: "30228", customer_name: "Xavier" }, before_snapshot: { initial_deposit: 300, payment_method: "Cash" }, proposed_snapshot: { initial_deposit: 450, payment_method: "Bank transfer" } },
    { kind: "payment", id: "p1", status: "pending", request_type: "reverse", requested_by: "fin", requested_by_name: "Fin", requested_at: "2026-10-09T02:00:00Z", reason: "duplicate",
      before_snapshot: { amount: 200, or_number: 501 }, proposed_snapshot: { reverse: true } },
    { kind: "deposit", id: "d2", status: "approved", request_type: "edit", requested_by: "sam", recalc_status: "failed", recalc_error: "order 7: down", reviewed_at: "2026-10-09T03:00:00Z",
      commission_review: { note: "Commission already PAID …", paid_commissions: [{}] }, sales_order: { order_number: "1" }, before_snapshot: {}, proposed_snapshot: {} },
  ];
  test("shows customer / SO, before → after, requester, reason, time; approve / reject for others' requests, never your own", async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || "GET", body: opts.body && JSON.parse(opts.body) });
      if ((opts.method || "GET") === "GET") return { ok: true, status: 200, json: async () => ({ requests: rows, is_approver: true, me: "fin" }) };
      return { ok: true, status: 200, json: async () => ({ request: {}, commission: { status: "done" } }) };
    };
    render(<ToastProvider><AmendmentApprovalQueue user={{ id: "fin", role: "finance" }} /></ToastProvider>);
    const list = await screen.findAllByTestId("queue-row");
    expect(list[0]).toHaveTextContent("SO 30228 · Xavier");
    expect(list[0]).toHaveTextContent(/Deposit amount.*RM 300\.00.*RM 450\.00/);
    expect(list[0]).toHaveTextContent(/Requested by Sam/);
    expect(list[0]).toHaveTextContent("slip");
    expect(within(list[1]).getByTestId("own-request")).toBeInTheDocument();          // Fin's own request: no approve
    expect(within(list[1]).queryByTestId("approve-btn")).toBeNull();
    expect(within(list[2]).getByTestId("commission-review")).toBeInTheDocument();    // paid commission flagged
    expect(list[2]).toHaveTextContent("Commission recalculation failed");
    fireEvent.click(within(list[0]).getByTestId("reject-btn"));                         // reject needs a note
    expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
    fireEvent.click(within(list[0]).getByTestId("approve-btn"));
    await waitFor(() => expect(calls.some(c => c.method === "POST" && /\/amendment-requests\/deposit\/d1\/approve$/.test(c.url))).toBe(true));
    delete global.fetch;
  });
  test("before → after rows use only the fields each record type has", () => {
    expect(changeRows(rows[0]).map(r => r[0])).toEqual(["Deposit amount", "Payment method", "Proof"]);
    expect(changeRows({ ...rows[1], sales_order_id: undefined })).toEqual([["Payment", "RM 200.00", "Reversed (RM 0.00)"]]);
  });
  test("FinancePage has the Amendments tab; approved payments are not deleted directly", () => {
    const src = fs.readFileSync(path.join(__dirname, "FinancePage.js"), "utf8");
    expect(src).toMatch(/"Amendments"\]/);
    expect(src).toMatch(/tab === 5 && <AmendmentApprovalQueue/);
    expect(src).toMatch(/p\.approval_status === "approved" \? \(\s*<span[^>]*>reverse via request/);
  });
});
