// Phase 2B-1: every UI path that calls PATCH /delivery-orders/:id (backend: DELIVERY_ORDER_EDIT) is offered
// ONLY to a user who holds that permission — never an enabled action that predictably returns 403.
//   A. the Delivery Board's per-stop "Reschedule"        (StopRow)
//   B. the Delivery Orders tab date edit (Save / TBC)    (DeliveryOrdersTab)
//   C. Schedule Import                                   (covered in DeliverySchedule.importGate.test.js)
// Locked / superseded / completed / cancelled DOs and Service stops keep their existing behaviour. The backend side
// (lock guard, company isolation) is covered route-level in the bot repo (scripts/test-schedule-import-routes.js).
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider, ModalProvider } from "./UIComponents";
import { StopRow, DeliveryOrdersTab } from "./DeliverySchedule";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "manager" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

const wrap = ui => <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;
const order = (extra = {}) => ({ id: 11, so_number: "SO1001", customer_name: "TAN", contact: "012", address: "1 Street", balance: 0, order_amount: 100, items: "[]", type: "Delivery", ...extra });
const sched = (dord, extra = {}) => ({ id: "sch-1", team_id: "T1", scheduled_date: "2026-12-12", orders: order(), delivery_orders: dord, ...extra });
const doRow = (status = "scheduled", extra = {}) => ({ id: "do-1", do_number: "DO2612-0001", status, delivery_date: "2026-12-12", sales_order_id: "so-1", superseded_at: null, delivery_order_items: [], ...extra });
const teams = [{ id: "T1", vehicle_plate: "A", schedules: [] }];
const baseProps = { teamId: "T1", index: 0, isLocked: false, onDragStart: jest.fn(), onDrop: jest.fn(), onSaved: jest.fn(), onUnassign: jest.fn(), onReassign: jest.fn(), teams };

describe("A. Delivery Board — per-stop Reschedule", () => {
  test("user WITH DELIVERY_ORDER_EDIT: Reschedule is offered on an active DO stop", () => {
    render(wrap(<StopRow {...baseProps} canEditDo schedule={sched(doRow())} />));
    expect(screen.getByText("Reschedule")).toBeInTheDocument();
  });
  test("user WITHOUT it: no Reschedule button (Reassign / Move to Unassigned — DELIVERY_EDIT — stay available)", () => {
    render(wrap(<StopRow {...baseProps} canEditDo={false} schedule={sched(doRow())} />));
    expect(screen.queryByText("Reschedule")).toBeNull();
    expect(screen.getByText("Reassign")).toBeInTheDocument();
  });
  test.each(["delivered", "completed", "cancelled"])("a %s DO never offers Reschedule, with or without the permission (unchanged)", (st) => {
    render(wrap(<StopRow {...baseProps} canEditDo schedule={sched(doRow(st))} />));
    expect(screen.queryByText("Reschedule")).toBeNull();
  });
  test("a superseded DO offers neither Reschedule nor Reassign (unchanged)", () => {
    render(wrap(<StopRow {...baseProps} canEditDo schedule={sched(doRow("scheduled", { superseded_at: "2026-12-01T00:00:00Z" }))} />));
    expect(screen.queryByText("Reschedule")).toBeNull();
    expect(screen.queryByText("Reassign")).toBeNull();
  });
  test("a locked team (isLocked) offers none of them — the lock rule is unchanged", () => {
    render(wrap(<StopRow {...baseProps} isLocked canEditDo schedule={sched(doRow("out_for_delivery"))} />));
    expect(screen.queryByText("Reschedule")).toBeNull();
    expect(screen.queryByText("Reassign")).toBeNull();
  });
  test("Service stop (no Delivery Order): never a DO Reschedule; Reassign / Move to Unassigned unchanged", () => {
    render(wrap(<StopRow {...baseProps} canEditDo schedule={sched(null, { orders: order({ type: "Service", so_number: "SV-1" }) })} />));
    expect(screen.queryByText("Reschedule")).toBeNull();
    expect(screen.getByText("Reassign")).toBeInTheDocument();
  });
});

describe("B. Delivery Orders tab — date edit", () => {
  const DOS = [
    { ...doRow("scheduled"), id: "d-active", do_number: "DO-ACTIVE", delivery_date: "2026-12-12", sales_orders: { order_number: "SO1", customer_name: "A" }, delivery_schedules: [] },
    { ...doRow("scheduled"), id: "d-tbc", do_number: "DO-TBC", delivery_date: null, sales_orders: { order_number: "SO2", customer_name: "B" }, delivery_schedules: [] },
    { ...doRow("completed"), id: "d-done", do_number: "DO-DONE", sales_orders: { order_number: "SO3", customer_name: "C" }, delivery_schedules: [] },
    { ...doRow("scheduled", { superseded_at: "2026-12-01T00:00:00Z" }), id: "d-sup", do_number: "DO-SUP", sales_orders: { order_number: "SO4", customer_name: "D" }, delivery_schedules: [] },
  ];
  let originalFetch, patches;
  beforeEach(() => {
    originalFetch = global.fetch; patches = [];
    global.fetch = jest.fn(async (url, opts = {}) => {
      const u = String(url);
      if ((opts.method || "GET") === "PATCH") {
        patches.push({ url: u, body: JSON.parse(opts.body) });
        return { ok: true, json: async () => (u.includes("d-active") ? { error: "Cannot reschedule — the delivery is already out_for_delivery" } : { delivery_order: {} }) };
      }
      if (u.includes("/company-settings")) return { ok: true, json: async () => ({ settings: {} }) };
      if (u.includes("/delivery-orders")) return { ok: true, json: async () => ({ delivery_orders: DOS }) };
      return { ok: true, json: async () => ({}) };
    });
  });
  afterEach(() => { global.fetch = originalFetch; });
  const rowOf = async no => (await screen.findByText(no)).closest("tr");

  test("user WITH DELIVERY_ORDER_EDIT: date input + Save + TBC are shown on an editable DO", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canEditDo />));
    const row = await rowOf("DO-ACTIVE");
    expect(row.querySelector('input[type="date"]')).not.toBeNull();
    expect(within(row).getByText("Save")).toBeInTheDocument();
    expect(within(row).getByText("TBC")).toBeInTheDocument();
  });
  test("user WITHOUT it: the date is READ-ONLY — no input, no Save, no TBC button (never shown-then-403)", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canEditDo={false} />));
    const row = await rowOf("DO-ACTIVE");
    expect(row.querySelector('input[type="date"]')).toBeNull();
    expect(within(row).queryByText("Save")).toBeNull();
    expect(within(row).queryByTitle(/Set to TBC/)).toBeNull();
    expect(within(row).getByTestId("do-date-readonly")).toHaveTextContent("2026-12-12");
    // an undated DO still tells the user it is TBC
    expect(within(await rowOf("DO-TBC")).getByTestId("do-date-readonly")).toHaveTextContent("TBC");
    // printing / exporting (read actions) stay available
    expect(within(row).getByText(/PDF/)).toBeInTheDocument();
    expect(within(row).getByText(/Excel/)).toBeInTheDocument();
  });
  test.each(["DO-DONE", "DO-SUP"])("completed / superseded DO (%s): read-only date, with or without the permission (unchanged)", async (no) => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canEditDo />));
    // completed rows are hidden until 'Show completed' — tick it
    fireEvent.click(await screen.findByLabelText(/Show completed/));
    const row = await rowOf(no);
    expect(row.querySelector('input[type="date"]')).toBeNull();
    expect(within(row).queryByText("Save")).toBeNull();
  });
  test("a locked DO: the server's 409 text is shown to the user; nothing else changes", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canEditDo />));
    const row = await rowOf("DO-ACTIVE");
    fireEvent.change(row.querySelector('input[type="date"]'), { target: { value: "2026-12-20" } });
    fireEvent.click(within(row).getByText("Save"));
    expect(await screen.findByText(/Cannot reschedule — the delivery is already out_for_delivery/)).toBeInTheDocument();
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toMatch(/\/delivery-orders\/d-active$/);
    expect(patches[0].body).toEqual({ delivery_date: "2026-12-20" });
  });
});

describe("wiring", () => {
  test("App wires canEditDo = can('editDeliveryOrder') and the child gates use it; backend authorization is untouched", () => {
    const fs = require("fs"), path = require("path");
    const app = fs.readFileSync(path.join(__dirname, "App.js"), "utf8");
    const ds = fs.readFileSync(path.join(__dirname, "DeliverySchedule.js"), "utf8");
    expect(app).toMatch(/canEditDo=\{can\("editDeliveryOrder"\)\}/);
    expect(ds).toMatch(/<DeliveryOrdersTab onChanged=\{loadData\} canEditDo=\{!readOnly && canEditDo\}/);
    expect(ds).toMatch(/canEditDo=\{!readOnly && canEditDo\}/);
  });
});
