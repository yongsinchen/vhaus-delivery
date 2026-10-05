// Edit Order → TBC with an active DO + the TBC work list (Deliveries → Delivery Orders).
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { ToastProvider, ModalProvider } from "./UIComponents";
import { DeliveryOrdersTab } from "./DeliverySchedule";
import { StoryView } from "./Customer360";
import { editFormDeliveryDate, effectiveAfterEdit } from "./effectiveDelivery";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "manager" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));
const wrap = ui => <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;

describe("edit form pre-fill = effective delivery date", () => {
  test("one active DO: its date, or TBC when it has none (never the stale SO field)", () => {
    expect(editFormDeliveryDate({ delivery_date: "TBC", _effective_delivery: { source: "delivery_order", date: "2026-10-03" } })).toBe("2026-10-03");
    expect(editFormDeliveryDate({ delivery_date: "2026-10-05", _effective_delivery: { source: "delivery_order", date: null, tbc: true } })).toBe("TBC");
  });
  test("no active DO / several / older backend: the SO's own field, as before", () => {
    expect(editFormDeliveryDate({ delivery_date: "2026-10-05", _effective_delivery: { source: "sales_order", date: "2026-10-05" } })).toBe("2026-10-05");
    expect(editFormDeliveryDate({ delivery_date: "TBC", _effective_delivery: { source: "multiple_delivery_orders" } })).toBe("TBC");
    expect(editFormDeliveryDate({ delivery_date: null })).toBe("");
  });
  test("list row after save follows the response (DO updated → DO state; no DO → SO field)", () => {
    expect(effectiveAfterEdit({ source: "delivery_order", date: "2026-10-03" }, { delivery_date: "TBC" }, { id: "d", do_number: "DO-1", delivery_date: null })).toMatchObject({ source: "delivery_order", tbc: true, do_number: "DO-1" });
    expect(effectiveAfterEdit({ source: "sales_order", date: "2026-10-03" }, { delivery_date: "TBC" }, null)).toMatchObject({ source: "sales_order", tbc: true, date: null });
    const prev = { source: "delivery_order", date: "2026-10-03" };
    expect(effectiveAfterEdit(prev, { delivery_date: "2026-10-03" }, null)).toBe(prev);
  });
  test("OrdersPage pre-fills with it and explains when a DO decides", () => {
    const src = fs.readFileSync(path.join(__dirname, "OrdersPage.js"), "utf8");
    expect(src).toMatch(/delivery_date: editFormDeliveryDate\(f\)/);
    expect(src).toMatch(/data-testid="edit-date-do-hint"/);
    expect(src).toMatch(/d\.delivery_order_updated/);
  });
});

describe("TBC work list", () => {
  const ENTRIES = [
    { kind: "order", key: "so-1", sales_order_id: "so1", so_number: "30665", customer_name: "No DO Cust", contact: "012", address: "1 Jalan", salesperson: "Tina", order_status: "confirmed", items: "Sofa ×1", reason: "No delivery date yet — no Delivery Order" },
    { kind: "delivery_order", key: "do-9", sales_order_id: "so2", so_number: "31000", delivery_order_id: "d9", do_number: "DO2610-0009", customer_name: "DO Cust", contact: "019", address: "2 Jalan", salesperson: "Sam", order_status: "confirmed", items: "Bed ×1", reason: "Delivery Order date TBC" },
  ];
  let calls, tbcEntries;
  beforeEach(() => {
    calls = []; tbcEntries = [...ENTRIES];
    global.fetch = async (url, opts = {}) => {
      const u = String(url), method = opts.method || "GET";
      calls.push({ u, method, body: opts.body ? JSON.parse(opts.body) : null });
      const ok = b => ({ ok: true, status: 200, json: async () => b });
      if (u.includes("/delivery-workbench/tbc")) return ok({ entries: tbcEntries, count: tbcEntries.length });
      if (u.includes("/delivery-orders/") && method === "PATCH") { tbcEntries = tbcEntries.filter(e => e.delivery_order_id !== "d9"); return ok({ delivery_order: { id: "d9" } }); }
      if (u.includes("/delivery-orders?")) return ok({ delivery_orders: [] });
      return ok({});
    };
  });
  afterEach(() => { delete global.fetch; });

  test("TBC (n) toggle shows the list; count = list length; Open order and DO date Save", async () => {
    const opened = [];
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canEditDo onOpenOrder={id => opened.push(id)} />));
    const toggle = await screen.findByTestId("tbc-toggle");
    await waitFor(() => expect(toggle).toHaveTextContent("TBC (2)"));
    fireEvent.click(toggle);
    const rows = await screen.findAllByTestId("tbc-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("SO 30665");
    expect(rows[0]).toHaveTextContent("No delivery date yet");
    expect(rows[1]).toHaveTextContent("DO2610-0009");
    expect(within(rows[0]).queryByText("Save")).toBeNull(); // an order without a DO is opened, not dated here
    fireEvent.click(within(rows[0]).getByText("Open order"));
    expect(opened).toEqual(["so1"]);
    fireEvent.change(within(rows[1]).getByLabelText("Delivery date for DO2610-0009"), { target: { value: "2026-11-20" } });
    fireEvent.click(within(rows[1]).getByText("Save"));
    await waitFor(() => expect(calls.some(c => c.method === "PATCH")).toBe(true));
    expect(calls.find(c => c.method === "PATCH")).toMatchObject({ u: expect.stringMatching(/\/delivery-orders\/d9$/), body: { delivery_date: "2026-11-20" } });
    await waitFor(() => expect(screen.getAllByTestId("tbc-row")).toHaveLength(1)); // dated → leaves the list
    expect(toggle).toHaveTextContent("TBC (1)");
  });

  test("read-only (no DO edit): list visible, no date controls", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canEditDo={false} />));
    fireEvent.click(await screen.findByTestId("tbc-toggle"));
    const rows = await screen.findAllByTestId("tbc-row");
    expect(within(rows[1]).queryByText("Save")).toBeNull();
  });
});

test("Customer 360: Delivery date shows TBC from the active DO", () => {
  render(<StoryView story={{ customer: { name: "C", linked: true }, order: { id: "s", order_number: "1", status: "confirmed", total: 1, paid: 0, outstanding: 1, delivery: { tbc: true, date: null, source: "delivery_order", do_number: "DO-1", deliveries: [] } },
    payments: null, deliveries: null, services: null, amendments: [], other_orders: [], timeline: [] }} onOpenOrder={() => {}} />);
  expect(screen.getByTestId("story-delivery-date")).toHaveTextContent("TBC");
  expect(screen.getByTestId("story-delivery-date")).toHaveTextContent("DO-1");
});
