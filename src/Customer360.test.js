// Phase 3B — top-right Global Search → Customer / Order 360.
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import GlobalSearch from "./Customer360";

jest.mock("./AuthContext", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));

const SEARCH = {
  query: "30665",
  sales_orders: [
    { type: "sales_order", id: "so1", order_number: "30665", customer_name: "Lee Ah Kow", customer_contact: "012-345 6789", status: "confirmed", total: 5600, exact: true },
    { type: "sales_order", id: "so5", order_number: "306650", customer_name: "Someone", status: "confirmed", total: 100, exact: false },
  ],
  delivery_orders: [{ type: "delivery_order", id: "do1", do_number: "DO2609-0188", status: "completed", delivery_date: "2026-09-10", sales_order_id: "so1", so_number: "30665", customer_name: "Lee Ah Kow", exact: false }],
  services: [{ type: "service", id: "sv1", sv_number: "SV-226", so_number: "30665", sales_order_id: "so1", customer_name: "Lee Ah Kow", service_type: 2, status: "scheduled", operational_date: "2026-09-20", exact: false }],
  customers: [{ type: "customer", id: "c1", name: "Lee Ah Kow", phone: "012-345 6789", address: "12 Jalan Mawar", order_count: 3 }],
};
const story = (soId = "so1", extra = {}) => ({
  customer: { id: "c1", linked: true, name: "Lee Ah Kow", phone: "012-345 6789", address: "12 Jalan Mawar" },
  order: { id: soId, order_number: soId === "so1" ? "30665" : "29881", salesperson: "Tina", order_date: "2026-09-03", status: "confirmed", archived: false, total: 5600, paid: 4200, outstanding: 1400 },
  payments: [{ id: "dep", deposit: true, amount: 2800, applied_to_this_order: 2800, method: "Card", status: "approved", payment_date: "2026-09-03" }, { id: "p2", amount: 2000, applied_to_this_order: 1400, method: "Transfer", status: "pending", payment_date: "2026-09-12" }],
  deliveries: { delivery_orders: [{ id: "do1", do_number: "DO2609-0188", status: "completed", delivery_date: "2026-09-10", items: [{ name: "JOGEN King", quantity: 1 }], schedules: [{ id: "s", status: "delivered", team: "VAA1 · Ali" }] }, { id: "do2", do_number: "DO2609-0199", status: "draft", delivery_date: null, items: [], schedules: [] }], whole_order_schedules: [] },
  services: [{ id: "sv1", sv_number: "SV-226", service_type: 2, status: "scheduled", operational_date: "2026-09-20", description: "Table surface scratch", items: [{ description: "Table top", quantity: 1 }], schedule: { team_label: "VAA1 · Bala" } }],
  amendments: [{ id: "a1", category: "customer_detail", status: "approved", changes: ["Time slot: - → After 2pm"], requested_at: "2026-09-04T00:00:00Z", requested_by: "Tina" }],
  other_orders: soId === "so1" ? [{ id: "so2", order_number: "29881", status: "delivered", order_date: "2026-06-01", archived: true, total: 4200 }] : [],
  timeline: [
    { at: "1", date: "2026-09-03", kind: "order", title: "Order 30665 created", detail: "Salesperson Tina" },
    { at: "2", date: "2026-09-03", kind: "payment", title: "Deposit", detail: "RM 2800.00 · Card" },
    { at: "3", date: "2026-09-06", kind: "delivery", title: "DO2609-0188 scheduled", detail: "for 2026-09-10 · VAA1 · Ali" },
    { at: "4", date: "2026-09-18", kind: "service", title: "SV-226 opened", detail: "Table surface scratch" },
  ],
  sections: { payments: true, deliveries: true, services: true }, ...extra,
});
let calls, routes;
beforeEach(() => {
  calls = [];
  routes = {
    "/global-search": () => SEARCH,
    "/customer-360/orders/so1": () => story("so1"),
    "/customer-360/orders/so2": () => story("so2"),
    "/customer-360/services/sv1": () => ({ ...story("so1"), highlight: { service_id: "sv1" } }),
    "/customer-360/customers/c1": () => ({ customer: { id: "c1", name: "Lee Ah Kow", phone: "012-345 6789" }, orders: [{ id: "so1", order_number: "30665", status: "confirmed", order_date: "2026-09-03", total: 5600, outstanding: 1400 }, { id: "so2", order_number: "29881", status: "delivered", order_date: "2026-06-01", total: 4200, outstanding: 0 }] }),
  };
  global.fetch = async (url) => {
    const u = String(url); calls.push(u);
    const key = Object.keys(routes).find(k => u.includes(k));
    return { ok: !!key, status: key ? 200 : 404, json: async () => (key ? routes[key]() : { error: "Not found" }) };
  };
});
afterEach(() => { delete global.fetch; });

const typeAndWait = async (text) => {
  fireEvent.change(screen.getByLabelText("Global search"), { target: { value: text } });
  await screen.findAllByTestId("global-result", {}, { timeout: 2000 });
};

test("search is server-side, labelled by type, exact identifier first", async () => {
  render(<GlobalSearch onClose={() => {}} />);
  await typeAndWait("SO 30665");
  expect(calls.find(u => u.includes("/global-search"))).toMatch(/q=SO%2030665$/);
  const rows = screen.getAllByTestId("global-result");
  expect(rows[0]).toHaveTextContent("SO 30665");
  expect(rows[0]).toHaveTextContent("exact match");
  expect(screen.getByText("Best match")).toBeInTheDocument();
  for (const t of ["sales_order", "delivery_order", "service", "customer"]) expect(screen.getAllByTestId(`tag-${t}`).length).toBeGreaterThan(0);
  expect(screen.getByText(/3 orders/)).toBeInTheDocument();
});

test("one character does not search; no-result state", async () => {
  routes["/global-search"] = () => ({ query: "zzzz", sales_orders: [], delivery_orders: [], services: [], customers: [] });
  render(<GlobalSearch onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Global search"), { target: { value: "z" } });
  await new Promise(r => setTimeout(r, 400));
  expect(calls.some(u => u.includes("/global-search"))).toBe(false);
  fireEvent.change(screen.getByLabelText("Global search"), { target: { value: "zzzz" } });
  expect(await screen.findByTestId("global-empty", {}, { timeout: 2000 })).toHaveTextContent("No results");
});

test("SO result → its story: customer, order summary, timeline, deliveries, service, payments, amendments, other orders", async () => {
  render(<GlobalSearch onClose={() => {}} />);
  await typeAndWait("30665");
  fireEvent.click(screen.getAllByTestId("global-result")[0]);
  await screen.findByTestId("story");
  expect(calls).toContainEqual(expect.stringMatching(/\/customer-360\/orders\/so1$/));
  expect(screen.getByTestId("story-customer")).toHaveTextContent("Lee Ah Kow");
  const order = screen.getByTestId("story-order");
  for (const t of ["SO 30665", "Tina", "RM 5,600.00", "RM 4,200.00", "RM 1,400.00"]) expect(order).toHaveTextContent(t);
  const tl = screen.getByTestId("story-timeline");
  expect(tl).toHaveTextContent("DO2609-0188 scheduled");
  expect(tl).toHaveTextContent("for 2026-09-10 · VAA1 · Ali");
  expect(tl).toHaveTextContent("SV-226 opened");
  expect(screen.getAllByTestId("story-delivery")).toHaveLength(2);
  expect(screen.getAllByTestId("story-delivery")[1]).toHaveTextContent("TBC");
  expect(screen.getAllByTestId("story-delivery")[1]).toHaveTextContent("Unassigned");
  expect(screen.getByTestId("story-service")).toHaveTextContent("Table surface scratch");
  expect(screen.getByTestId("story-payments")).toHaveTextContent("of RM 2,000.00"); // split payment share
  expect(screen.getByTestId("story-amendment")).toHaveTextContent("Time slot: - → After 2pm");
  fireEvent.click(screen.getByTestId("story-other-order"));
  await waitFor(() => expect(screen.getByTestId("story-order")).toHaveTextContent("SO 29881"));
  fireEvent.click(screen.getByTestId("story-back"));
  await waitFor(() => expect(screen.getByTestId("story-order")).toHaveTextContent("SO 30665"));
  fireEvent.click(screen.getByTestId("story-back"));
  expect(await screen.findAllByTestId("global-result")).toHaveLength(5); // back to the results, query kept
});

test("DO result → parent SO story with that DO highlighted", async () => {
  render(<GlobalSearch onClose={() => {}} />);
  await typeAndWait("DO2609-0188");
  fireEvent.click(screen.getAllByTestId("global-result").find(r => r.textContent.includes("DO2609-0188")));
  await screen.findByTestId("story");
  expect(calls).toContainEqual(expect.stringMatching(/\/customer-360\/orders\/so1$/));
  expect(screen.getAllByTestId("story-delivery")[0].className).toMatch(/ring-violet/);
});

test("Service result → /customer-360/services/:id (parent SO story, Service highlighted)", async () => {
  render(<GlobalSearch onClose={() => {}} />);
  await typeAndWait("SV-226");
  fireEvent.click(screen.getAllByTestId("global-result").find(r => r.textContent.includes("SV-226")));
  await screen.findByTestId("story");
  expect(calls).toContainEqual(expect.stringMatching(/\/customer-360\/services\/sv1$/));
  expect(screen.getByTestId("story-service").className).toMatch(/ring-violet/);
});

test("Customer result → customer overview → pick an order → its story", async () => {
  render(<GlobalSearch onClose={() => {}} />);
  await typeAndWait("lee");
  fireEvent.click(screen.getAllByTestId("global-result").find(r => r.textContent.includes("3 orders")));
  expect(await screen.findAllByTestId("customer-order")).toHaveLength(2);
  fireEvent.click(screen.getAllByTestId("customer-order")[1]);
  await waitFor(() => expect(screen.getByTestId("story-order")).toHaveTextContent("SO 29881"));
});

test("sections the backend withheld (no Finance / Service access) are not shown", async () => {
  routes["/customer-360/orders/so1"] = () => story("so1", { payments: null, services: null, deliveries: null, sections: { payments: false, deliveries: false, services: false } });
  render(<GlobalSearch onClose={() => {}} />);
  await typeAndWait("30665");
  fireEvent.click(screen.getAllByTestId("global-result")[0]);
  await screen.findByTestId("story");
  expect(screen.queryByTestId("story-payments")).toBeNull();
  expect(screen.queryByTestId("story-service")).toBeNull();
  expect(screen.queryByTestId("story-delivery")).toBeNull();
  expect(screen.queryByText("Payments")).toBeNull();
});

test("navigation hands off to existing screens; buttons only when allowed", async () => {
  const nav = []; let closed = false;
  render(<GlobalSearch onClose={() => { closed = true; }} onNavigate={n => nav.push(n)} can={{ schedule: true, service: false, finance: true }} />);
  await typeAndWait("30665");
  fireEvent.click(screen.getAllByTestId("global-result")[0]);
  await screen.findByTestId("story");
  expect(screen.queryByText("View Service")).toBeNull();          // can.service false
  expect(screen.queryByText("Go to Delivery Schedule")).toBeNull(); // only DO is completed / TBC — nothing to plan
  fireEvent.click(screen.getByText("View Order"));
  expect(nav).toEqual([{ to: "order", salesOrderId: "so1" }]);
  expect(closed).toBe(true);
});

test("App keeps the existing top-right Search button and opens this overlay", () => {
  const src = fs.readFileSync(path.join(__dirname, "App.js"), "utf8");
  expect(src).toMatch(/onClick=\{\(\) => setShowSearch\(true\)\}/);
  expect(src).toMatch(/<GlobalSearch onClose=\{\(\) => setShowSearch\(false\)\}/);
  expect(src).not.toMatch(/handleGlobalSearch/); // the old client-side filter over preloaded rows is gone
});
