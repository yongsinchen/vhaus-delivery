// SV-497: a Service request showed "Awaiting DO" even when already scheduled
// and assigned on the Delivery Schedule board. A Service never has a
// sales_order_id and never goes through the Sales Order -> delivery_orders
// lifecycle at all — "no Delivery Order" is its normal, permanent state, not
// a pending step. The backend now returns is_service / service_status; the
// Card must use the Service's own canonical status instead of the
// DO-only "Awaiting DO" / "DO created" badge, and normal SO behavior must be
// completely unaffected.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { ToastProvider, ModalProvider } from "./UIComponents";
import DeliveryDateRequestsPage from "./DeliveryDateRequestsPage";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "manager" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } },
}));

function withProviders(ui) {
  return <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;
}

function mockRequests(requests) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes("/delivery-date-requests")) {
      return Promise.resolve({ ok: true, json: async () => ({ requests, is_approver: true }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// The status/badge text ("Awaiting DO", "Approved", "Rejected", ...) also
// appears, with an appended count, on the filter bar's own <button>s — a
// real card badge is always a <span>. Scoping to <span> is what distinguishes
// "the card shows this badge" from "the filter bar merely offers this tab".
const badge = (text) => screen.queryAllByText(text).find(el => el.tagName === "SPAN") || null;

const NORMAL_SO_NO_DO = {
  id: "r-a", so_number: "A-1", customer_name: "Normal Customer", status: "approved",
  sales_order_id: "so-a", order_id: null, requested_date: "2026-10-15", original_date: "2026-10-10",
  is_service: false, has_delivery_order: false, service_status: null,
};

const NORMAL_SO_WITH_DO = {
  id: "r-b", so_number: "B-1", customer_name: "Other Customer", status: "approved",
  sales_order_id: "so-b", order_id: null, requested_date: "2026-10-15", original_date: "2026-10-10",
  is_service: false, has_delivery_order: true, delivery_order_id: "do-b",
  delivery_orders: { do_number: "DO-100" }, service_status: null,
};

// Reproduces SV-497 exactly: approved, Service, no sales_order_id, already
// scheduled + assigned (services.status === "scheduled"), no normal DO.
const SV_497 = {
  id: "r-sv497", so_number: "SV-497", customer_name: "KEE MEI CHWEN", status: "approved",
  sales_order_id: null, order_id: 4465, requested_date: "2026-10-01", original_date: "2026-10-03",
  is_service: true, has_delivery_order: false, service_status: "scheduled",
};

describe("DeliveryDateRequestsPage — Service vs normal Sales Order badge", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  test("SV-497 reproduction: approved + scheduled Service never shows Awaiting DO", async () => {
    mockRequests([SV_497]);
    render(withProviders(<DeliveryDateRequestsPage />));
    await waitFor(() => expect(screen.getByText(/SV-497/)).toBeInTheDocument());
    expect(badge("Awaiting DO")).toBeFalsy();
    expect(badge("DO created")).toBeFalsy();
    expect(badge("scheduled")).toBeTruthy();
    expect(badge("Approved")).toBeTruthy();
  });

  test("Normal SO, approved, no DO yet — Awaiting DO is preserved", async () => {
    mockRequests([NORMAL_SO_NO_DO]);
    render(withProviders(<DeliveryDateRequestsPage />));
    await waitFor(() => expect(badge("Awaiting DO")).toBeTruthy());
    expect(badge("scheduled")).toBeFalsy();
  });

  test("Normal SO, approved, active DO exists — DO created is preserved", async () => {
    mockRequests([NORMAL_SO_WITH_DO]);
    render(withProviders(<DeliveryDateRequestsPage />));
    await waitFor(() => expect(badge("DO created")).toBeTruthy());
    expect(badge("Awaiting DO")).toBeFalsy();
  });

  test("a Service request with no service_status yet shows no DO-style badge at all (never a false DO requirement)", async () => {
    const svcNoStatus = { ...SV_497, id: "r-sv-x", so_number: "SV-X", service_status: null };
    mockRequests([svcNoStatus]);
    render(withProviders(<DeliveryDateRequestsPage />));
    await waitFor(() => expect(screen.getByText(/SV-X/)).toBeInTheDocument());
    expect(badge("Awaiting DO")).toBeFalsy();
    expect(badge("DO created")).toBeFalsy();
  });

  test("normal SO and Service side by side — no cross-target leakage", async () => {
    mockRequests([NORMAL_SO_NO_DO, SV_497]);
    render(withProviders(<DeliveryDateRequestsPage />));
    await waitFor(() => expect(screen.getByText(/SV-497/)).toBeInTheDocument());
    expect(screen.getByText(/A-1/)).toBeInTheDocument();
    expect(badge("Awaiting DO")).toBeTruthy(); // the normal SO's own badge
    expect(badge("scheduled")).toBeTruthy();   // the Service's own badge
  });

  test("pending Service request shows the pending status, unaffected by the Service badge logic", async () => {
    const pendingSvc = { ...SV_497, id: "r-sv-pending", so_number: "SV-P", status: "pending", service_status: null };
    mockRequests([pendingSvc]);
    render(withProviders(<DeliveryDateRequestsPage />));
    await waitFor(() => expect(screen.getByText(/SV-P/)).toBeInTheDocument());
    expect(badge("Pending review")).toBeTruthy();
    expect(badge("Awaiting DO")).toBeFalsy();
  });

  test("rejected Service request shows the rejected status, unaffected by the Service badge logic", async () => {
    const rejectedSvc = { ...SV_497, id: "r-sv-rejected", so_number: "SV-R", status: "rejected", service_status: null };
    mockRequests([rejectedSvc]);
    render(withProviders(<DeliveryDateRequestsPage />));
    await waitFor(() => expect(screen.getByText(/SV-R/)).toBeInTheDocument());
    expect(badge("Rejected")).toBeTruthy();
    expect(badge("Awaiting DO")).toBeFalsy();
  });
});
