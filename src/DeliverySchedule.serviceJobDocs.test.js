// Service rows in Deliveries → Delivery Orders: PDF + Excel of that ONE Service job.
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import ExcelJS from "exceljs";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider, ModalProvider } from "./UIComponents";
import { serviceJobHtml, exportServiceJobExcel, DeliveryOrdersTab } from "./DeliverySchedule";

const mockPrinted = [];
jest.mock("./printDocument", () => ({ printHtml: (html) => mockPrinted.push(html) }));
jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", role: "manager" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

const SVC = {
  type: "service", id: "s1", sv_number: "SV-588", legacy_order_id: 101, so_number: "55670", customer_name: "Xavier Yeo",
  customer_contact: "012-345 6789", customer_address: "12 Jalan Mawar, Penang", service_type: 2, status: "scheduled",
  service_date: "2026-10-12", operational_date: "2026-10-09", description: "Touch up headboard scratch.\nBring matching paint.",
  items: [{ id: "i1", description: "Headboard panel", action_type: 2, quantity: 2 }, { id: "i2", description: "Touch-up kit", action_type: 1, quantity: 1 }],
  schedule: { id: "sch", team_id: "T1", scheduled_date: "2026-10-09", status: "scheduled", team_label: "PKP 7328 · Ali" }, terminal: false, schedulable: true,
};
const STANDALONE = { ...SVC, id: "s2", sv_number: "SV-600", so_number: null, customer_name: "Walk In", description: "Assemble wardrobe", items: [{ id: "i3", description: "Wardrobe", action_type: 1, quantity: 1 }], schedule: null, operational_date: null };

describe("Service PDF", () => {
  test("with SO: Service No, SO, customer, contact, address, type, NOTE, items + qty, row's date, team", () => {
    const html = serviceJobHtml(SVC, { name: "V Haus" });
    for (const t of ["SV-588", "55670", "Xavier Yeo", "012-345 6789", "12 Jalan Mawar, Penang", "Assembly / Installation", "Touch up headboard scratch.", "Bring matching paint.", "Headboard panel", "Touch-up kit", "PKP 7328 · Ali", "SERVICE JOB"]) expect(html).toContain(t);
    expect(html).toContain("09/10/2026");         // operational_date — the date the row shows
    expect(html).not.toContain("12/10/2026");     // not the case's own service_date
    expect(html).toMatch(/<td class="c">2<\/td>/); // quantity
    expect(html).toMatch(/data-field="service-note">Touch up headboard scratch\.\nBring matching paint\./);
  });
  test("without SO and unassigned: SO '—', date TBC, team Unassigned — still renders", () => {
    const html = serviceJobHtml(STANDALONE);
    expect(html).toContain("SV-600");
    expect(html).toMatch(/SO#<\/td><td>—<\/td>/);
    expect(html).toMatch(/Date<\/td><td>TBC<\/td>/);
    expect(html).toMatch(/Team<\/td><td>Unassigned<\/td>/);
    expect(html).toContain("Assemble wardrobe");
  });
  test("only the selected Service; no internal ids or JSON", () => {
    const html = serviceJobHtml(SVC);
    expect(html).not.toContain("SV-600");
    for (const t of ["legacy_order_id", "101", "\"id\"", "sch", "T1"]) expect(html).not.toContain(t === "101" ? ">101<" : t);
  });
});

async function runExcel(svc) {
  const OriginalBlob = global.Blob, oc = URL.createObjectURL, orv = URL.revokeObjectURL;
  let bytes = null, filename = null;
  global.Blob = function (parts, opts) { bytes = parts[0]; return new OriginalBlob(parts, opts); };
  URL.createObjectURL = () => "blob:mock"; URL.revokeObjectURL = () => {};
  const spy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { filename = this.download; });
  try { await exportServiceJobExcel(svc, { name: "V Haus" }); } finally { global.Blob = OriginalBlob; URL.createObjectURL = oc; URL.revokeObjectURL = orv; spy.mockRestore(); }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  const ws = wb.getWorksheet("Service");
  const cells = []; ws.eachRow(row => row.eachCell(c => cells.push(String(c.value ?? ""))));
  return { cells, filename, ws };
}

describe("Service Excel", () => {
  test("same information, every item on its own row with its quantity", async () => {
    const { cells, filename } = await runExcel(SVC);
    expect(filename).toBe("Service-SV-588.xlsx");
    for (const t of ["Service#: SV-588", "55670", "Xavier Yeo", "012-345 6789", "12 Jalan Mawar, Penang", "Assembly / Installation", "09/10/2026", "PKP 7328 · Ali", "Headboard panel", "Touch-up kit"]) expect(cells).toContain(t);
    expect(cells).toContain("Touch up headboard scratch.\nBring matching paint.");
    expect(cells).toContain("2"); expect(cells).toContain("Service Note");
    expect(cells.join("|")).not.toContain("SV-600");
  });
  test("without SO / unassigned / TBC still exports", async () => {
    const { cells, filename } = await runExcel(STANDALONE);
    expect(filename).toBe("Service-SV-600.xlsx");
    expect(cells).toContain("—"); expect(cells).toContain("TBC"); expect(cells).toContain("Unassigned"); expect(cells).toContain("Wardrobe");
  });
});

describe("Delivery Orders tab — Service row actions", () => {
  let calls;
  beforeEach(() => {
    calls = []; mockPrinted.length = 0;
    global.fetch = async (url, opts = {}) => {
      calls.push({ u: String(url), method: opts.method || "GET" });
      const ok = b => ({ ok: true, status: 200, json: async () => b });
      if (String(url).includes("/delivery-workbench/services")) return ok({ services: String(url).includes("include_done") ? [] : [SVC] });
      if (String(url).includes("/delivery-orders?")) return ok({ delivery_orders: [] });
      if (String(url).includes("/delivery-workbench/tbc")) return ok({ entries: [], count: 0 });
      if (String(url).includes("/company-settings")) return ok({ settings: { company_name: "V Haus" } });
      return ok({ teams: [], schedules: [] });
    };
  });
  afterEach(() => { delete global.fetch; });
  const wrap = ui => <ToastProvider><ModalProvider>{ui}</ModalProvider></ToastProvider>;

  test("PDF prints this Service job; nothing is written (no POST/PATCH/DELETE)", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService canAssignService />));
    const row = await screen.findByTestId("service-row");
    expect(within(row).getByTestId("service-team-control")).toBeInTheDocument(); // assign controls unchanged
    fireEvent.click(within(row).getByTestId("service-pdf"));
    expect(mockPrinted).toHaveLength(1);
    expect(mockPrinted[0]).toContain("SV-588");
    expect(mockPrinted[0]).toContain("Touch up headboard scratch.");
    await new Promise(r => setTimeout(r, 0));
    expect(calls.some(c => c.method !== "GET")).toBe(false);
  });
  test("read-only viewer (no assign rights) still gets PDF + Excel, no team controls", async () => {
    render(wrap(<DeliveryOrdersTab onChanged={() => {}} canViewService canAssignService={false} />));
    const row = await screen.findByTestId("service-row");
    expect(within(row).queryByTestId("service-team-control")).toBeNull();
    expect(within(row).getByTestId("service-pdf")).toBeInTheDocument();
    expect(within(row).getByTestId("service-excel")).toBeInTheDocument();
  });
});
