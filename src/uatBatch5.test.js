// UAT batch (2026-10-09): Service display number (Fix 2), schedule salesperson (Fix 3),
// linked SO under the Service number in print (Fix 4), Finance SO search + delivery date (Fix 5).
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { serviceNumberOf, linkedSoLabelOf, salespersonOf, soLabel } from "./serviceNumber";
import { teamScheduleStopCells, serviceJobHtml, buildTeamScheduleRows } from "./DeliverySchedule";
import { deliveryLabel, LinkedOrdersCell } from "./paymentSoLinks";
import { ToastProvider, ModalProvider, LoadingProvider } from "./UIComponents";
import FinancePage from "./FinancePage";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "finance", name: "Fin" }, activeCompanyId: "A" }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));
jest.mock("./printDocument", () => ({ printHtml: () => {} }));

describe("Fix 2 — Service number", () => {
  test("linked case shows SV-<SO>; standalone keeps its running number; old payloads fall back", () => {
    expect(serviceNumberOf({ display_number: "SV-30228", sv_number: "SV-591" })).toBe("SV-30228");
    expect(serviceNumberOf({ _display_number: "SV-30228-2", _sv_number: "SV-592" })).toBe("SV-30228-2");
    expect(serviceNumberOf({ sv_number: "SV-520" })).toBe("SV-520");
    expect(linkedSoLabelOf({ linked_so: "30228" })).toBe("SO30228");
    expect(linkedSoLabelOf({ linked_so: null })).toBeNull();
    expect(soLabel("55732 55733")).toBe("SO55732 / SO55733");
  });
});

describe("Fix 3 — salesperson", () => {
  test("backend salesperson wins; linked Service never shows the inert order's value; standalone shows its own", () => {
    expect(salespersonOf({ type: "Delivery", salesperson: "Tina", salesman: "Old" })).toBe("Tina");
    expect(salespersonOf({ type: "Service", linked_so: "30228", salesman: "Creator" })).toBeNull();
    expect(salespersonOf({ type: "Service", linked_so: null, salesman: "Creator" })).toBe("Creator");
    expect(salespersonOf({ type: "Service", salesperson: null, salesman: "x" })).toBeNull();
  });
});

describe("Fix 4 — schedule print", () => {
  const team = { vehicle_plate: "VAA1" };
  const o = { id: 201, type: "Service", so_number: "SV-591", sv_number: "SV-591", display_number: "SV-30228", linked_so: "30228", linked_so_label: "SO30228",
    salesperson: "Tina", customer_name: "Xavier", contact: "011", address: "1 Jalan", service_note: "Linked to SO: 30228 | Fix the leg", remark: "Linked to SO: 30228 | Fix the leg",
    items: JSON.stringify([{ itemName: "Sofa leg", unit: "1" }]) };
  const sc = { id: "s1", order_id: 201, notes: "Call before arrival" };
  const rows = buildTeamScheduleRows({ ...team, schedules: [{ ...sc, orders: o }] }).filter(r => r.o.id === 201);
  test("Service number, then Linked SO directly below it; Remark keeps only the genuine note + dispatcher note", () => {
    const cells = teamScheduleStopCells(rows[0].o, rows[0].sc, rows, team);
    expect(cells.info.map(p => p.text).slice(0, 2)).toEqual(["SV-30228", "Linked SO: SO30228"]);
    expect(cells.remark.map(p => p.text)).toEqual(["Fix the leg", "Call before arrival"]);
    expect(JSON.stringify(cells.remark)).not.toMatch(/Linked/);
    expect(cells.salesman).toBe("Tina");
  });
  test("standalone Service: its own number, no linked SO invented", () => {
    const so = { ...o, display_number: "SV-520", linked_so: null, linked_so_label: null, salesperson: "Creator", service_note: "Assemble", remark: "Assemble" };
    const r2 = buildTeamScheduleRows({ ...team, schedules: [{ ...sc, orders: so }] }).filter(r => r.o.id === 201);
    const cells = teamScheduleStopCells(r2[0].o, r2[0].sc, r2, team);
    expect(cells.info[0].text).toBe("SV-520");
    expect(cells.info.some(p => /Linked SO/.test(p.text))).toBe(false);
    expect(cells.salesman).toBe("Creator");
  });
  test("delivery stop keeps its SO number and its own remark", () => {
    const d = { id: 101, type: "Delivery", so_number: "30228", salesperson: "Tina", remark: "Back gate", items: "[]" };
    const r3 = buildTeamScheduleRows({ ...team, schedules: [{ id: "s2", order_id: 101, orders: d }] }).filter(r => r.o.id === 101);
    const cells = teamScheduleStopCells(r3[0].o, r3[0].sc, r3, team);
    expect(cells.info[0].text).toBe("30228");
    expect(cells.remark.map(p => p.text)).toEqual(["Back gate"]);
    expect(cells.salesman).toBe("Tina");
  });
  test("Service job PDF: Linked SO right below Service#", () => {
    const html = serviceJobHtml({ display_number: "SV-30228", sv_number: "SV-591", so_number: "30228", description: "Fix the leg", items: [] });
    expect(html).toMatch(/Service#: SV-30228<\/b><br><span data-field="linked-so">Linked SO: SO30228<\/span>/);
    expect(html).not.toContain("SV-591");
    expect(serviceJobHtml({ sv_number: "SV-520", so_number: null, items: [] })).not.toContain("linked-so");
  });
});

describe("Fix 5 — Finance SO search + delivery date", () => {
  test("delivery label: DO date / SO date / TBC / multiple DOs (never one guessed date)", () => {
    expect(deliveryLabel({ source: "delivery_order", date: "2026-10-12", do_number: "DO2610-0001" })).toBe("12 Oct 2026 (DO2610-0001)");
    expect(deliveryLabel({ source: "sales_order", date: "2026-10-01" })).toBe("1 Oct 2026");
    expect(deliveryLabel({ source: "sales_order", date: null, tbc: true })).toBe("TBC");
    expect(deliveryLabel({ ambiguous: true, deliveries: [{ do_number: "DO-A", date: "2026-10-14" }, { do_number: "DO-B", date: null }] })).toBe("Multiple DO: DO-A 14 Oct 2026, DO-B TBC");
  });
  test("a split payment lists each SO with its own amount and date", () => {
    render(<LinkedOrdersCell links={[
      { so_number: "41000", amount: 600, delivery: { tbc: true } },
      { so_number: "30228", amount: 400, delivery: { source: "delivery_order", date: "2026-10-12", do_number: "DO1" } },
    ]} />);
    const rows = screen.getAllByTestId("linked-order");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/SO41000.*RM 600\.00.*TBC/);
    expect(rows[1].textContent).toMatch(/SO30228.*RM 400\.00.*12 Oct 2026/);
  });
  test("Payments tab: SO search hits the server with ?so=, shows that SO's payments, keeps the other filters; Clear restores the list", async () => {
    const calls = [];
    const P = (id, amount, so, paid) => ({ id, amount, approval_status: "approved", payment_method: "Cash", paid_at: paid, source_type: "PAYMENT_TRANSACTION", linked_orders: [{ so_number: so, amount, delivery: { source: "sales_order", date: "2026-10-01" } }] });
    global.fetch = async (url) => {
      calls.push(String(url));
      const ok = b => ({ ok: true, status: 200, json: async () => b });
      if (String(url).includes("so=")) return ok({ payments: [P("p-split", 400, "30228", "2026-01-15T00:00:00Z"), P("p-new", 300, "30228", new Date().toISOString())], so_search: { sales_orders: [{ id: "s1", order_number: "30228" }] } });
      if (String(url).includes("/payments?")) return ok({ payments: [P("p-other", 50, "99999", new Date().toISOString())] });
      return ok({ buckets: {}, summary: {} });
    };
    render(<LoadingProvider><ToastProvider><ModalProvider><FinancePage /></ModalProvider></ToastProvider></LoadingProvider>);
    fireEvent.click(await screen.findByText("Payments"));
    expect(await screen.findByText("SO99999")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("so-search"), { target: { value: "SO 30228" } });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(calls.some(u => /\/payments\?include_deposits=1&so=SO%2030228$/.test(u))).toBe(true));
    const status = await screen.findByTestId("so-search-status");
    await waitFor(() => expect(status.textContent).toMatch(/SO30228 — 2 found · 1 outside the date range/));
    expect(screen.queryByText("SO99999")).toBeNull();
    fireEvent.click(within(status).getByText("show all dates"));
    await waitFor(() => expect(screen.getAllByText("SO30228").length).toBe(2));
    fireEvent.click(screen.getByText("Clear SO"));
    expect(await screen.findByText("SO99999")).toBeInTheDocument();
    delete global.fetch;
  });
});
