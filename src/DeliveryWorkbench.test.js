// Phase 3A — Delivery Operations workbench (Deliveries → Delivery Orders):
// Service jobs listed + team-assigned through the canonical Service schedule
// path (never a Delivery Order), and one cross-date search.
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { ToastProvider, ModalProvider } from "./UIComponents";
import { DeliveryOrdersTab } from "./DeliverySchedule";
import { filterServices } from "./DeliveryWorkbench";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "manager" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

const wrap = ui => <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;
const FUTURE = "2099-10-09", FUTURE2 = "2099-10-12", PAST = "2020-01-01";
const svc = (extra = {}) => ({
  type: "service", id: "s1", sv_number: "SV-497", legacy_order_id: 101, so_number: "55670", customer_name: "Xavier Yeo",
  customer_contact: "012-345 6789", customer_address: "12 Jalan Mawar", service_type: 2, status: "scheduled", service_date: FUTURE,
  schedule_tbc: false, operational_date: FUTURE, description: "Touch up headboard", assigned_to_name: null,
  items: [{ id: "i1", description: "Headboard panel", action_type: 2, quantity: 2 }], schedule: null, terminal: false, schedulable: true, ...extra,
});
const DO = { id: "d1", do_number: "DO2610-0031", status: "scheduled", delivery_date: FUTURE, superseded_at: null, sales_orders: { order_number: "56182", customer_name: "ABC" }, delivery_order_items: [], delivery_schedules: [] };

let calls, services, searchBody;
const ok = body => ({ ok: true, status: 200, json: async () => body });
const installFetch = () => {
  global.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    calls.push({ u, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes("/company-settings")) return ok({ settings: {} });
    if (u.includes("/delivery-orders?")) return ok({ delivery_orders: u.includes("active=1") ? [DO] : [] });
    if (u.includes("/delivery-workbench/services")) return ok({ services: u.includes("include_done") ? [] : services });
    if (u.includes("/delivery-workbench/search")) return ok(searchBody);
    if (u.includes("/delivery-teams?")) return ok({ teams: [{ id: "T1", delivery_vehicles: { vehicle_plate: "VAA1" }, driver: { name: "Ali" } }, { id: "T2", delivery_vehicles: { vehicle_plate: "VAA2" }, driver: { name: "Bala" } }, { id: "T3", delivery_vehicles: { vehicle_plate: "LOCKED" }, driver: { name: "Out" } }] });
    if (u.includes("/delivery-schedules?")) return ok({ schedules: [{ id: "x", team_id: "T3", status: "Out for Delivery" }] });
    if (u.endsWith("/delivery-schedules") && method === "POST") return { ok: true, status: 201, json: async () => ({ schedule: { id: "new" } }) };
    if (u.includes("/delivery-schedules/") && method === "PATCH") return ok({ schedule: { id: "sch1" } });
    if (u.includes("/delivery-schedules/") && method === "DELETE") return ok({ ok: true });
    return ok({});
  };
};
beforeEach(() => { calls = []; services = [svc()]; searchBody = { delivery_orders: [], services: [], truncated: {} }; installFetch(); });
afterEach(() => { delete global.fetch; });

describe("filterServices", () => {
  const rows = [svc({ id: "a", operational_date: FUTURE }), svc({ id: "b", operational_date: PAST }), svc({ id: "c", operational_date: null, schedulable: false }), svc({ id: "d", operational_date: FUTURE2, schedule: { id: "z", team_id: "T1" } })];
  test("default planning view: TBC first, then dated; past-dated live cases hidden", () => {
    expect(filterServices(rows, { today: "2026-10-05" }).map(s => s.id)).toEqual(["c", "a", "d"]);
  });
  test("show past → included; a date filter shows exactly that day", () => {
    expect(filterServices(rows, { showPast: true, today: "2026-10-05" }).map(s => s.id)).toEqual(["c", "b", "a", "d"]);
    expect(filterServices(rows, { dateFilter: PAST, today: "2026-10-05" }).map(s => s.id)).toEqual(["b"]);
  });
  test("team filter: a team, or unassigned", () => {
    expect(filterServices(rows, { teamFilter: "T1", today: "2026-10-05" }).map(s => s.id)).toEqual(["d"]);
    expect(filterServices(rows, { teamFilter: "unassigned", today: "2026-10-05" }).map(s => s.id)).toEqual(["c", "a"]);
  });
});

describe("Service jobs in the Delivery Orders workbench", () => {
  test("Service row shown with a SERVICE badge next to the unchanged DO row; DELIVERY / SERVICE groups", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService canAssignService />));
    await screen.findByText("DO2610-0031");
    const row = await screen.findByTestId("service-row");
    expect(within(row).getByTestId("service-badge")).toHaveTextContent("SERVICE");
    expect(row).toHaveTextContent("SV-497");
    expect(row).toHaveTextContent("55670");
    expect(row).toHaveTextContent("Xavier Yeo");
    expect(row).toHaveTextContent("Headboard panel ×2");
    expect(screen.getByTestId("group-delivery")).toHaveTextContent("DELIVERY (1)");
    expect(screen.getByTestId("group-service")).toHaveTextContent("SERVICE (1)");
  });
  test("expanding a Service shows note, contact, address, items + qty", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService />));
    fireEvent.click(within(await screen.findByTestId("service-row")).getByRole("button", { name: /SV-497/ }));
    const d = await screen.findByTestId("service-detail");
    expect(d).toHaveTextContent("Touch up headboard");
    expect(d).toHaveTextContent("012-345 6789");
    expect(d).toHaveTextContent("12 Jalan Mawar");
    expect(d).toHaveTextContent("Headboard panel ×2");
  });
  test("without Service read permission: no Service fetch, DO list exactly as before", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} />));
    await screen.findByText("DO2610-0031");
    expect(screen.queryByTestId("service-row")).toBeNull();
    expect(screen.queryByTestId("group-service")).toBeNull();
    expect(calls.some(c => c.u.includes("/delivery-workbench/services"))).toBe(false);
  });
  test("Assign Team → POST /delivery-schedules with the Service's own order (no Delivery Order); locked team not offered", async () => {
    let changed = 0;
    render(wrap(<DeliveryOrdersTab onChanged={() => { changed++; }} canViewService canAssignService />));
    const ctl = await screen.findByTestId("service-team-control");
    const select = within(ctl).getByRole("combobox");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(3)); // placeholder + 2 open teams
    expect(within(select).queryByText(/LOCKED/)).toBeNull();
    fireEvent.change(select, { target: { value: "T2" } });
    fireEvent.click(within(ctl).getByText("Assign"));
    await waitFor(() => expect(calls.some(c => c.method === "POST" && c.u.endsWith("/delivery-schedules"))).toBe(true));
    const post = calls.find(c => c.method === "POST" && c.u.endsWith("/delivery-schedules"));
    expect(post.body).toEqual({ order_id: 101, team_id: "T2", scheduled_date: FUTURE, sort_order: 1 });
    expect(post.body.delivery_order_id).toBeUndefined();
    expect(calls.some(c => c.method === "POST" && c.u.includes("/delivery-orders"))).toBe(false);
    await waitFor(() => expect(changed).toBe(1)); // board reloads
  });
  test("Reassign → PATCH team_id; Move to Unassigned → DELETE the stop only", async () => {
    services = [svc({ schedule: { id: "sch1", team_id: "T1", scheduled_date: FUTURE, status: "scheduled", team_label: "VAA1 · Ali" } })];
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService canAssignService />));
    const ctl = await screen.findByTestId("service-team-control");
    const select = within(ctl).getByRole("combobox");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(3));
    expect(within(ctl).queryByText("Assign")).toBeNull();
    fireEvent.change(select, { target: { value: "T2" } });
    fireEvent.click(within(ctl).getByText("Reassign"));
    await waitFor(() => expect(calls.some(c => c.method === "PATCH")).toBe(true));
    expect(calls.find(c => c.method === "PATCH")).toMatchObject({ u: expect.stringMatching(/\/delivery-schedules\/sch1$/), body: { team_id: "T2" } });
    fireEvent.click(within(await screen.findByTestId("service-team-control")).getByText("Unassign"));
    await waitFor(() => expect(calls.some(c => c.method === "DELETE")).toBe(true));
    expect(calls.find(c => c.method === "DELETE").u).toMatch(/\/delivery-schedules\/sch1$/);
    expect(calls.some(c => c.u.includes("/delivery-orders") && c.method !== "GET")).toBe(false);
  });
  test("no schedule-edit permission → no assign controls; TBC Service explains instead", async () => {
    services = [svc(), svc({ id: "s2", sv_number: "SV-120", operational_date: null, schedulable: false })];
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService canAssignService={false} />));
    await screen.findAllByTestId("service-row");
    expect(screen.queryByTestId("service-team-control")).toBeNull();
    expect(screen.getByText(/Date TBC — set the date in Service first/)).toBeInTheDocument();
  });
  test("date filter shows that day's Delivery and Service together", async () => {
    services = [svc(), svc({ id: "s2", sv_number: "SV-200", operational_date: FUTURE2 })];
    const { container } = render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService />));
    await screen.findAllByTestId("service-row");
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: FUTURE } });
    expect(screen.getAllByTestId("service-row").map(r => r.textContent).join(" ")).toMatch(/SV-497/);
    expect(screen.queryByText("SV-200")).toBeNull();
    expect(screen.getByText("DO2610-0031")).toBeInTheDocument();
  });
});

describe("Cross-date search", () => {
  test("typing searches all dates (debounced), labels DELIVERY / SERVICE; clear returns to the list", async () => {
    jest.useFakeTimers();
    searchBody = {
      delivery_orders: [{ ...DO, id: "old", do_number: "DO2609-0246", status: "completed", delivery_date: "2026-09-18" }, { ...DO }],
      services: [svc({ status: "resolved", terminal: true, schedulable: false })], truncated: {},
    };
    let went = null;
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService canAssignService onGoToSchedule={d => { went = d; }} />));
    await act(async () => { await Promise.resolve(); });
    const box = screen.getByTestId("workbench-search");
    fireEvent.change(box, { target: { value: "DO2609-0246" } });
    expect(screen.getByTestId("search-loading")).toBeInTheDocument();
    expect(calls.some(c => c.u.includes("/delivery-workbench/search"))).toBe(false); // debounced
    await act(async () => { jest.advanceTimersByTime(350); });
    jest.useRealTimers();
    await screen.findByTestId("search-results");
    expect(calls.find(c => c.u.includes("/delivery-workbench/search")).u).toMatch(/q=DO2609-0246$/);
    expect(box).toHaveValue("DO2609-0246"); // text stays visible
    const deliveries = screen.getAllByTestId("search-result-delivery");
    expect(within(deliveries[0]).getByTestId("delivery-badge")).toHaveTextContent("DELIVERY");
    expect(deliveries[0]).toHaveTextContent("DO2609-0246");
    expect(deliveries[0]).toHaveTextContent("18/09/2026");
    expect(within(deliveries[0]).queryByText("Go to Schedule")).toBeNull(); // completed: no scheduling action
    fireEvent.click(within(deliveries[1]).getByText("Go to Schedule"));
    expect(went).toBe(FUTURE);
    const s = screen.getByTestId("search-result-service");
    expect(within(s).getByTestId("service-badge")).toBeInTheDocument();
    expect(within(s).queryByTestId("service-team-control")).toBeNull(); // historical Service: no assign
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(screen.queryByTestId("search-results")).toBeNull();
    expect(await screen.findByText("DO2610-0031")).toBeInTheDocument();
  });
  test("no result state", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService />));
    fireEvent.change(screen.getByTestId("workbench-search"), { target: { value: "zzzz" } });
    expect(await screen.findByTestId("search-empty", {}, { timeout: 2000 })).toHaveTextContent("No Delivery Order or Service matches");
  });
  test("one character does not search", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService />));
    fireEvent.change(screen.getByTestId("workbench-search"), { target: { value: "a" } });
    await new Promise(r => setTimeout(r, 400));
    expect(calls.some(c => c.u.includes("/delivery-workbench/search"))).toBe(false);
    expect(screen.queryByTestId("search-results")).toBeNull();
  });
});
