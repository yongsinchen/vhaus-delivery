import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ToastProvider, ModalProvider } from "./UIComponents";
import OrderAmendmentsPage from "./OrderAmendmentsPage";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } },
}));

function withProviders(ui) {
  return <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;
}

function mockList(amendments, isApprover) {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ amendments, is_approver: isApprover }) }));
}

const PENDING = { id: "a1", status: "pending", order_number: "1", sales_order_id: "so-1", before_snapshot: {}, proposed_snapshot: {} };
const CONFLICT = { id: "a2", status: "conflict", order_number: "2", sales_order_id: "so-2", before_snapshot: {}, proposed_snapshot: {} };

describe("OrderAmendmentsPage — Manager Rebase UI entry points", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  test("1. a 'conflict' amendment shows Review Conflict, not the old dead-end-only message, when the manager is an approver", async () => {
    mockList([CONFLICT], true);
    render(withProviders(<OrderAmendmentsPage />));
    // Default filter is "Pending" — a conflict-status row is intentionally
    // excluded from it, so wait for the load to settle (the empty-state
    // message) before switching to "All" to see it.
    await waitFor(() => expect(screen.getByText(/No pending Sales Order amendments/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("All"));
    await waitFor(() => expect(screen.getByText("Review Conflict")).toBeInTheDocument());
  });

  test("2. a 'pending' amendment keeps the normal Approve/Reject flow", async () => {
    mockList([PENDING], true);
    render(withProviders(<OrderAmendmentsPage />));
    await waitFor(() => expect(screen.getByText("Approve")).toBeInTheDocument());
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.queryByText("Review Conflict")).not.toBeInTheDocument();
  });

  test("12. a non-approver role sees no Approve/Reject/Review Conflict controls at all", async () => {
    mockList([PENDING, CONFLICT], false);
    render(withProviders(<OrderAmendmentsPage />));
    await waitFor(() => expect(screen.getByText("SO 1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("All"));
    await waitFor(() => expect(screen.getByText("SO 2")).toBeInTheDocument());
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
    expect(screen.queryByText("Review Conflict")).not.toBeInTheDocument();
  });

  test("14. Supersede is hidden when no approved amendment exists for the same Sales Order", async () => {
    mockList([CONFLICT], true);
    render(withProviders(<OrderAmendmentsPage />));
    await waitFor(() => expect(screen.getByText(/No pending Sales Order amendments/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("All"));
    await waitFor(() => expect(screen.getByText("Review Conflict")).toBeInTheDocument());
    expect(screen.queryByText("Supersede")).not.toBeInTheDocument();
  });

  test("14. Supersede is shown only when an approved amendment exists for the SAME Sales Order", async () => {
    const approvedSameOrder = { id: "a3", status: "approved", order_number: "2", sales_order_id: "so-2", before_snapshot: {}, proposed_snapshot: {} };
    mockList([CONFLICT, approvedSameOrder], true);
    render(withProviders(<OrderAmendmentsPage />));
    await waitFor(() => expect(screen.getByText(/No pending Sales Order amendments/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("All"));
    await waitFor(() => expect(screen.getByText("Review Conflict")).toBeInTheDocument());
    expect(screen.getByText("Supersede")).toBeInTheDocument();
  });

  test("14. Supersede stays hidden when the only approved amendment is for a DIFFERENT Sales Order", async () => {
    const approvedOtherOrder = { id: "a4", status: "approved", order_number: "9", sales_order_id: "so-9", before_snapshot: {}, proposed_snapshot: {} };
    mockList([CONFLICT, approvedOtherOrder], true);
    render(withProviders(<OrderAmendmentsPage />));
    await waitFor(() => expect(screen.getByText(/No pending Sales Order amendments/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("All"));
    await waitFor(() => expect(screen.getByText("Review Conflict")).toBeInTheDocument());
    expect(screen.queryByText("Supersede")).not.toBeInTheDocument();
  });
});
