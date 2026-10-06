// Phase 4A — Action Required cards (Overview) and their drill-down lists.
import fs from "fs";
import path from "path";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ActionRequiredPanel, ActionCategoryList, ACTION_CARDS } from "./ActionRequired";
import { ToastProvider, ModalProvider } from "./UIComponents";
import { DeliveryOrdersTab } from "./DeliverySchedule";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "manager" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

const ENTRY = { kind: "delivery_order", key: "do-1", delivery_order_id: "d1", do_number: "DO2610-0001", sales_order_id: "so1", so_number: "SO100", customer_name: "Xavier Yeo",
  contact: "012-345 6789", address: "12 Jalan Mawar", salesperson: "Tina", date: "2026-10-05", status: "scheduled", team: "VAA1 · Ali", items: "Bedframe King ×1", reason: "Date passed — still scheduled" };
const SO_ENTRY = { kind: "order", key: "so-2", sales_order_id: "so2", so_number: "SO200", customer_name: "Walk In", date: "2026-10-01", status: "confirmed", team: null, items: "Sofa ×2", reason: "Planning date passed — no Delivery Order" };

let calls;
const ok = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
afterEach(() => { delete global.fetch; });

describe("ActionRequiredPanel", () => {
  test("shows only the categories the backend returned, with its counts; a click opens that card", async () => {
    calls = [];
    global.fetch = async (url, opts = {}) => { calls.push({ u: String(url), h: opts.headers }); return ok({ counts: { tbc: 3, past_dated_delivery: 12, unscheduled_delivery: 0 }, today: "2026-10-06" }); };
    const onOpen = jest.fn();
    render(<ActionRequiredPanel companyId="A" onOpen={onOpen} />);
    expect(await screen.findByTestId("action-card-tbc")).toHaveTextContent("3");
    expect(screen.getByTestId("action-card-past_dated_delivery")).toHaveTextContent("12");
    expect(screen.getByTestId("action-card-unscheduled_delivery")).toHaveTextContent("0");
    expect(screen.queryByTestId("action-card-pending_amendment")).toBeNull();   // not permitted → not shown
    expect(screen.queryByTestId("action-card-past_dated_service")).toBeNull();
    expect(screen.queryByText(/finance/i)).toBeNull();
    fireEvent.click(screen.getByTestId("action-card-tbc"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "tbc", target: "deliveries" }));
    expect(calls[0].u).toMatch(/\/operations\/action-required$/);
  });
  test("switching company reloads the counts", async () => {
    let n = 0;
    global.fetch = async () => ok({ counts: { tbc: ++n === 1 ? 5 : 1 } });
    const { rerender } = render(<ActionRequiredPanel companyId="A" onOpen={() => {}} />);
    expect(await screen.findByTestId("action-card-tbc")).toHaveTextContent("5");
    rerender(<ActionRequiredPanel companyId="B" onOpen={() => {}} />);
    await screen.findByText("1");
    expect(screen.getByTestId("action-card-tbc")).toHaveTextContent("1");
  });
  test("no permission (403) → the panel is not rendered at all", async () => {
    global.fetch = async () => ok({ error: "No access" }, 403);
    const { container } = render(<ActionRequiredPanel companyId="A" onOpen={() => {}} />);
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='action-required']")).toBeNull();
  });
  test("card targets: TBC / unscheduled / past-dated → Deliveries, approvals → Delivery Dates, amendments → Order Amendments", () => {
    const t = Object.fromEntries(ACTION_CARDS.map(c => [c.key, c.target]));
    expect(t).toEqual({ tbc: "deliveries", pending_date_approval: "delivery-approvals", pending_amendment: "order-amendments", unscheduled_delivery: "deliveries",
      unscheduled_service: "deliveries", past_dated_delivery: "deliveries", past_dated_service: "deliveries" });
  });
});

describe("ActionCategoryList", () => {
  test("lists SO, DO, customer, contact, address, salesperson, date, status, team, items, reason; count = rows", async () => {
    global.fetch = async url => { expect(String(url)).toMatch(/\/operations\/action-required\/past_dated_delivery$/); return ok({ entries: [ENTRY, SO_ENTRY], count: 2 }); };
    const onOpenOrder = jest.fn(), onGoToSchedule = jest.fn();
    render(<ActionCategoryList category="past_dated_delivery" onClose={() => {}} onOpenOrder={onOpenOrder} onGoToSchedule={onGoToSchedule} />);
    const rows = await screen.findAllByTestId("action-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId("action-list-count")).toHaveTextContent("(2)");
    for (const t of ["DO2610-0001", "SO100", "Xavier Yeo", "012-345 6789", "12 Jalan Mawar", "Tina", "05/10/2026", "scheduled", "VAA1 · Ali", "Bedframe King ×1", "Date passed — still scheduled"]) expect(rows[0].textContent).toContain(t);
    expect(within(rows[1]).getByText("no DO")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Unassigned")).toBeInTheDocument();
    fireEvent.click(within(rows[0]).getByText("Order"));
    expect(onOpenOrder).toHaveBeenCalledWith("so1");
    fireEvent.click(within(rows[0]).getByText("Schedule"));
    expect(onGoToSchedule).toHaveBeenCalledWith("2026-10-05");
  });
  test("filter narrows the visible rows only", async () => {
    global.fetch = async () => ok({ entries: [ENTRY, SO_ENTRY], count: 2 });
    render(<ActionCategoryList category="past_dated_delivery" onClose={() => {}} />);
    await screen.findAllByTestId("action-row");
    fireEvent.change(screen.getByLabelText("Filter list"), { target: { value: "walk" } });
    expect(screen.getAllByTestId("action-row")).toHaveLength(1);
  });
});

describe("Delivery Orders drill-down", () => {
  const wrap = ui => <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;
  beforeEach(() => {
    calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("/operations/action-required/")) return ok({ entries: [ENTRY], count: 1 });
      if (String(url).includes("/delivery-workbench/tbc")) return ok({ entries: [], count: 7 });
      if (String(url).includes("/delivery-workbench/services")) return ok({ services: [] });
      if (String(url).includes("/delivery-orders?")) return ok({ delivery_orders: [] });
      return ok({ teams: [], schedules: [], settings: {} });
    };
  });
  test("a past-dated card opens that category's list; × returns to all Delivery Orders", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} focus={{ category: "past_dated_delivery", nonce: 1 }} />));
    expect(await screen.findByTestId("action-category-list")).toBeInTheDocument();
    expect(await screen.findByText("DO2610-0001")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("action-list-close"));
    expect(screen.queryByTestId("action-category-list")).toBeNull();
    expect(screen.getByText(/All Delivery Orders/)).toBeInTheDocument();
  });
  test("the TBC card opens the existing TBC view", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} focus={{ category: "tbc", nonce: 1 }} />));
    const toggle = await screen.findByTestId("tbc-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("action-category-list")).toBeNull();
  });
});

describe("wiring", () => {
  const app = fs.readFileSync(path.join(__dirname, "App.js"), "utf8");
  test("Overview renders the panel; approvals open on Pending; nav clicks clear the drill-down", () => {
    expect(app).toMatch(/<ActionRequiredPanel companyId=\{companyId\} onOpen=\{onActionOpen\} \/>/);
    expect(app).toMatch(/setDateRequestsFilter\(\{ status: "pending"/);
    expect(app).toMatch(/<DeliveryDateRequestsPage initialFilter=\{dateRequestsFilter\} \/>/);
    expect(app).toMatch(/focus=\{deliveriesFocus\}/);
    expect(app).toMatch(/setDeliveriesFocus\(null\); setDateRequestsFilter\(null\); setPage\(n\.id\)/);
    const ddr = fs.readFileSync(path.join(__dirname, "DeliveryDateRequestsPage.js"), "utf8");
    expect(ddr).toMatch(/useState\(initialFilter\?\.status \|\| "all"\)/);
  });
});
