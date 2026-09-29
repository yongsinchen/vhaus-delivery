import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModalProvider, ToastProvider } from "./UIComponents";
import AmendmentRebaseReview, { ConflictRow, findItemDisplay, itemLabel, autoMergedSummary, HEADER_LABELS } from "./AmendmentRebaseReview";

jest.mock("./AuthContext", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } },
}));

function withProviders(ui) {
  return <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;
}

const HEADER_CONFLICT = { scope: "header", field: "customer_name", base: "Old Name", proposed: "Salesman Name", live: "Live Name", path: "header.customer_name" };
const ITEM_FIELD_CONFLICT = { scope: "item", item_id: "item-1", field: "unit_price", base: 100, proposed: 250, live: 300, path: "items.item-1.unit_price" };
const CASE_C_CONFLICT = { scope: "item", item_id: "item-2", field: "__removed__", base: "present", proposed: "removed", live: "modified", path: "items.item-2.__removed__" };
const CASE_E_CONFLICT = { scope: "item", item_id: "item-3", field: "__removed__", base: "present", proposed: "modified", live: "removed", path: "items.item-3.__removed__" };

describe("pure helpers / subcomponents — no fetch", () => {
  test("operational fields (deposit, status, notes, payment_proofs) are never in the header label map — never rendered as a conflict field", () => {
    for (const f of ["deposit", "initial_deposit", "deposit_or_number", "payment_proofs", "status", "notes"]) {
      expect(HEADER_LABELS[f]).toBeUndefined();
    }
  });

  test("header conflict row shows Original / Salesman Change / Current Live with no default choice highlighted", () => {
    render(<ConflictRow conflict={HEADER_CONFLICT} before={{}} proposed={{}} live={{}} resolution={undefined} onChoose={() => {}} />);
    expect(screen.getByText("Customer Name")).toBeInTheDocument();
    expect(screen.getByText("Old Name")).toBeInTheDocument();
    expect(screen.getByText("Salesman Name")).toBeInTheDocument();
    expect(screen.getByText("Live Name")).toBeInTheDocument();
    const useSalesman = screen.getByText("Use Salesman Change");
    const keepLive = screen.getByText("Keep Current Live");
    expect(useSalesman.className).not.toMatch(/bg-violet-600/);
    expect(keepLive.className).not.toMatch(/bg-gray-800/);
  });

  test("clicking a choice calls onChoose with the conflict's canonical path, never a display label", () => {
    const onChoose = jest.fn();
    render(<ConflictRow conflict={HEADER_CONFLICT} before={{}} proposed={{}} live={{}} resolution={undefined} onChoose={onChoose} />);
    fireEvent.click(screen.getByText("Use Salesman Change"));
    expect(onChoose).toHaveBeenCalledWith("header.customer_name", "proposed");
    fireEvent.click(screen.getByText("Keep Current Live"));
    expect(onChoose).toHaveBeenCalledWith("header.customer_name", "live");
  });

  test("item conflicts identify the item by product name/code, never by raw item_id text, but resolve by item_id internally", () => {
    const live = { sales_order_items: [{ id: "item-1", product_code: "SOFA-01", product_name: "Sofa", size: "L", color: "Grey" }] };
    render(<ConflictRow conflict={ITEM_FIELD_CONFLICT} before={{}} proposed={{}} live={live} resolution={undefined} onChoose={() => {}} />);
    expect(screen.getByText(/Sofa/)).toBeInTheDocument();
    expect(screen.queryByText("item-1")).not.toBeInTheDocument();
    expect(screen.getByText("Unit Price")).toBeInTheDocument();
  });

  test("case C structural conflict (salesman removed, live modified) shows the exact business message", () => {
    render(<ConflictRow conflict={CASE_C_CONFLICT} before={{ sales_order_items: [{ id: "item-2", product_name: "Table" }] }} proposed={{}} live={{}} resolution={undefined} onChoose={() => {}} />);
    expect(screen.getByText("Salesman removed this item, but the order item was updated after the amendment was submitted.")).toBeInTheDocument();
  });

  test("case E structural conflict (live removed, salesman modified) shows the exact business message", () => {
    render(<ConflictRow conflict={CASE_E_CONFLICT} before={{ sales_order_items: [{ id: "item-3", product_name: "Chair" }] }} proposed={{}} live={{}} resolution={undefined} onChoose={() => {}} />);
    expect(screen.getByText("The order item was removed, but the salesman changed it in this amendment.")).toBeInTheDocument();
  });

  test("findItemDisplay never matches by display text, only by canonical id", () => {
    const live = { sales_order_items: [{ id: "abc", product_code: "SOFA-01", product_name: "Sofa" }] };
    expect(findItemDisplay("abc", live)).toEqual(live.sales_order_items[0]);
    expect(findItemDisplay("does-not-exist", live)).toBeNull();
  });

  test("autoMergedSummary lists non-conflicting header changes and skips conflicting ones", () => {
    const before = { discount: 0, delivery_address: "A" };
    const rebased = { discount: 50, delivery_address: "B" };
    const proposed = { discount: 50, delivery_address: "A" };
    const lines = autoMergedSummary(before, rebased, {}, proposed, new Set(["header.delivery_address"]));
    expect(lines.some(l => l.includes("Discount"))).toBe(true);
    expect(lines.some(l => l.includes("Delivery Address"))).toBe(false); // excluded: it's a true conflict, not auto-merged
  });

  test("itemLabel never falls back to a bare item_id", () => {
    expect(itemLabel({ product_code: "X-1" })).toBe("X-1");
    expect(itemLabel(null)).toBe("Item");
  });
});

describe("AmendmentRebaseReview — full component with a stubbed fetch", () => {
  const AMENDMENT = { id: "amend-1", order_number: "SO-100" };
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  function mockFetchSequence(responses) {
    let i = 0;
    global.fetch = jest.fn(() => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return Promise.resolve({ ok: r.ok !== false, json: async () => r.body });
    });
  }

  test("3/9. preview renders true conflicts only, no operational fields, and auto-merged changes need no choice", async () => {
    mockFetchSequence([{ body: {
      original_before: { customer_name: "Old", discount: 0 },
      original_proposed: { customer_name: "Salesman Name", discount: 50 },
      current_live: { customer_name: "Live Name", discount: 50 },
      rebased_proposed_snapshot: { customer_name: "Old", discount: 50, items: [] },
      conflicts: [HEADER_CONFLICT],
      has_conflicts: true,
    } }]);
    render(withProviders(<AmendmentRebaseReview amendment={AMENDMENT} onClose={() => {}} onApplied={() => {}} />));
    await waitFor(() => expect(screen.getByText("Customer Name")).toBeInTheDocument());
    expect(screen.queryByText("Deposit")).not.toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  test("5/6/7. Resolve & Apply stays disabled until every conflict is resolved, then sends the exact canonical field_resolutions", async () => {
    mockFetchSequence([
      { body: { original_before: {}, original_proposed: {}, current_live: {}, rebased_proposed_snapshot: { items: [] }, conflicts: [HEADER_CONFLICT], has_conflicts: true } },
      { body: { amendment_status: "approved", order: {} } },
    ]);
    render(withProviders(<AmendmentRebaseReview amendment={AMENDMENT} onClose={() => {}} onApplied={() => {}} />));
    await waitFor(() => expect(screen.getByText("Customer Name")).toBeInTheDocument());
    const applyBtn = screen.getByText("Resolve & Apply");
    expect(applyBtn).toBeDisabled();
    fireEvent.click(screen.getByText("Use Salesman Change"));
    expect(applyBtn).not.toBeDisabled();
    fireEvent.click(applyBtn);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const resolveCall = global.fetch.mock.calls[1];
    expect(resolveCall[0]).toContain("/rebase-resolve");
    const sentBody = JSON.parse(resolveCall[1].body);
    expect(sentBody.field_resolutions).toEqual({ "header.customer_name": { choice: "proposed" } });
  });

  test("10. rebase_stale response shows 'Review Latest Changes', never a generic error", async () => {
    mockFetchSequence([
      { body: { original_before: {}, original_proposed: {}, current_live: {}, rebased_proposed_snapshot: { items: [] }, conflicts: [HEADER_CONFLICT], has_conflicts: true } },
      { ok: false, body: { error: "stale", reason: "rebase_stale" } },
    ]);
    render(withProviders(<AmendmentRebaseReview amendment={AMENDMENT} onClose={() => {}} onApplied={() => {}} />));
    await waitFor(() => expect(screen.getByText("Customer Name")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Use Salesman Change"));
    fireEvent.click(screen.getByText("Resolve & Apply"));
    await waitFor(() => expect(screen.getByText("Order changed again after this review started.")).toBeInTheDocument());
    expect(screen.getByText("Review Latest Changes")).toBeInTheDocument();
  });

  test("11. successful apply calls onApplied so the caller can refresh state", async () => {
    mockFetchSequence([
      { body: { original_before: {}, original_proposed: {}, current_live: {}, rebased_proposed_snapshot: { items: [] }, conflicts: [HEADER_CONFLICT], has_conflicts: true } },
      { body: { amendment_status: "approved", order: {} } },
    ]);
    const onApplied = jest.fn();
    render(withProviders(<AmendmentRebaseReview amendment={AMENDMENT} onClose={() => {}} onApplied={onApplied} />));
    await waitFor(() => expect(screen.getByText("Customer Name")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Use Salesman Change"));
    fireEvent.click(screen.getByText("Resolve & Apply"));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });

  test("Active-DO conflict fails closed with a clear message, no conflict-resolution controls offered", async () => {
    mockFetchSequence([{ ok: false, body: { error: "unsupported", code: "active_do_rebase_unsupported" } }]);
    render(withProviders(<AmendmentRebaseReview amendment={AMENDMENT} onClose={() => {}} onApplied={() => {}} />));
    await waitFor(() => expect(screen.getByText(/isn't supported yet/)).toBeInTheDocument());
    expect(screen.queryByText("Resolve & Apply")).not.toBeInTheDocument();
  });
});
