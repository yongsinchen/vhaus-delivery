// Customer Profile → Payments as ONE ledger: SO deposits and payment transactions side by side, each clearly labelled,
// with the Edit action offered only where an edit flow really exists.
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, within } from "@testing-library/react";
import PaymentLedgerRow from "./PaymentLedgerRow";
import { ledgerActions, sourceOf } from "./paymentLedgerPolicy";

const mgr = { id: "m", role: "manager" };
const jimmy = { id: "jimmy", role: "salesman", base_role: "part_time" };
const other = { id: "other", role: "salesman" };

// the three Mardiana records
const dep84 = { id: null, _deposit: true, source_type: "SO_DEPOSIT", sales_order_id: "so-84", so_number: "56484", amount: 432.91, payment_method: "Cash", paid_at: "2026-09-25T01:00:00Z", recorded_by_name: "Sam", approval_status: "approved", approval_basis: "none", or_number: 1210 };
const dep47 = { id: null, _deposit: true, source_type: "SO_DEPOSIT", sales_order_id: "so-47", so_number: "56347", amount: 7370.58, payment_method: "Bank transfer", paid_at: "2026-09-20T01:00:00Z", recorded_by_name: "Jimmy", approval_status: "approved", approval_basis: "none", or_number: 1200 };
const pay1265 = { id: "p1265", source_type: "PAYMENT_TRANSACTION", amount: 8938, payment_method: "2C2P", reference_no: "REF1", approval_status: "pending", or_number: 1265, recorded_by: "jimmy", recorded_by_name: "Jimmy", paid_at: "2026-09-28T14:41:22Z", proof_url: "https://x/a.jpg" };

const renderRow = (p, user) => render(<PaymentLedgerRow p={p} user={user} />);

describe("source types are explicit", () => {
  test("sourceOf: SO_DEPOSIT / PAYMENT_TRANSACTION, with the legacy _deposit flag as a fallback", () => {
    expect(sourceOf(dep47)).toBe("SO_DEPOSIT");
    expect(sourceOf(pay1265)).toBe("PAYMENT_TRANSACTION");
    expect(sourceOf({ _deposit: true })).toBe("SO_DEPOSIT");
    expect(sourceOf({ id: "x" })).toBe("PAYMENT_TRANSACTION");
  });
  test("a deposit line shows 'Order deposit', its SO, the ORDER date, who recorded it and its Deposit label", () => {
    renderRow(dep47, mgr);
    expect(screen.getByTestId("source-badge")).toHaveTextContent("Order deposit");
    expect(screen.getByText("SO 56347")).toBeInTheDocument();
    expect(screen.getByTestId("payment-meta")).toHaveTextContent(/Order date .*Recorded by Jimmy/);
    expect(screen.getByTestId("approval-label")).toHaveTextContent("Deposit");
    expect(screen.getByText("OR #1200")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-row")).toHaveAttribute("data-source", "SO_DEPOSIT");
  });
  test("a payment transaction shows 'Payment', its reference, status and who recorded it", () => {
    renderRow(pay1265, mgr);
    expect(screen.getByTestId("source-badge")).toHaveTextContent("Payment");
    expect(screen.getByText("Ref: REF1")).toBeInTheDocument();
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
    expect(screen.getByTestId("payment-meta")).toHaveTextContent("Recorded by Jimmy");
    expect(screen.queryByText("Order date", { exact: false })).not.toBeInTheDocument();
  });
  test("an approved payment transaction shows 'Approved' (a deposit never does)", () => {
    renderRow({ ...pay1265, approval_status: "approved" }, mgr);
    expect(screen.getByTestId("approval-label")).toHaveTextContent("Approved");
  });
  test("all three Mardiana records are visible together", () => {
    render(<div>{[dep84, dep47, pay1265].map((p, i) => <PaymentLedgerRow key={i} p={p} user={mgr} />)}</div>);
    const rows = screen.getAllByTestId("ledger-row");
    expect(rows.map(r => r.getAttribute("data-source"))).toEqual(["SO_DEPOSIT", "SO_DEPOSIT", "PAYMENT_TRANSACTION"]);
    expect(within(rows[0]).getByText("RM 432.91")).toBeInTheDocument();
    expect(within(rows[1]).getByText("RM 7,370.58")).toBeInTheDocument();
    expect(within(rows[2]).getByText("RM 8,938.00")).toBeInTheDocument();
  });
});

describe("which action is offered (the server re-checks every one)", () => {
  test("pending payment: the recorder, a manager and Finance get Edit Payment; another salesman does not", () => {
    expect(ledgerActions(pay1265, jimmy).edit.mode).toBe("pending");
    expect(ledgerActions(pay1265, mgr).edit.mode).toBe("pending");
    expect(ledgerActions(pay1265, { id: "f", role: "finance" }).edit.mode).toBe("pending");
    expect(ledgerActions(pay1265, other).edit.mode).toBe("none");
  });
  test("a deposit line offers NO payment edit and no Remove (it has no payment row) — changes are approval requests (migration 117)", () => {
    const a = ledgerActions(dep47, mgr);
    expect(a.edit.mode).toBe("none");
    expect(a.canRemove).toBe(false);
    expect(a.deposit.canEdit).toBe(true);
    expect(a.deposit.canReverse).toBe(true);
    expect(a.proof.mode).toBe("none");
  });
  test("rendered: the pending payment has Edit Payment; the deposit offers Edit / Reverse Deposit requests, never Edit Payment", () => {
    const { unmount } = renderRow(pay1265, jimmy);
    expect(screen.getByTestId("edit-payment-btn")).toHaveTextContent("Edit Payment");
    unmount();
    renderRow(dep47, mgr);
    expect(screen.queryByTestId("edit-payment-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-deposit-btn")).toBeInTheDocument();
    expect(screen.getByTestId("reverse-deposit-btn")).toBeInTheDocument();
  });
  test("a rejected payment is locked: no edit, proof locked", () => {
    const a = ledgerActions({ ...pay1265, approval_status: "rejected" }, mgr);
    expect(a.edit.mode).toBe("none");
    expect(a.proof.mode).toBe("locked");
  });
});
