// Deliveries → Delivery Orders: the Team filter follows the Date filter. Teams
// are per date (the same truck has a separate team on every day it runs), so
// the dropdown used to list "(MOOVER) JTN2818" once per date, indistinguishable.
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider, ModalProvider } from "./UIComponents";
import { DeliveryOrdersTab } from "./DeliverySchedule";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "manager" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

const wrap = ui => <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;
const team = (plate, driver) => ({ delivery_vehicles: { vehicle_plate: plate }, driver: { name: driver } });
const dord = (id, no, date, teamId, t) => ({
  id, do_number: no, status: "scheduled", delivery_date: date, sales_orders: { order_number: `SO-${id}`, customer_name: `Cust ${id}` },
  delivery_order_items: [], delivery_schedules: teamId ? [{ id: `s-${id}`, status: "scheduled", team_id: teamId, scheduled_date: date, delivery_teams: t }] : [],
});
const DOS = [
  dord("a", "DO-A", "2026-09-18", "T-JTN-18", team("(MOOVER) JTN2818", "Amir")),
  dord("b", "DO-B", "2026-09-18", "T-JNW-18", team("(Steven) JNW7727", "Steven")),
  dord("c", "DO-C", "2026-09-19", "T-JTN-19", team("(MOOVER) JTN2818", "Amir")),
  dord("d", "DO-D", "2026-09-18", null, null),
];

describe("DeliveryOrdersTab — Team filter follows the Date filter", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes("/delivery-orders")) return { ok: true, json: async () => ({ delivery_orders: DOS }) };
      return { ok: true, json: async () => ({}) };
    });
  });
  afterEach(() => { global.fetch = originalFetch; });

  const teamSelect = () => screen.getAllByRole("combobox").find(el => el.querySelector('option[value="unassigned"]'));
  const dateInput = () => document.querySelector('input[type="date"]');
  const optionLabels = () => within(teamSelect()).getAllByRole("option").map(o => o.textContent);

  test("no date: every team, each labelled with its date so the same truck on two days is distinct", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} />));
    await screen.findByText("DO-A");
    expect(optionLabels()).toEqual([
      "All teams", "Unassigned",
      "(MOOVER) JTN2818 · Amir · 2026-09-18", "(Steven) JNW7727 · Steven · 2026-09-18",
      "(MOOVER) JTN2818 · Amir · 2026-09-19",
    ]);
  });

  test("date picked: only that date's teams, no date suffix", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} />));
    await screen.findByText("DO-A");
    fireEvent.change(dateInput(), { target: { value: "2026-09-18" } });
    await waitFor(() => expect(optionLabels()).toEqual(["All teams", "Unassigned", "(MOOVER) JTN2818 · Amir", "(Steven) JNW7727 · Steven"]));
  });

  test("a team chosen for another date is cleared when the date changes", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} />));
    await screen.findByText("DO-A");
    fireEvent.change(teamSelect(), { target: { value: "T-JTN-19" } });
    expect(screen.getByText("DO-C")).toBeInTheDocument();
    fireEvent.change(dateInput(), { target: { value: "2026-09-18" } });
    await waitFor(() => expect(teamSelect().value).toBe(""));
    expect(screen.getByText("DO-A")).toBeInTheDocument();
    expect(screen.getByText("DO-B")).toBeInTheDocument();
  });
});
