// Schedule Import — (1) the Import action is only ENABLED for a user who holds BOTH backend permissions it
// needs, and (2) the apply loop reports partial failure per row, using the real exporter → real parser →
// real modal, with the backend routes mocked at the fetch boundary.
//   move     → PATCH  /delivery-orders/:id    needs DELIVERY_ORDER_EDIT
//   unassign → DELETE /delivery-schedules/:id needs DELIVERY_EDIT
// (the backend side of both is covered by scripts/test-schedule-import-routes.js in the bot repo)
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider, ModalProvider, LoadingProvider } from "./UIComponents";
import DeliverySchedule, { ImportScheduleModal, exportTeamScheduleExcel } from "./DeliverySchedule";
import { can, } from "./AuthContext";

jest.mock("./AuthContext", () => {
  const actual = jest.requireActual("./AuthContext");
  return {
    ...actual,
    useAuth: () => ({ user: { id: "u1", role: "manager" } }),
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
  };
});

const wrap = ui => <ToastProvider><ModalProvider><LoadingProvider>{ui}</LoadingProvider></ModalProvider></ToastProvider>;

describe("legacy permission aliases — editDeliveryOrder is a real, separate permission", () => {
  test("PERM_ALIASES-backed key exists in source and maps to the backend permission the move route requires", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "AuthContext.js"), "utf8");
    expect(src).toMatch(/editDeliveryOrder:\s*"DELIVERY_ORDER_EDIT"/);
    expect(src).toMatch(/editSchedule:\s*"DELIVERY_EDIT"/);
  });
  test("App passes canImport = editSchedule AND editDeliveryOrder (both backend permissions)", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "App.js"), "utf8");
    expect(src).toMatch(/canImport=\{can\("editSchedule"\) && can\("editDeliveryOrder"\)\}/);
  });
  test("legacy fallback rules: master/manager/operation_manager/company_admin may edit Delivery Orders; salesman/finance may not", () => {
    for (const role of ["master", "manager", "operation_manager", "company_admin"]) expect(can({ role }, "editDeliveryOrder")).toBe(true);
    for (const role of ["salesman", "finance", "driver"]) expect(can({ role }, "editDeliveryOrder")).toBe(false);
  });
});

describe("DeliverySchedule — Import button is gated on BOTH permissions", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes("/delivery-teams")) return { ok: true, json: async () => ({ teams: [] }) };
      if (u.includes("/delivery-schedules")) return { ok: true, json: async () => ({ schedules: [] }) };
      if (u.includes("/delivery/unassigned")) return { ok: true, json: async () => [] };
      if (u.includes("/delivery-orders")) return { ok: true, json: async () => ({ delivery_orders: [] }) };
      if (u.includes("/delivery-links")) return { ok: true, json: async () => ({ groups: [] }) };
      if (u.includes("/company-settings")) return { ok: true, json: async () => ({ settings: {} }) };
      return { ok: true, json: async () => ({}) };
    });
  });
  afterEach(() => { global.fetch = originalFetch; });

  test("authorized (both permissions): Import is enabled", async () => {
    render(wrap(<DeliverySchedule readOnly={false} canImport={true} companyId="c1" />));
    const btn = await screen.findByTestId("import-schedule");
    expect(btn).not.toBeDisabled();
  });
  test("a user missing DELIVERY_ORDER_EDIT: Import is DISABLED with the reason — never an enabled action that will 403", async () => {
    render(wrap(<DeliverySchedule readOnly={false} canImport={false} companyId="c1" />));
    const btn = await screen.findByTestId("import-schedule");
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/permission to edit Delivery Orders/);
    fireEvent.click(btn);
    expect(screen.queryByText("Import Delivery Schedule")).toBeNull();      // the modal never opens
  });
  test("a read-only user: no Import control at all", async () => {
    render(wrap(<DeliverySchedule readOnly={true} canImport={true} companyId="c1" />));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("import-schedule")).toBeNull();
  });
});

// ── apply loop: partial failure reporting ──
async function exportBytes(team) {
  const OriginalBlob = global.Blob; const oc = URL.createObjectURL; const or = URL.revokeObjectURL;
  let bytes = null;
  global.Blob = function (parts, opts) { bytes = parts[0]; return new OriginalBlob(parts, opts); };
  URL.createObjectURL = () => "blob:mock"; URL.revokeObjectURL = () => {};
  const spy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try { await exportTeamScheduleExcel(team, {}); } finally { global.Blob = OriginalBlob; URL.createObjectURL = oc; URL.revokeObjectURL = or; spy.mockRestore(); }
  return bytes;
}
const stop = (id, so, doNo) => ({
  id, sort_order: id, slot: null, status: "scheduled",
  orders: { id: 100 + id, so_number: so, customer_name: "Cust " + so, balance: 0, items: "[]" },
  delivery_orders: { do_number: doNo, superseded_at: null, delivery_order_items: [{ product_code: "X", product_name: "Item", quantity: 1, status: "active" }] },
});

describe("ImportScheduleModal — apply loop", () => {
  jest.setTimeout(30000);
  let originalFetch, calls;
  const TARGET = "2026-12-20";
  beforeEach(() => {
    originalFetch = global.fetch; calls = [];
    const dos = [
      { id: "d1", do_number: "DO-1", status: "scheduled", delivery_date: "2026-12-10", superseded_at: null },
      { id: "d2", do_number: "DO-2", status: "scheduled", delivery_date: "2026-12-10", superseded_at: null },
      { id: "d3", do_number: "DO-3", status: "scheduled", delivery_date: "2026-12-10", superseded_at: null },
    ];
    global.fetch = jest.fn(async (url, opts = {}) => {
      const u = String(url), method = (opts.method || "GET").toUpperCase();
      if (method === "PATCH" || method === "DELETE") {
        calls.push({ method, url: u, body: opts.body });
        if (u.includes("/delivery-orders/d2")) return { ok: false, json: async () => ({ error: "Cannot reschedule — the delivery is already out_for_delivery" }) };
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (u.includes("/delivery-orders")) return { ok: true, json: async () => ({ delivery_orders: dos }) };
      if (u.includes("/delivery-schedules")) return { ok: true, json: async () => ({ schedules: [] }) };
      if (u.includes("/delivery-teams")) return { ok: true, json: async () => ({ teams: [] }) };
      return { ok: true, json: async () => ({}) };
    });
  });
  afterEach(() => { global.fetch = originalFetch; });

  test("partial failure: the failing DO is reported by name with the server's reason; the others still move; calls are one per row", async () => {
    const team = { vehicle_plate: "A", team_date: "2026-12-10", schedules: [stop(1, "SO-1", "DO-1"), stop(2, "SO-2", "DO-2"), stop(3, "SO-3", "DO-3")] };
    const bytes = await exportBytes(team);
    render(wrap(<ImportScheduleModal date={TARGET} companyId="c1" onClose={() => {}} onDone={() => {}} />));
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [{ name: "schedule.xlsx", arrayBuffer: async () => bytes }] } });
    await screen.findByText((_, el) => el.tagName === "P" && /3 of 3 selected/.test(el.textContent));
    fireEvent.click(screen.getByText(/^Import 3 Delivery Orders$/));
    fireEvent.click(await screen.findByText(new RegExp(`Yes, move 3 to ${TARGET}`)));
    await screen.findByText(/Could not be moved \(1\)/);
    expect(screen.getByText(/SO-2 · DO-2 — Cannot reschedule — the delivery is already out_for_delivery/)).toBeInTheDocument();
    expect(screen.getByText(/now unassigned on/).textContent).toMatch(/2 Delivery Orders/);
    expect(calls.map(c => `${c.method} ${c.url.split("/").slice(-1)[0]}`)).toEqual(["PATCH d1", "PATCH d2", "PATCH d3"]);
    expect(calls.every(c => JSON.parse(c.body).delivery_date === TARGET)).toBe(true);
  });
});
