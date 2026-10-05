// SO55405 / DO2608-0025: a Pending review request whose DO was later cancelled still offered
// Approve / Propose / Reject. The backend now returns such a request as status
// "no_longer_applicable" + stale_reason (stored row unchanged). It must not be Pending, must
// offer no Approve / Propose, and must stay visible (history) with the reason.
import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ToastProvider, ModalProvider } from "./UIComponents";
import DeliveryDateRequestsPage from "./DeliveryDateRequestsPage";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "manager" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

const wrap = ui => <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;
const STALE = {
  id: "r-stale", so_number: "55405", customer_name: "Stale Customer", status: "no_longer_applicable", stored_status: "pending",
  stale_reason: "No longer applicable — DO2608-0025 was cancelled, so its date can no longer be changed.",
  delivery_order_id: "do-1", delivery_orders: { do_number: "DO2608-0025", status: "cancelled" }, sales_order_id: "so-1",
  original_date: "2026-10-10", requested_date: "2026-12-08", requested_by: "someone", requested_by_name: "Alice Yan", created_at: "2026-10-05T06:00:12Z",
};
const LIVE = { ...STALE, id: "r-live", so_number: "60001", customer_name: "Live Customer", status: "pending", stored_status: undefined, stale_reason: undefined, delivery_orders: { do_number: "DO-LIVE", status: "scheduled" } };
let approver;
beforeEach(() => {
  approver = true;
  global.fetch = async (url) => ({ ok: true, json: async () => (String(url).includes("/delivery-date-requests") ? { requests: [STALE, LIVE], is_approver: approver } : {}) });
});
afterEach(() => { delete global.fetch; });

const cardOf = (text) => { let el = screen.getByText(text); while (el && !(el.className || "").includes("rounded-2xl")) el = el.parentElement; return el; };
const filterBtn = (re) => screen.getAllByRole("button").find(b => re.test(b.textContent));

test("approver: stale request offers no Approve / Propose, shows the reason; the live one is unchanged", async () => {
  render(wrap(<DeliveryDateRequestsPage />));
  await screen.findByText("SO 55405");
  const stale = cardOf("SO 55405");
  expect(within(stale).getByTestId("stale-reason")).toHaveTextContent("DO2608-0025 was cancelled");
  expect(within(stale).queryByText("Approve")).toBeNull();
  expect(within(stale).queryByText("Propose dates")).toBeNull();
  expect(within(stale).getByText("No longer applicable")).toBeInTheDocument();
  expect(within(stale).getByText(/Alice Yan/)).toBeInTheDocument(); // audit kept
  const live = cardOf("SO 60001");
  expect(within(live).getByText("Approve")).toBeInTheDocument();
});

test("approver: Pending filter counts / lists only the actionable request", async () => {
  render(wrap(<DeliveryDateRequestsPage />));
  await screen.findByText("SO 55405");
  expect(filterBtn(/^Pending/)).toHaveTextContent(/Pending\s*1$/);
  expect(filterBtn(/^No longer applicable/)).toHaveTextContent(/1$/);
  fireEvent.click(filterBtn(/^Pending/));
  expect(screen.queryByText("SO 55405")).toBeNull();
  expect(screen.getByText("SO 60001")).toBeInTheDocument();
  fireEvent.click(filterBtn(/^No longer applicable/));
  expect(screen.getByText("SO 55405")).toBeInTheDocument();
  expect(screen.queryByText("SO 60001")).toBeNull();
});

test("requester view: stale request is not in Open; it is under Recent decisions", async () => {
  approver = false;
  render(wrap(<DeliveryDateRequestsPage />));
  expect(await screen.findByText("Open (1)")).toBeInTheDocument();
  const recent = screen.getByText("Recent decisions").parentElement;
  expect(within(recent).getByText("SO 55405")).toBeInTheDocument();
});
