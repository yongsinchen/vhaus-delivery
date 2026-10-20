// Confirm Delivered Items — the REAL pages wired to the dialog (owner decision 2026-10-20: an order is only
// Delivered once its item quantities are recorded). Backend mocked at the fetch boundary, with the response
// shapes of Backend A (6240a88). Proves no page can set a delivery status without the dialog:
//   Orders list dropdown → dialog, never PATCH /status · Driver app legacy stop → 409 → dialog → driver endpoint
//   · Driver DO stop → completes as before, no dialog · Schedule board route "Delivered" → legacy stops queued
//   into the dialog → schedule endpoint.
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider, ModalProvider, LoadingProvider } from "./UIComponents";

jest.mock("./AuthContext", () => {
  const actual = jest.requireActual("./AuthContext");
  return {
    ...actual,
    useAuth: () => ({ user: { id: "u1", role: "manager", company_id: "c1" }, activeCompanyId: "c1", activeRoleKey: "manager" }),
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t", expires_at: 9999999999 } } }), refreshSession: async () => ({ data: {} }) } },
  };
});

const wrap = ui => <ToastProvider><ModalProvider><LoadingProvider>{ui}</LoadingProvider></ModalProvider></ToastProvider>;
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
// GET …/delivery-confirmation body as Backend A sends it (confirmationContextBody)
const ctx = (soId, soNumber) => ({
  sales_order: { id: soId, order_number: soNumber, status: "confirmed" },
  items: [
    { id: "i1", product_code: "2202", product_name: "Sofa", quantity: 1, delivered_qty: 0, remaining: 1, on_open_do: 0, on_failed_do: 0, without_do: 1, non_goods: false },
    { id: "i2", product_code: "BILL", product_name: "Full Bill Amount", quantity: 1, delivered_qty: 0, remaining: 0, on_open_do: 0, on_failed_do: 0, without_do: 0, non_goods: true },
  ],
  open_delivery_orders: [], failed_delivery_orders: [], goods_count: 1, only_non_goods: false,
});
let calls;
const install = handler => {
  calls = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    const body = opts.body && typeof opts.body === "string" ? JSON.parse(opts.body) : null;
    calls.push({ u, method, body });
    return (await handler(u, method, body)) || ok({});
  });
};
const writes = re => calls.filter(c => c.method !== "GET" && re.test(c.u));

describe("Orders page — the status dropdown can never type Delivered", () => {
  const OrdersPage = require("./OrdersPage").default;
  const order = { id: "so-1", order_number: "7001", status: "confirmed", customer_name: "Cust", total_amount: 100, sales_order_items: [], created_at: "2026-10-01T00:00:00Z" };
  beforeEach(() => install(async (u, method) => {
    if (u.includes("/sales-orders?")) return ok({ data: u.includes("status=amended") ? [] : [order], total: 1, total_pages: 1, page: 1 });
    if (u.includes("/sales-orders/so-1/delivery-confirmation")) return ok(ctx("so-1", "7001"));
    if (u.includes("/sales-orders/so-1/confirm-delivered-items") && method === "POST") return ok({ confirmation: { confirmation_id: "c1", already_confirmed: false, sales_order_status: "delivered" } }, 201);
    return null;
  }));

  test("choosing Delivered… opens the dialog; nothing is written until quantities are confirmed; then only the confirm endpoint", async () => {
    render(wrap(<OrdersPage />));
    const select = await screen.findByDisplayValue("Confirmed");
    expect([...select.options].map(o => o.textContent)).toContain("Delivered…");
    fireEvent.change(select, { target: { value: "delivered" } });
    const dialog = await screen.findByRole("dialog", { name: /Confirm Delivered Items — SO 7001/ });
    await within(dialog).findByText("billing / charge lines", { exact: false }).catch(() => null);
    expect(writes(/\/sales-orders\/so-1\/status/)).toHaveLength(0);           // the old status path is never used
    expect(calls.some(c => c.u.includes("/sales-orders/so-1/delivery-confirmation"))).toBe(true);
    fireEvent.click(await within(dialog).findByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(writes(/confirm-delivered-items/)).toHaveLength(1));
    const post = writes(/confirm-delivered-items/)[0];
    expect(post.u).toMatch(/\/sales-orders\/so-1\/confirm-delivered-items$/);
    expect(post.body.lines).toEqual([{ sales_order_item_id: "i1", delivery_order_id: null, quantity: 1 }]);   // BILL never sent
    expect(post.body.idempotency_key).toMatch(/^cdi-/);
    expect(writes(/\/status/)).toHaveLength(0);
  });
});

describe("Driver app — Mark as Delivered", () => {
  const DriverPage = require("./DriverPage").default;
  const stop = (id, extra = {}) => ({ id, status: "arrived", delivery_order_id: null, orders: { id: 4, so_number: "7004", customer_name: "Cust", address: "x", balance: 0, items: "[]" }, ...extra });
  const route = stops => ok({ teams: [{ id: "T1", vehicle_plate: "VAA1", driver_name: "Ali", schedules: stops }] });

  test("a legacy (no-DO) stop: the 409 opens the dialog; the driver endpoint records the quantities", async () => {
    install(async (u, method) => {
      if (u.includes("/driver/my-route")) return route([stop("s4")]);
      if (u.includes("/driver/schedule/s4/status")) return ok({ error: "Confirm the delivered items of SO 7004 first", code: "delivery_items_confirmation_required", schedule_id: "s4", so_number: "7004", sales_order_id: "so-4" }, 409);
      if (u.includes("/driver/schedule/s4/delivery-confirmation")) return ok({ ...ctx("so-4", "7004"), schedule_id: "s4" });
      if (u.includes("/driver/schedule/s4/confirm-delivered-items") && method === "POST") return ok({ confirmation: { sales_order_status: "delivered" } }, 201);
      return null;
    });
    render(wrap(<DriverPage />));
    fireEvent.click(await screen.findByText(/7004/));
    fireEvent.click(await screen.findByRole("button", { name: /Mark as Delivered/ }));
    const dialog = await screen.findByRole("dialog", { name: /Confirm Delivered Items — SO 7004/ });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(writes(/confirm-delivered-items/)).toHaveLength(1));
    expect(writes(/confirm-delivered-items/)[0].u).toMatch(/\/driver\/schedule\/s4\/confirm-delivered-items$/);
    expect(writes(/confirm-delivered-items/)[0].body.lines).toEqual([{ sales_order_item_id: "i1", delivery_order_id: null, quantity: 1 }]);
  });

  test("a DO stop completes exactly as before — no dialog", async () => {
    install(async u => {
      if (u.includes("/driver/my-route")) return route([stop("s9", { delivery_order_id: "do-9" })]);
      if (u.includes("/driver/schedule/s9/status")) return ok({ schedule: { id: "s9", status: "delivered" }, delivery_order: { do_status: "completed" } });
      return null;
    });
    render(wrap(<DriverPage />));
    fireEvent.click(await screen.findByText(/7004/));
    fireEvent.click(await screen.findByRole("button", { name: /Mark as Delivered/ }));
    await waitFor(() => expect(writes(/\/driver\/schedule\/s9\/status/)).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.some(c => c.u.includes("delivery-confirmation"))).toBe(false);
  });
});

describe("Schedule board — route status Delivered", () => {
  const DeliverySchedule = require("./DeliverySchedule").default;
  test("legacy stops answering 409 are queued into the dialog one by one; DO stops just complete", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const sched = (id, so, doId = null) => ({ id, team_id: "T1", status: "Pending", delivery_order_id: doId, scheduled_date: today, orders: { id: so, so_number: String(so), customer_name: `C${so}`, items: "[]" } });
    install(async (u, method, body) => {
      if (u.includes("/delivery-teams")) return ok({ teams: [{ id: "T1", vehicle_plate: "VAA1", driver_name: "Ali", team_date: today }] });
      if (u.includes("/delivery-schedules?")) return ok({ schedules: [sched("s1", 7001), sched("s2", 7002), sched("s3", 7003, "do-3")] });
      if (/\/delivery-schedules\/s[12]$/.test(u) && method === "PATCH") return ok({ error: "confirm first", code: "delivery_items_confirmation_required", so_number: u.endsWith("s1") ? "7001" : "7002" }, 409);
      if (/\/delivery-schedules\/s3$/.test(u) && method === "PATCH") return ok({ schedule: { id: "s3" } });
      const m = u.match(/\/delivery-schedules\/(s[12])\/delivery-confirmation/);
      if (m) return ok({ ...ctx(`so-${m[1]}`, m[1] === "s1" ? "7001" : "7002"), schedule_id: m[1] });
      if (/\/delivery-schedules\/s[12]\/confirm-delivered-items/.test(u) && method === "POST") return ok({ confirmation: { sales_order_status: "delivered" } }, 201);
      if (u.includes("/delivery/unassigned")) return ok([]);
      if (u.includes("/delivery-orders")) return ok({ delivery_orders: [] });
      if (u.includes("/delivery-links")) return ok({ groups: [] });
      return null;
    });
    render(wrap(<DeliverySchedule readOnly={false} canImport={true} companyId="c1" />));
    const routeSelect = await screen.findByDisplayValue("Pending");
    fireEvent.change(routeSelect, { target: { value: "Delivered" } });
    let dialog = await screen.findByRole("dialog", { name: /Confirm Delivered Items — SO 7001/ });
    expect(within(dialog).getByText(/1 more stop after this one/)).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole("button", { name: /Confirm/ }));
    dialog = await screen.findByRole("dialog", { name: /Confirm Delivered Items — SO 7002/ });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(writes(/confirm-delivered-items/)).toHaveLength(2));
    expect(writes(/confirm-delivered-items/).map(c => c.u.replace(/.*delivery-schedules\//, ""))).toEqual(["s1/confirm-delivered-items", "s2/confirm-delivered-items"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes(/\/delivery-schedules\/s3$/)).toHaveLength(1);                 // the DO stop: one PATCH, no dialog
    expect(calls.some(c => c.u.includes("/delivery-schedules/s3/delivery-confirmation"))).toBe(false);
  });
});
