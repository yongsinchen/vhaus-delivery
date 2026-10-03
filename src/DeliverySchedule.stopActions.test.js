// Deliveries Phase 1: (1) Delivery Order tab shows the linked Service Note,
// (2) Copy customer details on an assigned stop, (3) Move to Unassigned.
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
const order = (extra = {}) => ({
  id: 11, so_number: "SO1001", customer_name: "TAN AH KOW", contact: "0123456789", address: "123, JALAN ABC, 14000 BUKIT MERTAJAM",
  balance: 1250, order_amount: 4000, items: "[]", type: "Delivery", ...extra,
});
const sched = (extra = {}) => ({
  id: "sch-1", team_id: "T1", scheduled_date: "2026-10-12", orders: order(),
  delivery_orders: { id: "do-1", do_number: "DO2610-0001", status: "scheduled", sales_order_id: "so-1", superseded_at: null, delivery_order_items: [] },
  ...extra,
});
const teams = [{ id: "T1", vehicle_plate: "A", schedules: [] }, { id: "T2", vehicle_plate: "BBB 1", driver_name: "Ali", schedules: [] }];
const baseProps = { teamId: "T1", index: 0, isLocked: false, onDragStart: jest.fn(), onDrop: jest.fn(), onSaved: jest.fn(), teams };

let writeText;
beforeEach(() => {
  writeText = jest.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("StopRow — Copy customer details (assigned stop)", () => {
  test("E. one Copy action copies NAME / CONTACT / ADDRESS / BALANCE", async () => {
    render(wrap(<StopRow {...baseProps} schedule={sched()} onUnassign={jest.fn()} onReassign={jest.fn()} />));
    const btns = screen.getAllByTestId("copy-stop");
    expect(btns).toHaveLength(1);
    fireEvent.click(btns[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("NAME: TAN AH KOW\nCONTACT: 0123456789\nADDRESS: 123, JALAN ABC, 14000 BUKIT MERTAJAM\nBALANCE: RM 1,250.00");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
  test("a stop inside a Deliver Together group has NO per-child Copy (the group banner carries the one action)", () => {
    render(wrap(<StopRow {...baseProps} schedule={sched()} inCustomerStop groupAddress="x" onUnassign={jest.fn()} onReassign={jest.fn()} />));
    expect(screen.queryByTestId("copy-stop")).toBeNull();
  });
  test("Copy is still available on a locked (read-only) team", () => {
    render(wrap(<StopRow {...baseProps} isLocked schedule={sched()} onUnassign={jest.fn()} onReassign={jest.fn()} />));
    expect(screen.getByTestId("copy-stop")).toBeInTheDocument();
  });
  test("source: the Deliver Together banner carries ONE Copy for every child order", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "DeliverySchedule.js"), "utf8");
    expect(src).toMatch(/copyStopDetails\(unit\.map\(u => u\.sc\.orders\), toast\)/);
  });
});

describe("StopRow — Move to Unassigned", () => {
  const openReassign = () => fireEvent.click(screen.getByText("Reassign"));

  test("H. Reassign offers 'Unassigned' and choosing it calls the canonical unassign (not a reassign)", () => {
    const onUnassign = jest.fn(), onReassign = jest.fn();
    render(wrap(<StopRow {...baseProps} schedule={sched()} onUnassign={onUnassign} onReassign={onReassign} />));
    openReassign();
    const select = screen.getByTestId("reassign-select");
    expect(within(select).getByRole("option", { name: "Unassigned" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "__unassigned__" } });
    expect(onUnassign).toHaveBeenCalledWith("sch-1", { successMessage: "Moved to Unassigned" });
    expect(onReassign).not.toHaveBeenCalled();
  });
  test("choosing a real team still reassigns exactly as before", () => {
    const onUnassign = jest.fn(), onReassign = jest.fn();
    render(wrap(<StopRow {...baseProps} schedule={sched()} onUnassign={onUnassign} onReassign={onReassign} />));
    openReassign();
    fireEvent.change(screen.getByTestId("reassign-select"), { target: { value: "T2" } });
    expect(onReassign).toHaveBeenCalledWith("sch-1", "T2");
    expect(onUnassign).not.toHaveBeenCalled();
  });
  test("Move to Unassigned is available even when there is no other open team", () => {
    render(wrap(<StopRow {...baseProps} teams={[teams[0]]} schedule={sched()} onUnassign={jest.fn()} onReassign={jest.fn()} />));
    expect(screen.getByText("Reassign")).not.toBeDisabled();
  });
  test("N. locked team → no Reassign / Move to Unassigned control (no bypass)", () => {
    render(wrap(<StopRow {...baseProps} isLocked schedule={sched()} onUnassign={jest.fn()} onReassign={jest.fn()} />));
    expect(screen.queryByText("Reassign")).toBeNull();
    expect(screen.queryByTestId("reassign-select")).toBeNull();
  });
  test("N. a superseded DO never offers Move to Unassigned", () => {
    const s = sched(); s.delivery_orders.superseded_at = "2026-10-01T00:00:00Z";
    render(wrap(<StopRow {...baseProps} schedule={s} onUnassign={jest.fn()} onReassign={jest.fn()} />));
    expect(screen.queryByText("Reassign")).toBeNull();
  });
  test("it reuses the existing unassign endpoint — DELETE the team assignment only, never a DO/date/SO mutation", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "DeliverySchedule.js"), "utf8");
    const i = src.indexOf("const unassignOrder = useCallback");
    const body = src.slice(i, src.indexOf("}, [withLoading, toast, loadData]);", i));
    expect(body).toMatch(/\/delivery-schedules\/\$\{scheduleId\}`, \{ method: "DELETE" \}/);
    expect(body).not.toMatch(/delivery-orders|PATCH|status/);
  });
});

describe("DeliveryOrdersTab — linked Service Note", () => {
  const DOS = [
    { id: "d1", do_number: "DO2610-0001", status: "scheduled", delivery_date: "2026-10-12", sales_orders: { order_number: "SO1001", customer_name: "Cust A", internal_remark: "INTERNAL-MARGIN-SECRET" }, delivery_order_items: [{ id: "i1", product_name: "Sofa", quantity: 1, status: "pending", size: "3S", color: "Grey" }], delivery_schedules: [] },
    { id: "d2", do_number: "DO2610-0002", status: "scheduled", delivery_date: "2026-10-13", sales_orders: { order_number: "SO2002", customer_name: "Cust B" }, delivery_order_items: [{ id: "i2", product_name: "Bed", quantity: 2, status: "pending" }], delivery_schedules: [] },
  ];
  const NOTE = "Replace left sofa leg.\n客户要求下午三点后送货 (call first)\n" + "Very long line ".repeat(8);
  const SERVICES = {
    SO1001: [
      { id: 1, status: "open", service_type: 1, _sv_number: "SV-501", description: NOTE, schedule_tbc: false, due_date: null, _order: { so_number: "SO1001" }, _items: [], internal_remark: "INTERNAL-MARGIN-SECRET" },
      { id: 2, status: "scheduled", service_type: 1, _sv_number: "SV-502", description: "Second case note", due_date: "2026-10-20", _order: { so_number: "SO1001" }, _items: [] },
    ],
    SO2002: [],
  };
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes("/company-settings")) return { ok: true, json: async () => ({ settings: {} }) };
      if (u.includes("/service-cases")) { const so = decodeURIComponent(u.split("so_number=")[1] || ""); return { ok: true, json: async () => ({ services: SERVICES[so] || [] }) }; }
      if (u.includes("/delivery-orders")) return { ok: true, json: async () => ({ delivery_orders: DOS }) };
      return { ok: true, json: async () => ({}) };
    });
  });
  afterEach(() => { global.fetch = originalFetch; });

  const openDo = async (no) => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} />));
    const cell = await screen.findByText(no);
    const row = cell.closest("tr");
    fireEvent.click(within(row).getByTestId("do-detail-toggle"));
  };

  test("A. DO linked to an SO with Service → SERVICE section with Service No and the full note", async () => {
    await openDo("DO2610-0001");
    expect(await screen.findByText("SERVICE (2 active)")).toBeInTheDocument();
    expect(screen.getByText("SV-501")).toBeInTheDocument();
    expect(screen.getAllByText("Service No:").length).toBe(2);
    expect(screen.getAllByText("Service Note:").length).toBe(2);
  });
  test("C. multiline + Chinese note preserved verbatim, wraps (pre-line + break-words), never clipped", async () => {
    await openDo("DO2610-0001");
    const el = (await screen.findAllByTestId("service-note"))[0];
    expect(el.textContent).toBe(NOTE);
    expect(el.textContent).toContain("客户要求下午三点后送货");
    expect(el.className).toMatch(/whitespace-pre-line/);
    expect(el.className).toMatch(/break-words/);
    expect(el.className).not.toMatch(/truncate|line-clamp|overflow-hidden/);
  });
  test("multiple legitimate Service cases stay distinguishable (own Service No + own note)", async () => {
    await openDo("DO2610-0001");
    await screen.findByText("SV-501");
    expect(screen.getByText("SV-502")).toBeInTheDocument();
    expect(screen.getByText("Second case note")).toBeInTheDocument();
  });
  test("each Service note appears exactly once (no duplicate)", async () => {
    await openDo("DO2610-0001");
    await screen.findByText("SV-501");
    expect(screen.getAllByText("Second case note")).toHaveLength(1);
  });
  test("B. DO whose SO has no Service → no Service section at all", async () => {
    await openDo("DO2610-0002");
    await screen.findAllByText(/Bed/);
    await waitFor(() => expect(global.fetch.mock.calls.some(c => String(c[0]).includes("so_number=SO2002"))).toBe(true));
    expect(screen.queryByText(/SERVICE/)).toBeNull();
    expect(screen.queryByText("Service No:")).toBeNull();
  });
  test("D. Internal Remark is never rendered", async () => {
    await openDo("DO2610-0001");
    await screen.findByText("SV-501");
    expect(document.body.textContent).not.toMatch(/INTERNAL-MARGIN-SECRET/);
  });
  test("the detail is collapsed by default and the Service lookup runs only when expanded (no N requests on load)", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} />));
    await screen.findByText("DO2610-0001");
    expect(global.fetch.mock.calls.some(c => String(c[0]).includes("/service-cases"))).toBe(false);
    expect(screen.queryByTestId("do-detail-row")).toBeNull();
  });
});
